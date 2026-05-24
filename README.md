# FURY · Click Hero — Desafio Técnico

Mini-API em Node.js + TypeScript para receber notificações de violação de anúncios, validar o payload, enfileirar jobs de takedown com BullMQ e processar a integração HTTP simulada com a Meta Ads API.

> **Documentação completa:**
> - [ARQUITETURA.md](./ARQUITETURA.md) — estrutura de camadas, regras de dependência e diagramas
> - [GUIA.md](./GUIA.md) — guia prático de desenvolvimento e conceitos técnicos
> - [AGENTS.md](./AGENTS.md) — configuração do assistente de IA (opencode, agents e skills)
> - [MILESTONE.md](./MILESTONE.md) — histórico de milestones e progresso do projeto

---

## Stack

| Tecnologia | Função |
|---|---|
| **Node.js 22 + TypeScript** | Runtime e tipagem estática estrita |
| **Express** | Framework HTTP |
| **Zod** | Validação de payloads e fonte única de tipos |
| **BullMQ + Redis** | Fila de jobs com retry e backoff exponencial |
| **Bull Board** | Dashboard visual da fila (`/admin/queues`) |
| **Biome** | Linter e formatter |
| **Vitest** | Testes unitários |
| **Docker Compose** | API + Worker + Redis em containers separados |

---

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) e Docker Compose

Para desenvolvimento local, adicionalmente:

- Node.js 22+
- npm 10+

---

## Como rodar com Docker

```bash
# Subir API, Worker e Redis
docker compose up -d

# Acompanhar logs em tempo real
docker compose logs -f

# Verificar status dos containers
docker compose ps
```

Serviços disponíveis após o `up`:

| Serviço | URL |
|---|---|
| API | `http://localhost:3000` |
| Health check | `http://localhost:3000/health` |
| Bull Board | `http://localhost:3000/admin/queues` |
| Worker | processo interno, sem porta exposta |
| Redis | `localhost:6379` |

> As imagens pré-compiladas estão publicadas no GitHub Container Registry:
> - `ghcr.io/diogothomaz/click-hero-api:v0.0.0`
> - `ghcr.io/diogothomaz/click-hero-worker:v0.0.0`
>
> O `docker-compose.yml` já aponta para essas imagens. Para rebuildar localmente substitua `image:` por `build: .` nos serviços `api` e `worker`.

---

## Como rodar localmente (desenvolvimento)

```bash
# 1. Instalar dependências
npm install

# 2. Subir apenas o Redis
docker compose up -d redis

# 3. Em terminais separados:
npm run dev           # API com hot-reload em :3000
npm run start:worker  # Worker BullMQ
```

---

## Endpoints

### `POST /webhook/violation`

Recebe uma notificação de violação e enfileira um job de takedown.

**Payload:**

```json
{
  "adId": "ad-123",
  "tenantId": "tenant-456",
  "violationType": "PROHIBITED_TERM",
  "severity": "HIGH",
  "detectedAt": "2025-01-01T00:00:00.000Z"
}
```

Campos obrigatórios:

| Campo | Tipo | Valores aceitos |
|---|---|---|
| `adId` | `string` | não vazio |
| `tenantId` | `string` | não vazio |
| `violationType` | `enum` | `PROHIBITED_TERM`, `BRAND_VIOLATION`, `COMPLIANCE_FAIL` |
| `severity` | `enum` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `detectedAt` | `string` | ISO 8601 datetime |

**Respostas:**

| Status | Corpo | Condição |
|---|---|---|
| `202` | `{ "jobId": "<id>" }` | Payload válido, job enfileirado |
| `400` | `{ "error": "Invalid payload", "details": {...} }` | Campos inválidos ou ausentes |

**Exemplo:**

```bash
curl -X POST http://localhost:3000/webhook/violation \
  -H "Content-Type: application/json" \
  -d '{
    "adId": "ad-123",
    "tenantId": "tenant-456",
    "violationType": "PROHIBITED_TERM",
    "severity": "HIGH",
    "detectedAt": "2025-01-01T00:00:00.000Z"
  }'
```

---

### `GET /jobs/:id`

