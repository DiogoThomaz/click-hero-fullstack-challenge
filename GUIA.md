# Guia de Desenvolvimento — FURY Click Hero

Este guia cobre dois temas complementares:

1. **Guia prático**: como trabalhar no projeto, adicionar funcionalidades, rodar testes e depurar.
2. **Conceitos técnicos**: explicação dos padrões e tecnologias usados, com exemplos do código real.

Para entender a estrutura de pastas e as regras de dependência, leia também [ARQUITETURA.md](./ARQUITETURA.md).

---

## Parte 1 — Guia Prático

### Configuração do ambiente

```bash
# Clonar e instalar dependências
git clone <repositório>
cd click-hero-fullstack-desafio
npm install

# Subir Redis local
docker compose up -d redis

# Iniciar API e Worker em terminais separados
npm run dev           # Terminal 1: API em :3000 com hot-reload
npm run start:worker  # Terminal 2: Worker BullMQ
```

> A API e o Worker são processos independentes. A API apenas valida e enfileira — ela nunca processa jobs. O Worker é o único que chama a Meta API.

---

### Como adicionar um novo caso de uso

Siga essa sequência exata. Não pule etapas.

**Exemplo**: adicionar um caso de uso `CancelTakedownUseCase`.

---

**Passo 1 — Defina a entidade (se necessário)**

Se o novo caso de uso precisar de novos dados, adicione um schema Zod em `core/entities/`:

```typescript
// src/core/entities/cancel-request.entity.ts
import { z } from "zod";

export const cancelRequestSchema = z.object({
  jobId: z.string().min(1),
  reason: z.string().min(1),
});

export type CancelRequest = z.infer<typeof cancelRequestSchema>;
```

Se os dados já existem em uma entidade existente, reutilize.

---

**Passo 2 — Atualize a interface do repositório (se necessário)**

Se o caso de uso precisa de uma operação nova na fila/persistência, adicione o método na interface:

```typescript
// src/core/repositories/takedown-job-queue.repository.ts
export interface TakedownJobQueueRepository {
  enqueue(input: TakedownJobData): Promise<string>;
  getStatus(jobId: string): Promise<JobStatus | null>;
  cancel(jobId: string): Promise<boolean>;   // ← novo método
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}
```

---

**Passo 3 — Implemente o caso de uso**

```typescript
// src/core/usecases/cancel-takedown.usecase.ts
import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";

export class CancelTakedownUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}

  async execute(jobId: string): Promise<boolean> {
    return this.queue.cancel(jobId);
  }
}
```

---

**Passo 4 — Escreva o spec com implementação in-memory**

```typescript
// src/core/usecases/cancel-takedown.usecase.spec.ts
import { describe, expect, it } from "vitest";
import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";

class InMemoryQueue implements TakedownJobQueueRepository {
  private readonly cancelled = new Set<string>();

  async enqueue() { return "job-1"; }
  async getStatus() { return null; }
  async cancel(jobId: string) {
    this.cancelled.add(jobId);
    return true;
  }
  async isHealthy() { return true; }
  async close() {}
}

describe("CancelTakedownUseCase", () => {
  it("cancels the job through the queue repository", async () => {
    const useCase = new CancelTakedownUseCase(new InMemoryQueue());
    await expect(useCase.execute("job-1")).resolves.toBe(true);
  });
});
```

---

**Passo 5 — Implemente o método no adapter BullMQ**

```typescript
// src/external/bullmq/takedown-bullmq.adapter.ts
async cancel(jobId: string): Promise<boolean> {
  const job = await this.queue.getJob(jobId);
  if (!job) return false;
  await job.remove();
  return true;
}
```

---

**Passo 6 — Exponha via rota**

```typescript
// src/external/api/routes/job.routes.ts
router.delete("/:id", async (req, res, next) => {
  try {
    const useCase = new CancelTakedownUseCase(queue);   // ← recebe queue como parâmetro da rota
    const cancelled = await useCase.execute(req.params.id);

    if (!cancelled) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.status(200).json({ cancelled: true });
  } catch (error) {
    next(error);
  }
});
```

---

### Como trocar o adapter de fila (ex.: BullMQ → SQS)

