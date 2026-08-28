# Instrumentation Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-safe discovery-route telemetry, map-import telemetry, accurate download lifecycle events, and resolved search/filter result counts.

**Architecture:** A small pure server-analytics module decides whether a completed Nitro response is in scope and builds its deliberately minimal PostHog capture payload. A Nitro plugin owns the long-lived `posthog-node` client and sends those events without changing responses. Browser analytics remains explicit: its shared helper gains a map-import and download-handoff event, while the collection route uses resolved request totals and map workspace records each newly loaded source once.

**Tech Stack:** React 19, TanStack Start/Router, Nitro, TypeScript, Vitest, `posthog-js`, `posthog-node`.

---

## File structure

- `webapp/src/lib/server-discovery-analytics.ts` — Pure route filtering, coarse user-agent classification, and privacy-safe `posthog-node` capture input construction.
- `webapp/src/lib/__tests__/server-discovery-analytics.test.ts` — Unit coverage for route scope, categorization, and payload data minimization.
- `webapp/plugins/posthog-discovery-analytics.ts` — Nitro response hook and the process-long PostHog Node client lifecycle.
- `webapp/src/lib/analytics.ts` — Browser event types and explicit capture functions for download handoff and map import.
- `webapp/src/lib/__tests__/analytics.test.ts` — Exact browser-event payload checks.
- `webapp/src/components/dataset/DownloadButton.tsx` and `webapp/src/components/dataset/__tests__/DownloadButton.test.tsx` — Correct native-download lifecycle semantics.
- `webapp/src/components/dataset/ShapefileZipDownloadButton.tsx` and its existing test — Ensure the client-created ZIP flow keeps reporting an actual completion or failure.
- `webapp/src/routes/collections.$slug.tsx` and its route test — Use the response that resolved the action to record search and filter totals.
- `webapp/src/routes/collections.$collectionSlug.map.tsx` and its route test — Report one event per source newly added to the map, including route-loaded sources.
- `webapp/package.json` and `webapp/package-lock.json` — Add the official Node server SDK.

### Task 1: Add and test the privacy-safe server event contract

**Files:**
- Create: `webapp/src/lib/server-discovery-analytics.ts`
- Create: `webapp/src/lib/__tests__/server-discovery-analytics.test.ts`

- [ ] **Step 1: Write the failing unit tests for eligible route payloads and exclusions.**

  Add tests that call exported pure helpers with `Request` instances. Cover `/api`, `/api/collections/hifld?search=hospitals`, and `/llms.txt`; assert the payload is exactly the fixed event name, the constant anonymous distinct ID, `$process_person_profile: false`, `route_family`, method, status, and `client_category`. Add negative cases for `/collections/hifld`, `/.well-known/agent-skills/index.json`, and `/apiary`.

  ```ts
  expect(buildDiscoveryRouteCapture(new Request("https://catalog.test/api?search=hospitals", {
    headers: { "user-agent": "curl/8.7.1" },
  }), 200)).toEqual({
    distinctId: "anonymous-discovery-route",
    event: "api_route_requested",
    properties: {
      $process_person_profile: false,
      route_family: "api_root",
      method: "GET",
      status: 200,
      client_category: "command_line",
    },
  });
  ```

  Add an assertion that serializing the event does not contain the query string, raw user-agent, IP-like header, cookie, referrer, or full URL.

- [ ] **Step 2: Run the focused test to verify it fails for the missing module.**

  Run: `npm test -- src/lib/__tests__/server-discovery-analytics.test.ts`

  Expected: FAIL because `../server-discovery-analytics` does not exist.

- [ ] **Step 3: Implement the pure server analytics module.**

  Define narrow exported unions and functions; do not introduce `any`, `unknown`, broad `object`, or a generic record type.

  ```ts
  export type DiscoveryRouteFamily = "api_root" | "api_resource" | "llms_txt";
  export type DiscoveryClientCategory = "browser" | "known_agent" | "crawler" | "command_line" | "other";

  export interface DiscoveryRouteCapture {
    distinctId: "anonymous-discovery-route";
    event: "api_route_requested";
    properties: {
      $process_person_profile: false;
      route_family: DiscoveryRouteFamily;
      method: string;
      status: number;
      client_category: DiscoveryClientCategory;
    };
  }

  export function buildDiscoveryRouteCapture(request: Request, status: number): DiscoveryRouteCapture | null {
    const routeFamily = discoveryRouteFamily(new URL(request.url).pathname);
    if (!routeFamily) return null;
    return {
      distinctId: "anonymous-discovery-route",
      event: "api_route_requested",
      properties: {
        $process_person_profile: false,
        route_family: routeFamily,
        method: request.method,
        status,
        client_category: discoveryClientCategory(request.headers.get("user-agent")),
      },
    };
  }
  ```

  `discoveryRouteFamily` must accept exactly `/api`, `/api/**`, and `/llms.txt`; it must not match a prefix such as `/apiary`. `discoveryClientCategory` may inspect the raw header only in memory and must return a fixed label. Classify OpenAI/Anthropic/Claude/Perplexity user agents as `known_agent`, general bots/spiders/crawlers as `crawler`, curl/wget/HTTPie/request-library identifiers as `command_line`, conventional browser signatures as `browser`, and all remaining/missing values as `other`.

