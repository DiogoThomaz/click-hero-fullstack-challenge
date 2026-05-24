---
name: docker-redis
description: "Use when configuring Docker, Docker Compose, or Redis for backend microservices. Covers Dockerfile best practices, multi-stage builds, Docker Compose with healthchecks, networking, volumes, Redis setup and production hardening, and Redis patterns for BullMQ. Also use when working with docker-compose.yml, Dockerfile, .dockerignore, or Redis connection configuration."
---

# Docker + Docker Compose + Redis

## Dockerfile Best Practices

### Estrutura multi-stage (projeto atual)

```dockerfile
# Stage 1: build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# Stage 2: runtime (só o necessário)
FROM node:22-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Vantagens:** imagem final menor (só runtime, sem devDependencies, sem src/), build isolado.

### Regras essenciais

| Regra | Por quê | Como |
|---|---|---|
| Usar imagens oficiais | Segurança, manutenção | `node:22-alpine`, `redis:7-alpine` |
| `npm ci` (não `npm install`) | Instala versões exatas do lockfile | `RUN npm ci --omit=dev` |
| `COPY` ordem estratégica | Layer caching: o que muda menos primeiro | `package*.json` → `npm ci` → `src/` |
| `USER non-root` | Segurança — não rodar como root | `USER node` |
| `EXPOSE` | Documentação (não publica porta) | `EXPOSE 3000` |
| `WORKDIR` | Diretório de trabalho (cria se não existe) | `WORKDIR /app` |
| `COPY --chown` | Permissões corretas para usuário não-root | `COPY --chown=node:node . .` |

### .dockerignore

```dockerignore
node_modules/
dist/
.git/
*.md
.env
.env.local
.vscode/
.gitignore
```

## Docker Compose

### Estrutura completa (projeto atual)

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    deploy:
      resources:
        limits: { memory: "256M" }

  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - PORT=3000
    depends_on:
      redis:
        condition: service_healthy
    command: ["node", "dist/index.js"]
    restart: unless-stopped

  worker:
    build: .
    environment:
      - REDIS_HOST=redis
    depends_on:
      redis:
        condition: service_healthy
    command: ["node", "dist/worker.js"]
    restart: unless-stopped

volumes:
  redis_data:
```

### Healthchecks

**Por quê:** `depends_on` sem `condition` só espera o container iniciar, não o serviço estar pronto.

```yaml
redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]      # comando que retorna 0 se ok
    interval: 5s                              # checa a cada 5s
    timeout: 3s                               # timeout do comando
    retries: 5                                # falha após 5 tentativas
    start_period: 10s                         # espera 10s antes de começar

api:
  depends_on:
    redis:
      condition: service_healthy
```

### Networks

```yaml
services:
  api:
    networks:
      - internal    # API acessa Redis
    ports: ["3000:3000"]  # exposto externamente

  worker:
    networks:
      - internal    # Worker acessa Redis
    # sem ports — não exposto externamente

  redis:
    networks:
      - internal    # Redis só na rede interna
    # sem ports em produção — só API e Worker acessam

networks:
  internal:
    driver: bridge
    internal: true  # sem acesso externo
```

### Profiles (dev vs prod)

```yaml
services:
  redis:
    image: redis:7-alpine
    profiles: ["dev", "prod"]    # sempre ativo

  api:
    build: .
    profiles: ["dev", "prod"]

  worker:
    build: .
    profiles: ["dev", "prod"]

  redis-commander:   # UI para Redis — só em dev
    image: rediscommander/redis-commander
    profiles: ["dev"]
    ports: ["8081:8081"]
    environment:
      - REDIS_HOSTS=redis
    depends_on:
      redis:
        condition: service_healthy
```

```bash
docker compose --profile dev up -d    # tudo, inclusive redis-commander
docker compose --profile prod up -d   # só redis + api + worker
```

### Environment Variables

```yaml
# docker-compose.yml
services:
  api:
    environment:
      - REDIS_HOST=redis
      - PORT=${PORT:-3000}              # fallback default
      - LOG_LEVEL=${LOG_LEVEL:-info}
      - NODE_ENV=production

# .env file (não versionado)
PORT=4000
LOG_LEVEL=debug
```

