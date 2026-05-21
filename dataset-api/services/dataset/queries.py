"""Dataset catalog query helpers."""

import logging
from dataclasses import dataclass
from typing import Generic, TypeVar

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlmodel import Session, col, func, or_, select
from sqlmodel.sql.expression import SelectOfScalar

from models.dataset import Dataset


logger = logging.getLogger(__name__)

MAX_SEARCH_QUERY_LENGTH = 500
QueryRow = TypeVar("QueryRow", Dataset, int)


@dataclass(frozen=True)
class DatasetQuery(Generic[QueryRow]):
    """A dataset SQL statement and whether it can return rows."""

    statement: SelectOfScalar[QueryRow]
    has_matches: bool = True


def normalized_search_query(search: str | None) -> str | None:
    """Normalize and truncate a user-provided search query."""
    if not search or not search.strip():
        return None
    search_query = search.strip()
    if len(search_query) > MAX_SEARCH_QUERY_LENGTH:
        logger.warning("Search query too long (%s chars), truncating", len(search_query))
        return search_query[:MAX_SEARCH_QUERY_LENGTH]
    return search_query


def dataset_list_query(
    db: Session,
    search: str | None,
    collection_id: int | None,
    tag_filters: dict[str, str | list[str]] | None,
) -> DatasetQuery[Dataset]:
    """Build a dataset-listing query."""
    search_query = normalized_search_query(search)
    if search_query:
        query = _search_dataset_query(db, search_query, collection_id)
    else:
        query = DatasetQuery(_base_dataset_statement(collection_id))
    if not query.has_matches:
        return query
    return DatasetQuery(_apply_tag_filters(query.statement, db, tag_filters), has_matches=True)


def dataset_count_query(
    db: Session,
    search: str | None,
    collection_id: int | None,
    tag_filters: dict[str, str | list[str]] | None,
) -> DatasetQuery[int]:
    """Build a dataset-count query."""
    search_query = normalized_search_query(search)
    if search_query:
        query = _search_dataset_count_query(db, search_query, collection_id)
    else:
        query = DatasetQuery(_base_dataset_count_statement(collection_id))
    if not query.has_matches:
        return query
    return DatasetQuery(_apply_tag_filters(query.statement, db, tag_filters), has_matches=True)


def should_order_by_name(db: Session, search: str | None) -> bool:
    """Return whether a listing query should use default name ordering."""
    return not (normalized_search_query(search) and _dialect_name(db) == "postgresql")


def _dialect_name(db: Session) -> str:
    bind = db.get_bind()
    return bind.dialect.name


def _base_dataset_statement(collection_id: int | None) -> SelectOfScalar[Dataset]:
    statement = select(Dataset)
    return _apply_collection_filter(statement, collection_id)


def _base_dataset_count_statement(collection_id: int | None) -> SelectOfScalar[int]:
    statement = select(func.count(col(Dataset.id)))
    return _apply_collection_filter(statement, collection_id)


def _apply_collection_filter(
    statement: SelectOfScalar[QueryRow], collection_id: int | None
) -> SelectOfScalar[QueryRow]:
    if collection_id is None:
        return statement
    return statement.where(col(Dataset.collection_id) == collection_id)


def _search_dataset_query(db: Session, search_query: str, collection_id: int | None) -> DatasetQuery[Dataset]:
    if _dialect_name(db) == "postgresql":
        return _postgres_dataset_query(search_query, collection_id)
    return _sqlite_dataset_query(db, search_query, collection_id)


def _search_dataset_count_query(db: Session, search_query: str, collection_id: int | None) -> DatasetQuery[int]:
    if _dialect_name(db) == "postgresql":
        return _postgres_dataset_count_query(search_query, collection_id)
    return _sqlite_dataset_count_query(db, search_query, collection_id)


def _postgres_terms(search_query: str) -> str | None:
    ts_queries = [term if term.startswith('"') and term.endswith('"') else f"{term}:*" for term in search_query.split()]
    ts_query = " & ".join(ts_queries)
    return ts_query.strip() or None


