import { describe, expect, it, vi } from "vitest";
import { serveRuntimeClientConfig } from "../runtime-client-config-dev";

function responseRecorder() {
  const headers = new Map<string, string>();
  let body: string | undefined;
  return {
    headers,
    get body() {
      return body;
    },
    response: {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      end(value?: string) {
        body = value;
      },
    },
  };
}

describe("serveRuntimeClientConfig", () => {
  it("serves the runtime configuration script during Vite development", () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    serveRuntimeClientConfig(
      { method: "GET", url: "/runtime-config.js" },
      recorder.response,
      next,
      { WEBMCP_ENABLED: "true", DATASET_MCP_QUERY_API_URL: "http://127.0.0.1:8001" },
    );

    expect(next).not.toHaveBeenCalled();
    expect(recorder.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(recorder.headers.get("Cache-Control")).toBe("no-store");
    expect(recorder.body).toBe(
      'window.__HIFLD_CLIENT_CONFIG__={"posthogHost":"https://us.i.posthog.com","webMcpEnabled":true,"queryToolsEnabled":true};',
    );
  });

  it("leaves other development requests to Vite", () => {
    const recorder = responseRecorder();
    const next = vi.fn();

    serveRuntimeClientConfig({ method: "GET", url: "/src/main.tsx" }, recorder.response, next, {});

    expect(next).toHaveBeenCalledOnce();
    expect(recorder.body).toBeUndefined();
  });
});
