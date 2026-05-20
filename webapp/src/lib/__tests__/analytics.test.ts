import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn((_key: string, options: { loaded?: (posthog: unknown) => void }) => {
      options.loaded?.({ capture });
    }),
    capture,
  },
}));

vi.mock("@/env/client", () => ({
  env: {
    PUBLIC_POSTHOG_KEY: "ph_test",
    PUBLIC_POSTHOG_HOST: "https://posthog.test",
    PUBLIC_DATASET_API_URL: "https://api.test",
  },
}));

describe("download analytics", () => {
  beforeEach(async () => {
    capture.mockClear();
  });

  it("tracks a download click without full URLs or undefined fields", async () => {
    const { trackDownloadClicked } = await import("../analytics");

    trackDownloadClicked({
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      source_id: 42,
      storage_location_id: 7,
      version: "v1",
      expected_size_bytes: 1234,
      filename: "runways.parquet",
      url_host: "storage.googleapis.com",
      download_method: "native_link",
    });

    expect(capture).toHaveBeenCalledWith("dataset_download_clicked", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      source_id: 42,
      storage_location_id: 7,
      version: "v1",
      expected_size_bytes: 1234,
      filename: "runways.parquet",
      url_host: "storage.googleapis.com",
      download_method: "native_link",
    });
  });

  it("tracks download success with byte counts and duration", async () => {
    const { trackDownloadSucceeded } = await import("../analytics");

    trackDownloadSucceeded(
      {
        collection_slug: "hifld",
        dataset_slug: "airport-runways",
        file_slug: "runways",
        format: "geoparquet",
        download_method: "fetch_stream",
      },
      {
        completion_status: "completed",
        received_bytes: 20,
        content_length_bytes: 20,
        duration_ms: 125,
      },
    );

    expect(capture).toHaveBeenCalledWith("dataset_download_succeeded", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      download_method: "fetch_stream",
      completion_status: "completed",
      received_bytes: 20,
      content_length_bytes: 20,
      duration_ms: 125,
    });
  });

  it("tracks download failure with error metadata", async () => {
    const { trackDownloadFailed } = await import("../analytics");

    trackDownloadFailed(
      {
        collection_slug: "hifld",
        dataset_slug: "airport-runways",
        file_slug: "runways",
        format: "geoparquet",
        download_method: "fetch_stream",
      },
      {
        error_message: "Download failed: Unauthorized",
        received_bytes: 5,
        content_length_bytes: 10,
        duration_ms: 90,
      },
    );

    expect(capture).toHaveBeenCalledWith("dataset_download_failed", {
      collection_slug: "hifld",
      dataset_slug: "airport-runways",
      file_slug: "runways",
      format: "geoparquet",
      download_method: "fetch_stream",
      error_message: "Download failed: Unauthorized",
      received_bytes: 5,
      content_length_bytes: 10,
      duration_ms: 90,
    });
  });
});
