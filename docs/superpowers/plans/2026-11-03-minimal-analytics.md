# Minimal analytics and consented feedback

Implements the approach approved in the conversation: no consent popup, no replay or persistent visitor tracking, cookieless visitor estimates and download reporting, normalized server agent attribution, and explicitly consented feedback in PostHog.

- Keep PostHog JS in cookieless always mode with memory-only persistence and no person profiles. Honor DNT, GPC and an explicit analytics opt-out. Disable replay, heatmaps, autocapture and unsolicited SDK events. Retain bounded, normalized search terms to discover missing datasets, with best-effort suppression of common sensitive patterns, an inline notice and a suppression flag. Strip URL query strings. Retain visitor estimates, geography/device/referral summaries, dataset actions and download lifecycle/byte counts. Cookieless identity is computed by PostHog using request IP, user agent and rotating salt; it is an estimate, not persistent person tracking.
- Retain server discovery counts with sanitized URLs, normalized agent provider/client/purpose, and self-declared attribution. Keep a shared anonymous identity and disable person profiles and GeoIP. Do not claim distinct visitors or independently verified providers.
- Deliver feedback through a bounded, same-origin JSON endpoint. Require affirmative consent, validate all fields, stamp consent version/time on the server, exclude feature geometry, and confirm ingestion before success. Keep failed reports editable.
- Link PEDP's policy and a local explanation of analytics/feedback from the footer. Offer an opt-out control on the privacy page, reached through a plain Privacy footer link, without a popup. Document retention/deletion operations that require production account administration.
- Add regression tests for privacy boundaries, consent validation, error handling, and agent labels. Run targeted tests, then webapp check, typecheck, tests, and build.

No deployment or historical deletion is included. Enable cookieless ingestion and disable replay in the project settings, as authorized by the user’s explicit agreement to moving to cookieless. Existing unrelated working-tree files remain untouched.
