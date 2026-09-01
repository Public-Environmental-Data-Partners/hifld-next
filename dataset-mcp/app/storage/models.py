"""Safe DuckDB storage contracts derived from trusted catalog metadata."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class DuckDbSeaweedSpec(BaseModel):
    """Non-secret local SeaweedFS settings obtained from the trusted catalog."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    bucket: str
    endpoint: str
    tls: bool = False
    url_style: Literal["path"] = "path"


class DuckDbSourceSpec(BaseModel):
    """Exact source objects plus non-secret local storage configuration."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    object_uris: tuple[str, ...]
    seaweedfs: DuckDbSeaweedSpec | None = None
