#!/opt/hifld-udf/bin/python
"""Bounded ClickHouse executable UDF for WKB reprojection to EPSG:4326."""

from __future__ import annotations

import json
import math
import re
import sys
import tempfile
import shutil
from functools import lru_cache

from pyproj import CRS, Transformer, network
from shapely import from_wkb, get_coordinates, has_z, to_wkb, transform
from shapely.errors import GEOSException

MAX_WKB_BYTES = 32 * 1024 * 1024
MAX_ROW_BYTES = 2 * MAX_WKB_BYTES + 1024
_AUTHORITY_CRS = re.compile(r"^EPSG:([1-9][0-9]{0,5})$")

network.set_network_enabled(False)


def _canonical_crs(value: str, role: str) -> str:
    normalized = value.upper()
    if normalized == "OGC:CRS84":
        return normalized
    if _AUTHORITY_CRS.fullmatch(normalized) is None:
        raise ValueError(f"unsupported {role} CRS; use EPSG:<number> or OGC:CRS84")
    return normalized


@lru_cache(maxsize=32)
def _transformer(source_crs: str, target_crs: str) -> Transformer:
    source = CRS.from_user_input(source_crs)
    target = CRS.from_user_input(target_crs)
    return Transformer.from_crs(source, target, always_xy=True)


def _geometry_from_hex(hex_wkb: str):
    if len(hex_wkb) > MAX_WKB_BYTES * 2:
        raise ValueError("WKB exceeds maximum size")
    try:
        raw_wkb = bytes.fromhex(hex_wkb)
    except ValueError as exc:
        raise ValueError("invalid WKB hexadecimal input") from exc
    if len(raw_wkb) > MAX_WKB_BYTES:
        raise ValueError("WKB exceeds maximum size")
    try:
        return from_wkb(raw_wkb)
    except GEOSException as exc:
        raise ValueError("invalid WKB geometry") from exc


def reproject_wkb(hex_wkb: str, source_crs: str, target_crs: str) -> str:
    """Return uppercase hexadecimal WKB transformed between authority CRSs."""
    geometry = _geometry_from_hex(hex_wkb)
    canonical_source = _canonical_crs(source_crs, "source")
    canonical_target = _canonical_crs(target_crs, "target")
    if canonical_source == canonical_target:
        result = geometry
    else:
        transformer = _transformer(canonical_source, canonical_target)
        result = transform(geometry, transformer.transform, interleaved=False)

    coordinates = get_coordinates(result, include_z=bool(has_z(result)))
    if any(not math.isfinite(float(value)) for row in coordinates for value in row):
        raise ValueError("projected coordinates must be finite")
    return str(to_wkb(result, hex=True))


def geometry_bounds(hex_wkb: str) -> list[float]:
    """Return finite XY bounds, or an empty array for an empty geometry."""
    geometry = _geometry_from_hex(hex_wkb)
    if geometry.is_empty:
        return []
    bounds = [float(value) for value in geometry.bounds]
    if len(bounds) != 4 or any(not math.isfinite(value) for value in bounds):
        raise ValueError("geometry bounds must be finite")
    return bounds


def _arguments(row: object, count: int) -> list[str]:
    if not isinstance(row, dict):
        raise ValueError("input row must be a JSON object")
    values = list(row.values())
    if len(values) != count or not all(isinstance(value, str) for value in values):
        raise ValueError(f"input row must contain exactly {count} string arguments")
    return values


def main() -> int:
    mode = "reproject" if len(sys.argv) == 1 else sys.argv[1]
    if mode not in {"reproject", "bounds"} or len(sys.argv) > 2:
        print("hifld geometry UDF: invalid fixed mode", file=sys.stderr)
        return 2
    try:
        while header := sys.stdin.buffer.readline():
            row_count = int(header)
            if row_count < 0:
                raise ValueError("chunk row count must not be negative")
            output = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
            for _ in range(row_count):
                line = sys.stdin.buffer.readline(MAX_ROW_BYTES + 1)
                if not line:
                    raise ValueError("input chunk ended before its declared row count")
                if len(line) > MAX_ROW_BYTES:
                    raise ValueError("input row exceeds maximum size")
                row = json.loads(line)
                if mode == "bounds":
                    (hex_wkb,) = _arguments(row, 1)
                    result: str | list[float] = geometry_bounds(hex_wkb)
                else:
                    hex_wkb, source_crs, target_crs = _arguments(row, 3)
                    result = reproject_wkb(hex_wkb, source_crs, target_crs)
                encoded = (json.dumps({"result": result}) + "\n").encode()
                if output.tell() + len(encoded) > 128 * 1024 * 1024:
                    raise ValueError("geometry batch exceeds the output size limit")
                output.write(encoded)
            output.seek(0)
            shutil.copyfileobj(output, sys.stdout.buffer)
            output.close()
            sys.stdout.buffer.flush()
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"hifld_reproject_wkb: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
