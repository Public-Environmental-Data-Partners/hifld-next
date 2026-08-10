import { describe, expect, it } from "vitest";
import {
  buildDataCatalogJsonLd,
  buildDatasetJsonLd,
  datasetKeywords,
  pageTitle,
  plainTextForSeo,
  seoDescription,
} from "../seo";

describe("seo helpers", () => {
  it("strips markup, decodes common entities, and collapses whitespace", () => {
    expect(plainTextForSeo("<p>Hospitals&nbsp;&amp; clinics</p>\n<strong>Open</strong>")).toBe(
      "Hospitals & clinics Open",
    );
  });

  it("truncates descriptions predictably", () => {
    const description = seoDescription(
      "Hospitals and medical centers with emergency facilities, operating status, bed counts, and location details.",
      72,
    );

    expect(description).toBe("Hospitals and medical centers with emergency facilities, operating...");
    expect(description.length).toBeLessThanOrEqual(72);
  });

  it("builds page titles with the HIFLD Next suffix", () => {
    expect(pageTitle("Hospitals")).toBe("Hospitals | HIFLD Next | PEDP");
  });

  it("flattens dataset tags into a de-duplicated keyword list", () => {
    expect(
      datasetKeywords({ inventory_name: "hospitals", categories: ["Public Health", "hospitals"] }),
    ).toEqual(["hospitals", "Public Health"]);
    expect(datasetKeywords(undefined)).toEqual([]);
  });

  it("builds Dataset JSON-LD with catalog, keywords, parent, and distribution", () => {
    const jsonLd = buildDatasetJsonLd({
      name: "Hospitals",
      description: "<p>Hospitals &amp; clinics</p>",
      url: "/collections/hifld/datasets/hospitals",
      metadataUrl: "/api/collections/hifld/datasets/hospitals",
      keywords: ["Public Health"],
      isPartOf: { type: "Collection", name: "HIFLD" },
      dateModified: "2026-05-19",
    });

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: "Hospitals",
      description: "Hospitals & clinics",
      url: "/collections/hifld/datasets/hospitals",
      keywords: ["Public Health"],
      isPartOf: { "@type": "Collection", name: "HIFLD" },
      dateModified: "2026-05-19",
      includedInDataCatalog: { "@type": "DataCatalog", name: "HIFLD Next" },
      distribution: [
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "/api/collections/hifld/datasets/hospitals" },
      ],
    });
  });

  it("omits optional Dataset JSON-LD fields when absent", () => {
    const jsonLd = buildDatasetJsonLd({ name: "Hospitals", url: "/x" });
    expect(jsonLd).not.toHaveProperty("keywords");
    expect(jsonLd).not.toHaveProperty("isPartOf");
    expect(jsonLd).not.toHaveProperty("distribution");
    expect(jsonLd).not.toHaveProperty("dateModified");
  });

  it("builds DataCatalog JSON-LD nested under the HIFLD Next catalog", () => {
    const jsonLd = buildDataCatalogJsonLd({
      name: "HIFLD",
      description: "HIFLD datasets",
      url: "/collections/hifld",
      dateModified: "2026-02-13",
    });

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "DataCatalog",
      name: "HIFLD",
      description: "HIFLD datasets",
      url: "/collections/hifld",
      isPartOf: { "@type": "DataCatalog", name: "HIFLD Next" },
      dateModified: "2026-02-13",
    });
  });
});
