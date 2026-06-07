import { describe, expect, it } from "vitest";
import { pageTitle, plainTextForSeo, seoDescription } from "../seo";

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
});
