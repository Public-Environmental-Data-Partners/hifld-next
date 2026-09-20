# Unified STAC responses implementation plan

**Goal:** Return published STAC metadata consistently for detail and listing requests, and retain working local browsing, filters, queries and version comparison.

**Architecture:** SQLite selects identities, counts and facets. Public detail responses stream the matching bucket document; listing responses embed those documents under `datasets` with the existing `total`, `limit`, `offset` and pagination `links`. Search, tag filtering and pagination never select another metadata representation. UI/MCP adapters may construct internal view models from STAC, but must not expose a competing public metadata envelope.

**Tech stack:** TypeScript/Zod/TanStack, Python/Pydantic/DuckDB, Dagster and SeaweedFS.

- [ ] Add route regressions proving byte-identical details and identical STAC entries for plain/search/tag-filtered listings. Change `catalog-stac.ts` and the dataset/list/file routes; retain `/metadata` aliases.
- [ ] Update `api-client.ts` with typed STAC view-model adapters. Preserve source assets, schema statistics, version selection and multi-file datasets. Run focused adapter tests.
- [ ] Update MCP and WebMCP consumers, OpenAPI and `llms.txt`. Resolve query assets against server-managed storage configuration, not arbitrary caller URLs. Test wrong identities, versions and storage.
- [ ] Restore the `geometry_type` facet/filter from current file versions, applying it before counting/pagination. Test datasets with multiple geometry types and historical-only types.
- [ ] Load both published Hospitals versions and all their available formats with pinned source metadata into separate local staging/published buckets. Preserve source bytes and verify version comparison.
- [ ] Run webapp check/typecheck/tests/build and MCP lint/type/test gates. Run publisher tests after fixture changes. Restart only task-owned local processes, then smoke-test STAC equality, filters, PMTiles, table paging and Hospitals comparison.

This plan implements the response design approved in the conversation. No production writes or deployment are authorized. Existing unrelated working-tree changes remain untouched.