1. Crie `src/external/sqs/takedown-sqs.adapter.ts`.
2. Implemente `TakedownJobQueueRepository` usando o SDK da AWS SQS.
3. Em `src/main.ts`, substitua:
   ```typescript
   // antes
   const queue = new BullMqTakedownJobQueue(takedownQueue, redisConnection);
   // depois
   const queue = new SqsTakedownJobQueue({ region: "us-east-1", queueUrl: env.SQS_URL });
   ```
4. Nenhum arquivo em `core/` é alterado.

---

### Como rodar os testes

```bash
# Unitários (sem infra — roda em < 2s)
npm test

# Modo watch durante desenvolvimento
npm run test:watch

# E2E (requer API + Worker rodando e Redis acessível)
docker compose up -d
npm run test:e2e

# Carga: 1000 requisições, 20 paralelas, relatório em relatorio-carga.txt
npm run test:carga
```

O que cada suite valida:

| Suite | O que testa | Precisa de infra? |
|---|---|---|
| `*.spec.ts` (Vitest) | Use cases com fakes in-memory, entities Zod, adapter HTTP com fetch stubado | Não |
| `scripts/test-api.js` | Fluxo HTTP completo: 202, 400, 404, idempotência, status do job | Sim (API + Redis) |
| `scripts/teste-carga.sh` | Throughput, erros HTTP, consulta de status sob carga | Sim (API + Redis) |

---

### Como depurar um job

**1. Verificar status via API:**

```bash
curl http://localhost:3000/jobs/<jobId>
```

Resposta com `status: "failed"` terá o campo `error` preenchido com o motivo da falha.

**2. Inspecionar via Bull Board:**

Abra `http://localhost:3000/admin/queues` no browser. O dashboard mostra jobs em cada estado (waiting, active, completed, failed, delayed) com payload e detalhes de erro.

**3. Acompanhar logs do Worker:**

```bash
docker compose logs -f worker
# ou localmente:
npm run start:worker
```

O Worker loga cada tentativa de processamento:
```
Processing takedown for adId=ad-123, tenantId=tenant-456 (attempt 1)
Takedown successful for adId=ad-123, tenantId=tenant-456
```

**4. Simular falha no Worker:**

Altere `META_API_URL` no `docker-compose.yml` para um endpoint que retorna 500 para observar o comportamento de retry e backoff:

```yaml
environment:
  - META_API_URL=https://httpstat.us/500
```

---

### Checklist antes de fazer commit

```bash
# 1. Type check — zero erros
npx tsc --noEmit

# 2. Lint — zero erros ou warnings
npx biome check src/

# 3. Testes — todos passando
npm test
```

Nenhum `any`, `as`, `!` não-null, variável não usada ou `console.log` em código de produção sem justificativa.

---

## Parte 2 — Conceitos Técnicos

### Arquitetura Hexagonal (Ports and Adapters)

**O problema que resolve:** em aplicações tradicionais, regras de negócio ficam misturadas com frameworks. Testar a lógica exige subir Express, conectar Redis, fazer chamadas HTTP reais. Isso torna os testes lentos, frágeis e dependentes de infraestrutura.

**A solução:** separar o núcleo da aplicação (`core/`) de tudo que é detalhe de implementação (`external/`). O núcleo fala apenas em interfaces — não sabe se a fila é BullMQ ou SQS, não sabe se o HTTP é `fetch` ou `axios`.

```
               ┌──────────────────────┐
               │        core/         │
               │  (regras de negócio) │
               │  só conhece          │
               │  interfaces          │
               └──────────┬───────────┘
                          │ implementado por
          ┌───────────────▼───────────────┐
          │          external/            │
          │  (BullMQ, Redis, Express,     │
          │   fetch — detalhes concretos) │
          └───────────────────────────────┘
```

**No código deste projeto:**

```typescript
// core/usecases/enqueue-takedown.usecase.ts
// Este arquivo NÃO sabe o que é BullMQ. Só sabe que existe uma "fila"
// com um método enqueue(). Quem implementa é responsabilidade de external/.

export class EnqueueTakedownUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}

  async execute(input: TakedownJobData): Promise<string> {
    return this.queue.enqueue(input);
  }
}
```

---

### Inversão de Dependência (DIP — SOLID)

**Definição:** módulos de alto nível não devem depender de módulos de baixo nível. Ambos devem depender de abstrações.

**Errado (acoplamento direto):**

```typescript
// ❌ UseCase sabe que existe BullMQ — se trocar a fila, precisa alterar o usecase
import { Queue } from "bullmq";

class EnqueueTakedownUseCase {
  constructor(private readonly queue: Queue) {}
}
```

