---
name: backend-senior
description: "Use when generating or reviewing backend code that needs to meet senior-level quality standards. Covers architectural patterns, SOLID, error handling strategies, performance, security, observability, testing strategy, API design, production hardening, and code review. Triggered by keywords: senior, architecture, production, performance, scalability, SOLID, clean code, design patterns, code review, technical debt, observability, hardening."
---

# Backend Sênior — Padrões e Decisões Arquiteturais

## Mindset Sênior

- Cada linha de código é uma responsabilidade. Cada dependência é um custo.
- Código não é feito para funcionar — é feito para **ser mantido**.
- Toda decisão envolve **trade-offs**. Conheça o custo de cada padrão antes de aplicá-lo.
- Um sênior não só resolve problemas — ele **previne** que problemas existam.
- Código é lido 10× mais do que é escrito. Otimize para **legibilidade** primeiro.

## SOLID no Node.js

### SRP — Single Responsibility Principle

Cada módulo tem exatamente **um motivo para mudar**.

```ts
// ❌ Errado: controller faz validação + orquestração + persistência
async function handler(req, res) {
  const { error } = validate(req.body);
  if (error) return res.status(400).json(error);
  await saveToDb(req.body);
  await notify(req.body.tenantId);
  res.json({ ok: true });
}

// ✅ Correto: separado por responsabilidade
// routes/ → roteamento
// schemas/ → validação
// services/ → orquestração
// repositories/ → persistência
```

### DIP — Dependency Inversion Principle

Dependa de abstrações, não de implementações concretas.

```ts
// ❌ Acoplamento direto
import { RedisCache } from "./redis.js";

// ✅ Abstração + injeção
interface Cache { get(key: string): Promise<string | null>; set(key: string, value: string, ttl?: number): Promise<void> }
class RedisCache implements Cache { /* ... */ }
class InMemoryCache implements Cache { /* ... */ }
```

### Aplicação prática na estrutura

```
src/
├── routes/            # Roteamento — só conecta URL → handler
├── handlers/          # Orquestração — coordena serviços
├── services/          # Lógica de negócio — sem dependência HTTP
├── repositories/      # Acesso a dados — abstrai Redis/DB
├── schemas/           # Validação — Zod
├── middleware/        # Cross-cutting — auth, logging, error
└── config/            # Setup — DI container, env
```

**Projeto atual** (`src/routes/` + `src/queue/` + `src/jobs/`): já segue SRP. Routes só roteiam, queue configura fila, jobs executam lógica.

## Error Handling Estratégico

### Classifique erros

```ts
class DomainError extends Error { /* erros de négocio: "adId já processado" */ }
class OperationalError extends Error { /* erros operacionais: "Redis indisponível" */ }
class ProgrammingError extends Error { /* bugs: "Cannot read property of undefined" */ }
```

| Tipo | Ação | HTTP |
|---|---|---|
| DomainError | Retornar erro semântico (400/404) | Previsível, informar cliente |
| OperationalError | Retry + alerta | Pode ser temporário |
| ProgrammingError | Crash + log urgente | Bug, deve ser corrigido |

### Result Type Pattern (alternativa a exceptions)

```ts
type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };

async function processAd(adId: string): Promise<Result<Ad, DomainError>> {
  if (!isValid(adId)) return { success: false, error: new DomainError("Invalid ad") };
  return { success: true, data: await fetchAd(adId) };
}
```

### Graceful Error Middleware

```ts
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof DomainError) return res.status(400).json({ error: err.message });
  if (err instanceof OperationalError) {
    logger.error({ err, type: "operational" });
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }
  logger.fatal({ err, type: "programming" });
  res.status(500).json({ error: "Internal server error" });
};
```

## Idempotência & Concorrência

### Idempotency Key (HTTP)

```ts
// Client envia header Idempotency-Key
// Servidor usa `SET key NX EX 86400` no Redis
// Se key existe, retorna resposta cacheada
```

### Distributed Lock (Redis Redlock)

```ts
// BullMQ já faz isso via deduplication
// Para casos manuais:
const lock = await redis.set(`lock:${resourceId}`, "1", "NX", "EX", 30);
if (!lock) throw new Error("Resource locked, retry later");
```

### Race Conditions em filas

