import base64
import binascii
import hmac
import json
import zlib
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.catalog.models import QuerySourceRef
from app.query.models import QueryTokenPayload
from app.query.sql_policy import SqlPolicy, SqlPolicyError

TOKEN_VERSION = 1
MAX_TOKEN_BYTES = 8 * 1024
MAX_DECODED_BYTES = 64 * 1024
MAX_SOURCES = 8
MAX_LIFETIME_SECONDS = 2 * 60 * 60
SIGNATURE_BYTES = 32
MIN_SECRET_BYTES = 32


class QueryTokenError(ValueError):
    """Raised when a query token fails authentication or validation."""


class _TokenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class _EncodedSource(_TokenModel):
    alias: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
    collection_id: int = Field(gt=0)
    dataset_id: int = Field(gt=0)
    file_id: int = Field(gt=0)
    file_source_id: int = Field(gt=0)


class _EncodedPayload(_TokenModel):
    token_version: int
    canonical_sql: str
    sources: tuple[_EncodedSource, ...] = Field(min_length=1, max_length=MAX_SOURCES)
    geometry_column: str | None
    result_crs: str | None
    query_id: str = Field(pattern=r"^[A-Za-z0-9_-]{20,64}$")
    issued_at: int
    expires_at: int


class QueryTokenCodec:
    def __init__(self, secret: bytes) -> None:
        if len(secret) < MIN_SECRET_BYTES:
            raise ValueError("Query-token secret must contain at least 32 bytes")
        self._secret = secret

    def encode(self, payload: QueryTokenPayload) -> str:
        data = {
            "canonical_sql": payload.canonical_sql,
            "expires_at": _unix_seconds(payload.expires_at),
            "geometry_column": payload.geometry_column,
            "issued_at": _unix_seconds(payload.issued_at),
            "result_crs": payload.result_crs,
            "query_id": payload.query_id,
            "sources": [
                {
                    "alias": source.alias,
                    "collection_id": source.collection_id,
                    "dataset_id": source.dataset_id,
                    "file_id": source.file_id,
                    "file_source_id": source.file_source_id,
                }
                for source in payload.sources
            ],
            "token_version": payload.token_version,
        }
        serialized = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(serialized) > MAX_DECODED_BYTES:
            raise QueryTokenError("Query token payload exceeds the decoded size limit")
        compressed = zlib.compress(serialized)
        signature = hmac.digest(self._secret, compressed, "sha256")
        token = base64.urlsafe_b64encode(compressed + signature).rstrip(b"=")
        if len(token) > MAX_TOKEN_BYTES:
            raise QueryTokenError("Query token exceeds the 8 KiB limit")
        return token.decode("ascii")

    def decode(self, token: str, *, now: datetime | None = None) -> QueryTokenPayload:
        compressed = self._authenticate(token)
        serialized = _decompress_bounded(compressed)

        try:
            encoded = _EncodedPayload.model_validate_json(serialized)
        except ValidationError as exc:
            raise QueryTokenError("Query token payload is invalid") from exc

        current_time = _unix_seconds(now if now is not None else datetime.now(UTC))
        if encoded.token_version != TOKEN_VERSION:
            raise QueryTokenError("Query token version is unsupported")
        if encoded.issued_at > current_time:
            raise QueryTokenError("Query token issue time is in the future")
        if encoded.expires_at <= current_time:
            raise QueryTokenError("Query token has expired")
        lifetime = encoded.expires_at - encoded.issued_at
        if lifetime <= 0 or lifetime > MAX_LIFETIME_SECONDS:
            raise QueryTokenError("Query token lifetime is invalid")

        sources = tuple(
            QuerySourceRef(
                alias=source.alias,
                collection_id=source.collection_id,
                dataset_id=source.dataset_id,
                file_id=source.file_id,
                file_source_id=source.file_source_id,
            )
            for source in encoded.sources
        )
        if len({source.alias.casefold() for source in sources}) != len(sources):
            raise QueryTokenError("Query token source aliases must be unique")

        aliases = frozenset(source.alias for source in sources)
        try:
            validated = SqlPolicy.validate(encoded.canonical_sql, aliases)
        except SqlPolicyError as exc:
            raise QueryTokenError("Query token SQL is invalid") from exc
        if validated.canonical_sql != encoded.canonical_sql:
            raise QueryTokenError("Query token SQL is not canonical")

        return QueryTokenPayload(
            token_version=encoded.token_version,
            canonical_sql=encoded.canonical_sql,
            sources=sources,
            geometry_column=encoded.geometry_column,
            result_crs=encoded.result_crs,
            query_id=encoded.query_id,
            issued_at=datetime.fromtimestamp(encoded.issued_at, UTC),
            expires_at=datetime.fromtimestamp(encoded.expires_at, UTC),
        )

    def _authenticate(self, token: str) -> bytes:
        try:
            encoded = token.encode("ascii")
        except UnicodeEncodeError as exc:
            raise QueryTokenError("Query token encoding is invalid") from exc
        if not encoded or len(encoded) > MAX_TOKEN_BYTES or b"=" in encoded:
            raise QueryTokenError("Query token size or encoding is invalid")

        padding = b"=" * (-len(encoded) % 4)
        try:
            signed = base64.b64decode(encoded + padding, altchars=b"-_", validate=True)
        except (binascii.Error, ValueError) as exc:
            raise QueryTokenError("Query token encoding is invalid") from exc
        canonical_encoding = base64.urlsafe_b64encode(signed).rstrip(b"=")
        if not hmac.compare_digest(encoded, canonical_encoding):
            raise QueryTokenError("Query token encoding is not canonical")
        if len(signed) <= SIGNATURE_BYTES or len(signed) > MAX_DECODED_BYTES:
            raise QueryTokenError("Query token decoded size is invalid")

        compressed = signed[:-SIGNATURE_BYTES]
        supplied_signature = signed[-SIGNATURE_BYTES:]
        expected_signature = hmac.digest(self._secret, compressed, "sha256")
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise QueryTokenError("Query token signature is invalid")
        return compressed


def _decompress_bounded(compressed: bytes) -> bytes:
    decompressor = zlib.decompressobj()
    try:
        serialized = decompressor.decompress(compressed, MAX_DECODED_BYTES + 1)
        if len(serialized) > MAX_DECODED_BYTES or decompressor.unconsumed_tail:
            raise QueryTokenError("Query token payload exceeds the decoded size limit")
        serialized += decompressor.flush(MAX_DECODED_BYTES + 1 - len(serialized))
    except zlib.error as exc:
        raise QueryTokenError("Query token compression is invalid") from exc
    if len(serialized) > MAX_DECODED_BYTES or not decompressor.eof or decompressor.unused_data:
        raise QueryTokenError("Query token compression or decoded size is invalid")
    return serialized


def _unix_seconds(value: datetime) -> int:
    if value.tzinfo is None or value.utcoffset() is None:
        raise QueryTokenError("Query token timestamps must include a timezone")
    return int(value.timestamp())