Consulta o status atual de um job na fila.

**Respostas:**

| Status | Corpo | Condição |
|---|---|---|
| `200` | ver abaixo | Job encontrado |
| `404` | `{ "error": "Job not found" }` | Job inexistente |

**Corpo `200`:**

```json
{
  "jobId": "1",
  "status": "completed",
  "attempts": 1,
  "result": { "success": true, "status": 200 },
  "error": null
}
```

Valores possíveis de `status`: `waiting`, `active`, `completed`, `failed`, `delayed`, `paused`.

**Exemplo:**

```bash
curl http://localhost:3000/jobs/1
```

---

### `GET /health`

Verifica a saúde da API e a conectividade com o Redis.

**Respostas:**

| Status | Corpo | Condição |
|---|---|---|
| `200` | `{ "status": "ok", "checks": { "redis": true, "api": true } }` | Redis acessível |
| `503` | `{ "status": "degraded", "checks": { "redis": false, "api": true } }` | Redis inacessível |

**Exemplo:**

```bash
curl http://localhost:3000/health
```

---

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | API com hot-reload (tsx watch) |
| `npm start` | API em produção (`dist/main.js`) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm run start:worker` | Worker em produção (`dist/worker.js`) |
| `npm run lint` | Verifica código com Biome |
| `npm run lint:fix` | Corrige automaticamente |
| `npm run format` | Formata código |
| `npm test` | Testes unitários com Vitest |
| `npm run test:watch` | Testes em modo watch |
| `npm run test:e2e` | Suite E2E contra a API HTTP em execução |
| `npm run test:carga` | Teste de carga: 1000 requisições, 20 paralelas |

---

## Variáveis de ambiente

Todas com defaults funcionais para desenvolvimento local.

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP da API |
| `REDIS_HOST` | `localhost` | Host do Redis |
| `REDIS_PORT` | `6379` | Porta do Redis |
| `META_API_URL` | `https://jsonplaceholder.typicode.com/posts/1` | Endpoint HTTP externo simulado |
| `META_API_TIMEOUT_MS` | `5000` | Timeout (ms) da chamada HTTP do Worker |

---

## Estrutura do projeto

```
src/
├── main.ts                          # Entrypoint da API: declara serviços externos e sobe Express
├── worker.ts                        # Entrypoint do Worker: delega para external/worker/
├── config/
│   └── env.ts                       # Variáveis de ambiente validadas com Zod
│
├── core/                            # Núcleo da aplicação — zero dependência de frameworks
│   ├── entities/
│   │   ├── violation.entity.ts      # Schema Zod do payload de violação
│   │   ├── violation.entity.spec.ts
│   │   └── takedown-job.entity.ts   # TakedownJobData e JobStatus
│   ├── repositories/
│   │   └── takedown-job-queue.repository.ts  # Interface da fila (contrato)
│   ├── services/
│   │   ├── meta-api-client.service.ts        # Interface do cliente HTTP externo
│   │   └── health-check.service.ts           # Interface de health check
│   └── usecases/
│       ├── enqueue-takedown.usecase.ts        # Enfileira job de takedown
│       ├── enqueue-takedown.usecase.spec.ts
│       ├── get-job-status.usecase.ts          # Consulta status do job
│       ├── process-takedown.usecase.ts        # Processa takedown (usado pelo worker)
│       ├── process-takedown.usecase.spec.ts
│       └── get-health.usecase.ts             # Verifica saúde dos serviços
│
└── external/                        # Integrações com frameworks e infraestrutura
    ├── redis/
    │   └── connection.ts            # Fábrica de conexão IORedis
    ├── bullmq/
    │   ├── takedown-bullmq.adapter.ts      # Implementa TakedownJobQueueRepository
    │   ├── fetch-meta-api.client.ts        # Implementa MetaApiClientService via fetch
    │   └── fetch-meta-api.client.spec.ts
    ├── worker/
    │   └── index.ts                 # startWorker(): instancia serviços e sobe BullMQ Worker
    └── api/
        ├── index.ts                 # createApp(): monta Express com rotas e Bull Board
        ├── routes/
        │   ├── webhook.routes.ts    # POST /webhook/violation
        │   ├── job.routes.ts        # GET /jobs/:id
        │   └── health.routes.ts    # GET /health
        └── middleware/
            ├── error-handler.ts
            └── not-found.ts
```

