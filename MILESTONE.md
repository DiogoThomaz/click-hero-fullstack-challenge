# Milestone — FURY Click Hero

## Objetivo do projeto

Entregar uma mini-API Node.js + TypeScript para receber webhooks de violação de anúncio, validar o payload com Zod, enfileirar takedowns com BullMQ/Redis, processar a integração HTTP simulada com retry/backoff e expor consulta de status do job — seguindo arquitetura hexagonal, SOLID e Ports and Adapters.

## Documentação de referência

- `docs/Desafio Técnico FURY - Candidato.pdf` — requisitos do desafio
- `README.md` — execução, endpoints e como validar a entrega
- `ARQUITETURA.md` — estrutura de pastas, camadas, regras de dependência e diagramas
- `GUIA.md` — guia prático de desenvolvimento e conceitos técnicos

---

## Escopo obrigatório

| Requisito | Status | Critério de aceite |
|---|:---:|---|
| `POST /webhook/violation` | ✅ Concluído | Retorna `202` com `{ jobId }` para payload válido |
| Validação com Zod | ✅ Concluído | Retorna `400` com erros detalhados para campos ausentes/inválidos |
| BullMQ + Redis | ✅ Concluído | Job criado na fila `takedown` usando Redis |
| API e Worker em processos separados | ✅ Concluído | `main.ts` (API) e `worker.ts` (Worker) são entrypoints e containers independentes |
| Docker Compose completo | ✅ Concluído | `docker compose up -d` sobe API, Worker, Redis e Bull Board sem passos manuais |
| Worker com chamada HTTP externa | ✅ Concluído | `FetchMetaApiClient` chama JSONPlaceholder e trata respostas não-2xx |
| Retry com backoff exponencial | ✅ Concluído | 3 tentativas, backoff exponencial com delay inicial de 5s |
| Timeout da chamada HTTP | ✅ Concluído | `AbortController` cancela requisições acima de `META_API_TIMEOUT_MS` |
| Idempotência `adId + tenantId` | ✅ Concluído | Chave de deduplicação BullMQ impede jobs duplicados simultâneos |
| `GET /jobs/:id` | ✅ Concluído | Retorna `{ jobId, status, attempts, result, error }` ou `404` |
| `GET /health` | ✅ Concluído | Retorna `200` com checagem Redis ou `503` quando degradado |
| Graceful shutdown | ✅ Concluído | API e Worker fecham conexões em `SIGTERM`/`SIGINT` |
| README com instruções | ✅ Concluído | Execução Docker e local documentadas |
| Testes unitários | ✅ Concluído | 14 testes passando: entities, use cases e adapter HTTP |
| Testes E2E | ✅ Concluído | `scripts/test-api.js` cobre fluxo completo, validação, idempotência e status |
| Teste de carga | ✅ Concluído | `scripts/teste-carga.sh`: 1000 reqs, 20 paralelas, 0 erros |
| Arquitetura hexagonal | ✅ Concluído | `core/` sem dependência de frameworks; `external/` implementa interfaces do core |
| SOLID | ✅ Concluído | SRP, DIP e OCP aplicados e verificáveis por camada |
| Ports and Adapters | ✅ Concluído | Interfaces em `core/repositories/` e `core/services/`; implementações em `external/` |
| Imagens Docker publicadas | ✅ Concluído | `ghcr.io/diogothomaz/click-hero-api:v0.0.0` e `click-hero-worker:v0.0.0` no GHCR |
| Documentação técnica | ✅ Concluído | `README.md`, `ARQUITETURA.md`, `GUIA.md` com arquitetura, fluxo, conceitos e guia |

---

## Milestones

### M0 — Baseline e verificação inicial ✅

**Objetivo:** confirmar o estado real do projeto antes de alterar comportamento.

- [x] `npx tsc --noEmit` — zero erros
- [x] `npx biome check src/` — zero erros
- [x] `npx vitest run` — todos os testes passando
- [x] `docker compose up -d --build` — containers sobem sem erro
- [x] `npm run test:e2e` — suite E2E passando
- [x] `npm run test:carga` — carga sem erros

---

### M1 — Conformidade funcional do desafio ✅

**Objetivo:** garantir que todos os requisitos obrigatórios do PDF estão cobertos e testáveis.

- [x] `POST /webhook/violation` aceita todos os enums documentados
- [x] Payload vazio, campos obrigatórios vazios e `detectedAt` inválido retornam `400` detalhado
- [x] Duas requisições com o mesmo `adId + tenantId` retornam o mesmo `jobId`
- [x] `GET /jobs/:id` retorna `404` para job inexistente
- [x] Worker conclui jobs quando a chamada HTTP retorna 2xx
- [x] Retry/falha configurável via `META_API_URL`
- [x] API e Worker executam em processos separados
- [x] Docker Compose sobe API, Worker, Redis e Bull Board sem passos manuais

