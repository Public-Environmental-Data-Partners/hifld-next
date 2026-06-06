import { describe, expect, it } from "vitest";
import {
  ROBOTS_CONTENT_SIGNAL,
  buildRobotsTxt,
  buildSitemapXml,
  discoveryLinkHeaderValue,
} from "../agent-discovery";

describe("agent-discovery", () => {
  it("discoveryLinkHeaderValue lists api, openapi, llms, api-catalog", () => {
    const v = discoveryLinkHeaderValue();
    expect(v).toContain("</api/openapi>");
    expect(v).toContain("</llms.txt>");
    expect(v).toContain("</.well-known/api-catalog>");
    expect(v).toContain("</.well-known/agent-skills/index.json>");
  });

  it("buildSitemapXml includes core paths", () => {
    const xml = buildSitemapXml("https://example.org");
    expect(xml).toContain("<loc>https://example.org/</loc>");
    expect(xml).toContain("/collections");
    expect(xml).toContain("<loc>https://example.org/api</loc>");
    expect(xml).toContain("<loc>https://example.org/api/openapi</loc>");
    expect(xml).toContain("<loc>https://example.org/llms.txt</loc>");
    expect(xml).toContain("<loc>https://example.org/.well-known/api-catalog</loc>");
    expect(xml).toContain(
      "<loc>https://example.org/.well-known/agent-skills/index.json</loc>"
    );
  });

  it("buildRobotsTxt references sitemap.xml on same origin", () => {
    expect(buildRobotsTxt("https://example.org")).toContain(
      "Sitemap: https://example.org/sitemap.xml"
    );
  });

  it("buildRobotsTxt includes Content-Signal for ai-train, search, ai-input", () => {
    const txt = buildRobotsTxt("https://example.org");
    expect(txt).toContain("Content-Signal:");
    expect(txt).toContain("ai-train=no");
    expect(txt).toContain("search=yes");
    expect(txt).toContain("ai-input=yes");
    expect(ROBOTS_CONTENT_SIGNAL).toMatch(/^Content-Signal:/);
  });
});
