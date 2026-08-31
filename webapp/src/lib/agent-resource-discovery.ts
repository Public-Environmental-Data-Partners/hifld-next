const SERVER_VERSION = "1.0.0";

export interface McpServerCard {
  serverInfo: { name: string; version: string };
  transport: { type: "streamable-http"; endpoint: string };
  capabilities: { tools: Capability; resources: Capability; prompts: Capability };
}

interface Capability {
  readonly enabled?: boolean;
}

export interface AgentResourceEntry {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: string;
  representativeQueries: string[];
}

export interface AgentResourceDiscovery {
  specVersion: string;
  host: { displayName: string; identifier: string };
  entries: AgentResourceEntry[];
}

function configuredMcpEndpoint(origin: string): string {
  const configured = process.env["DATASET_MCP_PUBLIC_ENDPOINT"]?.trim();
  // Deployments must route same-origin /mcp or configure DATASET_MCP_PUBLIC_ENDPOINT.
  if (!configured) return new URL("/mcp", origin).href;
  try {
    const endpoint = new URL(configured);
    const isLocalHttp =
      endpoint.protocol === "http:" && (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1");
    if (endpoint.protocol !== "https:" && !isLocalHttp) return new URL("/mcp", origin).href;
    return endpoint.href;
  } catch {
    return new URL("/mcp", origin).href;
  }
}

function safeHost(origin: string): string {
  try {
    const url = new URL(origin);
    return (url.host || "localhost").toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return "localhost";
  }
}

export function buildMcpServerCard(origin: string): McpServerCard {
  return {
    serverInfo: { name: "HIFLD Next", version: SERVER_VERSION },
    transport: { type: "streamable-http", endpoint: configuredMcpEndpoint(origin) },
    capabilities: { tools: { enabled: true }, resources: { enabled: true }, prompts: { enabled: false } },
  };
}

export function buildAgentResourceDiscovery(origin: string): AgentResourceDiscovery {
  const host = safeHost(origin);
  return {
    specVersion: "1.0",
    host: { displayName: "HIFLD Next", identifier: `did:web:${host}` },
    entries: [
      {
        identifier: `urn:air:${host}:mcp:server-card`,
        displayName: "HIFLD Next MCP Server Card",
        type: "application/mcp-server-card+json",
        url: new URL("/.well-known/mcp/server-card.json", origin).href,
        representativeQueries: [
          "What tools does HIFLD Next provide?",
          "How do I connect to the HIFLD Next MCP server?",
        ],
      },
      {
        identifier: `urn:air:${host}:api:openapi`,
        displayName: "HIFLD Next OpenAPI Description",
        type: "application/json",
        url: new URL("/api/openapi", origin).href,
        representativeQueries: ["What catalog API endpoints are available?", "How can I search HIFLD datasets?"],
      },
    ],
  };
}
