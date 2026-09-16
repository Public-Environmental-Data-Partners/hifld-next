"""Environment-backed production composition for the Dataset MCP service."""

from __future__ import annotations

from fastapi import FastAPI

from app.catalog.client import CatalogClient
from app.catalog.source_resolver import SourceResolver
from app.catalog.tool_adapter import CatalogToolAdapter
from app.config import Settings
from app.http_app import HttpDependencies, create_http_app
from app.mcp_server import AppDependencies, UIResourceConfig
from app.query.application import QueryApplicationService
from app.query.service import QueryService
from app.query.tile_cache import TileCache
from app.query.token_codec import QueryTokenCodec
from app.storage.resolver import StorageResolver
from query_engine.client import ClickHouseClient
from query_engine.executor import ClickHouseExecutor
from query_worker.protocol import WorkerSeaweedCredentials


def create_production_app(
    settings: Settings | None = None,
    *,
    install_extensions: bool = False,
    seaweedfs_credentials: WorkerSeaweedCredentials | None = None,
) -> FastAPI:
    """Build all long-lived services from validated environment settings."""

    configured = settings or Settings.model_validate({})
    catalog = CatalogClient(str(configured.catalog_base_url))
    source_resolver = SourceResolver(catalog)
    storage_resolver = StorageResolver()
    del install_extensions, seaweedfs_credentials
    executor = ClickHouseExecutor(
        ClickHouseClient(
            str(configured.clickhouse_url),
            configured.clickhouse_username,
            configured.clickhouse_password.get_secret_value(),
            control_username=configured.clickhouse_control_username,
            control_password=configured.clickhouse_control_password.get_secret_value(),
            max_threads=configured.clickhouse_max_threads,
            max_memory_bytes=configured.clickhouse_max_memory_bytes,
            discover_replicas=configured.clickhouse_discover_replicas,
            max_pending_queries=configured.clickhouse_max_pending_queries,
        ),
        seaweed_endpoint=configured.clickhouse_seaweed_endpoint,
    )
    core_query = QueryService(
        executor,
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
        worker_executor=executor,
        token_codec=QueryTokenCodec(
            configured.query_token_secret.get_secret_value().encode("utf-8")
        ),
        token_ttl_seconds=configured.query_token_ttl_seconds,
        tile_timeout_seconds=configured.tile_timeout_seconds,
        public_origin=public_origin,
        tile_cache=TileCache(
            max_bytes=configured.tile_cache_max_bytes,
            ttl_seconds=configured.tile_cache_ttl_seconds,
            max_entries=configured.tile_cache_max_entries,
            max_in_flight=configured.tile_cache_max_in_flight,
        ),
    )
    tools = AppDependencies(
        catalog=CatalogToolAdapter(catalog),
        query=query,
    )
    return create_http_app(
        HttpDependencies(
            tools=tools,
            startup=(executor.start,),
            shutdown=(catalog.aclose, executor.close),
            tile_service=query,
            tile_timeout_seconds=configured.tile_timeout_seconds,
            query_service=query,
            webapp_origins=configured.webapp_origins,
            mcp_allowed_hosts=configured.http_allowed_hosts,
            mcp_allowed_origins=configured.webapp_origins,
        ),
        resource_config=UIResourceConfig(
            tile_origin=public_origin or "self",
            worker_asset_origin=public_origin or "self",
        ),
        max_concurrency=configured.max_concurrency,
    )
