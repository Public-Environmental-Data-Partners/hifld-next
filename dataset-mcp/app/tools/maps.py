"""Pure mixed-source map construction with dependency-injected catalog resolution."""

from __future__ import annotations

import ipaddress
import json
import logging
import re
from collections.abc import Awaitable, Generator, Mapping
from contextlib import contextmanager
from time import perf_counter
from typing import Annotated, Literal, Protocol, Self
from urllib.parse import urlsplit

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.tools import query

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type JSONMapping = Mapping[str, JSONValue]
type SourceLayer = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]

_DECIMAL_INTEGER = re.compile(r"^[0-9]+$")
_OCTAL_INTEGER = re.compile(r"^0[0-7]+$")
_HEX_INTEGER = re.compile(r"^0[xX][0-9A-Fa-f]+$")
_LOGGER = logging.getLogger("uvicorn.error.maps")


@contextmanager
def _preparation_duration(stage: Literal["configuration", "query_layer"]) -> Generator[None]:
    """Log only stage, elapsed time, and outcome; never attach input or exception data."""
    started = perf_counter()
    outcome = "failed"
    try:
        yield
        outcome = "ready"
    finally:
        _LOGGER.info(
            json.dumps(
                {
                    "event": "map_preparation",
                    "stage": stage,
                    "duration_ms": round((perf_counter() - started) * 1000, 3),
                    "outcome": outcome,
                }
            )
        )


def _browser_ipv4_address(hostname: str) -> ipaddress.IPv4Address | None:
    """Parse the legacy IPv4 spellings normalized by browser URL parsers."""
    parts = hostname.split(".")
    if not 1 <= len(parts) <= 4:
        return None
    numbers: list[int] = []
    for part in parts:
        if _HEX_INTEGER.fullmatch(part):
            numbers.append(int(part, 16))
        elif _OCTAL_INTEGER.fullmatch(part):
            numbers.append(int(part, 8))
        elif _DECIMAL_INTEGER.fullmatch(part):
            numbers.append(int(part, 10))
        else:
            return None
    if any(number > 255 for number in numbers[:-1]):
        raise ValueError("map source URLs must use valid public hosts")
    last_limit = 256 ** (5 - len(numbers))
    if numbers[-1] >= last_limit:
        raise ValueError("map source URLs must use valid public hosts")
    value = numbers[-1]
    for index, number in enumerate(numbers[:-1]):
        value += number * (256 ** (3 - index))
    return ipaddress.IPv4Address(value)


def _public_https_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("map source URLs must be public HTTPS URLs without credentials")
    if parsed.fragment:
        raise ValueError("map source URLs must not contain fragments")
    try:
        _ = parsed.port
    except ValueError as error:
        raise ValueError("map source URLs must use a valid port") from error
    hostname = parsed.hostname.casefold().rstrip(".")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = _browser_ipv4_address(hostname)
        if address is None:
            if (
                "." not in hostname
                or hostname == "localhost"
                or hostname.endswith((".localhost", ".local", ".internal"))
            ):
                raise ValueError("map source URLs must use a public hostname") from None
            return value
    if not address.is_global:
        raise ValueError("map source URLs must not use private IP addresses")
    return value


def _configured_worker_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise ValueError("worker URL must be an absolute HTTP or HTTPS URL")
    try:
        _ = parsed.port
    except ValueError as error:
        raise ValueError("worker URL must use a valid port") from error
    return value


class QueryMapSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["query"] = "query"
    inputs: list[dict[str, JSONValue]] = Field(min_length=1, max_length=8)
    sql: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50_000)]
    geometry_column: str | None = None
    result_crs: str | None = None


class CatalogMapSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["catalog"] = "catalog"
    collection_id: int = Field(gt=0)
    dataset_id: int = Field(gt=0)
    file_id: int = Field(gt=0)
    file_source_id: int = Field(gt=0)


class PmtilesMapSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["pmtiles"] = "pmtiles"
    url: str
    source_layer: SourceLayer | None = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return _public_https_url(value)


class TileJSONMapSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["tilejson"] = "tilejson"
    url: str
    source_layer: SourceLayer | None = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return _public_https_url(value)


class VectorTilesMapSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["vector_tiles"] = "vector_tiles"
    tiles: list[str] = Field(min_length=1, max_length=8)
    source_layer: SourceLayer
    minzoom: int | None = Field(default=None, ge=0, le=22)
    maxzoom: int | None = Field(default=None, ge=0, le=22)
    bounds: tuple[query.Longitude, query.Latitude, query.Longitude, query.Latitude] | None = None

    @field_validator("tiles")
    @classmethod
    def validate_tiles(cls, values: list[str]) -> list[str]:
        for value in values:
            _public_https_url(value)
            if not all(marker in value for marker in ("{z}", "{x}", "{y}")):
                raise ValueError("vector tile URLs must be XYZ templates")
        return values

    @model_validator(mode="after")
    def validate_range(self) -> Self:
        if self.minzoom is not None and self.maxzoom is not None and self.minzoom > self.maxzoom:
            raise ValueError("minzoom must not exceed maxzoom")
        if self.bounds is not None:
            west, south, east, north = self.bounds
            if west >= east or south >= north:
                raise ValueError("bounds must have increasing coordinates")
        return self


type MapSourceInput = Annotated[
    QueryMapSourceInput
    | CatalogMapSourceInput
    | PmtilesMapSourceInput
    | TileJSONMapSourceInput
    | VectorTilesMapSourceInput,
    Field(discriminator="type"),
]


class MapLayerInput(query.MapLayerStyleInput):
    model_config = ConfigDict(extra="forbid")

    layer_name: query.MapTitle
    source: MapSourceInput
    visible: bool = True


class MapDefinitionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: query.MapTitle
    layers: list[MapLayerInput] = Field(min_length=1, max_length=8)
    basemap: query.BasemapStyle = "street"
    camera: query.MapCameraInput | None = None


class CatalogMapResolver(Protocol):
    def resolve_map_source(
        self, collection_id: int, dataset_id: int, file_id: int, file_source_id: int
    ) -> Awaitable[JSONMapping]: ...


def _style(layer: MapLayerInput) -> query.MapLayerStyleInput | None:
    values = layer.model_dump(include=set(query.MapLayerStyleInput.model_fields), exclude_none=True)
    return query.MapLayerStyleInput.model_validate(values) if values else None


def _style_payload(style: query.MapLayerStyleInput) -> dict[str, JSONValue]:
    return style.model_dump(mode="json", exclude_none=True)


def _camera_payload(camera: query.MapCameraInput) -> dict[str, JSONValue]:
    return camera.model_dump(mode="json", exclude_none=True)


async def _runtime_query_layer(
    service: query.QueryService, layer: MapLayerInput
) -> tuple[dict[str, JSONValue], str]:
    source = layer.source
    if not isinstance(source, QueryMapSourceInput):
        raise TypeError("query source required")
    result = await query.view_query_map(
        service,
        title=layer.layer_name,
        layers=[
            query.MapQueryLayerInput(
                layer_name=layer.layer_name,
                sources=source.inputs,
                sql=source.sql,
                geometry_column=source.geometry_column,
                result_crs=source.result_crs,
                style=_style(layer),
                visible=layer.visible,
            )
        ],
    )
    runtime = result.structured_content["layers"]
    worker_url = result.structured_content["worker_url"]
    if not isinstance(runtime, list) or not runtime or not isinstance(runtime[0], dict):
        raise ValueError("query map layer is invalid")
    if not isinstance(worker_url, str) or not worker_url:
        raise ValueError("query map worker URL is invalid")
    return runtime[0], worker_url


