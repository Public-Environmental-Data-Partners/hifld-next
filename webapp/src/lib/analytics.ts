/**
 * Analytics utility for tracking user interactions with PostHog
 */

import posthog from "posthog-js";
import { runtimeClientConfigFromWindow } from "./runtime-client-config";

// Initialize PostHog on the client side
let posthogInitialized = false;

export type DownloadMethod = "native_link" | "fetch_stream" | "client_zip";

type AnalyticsPropertyValue = string | number | boolean | null | readonly string[] | readonly number[];

interface PostHogEventProperties {
  [propertyName: string]: AnalyticsPropertyValue | undefined;
}

export interface PageViewProperties {
  collection_slug?: string | undefined;
  dataset_slug?: string | undefined;
  file_slug?: string | undefined;
}

export interface DownloadAnalyticsContext {
  collection_slug?: string | undefined;
  dataset_slug?: string | undefined;
  file_slug?: string | undefined;
  format?: string | undefined;
  source_id?: number | undefined;
  storage_location_id?: number | undefined;
  version?: string | number | undefined;
  expected_size_bytes?: number | undefined;
  filename?: string | undefined;
  url_host?: string | undefined;
  download_method: DownloadMethod;
  source_count?: number | undefined;
}

export interface DownloadSuccessProperties {
  completion_status: "completed";
  received_bytes?: number | undefined;
  content_length_bytes?: number | undefined;
  duration_ms?: number | undefined;
  source_count?: number | undefined;
}

export interface DownloadHandoffProperties {
  duration_ms: number;
}

export type DownloadFailureCategory = "http_error" | "network_error" | "canceled" | "zip_error";

export interface DownloadFailureProperties {
  error_category: DownloadFailureCategory;
  received_bytes?: number | undefined;
  content_length_bytes?: number | undefined;
  duration_ms?: number | undefined;
  source_count?: number | undefined;
}

export interface DatasetMapImportInput {
  collection_slug: string;
  dataset_slug: string;
  file_slug: string;
  source_id?: number | undefined;
  version?: string | number | undefined;
  import_source: "route" | "picker";
  loaded_layer_count: number;
}

export interface DatasetQualityFeedbackFeature {
  id: string;
  loadedLayerId: string;
  layerName: string;
  collectionSlug: string;
  datasetSlug: string;
  fileSlug: string;
  version: string;
  sourceId?: number | undefined;
  sourceLayerId: string;
  featureId: string;
  centroid: { lng: number; lat: number } | null;
  properties: { [propertyName: string]: string };
  geometry?: { [propertyName: string]: string | number | boolean | null | readonly string[] | readonly number[] };
}

export interface DatasetQualityFeedbackInput {
  reporter_email: string;
  comment: string;
  collection_slug: string;
  dataset_slug: string;
  file_slug: string;
  version?: string | number | undefined;
  source_id?: number | undefined;
  feature?: DatasetQualityFeedbackFeature | undefined;
}

type AnalyticsEventProperties =
  | PageViewProperties
  | DownloadAnalyticsContext
  | DownloadSuccessProperties
  | DownloadHandoffProperties
  | DownloadFailureProperties
  | DatasetMapImportInput
  | (Omit<DatasetQualityFeedbackInput, "feature"> & { current_url?: string; feature_json?: string });

function compactProperties(properties: AnalyticsEventProperties): PostHogEventProperties {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function captureDownloadEvent(
  eventName:
    | "dataset_download_clicked"
    | "dataset_download_succeeded"
    | "dataset_download_handed_off"
    | "dataset_download_failed",
  context: DownloadAnalyticsContext,
  properties?: DownloadSuccessProperties | DownloadHandoffProperties | DownloadFailureProperties,
) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture(
      eventName,
      compactProperties({
        ...context,
        ...properties,
      }),
    );
  } catch (error) {
    console.error(`Failed to track ${eventName}:`, error);
  }
}

export function initPostHog() {
  if (typeof window === "undefined") return;
  if (posthogInitialized) return;
  const config = runtimeClientConfigFromWindow();
  if (!config.posthogKey) return;

  try {
    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      // Privacy settings
      autocapture: false, // Disable auto-capture for privacy
      capture_pageview: false, // We'll track pageviews manually
      respect_dnt: true, // Respect Do Not Track
      // Optional: mask text in session replay
      session_recording: { maskTextSelector: 'input[type="search"]' },
      loaded: () => {
        if (process.env["NODE_ENV"] === "development") {
          console.log("PostHog initialized");
        }
      },
    });
    posthogInitialized = true;
  } catch (error) {
    console.error("Failed to initialize PostHog:", error);
  }
}

/**
 * Track a page view
 */
export function trackPageView(path: string, properties?: PageViewProperties) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return; // Safety check

  try {
    posthog.capture("$pageview", {
      $current_url: window.location.href,
      path,
      ...properties,
    });
  } catch (error) {
    console.error("Failed to track page view:", error);
  }
}

