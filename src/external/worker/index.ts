import { FetchMetaApiClient } from "../bullmq/fetch-meta-api.client.js";
import { BullMqTakedownJobQueue, createTakedownQueue, createTakedownWorker } from "../bullmq/takedown-bullmq.adapter.js";
import { createRedisConnection } from "../redis/connection.js";
import { ProcessTakedownUseCase } from "../../core/usecases/process-takedown.usecase.js";
import { env } from "../../config/env.js";

export function startWorker() {
  const redisConnection = createRedisConnection({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  });

  const takedownQueue = createTakedownQueue(redisConnection);
  const takedownJobQueue = new BullMqTakedownJobQueue(takedownQueue, redisConnection);

  const metaApiClient = new FetchMetaApiClient({
    url: env.META_API_URL,
    timeoutMs: env.META_API_TIMEOUT_MS,
  });

  const processTakedownUseCase = new ProcessTakedownUseCase(metaApiClient);
  const worker = createTakedownWorker(redisConnection, processTakedownUseCase);

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed: ${err.message}`);
  });

  console.log("Worker started, waiting for jobs...");

  async function shutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}. Shutting down worker gracefully...`);

    try {
      await worker.close();
      await takedownJobQueue.close();
      process.exit(0);
    } catch (error) {
      console.error("Failed to close worker dependencies:", error);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}
