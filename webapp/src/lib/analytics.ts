/**
 * Analytics utility for tracking user interactions with PostHog
 */

import posthog from 'posthog-js';
import { env } from '@/env/client';

// Initialize PostHog on the client side
let posthogInitialized = false;

export type DownloadMethod = 'native_link' | 'fetch_stream' | 'client_zip';

export interface DownloadAnalyticsContext {
  collection_slug?: string;
  dataset_slug?: string;
  file_slug?: string;
  format?: string;
  source_id?: number;
  storage_location_id?: number;
  version?: string | number;
  expected_size_bytes?: number;
  filename?: string;
  url_host?: string;
  download_method: DownloadMethod;
  source_count?: number;
}

export interface DownloadSuccessProperties {
  completion_status: 'completed' | 'handoff';
  received_bytes?: number;
  content_length_bytes?: number;
  duration_ms?: number;
  source_count?: number;
}

export interface DownloadFailureProperties {
  error_message: string;
  received_bytes?: number;
  content_length_bytes?: number;
  duration_ms?: number;
  source_count?: number;
}

function compactProperties(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  );
}

function captureDownloadEvent(
  eventName: 'dataset_download_clicked' | 'dataset_download_succeeded' | 'dataset_download_failed',
  context: DownloadAnalyticsContext,
  properties?: Record<string, unknown>
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return;

  try {
    posthog.capture(eventName, compactProperties({
      ...context,
      ...properties,
    }));
  } catch (error) {
    console.error(`Failed to track ${eventName}:`, error);
  }
}

export function initPostHog() {
  if (typeof window === 'undefined') return;
  if (posthogInitialized) return;
  if (!env.PUBLIC_POSTHOG_KEY) return;

  try {
    posthog.init(env.PUBLIC_POSTHOG_KEY, {
      api_host: env.PUBLIC_POSTHOG_HOST,
      // Privacy settings
      autocapture: false, // Disable auto-capture for privacy
      capture_pageview: false, // We'll track pageviews manually
      respect_dnt: true, // Respect Do Not Track
      // Optional: mask text in session replay
      mask_text_selector: 'input[type="search"]',
      loaded: (posthog) => {
        if (process.env.NODE_ENV === 'development') {
          console.log('PostHog initialized');
        }
      },
    });
    posthogInitialized = true;
  } catch (error) {
    console.error('Failed to initialize PostHog:', error);
  }
}

/**
 * Track a page view
 */
export function trackPageView(path: string, properties?: Record<string, any>) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return; // Safety check
  
  try {
    posthog.capture('$pageview', {
      $current_url: window.location.href,
      path,
      ...properties,
    });
  } catch (error) {
    console.error('Failed to track page view:', error);
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
  }
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return; // Safety check
  
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return; // Don't track empty queries

  try {
    posthog.capture('dataset_search', {
      query: trimmedQuery,
      query_length: properties?.queryLength ?? trimmedQuery.length,
      collection_slug: collectionSlug,
      result_count: resultCount,
      has_tag_filters: properties?.hasTagFilters ?? false,
      is_zero_result: resultCount === 0,
    });
  } catch (error) {
    console.error('Failed to track search query:', error);
  }
}

/**
 * Track tag filter application
 */
export function trackTagFilter(
  collectionSlug: string,
  filterKey: string,
  filterValues: string[],
  searchQuery?: string
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return; // Safety check
  
  try {
    posthog.capture('tag_filter_applied', {
      collection_slug: collectionSlug,
      filter_key: filterKey,
      filter_values: filterValues,
      search_query: searchQuery,
    });
  } catch (error) {
    console.error('Failed to track tag filter:', error);
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
  }
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return;
  
  try {
    posthog.capture('dataset_file_download', {
      format,
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
      collection_slug: collectionSlug,
      size_bytes: properties?.sizeBytes,
      storage_location_id: properties?.storageLocationId,
      version: properties?.version,
    });
  } catch (error) {
    console.error('Failed to track download:', error);
  }
}

export function trackDownloadClicked(context: DownloadAnalyticsContext) {
  captureDownloadEvent('dataset_download_clicked', context);
}

export function trackDownloadSucceeded(
  context: DownloadAnalyticsContext,
  properties: DownloadSuccessProperties
) {
  captureDownloadEvent('dataset_download_succeeded', context, properties);
}

export function trackDownloadFailed(
  context: DownloadAnalyticsContext,
  properties: DownloadFailureProperties
) {
  captureDownloadEvent('dataset_download_failed', context, properties);
}

/**
 * Track map viewer opened
 */
export function trackMapViewer(
  datasetSlug: string,
  fileSlug: string,
  collectionSlug: string
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return;
  
  try {
    posthog.capture('map_viewer_opened', {
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
      collection_slug: collectionSlug,
    });
  } catch (error) {
    console.error('Failed to track map viewer:', error);
  }
}

/**
 * Track data table opened
 */
export function trackDataTable(
  datasetSlug: string,
  fileSlug: string,
  collectionSlug: string
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return;
  
  try {
    posthog.capture('data_table_opened', {
      dataset_slug: datasetSlug,
      file_slug: fileSlug,
      collection_slug: collectionSlug,
    });
  } catch (error) {
    console.error('Failed to track data table:', error);
  }
}

/**
 * Track URL copied
 */
export function trackUrlCopied(
  urlType: 'storage_uri' | 'api_endpoint' | 'duckdb_config',
  properties?: {
    format?: string;
    datasetSlug?: string;
    fileSlug?: string;
  }
) {
  if (typeof window === 'undefined') return;
  if (!posthogInitialized) initPostHog();
  if (!posthogInitialized || typeof posthog.capture !== 'function') return;
  
  try {
    posthog.capture('url_copied', {
      url_type: urlType,
      format: properties?.format,
      dataset_slug: properties?.datasetSlug,
      file_slug: properties?.fileSlug,
    });
  } catch (error) {
    console.error('Failed to track URL copy:', error);
  }
}

/**
 * Get PostHog instance (for advanced usage)
 */
export function getPostHog() {
  if (typeof window === 'undefined') return null;
  if (!posthogInitialized) initPostHog();
  return posthog;
}
