"""Opaque, revision-bound physical-row identifiers."""

from __future__ import annotations

import re
from base64 import urlsafe_b64decode, urlsafe_b64encode
from dataclasses import dataclass


class FeatureIdError(ValueError):
    """An external feature identifier is malformed or unsafe."""


_CHECKSUM = re.compile(r"^[0-9a-f]{64}$")


def _encode(value: str) -> str:
    return urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def _decode(value: str) -> str:
    try:
        return urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode("utf-8")
    except (UnicodeDecodeError, ValueError) as error:
        raise FeatureIdError("invalid feature identifier") from error


def _safe_path(path: str) -> str:
    if not path or "\x00" in path or path.startswith("/"):
        raise FeatureIdError("invalid feature identifier")
    if any(part in {"", ".", ".."} for part in path.replace("\\", "/").split("/")):
        raise FeatureIdError("invalid feature identifier")
    return path


@dataclass(frozen=True, slots=True)
class FeatureId:
    """Identity derived from the catalog asset and DuckDB physical row position."""

    asset_key: str
    relative_path: str
    checksum: str
    row_number: int

    def __post_init__(self) -> None:
        if not self.asset_key or "." in self.asset_key or "/" in self.asset_key:
            raise FeatureIdError("invalid feature identifier")
        _safe_path(self.relative_path)
        if _CHECKSUM.fullmatch(self.checksum) is None or self.row_number < 0:
            raise FeatureIdError("invalid feature identifier")

    def encode(self) -> str:
        return ".".join(
            (
                "v1",
                _encode(self.asset_key),
                _encode(self.relative_path),
                self.checksum,
                str(self.row_number),
            )
        )

    @classmethod
    def decode(cls, value: str) -> FeatureId:
        parts = value.split(".")
        if len(parts) != 5 or parts[0] != "v1" or not parts[4].isdigit():
            raise FeatureIdError("invalid feature identifier")
        return cls(_decode(parts[1]), _decode(parts[2]), parts[3], int(parts[4]))