- [ ] **Step 4: Run the focused test to verify it passes.**

  Run: `npm test -- src/lib/__tests__/server-discovery-analytics.test.ts`

  Expected: PASS; all supported paths create only the listed properties and all out-of-scope paths return `null`.

- [ ] **Step 5: Commit the pure event contract.**

  ```bash
  git add webapp/src/lib/server-discovery-analytics.ts webapp/src/lib/__tests__/server-discovery-analytics.test.ts
  git commit -m "feat(webapp): define discovery analytics events"
  ```

### Task 2: Wire completed Nitro responses to PostHog Node

**Files:**
- Modify: `webapp/package.json`
- Modify: `webapp/package-lock.json`
- Create: `webapp/plugins/posthog-discovery-analytics.ts`
- Create: `webapp/plugins/__tests__/posthog-discovery-analytics.test.ts`

- [ ] **Step 1: Write the failing plugin registration test.**

  Export a small `registerDiscoveryAnalytics` function from the plugin that accepts a hook-registration interface and a capture interface. In the test, inject a fake response-hook registrar and capture client; invoke the captured callback with an in-scope `Request`/`Response` pair. Assert one `capture` call uses the pure module’s event and a 404 `/api/...` response retains `status: 404`. Verify no capture occurs for `/collections/hifld` and when no PostHog key is configured.

  ```ts
  expect(capture).toHaveBeenCalledWith({
    distinctId: "anonymous-discovery-route",
    event: "api_route_requested",
    properties: expect.objectContaining({ route_family: "api_resource", status: 404 }),
  });
  ```

- [ ] **Step 2: Run the focused plugin test to verify it fails.**

  Run: `npm test -- plugins/__tests__/posthog-discovery-analytics.test.ts`

  Expected: FAIL because the plugin module and registration function do not exist.

- [ ] **Step 3: Install the official Node SDK.**

  Run: `npm install posthog-node`

  Expected: `webapp/package.json` and `webapp/package-lock.json` add `posthog-node`; do not add another analytics transport or a custom HTTP implementation.

- [ ] **Step 4: Implement the Nitro plugin with a singleton, non-blocking client.**

  Use Nitro’s auto-discovered `plugins/` directory and its `response` lifecycle hook, which receives the completed `Response` and original HTTP event. Read the already-deployed optional `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` directly from `process.env`; do nothing when the key is blank. Instantiate `PostHog` once at startup with `host`, `disableGeoip: true`, and its default asynchronous queue. Register a `close` hook to `await client.shutdown()`.

  The registration seam should look like:

  ```ts
  export function registerDiscoveryAnalytics(
    hooks: ResponseHookRegistrar,
    client: DiscoveryAnalyticsClient | null,
  ): void {
    if (!client) return;
    hooks.hook("response", (response, event) => {
      const capture = buildDiscoveryRouteCapture(event.req, response.status);
      if (capture) client.capture(capture);
    });
  }
  ```

  The default plugin calls that seam with `nitroApp.hooks` and the singleton `PostHog` client. It must not use PostHog’s request-context middleware, which would add the raw URL, user-agent, and IP properties forbidden by the design. The response hook must not await analytics capture or modify the response.

- [ ] **Step 5: Run the focused tests to verify the hook and contract pass.**

  Run: `npm test -- src/lib/__tests__/server-discovery-analytics.test.ts plugins/__tests__/posthog-discovery-analytics.test.ts`

  Expected: PASS, including successful and error API responses plus `/llms.txt`.

- [ ] **Step 6: Commit the server integration.**

  ```bash
  git add webapp/package.json webapp/package-lock.json webapp/plugins/posthog-discovery-analytics.ts webapp/plugins/__tests__/posthog-discovery-analytics.test.ts
  git commit -m "feat(webapp): capture discovery route usage"
  ```

