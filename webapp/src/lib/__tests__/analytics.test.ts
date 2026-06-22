import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
const init = vi.fn((_key: string, options: { loaded?: (posthog: unknown) => void }) => {
  options.loaded?.({ capture });
});

vi.mock("posthog-js", () => ({
  default: {
    init,
    capture,
  },
}));

describe("download analytics", () => {
  beforeEach(async () => {
    capture.mockClear();
    init.mockClear();
    vi.resetModules();
    window.__HIFLD_CLIENT_CONFIG__ = {
      posthogKey: "ph_runtime",
      posthogHost: "https://posthog-runtime.test",
    };
  });

  it("initializes PostHog from runtime client config", async () => {
    const { trackPageView } = await import("../analytics");

    trackPageView("/collections");

    expect(init).toHaveBeenCalledWith(
      "ph_runtime",
      expect.objectContaining({
        api_host: "https://posthog-runtime.test",
      }),
    );
    expect(capture).toHaveBeenCalledWith("$pageview", expect.objectContaining({ path: "/collections" }));
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

  it("tracks dataset quality feedback with feature JSON and no geometry", async () => {
    const { trackDatasetQualityFeedbackSubmitted } = await import("../analytics");

    trackDatasetQualityFeedbackSubmitted({
      reporter_email: "analyst@example.com",
      comment: "The address looks wrong.",
      collection_slug: "hifld",
      dataset_slug: "hospitals-3",
      file_slug: "hospitals-3",
      version: "v1.1.0",
      source_id: 17,
      feature: {
        id: "feature-1",
        loadedLayerId: "layer-1",
        layerName: "Hospitals",
        collectionSlug: "hifld",
        datasetSlug: "hospitals-3",
        fileSlug: "hospitals-3",
        version: "v1.1.0",
        sourceId: 17,
        sourceLayerId: "hospitals",
        featureId: "123",
        centroid: { lng: -77.0365, lat: 38.8977 },
        properties: { NAME: "General Hospital" },
        geometry: { type: "Point", coordinates: [-77.0365, 38.8977] },
      },
    });

    expect(capture).toHaveBeenCalledWith("dataset_quality_feedback_submitted", {
      reporter_email: "analyst@example.com",
      comment: "The address looks wrong.",
      collection_slug: "hifld",
      dataset_slug: "hospitals-3",
      file_slug: "hospitals-3",
      version: "v1.1.0",
      source_id: 17,
      current_url: "http://localhost:3000/",
      feature_json: JSON.stringify({
        id: "feature-1",
        loadedLayerId: "layer-1",
        layerName: "Hospitals",
        collectionSlug: "hifld",
        datasetSlug: "hospitals-3",
        fileSlug: "hospitals-3",
        version: "v1.1.0",
        sourceId: 17,
        sourceLayerId: "hospitals",
        featureId: "123",
        centroid: { lng: -77.0365, lat: 38.8977 },
        properties: { NAME: "General Hospital" },
      }),
    });
  });
});
