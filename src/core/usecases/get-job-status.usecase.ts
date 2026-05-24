import type { JobStatus } from "../entities/takedown-job.entity.js";
import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";

export class GetJobStatusUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}

  async execute(jobId: string): Promise<JobStatus | null> {
    return this.queue.getStatus(jobId);
  }
}
