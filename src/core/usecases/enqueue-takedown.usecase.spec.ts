import { describe, expect, it } from "vitest";
import type { JobStatus, TakedownJobData } from "../entities/takedown-job.entity.js";
import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";
import { EnqueueTakedownUseCase } from "./enqueue-takedown.usecase.js";
import { GetJobStatusUseCase } from "./get-job-status.usecase.js";

class InMemoryTakedownJobQueue implements TakedownJobQueueRepository {
  private readonly jobs = new Map<string, JobStatus>();

  async enqueue(input: TakedownJobData): Promise<string> {
    const jobId = `${input.adId}:${input.tenantId}`;
    this.jobs.set(jobId, {
      jobId,
      status: "waiting",
      attempts: 0,
      result: null,
      error: null,
    });
    return jobId;
  }

  async getStatus(jobId: string): Promise<JobStatus | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

describe("EnqueueTakedownUseCase", () => {
  it("enqueues a takedown through the queue repository", async () => {
    const queue = new InMemoryTakedownJobQueue();
    const useCase = new EnqueueTakedownUseCase(queue);

    await expect(useCase.execute({ adId: "ad-123", tenantId: "tenant-456" })).resolves.toBe(
      "ad-123:tenant-456",
    );
  });
});

describe("GetJobStatusUseCase", () => {
  it("gets job status through the queue repository", async () => {
    const queue = new InMemoryTakedownJobQueue();
    const enqueueUseCase = new EnqueueTakedownUseCase(queue);
    const getStatusUseCase = new GetJobStatusUseCase(queue);

    const jobId = await enqueueUseCase.execute({ adId: "ad-123", tenantId: "tenant-456" });

    await expect(getStatusUseCase.execute(jobId)).resolves.toMatchObject({
      jobId,
      status: "waiting",
    });
  });
});
