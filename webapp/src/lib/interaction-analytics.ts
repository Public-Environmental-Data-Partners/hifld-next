import { getPostHog, type PageViewProperties } from "./analytics";
import { analyticsDisabled } from "./privacy";

type Feature = "map" | "table" | "clipboard" | "search" | "query" | "application" | "feedback";
type Failure =
  | "load"
  | "render"
  | "copy"
  | "request"
  | "runtime"
  | "unhandled_rejection"
  | "route_error"
  | "basemap"
  | "webgl_context_lost";

/** Only public catalog identifiers from the pathname; never read query strings. */
export function currentDatasetContext(): PageViewProperties {
  if (typeof window === "undefined") return {};
  const match = /^\/collections\/([^/]+)(?:\/datasets\/([^/]+)(?:\/files\/([^/]+))?)?/.exec(window.location.pathname);
  return {
    ...(match?.[1] ? { collection_slug: match[1] } : {}),
    ...(match?.[2] ? { dataset_slug: match[2] } : {}),
    ...(match?.[3] ? { file_slug: match[3] } : {}),
  };
}

let lastPath = "";
const reportedFailures = new Set<string>();

export function resetFailureTracking(): void {
  reportedFailures.clear();
  lastPath = typeof window === "undefined" ? "" : window.location.pathname;
}

function failureProperties(feature: Feature, failure: Failure, context: PageViewProperties, httpStatus?: number) {
  const page = currentDatasetContext();
  const routeKind = /\/map\/?$/.test(window.location.pathname)
    ? "map"
    : page.dataset_slug
      ? "dataset"
      : page.collection_slug
        ? "catalog"
        : "other";
  const status =
    httpStatus !== undefined && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus
      : undefined;
  return Object.fromEntries(
    Object.entries({
      feature,
      failure,
      route_kind: routeKind,
      collection_slug: context.collection_slug ?? page.collection_slug,
      dataset_slug: context.dataset_slug ?? page.dataset_slug,
      file_slug: context.file_slug ?? page.file_slug,
      http_status: status,
    }).filter(([, value]) => value !== undefined),
  );
}

/** Count affected page views, not every failed tile/retry. No error objects or messages. */
export function trackUiFailure(
  feature: Feature,
  failure: Failure,
  context: PageViewProperties = {},
  httpStatus?: number,
): void {
  if (typeof window === "undefined" || analyticsDisabled()) return;
  try {
    const posthog = getPostHog();
    if (!posthog) return;
    const path = window.location.pathname;
    if (path !== lastPath) {
      reportedFailures.clear();
      lastPath = path;
    }
    const properties = failureProperties(feature, failure, context, httpStatus);
    const key = JSON.stringify(properties);
    if (reportedFailures.has(key) || reportedFailures.size >= 20) return;
    posthog.capture("ui_operation_failed", properties);
    reportedFailures.add(key);
  } catch {
    /* Analytics must never interrupt an operation or recurse through error reporting. */
  }
}

export function installFailureTracking(): () => void {
  const onError = () => trackUiFailure("application", "runtime");
  const onRejection = (event: PromiseRejectionEvent) => {
    if ((event.reason instanceof Error || event.reason instanceof DOMException) && event.reason.name === "AbortError")
      return;
    trackUiFailure("application", "unhandled_rejection");
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
