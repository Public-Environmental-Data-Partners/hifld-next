import { describe, expect, it } from "vitest";
import { Route as DatasetDetailRoute } from "../collections.$collectionSlug.datasets.$datasetSlug.index";

describe("Dataset detail route head", () => {
  it("emits dataset-specific title, description, canonical, and Open Graph metadata", async () => {
    const head = DatasetDetailRoute.options.head;
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
          description: "<p>Hospital facilities with &nbsp; bed counts and emergency care.</p>",
          tags: { categories: ["Health", "Infrastructure"] },
          collection_id: 1,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      },
      params: { collectionSlug: "hifld", datasetSlug: "hospitals-3" },
    } as Parameters<typeof head>[0]);

    expect(result.meta).toContainEqual({ title: "Hospitals | HIFLD Next | PEDP" });
    expect(result.meta).toContainEqual({
      name: "description",
      content: "Hospital facilities with bed counts and emergency care.",
    });
    expect(result.meta).toContainEqual({ property: "og:title", content: "Hospitals | HIFLD Next | PEDP" });
    expect(result.meta).toContainEqual({
      property: "og:description",
      content: "Hospital facilities with bed counts and emergency care.",
    });
    expect(result.links).toContainEqual({
      rel: "canonical",
      href: "/collections/hifld/datasets/hospitals-3",
    });
    expect(result.links).toContainEqual({
      rel: "alternate",
      type: "application/json",
      href: "/api/collections/hifld/datasets/hospitals-3",
      title: "Dataset metadata JSON",
    });

    const ldScript = result.scripts?.find((script) => script.type === "application/ld+json");
    expect(ldScript).toBeDefined();
    const jsonLd = JSON.parse(ldScript?.children ?? "{}");
    expect(jsonLd).toMatchObject({
      "@type": "Dataset",
      name: "Hospitals",
      url: "/collections/hifld/datasets/hospitals-3",
      isPartOf: { "@type": "Collection", name: "HIFLD" },
    });
  });
});
