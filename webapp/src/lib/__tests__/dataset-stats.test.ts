import { describe, expect, it, vi } from "vitest";

const { stats } = vi.hoisted(() => ({ stats: vi.fn().mockResolvedValue({ total: 7 }) }));

vi.mock("@/lib/catalog-api", () => ({
  sqliteCatalogApi: vi.fn().mockResolvedValue({ stats }),
}));

vi.mock("@/env/server", () => ({
  env: { DATASET_API_URL: "http://dataset-api.invalid" },
}));

import { loadDatasetStats } from "@/lib/api-client";

describe("dataset statistics client", () => {
  it("reads the total from the active SQLite catalog", async () => {
    await expect(loadDatasetStats()).resolves.toEqual({ total: 7 });
    expect(stats).toHaveBeenCalledOnce();
  });
});
