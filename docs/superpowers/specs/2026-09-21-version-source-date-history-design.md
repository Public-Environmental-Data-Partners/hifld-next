# Version Source-Date History

## Goal

Preserve source dates at the version that supplied them, show those dates beside each version in comparison views, and summarize the full file history without presenting source metadata as catalog lifecycle or temporal coverage.

## Metadata

Hospitals `v1.1.0` declares `date_issued: 2026-04-06` in its authored version metadata. Resolution records `version` as the provenance. It does not invent a modified date or temporal coverage.

Every STAC version Collection continues to expose its own values under `hifld:source_dates`. Version Collections without source-date evidence omit that field.

## File summary

The file detail response and page expose two derived history values:

- `First issued`: the earliest valid `issued` date among the file's versions.
- `Latest source activity`: the latest valid `issued` or `modified` date across all versions.

These labels make clear that the values are derived across version metadata. They are not mapped to STAC `created`, `updated`, or temporal extent.

## Version comparison

Each side of the version comparison displays that selected version's `Source issued` and `Source modified` values. Missing values are omitted rather than inherited from another version.

## Verification

Publisher tests prove version-authored source-date provenance. Webapp tests prove aggregation, missing-value behavior, and per-version rendering. Production is republished through the immutable release pointer and checked through its STAC endpoint and rendered pages.
