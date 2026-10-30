import { describe, expect, it, vi } from "vitest";
import { catalogAssetUrl, catalogFileResponse } from "@/lib/api-client";
import type { CatalogAsset, CatalogFileResponse } from "@/lib/catalog-api";

const asset: CatalogAsset = {
  version: "v1", asset_key: "raw-json", format_key: "json", title: "Raw JSON",
  media_type: "application/json", size_bytes: 24, sha256: null, checksum_multihash: null,
  storage_location_slug: "published", storage_config: { type: "gcs", base_url: "https://storage.example", bucket: "data" },
  objects: ["raw/a/data #1.json", "raw/b/data #1.json"].map((path) => ({
    object_key: `collection/dataset/file/v1/${path}`, relative_path: path,
    size_bytes: 12, sha256: "abc123", checksum_multihash: null, storage_revision: "rev1",
  })),
};
const file: CatalogFileResponse = {
  collection_slug: "collection", dataset_slug: "dataset", file_slug: "file", file_path: "collection/dataset/file",
  name: "File", description: "", latest_version: "v1", created_at: null, updated_at: null,
  versions: [], version_metadata: [], assets: [asset], stac_href: null,
};

describe("catalog physical objects", () => {
  it("preserves nested JSON objects and checksums without requesting storage", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const source = catalogFileResponse(file).file.formats?.[0]?.sources[0];
    expect(source?.objects).toEqual(asset.objects.map((object) => ({ ...object,
      url: `https://storage.example/data/${object.object_key.replace(' #', '%20%23')}`,
    })));
    expect(source?.location).toEqual({ version: "v1", path: "" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("encodes URL delimiters, literal percent signs and Unicode in object keys", () => {
    const object = asset.objects[0];
    if (!object) throw new Error("Missing test object");
    expect(catalogAssetUrl(asset, { ...object, object_key: "raw/雪 +%?#.json" })).toBe(
      "https://storage.example/data/raw/%E9%9B%AA%20%2B%25%3F%23.json",
    );
  });
  it("creates encoded URLs for each indexed object while preserving single-object compatibility", () => {
    expect(catalogAssetUrl(asset)).toBeUndefined();
    expect(catalogAssetUrl(asset, asset.objects[1])).toBe("https://storage.example/data/collection/dataset/file/v1/raw/b/data%20%231.json");
    expect(catalogAssetUrl({ ...asset, objects: asset.objects.slice(0, 1) })).toBe("https://storage.example/data/collection/dataset/file/v1/raw/a/data%20%231.json");
  });
});
