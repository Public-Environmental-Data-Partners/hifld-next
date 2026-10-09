import { env } from "@/env/server";

/** Legacy-only reads must fail explicitly, never silently query an undefined URL. */
export function legacyDatasetApiUrl(): string {
  if (!env.DATASET_API_URL) throw new Error("DATASET_API_URL is required in legacy catalog mode");
  return env.DATASET_API_URL;
}
