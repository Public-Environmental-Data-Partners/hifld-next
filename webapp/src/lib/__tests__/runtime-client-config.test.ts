import { runtimeClientConfigFromEnv } from "../server-runtime-client-config";

describe("runtimeClientConfigFromEnv", () => {
  it("exposes catalog WebMCP tools by default without enabling query tools", () => {
    expect(runtimeClientConfigFromEnv({ WEBMCP_ENABLED: undefined })).toMatchObject({
      webMcpEnabled: true,
      queryToolsEnabled: false,
    });
  });

  it("allows WebMCP registration to be explicitly disabled", () => {
    expect(runtimeClientConfigFromEnv({ WEBMCP_ENABLED: "false" })).toMatchObject({
      webMcpEnabled: false,
      queryToolsEnabled: false,
    });
  });

  it("enables query tools only with the strict flag and a query service URL", () => {
    expect(
      runtimeClientConfigFromEnv({
        WEBMCP_ENABLED: "true",
        DATASET_MCP_QUERY_API_URL: "http://dataset-mcp:8000",
      }),
    ).toMatchObject({ webMcpEnabled: true, queryToolsEnabled: true });
    expect(
      runtimeClientConfigFromEnv({
        WEBMCP_ENABLED: "TRUE",
        DATASET_MCP_QUERY_API_URL: "http://dataset-mcp:8000",
      }).webMcpEnabled,
    ).toBe(false);
    expect(
      runtimeClientConfigFromEnv({ WEBMCP_ENABLED: "true", DATASET_MCP_QUERY_API_URL: "  " }).queryToolsEnabled,
    ).toBe(false);
  });

  it("does not expose internal URLs or origin trial tokens", () => {
    const serialized = JSON.stringify(
      runtimeClientConfigFromEnv({
        WEBMCP_ENABLED: "true",
        DATASET_MCP_QUERY_API_URL: "http://dataset-mcp:8000",
        WEBMCP_ORIGIN_TRIAL_TOKEN: "origin-trial-secret",
      }),
    );
    expect(serialized).not.toContain("dataset-mcp");
    expect(serialized).not.toContain("origin-trial-secret");
  });
});
