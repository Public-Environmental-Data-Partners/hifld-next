"""Environment-backed production composition for the Dataset MCP service."""

from __future__ import annotations

from starlette.types import ASGIApp

from app.catalog.client import CatalogClient
from app.catalog.source_resolver import SourceResolver
from app.catalog.tool_adapter import CatalogToolAdapter
from app.config import Settings
from app.http_app import HttpDependencies, create_http_app
from app.mcp_server import AppDependencies, UIResourceConfig
from app.query.application import QueryApplicationService
from app.query.service import QueryService, worker_profiles_from_storage
from app.query.token_codec import QueryTokenCodec
from app.storage.resolver import StorageResolver
from query_worker.pool import WorkerPool, WorkerPoolConfig
from query_worker.protocol import WorkerRuntimeConfig


def create_production_app(settings: Settings | None = None) -> ASGIApp:
    """Build all long-lived services from validated environment settings."""

    configured = settings or Settings.model_validate({})
    catalog = CatalogClient(str(configured.catalog_base_url))
    source_resolver = SourceResolver(catalog)
    storage_resolver = StorageResolver(configured.storage_settings)
    pool = WorkerPool(
        WorkerPoolConfig(
            worker_count=configured.worker_count,
            soft_timeout_seconds=configured.query_timeout_seconds,
            hard_timeout_seconds=configured.query_timeout_seconds + 5,
        ),
        WorkerRuntimeConfig(
            threads=configured.duckdb_threads,
            memory_limit=configured.duckdb_memory_limit,
            temp_directory=configured.duckdb_temp_directory,
            extension_directory=configured.duckdb_extension_directory,
            credential_profiles=worker_profiles_from_storage(configured.storage_settings),
            max_result_bytes=configured.max_result_bytes,
        ),
    )
    core_query = QueryService(
        pool,
        max_limit=configured.query_max_limit,
        max_offset=configured.query_max_offset,
        timeout_seconds=configured.query_timeout_seconds,
        max_result_bytes=configured.max_result_bytes,
    )
    public_origin = str(configured.public_origin).rstrip("/") if configured.public_origin else None
    query = QueryApplicationService(
        source_resolver=source_resolver,
        storage_resolver=storage_resolver,
        query_service=core_query,
        worker_executor=pool,
        token_codec=QueryTokenCodec(
            configured.query_token_secret.get_secret_value().encode("utf-8")
        ),
        token_ttl_seconds=configured.query_token_ttl_seconds,
        tile_timeout_seconds=configured.tile_timeout_seconds,
        public_origin=public_origin,
    )
    tools = AppDependencies(
        catalog=CatalogToolAdapter(catalog),
        query=query,
        map_features=query,
    )
    return create_http_app(
        HttpDependencies(
            tools=tools,
            startup=(pool.start,),
            shutdown=(catalog.aclose, pool.close),
            tile_service=query,
            tile_timeout_seconds=configured.tile_timeout_seconds,
        ),
        resource_config=UIResourceConfig(
            tile_origin=public_origin or "self",
            worker_asset_origin=public_origin or "self",
        ),
        max_concurrency=configured.max_concurrency,
    )
