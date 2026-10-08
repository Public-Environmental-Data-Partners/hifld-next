"""Fail-closed resolution of STAC asset identities into trusted object paths."""

from collections.abc import Mapping
from urllib.parse import unquote, urlsplit

from app.catalog.client import CatalogClient, CatalogClientError
from app.catalog.models import BucketStorageConfig, QuerySourceRef, StacVersionCollection
from app.query.models import ResolvedSource


class SourceResolver:
    def __init__(
        self,
        catalog: CatalogClient,
        storage_locations: Mapping[str, BucketStorageConfig],
    ) -> None:
        self._catalog = catalog
        self._storage_locations = dict(storage_locations)

    async def resolve(self, ref: QuerySourceRef) -> ResolvedSource:
        response = await self._catalog.get_dataset_file(
            ref.collection_slug,
            ref.dataset_slug,
            ref.file_slug,
            version=ref.version,
        )
        expected_id = "/".join((ref.collection_slug, ref.dataset_slug, ref.file_slug, ref.version))
        if response.id != expected_id:
            raise CatalogClientError(
                "source_identity_mismatch", "source does not belong to requested catalog version"
            )
        asset = response.assets.get(ref.asset_key)
        if asset is None or not _is_geoparquet(ref.asset_key, asset.type, asset.roles):
            raise CatalogClientError("source_not_found", "catalog source was not found")

        candidates = self._storage_locations.items()
        if ref.storage_location_slug is not None:
            config = self._storage_locations.get(ref.storage_location_slug)
            if config is None:
                raise CatalogClientError(
                    "source_storage_unknown", "storage location is not configured"
                )
            candidates = ((ref.storage_location_slug, config),)
        matches: list[tuple[str, BucketStorageConfig, str]] = []
        for slug, config in candidates:
            object_key = _trusted_object_key(asset.href, config)
            if object_key is not None:
                matches.append((slug, config, object_key))
        if len(matches) != 1:
            raise CatalogClientError(
                "source_location_invalid", "catalog asset href is outside trusted storage"
            )
        storage_slug, storage_config, object_key = matches[0]
        scheme = "gs" if storage_config.type == "gcs" else "s3"
        bbox = _bbox(response)
        return ResolvedSource(
            source=ref,
            version=ref.version,
            format_type="geoparquet",
            storage_location_slug=storage_slug,
            storage_config=storage_config,
            object_uris=(f"{scheme}://{storage_config.bucket}/{object_key}",),
            bbox=bbox,
            crs=response.native_crs,
        )


def _is_geoparquet(asset_key: str, media_type: str, roles: list[str]) -> bool:
    return (
        (asset_key == "geoparquet" or asset_key.startswith("geoparquet-"))
        and media_type == "application/vnd.apache.parquet"
        and "data" in roles
    )


def _bbox(response: StacVersionCollection) -> tuple[float, float, float, float] | None:
    if not response.extent.spatial.bbox:
        return None
    value = response.extent.spatial.bbox[0]
    if len(value) != 4:
        return None
    return value[0], value[1], value[2], value[3]


def _trusted_object_key(href: str, config: BucketStorageConfig) -> str | None:
    parsed = urlsplit(href)
    decoded_path = unquote(parsed.path)
    if any(part in {"", ".", ".."} for part in decoded_path.split("/")[1:]):
        return None
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        return None
    if parsed.scheme in {"gs", "s3"}:
        expected_scheme = "gs" if config.type == "gcs" else "s3"
        if parsed.scheme != expected_scheme or parsed.netloc != config.bucket:
            return None
        return decoded_path.lstrip("/") or None
    base = urlsplit(config.base_url)
    if parsed.scheme != base.scheme or parsed.netloc != base.netloc:
        return None
    base_parts = [part for part in unquote(base.path).split("/") if part]
    if not base_parts or base_parts[-1] != config.bucket:
        base_parts.append(config.bucket)
    path_parts = [part for part in decoded_path.split("/") if part]
    if path_parts[: len(base_parts)] != base_parts or len(path_parts) <= len(base_parts):
        return None
    return "/".join(path_parts[len(base_parts) :])
