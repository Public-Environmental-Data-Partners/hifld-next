# WebMCP cutover verification repairs

Approved by the user during production cutover verification, 2026-10-08.

Production catalog columns contain numeric statistics encoded as strings. The
WebMCP column boundary currently permits only numbers, so both file metadata and
schema tools incorrectly report upstream unavailable. Accept string or number
min/max values without coercion; preserve null and missing values and reject
structured values. Keep the catalog and public tool contracts unchanged.

Dataset Catalog child links enumerate versions. WebMCP should expose each logical
file once, preserving its first appearance and local endpoint. Deduplicate by
the validated file slug, without following upstream links.

Alternatives rejected: rewriting published source statistics would change the
catalog unnecessarily; ignoring validation would accept malformed payloads.
Do not redesign WebMCP, storage, or feature serving for these fixes.

Verify regressions first, then webapp lint, typecheck, all tests, build, and real
browser tool execution. The browser protocol boundary may need an explicit test
probe because this Chromium does not expose native WebMCP; do not describe that
as native-protocol acceptance. Feature-server testing remains independent.
