import { describe, expect, it } from "vitest";
import { buildDiscoveryRouteCapture } from "../server-discovery-analytics";

describe("buildDiscoveryRouteCapture", () => {
  it("builds the fixed capture for the API root", () => {
    const request = new Request("https://data.example.test/api", {
      headers: { "user-agent": "curl/8.7.1" },
    });

    expect(buildDiscoveryRouteCapture(request, 200)).toEqual({
      distinctId: "anonymous-discovery-route",
      event: "api_route_requested",
      properties: {
        $process_person_profile: false,
        request_url: "https://data.example.test/api",
        route_family: "api_root",
        method: "GET",
        status: 200,
        client_category: "command_line",
      },
    });
  });

  it.each([
    ["https://data.example.test/api/collections/hifld?search=hospitals", "api_resource"],
    ["https://data.example.test/llms.txt", "llms_txt"],
  ] as const)("classifies %s into the %s route family", (url, routeFamily) => {
    const capture = buildDiscoveryRouteCapture(new Request(url), 201);

    expect(capture).toEqual({
      distinctId: "anonymous-discovery-route",
      event: "api_route_requested",
      properties: {
        $process_person_profile: false,
        request_url: url,
        route_family: routeFamily,
        method: "GET",
        status: 201,
        client_category: "other",
      },
    });
  });

  it("retains the complete request URL without capturing unrelated headers", () => {
    const requestUrl = "https://data.example.test/api/collections/hifld?search=hospitals&limit=25";
    const request = new Request(requestUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 Example Browser",
        "x-forwarded-for": "203.0.113.10",
        cookie: "session=secret",
        referer: "https://elsewhere.example.test/private/path",
      },
    });
    const capture = buildDiscoveryRouteCapture(request, 200);
    const serialized = JSON.stringify(capture);

    expect(capture?.properties.request_url).toBe(requestUrl);
    expect(serialized).not.toContain("Mozilla/5.0");
    expect(serialized).not.toContain("203.0.113.10");
    expect(serialized).not.toContain("session=secret");
    expect(serialized).not.toContain("elsewhere.example.test");
  });

  it.each([
    ["OpenAI/1.0", "known_agent"],
    ["Anthropic ClaudeBot", "known_agent"],
    ["PerplexityBot", "known_agent"],
    ["Googlebot/2.1", "crawler"],
    ["Wget/1.21", "command_line"],
    ["python-requests/2.32", "command_line"],
    ["request/2.88.2", "command_line"],
    ["Mozilla/5.0 AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36", "browser"],
    [undefined, "other"],
  ] as const)("classifies user agents as %s", (userAgent, clientCategory) => {
    const headers = userAgent === undefined ? undefined : { "user-agent": userAgent };
    const capture = buildDiscoveryRouteCapture(new Request("https://data.example.test/api", { headers }), 204);

    expect(capture?.properties.client_category).toBe(clientCategory);
  });

  it.each([
    "https://data.example.test/collections/hifld",
    "https://data.example.test/.well-known/agent-skills/index.json",
    "https://data.example.test/apiary",
  ])("excludes %s", (url) => {
    expect(buildDiscoveryRouteCapture(new Request(url), 200)).toBeNull();
  });
});
