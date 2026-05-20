import { describe, expect, it } from "vitest";

import type { DatasetSource } from "@/lib/api-client";
import {
  buildGeoparquetSourceTree,
  formatGeoparquetGlobLabel,
} from "../geoparquetTree";

function makeSource(path: string): DatasetSource {
  return {
    id: path.length,
    source_type: "file",
    location: {
      version: "v1.0.0",
      path,
    },
  } as DatasetSource;
}

describe("geoparquet tree helpers", () => {
  it("labels recursive and flat glob nodes distinctly", () => {
    expect(
      formatGeoparquetGlobLabel(
        "gs://bucket/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet",
      ),
    ).toBe("**/*.parquet (glob)");
    expect(
      formatGeoparquetGlobLabel(
        "gs://bucket/12nm-territorial-sea/12nm-territorial-sea/v1.0.0/geoparquet/*.parquet",
      ),
    ).toBe("*.parquet (glob)");
  });

  it("groups expanded nested parquet paths by folders below the format root", () => {
    const tree = buildGeoparquetSourceTree([
      makeSource(
        "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=01/part-000.parquet",
      ),
      makeSource(
        "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=02/part-000.parquet",
      ),
      makeSource("wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet"),
    ]);

    expect(tree).toMatchObject([
      {
        name: "huc2=01",
        type: "folder",
        children: [{ name: "part-000.parquet", type: "file" }],
      },
      {
        name: "huc2=02",
        type: "folder",
        children: [{ name: "part-000.parquet", type: "file" }],
      },
    ]);
  });
});
