import { expect, it } from "vitest";
import { datasetIdentity, fileIdentity } from "@/lib/catalog-identity";

it("resolves qualified catalog IDs without accepting mismatched parents or numeric row IDs", () => {
  expect(datasetIdentity("hifld", "hifld/hospitals")).toEqual({ collectionSlug: "hifld", datasetSlug: "hospitals" });
  expect(fileIdentity("hifld", "hifld/hospitals", "hifld/hospitals/points")).toEqual({ collectionSlug: "hifld", datasetSlug: "hospitals", fileSlug: "points" });
  expect(datasetIdentity("other", "hifld/hospitals")).toBeNull();
  expect(fileIdentity("hifld", "hifld/hospitals", "hifld/schools/points")).toBeNull();
  expect(fileIdentity("1", "2", "3")).toBeNull();
});
