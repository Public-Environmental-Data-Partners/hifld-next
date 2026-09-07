import { describe, expect, it } from "vitest";
import type { DatasetFile, DatasetSource, FormatType } from "@/lib/api-client";
import { attachDownloadZipLinksToFile } from "@/lib/api-file-sources";

function source(id: number, path: string): DatasetSource {
  return {
    id,
    source_type: "file",
    location: { version: "v1", path },
  };
}

function fileWith(formatType: FormatType, sources: DatasetSource[]): DatasetFile {
  return {
    id: 1,
    dataset_id: 2,
    name: "Hospitals",
    slug: "hospitals",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    formats: [
      {
        format: {
          id: 3,
          format_type: formatType,
          name: formatType,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        sources,
      },
    ],
  };
}

describe("attachDownloadZipLinksToFile", () => {
  it.each(["shapefile", "file_geodatabase"] as const)("adds a ZIP link to a zipped %s source", (formatType) => {
    const result = attachDownloadZipLinksToFile(
      fileWith(formatType, [source(7, `dataset/v1/${formatType}/dataset.zip`)]),
      "https://example.test",
      "hifld",
      "hospitals",
      "hospitals",
    );

    expect(result.formats?.[0]?.sources[0]).toMatchObject({
      links: {
        download_zip:
          "https://example.test/api/collections/hifld/datasets/hospitals/files/hospitals/sources/7/download-zip",
      },
    });
  });

  it.each([
    ["shapefile", "dataset.shp"],
    ["file_geodatabase", "a00000001.gdbtable"],
    ["geojson", "dataset.zip"],
  ] as const)("does not advertise a ZIP link for %s source %s", (formatType, filename) => {
    const result = attachDownloadZipLinksToFile(
      fileWith(formatType, [source(7, `dataset/v1/${formatType}/${filename}`)]),
      "https://example.test",
      "hifld",
      "hospitals",
      "hospitals",
    );

    expect(result.formats?.[0]?.sources[0]).not.toHaveProperty("links.download_zip");
  });
});
