import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchMetaApiClient } from "./fetch-meta-api.client.js";

const input = { adId: "ad-123", tenantId: "tenant-456" };

describe("FetchMetaApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns HTTP status for successful responses", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("{}", { status: 200 });
    vi.stubGlobal("fetch", fakeFetch);

    const client = new FetchMetaApiClient({ url: "https://example.com", timeoutMs: 1000 });

    await expect(client.requestTakedown(input)).resolves.toEqual({ status: 200 });
  });

  it("throws for non-2xx responses", async () => {
    const fakeFetch = async (): Promise<Response> => new Response("{}", { status: 500 });
    vi.stubGlobal("fetch", fakeFetch);

    const client = new FetchMetaApiClient({ url: "https://example.com", timeoutMs: 1000 });

    await expect(client.requestTakedown(input)).rejects.toThrow("Meta API returned status 500");
  });

  it("throws a timeout error when the request is aborted", async () => {
    const fakeFetch = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });

      return new Response("{}", { status: 200 });
    };
    vi.stubGlobal("fetch", fakeFetch);

    const client = new FetchMetaApiClient({ url: "https://example.com", timeoutMs: 1 });

    await expect(client.requestTakedown(input)).rejects.toThrow("Meta API request timed out");
  });
});
