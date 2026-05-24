import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Queue } from "bullmq";
import express from "express";
import type { TakedownJobData } from "../../core/entities/takedown-job.entity.js";
import type { TakedownJobQueueRepository } from "../../core/repositories/takedown-job-queue.repository.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createJobRouter } from "./routes/job.routes.js";
import { createWebhookRouter } from "./routes/webhook.routes.js";

export interface ApiDependencies {
  queue: TakedownJobQueueRepository;
  bullmqQueue: Queue<TakedownJobData>;
}

export function createApp({ queue, bullmqQueue }: ApiDependencies) {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [new BullMQAdapter(bullmqQueue)],
    serverAdapter,
  });

  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use("/health", createHealthRouter(queue));
  app.use("/webhook", createWebhookRouter(queue));
  app.use("/jobs", createJobRouter(queue));
  app.use("/admin/queues", serverAdapter.getRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
