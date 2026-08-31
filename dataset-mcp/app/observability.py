"""Safe, typed observability for bounded dataset-query execution.

Only explicitly allowlisted operational fields are emitted.  In particular,
SQL, tokens, credentials, result values, and geometry never cross this module's
public event boundary.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Literal, Protocol

type QueryTransport = Literal["mcp", "webapp_http"]


@dataclass(frozen=True, slots=True)
class MetricEvent:
    name: str
    value: float
    labels: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class StructuredLogEvent:
    event: str
    stage: str
    query_hash: str
    source_ids: tuple[str, ...]
    source_versions: tuple[str, ...]
    token_version: int | None
    limit: int | None
    offset: int | None
    duration_ms: float
    error_code: str | None

    def as_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"), sort_keys=True)


@dataclass(frozen=True, slots=True)
class TransportLogEvent:
    event: Literal["dataset_query_transport"]
    transport: QueryTransport
    duration_ms: float

    def as_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"), sort_keys=True)


class MetricSink(Protocol):
    def record(self, event: MetricEvent) -> None: ...


class StructuredLogSink(Protocol):
    def emit(self, event: StructuredLogEvent | TransportLogEvent) -> None: ...


@dataclass(slots=True)
class InMemoryMetricSink:
    events: list[MetricEvent]

    def __init__(self) -> None:
        self.events = []

    def record(self, event: MetricEvent) -> None:
        self.events.append(event)


@dataclass(slots=True)
class InMemoryStructuredLogSink:
    events: list[StructuredLogEvent | TransportLogEvent]

    def __init__(self) -> None:
        self.events = []

    def emit(self, event: StructuredLogEvent | TransportLogEvent) -> None:
        self.events.append(event)


class QueryObservability:
    """Emit stage timings and safe request correlation metadata."""

    def __init__(self, *, metrics: MetricSink, logs: StructuredLogSink) -> None:
        self._metrics = metrics
        self._logs = logs

    def record_query(
        self,
        *,
        stage: str,
        duration_ms: float,
        query_hash: str,
        source_ids: Sequence[str],
        source_versions: Sequence[str],
        token_version: int | None,
        limit: int | None,
        offset: int | None,
        error_code: str | None,
        sql: str | None = None,
        token: str | None = None,
        row_value: str | None = None,
        geometry: str | None = None,
        credential: str | None = None,
    ) -> None:
        """Record one stage without serializing sensitive execution inputs.

        The sensitive arguments exist only to make the redaction boundary
        explicit to callers; they are intentionally never read.
        """
        del sql, token, row_value, geometry, credential
        labels = (("stage", stage), ("error_code", error_code or "none"))
        self._metrics.record(
            MetricEvent(
                name=f"dataset_mcp_{stage}_duration_ms",
                value=duration_ms,
                labels=labels,
            )
        )
        self._logs.emit(
            StructuredLogEvent(
                event="dataset_query_stage",
                stage=stage,
                query_hash=query_hash,
                source_ids=tuple(source_ids),
                source_versions=tuple(source_versions),
                token_version=token_version,
                limit=limit,
                offset=offset,
                duration_ms=duration_ms,
                error_code=error_code,
            )
        )

    def record_transport(self, *, transport: QueryTransport, duration_ms: float) -> None:
        """Record a bounded transport timing without request-derived fields."""
        labels = (("transport", transport),)
        self._metrics.record(
            MetricEvent(
                name="dataset_mcp_transport_duration_ms",
                value=duration_ms,
                labels=labels,
            )
        )
        self._logs.emit(
            TransportLogEvent(
                event="dataset_query_transport",
                transport=transport,
                duration_ms=duration_ms,
            )
        )

    def record_measurements(
        self,
        *,
        stage: str,
        rows: int | None = None,
        files: int | None = None,
        bytes_read: int | None = None,
        peak_memory_bytes: int | None = None,
        spill_bytes: int | None = None,
    ) -> None:
        """Record safe numeric execution measurements for an execution stage."""
        measurements = (
            ("rows", rows),
            ("files", files),
            ("bytes", bytes_read),
            ("peak_memory_bytes", peak_memory_bytes),
            ("spill_bytes", spill_bytes),
        )
        for name, value in measurements:
            if value is not None:
                self._metrics.record(
                    MetricEvent(
                        name=f"dataset_mcp_{stage}_{name}",
                        value=float(value),
                        labels=(("stage", stage),),
                    )
                )
