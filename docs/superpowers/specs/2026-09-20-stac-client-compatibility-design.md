# STAC Client Compatibility Design

## Goal

Make HIFLD Next discoverable by standard STAC API clients without changing the
existing webapp API or the canonical Portolan files in object storage. Validate
the published tree before a release pointer advances, and make any unavoidable
Portolan-profile exceptions explicit. Update agent guidance to distinguish the
STAC API from the existing HIFLD dataset API and OGC feature service.

This extends the [catalog migration design](2026-09-07-portolan-catalog-migration-design.md),
which deliberately did not include a STAC API.

## Approaches considered

1. **Static catalog only:** fix publication validation and document the existing
   `/api/collections` tree. This remains useful to static STAC readers, but
   `pystac-client.get_collections()` currently returns no Collections because
   the root's immediate child is the HIFLD Catalog, and there is no advertised
   STAC API conformance.
2. **Reuse `/api/collections` as STAC API:** fewer URLs, but this would change
   the existing raw-root-Catalog response into the STAC API Collections listing
   and break the webapp's established public contract.
3. **Separate `/stac` adapter (chosen):** add only STAC API Core and Collections
   over the active Portolan generation. Preserve `/api` and the static object
   storage tree verbatim. Item Search and STAC API Features are not advertised
   because dataset rows in the OGC feature service are not STAC Items.

## STAC API surface

The webapp serves these read-only endpoints:

- `GET /stac`: STAC Catalog landing page based on the active published root,
  with `conformsTo` containing exactly STAC API Core 1.0.0 and Collections
  1.0.0. Its `self` and `root` links target `/stac`, `data` targets
  `/stac/collections`, and `service-desc` targets the STAC-specific OpenAPI
  document. Published child links may continue to point to immutable object
  storage documents; assets are not copied or rewritten.
- `GET /stac/api`: machine-readable OpenAPI description of only the supported
  STAC endpoints. Do not claim OGC API Features or Item Search conformance.
- `GET /stac/collections`: an object with `collections` (actual version-level
  STAC Collections) and `links` (`self`, `root`, and `next` when needed). Page
  through the generated catalog index in stable `version_path` order with an
  opaque cursor. The cursor includes the active generation; a cursor for a
  replaced generation returns a clear conflict response so the client can
  restart rather than silently skip or duplicate Collections.
- `GET /stac/collections/{collectionId}`: the published version Collection,
  with only API navigation links (`self`, `root`, `parent`) adapted to the STAC
  API. Preserve its metadata, extension fields, and asset URLs. The Collection
  `id` remains the published full version path, such as
  `hifld/hospitals-3/hospitals-3/v1.0.0`; links percent-encode this ID as one
  URL path parameter. Verify encoded-slash handling through TanStack, local
  HTTP, and ingress before release. Unknown IDs return 404.

The HIFLD grouping remains a STAC Catalog in the static tree; it is not
misrepresented as a STAC Collection. The version-level objects are the
Collections exposed in the STAC API listing. Listing results may be fetched
from the current storage documents, but their IDs and paths come from a new
database-neutral `CatalogRepository` read method, implemented for SQLite with
keyset pagination. The API and SQLite projection must reference one active
release generation per request.

No `/stac/search`, `/stac/collections/{id}/items`, or `/stac/conformance`
endpoint is implied by this scope. Dataset text/tag search remains on the
custom `/api` routes. A later collection-metadata search can adopt the STAC
Collection Search extension after its required query semantics are implemented;
the existing custom search response must not be relabeled as STAC Item Search.

## Publication validation and exceptions

Before writing a release pointer, validate every generated Catalog and
Collection in the candidate release, not just the newly rendered records.
Validate STAC core and each declared extension, plus the Portolan profile where
declared. Validation must use a pinned schema version, report document paths and
concise failure reasons, and fail closed on malformed documents, broken local
links, missing assets referenced by the candidate, or unexpected profile
failures. Do not validate remote asset bytes as part of the metadata gate.

Current published examples show why a full-tree gate matters: Hospitals has
only a `host` provider, while a retained 119th Congressional Districts version
has a provider without a role; both fail the declared Portolan profile. The
publisher may normalize an existing, verifiable source provider to the
`producer` role. It must not silently label HIFLD Next as producer merely
because it hosts the data.

For historical versions with no verifiable producer, retain core STAC validity
but do not advertise a Portolan extension the document does not satisfy. Write
an explicit, deterministic release exception report under `_catalog/` with the
version path, failed requirement, and source-evidence status. Known exceptions
are reviewed data, not a broad validation bypass: new or changed exception
entries require an explicit source record and test; no other schema failures
are exempt. The release remains honest about which documents are Portolan
conformant. When a source producer is later verified, regenerate its document,
remove the exception, and restore the Portolan profile declaration.

The same validation runs for local SeaweedFS and GCS publication. A failed
candidate must leave the prior release pointer and served catalog intact.

## Guidance and compatibility

Update `webapp/public/llms.txt`, `/api` bootstrap hints, and machine-readable
API descriptions to direct STAC clients to `/stac`, describe the supported
conformance classes and collection identity, and continue to label
`/api/collections` as static STAC documents rather than a STAC API. Keep
`/features` described as OGC API Features over dataset rows, not STAC Items.
Do not remove existing routes, response fields, storage backends, or startup
database initialization.

## Verification

- Red/green tests for landing-page conformance and links, paginated Collection
  enumeration, encoded IDs, version lookup, stale cursors, and error responses.
- `pystac-client.Client.open` must advertise Core and Collections, enumerate
  version Collections, open Hospitals by ID, and follow a `next` link.
- Validate a candidate release with a known valid producer and with an
  explicitly documented missing-producer exception; prove an unrelated schema
  error blocks the pointer update in both storage modes.
- Run the official STAC API validator for the advertised classes against a
  local server; run the repository's required webapp checks, typecheck, tests,
  and build. Run the dataset publisher's targeted and full tests plus its own
  lint/type gates where configured.

## References

- [STAC API Core 1.0.0](https://github.com/radiantearth/stac-api-spec/blob/release/v1.0.0/core/README.md)
- [STAC API Collections 1.0.0](https://github.com/radiantearth/stac-api-spec/tree/release/v1.0.0/ogcapi-features)
- [STAC API Collection Search extension](https://github.com/stac-api-extensions/collection-search)
- [Portolan specification](https://github.com/portolan-sdi/portolan-spec)
