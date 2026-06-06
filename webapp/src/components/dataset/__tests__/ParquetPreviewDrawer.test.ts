import { describe, expect, it } from "vitest";

import type { ParquetPreviewOption, ParquetPreviewSelection } from "../parquetPreviewOptions";
import { findSelectedParquetOption } from "../ParquetPreviewDrawer";

function option(sourceId: number, storageLocationId: number, version: string, fileName: string): ParquetPreviewOption {
  return {
    sourceId,
    storageLocationId,
    version,
    fileName,
    storageLocationName: `Location ${storageLocationId}`,
    path: `datasets/${version}/${fileName}`,
    url: `http://localhost:8333/datasets/${version}/${fileName}`,
  };
}

describe("findSelectedParquetOption", () => {
  it("uses the concrete source id before falling back to location and version", () => {
    const options = [
      option(10, 4, "v1.0.0", "part-000.parquet"),
      option(11, 4, "v1.0.0", "part-001.parquet"),
    ];
    const selection: ParquetPreviewSelection = {
      storageLocationId: 4,
      version: "v1.0.0",
      sourceId: 11,
    };

    expect(findSelectedParquetOption(options, selection)?.sourceId).toBe(11);
  });

  it("falls back explicitly when the selected source no longer exists", () => {
    const options = [
      option(10, 4, "v1.0.0", "part-000.parquet"),
      option(20, 7, "v2.0.0", "part-000.parquet"),
    ];
    const selection: ParquetPreviewSelection = {
      storageLocationId: 4,
      version: "v1.0.0",
      sourceId: 99,
    };

    expect(findSelectedParquetOption(options, selection)?.sourceId).toBe(10);
  });
});
