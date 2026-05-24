---
name: backend-bullmq
description: "Use when building or modifying backend microservices with BullMQ, Redis queues, and Express. Covers queue/worker separation, Docker Compose with API+Worker containers, idempotency, retry/backoff, Zod validation patterns, and load testing. Also use when working with files under src/queue/, src/jobs/, src/worker.ts, scripts/teste-carga.sh, or docker-compose.yml with multiple services."
---

# Backend com BullMQ + Microserviços

## Arquitetura

Separação clara entre API (produtor) e Worker (consumidor), ambos conectados ao mesmo Redis.

```
curl POST /webhook/violation
  → api (Express:3000)
    → enqueueTakedown() → Redis (BullMQ)
      → worker (container separado)
        → takedownHandler → fetch external API
          → completed / failed (retry automático)
```

**Princípios:**
- API nunca processa jobs — só enfileira e consulta status
- Worker nunca expõe porta HTTP — só processa fila
- Redis é o único ponto de acoplamento
- Cada container escala independentemente

## BullMQ Setup

### Conexão Redis

```ts
import IORedis from "ioredis";

const connection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null, // obrigatório para BullMQ
});
```

### Queue + Worker

```ts
import { Queue, Worker } from "bullmq";

export const queue = new Queue("my-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const worker = new Worker("my-queue", handler, { connection });
```

### Enfileirar com idempotência

```ts
await queue.add("job-name", data, {
  deduplication: { id: `${data.id}:${data.tenantId}` },
});
```

A deduplication key impede que o mesmo par `id:tenantId` crie jobs duplicados enquanto o job original existir na fila.

### Consultar job

```ts
const job = await queue.getJob(jobId);
const state = await job.getState(); // waiting | active | completed | failed
```

## Separação API / Worker

### `src/index.ts` — API (só enfileira)

```ts
import { queue } from "./queue/my-queue.js";

// Express routes — enfileiram jobs, nunca processam
app.post("/webhook", async (req, res) => {
  const job = await queue.add("takedown", req.body);
  res.status(202).json({ jobId: job.id });
});
```

### `src/worker.ts` — Worker (só processa)

```ts
import { worker } from "./queue/my-queue.js";

worker.on("completed", (job) => console.log(`Job ${job.id} completed`));
worker.on("failed", (job, err) => console.error(`Job ${job?.id} failed: ${err.message}`));
```

### Docker Compose

```yaml
services:
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build: .
    ports: ["3000:3000"]
    environment: [REDIS_HOST=redis]
    depends_on: { redis: { condition: service_healthy } }
    command: ["node", "--import", "tsx", "src/index.ts"]

  worker:
    build: .
    environment: [REDIS_HOST=redis]
    depends_on: { redis: { condition: service_healthy } }
    command: ["node", "--import", "tsx", "src/worker.ts"]
```

### Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
CMD ["node", "--import", "tsx", "src/index.ts"]
```

Use `command` no docker-compose para alternar entre api e worker com a mesma imagem.

## Retry & Backoff

Configurado via `defaultJobOptions` na Queue (afeta todos os jobs) ou por job.

```ts
// Exponencial: delay * (2 ^ attempt), máx 3 tentativas
backoff: { type: "exponential", delay: 5000 }
// → attempt 0: 5s, attempt 1: 10s, attempt 2: 20s

// Fixed: mesmo delay sempre
backoff: { type: "fixed", delay: 10000 }
```

O Worker lança `Error` para acionar retry automático. Se não lançar erro, o job é marcado como completed.

```ts
export async function handler(job: Job<Data>) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { success: true };
}
```

## Validação com Zod

Schema como única fonte de verdade — tipos são inferidos, nunca duplicados.

```ts
import { z } from "zod";

export const mySchema = z.object({
  id: z.string().min(1),
  type: z.enum(["FOO", "BAR"]),
  timestamp: z.string().datetime(),
});

export type MyPayload = z.infer<typeof mySchema>; // sem interface manual
```

Validação no handler:

```ts
const parsed = mySchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({
    error: "Invalid payload",
    details: parsed.error.flatten().fieldErrors,
  });
}
```

## Error Handling

### Middleware global Express

```ts
import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
```

### Semântica HTTP

| Situação | Status |
|---|---|
| Payload inválido | 400 + `{ error, details }` |
| Job enfileirado | 202 + `{ jobId }` |
| Job não encontrado | 404 + `{ error }` |
| Erro interno | 500 + `{ error }` |

## Testes

### E2E (`scripts/test-api.js`)

Testa fluxo completo com fetch nativo:

```js
const res = await fetch(`${BASE_URL}/webhook/violation`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
```

Cenários: payload válido (202), erros de validação (400), idempotência, concorrência (20 paralelas), job status flow (polling até completed).

### Carga (`scripts/teste-carga.sh`)

```bash
bash scripts/teste-carga.sh
# ou: TOTAL=500 PARALLEL=10 bash scripts/teste-carga.sh
```

- 1000 requisições (50% válidas, 50% inválidas)
- Payloads variados (todos os enums de violationType e severity, 6 tipos de erro)
- 20 requisições paralelas por vez
- Consulta amostra de jobs ao final
- Gera `relatorio-carga.txt`

## TypeScript

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

- Sem `any` — usar `z.infer` para tipos de payload
- Sem `as` casts — preferir type guards ou `satisfies`
- Sem `!` non-null assertions — usar early return ou fallback

## Referências no projeto

| Arquivo | Propósito |
|---|---|
| `src/queue/takedown.queue.ts` | Queue + Worker + idempotência |
| `src/jobs/takedown.handler.ts` | Worker com timeout e retry |
| `src/index.ts` | Express + Bull Board |
| `src/worker.ts` | Entry point do Worker |
| `src/schemas/violation.schema.ts` | Zod schema + tipos inferidos |
| `src/config/env.ts` | Variáveis de ambiente validadas |
| `docker-compose.yml` | 3 serviços: redis, api, worker |
| `Dockerfile` | Imagem Node Alpine |
| `scripts/test-api.js` | Testes E2E |
| `scripts/teste-carga.sh` | Teste de carga |
| `src/routes/webhook.routes.ts` | Rota POST com validação |
| `src/routes/job.routes.ts` | Rota GET de consulta |
| `src/middleware/error-handler.ts` | Erro global |