### Task 3: Make browser download outcomes semantically accurate

**Files:**
- Modify: `webapp/src/lib/analytics.ts`
- Modify: `webapp/src/lib/__tests__/analytics.test.ts`
- Modify: `webapp/src/components/dataset/DownloadButton.tsx`
- Modify: `webapp/src/components/dataset/__tests__/DownloadButton.test.tsx`
- Modify: `webapp/src/components/dataset/ShapefileZipDownloadButton.tsx`
- Modify: `webapp/src/components/dataset/__tests__/ShapefileZipDownloadButton.test.tsx`

- [ ] **Step 1: Write failing analytics-helper tests for a download handoff.**

  Add a `trackDownloadHandedOff` test whose expected event is `dataset_download_handed_off`, carries the existing `DownloadAnalyticsContext`, and has only a numeric `duration_ms` outcome property. Update the success test to require `completion_status: "completed"` and to reject a handoff-shaped success.

  ```ts
  expect(capture).toHaveBeenCalledWith("dataset_download_handed_off", {
    collection_slug: "hifld",
    dataset_slug: "airport-runways",
    file_slug: "runways",
    format: "geoparquet",
    download_method: "native_link",
    duration_ms: 125,
  });
  ```

- [ ] **Step 2: Run the analytics test to verify it fails.**

  Run: `npm test -- src/lib/__tests__/analytics.test.ts`

  Expected: FAIL because `trackDownloadHandedOff` does not exist and `DownloadSuccessProperties` still permits `handoff`.

- [ ] **Step 3: Implement the typed handoff capture helper.**

  Add `DownloadHandoffProperties` with `duration_ms`. Restrict `DownloadSuccessProperties["completion_status"]` to `"completed"`, add `trackDownloadHandedOff`, and expand the private event-name union so it accepts `dataset_download_handed_off`. Reuse `compactProperties` and the existing no-op behavior when PostHog is unavailable; do not include a URL or a new identifier.

- [ ] **Step 4: Run the analytics test to verify it passes.**

  Run: `npm test -- src/lib/__tests__/analytics.test.ts`

  Expected: PASS with a distinct handoff event and unchanged click/failure payload behavior.

- [ ] **Step 5: Write failing component tests for native handoff and completed streams.**

  In `DownloadButton.test.tsx`, replace the native assertion for `dataset_download_succeeded` with `dataset_download_handed_off`, and explicitly assert no success event is captured. Keep the fetch-stream test expecting only a completed success. In the failed-fetch test, expect a failure followed by a handoff because the existing fallback opens the original URL; assert it never reports success. Add the matching handoff assertion to any Shapefile ZIP direct fallback path; keep client-created ZIP completion as `dataset_download_succeeded`.

- [ ] **Step 6: Run the component tests to verify they fail.**

  Run: `npm test -- src/components/dataset/__tests__/DownloadButton.test.tsx src/components/dataset/__tests__/ShapefileZipDownloadButton.test.tsx`

  Expected: FAIL because native direct links still emit `dataset_download_succeeded` with `completion_status: "handoff"`.

- [ ] **Step 7: Change download call sites to emit truthfully.**

  In `executeDownload`, preserve the click before work. For `useDirectDownload`, call `triggerAnchorDownload` and then `trackDownloadHandedOff`; do not invoke `trackDownloadSucceeded`. In the `catch` fallback, retain `trackDownloadFailed`, open the original link, then record the handoff. Keep `trackCompleted` for only file-picker and blob-stream paths. Apply the same rule in `executeShapefileZipDownload`: a successfully generated client ZIP is completed; a direct browser fallback is handed off; no observable cancel/fetch error is relabeled as success.

- [ ] **Step 8: Run the component tests to verify they pass.**

  Run: `npm test -- src/components/dataset/__tests__/DownloadButton.test.tsx src/components/dataset/__tests__/ShapefileZipDownloadButton.test.tsx src/lib/__tests__/analytics.test.ts`

  Expected: PASS; native downloads have click plus handoff, streamed downloads have click plus completed success, and observed errors have failure (and fallback handoff when applicable).

- [ ] **Step 9: Commit the download lifecycle correction.**

  ```bash
  git add webapp/src/lib/analytics.ts webapp/src/lib/__tests__/analytics.test.ts webapp/src/components/dataset/DownloadButton.tsx webapp/src/components/dataset/__tests__/DownloadButton.test.tsx webapp/src/components/dataset/ShapefileZipDownloadButton.tsx webapp/src/components/dataset/__tests__/ShapefileZipDownloadButton.test.tsx
  git commit -m "fix(webapp): distinguish download handoffs from success"
  ```

