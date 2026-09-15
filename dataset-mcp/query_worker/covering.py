"""Bounded discovery of GeoParquet covering declarations from trusted objects."""

from collections import OrderedDict
from time import monotonic
from typing import Annotated, cast

import duckdb
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from query_worker.protocol import WorkerSeaweedSource

PathParts = Annotated[tuple[str, ...], Field(min_length=1, max_length=8)]


class CoveringPaths(BaseModel):
    model_config = ConfigDict(frozen=True)
    xmin: PathParts
    ymin: PathParts
    xmax: PathParts
    ymax: PathParts


class GeometryCovering(CoveringPaths):
    crs: str


class _Covering(BaseModel):
    bbox: CoveringPaths


class _CrsId(BaseModel):
    authority: str
    code: int | str


class _Crs(BaseModel):
    id: _CrsId | None = None


class _Column(BaseModel):
    covering: _Covering | None = None
    # GeoParquet's omitted CRS means OGC:CRS84; explicit null means unknown.
    crs: _Crs | None = Field(default_factory=lambda: _Crs(id=_CrsId(authority="EPSG", code=4326)))


class _Geo(BaseModel):
    columns: dict[str, _Column]


def parse_covering(value: str | bytes, geometry_column: str) -> GeometryCovering | None:
    try:
        column = _Geo.model_validate_json(value).columns.get(geometry_column)
    except ValidationError:
        return None
    if column is None or column.covering is None or column.crs is None or column.crs.id is None:
        return None
    identifier = column.crs.id
    crs = f"{identifier.authority.upper()}:{identifier.code}"
    if crs == "OGC:CRS84":
        crs = "EPSG:4326"
    paths = column.covering.bbox
    if any(
        not part or len(part) > 256
        for path in (paths.xmin, paths.xmax, paths.ymin, paths.ymax)
        for part in path
    ):
        return None
    return GeometryCovering(crs=crs, **paths.model_dump())


def quote_path(path: tuple[str, ...], qualifier: str | None = None) -> str:
    parts = ((qualifier,) if qualifier is not None else ()) + path
    return ".".join('"' + part.replace('"', '""') + '"' for part in parts)


class CoveringMetadataCache:
    """Per-worker TTL/LRU, never retain more than 32 object-list declarations."""

    def __init__(self) -> None:
        self._entries: OrderedDict[
            tuple[tuple[str, ...], str, WorkerSeaweedSource | None],
            tuple[float, GeometryCovering | None],
        ] = OrderedDict()

    def resolve(
        self,
        connection: duckdb.DuckDBPyConnection,
        uris: tuple[str, ...],
        geometry: str,
        *,
        storage: WorkerSeaweedSource | None = None,
    ) -> GeometryCovering | None:
        key = (uris, geometry, storage)
        entry = self._entries.get(key)
        now = monotonic()
        if entry is not None and entry[0] > now:
            self._entries.move_to_end(key)
            return entry[1]
        rows = cast(
            list[tuple[object, ...]],
            connection.execute(
                "SELECT f.file_name, k.value FROM parquet_file_metadata(?) f "
                "LEFT JOIN parquet_kv_metadata(?) k ON f.file_name = k.file_name AND k.key = 'geo'",
                [list(uris), list(uris)],
            ).fetchall(),
        )
        declarations: dict[str, GeometryCovering | None] = {}
        for row in rows:
            if len(row) == 2 and isinstance(row[0], str):
                declarations[row[0]] = (
                    parse_covering(row[1], geometry) if isinstance(row[1], (str, bytes)) else None
                )
        # Do not pick the first file's covering for a heterogeneous union.
        values = list(declarations.values())
        covering = values[0] if values and all(value == values[0] for value in values) else None
        self._entries[key] = (now + 60.0, covering)
        self._entries.move_to_end(key)
        while len(self._entries) > 32:
            self._entries.popitem(last=False)
        return covering
