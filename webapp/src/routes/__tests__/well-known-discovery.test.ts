import { describe, expect, it } from "vitest";
import { agentResourceDiscoveryHandler } from "../[.well-known]/ai-catalog[.]json";
import { mcpServerCardHandler } from "../[.well-known]/mcp/server-card[.]json";

describe("well-known discovery routes", () => {
  it("serves the MCP card as JSON with an origin-aware endpoint", async () => {
    const response = mcpServerCardHandler(new Request("https://example.test/.well-known/mcp/server-card.json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.transport.endpoint).toBe("https://example.test/mcp");
  });

  it("serves ARD JSON with wildcard CORS and valid entry shapes", async () => {
    const response = agentResourceDiscoveryHandler(new Request("https://example.test/.well-known/ai-catalog.json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of body.entries) {
      expect((entry.url ? 1 : 0) + (entry.data ? 1 : 0)).toBe(1);
    }
  });
});
