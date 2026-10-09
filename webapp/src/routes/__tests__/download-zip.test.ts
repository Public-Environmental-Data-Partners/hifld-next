import { describe, expect, it } from "vitest";
import { catalogZipRedirect } from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.sources.$sourceId.download-zip";
import type { CatalogAsset } from "@/lib/catalog-api";

describe("published ZIP downloads", () => {
  it("redirects a qualified catalog source directly to storage without a legacy lookup", () => {
    const asset: CatalogAsset = {
      version: "v1.0.0", asset_key: "shapefile", format_key: "shapefile", title: "Shapefile",
      media_type: "application/zip", size_bytes: 12, sha256: null, checksum_multihash: null,
      storage_location_slug: "local",
      storage_config: { type: "seaweedfs", base_url: "http://localhost:8333", bucket: "published" },
      objects: [{ object_key: "hifld/hospitals/v1.0.0/shapefile/hospitals.zip", relative_path: "hospitals.zip", size_bytes: 12, sha256: null, checksum_multihash: null, storage_revision: null }],
    };
    const response = catalogZipRedirect([asset], "v1.0.0/shapefile");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost:8333/published/hifld/hospitals/v1.0.0/shapefile/hospitals.zip");
    expect(catalogZipRedirect([asset], "7").status).toBe(404);
    expect(catalogZipRedirect([{ ...asset, media_type: "application/vnd.apache.parquet" }], "v1.0.0/shapefile").status).toBe(404);
    expect(catalogZipRedirect([{ ...asset, objects: [...asset.objects, ...asset.objects] }], "v1.0.0/shapefile").status).toBe(404);
  });

});
