import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DatasetWithUrls } from "@/lib/api-client";
import { FormatSourceSelector } from "../FormatSourceSelector";
const formatEntry: NonNullable<DatasetWithUrls["formats"]>[0] = {
  format: {
    id: 1,
    format_type: "geoparquet",
    name: "GeoParquet",
    description: "GeoParquet",
    mime_type: "application/parquet",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  file_format: {
    id: 1,
    dataset_id: 1,
    format_id: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  sources: [
    {
      id: 11,
      version: "v20260407T210201Z",
      source_type: "file",
      location: { version: "v1", path: "foo/v20260407T210201Z/file.parquet" },
      source_metadata: { version: "v1" },
      storage_location: {
        id: 4,
        name: "SeaweedFS drp-hifld-copy-formatted",
        backend_type: "s3",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    },
    {
      id: 10,
      version: "v20260407T205332Z",
      source_type: "file",
      location: { version: "v1", path: "foo/v20260407T205332Z/file.parquet" },
      source_metadata: { version: "v1" },
      storage_location: {
        id: 4,
        name: "SeaweedFS drp-hifld-copy-formatted",
        backend_type: "s3",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    },
  ],
} as unknown as NonNullable<DatasetWithUrls["formats"]>[0];

describe("version label formatting", () => {
  it("does not add a second leading v in FormatSourceSelector", () => {
    render(
      <FormatSourceSelector
        formatType="geoparquet"
        formatEntry={formatEntry}
        selectedSource={{
          storageLocationId: 4,
          version: "v20260407T210201Z" as unknown as number,
        }}
        onSourceChange={() => {}}
      />
    );

    expect(screen.getByText("v20260407T210201Z")).toBeInTheDocument();
    expect(screen.queryByText("vv20260407T210201Z")).not.toBeInTheDocument();
  });
});