/**
 * Track a search query
 */
export function trackSearchQuery(
  query: string,
  collectionSlug: string,
  resultCount: number,
  properties?: {
    hasTagFilters?: boolean;
    queryLength?: number;
  },
) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return; // Safety check

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return; // Don't track empty queries

  try {
    posthog.capture("dataset_search", {
      query: trimmedQuery,
      query_length: properties?.queryLength ?? trimmedQuery.length,
      collection_slug: collectionSlug,
      result_count: resultCount,
      has_tag_filters: properties?.hasTagFilters ?? false,
      is_zero_result: resultCount === 0,
    });
  } catch (error) {
    console.error("Failed to track search query:", error);
  }
}

/**
 * Track tag filter application
 */
export function trackTagFilter(
  collectionSlug: string,
  filterKey: string,
  filterValues: string[],
  resultCount: number,
  searchQuery?: string,
) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return; // Safety check

  try {
    posthog.capture("tag_filter_applied", {
      collection_slug: collectionSlug,
      filter_key: filterKey,
      filter_values: filterValues,
      result_count: resultCount,
      is_zero_result: resultCount === 0,
      search_query: searchQuery,
    });
  } catch (error) {
    console.error("Failed to track tag filter:", error);
  }
}

/**
 * Track dataset file download
 */
export function trackDownload(
  format: string,
  datasetSlug: string,
  fileSlug: string,
  collectionSlug: string,
  properties?: {
    sizeBytes?: number;
    storageLocationId?: number;
    version?: string | number;
  },
) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("dataset_file_download", {
      format,
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
      collection_slug: collectionSlug,
      size_bytes: properties?.sizeBytes,
      storage_location_id: properties?.storageLocationId,
      version: properties?.version,
    });
  } catch (error) {
    console.error("Failed to track download:", error);
  }
}

export function trackDownloadClicked(context: DownloadAnalyticsContext) {
  captureDownloadEvent("dataset_download_clicked", context);
}

export function trackDownloadSucceeded(context: DownloadAnalyticsContext, properties: DownloadSuccessProperties) {
  captureDownloadEvent("dataset_download_succeeded", context, properties);
}

export function trackDownloadHandedOff(context: DownloadAnalyticsContext, properties: DownloadHandoffProperties) {
  captureDownloadEvent("dataset_download_handed_off", context, properties);
}

export function trackDownloadFailed(context: DownloadAnalyticsContext, properties: DownloadFailureProperties) {
  captureDownloadEvent("dataset_download_failed", context, properties);
}

export function trackDatasetImportedIntoMap(input: DatasetMapImportInput) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("dataset_imported_into_map", compactProperties(input));
  } catch (error) {
    console.error("Failed to track dataset map import:", error);
  }
}

function feedbackFeatureJson(feature: DatasetQualityFeedbackFeature): string {
  const { geometry: _geometry, ...featureWithoutGeometry } = feature;
  return JSON.stringify(featureWithoutGeometry);
}

export function trackDatasetQualityFeedbackSubmitted(input: DatasetQualityFeedbackInput) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture(
      "dataset_quality_feedback_submitted",
      compactProperties({
        reporter_email: input.reporter_email,
        comment: input.comment,
        collection_slug: input.collection_slug,
        dataset_slug: input.dataset_slug,
        file_slug: input.file_slug,
        version: input.version,
        source_id: input.source_id,
        current_url: window.location.href,
        feature_json: input.feature ? feedbackFeatureJson(input.feature) : undefined,
      }),
    );
  } catch (error) {
    console.error("Failed to track dataset quality feedback:", error);
  }
}

/**
 * Track map viewer opened
 */
export function trackMapViewer(datasetSlug: string, fileSlug: string, collectionSlug: string) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("map_viewer_opened", {
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
      collection_slug: collectionSlug,
    });
  } catch (error) {
    console.error("Failed to track map viewer:", error);
  }
}

/**
 * Track data table opened
 */
export function trackDataTable(datasetSlug: string, fileSlug: string, collectionSlug: string) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("data_table_opened", {
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
      collection_slug: collectionSlug,
    });
  } catch (error) {
    console.error("Failed to track data table:", error);
  }
}

/**
 * Track URL copied
 */
export function trackUrlCopied(
  urlType: "storage_uri" | "api_endpoint" | "duckdb_config",
  properties?: {
    format?: string;
    datasetSlug?: string;
    fileSlug?: string;
  },
) {
  if (typeof window === "undefined") return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("url_copied", {
      url_type: urlType,
      format: properties?.format,
      dataset_slug: properties?.datasetSlug,
      file_slug: properties?.fileSlug,
    });
  } catch (error) {
    console.error("Failed to track URL copy:", error);
  }
}

/**
 * Get PostHog instance (for advanced usage)
 */
export function getPostHog() {
  if (typeof window === "undefined") return null;
  if (!posthogInitialized) initPostHog();
  return posthog;
}
