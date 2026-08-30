"""One-connection DuckDB runtime owned by a spawned query worker."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from secrets import token_hex
from typing import cast

import duckdb
from sqlglot import exp, parse_one

from app.query.serialization import (
    serialize_rows,
)
from query_worker.metrics import init_connection, measure
from query_worker.protocol import (
    WorkerCredentialProfile,
    WorkerFailure,
    WorkerMap,
    WorkerMapFeature,
    WorkerMapQuery,
    WorkerPage,
    WorkerQuery,
    WorkerRuntimeConfig,
    WorkerTile,
    WorkerTileQuery,
)


def _quoted_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) * 2)}"'


def _sql_string(value: str) -> str:
    return f"'{value.replace(chr(39), chr(39) * 2)}'"


# Adapted from ../geoparquet-duckdb-partitioning/
# duckdb_parquet_provider.py:get_connection. The spike's global connection and
# runtime INSTALL statements are intentionally replaced by one in-memory
# connection per spawned worker and explicit LOAD of immutable extensions.
def get_connection(config: WorkerRuntimeConfig) -> duckdb.DuckDBPyConnection:
    if config.threads < 1:
        raise ValueError("threads must be positive")
    if config.max_columns < 1:
        raise ValueError("max_columns must be positive")
    temp_directory = Path(config.temp_directory)
    temp_directory.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect(database=":memory:")
    try:
        connection.execute("SET autoinstall_known_extensions = false")
        connection.execute("SET autoload_known_extensions = false")
        connection.execute("SET allow_community_extensions = false")
        if config.extension_directory is not None:
            connection.execute("SET extension_directory = ?", [config.extension_directory])
        if config.load_extensions:
            connection.execute("LOAD httpfs")
            connection.execute("LOAD spatial")
        connection.execute("SET threads = ?", [config.threads])
        connection.execute("SET memory_limit = ?", [config.memory_limit])
        connection.execute("SET temp_directory = ?", [str(temp_directory)])
        init_connection(
            connection,
            temp_directory=temp_directory,
            enabled=config.metrics_enabled,
        )
        connection.execute("SET lock_configuration = true")
    except BaseException:
        connection.close()
        raise
    return connection


def _rewrite_source_aliases(sql: str, aliases: dict[str, str]) -> str:
    expression = parse_one(sql, dialect="duckdb")
    for table in expression.find_all(exp.Table):
        if table.db or table.catalog:
            continue
        internal_name = aliases.get(table.name)
        if internal_name is not None:
            table.set("this", exp.to_identifier(internal_name, quoted=True))
    return expression.sql(dialect="duckdb")


class WorkerRuntime:
    """Execute requests sequentially against one worker-owned connection."""

    def __init__(self, config: WorkerRuntimeConfig) -> None:
        self._config = config
        self._credential_profiles = self._index_profiles(config.credential_profiles)
        self.connection = get_connection(config)

    @staticmethod
    def _index_profiles(
        profiles: tuple[WorkerCredentialProfile, ...],
    ) -> dict[str, WorkerCredentialProfile]:
        indexed: dict[str, WorkerCredentialProfile] = {}
        for profile in profiles:
            if profile.slug in indexed:
                raise ValueError("worker credential profile slugs must be unique")
            indexed[profile.slug] = profile
        return indexed

    def close(self) -> None:
        self.connection.close()

    def _create_request_secrets(
        self, request: WorkerQuery | WorkerTileQuery | WorkerMapQuery
    ) -> tuple[str, ...]:
        secret_names: list[str] = []
        for source in request.sources:
            if source.profile_slug is None:
                continue
            profile = self._credential_profiles.get(source.profile_slug)
            if profile is None:
                raise ValueError("worker credential profile is not configured")
            secret_name = f"_mcp_secret_{token_hex(16)}"
            scope = f"s3://{profile.bucket}"
            if profile.prefix:
                scope = f"{scope}/{profile.prefix.strip('/')}"
            options = [
                "TYPE S3",
                "PROVIDER CONFIG",
                f"KEY_ID {_sql_string(profile.access_key_id)}",
                f"SECRET {_sql_string(profile.secret_access_key)}",
                f"SCOPE {_sql_string(scope)}",
                f"URL_STYLE {_sql_string(profile.url_style)}",
                f"USE_SSL {'true' if profile.tls else 'false'}",
            ]
            if profile.region is not None:
                options.append(f"REGION {_sql_string(profile.region)}")
            if profile.endpoint is not None:
                options.append(f"ENDPOINT {_sql_string(profile.endpoint)}")
            self.connection.execute(
                f"CREATE TEMPORARY SECRET {_quoted_identifier(secret_name)} ({', '.join(options)})"
            )
            secret_names.append(secret_name)
        return tuple(secret_names)

    def _drop_request_secrets(self, secret_names: tuple[str, ...]) -> None:
        for secret_name in secret_names:
            self.connection.execute(f"DROP SECRET IF EXISTS {_quoted_identifier(secret_name)}")

    def _create_source_views(
        self, request: WorkerQuery | WorkerTileQuery | WorkerMapQuery
    ) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for source in request.sources:
            if source.alias in aliases:
                raise ValueError("duplicate source alias")
            if not source.object_uris:
                raise ValueError("source object list must not be empty")
            view_name = f"_mcp_source_{token_hex(16)}"
            # The relation API passes the exact trusted object list through
            # DuckDB's binding layer; no URI is interpolated into SQL.
            relation = self.connection.read_parquet(list(source.object_uris), union_by_name=True)
            relation.create_view(view_name)
            aliases[source.alias] = view_name
        return aliases

    def _drop_source_views(self, aliases: dict[str, str]) -> None:
        for view_name in aliases.values():
            self.connection.execute(f"DROP VIEW IF EXISTS {_quoted_identifier(view_name)}")

    def execute(
        self, request: WorkerQuery | WorkerTileQuery | WorkerMapQuery
    ) -> WorkerPage | WorkerTile | WorkerMap | WorkerFailure:
        if request.deadline <= datetime.now(tz=UTC):
            return WorkerFailure(code="query_timeout", message="The query deadline expired")

        aliases: dict[str, str] = {}
        secret_names: tuple[str, ...] = ()
        try:
            secret_names = self._create_request_secrets(request)
            aliases = self._create_source_views(request)
            rewritten_sql = _rewrite_source_aliases(request.canonical_sql, aliases)
            if isinstance(request, WorkerTileQuery):
                from query_worker.tiles import execute_tile

                return execute_tile(self.connection, rewritten_sql, request)
            if isinstance(request, WorkerMapQuery):
                from query_worker.tiles import execute_map_features

                map_result = execute_map_features(
                    self.connection,
                    rewritten_sql,
                    geometry_column=request.geometry_column,
                    result_crs=request.result_crs,
                    bbox=request.bbox,
                    zoom=request.zoom,
                    feature_cap=request.feature_cap,
                    max_result_bytes=request.max_result_bytes,
                )
                if isinstance(map_result, WorkerFailure):
                    return map_result
                return WorkerMap(
                    features=tuple(
                        WorkerMapFeature(
                            geometry=feature.geometry,
                            properties=feature.properties,
                        )
                        for feature in map_result.features
                    ),
                    elapsed_ms=0,
                    bytes_read=0,
                    files_read=sum(len(source.object_uris) for source in request.sources),
                )
            # The inner SQL has already passed SqlPolicy. LIMIT and OFFSET stay
            # outside it so an inner LIMIT remains part of relational semantics.
            bounded_sql = f"SELECT * FROM ({rewritten_sql}) AS _mcp_result LIMIT ? OFFSET ?"
            temp_directory = Path(self._config.temp_directory)
            with measure(
                self.connection,
                label="query_page",
                temp_directory=temp_directory,
                enabled=self._config.metrics_enabled,
            ) as mutable_metrics:
                cursor = self.connection.execute(bounded_sql, [request.limit + 1, request.offset])
                raw_description = cast(list[tuple[object, ...]], cursor.description)
                raw_rows = cast(list[tuple[object, ...]], cursor.fetchall())
            metrics = mutable_metrics.snapshot()

            columns = tuple((str(item[0]), str(item[1])) for item in raw_description)
            if len(columns) > self._config.max_columns:
                return WorkerFailure(
                    code="query_result_too_wide",
                    message="The query returned too many columns",
                )
            serialized = serialize_rows(
                columns=columns,
                rows=raw_rows,
                offset=request.offset,
                requested_limit=request.limit,
                deterministic_order=request.deterministic_order,
                max_cell_bytes=request.max_cell_bytes or self._config.max_cell_bytes,
                max_result_bytes=request.max_result_bytes or self._config.max_result_bytes,
            )
            return WorkerPage(
                columns=tuple((name, logical_type, True) for name, logical_type in columns),
                rows=serialized.rows,
                offset=request.offset,
                returned_count=serialized.returned,
                has_more=serialized.has_more,
                elapsed_ms=metrics.wall_ms,
                bytes_read=metrics.bytes_read or 0,
                files_read=sum(len(source.object_uris) for source in request.sources),
                next_offset=serialized.next_offset,
                response_truncated=serialized.response_truncated,
                deterministic_order=serialized.deterministic_order,
            )
        except duckdb.OutOfMemoryException:
            return WorkerFailure(
                code="query_memory_limit",
                message="The query exceeded its memory limit",
            )
        except duckdb.IOException:
            return WorkerFailure(
                code="storage_unavailable",
                message="A query source could not be read",
            )
        except (duckdb.Error, ValueError, TypeError):
            return WorkerFailure(
                code="query_execution_failed",
                message="The bounded query could not be executed",
            )
        finally:
            self._drop_source_views(aliases)
            self._drop_request_secrets(secret_names)