**Correto (inversão de dependência):**

```typescript
// ✅ UseCase depende de uma interface — qualquer implementação funciona
import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";

class EnqueueTakedownUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}
}
```

Isso permite testar o use case com uma implementação in-memory e trocar a infraestrutura sem alterar lógica de negócio.

---

### BullMQ — Filas, Workers e Retry

**O que é:** BullMQ é uma biblioteca de filas baseada em Redis. Permite enfileirar jobs para processamento assíncrono, com suporte a retry, backoff, agendamento e deduplicação.

**Conceitos principais:**

| Conceito | Descrição |
|---|---|
| **Queue** | Canal nomeado onde jobs são adicionados. Vive na API. |
| **Worker** | Processo que consome a Queue e executa o handler de cada job. Vive no `worker.ts`. |
| **Job** | Unidade de trabalho com payload (`job.data`), estado e histórico de tentativas. |
| **Retry** | Quando o handler lança exceção, BullMQ recoloca o job na fila até o máximo de tentativas. |
| **Backoff exponencial** | Intervalo entre tentativas cresce exponencialmente: 5s, 25s, 125s. |
| **Deduplicação** | Chave única que impede dois jobs idênticos simultâneos na fila. |

**No código deste projeto:**

```typescript
// external/bullmq/takedown-bullmq.adapter.ts

// Configuração da fila: 3 tentativas, backoff exponencial, limpeza automática
export function createTakedownQueue(connection: IORedis): Queue<TakedownJobData> {
  return new Queue(TAKEDOWN_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
}

// Deduplicação: mesmo adId+tenantId nunca gera dois jobs simultâneos
async enqueue(input: TakedownJobData): Promise<string> {
  const deduplicationId = `${input.adId}:${input.tenantId}`;
  const job = await this.queue.add("takedown", input, {
    deduplication: { id: deduplicationId },
  });
  return job.id!;
}
```

**Por que processos separados?** A API precisa responder em milissegundos. Se a chamada HTTP à Meta API travar por 5s (ou falhar), a API não pode ficar bloqueada. O Worker processa em background, de forma independente.

---

### Zod — Validação e Fonte Única de Tipos

**O problema que resolve:** é comum ter uma interface TypeScript e um schema de validação separados que acabam saindo de sincronia. Se o schema muda, o tipo fica desatualizado — ou vice-versa.

**A solução:** definir o schema Zod como a fonte única de verdade e **inferir** o tipo TypeScript a partir dele.

```typescript
// ❌ Errado: interface e schema duplicados — podem divergir
interface ViolationPayload {
  adId: string;
  tenantId: string;
  violationType: "PROHIBITED_TERM" | "BRAND_VIOLATION" | "COMPLIANCE_FAIL";
}
const schema = z.object({ adId: z.string(), tenantId: z.string(), ... });

// ✅ Correto: schema é a fonte única, tipo é inferido
export const violationSchema = z.object({
  adId: z.string().min(1, "adId is required"),
  tenantId: z.string().min(1, "tenantId is required"),
  violationType: z.enum(["PROHIBITED_TERM", "BRAND_VIOLATION", "COMPLIANCE_FAIL"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  detectedAt: z.string().datetime(),
});

export type ViolationPayload = z.infer<typeof violationSchema>;  // ← inferido automaticamente
```

**Na rota:** `safeParse` valida sem lançar exceção e retorna erros estruturados:

```typescript
const parsed = violationSchema.safeParse(req.body);

if (!parsed.success) {
  // parsed.error.flatten().fieldErrors → { adId: ["adId is required"], ... }
  res.status(400).json({
    error: "Invalid payload",
    details: parsed.error.flatten().fieldErrors,
  });
  return;
}
// parsed.data é TypeScript tipado e validado
```

---

### Idempotência

**O que é:** a mesma operação executada múltiplas vezes produz o mesmo resultado que executá-la uma vez. Essencial para webhooks, onde a fonte pode reenviar a mesma notificação em caso de timeout ou falha.

**No código deste projeto:** o BullMQ recebe uma `deduplication.id` no momento de enfileirar. Se um job com aquela chave já existe (em qualquer estado ativo), o BullMQ retorna o job existente em vez de criar um novo.

```typescript
const job = await this.queue.add("takedown", input, {
  deduplication: { id: `${input.adId}:${input.tenantId}` },
});
// Mesma chamada com adId="ad-123" + tenantId="t-456" sempre retorna o mesmo jobId
```

