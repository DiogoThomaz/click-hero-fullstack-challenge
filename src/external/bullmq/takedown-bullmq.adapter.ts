import { type Job, Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { JobStatus, TakedownJobData } from "../../core/entities/takedown-job.entity.js";
import type { TakedownJobQueueRepository } from "../../core/repositories/takedown-job-queue.repository.js";
import type { ProcessTakedownUseCase } from "../../core/usecases/process-takedown.usecase.js";

export const TAKEDOWN_QUEUE_NAME = "takedown";

export function createTakedownQueue(connection: IORedis): Queue<TakedownJobData> {
  return new Queue<TakedownJobData>(TAKEDOWN_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: {
        count: 100,
      },
      removeOnFail: {
        count: 50,
      },
    },
  });
}

export class BullMqTakedownJobQueue implements TakedownJobQueueRepository {
  constructor(
    private readonly queue: Queue<TakedownJobData>,
    private readonly connection: IORedis,
  ) {}

  async enqueue(input: TakedownJobData): Promise<string> {
    const deduplicationId = `${input.adId}:${input.tenantId}`;

    const job = await this.queue.add("takedown", input, {
      deduplication: { id: deduplicationId },
    });

    if (!job.id) {
      throw new Error("BullMQ did not return a job id");
    }

    return job.id;
  }

  async getStatus(jobId: string): Promise<JobStatus | null> {
    const job = await this.queue.getJob(jobId);
    if (!job?.id) return null;

    const state = await job.getState();

    return {
      jobId: job.id,
      status: state,
      attempts: job.attemptsMade,
      result: job.returnvalue ?? null,
      error: job.failedReason ?? null,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.connection.ping();
      return response === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}

export function createTakedownWorker(
  connection: IORedis,
  processTakedownUseCase: ProcessTakedownUseCase,
): Worker<TakedownJobData> {
  return new Worker<TakedownJobData>(
    TAKEDOWN_QUEUE_NAME,
    async (job: Job<TakedownJobData>) => {
      console.log(
        `Processing takedown for adId=${job.data.adId}, tenantId=${job.data.tenantId} (attempt ${
          job.attemptsMade + 1
        })`,
      );

      return processTakedownUseCase.execute(job.data);
    },
    { connection },
  );
}
