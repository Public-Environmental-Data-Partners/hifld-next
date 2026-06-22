export interface RuntimeClientConfig {
  publicDatasetApiUrl?: string;
  posthogKey?: string;
  posthogHost: string;
}

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

declare global {
  interface Window {
    __HIFLD_CLIENT_CONFIG__?: RuntimeClientConfig;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function runtimeClientConfigFromWindow(): RuntimeClientConfig {
  if (typeof window === "undefined") {
    return { posthogHost: DEFAULT_POSTHOG_HOST };
  }

  const config = window.__HIFLD_CLIENT_CONFIG__;
  const publicDatasetApiUrl = nonEmpty(config?.publicDatasetApiUrl);
  const posthogKey = nonEmpty(config?.posthogKey);
  const posthogHost = nonEmpty(config?.posthogHost) ?? DEFAULT_POSTHOG_HOST;
  const runtimeConfig: RuntimeClientConfig = { posthogHost };
  if (publicDatasetApiUrl) {
    runtimeConfig.publicDatasetApiUrl = publicDatasetApiUrl;
  }
  if (posthogKey) {
    runtimeConfig.posthogKey = posthogKey;
  }
  return runtimeConfig;
}
