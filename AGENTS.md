# AGENTS.md — Configuração de IA com opencode

Este projeto utiliza o [opencode](https://opencode.ai) como assistente de desenvolvimento com IA. A configuração está em `.opencode/` e define **agents** (comportamentos) e **skills** (conhecimentos especializados) que guiam o assistente em cada tipo de tarefa.

---

## O que é opencode?

opencode é um agente de IA para desenvolvimento de software que roda no terminal. Diferente de um chat genérico, ele tem acesso direto ao filesystem, pode executar comandos, e é configurável por projeto — permitindo que você defina como ele deve se comportar para o seu codebase específico.

A configuração deste projeto fica em `.opencode/`:

```
.opencode/
├── agents/
│   ├── dev-senior.md      # Agente primário — guia implementação e arquitetura
│   └── code-reviewer.md   # Subagente — revisa qualidade, segurança e testes
└── skills/
    ├── backend-bullmq/
    │   └── SKILL.md       # Conhecimento especializado: BullMQ + Redis + filas
    ├── backend-senior/
    │   └── SKILL.md       # Padrões de engenharia sênior: SOLID, observabilidade
    ├── backend-typescript/
    │   └── SKILL.md       # TypeScript + Express + Zod + Biome + Vitest
    └── docker-redis/
        └── SKILL.md       # Docker + Docker Compose + Redis production hardening
```

---

## Agents

Agents definem o **modo de operação** do assistente — sua personalidade, restrições, permissões e comportamento esperado.

### `dev-senior` (modo primário)

**Arquivo:** `.opencode/agents/dev-senior.md`
**Modo:** `primary` — ativo por padrão em todas as conversas.

Este é o agente principal do projeto. Ele atua como um engenheiro sênior com 15+ anos de experiência em sistemas distribuídos, Node.js, TypeScript e microsserviços. Suas responsabilidades:

- Guiar implementações garantindo qualidade de produção
- Aplicar os **7 princípios de engenharia** definidos no arquivo (legibilidade, sem dívida técnica não intencional, abstrações com custo, etc.)
- Executar os **quality gates** após cada mudança: `tsc --noEmit` → `biome check` → `vitest run` → E2E → load test
- Seguir o **checklist de planejamento** antes de escrever qualquer código
- Registrar decisões arquiteturais com o template de ADR (Architecture Decision Record)

**Quando usar:** sempre. É o agente padrão para implementar features, refatorar, fazer decisões de arquitetura, corrigir bugs, e qualquer interação com o código.

**Permissões:**
- `read`: allow — pode ler qualquer arquivo do projeto
- `edit`: allow — pode editar arquivos
- `bash`: allow — pode executar comandos (tsc, biome, vitest, docker, git)

---

### `code-reviewer` (subagente)

**Arquivo:** `.opencode/agents/code-reviewer.md`
**Modo:** `subagent` — acionado explicitamente quando necessário.

Agente especializado em revisão de código. Ele **não escreve código** — apenas analisa e reporta. Avalia o codebase em 4 dimensões:

1. **Code Quality** — violações de TypeScript strict, Zod como fonte única de tipos, separação de responsabilidades, conformidade com Biome
2. **E2E & Testing** — cobertura dos endpoints, cenários de erro, testes de carga, casos de borda não testados
3. **Security** — validação de inputs, vazamento de informações em erros, secrets hardcoded, headers de segurança, rate limiting
4. **Production Readiness** — Dockerfile, graceful shutdown, retry/backoff, logging estruturado, validação de variáveis de ambiente

Cada finding é classificado como:
- `[FAIL]` — bloqueador, deve ser corrigido antes de produção
- `[WARN]` — deve ser corrigido, mas não é bloqueador
- `[PASS]` — sem problemas encontrados
- `[INFO]` — observação ou sugestão

**Quando usar:** antes de abrir um PR, após uma refatoração grande, ou quando quiser uma segunda opinião sobre qualidade. Exemplos de triggers: *"revisa o código"*, *"faz um code review"*, *"está production-ready?"*, *"tem algum problema de segurança?"*.

**Permissões:**
- `read`: allow — pode ler qualquer arquivo
- `edit`: deny — não pode modificar nada
- `bash`: deny — não executa comandos

---

## Skills

Skills são **conhecimentos especializados** injetados no contexto do assistente quando a tarefa exige. Elas não têm permissões próprias — funcionam como um manual técnico que o agente consulta automaticamente ao detectar padrões de tarefa relevantes.

### `backend-bullmq`

**Arquivo:** `.opencode/skills/backend-bullmq/SKILL.md`

Cobre toda a arquitetura produtor/consumidor com BullMQ:

- Separação Queue (API) / Worker (processo separado)
- Setup de conexão Redis com configurações de retry
- Padrão de deduplicação via `jobId` customizado (`adId:tenantId`)
- Configuração de retry com backoff exponencial: `attempts: 3, backoff: { type: "exponential", delay: 5000 }`
- Graceful shutdown do Worker com `await worker.close()`
- Docker Compose com dois containers (`api` + `worker`) conectados ao mesmo Redis
- Padrão de idempotência em jobs
- Scripts de load test com `curl` paralelo

**Acionada automaticamente quando:** você trabalha com arquivos em `src/queue/`, `src/jobs/`, `src/worker.ts`, `docker-compose.yml` com múltiplos serviços, ou menciona BullMQ, Redis, filas, retry, backoff, jobs.

---

### `backend-senior`

**Arquivo:** `.opencode/skills/backend-senior/SKILL.md`

Cobre padrões de engenharia de nível sênior:

- Princípios SOLID aplicados a Node.js/TypeScript
- Estratégias de tratamento de erro: DomainError, OperationalError, ProgrammingError
- Observabilidade: logging estruturado com correlação, métricas, tracing
- Performance: profiling, event loop, worker threads, caching
- Segurança: validação de inputs, proteção contra injeção, rate limiting, OWASP
- API design: HTTP semantics, versionamento, contratos de erro
- Testing strategy: pirâmide de testes, mocks vs stubs vs fakes
- Production hardening: healthchecks, circuit breakers, graceful shutdown

**Acionada automaticamente quando:** a tarefa envolve arquitetura, produção, performance, escalabilidade, SOLID, clean code, design patterns, observabilidade, ou hardening.

---

### `backend-typescript`

**Arquivo:** `.opencode/skills/backend-typescript/SKILL.md`

Cobre o stack TypeScript + Express deste projeto:

- Configuração do `tsconfig.json` com `strict: true`, `noUncheckedIndexedAccess`, `noUnusedLocals`
- Estrutura de pastas recomendada: `routes/`, `middleware/`, `schemas/`, `config/`
- Padrão de rotas Express com tipagem correta de `Request`/`Response`
- Validação com Zod: schema → `z.infer<>` → sem interfaces manuais
- Middleware de erro global tipado
- Configuração do Biome: `noExplicitAny`, `noNonNullAssertion`, imports ordenados
- Testes com Vitest: setup, mocks, cobertura de casos de borda
- Padrões de importação: named exports, sem `export default` em módulos non-React

**Acionada automaticamente quando:** você trabalha com arquivos em `src/routes/`, `src/middleware/`, `src/schemas/`, `src/config/`, `tsconfig.json`, ou `biome.json`.

---

### `docker-redis`

**Arquivo:** `.opencode/skills/docker-redis/SKILL.md`

Cobre infraestrutura Docker e Redis para microsserviços:

- Dockerfile multi-stage: `builder` (compilação) → `runner` (produção)
- Boas práticas: `npm ci --omit=dev`, `USER node`, `.dockerignore`, Alpine base
- Docker Compose com healthchecks nos serviços, `depends_on` com condição, `restart: unless-stopped`
- Redis: configuração de conexão com `maxRetriesPerRequest: null`, `enableOfflineQueue: false`
- Volumes nomeados para persistência do Redis
- Redes isoladas para comunicação interna entre containers
- Redis production hardening: `maxmemory`, `maxmemory-policy`, `appendonly`

**Acionada automaticamente quando:** você trabalha com `docker-compose.yml`, `Dockerfile`, `.dockerignore`, ou configuração de conexão Redis.

---

## Como usar o opencode neste projeto

### Instalação

```bash
# macOS / Linux
curl -fsSL https://opencode.ai/install | bash

# Verificar instalação
opencode --version
```

### Rodando

```bash
# Na raiz do projeto
opencode
```

O opencode detecta automaticamente a configuração em `.opencode/` e carrega os agents e skills do projeto.

### Exemplos de uso com os agents e skills

```
# Implementação — aciona dev-senior + skills relevantes
"Adiciona um endpoint GET /stats que retorna total de jobs por status"

# Revisão — aciona code-reviewer
"Faz um code review completo antes do PR"

# Arquitetura — aciona dev-senior + backend-senior
"Qual é o trade-off de mover o Bull Board para um serviço separado?"

# Infraestrutura — aciona dev-senior + docker-redis
"Adiciona healthcheck no serviço worker do docker-compose"

# Fila — aciona dev-senior + backend-bullmq
"Como implemento prioridade de jobs para severity CRITICAL?"

# Qualidade — aciona code-reviewer
"Tem algum problema de segurança no código atual?"
```

### Como as skills são acionadas

Skills são carregadas automaticamente pelo agente quando ele detecta que a tarefa é relevante para aquela skill. Você não precisa mencioná-las explicitamente. O gatilho pode ser:

- **Padrão de arquivo**: trabalhar em `docker-compose.yml` aciona `docker-redis`
- **Palavras-chave**: mencionar "BullMQ", "retry", "fila" aciona `backend-bullmq`
- **Contexto da tarefa**: pedir um "code review" aciona o subagente `code-reviewer`

Você também pode acionar manualmente:

```
"Use a skill backend-bullmq para me explicar como funciona a deduplicação"
```

---

## Por que esta configuração?

### Por que agents separados?

O `dev-senior` e o `code-reviewer` têm **objetivos conflitantes por design**: um implementa, o outro critica. Manter separados garante que a revisão seja feita com olhos diferentes — o `code-reviewer` não tem acesso de escrita justamente para que ele não "resolva" os problemas que encontra, apenas os reporte para que o desenvolvedor (ou o `dev-senior`) tome a decisão consciente de como corrigir.

### Por que skills em vez de tudo no agent?

Agents com contexto excessivo tomam decisões piores — o contexto relevante se dilui. Skills são injetadas **só quando necessárias**, mantendo o contexto focado. Um agent que conhece "tudo sobre o projeto" é menos eficaz do que um que conhece exatamente o que precisa para a tarefa atual.

### Por que `mode: primary` no dev-senior?

`primary` significa que este agent está sempre ativo — não precisa ser chamado explicitamente. É o comportamento padrão para todas as conversas no projeto. O `code-reviewer` é `subagent` porque tem um propósito específico e restrito: só faz sentido acioná-lo em momentos deliberados de revisão.