### Task 4: Capture successful map-source imports exactly once

**Files:**
- Modify: `webapp/src/lib/analytics.ts`
- Modify: `webapp/src/lib/__tests__/analytics.test.ts`
- Modify: `webapp/src/routes/collections.$collectionSlug.map.tsx`
- Modify: `webapp/src/routes/__tests__/collections.$collectionSlug.map.test.tsx`

- [ ] **Step 1: Write the failing analytics-helper test for a map import.**

  Add a `trackDatasetImportedIntoMap` test that expects only collection, dataset, file, optional source/version, an `import_source` union (`"route" | "picker"`), and `loaded_layer_count`. Include a negative assertion that feature ID, coordinates, properties, source URL, and map viewport are absent.

  ```ts
  trackDatasetImportedIntoMap({
    collection_slug: "hifld",
    dataset_slug: "hospitals",
    file_slug: "hospitals",
    source_id: 17,
    version: "v1",
    import_source: "picker",
    loaded_layer_count: 2,
  });
  ```

- [ ] **Step 2: Run the analytics test to verify it fails.**

  Run: `npm test -- src/lib/__tests__/analytics.test.ts`

  Expected: FAIL because the map-import helper and its narrow context do not exist.

- [ ] **Step 3: Implement the map-import analytics helper.**

  Add an exported `MapImportAnalyticsContext` interface using the snake-case property names above and `trackDatasetImportedIntoMap(context)`. It must use the same client initialization/guard/`compactProperties` pattern as the other explicit browser events and capture exactly `dataset_imported_into_map`.

- [ ] **Step 4: Run the analytics test to verify it passes.**

  Run: `npm test -- src/lib/__tests__/analytics.test.ts`

  Expected: PASS and the payload contains no map or feature content.

- [ ] **Step 5: Write failing map-workspace tests for route and picker imports.**

  Mock `trackDatasetImportedIntoMap` in the existing map-route test. Render `MapWorkspace` with one resolved initial layer and assert one `import_source: "route"` event. Exercise `addSelectedLayer` through the existing picker controls and assert one additional `import_source: "picker"` event with the updated layer count. Re-render/synchronize an already loaded descriptor and assert no duplicate event.

- [ ] **Step 6: Run the map-route test to verify it fails.**

  Run: `npm test -- src/routes/__tests__/collections.$collectionSlug.map.test.tsx`

  Expected: FAIL because the workspace has no import telemetry or deduplication.

- [ ] **Step 7: Track newly loaded descriptors, not rendering noise.**

  In `MapWorkspace`, maintain a `useRef<Set<string>>` keyed by `sourceDescriptorId` for sources already reported and a second ref mapping newly added descriptor IDs to `"route"` or `"picker"`. Seed route-loaded descriptors before the effect and label descriptors from the route-search synchronization as `"route"`; label a descriptor in `addSelectedLayer` as `"picker"` only after `resolveDescriptor` produces a layer. Add a `useEffect` over `loadedLayers` that emits once for every unreported layer, with values from `layer.descriptor`, the layer’s source/version metadata, the recorded import source, and `loadedLayers.length`.

  Never call analytics in a React state updater. Do not attach tracking to layer visibility, removal, style controls, hover, zoom, feature selection, or MapLibre events.

- [ ] **Step 8: Run the map tests to verify they pass.**

  Run: `npm test -- src/routes/__tests__/collections.$collectionSlug.map.test.tsx src/lib/__tests__/analytics.test.ts`

  Expected: PASS; initial route sources and picker additions each emit once, while a state synchronization or toggle emits nothing.

- [ ] **Step 9: Commit map-import instrumentation.**

  ```bash
  git add webapp/src/lib/analytics.ts webapp/src/lib/__tests__/analytics.test.ts webapp/src/routes/collections.$collectionSlug.map.tsx webapp/src/routes/__tests__/collections.$collectionSlug.map.test.tsx
  git commit -m "feat(webapp): track map dataset imports"
  ```

### Task 5: Report the actual result total for searches and filters

**Files:**
- Modify: `webapp/src/lib/analytics.ts`
- Modify: `webapp/src/lib/__tests__/analytics.test.ts`
- Modify: `webapp/src/routes/collections.$slug.tsx`
- Modify: `webapp/src/routes/__tests__/collections.$slug.test.tsx`

