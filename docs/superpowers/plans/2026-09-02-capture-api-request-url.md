# Capture API Request URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include the complete server-observed request URL in every `api_route_requested` PostHog event.

**Architecture:** Extend the existing typed `DiscoveryRouteCapture` contract with a `request_url` string and populate it directly from `Request.url`. Keep the current route filtering, anonymous identity, method/status fields, and user-agent categorization unchanged.

**Tech Stack:** TypeScript, Nitro, PostHog Node SDK, Vitest.

---

## File structure

- Modify: `webapp/src/lib/server-discovery-analytics.ts` — add `request_url` to the event contract and capture payload.
- Modify: `webapp/src/lib/__tests__/server-discovery-analytics.test.ts` — prove the absolute URL, path identifiers, and complete query string are retained.
- Modify: `webapp/plugins/__tests__/posthog-discovery-analytics.test.ts` — update the integration-level expected payload.

### Task 1: Capture the complete request URL

**Files:**
- Modify: `webapp/src/lib/server-discovery-analytics.ts:17-82`
- Test: `webapp/src/lib/__tests__/server-discovery-analytics.test.ts`
- Test: `webapp/plugins/__tests__/posthog-discovery-analytics.test.ts`

- [x] **Step 1: Update the pure event-contract tests**

Add `request_url` to the exact payload assertions. Replace the privacy test that rejects the URL and query string with an assertion that the complete absolute URL is retained while unrelated headers remain excluded:

```ts
const requestUrl = "https://data.example.test/api/collections/hifld?search=hospitals&limit=25";
const capture = buildDiscoveryRouteCapture(
  new Request(requestUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 Example Browser",
      "x-forwarded-for": "203.0.113.10",
      cookie: "session=secret",
      referer: "https://elsewhere.example.test/private/path",
    },
  }),
  200,
);

expect(capture?.properties.request_url).toBe(requestUrl);
const serialized = JSON.stringify(capture);
expect(serialized).not.toContain("Mozilla/5.0");
expect(serialized).not.toContain("203.0.113.10");
expect(serialized).not.toContain("session=secret");
expect(serialized).not.toContain("elsewhere.example.test");
```

Add `request_url` to the plugin integration assertion as well.

- [x] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
npm test -- src/lib/__tests__/server-discovery-analytics.test.ts plugins/__tests__/posthog-discovery-analytics.test.ts
```

Expected: FAIL because `request_url` is missing from `DiscoveryRouteCapture.properties` and the emitted payload.

- [x] **Step 3: Implement the minimal typed payload change**

Add the field to the interface and payload:

```ts
properties: {
  $process_person_profile: false;
  request_url: string;
  route_family: DiscoveryRouteFamily;
  method: DiscoveryHttpMethod;
  status: number;
  client_category: DiscoveryClientCategory;
};
```

```ts
properties: {
  $process_person_profile: false,
  request_url: request.url,
  route_family: routeFamily,
  method: discoveryHttpMethod(request.method),
  status,
  client_category: discoveryClientCategory(request.headers.get("user-agent")),
},
```

- [x] **Step 4: Run the focused tests to verify they pass**

Run:

```bash
npm test -- src/lib/__tests__/server-discovery-analytics.test.ts plugins/__tests__/posthog-discovery-analytics.test.ts
```

Expected: PASS with the full URL included and unrelated headers absent.

- [x] **Step 5: Commit the implementation**

```bash
git add webapp/src/lib/server-discovery-analytics.ts webapp/src/lib/__tests__/server-discovery-analytics.test.ts webapp/plugins/__tests__/posthog-discovery-analytics.test.ts
git commit -m "feat(webapp): capture API request URLs"
```

### Task 2: Run the webapp quality gate

**Files:**
- Verify: `webapp/`

- [x] **Step 1: Run static checks**

Run:

```bash
npm run check
npm run typecheck
```

Expected: both commands exit successfully.

- [x] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 3: Confirm the branch diff is scoped**

Run:

```bash
git diff main...HEAD --check
git status --short
```

Expected: no whitespace errors and a clean worktree.
