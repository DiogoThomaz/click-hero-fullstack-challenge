import { describe, expect, it } from "vitest";
import { violationSchema } from "./violation.entity.js";

const validPayload = {
  adId: "ad-123",
  tenantId: "tenant-456",
  violationType: "PROHIBITED_TERM",
  severity: "HIGH",
  detectedAt: "2025-01-01T00:00:00.000Z",
};

describe("violationSchema", () => {
  it("accepts a valid payload", () => {
    const result = violationSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects missing adId", () => {
    const result = violationSchema.safeParse({ ...validPayload, adId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing tenantId", () => {
    const { adId, ...withoutTenant } = validPayload;
    const result = violationSchema.safeParse(withoutTenant);
    expect(result.success).toBe(false);
  });

  it("rejects invalid violationType", () => {
    const result = violationSchema.safeParse({ ...validPayload, violationType: "INVALID" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid severity", () => {
    const result = violationSchema.safeParse({ ...validPayload, severity: "URGENT" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid detectedAt", () => {
    const result = violationSchema.safeParse({ ...validPayload, detectedAt: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("rejects empty body", () => {
    const result = violationSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
