# Arquitetura — FURY Click Hero

## Visão geral

O projeto segue a **arquitetura hexagonal (Ports and Adapters)**, onde o núcleo da aplicação (`core/`) é completamente independente de qualquer tecnologia, framework ou infraestrutura. Frameworks como Express e BullMQ, e clientes como Redis e fetch, ficam isolados em `external/`.

Essa separação garante três propriedades fundamentais:

1. **Testabilidade**: os casos de uso são testados com implementações in-memory sem Docker, Redis ou rede.
2. **Substituibilidade**: trocar BullMQ por SQS, ou Redis por outro broker, não toca nenhuma linha do `core/`.
3. **Clareza de responsabilidade**: cada camada tem um contrato explícito e não ultrapassa seus limites.

---

## Estrutura de pastas

```
src/
├── main.ts                              # Entrypoint da API
├── worker.ts                            # Entrypoint do Worker
├── config/
│   └── env.ts                           # Variáveis de ambiente (Zod)
│
├── core/                                # Núcleo — zero dependência de frameworks
│   ├── entities/                        # Schemas Zod e tipos do domínio
│   │   ├── violation.entity.ts
│   │   ├── violation.entity.spec.ts
│   │   └── takedown-job.entity.ts
│   ├── repositories/                    # Interfaces de acesso a dados/fila
│   │   └── takedown-job-queue.repository.ts
│   ├── services/                        # Interfaces de operações externas
│   │   ├── meta-api-client.service.ts
│   │   └── health-check.service.ts
│   └── usecases/                        # Orquestração da lógica de negócio
│       ├── enqueue-takedown.usecase.ts
│       ├── enqueue-takedown.usecase.spec.ts
│       ├── get-job-status.usecase.ts
│       ├── process-takedown.usecase.ts
│       ├── process-takedown.usecase.spec.ts
│       └── get-health.usecase.ts
│
└── external/                            # Integrações — implementam interfaces do core
    ├── redis/
    │   └── connection.ts                # Fábrica de conexão IORedis
    ├── bullmq/
    │   ├── takedown-bullmq.adapter.ts   # Implementa TakedownJobQueueRepository
    │   ├── fetch-meta-api.client.ts     # Implementa MetaApiClientService
    │   └── fetch-meta-api.client.spec.ts
    ├── worker/
    │   └── index.ts                     # startWorker(): processo BullMQ Worker
    └── api/
        ├── index.ts                     # createApp(): Express + Bull Board
        ├── routes/
        │   ├── webhook.routes.ts
        │   ├── job.routes.ts
        │   └── health.routes.ts
        └── middleware/
            ├── error-handler.ts
            └── not-found.ts
```

---

## Camadas e responsabilidades

### `core/entities/`

Contém os **schemas Zod** que definem os contratos de dados do domínio. Os tipos TypeScript são inferidos diretamente dos schemas — sem interfaces manuais duplicadas.

```
violation.entity.ts     → ViolationPayload, ViolationType, Severity
takedown-job.entity.ts  → TakedownJobData, JobStatus
```

**Regra:** entities não importam nada de `external/`. Podem importar apenas `zod`.

---

### `core/repositories/`

Interfaces que definem como a aplicação acessa dados persistidos ou filas. Não especificam tecnologia — apenas o contrato.

```typescript
// takedown-job-queue.repository.ts
export interface TakedownJobQueueRepository {
  enqueue(input: TakedownJobData): Promise<string>;
  getStatus(jobId: string): Promise<JobStatus | null>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}
```

A implementação concreta (`BullMqTakedownJobQueue`) fica em `external/bullmq/`.

---

### `core/services/`

Interfaces que definem operações sobre sistemas externos (APIs, serviços de terceiros). Diferem dos repositories por não representar persistência — representam ações.

```typescript
// meta-api-client.service.ts
export interface MetaApiClientService {
  requestTakedown(input: TakedownJobData): Promise<MetaApiResponse>;
}
```

A implementação concreta (`FetchMetaApiClient`) fica em `external/bullmq/` — junto ao contexto de uso do Worker.

---

### `core/usecases/`

Cada caso de uso tem **uma única responsabilidade**, recebe suas dependências via **construtor** (injeção de dependência manual) e expõe apenas o método `execute()`.

```typescript
// enqueue-takedown.usecase.ts
export class EnqueueTakedownUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}

  async execute(input: TakedownJobData): Promise<string> {
    return this.queue.enqueue(input);
  }
}
```

**Regra:** use cases importam apenas de `core/entities/`, `core/repositories/` e `core/services/`. Nunca de `external/`, `express`, `bullmq`, `ioredis` ou `fetch`.

---

### `external/`

Implementações concretas das interfaces do `core/`. Cada subpasta agrupa por tecnologia/contexto:

| Pasta | Tecnologia | Implementa |
|---|---|---|
| `external/redis/` | IORedis | — (fábrica de conexão) |
| `external/bullmq/` | BullMQ + fetch | `TakedownJobQueueRepository`, `MetaApiClientService` |
| `external/worker/` | BullMQ Worker | — (processo de consumo da fila) |
| `external/api/` | Express | — (rotas e middleware HTTP) |

**Regra:** `external/` pode importar de `core/`. `core/` **nunca** importa de `external/`.

