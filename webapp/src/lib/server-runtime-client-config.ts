import { DEFAULT_POSTHOG_HOST, type RuntimeClientConfig } from "./runtime-client-config";

interface RuntimeClientConfigEnv {
  PUBLIC_DATASET_API_URL?: string | undefined;
  PUBLIC_POSTHOG_KEY?: string | undefined;
  PUBLIC_POSTHOG_HOST?: string | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function runtimeClientConfigFromEnv(env: RuntimeClientConfigEnv): RuntimeClientConfig {
  const publicDatasetApiUrl = nonEmpty(env.PUBLIC_DATASET_API_URL);
  const posthogKey = nonEmpty(env.PUBLIC_POSTHOG_KEY);
  const posthogHost = nonEmpty(env.PUBLIC_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST;
  const runtimeConfig: RuntimeClientConfig = { posthogHost };
  if (publicDatasetApiUrl) {
    runtimeConfig.publicDatasetApiUrl = publicDatasetApiUrl;
  }
  if (posthogKey) {
    runtimeConfig.posthogKey = posthogKey;
  }
  return runtimeConfig;
}
