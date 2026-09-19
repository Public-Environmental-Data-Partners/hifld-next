"""Preserve engine diagnostics without exposing worker execution details."""

import re
from urllib.parse import unquote

import duckdb

from query_worker.protocol import WorkerRuntimeConfig, WorkerSourceSpec


def duckdb_diagnostic(
    error: duckdb.Error,
    config: WorkerRuntimeConfig,
    sources: tuple[WorkerSourceSpec, ...],
    aliases: dict[str, str],
) -> str:
    message = str(error)
    # DuckDB's location refers to our generated wrapper, not the user's SQL.
    # Do not return the wrapper or its literals as a purported user location.
    message = re.split(r"\nLINE \d+:", message, maxsplit=1)[0]
    private_values = [config.temp_directory, config.extension_directory or ""]
    credentials = config.seaweedfs_credentials
    if credentials is not None:
        private_values.extend((credentials.access_key_id, credentials.secret_access_key))
    for source in sources:
        private_values.extend(source.object_uris)
        private_values.extend(unquote(uri) for uri in source.object_uris)
        if source.seaweedfs is not None:
            private_values.append(source.seaweedfs.endpoint)
    for value in sorted(set(private_values), key=len, reverse=True):
        if value:
            message = message.replace(value, "[redacted]")
    for alias, internal_name in aliases.items():
        message = message.replace(internal_name, alias)
    message = re.sub(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s\"'<>]+", "[redacted]", message)
    message = re.sub(
        r"(?i)(?:authorization|proxy-authorization)\s*:[^\r\n]*", "[redacted]", message
    )
    message = re.sub(r"(?<![\w])(?:/[\w.~-]+)+(?:/[^\s\"'<>]*)?", "[redacted]", message)
    message = re.sub(r"_mcp_[a-z_]+(?:[0-9a-f]+)?", "[internal]", message)
    message = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", message).strip()
    return message[:4096] or type(error).__name__
