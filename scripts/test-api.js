const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  \x1b[32m\u2713\x1b[0m ${label}`);
}

function fail(label, detail) {
  failed++;
  console.log(`  \x1b[31m\u2717\x1b[0m ${label}`);
  if (detail) console.log(`       ${detail}`);
}

async function expectStatus(res, expected, label) {
  const text = await res.clone().text();
  if (res.status !== expected) {
    fail(label, `expected ${expected}, got ${res.status} \u2014 ${text.slice(0, 120)}`);
    return false;
  }
  return true;
}

const VALID_PAYLOAD = {
  adId: `ad-${Date.now()}`,
  tenantId: "tenant-e2e",
  violationType: "PROHIBITED_TERM",
  severity: "HIGH",
  detectedAt: new Date().toISOString(),
};

// ── Tests ──────────────────────────────────────────

async function testValidWebhook() {
  const label = "POST /webhook/violation \u2014 valid payload returns 202 + jobId";

  const res = await fetch(`${BASE_URL}/webhook/violation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(VALID_PAYLOAD),
  });

  if (!(await expectStatus(res, 202, label))) return;

  const body = await res.json();

  if (typeof body.jobId !== "string" || !body.jobId) {
    fail(label, `missing or invalid jobId: ${JSON.stringify(body)}`);
    return;
  }

  ok(label);
}

async function testValidationErrors() {
  const cases = [
    { payload: { ...VALID_PAYLOAD, adId: "" }, fields: ["adId"], label: "empty adId" },
    { payload: { tenantId: "t", violationType: "PROHIBITED_TERM", severity: "LOW", detectedAt: new Date().toISOString() }, fields: ["adId"], label: "missing adId" },
    { payload: { adId: "a", violationType: "PROHIBITED_TERM", severity: "LOW", detectedAt: new Date().toISOString() }, fields: ["tenantId"], label: "missing tenantId" },
    { payload: { ...VALID_PAYLOAD, violationType: "INVALID" }, fields: ["violationType"], label: "invalid violationType" },
    { payload: { ...VALID_PAYLOAD, severity: "URGENT" }, fields: ["severity"], label: "invalid severity" },
    { payload: { ...VALID_PAYLOAD, detectedAt: "not-a-date" }, fields: ["detectedAt"], label: "invalid detectedAt" },
    { payload: {}, fields: ["adId", "tenantId", "violationType", "severity", "detectedAt"], label: "empty body" },
  ];

  for (const { payload, fields, label } of cases) {
    const fullLabel = `POST /webhook/violation \u2014 ${label} returns 400`;

    const res = await fetch(`${BASE_URL}/webhook/violation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!(await expectStatus(res, 400, fullLabel))) continue;

    const body = await res.json();

    if (body.error !== "Invalid payload") {
      fail(fullLabel, `expected error="Invalid payload", got ${JSON.stringify(body)}`);
      continue;
    }

    const missing = fields.filter((f) => !body.details?.[f]);
    if (missing.length > 0) {
      fail(fullLabel, `missing expected error fields: ${missing.join(", ")}. body: ${JSON.stringify(body)}`);
      continue;
    }

    ok(fullLabel);
  }
}

async function testIdempotency() {
  const label = "POST /webhook/violation \u2014 idempotency (same adId+tenantId)";

  const shared = `ad-dup-${Date.now()}`;
  const payload = {
    ...VALID_PAYLOAD,
    adId: shared,
    tenantId: "tenant-dup",
  };

  const r1 = await fetch(`${BASE_URL}/webhook/violation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const r2 = await fetch(`${BASE_URL}/webhook/violation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!(await expectStatus(r1, 202, label)) || !(await expectStatus(r2, 202, label))) return;

  const b1 = await r1.json();
  const b2 = await r2.json();

  if (b1.jobId !== b2.jobId) {
    fail(label, `same adId+tenantId produced different jobIds: ${b1.jobId} vs ${b2.jobId}`);
    return;
  }

  ok(label);
}

async function testConcurrency() {
  const label = "POST /webhook/violation \u2014 20 concurrent requests";

  const tasks = Array.from({ length: 20 }, (_, i) => {
    const payload = {
      ...VALID_PAYLOAD,
      adId: `ad-con-${Date.now()}-${i}`,
      tenantId: "tenant-con",
    };
    return fetch(`${BASE_URL}/webhook/violation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  const results = await Promise.all(tasks);

  const non202 = results.filter((r) => r.status !== 202);
  if (non202.length > 0) {
    const details = non202.map((r) => `${r.status}`).join(", ");
    fail(label, `${non202.length} requests returned non-202: ${details}`);
    return;
  }

  ok(label);
}

async function testJobStatusFlow() {
  const label = "POST /webhook/violation + GET /jobs/:id \u2014 job reaches completed";

  const payload = {
    ...VALID_PAYLOAD,
    adId: `ad-flow-${Date.now()}`,
  };

  const post = await fetch(`${BASE_URL}/webhook/violation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (post.status !== 202) {
    fail(label, `webhook returned ${post.status}`);
    return;
  }

  const { jobId } = await post.json();

  for (let i = 0; i < 15; i++) {
    const get = await fetch(`${BASE_URL}/jobs/${jobId}`);

    if (get.status === 404) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const body = await get.json();

    if (body.status === "completed") {
      ok(label);
      return;
    }

    if (body.status === "failed") {
      fail(label, `job failed: ${JSON.stringify(body)}`);
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  fail(label, "job did not complete within 30s");
}

async function testJobNotFound() {
  const label = "GET /jobs/:id \u2014 nonexistent job returns 404";

  const res = await fetch(`${BASE_URL}/jobs/nonexistent-job-id-${Date.now()}`);

  if (!(await expectStatus(res, 404, label))) return;

  const body = await res.json();

  if (body.error !== "Job not found") {
    fail(label, `expected error="Job not found", got ${JSON.stringify(body)}`);
    return;
  }

  ok(label);
}

async function testAllEnumCombinations() {
  const violationTypes = ["PROHIBITED_TERM", "BRAND_VIOLATION", "COMPLIANCE_FAIL"];
  const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  for (const vt of violationTypes) {
    for (const sev of severities) {
      const label = `POST /webhook/violation \u2014 ${vt} / ${sev}`;

      const res = await fetch(`${BASE_URL}/webhook/violation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...VALID_PAYLOAD,
          adId: `ad-enum-${Date.now()}-${vt}-${sev}`,
          violationType: vt,
          severity: sev,
        }),
      });

      if (!(await expectStatus(res, 202, label))) continue;
      ok(label);
    }
  }
}

// ── Runner ─────────────────────────────────────────

async function main() {
  console.log(`\n  \x1b[1mFURY \u00b7 Click Hero \u2014 Test Suite\x1b[0m`);
  console.log(`  Base URL: ${BASE_URL}\n`);

  const tests = [
    testValidWebhook,
    testValidationErrors,
    testIdempotency,
    testConcurrency,
    testJobStatusFlow,
    testJobNotFound,
    testAllEnumCombinations,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      failed++;
      console.log(`  \x1b[31m\u2717\x1b[0m ${test.name} \u2014 uncaught error: ${err.message}`);
    }
  }

  const total = passed + failed;
  console.log(`\n  \x1b[1mResult: ${passed}/${total} passed\x1b[0m${failed > 0 ? `  \x1b[31m(${failed} failed)\x1b[0m` : ""}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
