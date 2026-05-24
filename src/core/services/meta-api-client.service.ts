import type { TakedownJobData } from "../entities/takedown-job.entity.js";

export interface MetaApiResponse {
  status: number;
}

export interface MetaApiClientService {
  requestTakedown(input: TakedownJobData): Promise<MetaApiResponse>;
}
