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
  };
}

function discoveryRouteFamily(pathname: string): DiscoveryRouteFamily | null {
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
  if (/openai|anthropic|claude|perplexity/i.test(userAgent)) return "known_agent";
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
  const routeFamily = discoveryRouteFamily(new URL(request.url).pathname);
  if (!routeFamily) return null;

  return {
    distinctId: "anonymous-discovery-route",
    event: "api_route_requested",
    properties: {
      $process_person_profile: false,
      request_url: request.url,
      route_family: routeFamily,
      method: discoveryHttpMethod(request.method),
      status,
      client_category: discoveryClientCategory(request.headers.get("user-agent")),
    },
  };
}
