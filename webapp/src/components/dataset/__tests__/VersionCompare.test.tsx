import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DatasetSource } from "@/lib/api-client";
import { VersionCompare } from "../VersionCompare";

const sourceA: DatasetSource = {
  id: 1,
  version: "v20260101",
  source_type: "file",
  location: {
    version: "v1",
    path: "test-dataset/test-dataset/v20260101/geoparquet/test-dataset-0.parquet",
  },
  source_metadata: {
    version: "v1",
    feature_count: 10,
    bounds: [0, 0, 1, 1],
    geometry_type: "Polygon",
    columns_hash: "hash-v1",
    columns: [
      {
        name: "district_name",
        type: "STRING",
        description: "Congressional district name",
        nullable: false,
      },
    ],
  },
};

const sourceB: DatasetSource = {
  id: 2,
  version: "v20260214",
  source_type: "file",
  location: {
    version: "v1",
    path: "test-dataset/test-dataset/v20260214/geoparquet/test-dataset-0.parquet",
  },
  source_metadata: {
    version: "v1",
    feature_count: 12,
    bounds: [0, 0, 2, 2],
    geometry_type: "Polygon",
    columns_hash: "hash-v2",
    columns: [
      {
        name: "district_name",
        type: "STRING",
        description: "Congressional district name",
        nullable: false,
      },
      {
        name: "population",
        type: "INTEGER",
        description: "Population estimate",
        nullable: true,
      },
    ],
  },
};

describe("VersionCompare", () => {
  it("renders metadata and schema differences side by side", () => {
    render(<VersionCompare leftSource={sourceA} rightSource={sourceB} />);

    expect(screen.getByText("Metadata Changes")).toBeInTheDocument();
    expect(screen.getByText("Schema Changes")).toBeInTheDocument();
    expect(screen.getByText("feature_count")).toBeInTheDocument();
    expect(screen.getByText("columns_hash")).toBeInTheDocument();
    expect(screen.getByText("population")).toBeInTheDocument();
    expect(screen.getByText("Population estimate")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });

  it("labels added and removed columns relative to the chosen right source", () => {
    render(<VersionCompare leftSource={sourceB} rightSource={sourceA} leftLabel="Left source" rightLabel="Right source" />);

    expect(screen.getAllByText("Right source").length).toBeGreaterThan(0);
    expect(screen.getByText("population")).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });
});
