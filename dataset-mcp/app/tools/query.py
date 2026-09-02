"""Pure, dependency-injected GeoParquet query tool functions."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated, Literal, Protocol, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]
type JSONMapping = Mapping[str, JSONValue]
type BasemapStyle = Literal["street", "satellite"]
type ColorScheme = Literal[
    "blues", "greens", "oranges", "purples", "viridis", "plasma", "rdyblu", "rdyg"
]
type NumericScale = Literal["linear", "sqrt", "log"]
type MapTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
type Color = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
type Longitude = Annotated[float, Field(ge=-180, le=180)]
type Latitude = Annotated[float, Field(ge=-90, le=90)]
type Zoom = Annotated[float, Field(ge=0, le=22)]


class MapLayerStyleInput(BaseModel):
    """Data-driven styling equivalent to the web map's approved style vocabulary."""

    model_config = ConfigDict(extra="forbid")

    color: Color | None = Field(
        default=None, description="Fallback solid color as a six-digit hex value."
    )
    color_property: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = Field(
        default=None,
        description=(
            "Query result column used for data-driven color. Numeric columns use breaks; "
            "string columns use categorical colors. The column must be selected by the SQL."
        ),
    )
    color_scheme: ColorScheme | None = Field(
        default=None, description="Named web-map palette used with color_property."
    )
    breaks: list[float] | None = Field(
        default=None,
        max_length=8,
        description="Optional increasing numeric color breakpoints; omit for automatic breaks.",
    )
    opacity: Annotated[float, Field(ge=0, le=1)] | None = Field(
        default=None, description="Fill, line, and point opacity."
    )
    point_radius: Annotated[float, Field(gt=0, le=50)] | None = Field(
        default=None, description="Base point radius in pixels."
    )
    point_radius_property: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = Field(
        default=None,
        description=(
            "Numeric query result column used to scale point radius between half and double "
            "point_radius. The column must be selected by the SQL."
        ),
    )
    point_radius_scale: NumericScale | None = Field(
        default=None, description="Numeric transform used for point-radius scaling."
    )
    line_width: Annotated[float, Field(gt=0, le=20)] | None = Field(
        default=None, description="Base line width in pixels."
    )
    line_width_property: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = Field(
        default=None,
        description=(
            "Numeric query result column used to scale line width between half and double "
            "line_width. The column must be selected by the SQL."
        ),
    )
    line_width_scale: NumericScale | None = Field(
        default=None, description="Numeric transform used for line-width scaling."
    )

    @model_validator(mode="after")
    def validate_breaks(self) -> Self:
        if self.breaks is not None:
            if self.color_property is None:
                raise ValueError("style breaks require a color property")
            if any(
                left >= right for left, right in zip(self.breaks, self.breaks[1:], strict=False)
            ):
                raise ValueError("style breaks must be strictly increasing")
        return self


class MapQueryLayerInput(MapLayerStyleInput):
    """One named, independently styled spatial query in a map."""

    model_config = ConfigDict(extra="forbid")

    layer_name: MapTitle
    sources: list[dict[str, JSONValue]] = Field(min_length=1, max_length=8)
    sql: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50_000)]
    geometry_column: str | None = Field(
        default=None,
        description="Name of the DuckDB GEOMETRY result column to render.",
    )
    result_crs: str | None = Field(
        default=None,
        description=(
            "CRS of the geometry values produced by SQL. Tiles and map framing reproject "
            "that result server-side."
        ),
    )
    style: MapLayerStyleInput | None = Field(
        default=None,
        description=(
            "Deprecated nested style object. Prefer the layer-level color, color_property, "
            "color_scheme, breaks, opacity, point_radius, point_radius_property, "
            "point_radius_scale, line_width, line_width_property, and line_width_scale fields."
        ),
    )
    visible: bool = True

    def resolved_style(self) -> MapLayerStyleInput | None:
        """Normalize canonical layer-level styling and the compatible nested form."""
        inline_values = (
            self.color,
            self.color_property,
            self.color_scheme,
            self.breaks,
            self.opacity,
            self.point_radius,
            self.point_radius_property,
            self.point_radius_scale,
            self.line_width,
            self.line_width_property,
            self.line_width_scale,
        )
        if self.style is not None:
            if any(value is not None for value in inline_values):
                raise ValueError("map layer styling must use layer-level fields or style, not both")
            return self.style
        if not any(value is not None for value in inline_values):
            return None
        return MapLayerStyleInput(
            color=self.color,
            color_property=self.color_property,
            color_scheme=self.color_scheme,
            breaks=self.breaks,
            opacity=self.opacity,
            point_radius=self.point_radius,
            point_radius_property=self.point_radius_property,
            point_radius_scale=self.point_radius_scale,
            line_width=self.line_width,
            line_width_property=self.line_width_property,
            line_width_scale=self.line_width_scale,
        )


