import type { MetaApiClientService, MetaApiResponse } from "../../core/services/meta-api-client.service.js";
import type { TakedownJobData } from "../../core/entities/takedown-job.entity.js";

export interface FetchMetaApiClientConfig {
  url: string;
  timeoutMs: number;
}

export class FetchMetaApiClient implements MetaApiClientService {
  constructor(private readonly config: FetchMetaApiClientConfig) {}

  async requestTakedown(input: TakedownJobData): Promise<MetaApiResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Meta API returned status ${response.status}`);
      }

      console.log(`Takedown successful for adId=${input.adId}, tenantId=${input.tenantId}`);

      return { status: response.status };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Meta API request timed out");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
