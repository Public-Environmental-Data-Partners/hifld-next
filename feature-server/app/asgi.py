"""Thin reloadable Starlette boundary around pygeoapi's OGC handlers."""

from __future__ import annotations

import asyncio
import json
import os
import re
from collections.abc import Callable
from contextlib import asynccontextmanager
from functools import partial
from http import HTTPStatus
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit, urlunsplit

import pygeoapi
import pygeoapi.api as core_api
import pygeoapi.api.itemtypes as itemtypes_api
import yaml
from pydantic import TypeAdapter, ValidationError
from pygeoapi.api import API, APIRequest
from pygeoapi.openapi import get_oas
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from app.catalog.fetcher import CatalogFetcher
from app.catalog.registry import ApiSnapshot, SnapshotRegistry
from app.catalog.repository import CatalogRepository
from app.catalog.snapshot import project_resources
from app.provider.duckdb_provider import DuckDBGeoParquetProvider
from app.storage.registry import StorageRegistry

registry = SnapshotRegistry()
type JsonScalar = None | bool | int | float | str
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]
type ApiResult = tuple[dict[str, str], int, JsonValue | str | bytes]


type ApiHandler0 = Callable[[API, APIRequest], ApiResult]
type ApiHandler1 = Callable[[API, APIRequest, str], ApiResult]
type ApiHandler2 = Callable[[API, APIRequest, str, str], ApiResult]
type ApiHandler = ApiHandler0 | ApiHandler1 | ApiHandler2


_json_mapping: TypeAdapter[dict[str, JsonValue]] = TypeAdapter(dict[str, JsonValue])
_SUPPORTED_ITEM_CONTROLS = {"bbox", "f", "limit", "offset", "resulttype"}
_UNSUPPORTED_CONFORMANCE_MARKERS = (
    "cql",
    "transactions",
    "ogcapi-features-4",
    "ogcapi-features-2",
    "ogcapi-common-3",
)


def _invoke_handler(
    function: ApiHandler, api: API, request: APIRequest, args: tuple[str, ...]
) -> ApiResult:
    if len(args) == 0:
        return cast("ApiHandler0", function)(api, request)
    if len(args) == 1:
        return cast("ApiHandler1", function)(api, request, args[0])
    if len(args) == 2:
        return cast("ApiHandler2", function)(api, request, args[0], args[1])
    raise ValueError("pygeoapi handler accepts at most two path arguments")


def _configured_http_url(value: str, setting: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"{setting} must be an absolute HTTP URL without credentials or query")
    return value.rstrip("/")


def _catalog_root_url(catalog_url: str) -> str:
    configured = _configured_http_url(catalog_url, "catalog URL")
    parsed = urlsplit(configured)
    suffix = "/_catalog/catalog.sqlite"
    if not parsed.path.endswith(suffix):
        raise ValueError("catalog URL must identify /_catalog/catalog.sqlite")
    root_path = parsed.path[: -len(suffix)] + "/"
    return urlunsplit((parsed.scheme, parsed.netloc, root_path, "", ""))


def build_snapshot(
    database: Path,
    *,
    owned_path: bool = False,
    public_url: str | None = None,
    catalog_url: str | None = None,
    storage_registry: StorageRegistry | None = None,
) -> ApiSnapshot:
    """Build a complete pygeoapi API off-request-path before atomic activation."""
    repository = CatalogRepository.open(database)
    with (Path(__file__).parents[1] / "pygeoapi-base.yml").open() as source:
        try:
            config = _json_mapping.validate_python(yaml.safe_load(source), strict=True)
        except ValidationError as error:
            raise ValueError("base pygeoapi configuration is invalid") from error
    service_url = _configured_http_url(
        public_url or os.environ.get("FEATURE_SERVER_PUBLIC_URL", "http://localhost:8000"),
        "public URL",
    )
    server = config.get("server")
    if not isinstance(server, dict):
        raise ValueError("base pygeoapi server configuration is invalid")
    server["url"] = service_url
    server["gzip"] = False
    root_url = _catalog_root_url(catalog_url) if catalog_url is not None else None
    resources = project_resources(repository, catalog_root_url=root_url).resources
    for resource in resources.values():
        provider = resource["providers"][0]
        provider["name"] = "app.provider.duckdb_provider.DuckDBGeoParquetProvider"
        if storage_registry is not None:
            source = storage_registry.resolve(
                provider["storage_location_slug"], tuple(provider["object_keys"])
            )
            provider["source_uris_json"] = json.dumps(source.object_uris)
            if source.seaweed_endpoint is not None:
                provider["seaweed_endpoint"] = source.seaweed_endpoint
    config["resources"] = _json_mapping.validate_python(resources, strict=True)
    openapi = get_oas(config)
    api = API(config, openapi)
    return ApiSnapshot(repository.generation, repository, api, openapi, owned_path=owned_path)


