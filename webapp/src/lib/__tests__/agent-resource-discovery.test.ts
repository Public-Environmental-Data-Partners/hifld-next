import { afterEach, describe, expect, it } from "vitest";
import { buildAgentResourceDiscovery, buildMcpServerCard } from "../agent-resource-discovery";

describe("agent resource discovery", () => {
  afterEach(() => {
    delete process.env.DATASET_MCP_PUBLIC_ENDPOINT;
    delete process.env.WEBAPP_PUBLIC_ORIGIN;
  });

  it("builds an origin-aware MCP server card", () => {
    const card = buildMcpServerCard("https://hifld.publicenvirodata.org");
    expect(card).toEqual({
      $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
      name: "org.publicenvirodata.hifld/dataset-mcp",
      version: expect.any(String),
      description: expect.any(String),
      title: "HIFLD Next Dataset MCP",
      remotes: [{ type: "streamable-http", url: "https://hifld.publicenvirodata.org/mcp" }],
    });
  });

  it("builds ARD entries with identifiers, media types, URLs, and queries", () => {
    const catalog = buildAgentResourceDiscovery("https://hifld.publicenvirodata.org");
    expect(catalog.specVersion).toBe("1.0");
    expect(catalog.host).toEqual({ displayName: "HIFLD Next", identifier: "did:web:hifld.publicenvirodata.org" });
    expect(catalog.entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of catalog.entries) {
      expect(entry.identifier).toMatch(/^urn:air:hifld\.publicenvirodata\.org:/);
      expect(entry.type).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      expect((entry.url ? 1 : 0) + (entry.data ? 1 : 0)).toBe(1);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
    }
  });

  it("uses a validated public endpoint and never leaks invalid configuration", () => {
    process.env.DATASET_MCP_PUBLIC_ENDPOINT = "https://mcp.example.test/mcp";
    expect(buildMcpServerCard("https://hifld.publicenvirodata.org").remotes[0]?.url).toBe("https://mcp.example.test/mcp");
    process.env.DATASET_MCP_PUBLIC_ENDPOINT = "http://dataset-mcp.internal:8000";
    expect(buildMcpServerCard("https://hifld.publicenvirodata.org").remotes[0]?.url).toBe("https://hifld.publicenvirodata.org/mcp");
  });

  it("uses the canonical public origin behind a reverse proxy", () => {
    process.env.WEBAPP_PUBLIC_ORIGIN = "https://hifld.publicenvirodata.org";
    expect(buildMcpServerCard("http://webapp.hifld-next.svc.cluster.local").remotes[0]?.url).toBe(
      "https://hifld.publicenvirodata.org/mcp",
    );
  });
});
