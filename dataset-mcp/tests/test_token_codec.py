import base64
import hashlib
import hmac
import json
import zlib
from datetime import UTC, datetime, timedelta

import pytest

from app.catalog.models import QuerySourceRef
from app.query.models import QueryTokenPayload
from app.query.token_codec import QueryTokenCodec, QueryTokenError

SECRET = b"a-test-secret-with-at-least-32-bytes"
NOW = datetime(2033, 5, 18, 3, 33, 20, tzinfo=UTC)


def source(alias: str = "roads", source_id: int = 4) -> QuerySourceRef:
    return QuerySourceRef(
        alias=alias,
        collection_id=1,
        dataset_id=2,
        file_id=3,
        file_source_id=source_id,
    )


def payload(
    *,
    token_version: int = 1,
    canonical_sql: str = "SELECT id FROM roads ORDER BY id",
    sources: tuple[QuerySourceRef, ...] | None = None,
    geometry_column: str | None = None,
    result_crs: str | None = None,
    issued_at: datetime = NOW,
    expires_at: datetime = NOW + timedelta(hours=2),
) -> QueryTokenPayload:
    return QueryTokenPayload(
        token_version=token_version,
        canonical_sql=canonical_sql,
        sources=sources if sources is not None else (source(),),
        geometry_column=geometry_column,
        result_crs=result_crs,
        issued_at=issued_at,
        expires_at=expires_at,
    )


def encode_raw(data: bytes) -> str:
    compressed = zlib.compress(data)
    signature = hmac.digest(SECRET, compressed, "sha256")
    return base64.urlsafe_b64encode(compressed + signature).rstrip(b"=").decode("ascii")


def test_token_encoding_is_deterministic_and_round_trips() -> None:
    codec = QueryTokenCodec(SECRET)

    first = codec.encode(payload())
    second = codec.encode(payload())

    assert first == second
    assert codec.decode(first, now=NOW) == payload()
    raw = base64.urlsafe_b64decode(first + "=" * (-len(first) % 4))
    decoded = json.loads(zlib.decompress(raw[: -hashlib.sha256().digest_size]))
    assert decoded["token_version"] == 1
    assert decoded["issued_at"] == int(NOW.timestamp())


def test_token_rejects_signature_mutation() -> None:
    codec = QueryTokenCodec(SECRET)
    token = codec.encode(payload())
    replacement = "A" if token[-1] != "A" else "B"

    with pytest.raises(QueryTokenError):
        codec.decode(token[:-1] + replacement, now=NOW)


def test_token_rejects_authenticated_payload_mutation() -> None:
    codec = QueryTokenCodec(SECRET)
    token = codec.encode(payload())
    raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    compressed = bytearray(raw[: -hashlib.sha256().digest_size])
    compressed[-1] ^= 1
    forged = base64.urlsafe_b64encode(bytes(compressed) + raw[-32:]).rstrip(b"=").decode()

    with pytest.raises(QueryTokenError):
        codec.decode(forged, now=NOW)


def test_token_expiry_boundary_is_rejected() -> None:
    codec = QueryTokenCodec(SECRET)
    token = codec.encode(payload())

    assert codec.decode(token, now=NOW + timedelta(seconds=7_199)).expires_at == NOW + timedelta(
        hours=2
    )
    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW + timedelta(hours=2))


def test_token_rejects_future_issue_time() -> None:
    codec = QueryTokenCodec(SECRET)
    token = codec.encode(payload(issued_at=NOW + timedelta(seconds=1)))

    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_rejects_unsupported_version() -> None:
    codec = QueryTokenCodec(SECRET)
    token = codec.encode(payload(token_version=2))

    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_rejects_invalid_base64_and_malformed_compression() -> None:
    codec = QueryTokenCodec(SECRET)

    with pytest.raises(QueryTokenError):
        codec.decode("not+base64", now=NOW)
    malformed = b"not zlib data"
    signed = malformed + hmac.digest(SECRET, malformed, "sha256")
    token = base64.urlsafe_b64encode(signed).rstrip(b"=").decode()
    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_rejects_decoded_payload_over_64_kibibytes() -> None:
    codec = QueryTokenCodec(SECRET)
    data = b'{"padding":"' + (b"x" * 65_536) + b'"}'

    with pytest.raises(QueryTokenError):
        codec.decode(encode_raw(data), now=NOW)


def test_token_rejects_decompression_bomb() -> None:
    codec = QueryTokenCodec(SECRET)
    bomb = b"x" * 1_000_000

    with pytest.raises(QueryTokenError):
        codec.decode(encode_raw(bomb), now=NOW)


def test_token_rejects_more_than_eight_sources() -> None:
    codec = QueryTokenCodec(SECRET)
    data = json.loads(payload().model_dump_json())
    data["issued_at"] = int(NOW.timestamp())
    data["expires_at"] = int((NOW + timedelta(hours=2)).timestamp())
    data["sources"] = [
        source(alias=f"source_{index}", source_id=index + 1).model_dump() for index in range(9)
    ]
    token = encode_raw(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())

    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_rejects_encoded_token_over_eight_kibibytes() -> None:
    codec = QueryTokenCodec(SECRET)
    token = "A" * 8_193

    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_encode_rejects_encoded_token_over_eight_kibibytes() -> None:
    codec = QueryTokenCodec(SECRET)
    randomish = "".join(hashlib.sha256(str(index).encode()).hexdigest() for index in range(500))

    with pytest.raises(QueryTokenError):
        codec.encode(payload(result_crs=randomish))


def test_token_encode_rejects_decoded_payload_over_64_kibibytes() -> None:
    codec = QueryTokenCodec(SECRET)

    with pytest.raises(QueryTokenError):
        codec.encode(payload(result_crs="EPSG:" + ("0" * 65_536)))


def test_token_rejects_authenticated_unsafe_sql() -> None:
    codec = QueryTokenCodec(SECRET)
    data = json.loads(payload().model_dump_json())
    data["canonical_sql"] = "SELECT * FROM read_parquet('/tmp/stolen.parquet')"
    data["issued_at"] = int(NOW.timestamp())
    data["expires_at"] = int((NOW + timedelta(hours=2)).timestamp())
    token = encode_raw(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())

    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_rejects_lifetime_longer_than_two_hours() -> None:
    codec = QueryTokenCodec(SECRET)
    token = codec.encode(payload(expires_at=NOW + timedelta(hours=2, seconds=1)))

    with pytest.raises(QueryTokenError):
        codec.decode(token, now=NOW)


def test_token_codec_requires_a_256_bit_secret() -> None:
    with pytest.raises(ValueError):
        QueryTokenCodec(b"short")


def test_token_payload_has_no_physical_data_fields() -> None:
    fields = set(QueryTokenPayload.model_fields)

    assert fields.isdisjoint({"url", "urls", "credentials", "rows", "objects"})
