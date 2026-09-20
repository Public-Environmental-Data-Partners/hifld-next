import { describe, expect, it, vi } from "vitest";

const { activeCatalogStacUrl } = vi.hoisted(() => ({
  activeCatalogStacUrl: vi.fn().mockResolvedValue(
    "https://storage.example/releases/new/_catalog/catalog.sqlite",
  ),
}));

vi.mock("@/lib/catalog-runtime", () => ({ activeCatalogStacUrl }));

vi.mock("@/env/server", () => ({
  env: { DATASET_API_URL: "https://dataset-api.example" },
}));

import { publishedCatalogUrl } from "@/lib/api-client";

describe("published catalog API client", () => {
  it("resolves STAC from the active release when no fixed SQLite URL is configured", async () => {
    await expect(publishedCatalogUrl()).resolves.toBe(
      "https://storage.example/releases/new/_catalog/catalog.sqlite",
    );
    expect(activeCatalogStacUrl).toHaveBeenCalledOnce();
  });
});
