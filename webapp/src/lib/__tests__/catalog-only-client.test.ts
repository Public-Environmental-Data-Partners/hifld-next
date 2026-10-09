import { afterEach, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: <T,>(validate: (data: T) => T) => ({
      handler: <R,>(handler: (context: { data: T }) => R) => (context: { data: T }) =>
        handler({ data: validate(context.data) }),
    }),
    handler: <R,>(handler: () => R) => handler,
  }),
  createServerOnlyFn: <T,>(handler: T) => handler,
}));

vi.mock("@/env/server", () => ({ env: { DATASET_API_URL: "https://retired.example" } }));
vi.mock("@/lib/catalog-api", () => ({
  sqliteCatalogApi: async () => ({ collection: async () => null }),
}));

import { getCollectionById, getDatasetById, getDatasetFileById, getFileVersions } from "@/lib/api-client";

afterEach(() => vi.restoreAllMocks());

it("returns not found for retired numeric IDs without requesting the retired API", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: 7 }));
  await expect(getCollectionById({ data: { id: "7" } })).resolves.toBeNull();
  await expect(getDatasetById({ data: { id: "7" } })).resolves.toBeNull();
  const data = { collectionId: "7", datasetId: "8", fileId: "9" };
  await expect(getDatasetFileById({ data })).resolves.toBeNull();
  await expect(getFileVersions({ data })).resolves.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
