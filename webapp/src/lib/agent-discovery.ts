/**
 * HTTP discovery helpers for agent/crawler probes (Link headers, homepage markdown).
 */

/** RFC 8288 Link header for machine-readable API entry points (relative URLs). */
export function discoveryLinkHeaderValue(): string {
  const parts = [
    `</api>; rel="service"; type="application/json"`,
    `</api/openapi>; rel="describedby"; type="application/json"`,
    `</llms.txt>; rel="alternate"; type="text/markdown"`,
    `</.well-known/api-catalog>; rel="service-meta"; type="application/json"`,
    `</.well-known/agent-skills/index.json>; rel="service-meta"; type="application/json"`,
    `</.well-known/mcp/server-card.json>; rel="service-meta"; type="application/json"`,
    `</.well-known/ai-catalog.json>; rel="service-meta"; type="application/json"`,
  ];
  return parts.join(", ");
}

export function buildSitemapXml(origin: string): string {
  const paths = [
    "/",
    "/collections",
    "/about",
    "/commons",
    "/api",
    "/api/openapi",
    "/llms.txt",
    "/.well-known/api-catalog",
    "/.well-known/agent-skills/index.json",
    "/.well-known/mcp/server-card.json",
    "/.well-known/ai-catalog.json",
  ];
  const urls = paths
    .map((p) => {
      const loc = new URL(p, origin).href.replace(/&/g, "&amp;");
      return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>weekly</changefreq>\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/** Content Signals (https://contentsignals.org/, draft-romm-aipref-contentsignals). */
export const ROBOTS_CONTENT_SIGNAL = "Content-Signal: ai-train=yes, search=yes, ai-input=yes";

export function buildRobotsTxt(origin: string): string {
  return [
    "# https://www.robotstxt.org/robotstxt.html",
    "User-agent: *",
    "Allow: /",
    "Disallow:",
    ROBOTS_CONTENT_SIGNAL,
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function homePageMarkdown(origin: string): string {
  return [
    "# HIFLD Next",
    "",
    "Public catalog of preserved federal infrastructure and environmental geospatial datasets.",
    "",
    "## API for agents and tools",
    "",
    `- [GET ${origin}/api](${origin}/api) - bootstrap JSON with links`,
    `- [GET ${origin}/api/openapi](${origin}/api/openapi) - OpenAPI 3.1 document`,
    `- [GET ${origin}/llms.txt](${origin}/llms.txt) - markdown overview and URL patterns`,
    `- [GET ${origin}/.well-known/api-catalog](${origin}/.well-known/api-catalog) - discovery document`,
    `- [GET ${origin}/.well-known/agent-skills/index.json](${origin}/.well-known/agent-skills/index.json) - Agent Skills discovery index`,
    `- [GET ${origin}/.well-known/mcp/server-card.json](${origin}/.well-known/mcp/server-card.json) - MCP Server Card`,
    `- [GET ${origin}/.well-known/ai-catalog.json](${origin}/.well-known/ai-catalog.json) - Agent Resource Discovery catalog`,
    "",
    "## Human UI",
    "",
    `- [Collections](${origin}/collections)`,
    "",
  ].join("\n");
}
