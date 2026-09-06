import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DatasetFormat, DatasetSource } from "@/lib/api-client";
import { ArchiveFormatNode, archiveDownloadSource, sourceLifecycleDetails } from "../FileFormatTree";

vi.mock("../DownloadButton", () => ({
  DownloadButton: ({ url, label }: { url: string; label: string }) => <a href={url}>{label}</a>,
}));

const createdAt = "2026-05-24T14:30:00Z";
const updatedAt = "2026-05-29T15:45:00Z";

function source({
  sourceMetadata,
  created_at,
  updated_at,
}: {
  sourceMetadata?: DatasetSource["source_metadata"];
  created_at?: string | undefined;
  updated_at?: string | undefined;
}): DatasetSource {
  return {
    id: 19,
    version: "v1.1.0",
    source_type: "file",
    url: "http://localhost:3000/files/hospitals.pmtiles",
    location: {
      version: "v1",
      path: "hospitals-3/hospitals-3/v1.1.0/pmtiles/hospitals.pmtiles",
    },
    created_at,
    updated_at,
    source_metadata: sourceMetadata,
  };
}

describe("FileFormatTree", () => {
  it.each(["shapefile", "file_geodatabase"] as const)(
    "selects only a ZIP archive source for %s downloads",
    (formatType) => {
      const zipSource = source({ sourceMetadata: { version: "v1", size_bytes: 1536 } });
      zipSource.location = { version: "v1", path: `dataset/v1/${formatType}/dataset.zip` };
      const componentSource = source({ sourceMetadata: { version: "v1", size_bytes: 4096 } });
      componentSource.id = 20;
      componentSource.location = { version: "v1", path: `dataset/v1/${formatType}/dataset.shp` };

      expect(archiveDownloadSource([componentSource, zipSource])).toBe(zipSource);
      expect(archiveDownloadSource([componentSource])).toBeUndefined();
    },
  );

  it("renders the archive source URL as the shapefile download target", () => {
    const zipSource = source({ sourceMetadata: { version: "v1", size_bytes: 1536 } });
    zipSource.url = "https://objects.example.test/hospitals.zip";
    zipSource.location = { version: "v1", path: "dataset/v1/shapefile/hospitals.zip" };
    zipSource.storage_location = {
      id: 5,
      name: "archive",
      backend_type: "s3",
      created_at: createdAt,
      updated_at: updatedAt,
    };
    const formatEntry: DatasetFormat = {
      format: {
        id: 3,
        format_type: "shapefile",
        name: "Shapefile",
        created_at: createdAt,
        updated_at: updatedAt,
      },
      sources: [zipSource],
    };

    render(
      <ArchiveFormatNode
        formatEntry={formatEntry}
        formatType="shapefile"
        name="shapefile"
        icon={<span />}
        selectedSources={{ shapefile: { storageLocationId: 5, version: "v1.1.0" } }}
        onSourceChange={vi.fn()}
        isExpanded
        onToggle={vi.fn()}
        collectionSlug="hifld"
        datasetSlug="hospitals"
        fileSlug="hospitals"
      />,
    );

    expect(screen.getByRole("link", { name: "Download ZIP" })).toHaveAttribute(
      "href",
      "https://objects.example.test/hospitals.zip",
    );
  });

  it("formats source catalog date and size for source details", () => {
    const details = sourceLifecycleDetails(
      source({ sourceMetadata: { version: "v1", size_bytes: 1536 }, created_at: createdAt, updated_at: updatedAt }),
    );

    expect(details).toEqual([
      expect.objectContaining({ label: "Cataloged", value: expect.stringContaining("May 24, 2026") }),
      { label: "Size", value: "1.5 KB" },
    ]);
    expect(details.some((detail) => detail.label === "Last metadata update")).toBe(false);
  });

  it("omits misleading source metadata when timestamps and size are missing", () => {
    const details = sourceLifecycleDetails(
      source({
        sourceMetadata: { version: "v1" },
        created_at: undefined,
        updated_at: undefined,
      }),
    );

    expect(details).toEqual([]);
  });
});
