import { describe, expect, it, vi } from "vitest";

import type { DatasetSource } from "@/lib/api-client";
import {
  buildSourceFileUrl,
  buildSourceStorageUri,
  usesNativeBrowserDownload,
} from "../sourceUrls";

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

  it("builds SeaweedFS filer URLs with the bucket path", () => {
    const source = makeFileSource(
      "http://localhost:8888",
      "12nm-territorial-sea/12nm-territorial-sea/v1.0.0/pmtiles/12nm-territorial-sea.pmtiles",
    );
    if (source.storage_location?.config) {
      source.storage_location.config = {
        ...source.storage_location.config,
        type: "seaweedfs",
      } as unknown as typeof source.storage_location.config;
    }

    expect(buildSourceFileUrl(source)).toBe(
      "http://localhost:8888/buckets/ignored-by-webapp/12nm-territorial-sea/12nm-territorial-sea/v1.0.0/pmtiles/12nm-territorial-sea.pmtiles",
    );
  });

  it("builds DuckDB storage glob URIs from source paths", () => {
    const seaweedSource = makeFileSource(
      "http://localhost:8888",
      "12nm-territorial-sea/12nm-territorial-sea/v1.0.0/geoparquet/12nm-territorial-sea.parquet",
    );
    if (seaweedSource.storage_location?.config) {
      seaweedSource.storage_location.config = {
        ...seaweedSource.storage_location.config,
        type: "seaweedfs",
        endpoint_url: "http://localhost:8333",
      } as unknown as typeof seaweedSource.storage_location.config;
    }

    expect(
      buildSourceStorageUri(seaweedSource, { globExtension: "parquet" }),
    ).toBe(
      "s3://ignored-by-webapp/12nm-territorial-sea/12nm-territorial-sea/v1.0.0/geoparquet/*.parquet?endpoint_url=http://localhost:8333",
    );

    const gcsSource = makeFileSource(
      "https://example.test/storage",
      "nfhl/alluvial-fans/v1.0.0/geoparquet/alluvial-fans.parquet",
    );
    if (gcsSource.storage_location?.config) {
      gcsSource.storage_location.config = {
        ...gcsSource.storage_location.config,
        type: "gcs",
      } as unknown as typeof gcsSource.storage_location.config;
    }

    expect(buildSourceStorageUri(gcsSource, { globExtension: "parquet" })).toBe(
      "gs://ignored-by-webapp/nfhl/alluvial-fans/v1.0.0/geoparquet/*.parquet",
    );
  });

  it("preserves recursive GeoParquet glob storage URIs", () => {
    const recursiveSource = makeFileSource(
      "https://example.test/storage",
      "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet",
    );
    recursiveSource.storage_uri =
      "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet";
    if (recursiveSource.storage_location?.config) {
      recursiveSource.storage_location.config = {
        ...recursiveSource.storage_location.config,
        type: "gcs",
        bucket: "hifld-next-datasets-prod",
      } as unknown as typeof recursiveSource.storage_location.config;
    }

    expect(buildSourceStorageUri(recursiveSource)).toBe(
      "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet",
    );
    expect(buildSourceStorageUri(recursiveSource, { globExtension: "parquet" })).toBe(
      "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet",
    );
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
