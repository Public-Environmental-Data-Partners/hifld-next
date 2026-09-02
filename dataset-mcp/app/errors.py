from dataclasses import dataclass
from enum import StrEnum


class ErrorCode(StrEnum):
    CATALOG_NOT_FOUND = "catalog_not_found"
    CATALOG_UNAVAILABLE = "catalog_unavailable"
    CATALOG_CONTRACT_INVALID = "catalog_contract_invalid"
    SCHEMA_VERSION_NOT_FOUND = "schema_version_not_found"
    SOURCE_NOT_GEOPARQUET = "source_not_geoparquet"
    SOURCE_CHANGED = "source_changed"
    INVALID_ALIAS = "invalid_alias"
    SQL_REJECTED = "sql_rejected"
    QUERY_TOKEN_INVALID = "query_token_invalid"
    QUERY_TOKEN_EXPIRED = "query_token_expired"
    QUERY_TOKEN_TOO_LARGE = "query_token_too_large"
    QUERY_TIMEOUT = "query_timeout"
    QUERY_MEMORY_LIMIT = "query_memory_limit"
    QUERY_SPILL_LIMIT = "query_spill_limit"
    QUERY_OFFSET_LIMIT = "query_offset_limit"
    QUERY_EXECUTION_FAILED = "query_execution_failed"
    QUERY_RESULT_TOO_WIDE = "query_result_too_wide"
    ROW_TOO_LARGE = "row_too_large"
    STORAGE_UNAVAILABLE = "storage_unavailable"
    WORKER_FAILED = "worker_failed"
    WORKER_PROTOCOL_INVALID = "worker_protocol_invalid"
    WORKER_UNAVAILABLE = "worker_unavailable"
    INTERNAL_ERROR = "internal_error"
    GEOMETRY_AMBIGUOUS = "geometry_ambiguous"
    GEOMETRY_CRS_REQUIRED = "geometry_crs_required"
    MAP_NOT_SUPPORTED = "map_not_supported"
    TILE_TOO_DENSE = "tile_too_dense"
    HOST_INTERACTIVITY_UNAVAILABLE = "host_interactivity_unavailable"


@dataclass(frozen=True, slots=True)
class AppError(Exception):
    code: ErrorCode
    message: str
    details: tuple[tuple[str, str], ...] = ()

    def __str__(self) -> str:
        return self.message
