import { analyticsDisabled } from "./privacy";

export type DiscoveryRouteFamily = "api_root" | "api_resource" | "llms_txt";

export type DiscoveryClientCategory = "known_agent" | "crawler" | "command_line" | "browser" | "other";

export type DiscoveryHttpMethod =
  | "CONNECT"
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "TRACE"
  | "OTHER";

export interface DiscoveryRouteCapture {
  distinctId: "anonymous-discovery-route";
  event: "api_route_requested";
  properties: {
    $process_person_profile: false;
    request_url: string;
    route_family: DiscoveryRouteFamily;
    method: DiscoveryHttpMethod;
    status: number;
    client_category: DiscoveryClientCategory;
    agent_provider?: string;
    agent_client?: string;
    agent_purpose?: string;
    agent_attribution?: "self_declared";
  };
}

function discoveryRouteFamily(pathname: string): DiscoveryRouteFamily | null {
  if (pathname === "/api/feedback") return null;
  if (pathname === "/api") return "api_root";
  if (pathname.startsWith("/api/")) return "api_resource";
  if (pathname === "/llms.txt") return "llms_txt";
  return null;
}

function discoveryHttpMethod(method: string): DiscoveryHttpMethod {
  switch (method) {
    case "CONNECT":
    case "DELETE":
    case "GET":
    case "HEAD":
    case "OPTIONS":
    case "PATCH":
    case "POST":
    case "PUT":
    case "TRACE":
      return method;
    default:
      return "OTHER";
  }
}

function discoveryClientCategory(userAgent: string | null): DiscoveryClientCategory {
  if (!userAgent) return "other";
  if (/openai|gptbot|chatgpt|oai-searchbot|anthropic|claude|perplexity/i.test(userAgent)) return "known_agent";
  if (/bot|spider|crawler/i.test(userAgent)) return "crawler";
  if (
    /curl|wget|httpie|python-requests|request\/|axios|node-fetch|okhttp|go-http-client|libwww-perl|java\//i.test(
      userAgent,
    )
  ) {
    return "command_line";
  }
  if (/mozilla|chrome|safari|firefox|edg|opera|opr\//i.test(userAgent)) return "browser";
  return "other";
}

export function buildDiscoveryRouteCapture(request: Request, status: number): DiscoveryRouteCapture | null {
  if (analyticsDisabled(request.headers)) return null;
  const url = new URL(request.url);
  const routeFamily = discoveryRouteFamily(url.pathname);
  if (!routeFamily) return null;

  return {
    distinctId: "anonymous-discovery-route",
    event: "api_route_requested",
    properties: {
      $process_person_profile: false,
      request_url: `${url.origin}${url.pathname}`,
      route_family: routeFamily,
      method: discoveryHttpMethod(request.method),
      status,
      client_category: discoveryClientCategory(request.headers.get("user-agent")),
      ...agentLabels(request.headers.get("user-agent") ?? ""),
    },
  };
}

/** User agents are self-declared. These labels do not verify the operator or identify a visitor. */
function agentLabels(
  userAgent: string,
): Pick<
  DiscoveryRouteCapture["properties"],
  "agent_provider" | "agent_client" | "agent_purpose" | "agent_attribution"
> {
  const clients = [
    ["GPTBot", "OpenAI", "crawler"],
    ["ChatGPT-User", "OpenAI", "assistant"],
    ["OAI-SearchBot", "OpenAI", "search"],
    ["ClaudeBot", "Anthropic", "crawler"],
    ["Claude-User", "Anthropic", "assistant"],
    ["Claude-SearchBot", "Anthropic", "search"],
    ["PerplexityBot", "Perplexity", "search"],
    ["Perplexity-User", "Perplexity", "assistant"],
  ] as const;
  for (const [client, provider, purpose] of clients) {
    if (userAgent.toLowerCase().includes(client.toLowerCase())) {
      return {
        agent_provider: provider,
        agent_client: client,
        agent_purpose: purpose,
        agent_attribution: "self_declared",
      };
    }
  }
  const provider = /openai|chatgpt/i.test(userAgent)
    ? "OpenAI"
    : /anthropic|claude/i.test(userAgent)
      ? "Anthropic"
      : /perplexity/i.test(userAgent)
        ? "Perplexity"
        : undefined;
  return provider
    ? {
        agent_provider: provider,
        agent_client: "unknown",
        agent_purpose: "unknown",
        agent_attribution: "self_declared",
      }
    : {};
}
