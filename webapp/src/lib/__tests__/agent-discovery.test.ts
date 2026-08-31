import { describe, expect, it } from "vitest";
import { ROBOTS_CONTENT_SIGNAL, buildRobotsTxt, buildSitemapXml, discoveryLinkHeaderValue } from "../agent-discovery";

describe("agent-discovery", () => {
  it("discoveryLinkHeaderValue lists api, openapi, llms, api-catalog", () => {
    const v = discoveryLinkHeaderValue();
    expect(v).toContain("</api/openapi>");
    expect(v).toContain("</llms.txt>");
    expect(v).toContain("</.well-known/api-catalog>");
    expect(v).toContain("</.well-known/agent-skills/index.json>");
    expect(v).toContain("</.well-known/mcp/server-card.json>");
    expect(v).toContain("</.well-known/ai-catalog.json>");
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
    expect(xml).toContain("<loc>https://example.org/.well-known/mcp/server-card.json</loc>");
    expect(xml).toContain("<loc>https://example.org/.well-known/ai-catalog.json</loc>");
  });

  it("buildRobotsTxt references sitemap.xml on same origin", () => {
    expect(buildRobotsTxt("https://example.org")).toContain(
      "Sitemap: https://example.org/sitemap.xml"
    );
  });

  it("buildRobotsTxt explicitly allows automated access", () => {
    const txt = buildRobotsTxt("https://example.org");
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Disallow:");
    expect(txt).toContain("Content-Signal: ai-train=yes, search=yes, ai-input=yes");
    expect(ROBOTS_CONTENT_SIGNAL).toBe("Content-Signal: ai-train=yes, search=yes, ai-input=yes");
  });
});