**Por que `adId:tenantId`?** Um anúncio de um tenant específico não deveria ter dois takedowns paralelos. A combinação dos dois campos forma um identificador único de contexto de negócio.

---

### AbortController e Timeout

**O problema:** `fetch` nativo não tem timeout embutido. Uma chamada a uma API externa pode travar indefinidamente, segurando o Worker e impedindo o processamento de outros jobs.

**A solução:** `AbortController` permite cancelar uma requisição `fetch` após um tempo limite:

```typescript
async requestTakedown(input: TakedownJobData): Promise<MetaApiResponse> {
  const controller = new AbortController();
  // Agenda o abort após timeoutMs milissegundos
  const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

  try {
    const response = await fetch(this.config.url, {
      signal: controller.signal,   // ← fetch observa o sinal
    });

    if (!response.ok) {
      throw new Error(`Meta API returned status ${response.status}`);
    }

    return { status: response.status };
  } catch (error) {
    // AbortError indica que foi o nosso timeout — traduzimos para mensagem clara
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Meta API request timed out");
    }
    throw error;  // outros erros propagam para o BullMQ fazer retry
  } finally {
    clearTimeout(timeout);  // ← sempre limpa o timer, mesmo em caso de sucesso
  }
}
```

**Por que relançar o erro?** O BullMQ só faz retry quando o handler lança exceção. Se engolirmos o erro, o BullMQ considera o job como concluído com sucesso — o que seria incorreto.

---

### Graceful Shutdown

**O problema:** quando um container recebe `SIGTERM` (sinal de encerramento), processos que terminam abruptamente podem:
- Perder jobs que estavam sendo processados
- Deixar conexões Redis abertas
- Deixar o HTTP server recusando novas conexões antes de terminar as em andamento

**A solução:** interceptar os sinais e encerrar os recursos na ordem correta:

```typescript
// src/main.ts
async function shutdown(signal: string): Promise<void> {
  // 1. Para de aceitar novas conexões HTTP
  server.close(async (error) => {
    // 2. Fecha a fila e a conexão Redis
    await queue.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
```

```typescript
// src/external/worker/index.ts
async function shutdown(signal: string): Promise<void> {
  // 1. Aguarda o job atual terminar, para de pegar novos
  await worker.close();
  // 2. Fecha a conexão Redis
  await takedownJobQueue.close();
  process.exit(0);
}
```

---

### TypeScript Strict Mode

O `tsconfig.json` usa `"strict": true` mais flags adicionais que previnem classes inteiras de bugs:

| Flag | O que previne |
|---|---|
| `strict: true` | `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` e outros |
| `noUncheckedIndexedAccess` | Acesso `array[i]` retorna `T \| undefined` — força verificação de bounds |
| `noUnusedLocals` | Variáveis declaradas mas não usadas viram erro de compilação |
| `noUnusedParameters` | Parâmetros não usados viram erro — `_` prefix para exceções explícitas |
| `exactOptionalPropertyTypes` | `{ a?: string }` não aceita `{ a: undefined }` — distinção explícita |

**Sem `any`:** quando o tipo é genuinamente desconhecido, use `unknown` + type guard:

```typescript
// ❌ Apaga o sistema de tipos
function process(data: any) { ... }

// ✅ Força verificação antes de usar
function process(data: unknown) {
  if (typeof data === "string") {
    // aqui TypeScript sabe que data é string
  }
}
```

---

### Separação de Processos vs. Threads

A API e o Worker rodam em **processos Node.js separados** (não threads). Isso significa:

- **Isolamento de falha**: crash no Worker não derruba a API, e vice-versa.
- **Escala independente**: em produção, poderia haver 1 instância da API e 5 Workers.
- **Nenhum estado compartilhado em memória**: toda comunicação passa pelo Redis (via BullMQ).
- **Restart independente**: o `docker-compose.yml` reinicia cada container sem afetar o outro.

No Docker Compose, isso é expresso como dois serviços distintos com o mesmo Dockerfile mas comandos diferentes:

```yaml
api:
  image: ghcr.io/diogothomaz/click-hero-api:v0.0.0
  command: ["node", "dist/main.js"]

worker:
  image: ghcr.io/diogothomaz/click-hero-worker:v0.0.0
  command: ["node", "dist/worker.js"]
```
