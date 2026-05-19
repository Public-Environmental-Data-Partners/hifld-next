import { describe, expect, it, vi } from "vitest";

import type { DatasetSource } from "@/lib/api-client";
import { buildSourceFileUrl, usesNativeBrowserDownload } from "../sourceUrls";

function makeFileSource(baseUrl: string, path: string, fallbackUrl?: string): DatasetSource {
  return {
    id: 1,
    source_type: "file",
    url: fallbackUrl,
    location: {
      version: "v1",
      path,
    },
    storage_location: {
      id: 10,
      name: "storage",
      backend_type: "s3",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      config: {
        version: "v1",
        base_url: baseUrl,
        bucket: "ignored-by-webapp",
      },
    },
  };
}

describe("source URL helpers", () => {
  it("builds file URLs from storage location base URL and file path", () => {
    expect(
      buildSourceFileUrl(
        makeFileSource(
          "https://hifld.publicenvirodata.org/storage/",
          "/nfhl/water-lines.pmtiles",
          "https://example.invalid/stale-url",
        ),
      ),
    ).toBe("https://hifld.publicenvirodata.org/storage/nfhl/water-lines.pmtiles");
  });

  it("does not require provider-specific storage hostnames for native downloads", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://hifld.publicenvirodata.org",
      },
    });

    expect(usesNativeBrowserDownload("https://cdn.example.test/data/file.parquet")).toBe(true);
    expect(usesNativeBrowserDownload("/storage/data/file.parquet")).toBe(true);
    expect(usesNativeBrowserDownload("/api/collections/hifld/download")).toBe(false);
  });
});
