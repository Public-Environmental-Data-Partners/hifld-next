import pytest

from app.query.sql_policy import SqlPolicy, SqlPolicyError
from tests.security.sql_policy_cases import (
    ALLOWED_CASES,
    DENIED_CASES,
    SqlPolicyCase,
)

ALIASES = frozenset({"roads", "hospitals", "Road Source"})


@pytest.mark.parametrize("case", ALLOWED_CASES, ids=lambda case: case.name)
def test_sql_policy_allows_safe_relational_queries(case: SqlPolicyCase) -> None:
    validated = SqlPolicy.validate(case.sql, ALIASES)

    assert validated.canonical_sql


@pytest.mark.parametrize("case", DENIED_CASES, ids=lambda case: case.name)
def test_sql_policy_denies_unsafe_queries(case: SqlPolicyCase) -> None:
    with pytest.raises(SqlPolicyError):
        SqlPolicy.validate(case.sql, ALIASES)


def test_sql_policy_canonicalizes_equivalent_sql_deterministically() -> None:
    compact = SqlPolicy.validate("select id,name from roads order by id", ALIASES)
    spaced = SqlPolicy.validate(" SELECT  id,  name\nFROM roads ORDER BY id ", ALIASES)

    assert compact.canonical_sql == spaced.canonical_sql
    assert compact.deterministic_order is True


def test_sql_policy_reports_missing_top_level_order_as_nondeterministic() -> None:
    validated = SqlPolicy.validate(
        "SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS row_number FROM roads",
        ALIASES,
    )

    assert validated.deterministic_order is False


def test_sql_policy_rejects_empty_input() -> None:
    with pytest.raises(SqlPolicyError):
        SqlPolicy.validate("", ALIASES)


def test_sql_policy_rejects_more_than_eight_kibibytes() -> None:
    oversized_sql = "SELECT '" + ("x" * 8_192) + "' FROM roads"

    with pytest.raises(SqlPolicyError):
        SqlPolicy.validate(oversized_sql, ALIASES)