async def _execute(request: Request, function: ApiHandler, *args: str) -> Response:
    try:
        with registry.acquire() as snapshot:
            api_request = await APIRequest.from_starlette(request, snapshot.api.locales)
            loop = asyncio.get_running_loop()
            invoke = partial(_invoke_handler, function, snapshot.api, api_request, args)
            headers, status, content = await loop.run_in_executor(None, invoke)
            if isinstance(content, str) and "text/html" in headers.get("Content-Type", ""):
                # pygeoapi's base template always renders Contact, even without email.
                content = re.sub(
                    r'<a\b[^>]*href="mailto:(?:None)?"[^>]*>.*?</a>',
                    "",
                    content,
                    flags=re.DOTALL,
                )
            if (
                isinstance(content, str)
                and "json" in headers.get("Content-Type", "")
                and function in {core_api.conformance, itemtypes_api.get_collection_items}
            ):
                content = _json_mapping.validate_json(content)
            if function is core_api.conformance and isinstance(content, dict):
                conforms_to = content.get("conformsTo")
                if isinstance(conforms_to, list):
                    supported: list[JsonValue] = [
                        uri
                        for uri in conforms_to
                        if isinstance(uri, str)
                        and not any(
                            marker in uri.lower() for marker in _UNSUPPORTED_CONFORMANCE_MARKERS
                        )
                    ]
                    content["conformsTo"] = supported
            if function is core_api.conformance and isinstance(content, str):
                content = "\n".join(
                    line
                    for line in content.splitlines()
                    if not any(
                        marker in line.lower() for marker in _UNSUPPORTED_CONFORMANCE_MARKERS
                    )
                )
            if function is itemtypes_api.get_collection_items and isinstance(content, dict):
                offset = request.query_params.get("offset")
                if offset is not None:
                    links = content.get("links")
                    if isinstance(links, list):
                        for link in links:
                            if isinstance(link, dict) and link.get("rel") == "self":
                                href = link.get("href")
                                if isinstance(href, str) and "offset=" not in href:
                                    link["href"] = f"{href}&offset={offset}"
            response = (
                JSONResponse(content, status_code=status)
                if isinstance(content, dict)
                else Response(content, status_code=status)
            )
            response.headers.update(headers)
            response.headers["X-Catalog-Generation"] = snapshot.generation
            return response
    except RuntimeError:
        return JSONResponse(
            {"code": "NotReady", "description": "Catalog is not ready"}, status_code=503
        )


async def landing(request: Request) -> Response:
    return await _execute(request, core_api.landing_page)


async def conformance(request: Request) -> Response:
    return await _execute(request, core_api.conformance)


async def collections(request: Request) -> Response:
    collection_id = request.path_params.get("collection_id")
    if collection_id is None:
        return await _execute(request, core_api.describe_collections)
    return await _execute(request, core_api.describe_collections, collection_id)


async def queryables(request: Request) -> Response:
    return await _execute(
        request, itemtypes_api.get_collection_queryables, request.path_params["collection_id"]
    )