```ts
// ❌ Job lê estado, decide ação, escreve — race condition
// ✅ Usar atomically: BullMQ deduplication é atômica
// ✅ Redis Lua scripts para operações atômicas
```

## Performance

### Connection Pooling

```ts
// Redis (ioredis):
// ioredis já faz pooling automaticamente
// Uma instância por processo é suficiente

// PostgreSQL (pg):
const pool = new Pool({ max: 20, idleTimeoutMillis: 30000 });
```

### Caching Strategies

```ts
// Cache-aside (lazy loading)
async function getAd(id: string) {
  const cached = await cache.get(`ad:${id}`);
  if (cached) return JSON.parse(cached);
  const ad = await db.findAd(id);
  await cache.set(`ad:${id}`, JSON.stringify(ad), 3600);
  return ad;
}

// Write-through
async function saveAd(ad: Ad) {
  await db.saveAd(ad);
  await cache.set(`ad:${ad.id}`, JSON.stringify(ad), 3600);
}
```

### Streaming para payloads grandes

```ts
// Ao invés de JSON inteiro em memória:
res.json(hugeArray);           // ❌ explode memória
for (const item of generator()) { // ✅ streaming
  if (index === 0) res.write("[");
  else res.write(",");
  res.write(JSON.stringify(item));
}
res.write("]");
res.end();
```

### N+1 Prevention

```ts
// ❌ N+1: forEach faz query dentro de query
const ads = await db.findAdsByTenant(tenantId);
for (const ad of ads) {
  const metrics = await db.findMetricsByAd(ad.id); // N queries!
}

// ✅ JOIN ou batch
const ads = await db.findAdsWithMetrics(tenantId); // 1 query
```

## Observabilidade

### Structured Logging

```ts
// ❌ console.log("Processando", adId, "para tenant", tenantId)
// ✅ Com correlação:
logger.info({ adId, tenantId, attempt: job.attemptsMade }, "Processing takedown");

// Sempre incluir:
// - requestId / correlationId
// - userId / tenantId
// - operation name
// - duration (se aplicável)
// - error stack trace (se erro)
```

```bash
npm install pino
```

```ts
import pino from "pino";
export const logger = pino({
  level: env.LOG_LEVEL ?? "info",
  transport: env.isDev ? { target: "pino-pretty" } : undefined,
});
```

### Métricas

```ts
// BullMQ já expõe métricas via eventos:
worker.on("completed", (job) => metrics.counter("job.completed", 1, { queue: job.queueName }));
worker.on("failed", (job, err) => metrics.counter("job.failed", 1, { error: err.name }));

// Prometheus + grafana para dashboards
```

### Distributed Tracing

```ts
// Correlação entre API e Worker:
// API gera traceId no header da request
// Worker propaga traceId via job.data

const traceId = crypto.randomUUID();
await queue.add("takedown", { ...data, traceId });
// Worker loga com mesmo traceId
```

## Segurança Avançada

### OWASP Top 10

Checklist:
- ✅ **Input validation** — Zod em todos os endpoints
- ⚠️ **Authentication** — JWT com refresh token ou sessions HTTP-only
- ⚠️ **Authorization** — RBAC por tenantId, verificar em toda operação
- ✅ **Error handling** — sem stack traces em respostas (já implementado)
- ⚠️ **Rate limiting** — `express-rate-limit` em POST endpoints
- ⚠️ **Security headers** — `helmet` middleware
- ⚠️ **CSRF** — se usar cookies, SameSite=Strict + CSRF token
- ⚠️ **Dependencies** — `npm audit` regular, Dependabot, Snyk

```bash
npm install helmet express-rate-limit
```

```ts
import helmet from "helmet";
import rateLimit from "express-rate-limit";

app.use(helmet());
app.use("/webhook", rateLimit({ windowMs: 60_000, max: 30 }));
app.use(express.json({ limit: "1mb" }));
```

### JWT Best Practices

```ts
// ❌ JWT sem expiração, sem audience
// ✅ JWT com:
{
  sub: userId,
  tenantId: "tenant-123",
  iat: Date.now(),
  exp: Date.now() + 900, // 15 min
  aud: "fury-api",
  iss: "fury-auth",
}
// Sem secrets no código — usar env vars
// Preferir refresh tokens HTTP-only para renovação
```

## Testing Strategy

### Pirâmide de Testes aplicada