- [ ] **Step 1: Write failing helper tests for resolved filter outcomes.**

  Update the `trackTagFilter` test signature to accept a resolved result count and expect `result_count` plus `is_zero_result`. Add a zero-result search assertion that expects `result_count: 0` and `is_zero_result: true`.

  ```ts
  trackTagFilter("hifld", "geometry_type", ["Point"], 0, "hospital");
  expect(capture).toHaveBeenCalledWith("tag_filter_applied", expect.objectContaining({
    result_count: 0,
    is_zero_result: true,
  }));
  ```

- [ ] **Step 2: Run the analytics test to verify it fails.**

  Run: `npm test -- src/lib/__tests__/analytics.test.ts`

  Expected: FAIL because filter events do not have outcome fields and the function signature does not take a result count.

- [ ] **Step 3: Extend the narrow filter event contract.**

  Change `trackTagFilter` to accept `resultCount: number` before the optional `searchQuery`. Capture `result_count: resultCount` and `is_zero_result: resultCount === 0`. Leave the existing non-empty `trackSearchQuery` behavior and its explicit result properties intact.

- [ ] **Step 4: Run the analytics test to verify it passes.**

  Run: `npm test -- src/lib/__tests__/analytics.test.ts`

  Expected: PASS with both filters and searches exposing zero-result demand.

- [ ] **Step 5: Write failing collection-route tests for resolved totals.**

  Mock the analytics helpers. Cover a URL-driven search whose loader response has `total: 0`; assert the search event uses zero rather than the prior page total. Cover a tag-filter request resolving with `total: 3`; assert `tag_filter_applied` is called only after that request and has `result_count: 3`. Add an aborted filter request case and assert it emits no outcome event.

- [ ] **Step 6: Run the collection-route test to verify it fails.**

  Run: `npm test -- src/routes/__tests__/collections.$slug.test.tsx`

  Expected: FAIL because URL-driven events use component state and filter tracking happens before the request resolves.

- [ ] **Step 7: Return and consume the actual request result.**

  Change `runFilteredDatasetRequest` and the `fetchDatasets` callback to return `Promise<FilteredDatasetFetchResult | null>`. Return `null` for an abort or a request error; return the resolved response after applying its data. In the tag-filter handler, await that result before calling `trackTagFilter`, and skip tracking when it is `null`. In the tag-filter search debounce, use `result.total`, not `filteredTotal` state, for `trackSearchQuery`.

  For loader-driven searches, return the loader’s normalized query alongside `datasetsResponse`:

  ```ts
  return { collection, datasetsResponse, resolvedSearchQuery: searchQuery };
  ```

  Drive the URL-search tracking effect from `resolvedSearchQuery` and `datasetsResponse.total` as one matched pair. Retain `lastTrackedQueryRef` to prevent duplicate captures caused by loader-data re-renders, but remove any path that sends a count belonging to an earlier query.

- [ ] **Step 8: Run collection and analytics tests to verify they pass.**

  Run: `npm test -- src/routes/__tests__/collections.$slug.test.tsx src/lib/__tests__/analytics.test.ts`

  Expected: PASS; zero-result searches and filters report zero only after their own response, while aborts/errors produce no misleading successful outcome event.

- [ ] **Step 9: Commit resolved search/filter telemetry.**

  ```bash
  git add webapp/src/lib/analytics.ts webapp/src/lib/__tests__/analytics.test.ts webapp/src/routes/collections.$slug.tsx webapp/src/routes/__tests__/collections.$slug.test.tsx
  git commit -m "fix(webapp): report resolved search and filter totals"
  ```

### Task 6: Run the required full webapp verification

**Files:**
- Modify only if a failure reveals a defect in Tasks 1–5.

- [ ] **Step 1: Run static checks.**

  Run: `npm run check && npm run typecheck`

  Expected: both commands exit 0 with no Biome or TypeScript errors.

- [ ] **Step 2: Run the full test suite.**

  Run: `npm test`

  Expected: all test files pass. Record pre-existing expected test-stderr or Vitest close warnings separately if they remain, but do not treat them as test failures.

- [ ] **Step 3: Run the production build.**

  Run: `npm run build`

  Expected: exit 0, proving the Nitro plugin and Node SDK bundle with the deployment build.

- [ ] **Step 4: Inspect the final change set and commit verification fixes if needed.**

  ```bash
  git diff --check
  git status --short
  git add -A
  git commit -m "test(webapp): verify instrumentation events"
  ```

  Only make the final commit if verification required changes not already committed in Tasks 1–5. Otherwise leave the working tree clean and report the exact commands and results.
