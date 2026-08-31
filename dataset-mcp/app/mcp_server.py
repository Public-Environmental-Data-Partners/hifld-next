"""FastMCP registration for the Dataset Explorer MCP App."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastmcp import FastMCP
from fastmcp.apps import AppConfig, ResourceCSP
from fastmcp.tools import ToolResult as FastMCPToolResult
from mcp.types import TextContent

from app.catalog.client import CatalogClientError
from app.errors import AppError
from app.tools import discovery, query

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]

UI_RESOURCE_URI = "ui://hifld/dataset-explorer.html"
UI_MIME_TYPE = "text/html;profile=mcp-app"


@dataclass(frozen=True, slots=True)
class AppDependencies:
    catalog: discovery.CatalogClient
    query: query.QueryService


@dataclass(frozen=True, slots=True)
class UIResourceConfig:
    tile_origin: str
    basemap_origins: tuple[str, ...] = ()
    worker_asset_origin: str = "self"

    def csp(self) -> ResourceCSP:
        return ResourceCSP(
            connect_domains=[self.tile_origin, *self.basemap_origins],
            resource_domains=[self.worker_asset_origin, "blob:"],
        )


def default_ui_html() -> str:
    """Read the immutable, build-time UI bundle supplied by the image."""
    path = Path(__file__).parent.parent / "ui" / "dist" / "index.html"
    return path.read_text(encoding="utf-8")


def _app_config(*, visibility: list[Literal["app", "model"]]) -> AppConfig:
    return AppConfig(resource_uri=UI_RESOURCE_URI, visibility=visibility)


def _result(result: discovery.ToolResult | query.ToolResult) -> FastMCPToolResult:
    return FastMCPToolResult(
        content=[TextContent(type="text", text=result.text)],
        structured_content=dict(result.structured_content),
    )


def _error_result(error: Exception) -> FastMCPToolResult:
    if isinstance(error, AppError):
        code, message = error.code.value, error.message
    elif isinstance(error, CatalogClientError):
        known_codes = {
            "catalog_not_found",
            "catalog_unavailable",
            "catalog_contract_invalid",
            "schema_version_not_found",
        }
        code = error.code if error.code in known_codes else "internal_error"
        message = (
            "The catalog request could not be completed"
            if code == "catalog_unavailable"
            else "The catalog response did not match its contract"
            if code == "catalog_contract_invalid"
            else "The catalog resource was not found"
            if code in {"catalog_not_found", "schema_version_not_found"}
            else "The request could not be completed"
        )
    elif isinstance(error, ValueError):
        code, message = "invalid_request", "request validation failed"
    else:
        code, message = "internal_error", "request could not be completed"
    payload: dict[str, JSONValue] = {"error": {"code": code, "message": message}}
    return FastMCPToolResult(
        content=[TextContent(type="text", text=f"Error: {message}")],
        structured_content=payload,
        is_error=True,
    )


def create_mcp_server(
    dependencies: AppDependencies,
    *,
    ui_html: str | None = None,
    resource_config: UIResourceConfig | None = None,
) -> FastMCP:
    """Create a stateless-ready MCP server with dependency-injected tools.

    FastMCP 3.x configures stateless Streamable HTTP on ``http_app`` rather
    than the constructor; ``http_app.py`` supplies that setting.
    """
    mcp = FastMCP("HIFLD Dataset Explorer")
    model_and_app = _app_config(visibility=["model", "app"])

    async def list_collections() -> FastMCPToolResult:
        """List catalog collections as the starting point for dataset discovery."""
        try:
            return _result(await discovery.list_collections(dependencies.catalog))
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(list_collections)

    async def get_collection(identity: str) -> FastMCPToolResult:
        """Get collection metadata by numeric ID or slug."""
        try:
            return _result(await discovery.get_collection(dependencies.catalog, identity))
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(get_collection)

    async def search_datasets(
        collection: str,
        search: str | None = None,
        tags: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> FastMCPToolResult:
        """Search one collection; tags use key=value and results are paginated."""
        try:
            return _result(
                await discovery.search_datasets(
                    dependencies.catalog,
                    search=search,
                    collection=collection,
                    tags=tags or (),
                    limit=limit,
                    offset=offset,
                )
            )
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(search_datasets)

    async def get_dataset(collection: str, identity: str) -> FastMCPToolResult:
        """Get dataset metadata and compact file summaries by ID or slug."""
        try:
            return _result(await discovery.get_dataset(dependencies.catalog, collection, identity))
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(get_dataset)

    async def get_dataset_file(collection: str, dataset: str, identity: str) -> FastMCPToolResult:
        """Get file metadata and ready-to-copy GeoParquet query source references."""
        try:
            return _result(
                await discovery.get_dataset_file(
                    dependencies.catalog, collection, dataset, identity
                )
            )
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(get_dataset_file)

    async def get_dataset_file_schema(
        collection: str,
        dataset: str,
        identity: str,
        version: str | None = None,
        column_offset: int = 0,
        column_limit: int = 100,
    ) -> FastMCPToolResult:
        """Get a bounded page of file schema columns and their provenance."""
        try:
            return _result(
                await discovery.get_dataset_file_schema(
                    dependencies.catalog,
                    collection,
                    dataset,
                    identity,
                    version=version,
                    column_offset=column_offset,
                    column_limit=column_limit,
                )
            )
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(get_dataset_file_schema)

    async def read_geoparquet_rows(
        source: dict[str, JSONValue],
        columns: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> FastMCPToolResult:
        """Read rows using a source reference copied from get_dataset_file.query_sources.

        The source object contains alias, collection_id, dataset_id, file_id,
        and file_source_id. The server resolves its storage location; callers
        cannot provide an object-store URL.
        """
        try:
            return _result(
                await query.read_geoparquet_rows(
                    dependencies.query, source, columns=columns or (), limit=limit, offset=offset
                )
            )
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(read_geoparquet_rows)

    async def query_geoparquet(
        sources: list[dict[str, JSONValue]],
        sql: str,
        limit: int = 100,
        geometry_column: str | None = None,
        result_crs: str | None = None,
    ) -> FastMCPToolResult:
        """Run one safe read-only DuckDB SELECT over up to eight catalog sources.

        Copy source objects from get_dataset_file.query_sources and reference
        their aliases as SQL tables. SELECTs, joins, CTEs, aggregates, and the
        allowlisted spatial functions are supported. The limit bounds the
        returned first page, not the relational meaning of SQL LIMIT clauses.
        """
        try:
            return _result(
                await query.query_geoparquet(
                    dependencies.query,
                    sources,
                    sql,
                    limit=limit,
                    geometry_column=geometry_column,
                    result_crs=result_crs,
                )
            )
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(query_geoparquet)

    async def get_query_page(
        query_token: str, offset: int, page_size: int = 100
    ) -> FastMCPToolResult:
        """Re-run a signed query and return a bounded page at the requested offset."""
        try:
            return _result(
                await query.get_query_page(dependencies.query, query_token, offset, page_size)
            )
        except Exception as error:
            return _error_result(error)

    mcp.tool(app=model_and_app)(get_query_page)

    config = resource_config or UIResourceConfig(tile_origin="self")

    def dataset_explorer() -> str:
        return ui_html if ui_html is not None else default_ui_html()

    mcp.resource(
        UI_RESOURCE_URI,
        name="dataset-explorer",
        mime_type=UI_MIME_TYPE,
        app=AppConfig(csp=config.csp()),
    )(dataset_explorer)

    return mcp
