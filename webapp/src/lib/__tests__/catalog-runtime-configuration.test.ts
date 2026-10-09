import { expect, it, vi } from "vitest";

vi.mock("@/env/server", () => ({ env: { DATASET_API_URL: "https://retired.example" } }));
import { catalogRuntimeHealth } from "@/lib/catalog-runtime";

it("requires a published catalog even when the retired API URL is configured", async () => {
  expect(await catalogRuntimeHealth()).toMatchObject({
    ready: false,
    last_error: "Configure CATALOG_SQLITE_PATH, CATALOG_SQLITE_URL, or CATALOG_RELEASE_POINTER_URL",
  });
});
