"""Acceptance coverage for the public SQL policy and dispatch boundary."""

import pytest
from sql_policy_cases import DENIED_CASES, SqlPolicyCase

from app.query.sql_policy import SqlPolicy, SqlPolicyError

ALIASES = frozenset({"roads", "hospitals", "Road Source"})


class RecordingDispatcher:
    """Tiny dispatch seam: validation must happen before work is started."""

    def __init__(self) -> None:
        self.calls = 0

    def dispatch(self, sql: str) -> None:
        SqlPolicy.validate(sql, ALIASES)
        self.calls += 1


@pytest.mark.parametrize("case", DENIED_CASES, ids=lambda case: case.name)
def test_denied_sql_is_rejected_before_dispatch(case: SqlPolicyCase) -> None:
    sql = case.sql
    dispatcher = RecordingDispatcher()

    with pytest.raises(SqlPolicyError):
        dispatcher.dispatch(sql)

    assert dispatcher.calls == 0


@pytest.mark.parametrize(
    "sql",
    (
        "SELECT * FROM roads WHERE id = 1",
        "SELECT r.id FROM roads AS r JOIN hospitals AS h ON r.id = h.id",
    ),
)
def test_allowed_read_query_reaches_dispatch(sql: str) -> None:
    dispatcher = RecordingDispatcher()
    dispatcher.dispatch(sql)
    assert dispatcher.calls == 1
