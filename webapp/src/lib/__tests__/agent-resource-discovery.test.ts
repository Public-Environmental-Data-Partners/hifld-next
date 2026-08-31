import { afterEach, describe, expect, it } from "vitest";
import { buildAgentResourceDiscovery, buildMcpServerCard } from "../agent-resource-discovery";

describe("agent resource discovery", () => {
  afterEach(() => {
    delete process.env.DATASET_MCP_PUBLIC_ENDPOINT;
  });

  it("builds an origin-aware MCP server card", () => {
    const card = buildMcpServerCard("https://hifld.publicenvirodata.org");
    expect(card.serverInfo).toEqual({ name: "HIFLD Next", version: expect.any(String) });
    expect(card.transport.endpoint).toBe("https://hifld.publicenvirodata.org/mcp");
    expect(card.capabilities).toEqual({ tools: { enabled: true }, resources: { enabled: true }, prompts: { enabled: false } });
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
    expect(buildMcpServerCard("https://hifld.publicenvirodata.org").transport.endpoint).toBe("https://mcp.example.test/mcp");
    process.env.DATASET_MCP_PUBLIC_ENDPOINT = "http://dataset-mcp.internal:8000";
    expect(buildMcpServerCard("https://hifld.publicenvirodata.org").transport.endpoint).toBe("https://hifld.publicenvirodata.org/mcp");
  });
});
