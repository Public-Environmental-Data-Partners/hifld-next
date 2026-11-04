/**
 * Analytics utility for tracking user interactions with PostHog
 */

import posthog from "posthog-js";
import { analyticsDisabled, withoutUrlQuery } from "./privacy";
import { runtimeClientConfigFromWindow } from "./runtime-client-config";
import { searchQueryForAnalytics } from "./search-analytics";
import type { WebMcpErrorCode } from "./webmcp/result";

// Initialize PostHog on the client side
let posthogInitialized = false;

export type DownloadMethod = "native_link" | "fetch_stream" | "client_zip";

export type WebMcpRouteKind = "catalog" | "schema" | "query" | "map" | "comparison" | "workspace" | "unknown";
export type WebMcpDurationBucket = "0_99ms" | "100_499ms" | "500_1999ms" | "2000ms_plus";
export type WebMcpResultCountBucket = "0" | "1_9" | "10_49" | "50_plus";

export interface WebMcpAnalyticsProperties {
  tool_name: string;
  route_kind: WebMcpRouteKind;
  duration_bucket?: WebMcpDurationBucket | undefined;
  error_code?: WebMcpErrorCode | undefined;
  result_count_bucket?: WebMcpResultCountBucket | undefined;
}

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

type AnalyticsEventProperties =
  | PageViewProperties
  | DownloadAnalyticsContext
  | DownloadSuccessProperties
  | DownloadHandoffProperties
  | DownloadFailureProperties
  | DatasetMapImportInput;

function compactProperties(properties: AnalyticsEventProperties): PostHogEventProperties {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

const WEBMCP_ROUTE_KINDS: ReadonlySet<string> = new Set([
  "catalog",
  "schema",
  "query",
  "map",
  "comparison",
  "workspace",
  "unknown",
]);
const WEBMCP_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_request",
  "not_found",
  "unsupported_state",
  "query_rejected",
  "query_timeout",
  "query_capacity",
  "rate_limited",
  "upstream_unavailable",
  "internal_error",
]);

function durationBucket(durationMs: number): WebMcpDurationBucket {
  if (!Number.isFinite(durationMs) || durationMs < 100) return "0_99ms";
  if (durationMs < 500) return "100_499ms";
  if (durationMs < 2_000) return "500_1999ms";
  return "2000ms_plus";
}

function resultCountBucket(resultCount: number): WebMcpResultCountBucket {
  if (resultCount <= 0) return "0";
  if (resultCount < 10) return "1_9";
  if (resultCount < 50) return "10_49";
  return "50_plus";
}

/** Build an allowlisted WebMCP analytics payload; all other input fields are discarded. */
export function webMcpAnalyticsProperties(input: WebMcpAnalyticsProperties): PostHogEventProperties {
  const routeKind = WEBMCP_ROUTE_KINDS.has(input.route_kind) ? input.route_kind : "unknown";
  const properties: PostHogEventProperties = {
    tool_name: input.tool_name,
    route_kind: routeKind,
  };
  if (input.duration_bucket !== undefined) properties["duration_bucket"] = input.duration_bucket;
  if (input.error_code !== undefined && WEBMCP_ERROR_CODES.has(input.error_code)) {
    properties["error_code"] = input.error_code;
  }
  if (input.result_count_bucket !== undefined) properties["result_count_bucket"] = input.result_count_bucket;
  return properties;
}

function captureWebMcpEvent(
  eventName: "webmcp_tool_started" | "webmcp_tool_completed" | "webmcp_tool_failed",
  properties: WebMcpAnalyticsProperties,
): void {
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;
  try {
    posthog.capture(eventName, webMcpAnalyticsProperties(properties));
  } catch {
    console.error("Failed to track WebMCP analytics event.");
  }
}

export function trackWebMcpToolStarted(toolName: string, routeKind: WebMcpRouteKind): void {
  captureWebMcpEvent("webmcp_tool_started", { tool_name: toolName, route_kind: routeKind });
}

export function trackWebMcpToolCompleted(
  toolName: string,
  routeKind: WebMcpRouteKind,
  durationMs: number,
  resultCount?: number,
): void {
  captureWebMcpEvent("webmcp_tool_completed", {
    tool_name: toolName,
    route_kind: routeKind,
    duration_bucket: durationBucket(durationMs),
    ...(resultCount === undefined ? {} : { result_count_bucket: resultCountBucket(resultCount) }),
  });
}

