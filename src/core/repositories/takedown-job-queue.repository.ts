import type { JobStatus, TakedownJobData } from "../entities/takedown-job.entity.js";

export interface TakedownJobQueueRepository {
  enqueue(input: TakedownJobData): Promise<string>;
  getStatus(jobId: string): Promise<JobStatus | null>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}
