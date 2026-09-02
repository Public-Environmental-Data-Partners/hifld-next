import { describe, expect, it, vi } from "vitest";
import nitroConfig from "../../nitro.config";
import { registerWebMcpOriginTrial } from "../webmcp-origin-trial";

type ResponseHook = (response: Response, event: { req: Request }) => void;

function responseHookRegistrar() {
  const responseHooks: ResponseHook[] = [];
  return {
    responseHooks,
    registrar: {
      hook(name: "response", callback: ResponseHook) {
        if (name === "response") responseHooks.push(callback);
      },
    },
  };
}

function registeredHook(environment: { WEBMCP_ORIGIN_TRIAL_TOKEN?: string | undefined }): ResponseHook {
  const { registrar, responseHooks } = responseHookRegistrar();
  registerWebMcpOriginTrial(registrar, environment);
  const hook = responseHooks.at(0);
  if (!hook) throw new Error("Expected a response hook");
  return hook;
}

describe("registerWebMcpOriginTrial", () => {
  it("explicitly registers the plugin with Nitro", () => {
    expect(nitroConfig.plugins).toContain("./plugins/webmcp-origin-trial");
  });

  it.each([undefined, "", "   "])("does not register a header for an absent or blank token", (token) => {
    const { registrar, responseHooks } = responseHookRegistrar();
    registerWebMcpOriginTrial(registrar, { WEBMCP_ORIGIN_TRIAL_TOKEN: token });
    expect(responseHooks).toHaveLength(0);
  });

  it.each([
    ["https://data.example.test/runtime-config.js", "window.__HIFLD_CLIENT_CONFIG__={};"],
    ["https://data.example.test/collections/hifld", "<html><body>HIFLD</body></html>"],
  ])("adds a trimmed valid token as a response header only for %s", async (url, body) => {
    const token = "valid-origin-trial-token";
    const hook = registeredHook({ WEBMCP_ORIGIN_TRIAL_TOKEN: `  ${token}  ` });
    const response = new Response(body, {
      headers: { "Content-Type": "application/javascript" },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    hook(response, { req: new Request(url) });

    expect(response.headers.get("Origin-Trial")).toBe(token);
    expect(response.headers.get("Content-Type")).toBe("application/javascript");
    expect(await response.text()).not.toContain(token);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it.each(["valid\r\nInjected: true", "valid\nInjected: true", "valid\rInjected: true"])(
    "rejects a token containing header injection characters",
    (token) => {
      const { registrar, responseHooks } = responseHookRegistrar();
      registerWebMcpOriginTrial(registrar, { WEBMCP_ORIGIN_TRIAL_TOKEN: token });
      expect(responseHooks).toHaveLength(0);
    },
  );
});