### Resource Limits & Restart

```yaml
services:
  api:
    restart: unless-stopped        # restart automático
    deploy:
      resources:
        limits:                    # máximo que pode usar
          cpus: "0.5"
          memory: "256M"
        reservations:              # mínimo garantido
          memory: "128M"
```

## Redis

### Setup Básico

```yaml
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --appendonly yes              # persistência AOF
    --save 900 1                  # RDB snapshot a cada 15min se >=1 key mudou
    --save 300 10                 # RDB a cada 5min se >=10 keys mudaram
    --maxmemory 256mb             # limite de memória
    --maxmemory-policy allkeys-lru  # política de evicção LRU
  volumes:
    - redis_data:/data
    - ./redis.conf:/usr/local/etc/redis/redis.conf:ro  # config externa opcional
```

### Persistência

| Modo | Prós | Contras | Uso |
|---|---|---|---|
| **RDB** (`save`) | Snapshot compacto, bom para backup | Pode perder dados do último snapshot | Cache, sessões |
| **AOF** (`appendonly yes`) | Durabilidade (perde no máximo 1s) | Arquivo maior, mais lento | Filas, dados críticos |
| **RDB + AOF** | Melhor dos dois mundos | Mais complexo | Produção |

### Configuração via redis.conf

```
# redis.conf (montado como bind mount)
maxmemory 256mb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
save 900 1
save 300 10
save 60 10000
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
```

```yaml
redis:
  volumes:
    - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
    - redis_data:/data
  command: ["redis-server", "/usr/local/etc/redis/redis.conf"]
```

### Segurança

```yaml
redis:
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}        # senha
    --rename-command FLUSHALL ""
    --rename-command CONFIG ""
    --rename-command EVAL ""               # desabilita Lua scripting
    --rename-command SCRIPT ""
```

```ts
// Node.js com senha
const redis = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});
```

### Conexão Node.js (ioredis)

```ts
import IORedis from "ioredis";

const connection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,      // opcional
  maxRetriesPerRequest: null,        // obrigatório para BullMQ
  retryStrategy(times) {             // reconexão
    if (times > 10) return null;     // desiste após 10 tentativas
    return Math.min(times * 200, 2000); // backoff: 200ms, 400ms, 800ms, ...
  },
  lazyConnect: true,                 // não conecta até primeiro uso
  enableOfflineQueue: false,         // rejeita comandos se desconectado
});
```

### Monitoração

```bash
# Redis CLI
redis-cli INFO             # métricas: memória, conexões, hits/misses
redis-cli SLOWLOG GET 10   # últimas 10 queries lentas
redis-cli MONITOR          # todas as queries em tempo real (só debug!)
redis-cli CLIENT LIST      # conexões ativas
redis-cli MEMORY STATS     # análise de memória
```

### Redis para BullMQ

Ver skill `backend-bullmq` para detalhes completos de integração.

Configuração essencial:

```ts
const connection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,  // BullMQ gerencia retry manualmente
});
```

**Nunca usar** a mesma conexão Redis para BullMQ e cache/outros usos — BullMQ usa `blocking` pop e pode travar outras operações. Criar conexão separada.

## Comandos Úteis

```bash
# Build e start
docker compose build --no-cache api   # rebuild sem cache
docker compose up -d                   # start todos
docker compose up -d --scale worker=3  # 3 workers

# Logs
docker compose logs -f worker          # seguir logs do worker
docker compose logs --tail=100 api     # últimas 100 linhas

# Executar comando em container
docker compose exec redis redis-cli ping

# Inspect
docker compose ps                      # status
docker compose top                     # processos
docker stats                           # recursos em tempo real

# Limpeza
docker compose down -v                 # para e remove volumes
docker system prune -a                 # limpa tudo (cuidado!)
```

## Referências no projeto

| Arquivo | Propósito |
|---|---|
| `Dockerfile` | Multi-stage build com builder + runner |
| `docker-compose.yml` | 3 serviços: redis, api, worker (com healthcheck) |
| `src/config/env.ts` | Conexão Redis configurada via env vars |
| `src/queue/takedown.queue.ts` | BullMQ Queue + Worker com conexão Redis |
