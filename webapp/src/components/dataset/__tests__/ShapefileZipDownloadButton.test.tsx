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

vi.mock("@/lib/zip-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/zip-utils")>("@/lib/zip-utils");
  return {
    ...actual,
    createZipFromUrls: vi.fn(async (_files, _filename, onProgress) => {
      onProgress?.(100);
    }),
  };
});

import { executeShapefileZipDownload } from "../ShapefileZipDownloadButton";

describe("ShapefileZipDownloadButton analytics", () => {
  beforeEach(() => {
    capture.mockClear();
  });

  it("tracks successful client zip creation", async () => {
    await executeShapefileZipDownload({
      filename: "shape.zip",
      sources: [
          {
            id: 1,
            url: "https://storage.googleapis.com/hifld/shape.shp",
            location: { path: "shape.shp" },
          },
          {
            id: 2,
            url: "https://storage.googleapis.com/hifld/shape.dbf",
            location: { path: "shape.dbf" },
          },
      ],
      analyticsContext: {
          collection_slug: "hifld",
          dataset_slug: "dataset",
          file_slug: "file",
          format: "shapefile",
          expected_size_bytes: 123,
      },
    });

    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith(
        "dataset_download_succeeded",
        expect.objectContaining({
          collection_slug: "hifld",
          dataset_slug: "dataset",
          file_slug: "file",
          format: "shapefile",
          expected_size_bytes: 123,
          filename: "shape.zip",
          url_host: "storage.googleapis.com",
          download_method: "client_zip",
          completion_status: "completed",
          source_count: 2,
          received_bytes: 123,
          duration_ms: expect.any(Number),
        }),
      );
    });

    expect(capture).toHaveBeenCalledWith(
      "dataset_download_clicked",
      expect.objectContaining({
        download_method: "client_zip",
        source_count: 2,
      }),
    );
    expect(capture).not.toHaveBeenCalledWith("dataset_download_handed_off", expect.anything());
  });

  it("tracks empty shapefile source lists as failed downloads", async () => {
    await executeShapefileZipDownload({
      filename: "shape.zip",
      sources: [],
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
        download_method: "client_zip",
        source_count: 0,
        error_message: "No shapefile URLs found in sources",
      }),
    );
  });
});
