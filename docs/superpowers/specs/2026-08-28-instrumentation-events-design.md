# Instrumentation events design

## Goal

Close the important PostHog observability gaps without enabling broad client
autocapture or collecting identifiers from direct API consumers.

The change covers server-side discovery-route traffic, successful map imports,
accurate download lifecycle states, and the result counts for existing search
and filter interactions.

## Event contract

| Event | When it is emitted | Properties |
| --- | --- | --- |
| `api_route_requested` | A response completes for `/api` or any `/api/**` route, or for `/llms.txt`. | `request_url`, `route_family`, `method`, `status`, `client_category` |
| `dataset_imported_into_map` | A dataset file/source has resolved and is newly added to the map workspace. | `collection_slug`, `dataset_slug`, `file_slug`, `version`, `source_id`, `import_source`, `loaded_layer_count` |
| `dataset_download_clicked` | The user presses a download control. | Existing download context |
| `dataset_download_succeeded` | A browser-side streamed download has completed and been saved or handed to a generated blob URL. | Existing context plus bytes and duration |
| `dataset_download_handed_off` | The app hands a native or external download URL to the browser. This is not completion. | Existing download context plus duration |
| `dataset_download_failed` | The app observes an HTTP failure, stream failure, or save-picker cancellation. | Existing context plus a sanitized error summary, bytes, and duration |
| `dataset_search` | A non-empty search request resolves. | Existing query metadata, `result_count`, `is_zero_result`, and filter state |
| `tag_filter_applied` | A filter request resolves. | Existing filter context plus `result_count` and `is_zero_result` |

`route_family` is a fixed low-cardinality label: `api_root`, `api_resource`,
or `llms_txt`. `client_category` is similarly coarse: `browser`,
`known_agent`, `crawler`, `command_line`, or `other`. The implementation will
classify the request's `User-Agent` in memory and will never send its raw
value. `request_url` is the absolute server-observed request URL, including its
origin, path, public resource identifiers, and complete query string. HTTP
requests do not carry URL fragments, so fragments are not available to capture.

## Server discovery telemetry

A small Nitro server hook will watch completed responses for the routes above.
It will use the deployed PostHog host and project key already supplied as
runtime environment configuration, and it will make a best-effort capture
request without delaying or changing the application response.

The payload deliberately excludes IP addresses, request IDs other than those
already present in the URL, cookies, raw user-agent strings, referrers, and
request bodies. It intentionally retains the complete request URL so route,
resource, and query usage can be analyzed later. Direct machine clients remain
anonymous; the event measures request details and coarse client type rather
than attempting to identify a person or agent. Telemetry failures are swallowed
after a server-side log message and must not turn a successful API response into
an error.

## Browser interaction telemetry

PostHog autocapture remains disabled. The existing explicit event helpers gain
the small additions above instead of introducing a blanket click collector.

For downloads, native anchor downloads are observable only through browser
handoff. They must emit `dataset_download_handed_off`, never
`dataset_download_succeeded`. A browser cannot reliably report whether that
handed-off transfer later completed or was canceled, so the implementation
will not manufacture an "abandoned" event. Streamed downloads keep their
completion and failure events because the application controls the transfer.

For map use, emit one import event when a newly selected dataset source is
successfully resolved into a map layer. Do not emit it for visibility toggles,
style changes, hover, zoom, feature clicks, or repeated source synchronization.
No coordinates, feature IDs, feature properties, or map viewport data are
captured.

Search and filter events are emitted only after their own request resolves,
using that response's total rather than a value from prior component state.
This makes zero-result demand and filter dead ends report correctly.

## Tests and verification

- Add unit tests for the server route predicate, client categorization, and
  privacy-safe capture payload.
- Extend analytics tests for the map-import event, handed-off download event,
  and result-count properties.
- Extend download-button tests to prove native downloads hand off rather than
  succeed, while streamed successes and observable failures retain their
  existing states.
- Add route/component tests proving resolved searches and filters report their
  response totals, including zero.
- Run targeted tests during development, then `npm run check`, `npm run
  typecheck`, `npm test`, and `npm run build` from `webapp/`.

## Out of scope

- PostHog autocapture.
- API-consumer identity or persistent fingerprinting.
- Raw user agents, IP addresses, request headers or bodies, map coordinates,
  feature data, or feature identifiers. Complete request URLs, including query
  strings and path identifiers, are the intentional exception.
- Map zoom, pan, hover, feature-click, and layer-visibility analytics.
