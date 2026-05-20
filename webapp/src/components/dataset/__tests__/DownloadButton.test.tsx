import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture } = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
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

import { executeDownload } from "../DownloadButton";

describe("DownloadButton analytics", () => {
  beforeEach(() => {
    capture.mockClear();
    vi.useRealTimers();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    document.body.innerHTML = "";
  });

  it("tracks native browser download handoff", async () => {
    vi.useFakeTimers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await executeDownload({
      url: "https://storage.googleapis.com/hifld/file.parquet",
      filename: "file.parquet",
      useDirectDownload: true,
      analyticsContext: {
          collection_slug: "hifld",
          dataset_slug: "dataset",
          file_slug: "file",
          format: "geoparquet",
      },
    });

    expect(capture).toHaveBeenCalledWith(
      "dataset_download_clicked",
      expect.objectContaining({
        collection_slug: "hifld",
        dataset_slug: "dataset",
        file_slug: "file",
        format: "geoparquet",
        filename: "file.parquet",
        url_host: "storage.googleapis.com",
        download_method: "native_link",
      }),
    );
    expect(capture).toHaveBeenCalledWith(
      "dataset_download_succeeded",
      expect.objectContaining({
        download_method: "native_link",
        completion_status: "handoff",
        duration_ms: expect.any(Number),
      }),
    );
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("tracks successful fetch stream downloads with received bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
              controller.close();
            },
          }),
          {
          status: 200,
          headers: {
            "content-length": "5",
            "content-type": "application/octet-stream",
          },
          },
        ),
      ),
    );
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await executeDownload({
      url: "/api/collections/hifld/datasets/dataset/files/file/sources/1/download-zip",
      filename: "file.zip",
      useDirectDownload: false,
      analyticsContext: {
          collection_slug: "hifld",
          dataset_slug: "dataset",
          file_slug: "file",
          format: "shapefile",
      },
    });

    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith(
        "dataset_download_succeeded",
        expect.objectContaining({
          download_method: "fetch_stream",
          filename: "file.zip",
          url_host: "localhost:3000",
          completion_status: "completed",
          received_bytes: 5,
          content_length_bytes: 5,
          duration_ms: expect.any(Number),
        }),
      );
    });

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("tracks failed fetch downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 403, statusText: "Forbidden" })),
    );
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await executeDownload({
      url: "/api/collections/hifld/download",
      filename: "file.zip",
      useDirectDownload: false,
      analyticsContext: {
          collection_slug: "hifld",
          dataset_slug: "dataset",
          file_slug: "file",
          format: "shapefile",
      },
    });

    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith(
        "dataset_download_failed",
        expect.objectContaining({
          download_method: "fetch_stream",
          error_message: "Download failed: Forbidden",
          duration_ms: expect.any(Number),
        }),
      );
    });

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
