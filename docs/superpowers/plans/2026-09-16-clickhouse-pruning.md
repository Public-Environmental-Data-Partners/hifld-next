# ClickHouse pruning and deadline repair

User approved implementation after the Miami profiling report.

Design: infer/cache the source schema without reading rows, bind WKB geometry as raw
Parquet bytes, and flatten named scalar tuple fields at the scan boundary. Reconstruct
the original tuples and geometry in the projection so public column names, ordering,
CRS, joins, native globs, and arbitrary user query semantics remain unchanged. Do not
move predicates across joins or limits. Fall back to native tuple handling where
flattening would collide with an existing dotted column or involve complex children.

Alternative rejected: pushing filters through arbitrary user SQL introduces semantic
risk and profiling showed a SELECT-star variant with excessive intermediate work.
Increasing timeouts alone leaves excessive I/O and capacity starvation untouched.

## Tasks

- [x] Add compiler tests for flattened scan fields, WKB decoding, schema preservation,
  collisions and native CRS; observe failures before implementing.
- [x] Add cached schema-only resolution and wire it into the compiler.
- [x] Bound S3 read/retry settings to the remaining request deadline; test HTTP settings
  and retain the existing cancellation cleanup semantics.
- [x] Inspect map preview path and avoid geometry materialization if it can preserve
  its schema/empty-result reporting contract. Otherwise report the remaining work.
- [x] Run focused tests, full MCP lint/type/test gates, and local ClickHouse integration.
- [x] Repeat Miami 10/283/436 benchmark with the application compiler and compare
  decoded features and exact MVT bytes to the pre-fix baseline.

No production deployment or commit is requested in this turn.

## Verification

- Full MCP suite: 494 passed, 12 skipped; Ruff check/format, Pyright and
  BasedPyright clean. Live opt-in suite separately covers production GCS reads,
  Seaweed mixed-CRS joins, null geometry, cancellation, and row-group pruning.
- Application-compiled Miami tile: four row groups read, 73 pruned; six GETs
  and 106,711,148 bytes with the filesystem cache disabled, 9.72 seconds versus
  24.884 seconds before. Metadata caches retained; both comparisons used the
  same five-second storage-read/one-attempt benchmark settings.
- 729 features, 534,051 bytes, unchanged SHA256
  `ddc4b4d7fb93ab30e10dc9773b8e8752d40dee133d53f24cbb2d5bc92dbeba73`.
- Actual local MCP/widget browser test with SQL NFHL and SQL hospitals:
  preparation 504ms / 1357ms; hospital tiles completed 1.2–1.9s after browser
  navigation, flood tiles 4.5–14.8s. Both layers visually present, no browser
  errors, hospital visibility toggle restored without additional tile requests.
- Screenshot: `/tmp/hifld-clickhouse-visual/miami-query-final.png`.

Implementation refinement: physical scan leaves must stay visible inside source
bindings for pruning. To avoid exposing them through user wildcards, wildcard
queries conservatively retain the original native binding. No arbitrary SQL
predicate relocation or star/join rewriting is performed.
