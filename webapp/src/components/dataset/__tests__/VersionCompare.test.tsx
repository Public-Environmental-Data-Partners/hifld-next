import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DatasetSource } from "@/lib/api-client";
import { VersionCompare } from "../VersionCompare";
import { compareFileVersions } from "@/lib/webmcp/versionComparisonTool";

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
  it("returns no changes for identical sources without row data", () => {
    expect(compareFileVersions(sourceA, sourceA)).toEqual({
      left_version: "v20260101",
      right_version: "v20260101",
      changed_metadata: [],
      added_columns: [],
      removed_columns: [],
      changed_columns: [],
    });
  });

  it("returns bounded metadata and schema changes", () => {
    const result = compareFileVersions(sourceA, sourceB);

    expect(result.left_version).toBe("v20260101");
    expect(result.right_version).toBe("v20260214");
    expect(result.changed_metadata.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(["feature_count", "bounds", "columns_hash"]),
    );
    expect(result.added_columns).toEqual(["population"]);
    expect(result.removed_columns).toEqual([]);
    expect(result.changed_columns).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("parquet");
    expect(JSON.stringify(result)).not.toContain("path");
  });

  it("bounds changed columns and marks the result when the schema is truncated", () => {
    const left: DatasetSource = { ...sourceA, source_metadata: { ...sourceA.source_metadata, columns: [] } };
    const right: DatasetSource = {
      ...sourceB,
      source_metadata: {
        ...sourceB.source_metadata,
        columns: Array.from({ length: 30 }, (_, index) => ({
          name: `column_${index}`,
          type: "STRING",
          nullable: true,
        })),
      },
    };

    const result = compareFileVersions(left, right);

    expect(result.added_columns).toHaveLength(25);
    expect(result.truncated).toBe(true);
  });

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

  it("handles null size metadata in the metadata table without crashing", () => {
    const sourceWithNullSize: DatasetSource = {
      ...sourceB,
      source_metadata: {
        ...sourceB.source_metadata,
        version: "v1",
        size_bytes: null,
      },
    };

    render(<VersionCompare leftSource={sourceA} rightSource={sourceWithNullSize} />);

    expect(screen.getByText("size_bytes")).toBeInTheDocument();
  });

  it("renders metadata descriptions as safe markdown", () => {
    const sourceWithMarkdown: DatasetSource = {
      ...sourceB,
      source_metadata: {
        ...sourceB.source_metadata,
        version: "v1",
        description: "Updated by [Niyam IT](https://niyamit.com).",
      },
    };

    render(<VersionCompare leftSource={sourceA} rightSource={sourceWithMarkdown} />);

    const link = screen.getByRole("link", { name: "Niyam IT" });
    expect(link).toHaveAttribute("href", "https://niyamit.com");
  });

  it("does not show summary cards above the diff tables", () => {
    render(<VersionCompare leftSource={sourceA} rightSource={sourceB} />);

    expect(screen.queryByText("Rows")).not.toBeInTheDocument();
    expect(screen.queryByText("Changed Fields")).not.toBeInTheDocument();
    expect(screen.queryByText("Size")).not.toBeInTheDocument();
  });

  it("does not duplicate quality status in the summary cards", () => {
    render(<VersionCompare leftSource={sourceA} rightSource={sourceB} />);

    expect(screen.queryByText("Quality")).not.toBeInTheDocument();
    expect(screen.getByText("quality_check_passed")).toBeInTheDocument();
  });

  it("does not mark columns changed unless the datatype changes", () => {
    const left: DatasetSource = {
      ...sourceA,
      source_metadata: {
        ...sourceA.source_metadata,
        columns_hash: "same-visible-schema",
        columns: [
          {
            name: "district_name",
            type: "STRING",
            description: "Congressional district name",
            nullable: false,
            example_values: ["A"],
            length: 10,
            possible_values: ["A", "B"],
          },
        ],
      },
    };
    const right: DatasetSource = {
      ...sourceB,
      source_metadata: {
        ...sourceB.source_metadata,
        columns_hash: "same-visible-schema-next",
        columns: [
          {
            name: "district_name",
            type: "STRING",
            description: "Updated but not datatype",
            nullable: true,
            example_values: ["B"],
            length: 20,
            possible_values: ["C", "D"],
          },
        ],
      },
    };

    render(<VersionCompare leftSource={left} rightSource={right} />);

    expect(screen.getByText("No schema changes")).toBeInTheDocument();
  });
});
