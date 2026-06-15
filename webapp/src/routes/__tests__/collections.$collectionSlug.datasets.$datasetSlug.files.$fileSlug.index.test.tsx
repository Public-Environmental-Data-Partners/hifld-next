import { describe, expect, it } from "vitest";
import { Route as FileDetailRoute } from "../collections.$collectionSlug.datasets.$datasetSlug.files.$fileSlug.index";

describe("Dataset file detail route head", () => {
  it("emits file-specific title, description, canonical, and Open Graph metadata", async () => {
    const head = FileDetailRoute.options.head;
    expect(head).toBeDefined();
    if (!head) return;

    const result = await head({
      loaderData: {
        collection: {
          id: 1,
          slug: "hifld",
          name: "HIFLD",
          description: "Infrastructure datasets",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        dataset: {
          id: 10,
          slug: "hospitals-3",
          name: "Hospitals",
          description: "Hospital dataset",
          collection_id: 1,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        file: {
          id: 20,
          dataset_id: 10,
          slug: "hospitals-3",
          name: "hospitals-3",
          description: "<p>Hospital point layer with facility attributes.</p>",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      },
      params: { collectionSlug: "hifld", datasetSlug: "hospitals-3", fileSlug: "hospitals-3" },
    } as Parameters<typeof head>[0]);

    expect(result.meta).toContainEqual({ title: "hospitals-3 | Hospitals | HIFLD Next | PEDP" });
    expect(result.meta).toContainEqual({
      name: "description",
      content: "Hospital point layer with facility attributes.",
    });
    expect(result.meta).toContainEqual({
      property: "og:title",
      content: "hospitals-3 | Hospitals | HIFLD Next | PEDP",
    });
    expect(result.links).toContainEqual({
      rel: "canonical",
      href: "/collections/hifld/datasets/hospitals-3/files/hospitals-3",
    });
  });
});