---

## Fluxo de execução

```
Requisição HTTP
      │
      ▼
POST /webhook/violation (Express route)
      │  valida payload com violationSchema (Zod)
      │
      ▼
EnqueueTakedownUseCase.execute(input)
      │  depende de TakedownJobQueueRepository (interface)
      │
      ▼
BullMqTakedownJobQueue.enqueue(input)        [external/bullmq]
      │  deduplication key: adId:tenantId
      │
      ▼
Redis / BullMQ Queue
      │
      ▼  (processo separado)
BullMQ Worker                                [external/worker]
      │
      ▼
ProcessTakedownUseCase.execute(job.data)
      │  depende de MetaApiClientService (interface)
      │
      ▼
FetchMetaApiClient.requestTakedown(input)    [external/bullmq]
      │  AbortController com timeout
      │  retry automático com backoff exponencial (BullMQ)
      ▼
JSONPlaceholder (Meta API simulada)
```

---

## Decisões técnicas

| Decisão | Justificativa |
|---|---|
| **Arquitetura hexagonal** | Core sem dependência de frameworks — testável com stubs in-memory, substituição de adapters sem tocar regras de negócio |
| **Composição de dependências nas rotas** | Cada rota instancia seu próprio use case com as dependências recebidas via parâmetro, eliminando um container de DI centralizado e tornando o fluxo explícito |
| **Idempotência via deduplication key** | BullMQ `deduplication.id = adId:tenantId` impede dois jobs simultâneos para o mesmo anúncio/tenant |
| **Retry com backoff exponencial** | 3 tentativas com delay inicial de 5s (5s → 25s → 125s); falha definitiva preservada em `failedReason` |
| **Timeout com AbortController** | Evita que chamadas lentas à Meta API segurem o worker indefinidamente |
| **Zod como fonte única de tipos** | Tipos TypeScript são inferidos dos schemas — sem interfaces duplicadas, sem `any` |
| **`FetchMetaApiClient` em `external/bullmq/`** | Colocado junto com o contexto de uso (worker) em vez de criar um módulo `external/http/` separado; reduz número de módulos e carga cognitiva |
| **Bull Board dentro da API** | Simplificação de escopo; em produção deveria ser isolado em serviço administrativo com autenticação |
| **Processos separados API e Worker** | API nunca bloqueia processando jobs; cada processo escala e reinicia independentemente |

---

## Como validar a entrega

Execute os quality gates nesta ordem:

```bash
# 1. Type check
npx tsc --noEmit

# 2. Lint
npx biome check src/

# 3. Testes unitários
npx vitest run

# 4. Subir containers
docker compose up -d

# 5. E2E (requer API rodando)
npm run test:e2e

# 6. Carga
npm run test:carga
```

Confirme também:

```bash
# Todos os containers em execução
docker compose ps

# API respondendo
curl http://localhost:3000/health

# Bull Board acessível
open http://localhost:3000/admin/queues
```

Resultados esperados:

- `tsc --noEmit` — zero erros
- `biome check` — zero erros
- `vitest run` — 14/14 testes passando
- `docker compose ps` — `api`, `worker` e `redis` em execução
- `GET /health` — `200 { "status": "ok" }`
- `POST /webhook/violation` — `202 { "jobId": "..." }`
- `GET /jobs/:id` — status do job atualizado pelo Worker
- Teste de carga — 1000 requisições, 0 erros inesperados

---

## Limitações intencionais

- **Sem autenticação/autorização** — fora do escopo do desafio
- **Sem banco de dados relacional** — Redis/BullMQ é suficiente para fila e status de jobs
- **Sem front-end** — Bull Board é a única interface visual, apenas para inspeção operacional
- **Logs com `console.log`** — aceitável no escopo do desafio; em produção o correto é logging estruturado com correlação (ex.: Pino, Winston)
- **Bull Board sem autenticação** — em produção deve ser protegido ou isolado