def _sqlite_terms(search_query: str) -> str | None:
    fts_queries = [term if term.startswith('"') and term.endswith('"') else f"{term}*" for term in search_query.split()]
    fts_query = " AND ".join(fts_queries)
    return fts_query.strip() or None


def _postgres_dataset_query(search_query: str, collection_id: int | None) -> DatasetQuery[Dataset]:
    ts_query = _postgres_terms(search_query)
    if not ts_query:
        return DatasetQuery(_postgres_like_dataset_statement(search_query, collection_id), has_matches=True)
    query_param = sa.bindparam("query", ts_query)
    try:
        statement = select(Dataset).where(
            sa.text("search_vector @@ to_tsquery('english', :query)").bindparams(query_param)
        )
        statement = _apply_collection_filter(statement, collection_id)
        statement = statement.order_by(
            sa.text("ts_rank(search_vector, to_tsquery('english', :query)) DESC").bindparams(query_param)
        )
    except Exception as exc:
        logger.warning("PostgreSQL tsvector query failed, falling back to LIKE: %s", exc)
        statement = _postgres_like_dataset_statement(search_query, collection_id)
    return DatasetQuery(statement, has_matches=True)


def _postgres_dataset_count_query(search_query: str, collection_id: int | None) -> DatasetQuery[int]:
    ts_query = _postgres_terms(search_query)
    if not ts_query:
        return DatasetQuery(_postgres_like_dataset_count_statement(search_query, collection_id), has_matches=True)
    query_param = sa.bindparam("query", ts_query)
    try:
        statement = select(func.count(col(Dataset.id))).where(
            sa.text("search_vector @@ to_tsquery('english', :query)").bindparams(query_param)
        )
        statement = _apply_collection_filter(statement, collection_id)
    except Exception as exc:
        logger.warning("PostgreSQL tsvector count query failed, falling back to LIKE: %s", exc)
        statement = _postgres_like_dataset_count_statement(search_query, collection_id)
    return DatasetQuery(statement, has_matches=True)


def _sqlite_dataset_query(db: Session, search_query: str, collection_id: int | None) -> DatasetQuery[Dataset]:
    matching_ids = _sqlite_matching_dataset_ids(db, search_query, ordered=True)
    if matching_ids is None:
        statement = _sqlite_like_dataset_statement(search_query, collection_id)
        return DatasetQuery(statement, has_matches=True)
    if not matching_ids:
        return DatasetQuery(_base_dataset_statement(collection_id), has_matches=False)
    statement = select(Dataset).where(col(Dataset.id).in_(matching_ids))
    return DatasetQuery(_apply_collection_filter(statement, collection_id), has_matches=True)


def _sqlite_dataset_count_query(db: Session, search_query: str, collection_id: int | None) -> DatasetQuery[int]:
    matching_ids = _sqlite_matching_dataset_ids(db, search_query, ordered=False)
    if matching_ids is None:
        statement = _sqlite_like_dataset_count_statement(search_query, collection_id)
        return DatasetQuery(statement, has_matches=True)
    if not matching_ids:
        return DatasetQuery(_base_dataset_count_statement(collection_id), has_matches=False)
    statement = select(func.count(col(Dataset.id))).where(col(Dataset.id).in_(matching_ids))
    return DatasetQuery(_apply_collection_filter(statement, collection_id), has_matches=True)


def _sqlite_matching_dataset_ids(db: Session, search_query: str, *, ordered: bool) -> list[int] | None:
    fts_query = _sqlite_terms(search_query)
    if not fts_query:
        return None
    order_clause = "ORDER BY rank" if ordered else ""
    fts_statement = sa.text(
        f"""
        SELECT id FROM datasets_fts
        WHERE datasets_fts MATCH :query
        {order_clause}
        """
    )
    try:
        fts_result = db.execute(fts_statement.bindparams(query=fts_query))
    except Exception as exc:
        logger.warning("FTS5 query failed, falling back to LIKE: %s", exc)
        return None
    return [row[0] for row in fts_result]