async def prepare_map_layer(service: query.QueryService, layer: MapLayerInput) -> query.ToolResult:
    """Prepare one query layer using the existing SQL, source, and geometry validation."""
    with _preparation_duration("query_layer"):
        runtime, worker_url = await _runtime_query_layer(service, layer)
        return query.ToolResult(
            text=(
                f"Prepared query layer '{layer.layer_name}'; "
                "rendering is pending in the host widget."
            ),
            structured_content={"layer": runtime, "worker_url": worker_url},
        )


async def _map_from_definition(
    service: query.QueryService,
    catalog: CatalogMapResolver,
    map_spec: MapDefinitionInput,
    *,
    worker_url: str,
) -> query.ToolResult:
    names = [layer.layer_name.casefold() for layer in map_spec.layers]
    if len(names) != len(set(names)):
        raise ValueError("map layer names must be unique")
    configured_worker_url = _configured_worker_url(worker_url)
    runtime_layers: list[JSONValue] = []
    for index, layer in enumerate(map_spec.layers):
        if isinstance(layer.source, QueryMapSourceInput):
            aliases = tuple(str(source.get("alias", "")) for source in layer.source.inputs)
            if any(not alias for alias in aliases):
                raise ValueError("every source must have an alias")
            service.validate_sql(layer.source.sql, aliases)
            pending: dict[str, JSONValue] = {
                "layer_id": f"preparing-{index}",
                "layer_name": layer.layer_name,
                "preparation_status": "preparing",
                "visible": layer.visible,
            }
            style = _style(layer)
            if style is not None:
                pending["style"] = _style_payload(style)
            runtime_layers.append(pending)
            continue
        if isinstance(layer.source, CatalogMapSourceInput):
            resolved = await catalog.resolve_map_source(
                layer.source.collection_id,
                layer.source.dataset_id,
                layer.source.file_id,
                layer.source.file_source_id,
            )
            source: JSONMapping = PmtilesMapSourceInput.model_validate(resolved).model_dump(
                mode="json", exclude_none=True
            )
        else:
            source = layer.source.model_dump(mode="json", exclude_none=True)
        external: dict[str, JSONValue] = {
            "layer_id": f"external-{index}",
            "layer_name": layer.layer_name,
            "source": dict(source),
            "visible": layer.visible,
        }
        style = _style(layer)
        if style is not None:
            external["style"] = _style_payload(style)
        runtime_layers.append(external)
    payload: dict[str, JSONValue] = {
        "title": map_spec.title,
        "basemap": map_spec.basemap,
        "worker_url": configured_worker_url,
        "layers": runtime_layers,
        "map_spec": map_spec.model_dump(mode="json", exclude_none=True),
    }
    if map_spec.camera is not None:
        payload["camera"] = _camera_payload(map_spec.camera)
    names_text = ", ".join(layer.layer_name for layer in map_spec.layers)
    count = len(map_spec.layers)
    noun = "layer" if count == 1 else "layers"
    return query.ToolResult(
        text=(
            f"Prepared map configuration '{map_spec.title}' with {count} {noun}: {names_text}. "
            "Rendering is pending in the host widget; this does not confirm that layers loaded."
        ),
        structured_content=payload,
    )


async def view_map(
    service: query.QueryService,
    catalog: CatalogMapResolver,
    *,
    title: query.MapTitle,
    layers: list[MapLayerInput],
    basemap: query.BasemapStyle = "street",
    camera: query.MapCameraInput | None = None,
    worker_url: str,
) -> query.ToolResult:
    with _preparation_duration("configuration"):
        return await _map_from_definition(
            service,
            catalog,
            MapDefinitionInput(title=title, layers=layers, basemap=basemap, camera=camera),
            worker_url=worker_url,
        )


async def refresh_map(
    service: query.QueryService,
    catalog: CatalogMapResolver,
    map_spec: MapDefinitionInput,
    *,
    worker_url: str,
) -> query.ToolResult:
    with _preparation_duration("configuration"):
        return await _map_from_definition(service, catalog, map_spec, worker_url=worker_url)
