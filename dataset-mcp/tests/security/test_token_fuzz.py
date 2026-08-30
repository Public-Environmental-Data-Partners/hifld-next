"""Small deterministic mutation corpus for query-token authentication."""

import base64
from datetime import UTC, datetime, timedelta

import pytest

from app.catalog.models import QuerySourceRef
from app.query.models import QueryTokenPayload
from app.query.token_codec import QueryTokenCodec, QueryTokenError

SECRET = b"a-test-secret-with-at-least-32-bytes"
NOW = datetime(2033, 5, 18, 3, 33, 20, tzinfo=UTC)


def _token() -> str:
    payload = QueryTokenPayload(
        canonical_sql="SELECT id FROM roads ORDER BY id",
        sources=(
            QuerySourceRef(
                alias="roads", collection_id=1, dataset_id=2, file_id=3, file_source_id=4
            ),
        ),
        issued_at=NOW,
        expires_at=NOW + timedelta(hours=2),
    )
    return QueryTokenCodec(SECRET).encode(payload)


@pytest.mark.parametrize("mutation", ("truncate", "flip", "junk", "padding"))
def test_token_mutations_are_rejected_without_partial_acceptance(mutation: str) -> None:
    token = _token()
    if mutation == "truncate":
        candidate = token[:-7]
    elif mutation == "flip":
        index = len(token) // 2
        replacement = "A" if token[index] != "A" else "B"
        candidate = token[:index] + replacement + token[index + 1 :]
    elif mutation == "junk":
        candidate = token + "!"
    else:
        candidate = token + "="

    with pytest.raises(QueryTokenError):
        QueryTokenCodec(SECRET).decode(candidate, now=NOW)


def test_token_with_valid_encoding_but_wrong_secret_is_rejected() -> None:
    token = _token()
    # Ensure this remains an authenticated mutation rather than a malformed token.
    base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    with pytest.raises(QueryTokenError):
        QueryTokenCodec(b"a-different-secret-with-at-least-32-bytes").decode(token, now=NOW)
