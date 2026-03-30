/**
 * PostHog Provider component for TanStack Start
 * Initializes PostHog on the client side only
 */

import { useEffect } from 'react';
import { initPostHog } from '@/lib/analytics';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initialize PostHog only on client side
    initPostHog();
  }, []);

  return <>{children}</>;
}

