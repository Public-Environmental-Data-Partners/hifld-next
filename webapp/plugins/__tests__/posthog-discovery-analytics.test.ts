import { describe, expect, it } from "vitest";
import type { DiscoveryRouteCapture } from "../../src/lib/server-discovery-analytics";
import { registerDiscoveryAnalytics } from "../posthog-discovery-analytics";

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

describe("registerDiscoveryAnalytics", () => {
  it("captures an in-scope API response with its actual status", () => {
    const { registrar, responseHooks } = responseHookRegistrar();
    const captures: DiscoveryRouteCapture[] = [];
    registerDiscoveryAnalytics(registrar, { capture: (capture) => captures.push(capture) });

    const responseHook = responseHooks.at(0);
    if (!responseHook) throw new Error("Expected a response hook to be registered");
    responseHook(
      new Response(null, { status: 404 }),
      {
        req: new Request("https://data.example.test/api/collections/hifld?search=hospitals", {
          headers: { "user-agent": "curl/8.7.1" },
        }),
      },
    );

    expect(captures).toEqual([
      {
        distinctId: "anonymous-discovery-route",
        event: "api_route_requested",
        properties: {
          $process_person_profile: false,
          route_family: "api_resource",
          method: "GET",
          status: 404,
          client_category: "command_line",
        },
      },
    ]);
  });

  it("does not capture responses outside discovery routes", () => {
    const { registrar, responseHooks } = responseHookRegistrar();
    const captures: DiscoveryRouteCapture[] = [];
    registerDiscoveryAnalytics(registrar, { capture: (capture) => captures.push(capture) });

    const responseHook = responseHooks.at(0);
    if (!responseHook) throw new Error("Expected a response hook to be registered");
    responseHook(new Response(), { req: new Request("https://data.example.test/collections/hifld") });

    expect(captures).toEqual([]);
  });

  it("does not capture when no PostHog client is configured", () => {
    const { registrar, responseHooks } = responseHookRegistrar();
    registerDiscoveryAnalytics(registrar);

    const responseHook = responseHooks.at(0);
    if (!responseHook) throw new Error("Expected a response hook to be registered");
    responseHook(new Response(), { req: new Request("https://data.example.test/api") });
  });
});
