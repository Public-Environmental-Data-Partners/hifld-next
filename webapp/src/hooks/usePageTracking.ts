/**
 * Hook to track page views in TanStack Router
 */

import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { type PageViewProperties, trackPageView } from "@/lib/analytics";

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    // Extract route information from pathname
    const properties: PageViewProperties = {};

    // Parse pathname to extract route segments
    const pathSegments = location.pathname.split("/").filter(Boolean);

    // Extract collection slug if present
    const collectionIndex = pathSegments.indexOf("collections");
    const collectionSlug = pathSegments[collectionIndex + 1];
    if (collectionIndex !== -1 && collectionSlug) {
      properties.collection_slug = collectionSlug;
    }

    // Extract dataset slug if present
    const datasetIndex = pathSegments.indexOf("datasets");
    const datasetSlug = pathSegments[datasetIndex + 1];
    if (datasetIndex !== -1 && datasetSlug) {
      properties.dataset_slug = datasetSlug;
    }

    // Extract file slug if present
    const fileIndex = pathSegments.indexOf("files");
    const fileSlug = pathSegments[fileIndex + 1];
    if (fileIndex !== -1 && fileSlug) {
      properties.file_slug = fileSlug;
    }

    // Track page view
    trackPageView(location.pathname, properties);
  }, [location.pathname]);
}
