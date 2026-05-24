import type { TakedownJobData } from "../entities/takedown-job.entity.js";
import type { MetaApiClientService } from "../services/meta-api-client.service.js";

export interface TakedownResult {
  success: boolean;
  status: number;
}

export class ProcessTakedownUseCase {
  constructor(private readonly metaApiClient: MetaApiClientService) {}

  async execute(input: TakedownJobData): Promise<TakedownResult> {
    const response = await this.metaApiClient.requestTakedown(input);

    return {
      success: true,
      status: response.status,
    };
  }
}
