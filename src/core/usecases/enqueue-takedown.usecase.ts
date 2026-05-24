import type { TakedownJobData } from "../entities/takedown-job.entity.js";
import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";

export class EnqueueTakedownUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}

  async execute(input: TakedownJobData): Promise<string> {
    return this.queue.enqueue(input);
  }
}
