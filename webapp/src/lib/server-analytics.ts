import type { DatasetQualityFeedbackInput } from "./feedback";
import { DEFAULT_POSTHOG_HOST } from "./runtime-client-config";

type EventProperties = Omit<DatasetQualityFeedbackInput, "feature"> & {
  consent_timestamp: string;
  feature_json?: string;
};

/** Wait for ingestion's HTTP acknowledgement; never forward browser headers or client IPs. */
export async function captureServerEvent(event: string, properties: EventProperties): Promise<void> {
  const key = process.env["PUBLIC_POSTHOG_KEY"]?.trim();
  if (!key) throw new Error("Feedback is unavailable.");
  const host = process.env["PUBLIC_POSTHOG_HOST"]?.trim() || DEFAULT_POSTHOG_HOST;
  const response = await fetch(`${host.replace(/\/$/, "")}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      event,
      properties: {
        ...properties,
        distinct_id: crypto.randomUUID(),
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: null,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Feedback could not be delivered.");
}
