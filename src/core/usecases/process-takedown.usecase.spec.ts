import { describe, expect, it } from "vitest";
import type { TakedownJobData } from "../entities/takedown-job.entity.js";
import type { MetaApiClientService, MetaApiResponse } from "../services/meta-api-client.service.js";
import { ProcessTakedownUseCase } from "./process-takedown.usecase.js";

class SuccessfulMetaApiClient implements MetaApiClientService {
  async requestTakedown(_input: TakedownJobData): Promise<MetaApiResponse> {
    return { status: 200 };
  }
}

class FailingMetaApiClient implements MetaApiClientService {
  async requestTakedown(_input: TakedownJobData): Promise<MetaApiResponse> {
    throw new Error("Meta API returned status 500");
  }
}

describe("ProcessTakedownUseCase", () => {
  it("returns success when the Meta API client succeeds", async () => {
    const useCase = new ProcessTakedownUseCase(new SuccessfulMetaApiClient());

    await expect(useCase.execute({ adId: "ad-123", tenantId: "tenant-456" })).resolves.toEqual({
      success: true,
      status: 200,
    });
  });

  it("propagates failures so BullMQ can retry", async () => {
    const useCase = new ProcessTakedownUseCase(new FailingMetaApiClient());

    await expect(useCase.execute({ adId: "ad-123", tenantId: "tenant-456" })).rejects.toThrow(
      "Meta API returned status 500",
    );
  });
});
