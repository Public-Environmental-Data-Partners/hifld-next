import { definePlugin } from "nitro";
import { PostHog } from "posthog-node";
import { DEFAULT_POSTHOG_HOST } from "../src/lib/runtime-client-config";
import { buildDiscoveryRouteCapture, type DiscoveryRouteCapture } from "../src/lib/server-discovery-analytics";

interface ResponseHookRegistrar {
  hook(name: "response", callback: (response: Response, event: { req: Request }) => void): void;
}

interface DiscoveryCaptureClient {
  capture(capture: DiscoveryRouteCapture): void;
}

type PostHogEnvironment = typeof process.env & {
  PUBLIC_POSTHOG_KEY?: string | undefined;
  PUBLIC_POSTHOG_HOST?: string | undefined;
};

export function registerDiscoveryAnalytics(registrar: ResponseHookRegistrar, client?: DiscoveryCaptureClient): void {
  registrar.hook("response", (response, event) => {
    const capture = buildDiscoveryRouteCapture(event.req, response.status);
    if (!capture || !client) return;

    try {
      client.capture(capture);
    } catch {
      console.error("PostHog discovery analytics capture failed");
    }
  });
}

function configuredPostHogClient(): PostHog | null {
  const environment: PostHogEnvironment = process.env;
  const key = environment.PUBLIC_POSTHOG_KEY?.trim();
  if (!key) return null;

  try {
    return new PostHog(key, {
      host: environment.PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST,
      disableGeoip: true,
    });
  } catch {
    return null;
  }
}

const client = configuredPostHogClient();

export default definePlugin((nitro) => {
  if (!client) return;

  registerDiscoveryAnalytics(nitro.hooks, client);
  nitro.hooks.hook("close", async () => {
    await client.shutdown();
  });
});
