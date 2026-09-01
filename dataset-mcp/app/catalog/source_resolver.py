"""Fail-closed resolution of catalog source identities into trusted paths."""

from collections.abc import Iterable

from app.catalog.client import CatalogClient, CatalogClientError
from app.catalog.models import (
    BucketStorageConfig,
    DatasetFormat,
    FileLocation,
    FileSource,
    QuerySourceRef,
)
from app.query.models import ResolvedSource


def _metadata_bounds(source: FileSource) -> tuple[float, float, float, float] | None:
    metadata = source.source_metadata
    if metadata is None or metadata.bounds is None or len(metadata.bounds) != 4:
        return None
    left, bottom, right, top = metadata.bounds
    return left, bottom, right, top


class SourceResolver:
    def __init__(self, catalog: CatalogClient) -> None:
        self._catalog = catalog

    async def resolve(self, ref: QuerySourceRef) -> ResolvedSource:
        try:
            response = await self._catalog.get_dataset_file(
                ref.collection_id, ref.dataset_id, ref.file_id
            )
        except CatalogClientError:
            raise
        if (
            response.collection.id != ref.collection_id
            or response.dataset.id != ref.dataset_id
            or response.file.id != ref.file_id
        ):
            raise CatalogClientError(
                "source_identity_mismatch", "source does not belong to requested catalog file"
            )
        matches: list[tuple[DatasetFormat, FileSource]] = []
        for entry in response.file.formats:
            if entry.format.format_type != "geoparquet":
                continue
            for source in entry.sources:
                if source.id == ref.file_source_id:
                    matches.append((entry, source))
        if len(matches) != 1:
            if not matches:
                raise CatalogClientError("source_not_found", "catalog source was not found")
            identity_groups = {
                (
                    str(source.version),
                    source.storage_location.slug if source.storage_location else None,
                )
                for _, source in matches
            }
            if len(identity_groups) != 1:
                raise CatalogClientError(
                    "source_ambiguous", "catalog source has conflicting versions or storage"
                )
        entry, source = matches[0]
        if (
            source.source_type != "file"
            or source.storage_location is None
            or not source.storage_location.slug
            or not isinstance(source.storage_location.config, BucketStorageConfig)
            or source.storage_location.config.type not in {"gcs", "seaweedfs"}
        ):
            raise CatalogClientError(
                "source_not_queryable", "catalog source is not a file-backed GeoParquet source"
            )
        location = source.location
        if not isinstance(location, FileLocation):
            raise CatalogClientError("source_location_invalid", "catalog source has no file path")
        metadata = source.source_metadata
        grouped_sources = [candidate for _, candidate in matches]
        glob_patterns = _unique_non_empty(candidate.glob_pattern for candidate in grouped_sources)
        storage_uris = _unique_non_empty(candidate.storage_uri for candidate in grouped_sources)
        metadata_object_paths = metadata.object_paths if metadata is not None else ()
        object_paths = _unique_non_empty(metadata_object_paths or ())
        storage_config = source.storage_location.config
        concrete_storage_uris = [uri for uri in storage_uris if not _contains_glob(uri)]
        concrete_object_paths = [path for path in object_paths if not _contains_glob(path)]
        if concrete_storage_uris:
            paths = concrete_storage_uris
        elif concrete_object_paths:
            paths = concrete_object_paths
        elif glob_patterns and storage_config.type == "seaweedfs":
            paths = glob_patterns
        else:
            raise CatalogClientError(
                "source_location_invalid", "catalog source has no trusted storage URI"
            )
        return ResolvedSource(
            source=ref,
            version=str(source.version),
            format_type=entry.format.format_type,
            storage_location_slug=source.storage_location.slug,
            storage_config=storage_config,
            object_uris=tuple(paths),
            bbox=_metadata_bounds(source),
            crs=metadata.crs if metadata is not None else None,
        )


def _unique_non_empty(values: Iterable[str | None]) -> list[str]:
    """Return stable, non-empty strings from a catalog-owned sequence."""
    result: list[str] = []
    for value in values:
        if isinstance(value, str) and value and value not in result:
            result.append(value)
    return result


def _contains_glob(value: str) -> bool:
    return any(character in value for character in "*?[")
