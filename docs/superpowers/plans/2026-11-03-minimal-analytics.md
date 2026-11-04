# Minimal analytics and consented feedback

Implements the approach approved in the conversation: no consent popup, no replay or persistent visitor tracking, cookieless visitor estimates and download reporting, normalized server agent attribution, and explicitly consented feedback in PostHog.

- Keep PostHog JS in cookieless always mode with memory-only persistence and no person profiles. Honor DNT, GPC and an explicit analytics opt-out. Disable replay, heatmaps, autocapture and unsolicited SDK events. Retain bounded, normalized search terms to discover missing datasets, with best-effort suppression of common sensitive patterns, an inline notice and a suppression flag. Strip URL query strings. Retain visitor estimates, geography/device/referral summaries, dataset actions and download lifecycle/byte counts. Cookieless identity is computed by PostHog using request IP, user agent and rotating salt; it is an estimate, not persistent person tracking.
- Retain server discovery counts with sanitized URLs, normalized agent provider/client/purpose, and self-declared attribution. Keep a shared anonymous identity and disable person profiles and GeoIP. Do not claim distinct visitors or independently verified providers.
- Deliver feedback through a bounded, same-origin JSON endpoint. Require affirmative consent, validate all fields, stamp consent version/time on the server, exclude feature geometry, and confirm ingestion before success. Keep failed reports editable.
- Follow the existing PEDP Privacy Policy without editing it. Give a brief HIFLD-specific disclosure and analytics preferences at `/privacy`, linking PEDP's policy for commitments and contact information. Offer an opt-out control on the privacy page, reached through a plain Privacy footer link, without a popup. Document retention/deletion operations that require production account administration.
- Add regression tests for privacy boundaries, consent validation, error handling, and agent labels. Run targeted tests, then webapp check, typecheck, tests, and build.

No deployment or historical deletion is included. Enable cookieless ingestion and disable replay in the project settings, as authorized by the user’s explicit agreement to moving to cookieless. Existing unrelated working-tree files remain untouched.

## Interaction and failure visibility (2026-11-04)

Wire map/table opens and successful URL/config copies. Capture handled map, table, search and query failures, router errors, unexpected browser errors/rejections using `ui_operation_failed`. Allow only feature/failure categories, route kind and public dataset context; exclude error text/stacks, copied values, SQL, request bodies and feature contents. Ignore aborts. Deduplicate identical failures and cap distinct reports at 20 per pathname visit. Reuse cookieless initialization/privacy controls. Add regression tests first, then wire controls/handlers, extend policy/docs, run required gates and push PR #105. No dependency, replay, autocapture or SDK exception collection.

## Human and agent error pages

Use the existing HIFLD type, color and button tokens in a restrained, readable page. Replace router default error and not-found components. Explain an unavailable request separately from a missing page, offer retry for failures and a catalog link for both, and show a safe stable error category (`page_unavailable` / `page_not_found`). Keep support contact available. Do not render any exception properties. Keep existing HTTP status semantics and API JSON contracts. Test static HTML for absence of a deliberately sensitive exception and verify recovery links/actions.

Production-response verification found TanStack embeds loader exception messages in hydration even with a safe visible component. Add a Start serialization adapter that replaces `Error` instances with a fixed generic error before serialization; do not send raw messages/stacks/causes/custom fields. Verify a 500 response caused by a synthetic private catalog path contains neither that path nor its exception code, and a missing-page response remains 404.
