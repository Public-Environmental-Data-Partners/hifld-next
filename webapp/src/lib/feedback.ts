import { z } from "zod";
import { FEEDBACK_CONSENT_VERSION } from "./privacy";

export const FEEDBACK_MAX_BODY_BYTES = 32_768;
const FEATURE_ID_MAX = 500;
const PROPERTY_KEY_MAX = 200;
const PROPERTY_VALUE_MAX = 2000;

const slug = z.string().trim().min(1).max(250);
export const ReporterEmailSchema = z.email().max(254);
export const FeedbackSchema = z.object({
  reporter_email: ReporterEmailSchema,
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
      id: z.string().max(FEATURE_ID_MAX),
      loadedLayerId: z.string().max(FEATURE_ID_MAX),
      layerName: z.string().max(FEATURE_ID_MAX),
      collectionSlug: slug,
      datasetSlug: slug,
      fileSlug: slug,
      version: z.string().max(100),
      sourceId: z.number().int().nonnegative().optional(),
      sourceLayerId: z.string().max(FEATURE_ID_MAX),
      featureId: z.string().max(FEATURE_ID_MAX),
      centroid: z.object({ lng: z.number().finite(), lat: z.number().finite() }).nullable(),
      properties: z.record(z.string().max(PROPERTY_KEY_MAX), z.string().max(PROPERTY_VALUE_MAX)),
    })
    .optional(),
});
export type DatasetQualityFeedbackInput = z.input<typeof FeedbackSchema>;
type FeedbackFeatureInput = NonNullable<DatasetQualityFeedbackInput["feature"]>;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Fit the selected feature's context around the user's report so the request stays within the endpoint cap. */
function boundFeedbackInput(input: DatasetQualityFeedbackInput): DatasetQualityFeedbackInput {
  const { feature, ...report } = input;
  if (!feature) return input;
  const bounded: FeedbackFeatureInput = {
    id: feature.id.slice(0, FEATURE_ID_MAX),
    loadedLayerId: feature.loadedLayerId.slice(0, FEATURE_ID_MAX),
    layerName: feature.layerName.slice(0, FEATURE_ID_MAX),
    collectionSlug: feature.collectionSlug,
    datasetSlug: feature.datasetSlug,
    fileSlug: feature.fileSlug,
    version: feature.version,
    ...(feature.sourceId !== undefined ? { sourceId: feature.sourceId } : {}),
    sourceLayerId: feature.sourceLayerId.slice(0, FEATURE_ID_MAX),
    featureId: feature.featureId.slice(0, FEATURE_ID_MAX),
    centroid: feature.centroid,
    properties: {},
  };
  let remaining = FEEDBACK_MAX_BODY_BYTES - utf8ByteLength(JSON.stringify({ ...report, feature: bounded }));
  if (remaining < 0) return report;
  const properties: [string, string][] = [];
  for (const [key, value] of Object.entries(feature.properties)) {
    if (key.length > PROPERTY_KEY_MAX) continue;
    const boundedValue = value.slice(0, PROPERTY_VALUE_MAX);
    const size = utf8ByteLength(`${JSON.stringify(key)}:${JSON.stringify(boundedValue)},`);
    if (size > remaining) continue;
    properties.push([key, boundedValue]);
    remaining -= size;
  }
  return { ...report, feature: { ...bounded, properties: Object.fromEntries(properties) } };
}

/** Separate delivery from analytics preferences: this sends only a deliberately consented report. */
export async function submitDatasetQualityFeedback(input: DatasetQualityFeedbackInput): Promise<void> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(FeedbackSchema.parse(boundFeedbackInput(input))),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Feedback could not be delivered. Please try again.");
}
