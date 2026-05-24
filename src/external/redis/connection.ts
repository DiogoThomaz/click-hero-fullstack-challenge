import IORedis from "ioredis";

export interface RedisConnectionConfig {
  host: string;
  port: number;
}

export function createRedisConnection(config: RedisConnectionConfig): IORedis {
  return new IORedis({
    host: config.host,
    port: config.port,
    maxRetriesPerRequest: null,
  });
}
