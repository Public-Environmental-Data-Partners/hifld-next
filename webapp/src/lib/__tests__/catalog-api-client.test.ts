import { describe, expect, it } from "vitest";
import { catalogFileResponse } from "@/lib/api-client";
import type { CatalogFileResponse } from "@/lib/catalog-api";
import { parseStacCatalog, parseStacVersionCollection } from "@/lib/stac-view-models";

describe("SQLite catalog file adapter", () => {
  it("projects normalized STAC columns into each versioned source", () => {
    const value: CatalogFileResponse = {
      collection_slug: "hifld",
      dataset_slug: "stations",
      file_slug: "stations",
      file_path: "hifld/stations/stations",
      name: "Stations",
      description: "Station locations",
      latest_version: "v1.0.0",
      created_at: null,
      updated_at: null,
      stac_href: "hifld/stations/stations/v1.0.0/collection.json",
      versions: [],
      version_metadata: [
        {
          version_path: "hifld/stations/stations/v1.0.0",
          version_label: "v1.0.0",
          collection_href: "hifld/stations/stations/v1.0.0/collection.json",
          spatial_status: "spatial",
          crs84_bbox_json: "[1,2,3,4]",
          geometry_type: "Point",
          feature_count: 3,
          is_latest: 1,
          columns: [
            {
              name: "station_id",
              data_type: "string",
              description: "Stable station identifier",
              nullable: false,
              null_count: 0,
              unique_count: 3,
              min_value: "1",
              max_value: "9",
              example_values: ["ST001", "ST002"],
              possible_values: ["ST001", "ST002", "ST003"],
              length: 5,
            },
          ],
          quality: { passed: false, invalid_geometry_count: 2, null_geometry_count: 1, columns_hash: "schema-hash" },
        },
      ],
      assets: [
        {
          version: "v1.0.0",
          asset_key: "geoparquet",
          format_key: "geoparquet",
          title: "GeoParquet",
          media_type: "application/vnd.apache.parquet",
          size_bytes: 12,
          sha256: null,
          checksum_multihash: "d50110000102030405060708090a0b0c0d0e0f",
          storage_location_slug: "local",
          storage_config: { type: "seaweedfs", base_url: "http://localhost:8333", bucket: "published" },
          objects: [
            {
              object_key: "hifld/stations/data file.parquet",
              relative_path: "data file.parquet",
              size_bytes: 12,
              sha256: null,
              checksum_multihash: "d50110000102030405060708090a0b0c0d0e0f",
              storage_revision: "1",
            },
          ],
        },
      ],
    };

    const datasetStac = parseStacCatalog({
      stac_version: "1.1.0",
      type: "Catalog",
      id: "hifld/stations",
      title: "Stations from STAC",
      description: "Authoritative dataset description",
      "hifld:tags": { categories: ["Infrastructure"], inventory_name: "stations" },
      links: [],
    });
    const fileStac = parseStacCatalog({
      stac_version: "1.1.0",
      type: "Catalog",
      id: "hifld/stations/stations",
      title: "Station layer from STAC",
      description: "Authoritative file description",
      links: [],
    });
    const versionStac = parseStacVersionCollection({
      stac_version: "1.1.0",
      type: "Collection",
      id: "hifld/stations/stations/v1.0.0",
      title: "Station layer from STAC",
      description: "Version description",
      license: "other",
      extent: { spatial: { bbox: [[1, 2, 3, 4]] }, temporal: { interval: [[null, null]] } },
      links: [],
      assets: {
        geoparquet: {
          href: "https://published.example/stations.parquet",
          title: "Authored GeoParquet",
          type: "application/vnd.apache.parquet",
          roles: ["data"],
          "file:size": 12,
          "file:checksum": "abc",
        },
      },
      "hifld:feature_count": 3,
      "hifld:geometry_type": "Point",
      "hifld:source_dates": { issued: "2024-06-25", provenance: { issued: "inventory" } },
      "hifld:source_version_description": "Added refreshed station attributes",
      "hifld:source_version_bounds": [100, 200, 300, 400],
      "hifld:quality": {
        passed: false,
        invalid_geometry_count: 2,
        null_geometry_count: 1,
        manifest_href: "metadata/quality.json",
        sampled_feature_count: null,
        sampled_invalid_geometry_count: null,
        sampled_null_geometry_count: null,
        columns_hash: "stac-schema-hash",
        provenance: null,
      },
      "table:columns": [
        {
          name: "station_id",
          type: "string",
          description: "Authored STAC column",
          nullable: false,
          numNullValues: 0,
          numUniqueValues: 3,
          exampleValues: [1, null, "ST002"],
          possibleValues: [1, 2, 3],
          length: 5,
          min: "1",
          max: "9",
        },
      ],
    });

    const result = catalogFileResponse(value, datasetStac, fileStac, new Map([["v1.0.0", versionStac]]));
    expect(result.dataset).toMatchObject({
      name: "Stations from STAC",
      description: "Authoritative dataset description",
      tags: { categories: ["Infrastructure"], inventory_name: "stations" },
    });
    expect(result.file).toMatchObject({ name: "Station layer from STAC", description: "Authoritative file description" });
    expect(result.file.source_dates).toEqual({ issued: "2024-06-25", provenance: { issued: "inventory" } });
    expect(result.file.formats?.[0]?.sources[0]?.source_metadata).toMatchObject({
      version: "v1.0.0",
      description: "Added refreshed station attributes",
      feature_count: 3,
      bounds: [100, 200, 300, 400],
      invalid_geometry_count: 2,
      quality_check_passed: false,
      columns_hash: "stac-schema-hash",
      columns: [
        {
          name: "station_id",
          type: "string",
          description: "Authored STAC column",
          nullable: false,
          example_values: ["1", "null", "ST002"],
          possible_values: ["1", "2", "3"],
          length: 5,
          min: 1,
          max: 9,
        },
      ],
    });
    expect(result.file.formats?.[0]?.sources[0]?.storage_location?.config).toEqual({
      version: "v1.0.0",
      type: "seaweedfs",
      base_url: "http://localhost:8333",
      bucket: "published",
    });
    expect(result.file.formats?.[0]?.sources[0]?.id).toBe("v1.0.0/geoparquet");
    expect(result.file.formats?.[0]?.sources[0]).toMatchObject({
      sha256: null,
      checksum_multihash: "d50110000102030405060708090a0b0c0d0e0f",
    });
    expect(result.file.formats?.[0]?.sources[0]?.url).toBe(
      "http://localhost:8333/published/hifld/stations/data%20file.parquet",
    );
  });
});