class MapCameraInput(BaseModel):
    """Constrained initial MapLibre camera without arbitrary expressions."""

    model_config = ConfigDict(extra="forbid")

    bounds: tuple[Longitude, Latitude, Longitude, Latitude] | None = None
    center: tuple[Longitude, Latitude] | None = None
    zoom: Zoom | None = None
    bearing: Annotated[float, Field(ge=-180, le=180)] | None = None
    pitch: Annotated[float, Field(ge=0, le=85)] | None = None
    padding: Annotated[float, Field(ge=0, le=256)] | None = None

    @model_validator(mode="after")
    def validate_target(self) -> Self:
        if self.bounds is not None and self.center is not None:
            raise ValueError("camera accepts bounds or center, not both")
        if self.bounds is not None:
            west, south, east, north = self.bounds
            if west >= east or south >= north:
                raise ValueError("camera bounds must have increasing coordinates")
            if self.zoom is not None:
                raise ValueError("camera zoom cannot be combined with bounds")
        if self.zoom is not None and self.center is None:
            raise ValueError("camera zoom requires center")
        return self


class MapDefinitionInput(BaseModel):
    """Durable, replayable definition of a query map without runtime tokens."""

    model_config = ConfigDict(extra="forbid")

    title: MapTitle
    layers: list[MapQueryLayerInput] = Field(min_length=1, max_length=8)
    basemap: BasemapStyle = "street"
    camera: MapCameraInput | None = None


@dataclass(frozen=True)
class ToolResult:
    text: str
    structured_content: JSONMapping
    meta: JSONMapping | None = None


class QueryService(Protocol):
    def read_rows(
        self, source: JSONMapping, columns: Sequence[str], limit: int, offset: int
    ) -> Awaitable[JSONMapping]: ...
    def query(
        self,
        sources: Sequence[JSONMapping],
        sql: str,
        limit: int,
        geometry_column: str | None,
        result_crs: str | None,
    ) -> Awaitable[JSONMapping]: ...
    def page(self, token: str, offset: int, limit: int) -> Awaitable[JSONMapping]: ...
    def map_configuration(self, token: str) -> Awaitable[JSONMapping]: ...
    def validate_sql(self, sql: str, aliases: Sequence[str]) -> None: ...
    def validate_token(self, token: str) -> JSONMapping: ...


def _limit(value: int) -> int:
    if not 1 <= value <= 1_000:
        raise ValueError("limit must be between 1 and 1000")
    return value


def _result(label: str, payload: JSONMapping) -> ToolResult:
    public_payload = {key: value for key, value in payload.items() if key != "resolved_sources"}
    return ToolResult(
        text=(f"{label}:\n{json.dumps(public_payload, ensure_ascii=False, separators=(',', ':'))}"),
        structured_content=public_payload,
    )


async def read_geoparquet_rows(
    service: QueryService,
    source: JSONMapping,
    *,
    columns: Sequence[str] = (),
    limit: int = 100,
    offset: int = 0,
) -> ToolResult:
    if offset < 0:
        raise ValueError("offset must be non-negative")
    payload = await service.read_rows(source, columns, _limit(limit), offset)
    return _result("GeoParquet rows", payload)


async def query_geoparquet(
    service: QueryService,
    sources: Sequence[JSONMapping],
    sql: str,
    *,
    limit: int = 100,
    geometry_column: str | None = None,
    result_crs: str | None = None,
) -> ToolResult:
    if not 1 <= len(sources) <= 8:
        raise ValueError("between 1 and 8 sources are required")
    aliases = tuple(str(source.get("alias", "")) for source in sources)
    if any(not alias for alias in aliases):
        raise ValueError("every source must have an alias")
    service.validate_sql(sql, aliases)
    payload = await service.query(sources, sql, _limit(limit), geometry_column, result_crs)
    return _result("GeoParquet query", payload)