---

### `main.ts` e `worker.ts`

São os **pontos de composição** — onde as implementações concretas são instanciadas e conectadas às interfaces.

**`main.ts`** (processo da API):

```typescript
// Declara os serviços externos
const redisConnection = createRedisConnection({ host, port });
const takedownQueue = createTakedownQueue(redisConnection);
const queue = new BullMqTakedownJobQueue(takedownQueue, redisConnection);

// Passa para a API — que distribui para as rotas
const app = createApp({ queue, bullmqQueue: takedownQueue });
```

**`worker.ts`** → delega para `external/worker/index.ts`:

```typescript
// Declara serviços externos do worker
const metaApiClient = new FetchMetaApiClient({ url, timeoutMs });
const processTakedownUseCase = new ProcessTakedownUseCase(metaApiClient);
const worker = createTakedownWorker(redisConnection, processTakedownUseCase);
```

---

### Composição nas rotas

Cada rota recebe as dependências como parâmetro e instancia seu próprio use case. Isso elimina um container de DI centralizado e torna o fluxo de dependências **explícito e rastreável**.

```typescript
// external/api/routes/webhook.routes.ts
export function createWebhookRouter(queue: TakedownJobQueueRepository) {
  router.post("/violation", async (req, res) => {
    const useCase = new EnqueueTakedownUseCase(queue);  // ← instancia localmente
    const jobId = await useCase.execute({ adId, tenantId });
    res.status(202).json({ jobId });
  });
}
```

**Trade-off aceito:** o use case é reinstanciado a cada request. Dado que use cases são objetos leves e stateless, o custo é desprezível. O ganho é clareza: ao ler a rota, você vê exatamente o que ela usa.

---

## Diagrama de dependências

```
          ┌─────────────────────────────────────────────┐
          │                  main.ts                    │
          │    instancia externos e passa para API      │
          └──────────────────┬──────────────────────────┘
                             │
           ┌─────────────────▼────────────────┐
           │         external/api/            │
           │  routes recebem queue (interface) │
           └─────────────────┬────────────────┘
                             │ usa
           ┌─────────────────▼────────────────┐
           │          core/usecases/          │
           │  depende de repository/service   │
           └────────┬────────────────┬────────┘
                    │ interface       │ interface
         ┌──────────▼──────┐  ┌──────▼──────────┐
         │ core/repositories│  │  core/services  │
         └──────────┬──────┘  └──────┬──────────┘
                    │ implementa       │ implementa
         ┌──────────▼──────────────────▼──────────┐
         │           external/bullmq/              │
         │  BullMqTakedownJobQueue                 │
         │  FetchMetaApiClient                     │
         └─────────────────────────────────────────┘

          ┌─────────────────────────────────────────────┐
          │                 worker.ts                   │
          │    instancia externos e inicia Worker       │
          └──────────────────┬──────────────────────────┘
                             │
           ┌─────────────────▼────────────────┐
           │        external/worker/           │
           │  BullMQ Worker chama usecase      │
           └─────────────────┬────────────────┘
                             │ usa
           ┌─────────────────▼────────────────┐
           │    core/usecases/process-takedown │
           │  depende de MetaApiClientService  │
           └─────────────────┬────────────────┘
                             │ implementa
           ┌─────────────────▼────────────────┐
           │  external/bullmq/                │
           │  FetchMetaApiClient              │
           └──────────────────────────────────┘
```

---

## Regras de dependência (lei da arquitetura hexagonal)

| De \ Para | `config/` | `core/` | `external/` |
|---|:---:|:---:|:---:|
| `core/` | ✅ | ✅ | ❌ |
| `external/` | ✅ | ✅ | ✅ |
| `main.ts` / `worker.ts` | ✅ | ✅ | ✅ |

`core/` **nunca** importa de `external/`. Qualquer violação dessa regra quebra a independência de framework e invalida a testabilidade.

---

## Fluxo de construção

Ao adicionar nova funcionalidade, siga esta ordem:

1. **Definir a entidade** em `core/entities/` — schema Zod + tipo inferido.
2. **Definir a interface** em `core/repositories/` ou `core/services/` — apenas o contrato, sem implementação.
3. **Implementar o caso de uso** em `core/usecases/` — recebe interfaces via construtor, expõe `execute()`.
4. **Escrever o spec do use case** usando implementações in-memory das interfaces.
5. **Implementar o adapter** em `external/` — implementa a interface do core com a tecnologia concreta.
6. **Conectar na rota ou worker** — instanciar o adapter concreto, passar para o use case, chamar `execute()`.

---

## Princípios de código aplicados

- **SRP (Single Responsibility)**: cada arquivo/classe tem exatamente uma razão para mudar.
- **DIP (Dependency Inversion)**: módulos de alto nível (use cases) dependem de abstrações (interfaces), não de detalhes (BullMQ, Redis, fetch).
- **OCP (Open/Closed)**: trocar a implementação do cliente HTTP não requer alterar o use case — apenas criar um novo adapter que implemente `MetaApiClientService`.
- **KISS**: sem container de DI, sem decorators, sem magic — dependências são passadas explicitamente.
- **DRY**: tipos TypeScript inferidos de schemas Zod — sem duplicação de contratos.
