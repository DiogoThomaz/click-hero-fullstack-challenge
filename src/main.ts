import { env } from "./config/env.js";
import { BullMqTakedownJobQueue, createTakedownQueue } from "./external/bullmq/takedown-bullmq.adapter.js";
import { createApp } from "./external/api/index.js";
import { createRedisConnection } from "./external/redis/connection.js";

// External services
const redisConnection = createRedisConnection({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
});

const takedownQueue = createTakedownQueue(redisConnection);
const queue = new BullMqTakedownJobQueue(takedownQueue, redisConnection);

// Bootstrap API
const app = createApp({ queue, bullmqQueue: takedownQueue });

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
  console.log(`Bull Board: http://localhost:${env.PORT}/admin/queues`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Shutting down API gracefully...`);

  server.close(async (error) => {
    if (error) {
      console.error("Failed to close HTTP server:", error);
      process.exit(1);
    }

    try {
      await queue.close();
      process.exit(0);
    } catch (closeError) {
      console.error("Failed to close API dependencies:", closeError);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
