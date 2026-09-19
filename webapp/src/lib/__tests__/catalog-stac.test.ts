import { describe, expect, it, vi } from "vitest";
import { catalogStacUrl, fetchCatalogStac } from "@/lib/catalog-stac";

describe("catalog STAC pass-through", () => {
  it("resolves a published href within the SQLite bucket root", () => {
    expect(
      catalogStacUrl(
        "http://localhost:8333/hifld-local-published/_catalog/catalog.sqlite",
        "hifld/stations/stations/v1.0.0/collection.json",
      ),
    ).toBe("http://localhost:8333/hifld-local-published/hifld/stations/stations/v1.0.0/collection.json");
  });

  it.each(["../private.json", "https://attacker.example/catalog.json", "/other-bucket/catalog.json"])(
    "rejects an href outside the trusted bucket: %s",
    (href) => {
      expect(() =>
        catalogStacUrl("https://storage.example/hifld-local-published/_catalog/catalog.sqlite", href),
      ).toThrow("outside the trusted catalog bucket");
    },
  );

  it("passes through the authored STAC bytes and content type", async () => {
    const bytes = '{"type":"Collection","table:columns":[{"name":"station_id"}]}';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, { headers: { "Content-Type": "application/json", ETag: '"generation-1"' } }),
    );

    const response = await fetchCatalogStac(
      "https://storage.example/hifld-local-published/_catalog/catalog.sqlite",
      "hifld/stations/stations/v1.0.0/collection.json",
      fetcher,
    );

    expect(await response.text()).toBe(bytes);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("etag")).toBe('"generation-1"');
    expect(response.headers.get("content-location")).toBe(
      "https://storage.example/hifld-local-published/hifld/stations/stations/v1.0.0/collection.json",
    );
  });
});
