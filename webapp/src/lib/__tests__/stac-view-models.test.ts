import { describe, expect, it } from "vitest";
import { parseStacCatalog, parseStacVersionCollection, stacColumnMetadata } from "@/lib/stac-view-models";

describe("STAC UI view models", () => {
  it("parses authored catalog metadata and grouped tags", () => {
    const catalog = parseStacCatalog({
      stac_version: "1.1.0",
      type: "Catalog",
      id: "hifld/hospitals",
      title: "Hospitals from STAC",
      description: "Published description",
      keywords: ["health", "facilities"],
      "hifld:tags": { categories: ["Health", "Emergency"], inventory_name: "hospitals" },
      links: [{ rel: "child", href: "hospitals/catalog.json", type: "application/json" }],
    });

    expect(catalog.title).toBe("Hospitals from STAC");
    expect(catalog.tags).toEqual({ categories: ["Health", "Emergency"], inventory_name: "hospitals" });
    expect(catalog.links[0]?.href).toBe("hospitals/catalog.json");
  });

  it("preserves STAC column JSON values and quality nulls", () => {
    const collection = parseStacVersionCollection({
      stac_version: "1.1.0",
      stac_extensions: [],
      type: "Collection",
      id: "hifld/hospitals/hospitals/v2",
      title: "Hospitals",
      description: "Published version",
      license: "other",
      extent: { spatial: { bbox: [[-1, -2, 3, 4]] }, temporal: { interval: [[null, null]] } },
      links: [],
      assets: {},
      "hifld:feature_count": 5,
      "hifld:geometry_type": "Point",
      "hifld:source_dates": {
        issued: "2024-06-25",
        modified: "2020-10-21",
        provenance: { issued: "inventory", modified: "inventory" },
      },
      "hifld:quality": {
        passed: false,
        invalid_geometry_count: 2,
        null_geometry_count: 1,
        manifest_href: "metadata/quality.json",
        sampled_feature_count: null,
        sampled_invalid_geometry_count: null,
        sampled_null_geometry_count: null,
        columns_hash: null,
        provenance: null,
      },
      "table:columns": [
        {
          name: "rank",
          type: "int64",
          nullable: true,
          numNullValues: 0,
          numUniqueValues: null,
          exampleValues: [1, null, 3.5],
          possibleValues: [1, 2],
          min: "1.0",
          max: "3.5",
          length: null,
        },
      ],
    });

    expect(stacColumnMetadata(collection.columns[0]!)).toEqual({
      name: "rank",
      type: "int64",
      nullable: true,
      num_null_values: 0,
      num_unique_values: null,
      example_values: [1, null, 3.5],
      possible_values: [1, 2],
      min: "1.0",
      max: "3.5",
      length: null,
    });
    expect(collection.quality.columns_hash).toBeNull();
    expect(collection.sourceDates).toEqual({
      issued: "2024-06-25",
      modified: "2020-10-21",
      provenance: { issued: "inventory", modified: "inventory" },
    });
  });
});
