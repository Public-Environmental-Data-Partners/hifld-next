from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, TokenError

MAX_SQL_BYTES = 8 * 1024

SAFE_SCALAR_FUNCTIONS = frozenset(
    {
        "ABS",
        "ACOS",
        "ARRAY_LENGTH",
        "ASCII",
        "ASIN",
        "ATAN",
        "ATAN2",
        "AVG",
        "BIT_COUNT",
        "BOOL_AND",
        "BOOL_OR",
        "CAST",
        "CEIL",
        "CHAR_LENGTH",
        "CHR",
        "COALESCE",
        "CONCAT",
        "CONCAT_WS",
        "CORR",
        "COS",
        "COUNT",
        "COVAR_POP",
        "COVAR_SAMP",
        "DATE_DIFF",
        "DATE_PART",
        "DATE_TRUNC",
        "DAY",
        "DEGREES",
        "DENSE_RANK",
        "EXP",
        "EXTRACT",
        "FIRST",
        "FIRST_VALUE",
        "FLOOR",
        "GREATEST",
        "HOUR",
        "IF",
        "IFNULL",
        "LAG",
        "LAST",
        "LAST_VALUE",
        "LEAD",
        "LEAST",
        "LEFT",
        "LENGTH",
        "LIST",
        "LN",
        "LOG",
        "LOG10",
        "LOWER",
        "LPAD",
        "LTRIM",
        "MAX",
        "MD5",
        "MIN",
        "MINUTE",
        "MOD",
        "MONTH",
        "NTH_VALUE",
        "NTILE",
        "NULLIF",
        "PERCENT_RANK",
        "PI",
        "POW",
        "POWER",
        "QUANTILE",
        "RADIANS",
        "RANK",
        "REGEXP_EXTRACT",
        "REGEXP_REPLACE",
        "REPLACE",
        "RIGHT",
        "ROUND",
        "ROW_NUMBER",
        "RPAD",
        "RTRIM",
        "SECOND",
        "SHA256",
        "SIGN",
        "SIN",
        "SQRT",
        "STRFTIME",
        "STRING_AGG",
        "STRPTIME",
        "SUBSTRING",
        "SUM",
        "TAN",
        "TRIM",
        "TRY_CAST",
        "TYPEOF",
        "UPPER",
        "VAR_POP",
        "VAR_SAMP",
        "WEEK",
        "YEAR",
    }
)

SAFE_SPATIAL_FUNCTIONS = frozenset(
    {
        "ST_AREA",
        "ST_ASGEOJSON",
        "ST_ASHEXEWKB",
        "ST_ASHEXWKB",
        "ST_ASWKB",
        "ST_BOUNDARY",
        "ST_BUFFER",
        "ST_CENTROID",
        "ST_CONTAINS",
        "ST_CONVEXHULL",
        "ST_COVEREDBY",
        "ST_COVERS",
        "ST_CROSSES",
        "ST_DIFFERENCE",
        "ST_DIMENSION",
        "ST_DISJOINT",
        "ST_DISTANCE",
        "ST_DISTANCE_SPHERE",
        "ST_ENVELOPE",
        "ST_EQUALS",
        "ST_EXTENT",
        "ST_FLIPCOORDINATES",
        "ST_FORCE2D",
        "ST_GEOMFROMGEOJSON",
        "ST_GEOMFROMHEXEWKB",
        "ST_GEOMFROMHEXWKB",
        "ST_GEOMFROMTEXT",
        "ST_GEOMFROMWKB",
        "ST_GEOMETRYTYPE",
        "ST_HASZ",
        "ST_INTERSECTION",
        "ST_INTERSECTS",
        "ST_ISVALID",
        "ST_LENGTH",
        "ST_MAKEENVELOPE",
        "ST_MAKEPOLYGON",
        "ST_NPOINTS",
        "ST_NUMGEOMETRIES",
        "ST_POINT",
        "ST_POINT2D",
        "ST_REDUCEPRECISION",
        "ST_SIMPLIFY",
        "ST_SIMPLIFYPRESERVETOPOLOGY",
        "ST_SRID",
        "ST_STARTPOINT",
        "ST_TOUCHES",
        "ST_TRANSFORM",
        "ST_UNION_AGG",
        "ST_WITHIN",
        "ST_X",
        "ST_XMAX",
        "ST_XMIN",
        "ST_Y",
        "ST_YMAX",
        "ST_YMIN",
    }
)

SAFE_FUNCTIONS = SAFE_SCALAR_FUNCTIONS | SAFE_SPATIAL_FUNCTIONS


class SqlPolicyError(ValueError):
    """Raised when SQL falls outside the public read-only query policy."""


@dataclass(frozen=True)
class ValidatedSql:
    canonical_sql: str
    deterministic_order: bool


class SqlPolicy:
    @staticmethod
    def validate(sql: str, aliases: frozenset[str]) -> ValidatedSql:
        if not sql.strip():
            raise SqlPolicyError("SQL must not be empty")
        if len(sql.encode("utf-8")) > MAX_SQL_BYTES:
            raise SqlPolicyError("SQL exceeds the 8 KiB limit")

        try:
            tokens = sqlglot.Tokenizer(dialect="duckdb").tokenize(sql)
            if any(token.comments for token in tokens):
                raise SqlPolicyError("SQL comments are not allowed")
            statements = sqlglot.parse(sql, read="duckdb")
        except (ParseError, TokenError) as exc:
            raise SqlPolicyError("SQL could not be parsed") from exc

        if len(statements) != 1 or statements[0] is None:
            raise SqlPolicyError("Exactly one SQL statement is required")

        statement = statements[0]
        if not isinstance(statement, exp.Select | exp.SetOperation):
            raise SqlPolicyError("Only SELECT queries are allowed")

        SqlPolicy._validate_tables(statement, aliases)
        SqlPolicy._validate_functions(statement)

        order = statement.find(exp.Order)
        deterministic_order = order is not None and order.parent is statement
        return ValidatedSql(
            canonical_sql=statement.sql(dialect="duckdb", pretty=False, comments=False),
            deterministic_order=deterministic_order,
        )

    @staticmethod
    def _validate_tables(statement: exp.Query, aliases: frozenset[str]) -> None:
        allowed_relations = {alias.casefold() for alias in aliases}
        cte_names = {cte.alias.casefold() for cte in statement.find_all(exp.CTE)}
        if allowed_relations.intersection(cte_names):
            raise SqlPolicyError("Source aliases must not collide with CTE names")
        allowed_relations.update(cte_names)

        for table in statement.find_all(exp.Table):
            if table.catalog or table.db:
                raise SqlPolicyError("Qualified catalog and schema names are not allowed")
            if not isinstance(table.this, exp.Identifier):
                raise SqlPolicyError("Table functions and path relations are not allowed")
            if table.name.casefold() not in allowed_relations:
                raise SqlPolicyError(f"Unknown source alias: {table.name}")

    @staticmethod
    def _validate_functions(statement: exp.Query) -> None:
        for function in statement.find_all(exp.Func):
            # sqlglot models boolean operators such as AND as Func subclasses,
            # even though they are SQL syntax rather than callable functions.
            if isinstance(function, exp.Binary):
                continue
            name = (
                function.name.upper()
                if isinstance(function, exp.Anonymous)
                else function.sql_name().upper()
            )
            if name not in SAFE_FUNCTIONS:
                raise SqlPolicyError(f"Function is not allowed: {name}")
