import { z } from "zod";
import { FEEDBACK_CONSENT_VERSION } from "./privacy";

const slug = z.string().trim().min(1).max(250);
export const FeedbackSchema = z.object({
  reporter_email: z.email().max(254),
  comment: z.string().trim().min(1).max(5000),
  collection_slug: slug,
  dataset_slug: slug,
  file_slug: slug,
  version: z.union([z.string().max(100), z.number().finite()]).optional(),
  source_id: z.number().int().nonnegative().optional(),
  consent: z.literal(true),
  consent_version: z.literal(FEEDBACK_CONSENT_VERSION),
  feature: z
    .object({
      id: z.string().max(500),
      loadedLayerId: z.string().max(500),
      layerName: z.string().max(500),
      collectionSlug: slug,
      datasetSlug: slug,
      fileSlug: slug,
      version: z.string().max(100),
      sourceId: z.number().int().nonnegative().optional(),
      sourceLayerId: z.string().max(500),
      featureId: z.string().max(500),
      centroid: z.object({ lng: z.number().finite(), lat: z.number().finite() }).nullable(),
      properties: z.record(z.string().max(200), z.string().max(2000)),
    })
    .optional(),
});
export type DatasetQualityFeedbackInput = z.input<typeof FeedbackSchema>;

/** Separate delivery from analytics preferences: this sends only a deliberately consented report. */
export async function submitDatasetQualityFeedback(input: DatasetQualityFeedbackInput): Promise<void> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(FeedbackSchema.parse(input)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Feedback could not be delivered. Please try again.");
}