---

### M2 — Robustez operacional mínima ✅

**Objetivo:** tornar o serviço operável em container.

- [x] Graceful shutdown para API (fecha HTTP server → fecha Redis)
- [x] Graceful shutdown para Worker (aguarda job atual → fecha Redis)
- [x] `GET /health` com checagem de Redis (`200` ok / `503` degradado)
- [x] `express.json({ limit: "1mb" })` configurado
- [x] Mensagens de erro não expõem detalhes internos
- [x] Variáveis de ambiente documentadas com defaults

---

### M2.5 — Qualidade arquitetural: Hexagonal, SOLID e Ports and Adapters ✅

**Objetivo:** garantir arquitetura desacoplada, testável e evolutiva.

- [x] `core/usecases/` independentes de Express, BullMQ, Redis, `fetch` e `env`
- [x] `core/repositories/` e `core/services/` como contratos de interface
- [x] `external/bullmq/` implementa `TakedownJobQueueRepository` e `MetaApiClientService`
- [x] Testes unitários dos use cases com fakes in-memory (sem Docker, Redis ou rede)
- [x] Dependências apontam de `external/` para `core/`, nunca o contrário
- [x] `ARQUITETURA.md` documenta estrutura, diagramas e regras de dependência

---

### M3 — Testabilidade e contratos ✅

**Objetivo:** tornar regressões óbvias antes da entrega.

- [x] Specs de use cases: `enqueue-takedown`, `process-takedown`
- [x] Spec de entidade: `violation.entity.spec.ts` (7 casos)
- [x] Spec de adapter HTTP: `fetch-meta-api.client.spec.ts` (sucesso, 5xx, timeout)
- [x] `npm run test:e2e` valida contratos HTTP completos
- [x] `npm run test:carga` retorna exit code 1 em caso de falha

---

### M4 — Documentação e entrega ✅

**Objetivo:** repositório autoexplicativo para avaliação.

- [x] README com execução, endpoints, variáveis, scripts e validação da entrega
- [x] Decisões técnicas documentadas: idempotência, retry, timeout, separação API/Worker
- [x] Limitações intencionais documentadas
- [x] `.env`/secrets não versionados (apenas `env.ts` com defaults seguros)
- [x] Imagens Docker publicadas no GHCR

---

### M5 — Refatoração arquitetural ✅

**Objetivo:** alinhar a estrutura de pastas e o padrão de composição ao `ARQUITETURA.md`.

- [x] Renomear `src/application/` → `src/core/` com subpastas `entities/`, `repositories/`, `services/`, `usecases/`
- [x] Renomear `src/adapters/out/` → `src/external/bullmq/`
- [x] Mover `FetchMetaApiClient` para `src/external/bullmq/` (contexto de uso, menos módulos)
- [x] Extrair `createRedisConnection` para `src/external/redis/connection.ts`
- [x] Mover `src/app.ts` + `src/routes/` + `src/middleware/` → `src/external/api/`
- [x] Mover `src/worker.ts` (lógica) → `src/external/worker/index.ts`; `worker.ts` vira entrypoint
- [x] Reescrever `src/index.ts` → `src/main.ts` sem container centralizado
- [x] Composição de dependências nas rotas: cada rota instancia seu use case localmente
- [x] Remover `src/config/container.ts`, `src/jobs/`, `src/queue/` (legados)
- [x] Renomear testes de `.test.ts` → `.spec.ts` colocalizados com os módulos
- [x] Renomear `ESTRUTURA.md` → `ARQUITETURA.md` com diagrama e regras de dependência
- [x] Criar `GUIA.md` com guia prático e conceitos técnicos
- [x] `npx tsc --noEmit` — zero erros após refatoração
- [x] `npx vitest run` — 14/14 passando após refatoração

---

## Quality gates finais

Execute nesta ordem antes da entrega:

```bash
npx tsc --noEmit
npx biome check src/
npx vitest run
docker compose up -d
npm run test:e2e
npm run test:carga
```

---

## Definição de pronto

- [x] Todos os requisitos obrigatórios do PDF implementados
- [x] Todos os quality gates passando
- [x] API e Worker em processos/containers separados
- [x] Docker Compose sobe `api`, `worker`, `redis` e Bull Board
- [x] Arquitetura hexagonal com `core/` independente de `external/`
- [x] SOLID aplicado: SRP, DIP e OCP verificáveis por camada
- [x] Ports and Adapters: interfaces em `core/`, implementações em `external/`
- [x] Testes unitários com fakes in-memory, E2E e carga
- [x] `README.md`, `ARQUITETURA.md` e `GUIA.md` completos
- [x] Imagens publicadas no GHCR
- [x] Zero `any`, zero casts desnecessários, zero variáveis não usadas, zero código morto