def _postgres_like_dataset_statement(search_query: str, collection_id: int | None) -> SelectOfScalar[Dataset]:
    statement = _postgres_like_statement(select(Dataset), search_query)
    return _apply_collection_filter(statement, collection_id)


def _postgres_like_dataset_count_statement(search_query: str, collection_id: int | None) -> SelectOfScalar[int]:
    statement = _postgres_like_statement(select(func.count(col(Dataset.id))), search_query)
    return _apply_collection_filter(statement, collection_id)


def _sqlite_like_dataset_statement(search_query: str, collection_id: int | None) -> SelectOfScalar[Dataset]:
    statement = _sqlite_like_statement(select(Dataset), search_query)
    return _apply_collection_filter(statement, collection_id)


def _sqlite_like_dataset_count_statement(search_query: str, collection_id: int | None) -> SelectOfScalar[int]:
    statement = _sqlite_like_statement(select(func.count(col(Dataset.id))), search_query)
    return _apply_collection_filter(statement, collection_id)


def _postgres_like_statement(statement: SelectOfScalar[QueryRow], search_query: str) -> SelectOfScalar[QueryRow]:
    search_pattern = f"%{search_query}%"
    return statement.where(
        or_(
            col(Dataset.name).ilike(search_pattern),
            col(Dataset.description).ilike(search_pattern),
            sa.text("tags::text ILIKE :pattern"),
        )
    ).params(pattern=search_pattern)


def _sqlite_like_statement(statement: SelectOfScalar[QueryRow], search_query: str) -> SelectOfScalar[QueryRow]:
    search_pattern = f"%{search_query}%"
    return statement.where(
        or_(
            col(Dataset.name).like(search_pattern),
            col(Dataset.description).like(search_pattern),
            sa.text("tags LIKE :pattern"),
        )
    ).params(pattern=search_pattern)


def _apply_tag_filters(
    statement: SelectOfScalar[QueryRow],
    db: Session,
    tag_filters: dict[str, str | list[str]] | None,
) -> SelectOfScalar[QueryRow]:
    if not tag_filters:
        return statement
    dialect_name = _dialect_name(db)
    for tag_key, tag_value in tag_filters.items():
        filter_values = _normalized_tag_values(tag_value)
        if not filter_values:
            continue
        if dialect_name == "postgresql":
            statement = _apply_postgres_tag_filter(statement, tag_key, filter_values)
        else:
            statement = _apply_sqlite_tag_filter(statement, tag_key, filter_values)
    return statement


def _normalized_tag_values(tag_value: str | list[str] | None) -> list[str]:
    if tag_value is None:
        return []
    values = tag_value if isinstance(tag_value, list) else [tag_value]
    return [str(value) for value in values if value is not None]


def _apply_postgres_tag_filter(
    statement: SelectOfScalar[QueryRow], tag_key: str, filter_values: list[str]
) -> SelectOfScalar[QueryRow]:
    tags_jsonb = sa.cast(col(Dataset.tags), postgresql.JSONB)
    conditions = []
    for value in filter_values:
        key_literal = sa.literal(tag_key)
        conditions.append(
            sa.or_(
                tags_jsonb.op("->>")(key_literal) == value,
                tags_jsonb.op("->")(key_literal).op("@>")(sa.cast([value], postgresql.JSONB)),
            )
        )
    if not conditions:
        return statement
    return statement.where(or_(*conditions))


def _apply_sqlite_tag_filter(
    statement: SelectOfScalar[QueryRow], tag_key: str, filter_values: list[str]
) -> SelectOfScalar[QueryRow]:
    conditions = []
    key_path = f"$.{tag_key}"
    for idx, value in enumerate(filter_values):
        conditions.append(
            sa.or_(
                sa.text(f"json_extract(tags, :key_path_{idx}) = :tag_val_{idx}").params(
                    **{f"key_path_{idx}": key_path, f"tag_val_{idx}": value}
                ),
                sa.text(f"tags LIKE :tag_like_{idx}").params(**{f"tag_like_{idx}": f'%"{value}"%'}),
            )
        )
    if not conditions:
        return statement
    return statement.where(or_(*conditions))
