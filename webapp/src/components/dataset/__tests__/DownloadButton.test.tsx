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

import { executeDownload } from "../DownloadButton";

describe("DownloadButton analytics", () => {
  beforeEach(() => {
    capture.mockClear();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "showSaveFilePicker");
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

  it("tracks native browser download handoff without recording success", async () => {
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
      "dataset_download_handed_off",
      expect.objectContaining({
        download_method: "native_link",
        duration_ms: expect.any(Number),
      }),
    );
    expect(capture).not.toHaveBeenCalledWith("dataset_download_succeeded", expect.anything());
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("tracks a File System Access API download as completed without handing it off", async () => {
    const writable = {
      write: vi.fn(),
      close: vi.fn(),
    };
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue(writable),
      }),
    });
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

    expect(writable.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4, 5]));
    expect(writable.close).toHaveBeenCalledOnce();
    expect(capture).not.toHaveBeenCalledWith("dataset_download_handed_off", expect.anything());
  });

  it("tracks save picker cancellation as a failed download without handing it off", async () => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("The user canceled the download", "AbortError")),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("content", { status: 200 })));

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

    expect(capture).toHaveBeenCalledWith(
      "dataset_download_failed",
      expect.objectContaining({
        download_method: "fetch_stream",
        error_message: "Download canceled",
      }),
    );
    expect(capture).not.toHaveBeenCalledWith("dataset_download_succeeded", expect.anything());
    expect(capture).not.toHaveBeenCalledWith("dataset_download_handed_off", expect.anything());
  });

  it("tracks failed fetch downloads and hands the URL off to the browser without recording success", async () => {
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

    expect(capture).toHaveBeenCalledWith(
      "dataset_download_handed_off",
      expect.objectContaining({
        download_method: "fetch_stream",
        duration_ms: expect.any(Number),
      }),
    );
    expect(capture).not.toHaveBeenCalledWith("dataset_download_succeeded", expect.anything());

    const failedEventIndex = capture.mock.calls.findIndex(([eventName]) => eventName === "dataset_download_failed");
    const handoffEventIndex = capture.mock.calls.findIndex(
      ([eventName]) => eventName === "dataset_download_handed_off",
    );
    expect(failedEventIndex).toBeGreaterThanOrEqual(0);
    expect(handoffEventIndex).toBeGreaterThanOrEqual(0);
    expect(failedEventIndex).toBeLessThan(handoffEventIndex);

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