async def get_query_page(
    service: QueryService, query_token: str, offset: int, page_size: int = 100
) -> ToolResult:
    if offset < 0:
        raise ValueError("offset must be non-negative")
    service.validate_token(query_token)
    payload = await service.page(query_token, offset, _limit(page_size))
    return _result("Query page", payload)


def _style_payload(style: MapLayerStyleInput) -> dict[str, JSONValue]:
    payload: dict[str, JSONValue] = {}
    if style.color is not None:
        payload["color"] = style.color
    if style.color_property is not None:
        payload["color_property"] = style.color_property
    if style.color_scheme is not None:
        payload["color_scheme"] = style.color_scheme
    if style.breaks is not None:
        payload["breaks"] = list[JSONValue](style.breaks)
    if style.opacity is not None:
        payload["opacity"] = style.opacity
    if style.point_radius is not None:
        payload["point_radius"] = style.point_radius
    if style.point_radius_property is not None:
        payload["point_radius_property"] = style.point_radius_property
    if style.point_radius_scale is not None:
        payload["point_radius_scale"] = style.point_radius_scale
    if style.line_width is not None:
        payload["line_width"] = style.line_width
    if style.line_width_property is not None:
        payload["line_width_property"] = style.line_width_property
    if style.line_width_scale is not None:
        payload["line_width_scale"] = style.line_width_scale
    return payload


_NUMERIC_TYPES = (
    "BIGINT",
    "DECIMAL",
    "DOUBLE",
    "FLOAT",
    "HUGEINT",
    "INTEGER",
    "REAL",
    "SMALLINT",
    "TINYINT",
    "UBIGINT",
    "UHUGEINT",
    "UINTEGER",
    "USMALLINT",
    "UTINYINT",
)


def _result_columns(value: JSONValue | None) -> tuple[list[JSONValue], dict[str, str]]:
    if not isinstance(value, list):
        raise ValueError("query result columns are unavailable")
    types: dict[str, str] = {}
    for column in value:
        if not isinstance(column, dict):
            raise ValueError("query result columns are invalid")
        name = column.get("name")
        logical_type = column.get("type")
        if not isinstance(name, str) or not isinstance(logical_type, str):
            raise ValueError("query result columns are invalid")
        types[name] = logical_type
    return value, types


def _is_numeric_type(logical_type: str) -> bool:
    return logical_type.upper().strip().startswith(_NUMERIC_TYPES)


def _camera_payload(camera: MapCameraInput) -> dict[str, JSONValue]:
    payload: dict[str, JSONValue] = {}
    if camera.bounds is not None:
        payload["bounds"] = list(camera.bounds)
    if camera.center is not None:
        payload["center"] = list(camera.center)
    if camera.zoom is not None:
        payload["zoom"] = camera.zoom
    if camera.bearing is not None:
        payload["bearing"] = camera.bearing
    if camera.pitch is not None:
        payload["pitch"] = camera.pitch
    if camera.padding is not None:
        payload["padding"] = camera.padding
    return payload


def _map_layer_spec_payload(layer: MapQueryLayerInput) -> dict[str, JSONValue]:
    payload: dict[str, JSONValue] = {
        "layer_name": layer.layer_name,
        "sources": [dict(source) for source in layer.sources],
        "sql": layer.sql,
        "visible": layer.visible,
    }
    if layer.geometry_column is not None:
        payload["geometry_column"] = layer.geometry_column
    if layer.result_crs is not None:
        payload["result_crs"] = layer.result_crs
    style = layer.resolved_style()
    if style is not None:
        payload.update(_style_payload(style))
    return payload


def _map_definition_payload(map_spec: MapDefinitionInput) -> dict[str, JSONValue]:
    payload: dict[str, JSONValue] = {
        "title": map_spec.title,
        "basemap": map_spec.basemap,
        "layers": [_map_layer_spec_payload(layer) for layer in map_spec.layers],
    }
    if map_spec.camera is not None:
        payload["camera"] = _camera_payload(map_spec.camera)
    return payload


