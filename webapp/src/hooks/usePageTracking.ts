/**
 * Hook to track page views in TanStack Router
 */

import { useEffect } from 'react';
import { useLocation } from '@tanstack/react-router';
import { trackPageView } from '@/lib/analytics';

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    // Extract route information from pathname
    const properties: Record<string, any> = {};
    
    // Parse pathname to extract route segments
    const pathSegments = location.pathname.split('/').filter(Boolean);
    
    // Extract collection slug if present
    const collectionIndex = pathSegments.indexOf('collections');
    if (collectionIndex !== -1 && pathSegments[collectionIndex + 1]) {
      properties.collection_slug = pathSegments[collectionIndex + 1];
    }
    
    // Extract dataset slug if present
    const datasetIndex = pathSegments.indexOf('datasets');
    if (datasetIndex !== -1 && pathSegments[datasetIndex + 1]) {
      properties.dataset_slug = pathSegments[datasetIndex + 1];
    }
    
    // Extract file slug if present
    const fileIndex = pathSegments.indexOf('files');
    if (fileIndex !== -1 && pathSegments[fileIndex + 1]) {
      properties.file_slug = pathSegments[fileIndex + 1];
    }

    // Track page view
    trackPageView(location.pathname, properties);
  }, [location.pathname]);
}

