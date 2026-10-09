import { expect, it, vi } from "vitest";

vi.mock("@/env/server", () => ({ env: {} }));
import { catalogRuntimeHealth } from "@/lib/catalog-runtime";

it("does not report ready when neither a published catalog nor the legacy API is configured", async () => {
  expect(await catalogRuntimeHealth()).toMatchObject({
    ready: false,
    last_error: "Configure a catalog source or DATASET_API_URL",
  });
});