async def items(request: Request) -> Response:
    identifier = request.path_params.get("item_id")
    if identifier is None:
        invalid = await asyncio.to_thread(_invalid_item_query_parameter, request)
        if invalid is not None:
            return JSONResponse(
                {
                    "code": "InvalidParameterValue",
                    "description": f"Unsupported query parameter: {invalid}",
                },
                status_code=HTTPStatus.BAD_REQUEST,
            )
        return await _execute(
            request, itemtypes_api.get_collection_items, request.path_params["collection_id"]
        )
    return await _execute(
        request, itemtypes_api.get_collection_item, request.path_params["collection_id"], identifier
    )


async def openapi(request: Request) -> Response:
    return await _execute(request, core_api.openapi_)


def _invalid_item_query_parameter(request: Request) -> str | None:
    with registry.acquire() as snapshot:
        collection_id = request.path_params["collection_id"]
        resources = snapshot.api.config["resources"]
        if not isinstance(resources, dict):
            return None
        resource = resources.get(collection_id)
        if not isinstance(resource, dict):
            return None
        providers = resource.get("providers")
        if not isinstance(providers, list) or not providers or not isinstance(providers[0], dict):
            return None
        provider_definition = {
            str(name): str(value)
            for name, value in providers[0].items()
            if isinstance(value, (str, int, float, bool))
        }
        fields = DuckDBGeoParquetProvider(provider_definition).get_fields()
    allowed = _SUPPORTED_ITEM_CONTROLS | fields.keys()
    return next((name for name in request.query_params if name not in allowed), None)


async def healthz(request: Request) -> Response:
    return Response(status_code=HTTPStatus.NO_CONTENT)


async def readyz(request: Request) -> Response:
    generation = registry.generation
    if generation is None:
        return JSONResponse({"ready": False}, status_code=503)
    return JSONResponse({"ready": True, "generation": generation})


@asynccontextmanager
async def lifespan(application: Starlette):
    """Poll the sole catalog object; a failed refresh preserves the last snapshot."""
    del application
    catalog_url = os.environ.get("FEATURE_SERVER_CATALOG_URL")
    pointer_url = os.environ.get("FEATURE_SERVER_CATALOG_POINTER_URL")
    if catalog_url is None and pointer_url is None:
        yield
        return
    direct_catalog_url = catalog_url or "https://invalid.local/_catalog/catalog.sqlite"
    temporary_directory = Path(os.environ.get("FEATURE_SERVER_CATALOG_CACHE_DIRECTORY", "/tmp"))
    interval = float(os.environ.get("FEATURE_SERVER_CATALOG_POLL_SECONDS", "30"))
    locations = os.environ.get("FEATURE_SERVER_STORAGE_LOCATIONS")
    if locations is None:
        raise RuntimeError("FEATURE_SERVER_STORAGE_LOCATIONS is required with a catalog URL")
    storage_registry = StorageRegistry.from_json(locations)

    def activate(candidate: Path) -> None:
        registry.replace(
            build_snapshot(
                candidate,
                owned_path=True,
                catalog_url=fetcher.catalog_url,
                storage_registry=storage_registry,
            )
        )

    fetcher = CatalogFetcher(
        direct_catalog_url,
        temporary_directory,
        activate,
        pointer_url=pointer_url,
    )
    await fetcher.refresh()
    stop_event = asyncio.Event()
    task = asyncio.create_task(fetcher.run(interval, stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await task
        await fetcher.aclose()
        registry.close()


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/", landing),
        Route("/openapi", openapi),
        Route("/conformance", conformance),
        Route("/collections", collections),
        Route("/collections/{collection_id:path}/queryables", queryables),
        Route("/collections/{collection_id:path}/items", items),
        Route("/collections/{collection_id:path}/items/{item_id:path}", items),
        Route("/collections/{collection_id:path}", collections),
        Route("/healthz", healthz),
        Route("/readyz", readyz),
        Mount(
            "/static",
            app=StaticFiles(directory=Path(pygeoapi.__file__).parent / "static"),
            name="static",
        ),
    ],
)
