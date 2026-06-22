import { DEFAULT_POSTHOG_HOST, type RuntimeClientConfig } from "./runtime-client-config";

interface RuntimeClientConfigEnv {
  PUBLIC_POSTHOG_KEY?: string | undefined;
  PUBLIC_POSTHOG_HOST?: string | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function runtimeClientConfigFromEnv(env: RuntimeClientConfigEnv): RuntimeClientConfig {
  const posthogKey = nonEmpty(env.PUBLIC_POSTHOG_KEY);
  const posthogHost = nonEmpty(env.PUBLIC_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST;
  if (posthogKey) {
    return { posthogKey, posthogHost };
  }
  return {
    posthogHost,
  };
}
