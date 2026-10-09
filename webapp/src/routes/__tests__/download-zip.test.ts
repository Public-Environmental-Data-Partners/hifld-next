import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogZipRedirect,
  fetchZipFromDatasetApi,
  forwardZipResponse,
  legacyZipCollectionId,
} from "../api/collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.sources.$sourceId.download-zip";
import type { CatalogAsset } from "@/lib/catalog-api";

const params = {
  collectionSlug: "hifld",
  datasetSlug: "hospitals",
  fileSlug: "hospitals",
  sourceId: "7",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("download ZIP proxy", () => {
  it("keeps numeric ZIP source compatibility using the real legacy collection ID", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([{ id: 42, slug: "hifld" }]));
    expect(await legacyZipCollectionId("https://legacy.example", "hifld")).toBe("42");
    expect(fetch).toHaveBeenCalledWith("https://legacy.example/api/collections", expect.anything());
  });

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

  it("requests the dataset API without following its object-storage redirect", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 302 }));

    await fetchZipFromDatasetApi("https://api.example.test/download-zip", new Request("https://web.example.test"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/download-zip",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("forwards a valid object-storage redirect without reading the ZIP body", async () => {
    const result = await forwardZipResponse(
      new Response(null, {
        status: 302,
        headers: { Location: "https://storage.googleapis.com/hifld/hospitals.zip?signature=abc" },
      }),
      params,
    );

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe(
      "https://storage.googleapis.com/hifld/hospitals.zip?signature=abc",
    );
  });

  it("rejects successful archive bodies instead of proxying them", async () => {
    const result = await forwardZipResponse(new Response("zip bytes", { status: 200 }), params);

    expect(result.status).toBe(502);
  });
});