async def _query_map_from_definition(
    service: QueryService,
    map_spec: MapDefinitionInput,
    *,
    refreshed: bool,
) -> ToolResult:
    layers = map_spec.layers
    title = map_spec.title
    basemap = map_spec.basemap
    camera = map_spec.camera
    names = tuple(layer.layer_name.casefold() for layer in layers)
    if len(set(names)) != len(names):
        raise ValueError("map layer names must be unique")

    presented_layers: list[JSONValue] = []
    worker_url: str | None = None
    configuration_fields = (
        "tile_url",
        "source_layer",
        "geometry_column",
        "result_crs",
        "initial_bounds",
    )
    for layer in layers:
        layer_style = layer.resolved_style()
        query_result = await query_geoparquet(
            service,
            layer.sources,
            layer.sql,
            limit=1,
            geometry_column=layer.geometry_column,
            result_crs=layer.result_crs,
        )
        token = query_result.structured_content.get("query_token")
        if not isinstance(token, str):
            raise ValueError("query result is missing its token")
        token_metadata = service.validate_token(token)
        expires_at = token_metadata.get("expires_at")
        if not isinstance(expires_at, str):
            raise ValueError("query token metadata is missing its expiration")
        map_payload = await service.map_configuration(token)
        query_id = map_payload.get("query_id")
        configuration = map_payload.get("map_configuration")
        if not isinstance(query_id, str) or not isinstance(configuration, dict):
            raise ValueError("map configuration is invalid")
        layer_worker_url = configuration.get("worker_url")
        if not isinstance(layer_worker_url, str):
            raise ValueError("map configuration is missing its worker URL")
        if worker_url is None:
            worker_url = layer_worker_url
        elif worker_url != layer_worker_url:
            raise ValueError("map layers must use the same worker URL")

        presented_layer: dict[str, JSONValue] = {
            "query_id": query_id,
            "query_token": token,
            "expires_at": expires_at,
            "layer_name": layer.layer_name,
            "visible": layer.visible,
        }
        columns, column_types = _result_columns(query_result.structured_content.get("columns"))
        if layer_style is not None:
            style_properties = (
                layer_style.color_property,
                layer_style.point_radius_property,
                layer_style.line_width_property,
            )
            for property_name in style_properties:
                if property_name is not None and property_name not in column_types:
                    raise ValueError(
                        f"style property {property_name!r} is missing from the query result"
                    )
            numeric_properties = (
                layer_style.point_radius_property,
                layer_style.line_width_property,
            )
            for property_name in numeric_properties:
                if property_name is not None and not _is_numeric_type(column_types[property_name]):
                    raise ValueError(f"style property {property_name!r} must be numeric")
        presented_layer["columns"] = columns
        for field in configuration_fields:
            value = configuration.get(field)
            if value is not None:
                presented_layer[field] = value
        if layer_style is not None:
            presented_layer["style"] = _style_payload(layer_style)
        presented_layers.append(presented_layer)

    if worker_url is None:
        raise ValueError("map configuration is missing its worker URL")
    presented_payload: dict[str, JSONValue] = {
        "title": title,
        "basemap": basemap,
        "worker_url": worker_url,
        "layers": presented_layers,
        "map_spec": _map_definition_payload(map_spec),
    }
    if camera is not None:
        presented_payload["camera"] = _camera_payload(camera)
    layer_names = ", ".join(layer.layer_name for layer in layers)
    verb = "Refreshed" if refreshed else "Opened"
    return ToolResult(
        text=f"{verb} map '{title}' with {len(layers)} layers: {layer_names}.",
        structured_content=presented_payload,
    )


async def view_query_map(
    service: QueryService,
    *,
    title: MapTitle,
    layers: Sequence[MapQueryLayerInput],
    basemap: BasemapStyle = "street",
    camera: MapCameraInput | None = None,
) -> ToolResult:
    return await _query_map_from_definition(
        service,
        MapDefinitionInput(
            title=title,
            layers=list(layers),
            basemap=basemap,
            camera=camera,
        ),
        refreshed=False,
    )


async def refresh_query_map(service: QueryService, map_spec: MapDefinitionInput) -> ToolResult:
    """Re-run a durable map definition to issue fresh stateless query tokens."""
    return await _query_map_from_definition(service, map_spec, refreshed=True)