```
    ╱╲
   ╱ E2E ╲          ← 10% — fluxos críticos completos
  ╱───────╲
 ╱ Integration ╲    ← 30% — API + DB + Redis juntos
╱───────────────╲
╱   Unit Tests    ╲ ← 60% — schemas, handlers, services isolados
╱───────────────────╲
```

### O que testar em cada camada

| Camada | O que testar | Mock? |
|---|---|---|
| Schemas (Zod) | Payloads válidos/inválidos, edge cases, enum values | Não |
| Handlers | Lógica de negócio isolada | Sim (repository) |
| Routes | Status code, response shape, validação | Sim (services) |
| Integration | Fluxo completo HTTP → Redis → Worker | Redis real (testcontainers) |
| E2E | Fluxo crítico ponta-a-ponta | Ambiente real |

### Testes de Contrato

```ts
// Garantir que a resposta da API não muda sem querer
it("returns expected shape for GET /jobs/:id", async () => {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}`);
  expect(res.status).toBe(200);
  expect(res.json()).toMatchObject({
    jobId: expect.any(String),
    status: expect.stringMatching(/^(completed|failed|active|waiting)$/),
    attempts: expect.any(Number),
    result: expect.anything(),
    error: expect.any(String),
  });
});
```

## API Design

### Versionamento

```ts
// URL: /v1/webhook/violation — simples e explícito
// Header: Accept: application/vnd.fury.v1+json — mais elegante, mais complexo
```

### RESTful Best Practices

```ts
POST   /webhook/violation     // ação → 202 (aceito)
GET    /jobs/:id              // recurso → 200/404
GET    /jobs?status=failed    // listagem → paginação
POST   /bulk/takedown         // ação em lote
```

### Paginação, Filtering, Sorting

```ts
// Request:
GET /jobs?page=2&per_page=20&status=completed&sort=createdAt:desc

// Response:
{
  data: [...],
  meta: { page: 2, per_page: 20, total: 150, total_pages: 8 },
  links: { self: "...", first: "...", next: "...", prev: "..." }
}
```

## Production Hardening

### Graceful Shutdown

```ts
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully");
  server.close();
  await worker.close();
  await queue.close();
  redis.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

### Health Check Endpoint

```ts
app.get("/health", async (req, res) => {
  const checks = {
    redis: await redis.ping().then(() => true).catch(() => false),
    api: true,
  };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});
```

### Circuit Breaker

```ts
// Para chamadas externas (ex: Meta API)
// Se falhar X vezes em Y tempo, para de chamar por Z tempo
// npm i opossum

import CircuitBreaker from "opossum";

const breaker = new CircuitBreaker(fetchMetaApi, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

breaker.fallback(() => ({ success: false, status: 503 }));
```

## Code Review Checklist Sênior

Antes de aprovar qualquer PR, verificar:

- [ ] **Segurança**: input validation em todo endpoint? Secrets no código? SQL injection?
- [ ] **Performance**: N+1 queries? Payload muito grande sem streaming? Cache ausente?
- [ ] **Manutenibilidade**: Nomes claros? Funções < 30 linhas? SRP respeitado?
- [ ] **Testabilidade**: Lógica de negócio testável isoladamente? Mocks desnecessários?
- [ ] **Tratamento de erros**: Erros não capturados? Mensagens vagas? Stack trace vazando?
- [ ] **Idempotência**: Operações não-idempotentes podem causar duplicação?
- [ ] **Logging**: Informação suficiente para debug sem expor dados sensíveis?
- [ ] **Documentação**: README atualizado? Endpoints documentados? Decisões registradas?

## Referências no projeto

| Arquivo | Propósito |
|---|---|
| `src/config/env.ts` | Validação de ambiente com Zod |
| `src/routes/webhook.routes.ts` | SRP: rota só roteia |
| `src/routes/job.routes.ts` | SRP: rota só consulta |
| `src/middleware/error-handler.ts` | Error handling global |
| `src/queue/takedown.queue.ts` | Idempotência via deduplication |
| `src/jobs/takedown.handler.ts` | Retry + timeout + graceful error |
| `src/index.ts` | Express setup — falta graceful shutdown |
| `docker-compose.yml` | Docker Compose — falta healthcheck endpoint |
| `scripts/test-api.js` | E2E tests — bom, mas sem teste de contrato |
| `scripts/teste-carga.sh` | Load test — cobre concorrência |
