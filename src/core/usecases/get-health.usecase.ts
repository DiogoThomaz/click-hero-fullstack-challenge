import type { TakedownJobQueueRepository } from "../repositories/takedown-job-queue.repository.js";

export interface HealthStatus {
  status: "ok" | "degraded";
  checks: {
    redis: boolean;
    api: true;
  };
}

export class GetHealthUseCase {
  constructor(private readonly queue: TakedownJobQueueRepository) {}

  async execute(): Promise<HealthStatus> {
    const redis = await this.queue.isHealthy();

    return {
      status: redis ? "ok" : "degraded",
      checks: {
        redis,
        api: true,
      },
    };
  }
}