export function trackWebMcpToolFailed(
  toolName: string,
  routeKind: WebMcpRouteKind,
  durationMs: number,
  errorCode?: WebMcpErrorCode,
): void {
  captureWebMcpEvent("webmcp_tool_failed", {
    tool_name: toolName,
    route_kind: routeKind,
    duration_bucket: durationBucket(durationMs),
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
  });
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
  if (typeof window === "undefined" || analyticsDisabled()) return;
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
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (posthogInitialized) return;
  const config = runtimeClientConfigFromWindow();
  if (!config.posthogKey) return;

  try {
    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      cookieless_mode: "always",
      persistence: "memory",
      person_profiles: "never",
      disable_session_recording: true,
      enable_heatmaps: false,
      capture_dead_clicks: false,
      rageclick: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_surveys: true,
      save_campaign_params: false,
      property_denylist: ["$search_keyword", "$initial_search_keyword"],
      before_send: (event) => {
        if (!event || analyticsDisabled()) return null;
        const properties = { ...event.properties };
        for (const key of ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer", "$pathname"]) {
          const value = properties[key];
          if (typeof value === "string") properties[key] = withoutUrlQuery(value);
        }
        delete properties["$set"];
        delete properties["$set_once"];
        const query =
          event.event === "dataset_search" && typeof properties["query"] === "string"
            ? searchQueryForAnalytics(properties["query"])
            : undefined;
        if (query !== undefined) properties["query"] = query;
        else delete properties["query"];
        delete properties["search_query"];
        const filtered = { ...event, properties };
        delete filtered.$set;
        delete filtered.$set_once;
        delete filtered.$unset;
        return filtered;
      },
      // Privacy settings
      autocapture: false, // Disable auto-capture for privacy
      capture_pageview: false, // We'll track pageviews manually
      respect_dnt: true, // Respect Do Not Track
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
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return; // Safety check

  try {
    posthog.capture("$pageview", {
      $current_url: withoutUrlQuery(window.location.href),
      path: withoutUrlQuery(path),
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
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return; // Safety check

  const trimmedQuery = query.trim();
  if (!trimmedQuery) return; // Don't track empty queries
  const analyticsQuery = searchQueryForAnalytics(trimmedQuery);

  try {
    posthog.capture("dataset_search", {
      ...(analyticsQuery !== undefined ? { query: analyticsQuery } : {}),
      query_suppressed: analyticsQuery === undefined,
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
  _searchQuery?: string,
) {
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return; // Safety check

  try {
    posthog.capture("tag_filter_applied", {
      collection_slug: collectionSlug,
      filter_key: filterKey,
      filter_values: filterValues,
      result_count: resultCount,
      is_zero_result: resultCount === 0,
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
  if (typeof window === "undefined" || analyticsDisabled()) return;
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
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("dataset_imported_into_map", compactProperties(input));
  } catch (error) {
    console.error("Failed to track dataset map import:", error);
  }
}

/**
 * Track map viewer opened
 */
export function trackMapViewer(datasetSlug: string, fileSlug: string, collectionSlug: string) {
  if (typeof window === "undefined" || analyticsDisabled()) return;
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
export type DataTableKind = "query_results" | "parquet_preview" | "selected_features";

export function trackDataTable(
  tableKind: DataTableKind,
  context: { collectionSlug?: string | undefined; datasetSlug?: string | undefined; fileSlug?: string | undefined },
) {
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("data_table_opened", {
      table_kind: tableKind,
      collection_slug: context.collectionSlug,
      dataset_slug: context.datasetSlug,
      file_slug: context.fileSlug,
    });
  } catch (error) {
    console.error("Failed to track data table:", error);
  }
}

/**
 * Track URL copied
 */
export type CopiedUrlType = "download_url" | "storage_uri" | "api_endpoint" | "duckdb_config";

export interface UrlCopiedContext {
  urlType: CopiedUrlType;
  format: string;
  collectionSlug?: string | undefined;
  datasetSlug?: string | undefined;
  fileSlug?: string | undefined;
}

export function trackUrlCopied({ urlType, format, collectionSlug, datasetSlug, fileSlug }: UrlCopiedContext) {
  if (typeof window === "undefined" || analyticsDisabled()) return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== "function") return;

  try {
    posthog.capture("url_copied", {
      url_type: urlType,
      format,
      collection_slug: collectionSlug,
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
    });
  } catch (error) {
    console.error("Failed to track URL copy:", error);
  }
}

/**
 * Get PostHog instance (for advanced usage)
 */
export function getPostHog() {
  if (typeof window === "undefined" || analyticsDisabled()) return null;
  if (!posthogInitialized) initPostHog();
  return posthog;
}
