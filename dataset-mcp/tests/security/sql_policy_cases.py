from dataclasses import dataclass


@dataclass(frozen=True)
class SqlPolicyCase:
    name: str
    sql: str


ALLOWED_CASES = (
    SqlPolicyCase("simple select", "SELECT id, name FROM roads"),
    SqlPolicyCase(
        "join",
        "SELECT r.id, h.name FROM roads AS r JOIN hospitals AS h ON r.county = h.county",
    ),
    SqlPolicyCase(
        "cte and subquery",
        "WITH recent AS (SELECT id FROM roads WHERE year >= 2020) "
        "SELECT id FROM recent WHERE id IN (SELECT road_id FROM hospitals)",
    ),
    SqlPolicyCase(
        "union",
        "SELECT id FROM roads UNION ALL SELECT id FROM hospitals",
    ),
    SqlPolicyCase(
        "window aggregate grouping and ordering",
        "SELECT county, COUNT(*) AS total, ROW_NUMBER() OVER "
        "(ORDER BY COUNT(*) DESC) AS rank FROM roads GROUP BY county ORDER BY total DESC",
    ),
    SqlPolicyCase(
        "quoted alias",
        'SELECT "Road Source".id FROM "Road Source" ORDER BY "Road Source".id',
    ),
    SqlPolicyCase(
        "safe scalar functions",
        "SELECT COALESCE(LOWER(name), ''), ROUND(length, 2), CAST(year AS VARCHAR) FROM roads",
    ),
    SqlPolicyCase(
        "safe spatial functions",
        "SELECT ST_Area(geometry), ST_Intersects(geometry, ST_Point(-77, 39)) FROM roads",
    ),
)


DENIED_CASES = (
    SqlPolicyCase("create", "CREATE TABLE stolen AS SELECT * FROM roads"),
    SqlPolicyCase("insert", "INSERT INTO roads VALUES (1)"),
    SqlPolicyCase("update", "UPDATE roads SET name = 'x'"),
    SqlPolicyCase("delete", "DELETE FROM roads"),
    SqlPolicyCase("pragma", "PRAGMA version"),
    SqlPolicyCase("set", "SET memory_limit = '10GB'"),
    SqlPolicyCase("attach", "ATTACH 'other.db' AS other"),
    SqlPolicyCase("detach", "DETACH other"),
    SqlPolicyCase("copy", "COPY roads TO '/tmp/roads.csv'"),
    SqlPolicyCase("export", "EXPORT DATABASE '/tmp/export'"),
    SqlPolicyCase("import", "IMPORT DATABASE '/tmp/export'"),
    SqlPolicyCase("call", "CALL checkpoint()"),
    SqlPolicyCase("install", "INSTALL httpfs"),
    SqlPolicyCase("force install", "FORCE INSTALL httpfs"),
    SqlPolicyCase("load", "LOAD spatial"),
    SqlPolicyCase("secret", "CREATE SECRET s (TYPE S3, KEY_ID 'key')"),
    SqlPolicyCase("drop secret", "DROP SECRET s"),
    SqlPolicyCase("multiple statements", "SELECT * FROM roads; SELECT * FROM hospitals"),
    SqlPolicyCase("comment-hidden statement", "SELECT * FROM roads; -- hidden\nDROP TABLE roads"),
    SqlPolicyCase("qualified catalog", "SELECT * FROM memory.main.roads"),
    SqlPolicyCase("qualified schema", "SELECT * FROM main.roads"),
    SqlPolicyCase("direct path", "SELECT * FROM '/tmp/roads.parquet'"),
    SqlPolicyCase("read parquet", "SELECT * FROM read_parquet('/tmp/roads.parquet')"),
    SqlPolicyCase("parquet scan", "SELECT * FROM parquet_scan('s3://bucket/key')"),
    SqlPolicyCase("read csv auto", "SELECT * FROM read_csv_auto('https://example.test/a.csv')"),
    SqlPolicyCase("glob", "SELECT * FROM glob('/tmp/*')"),
    SqlPolicyCase("table function", "SELECT * FROM range(10)"),
    SqlPolicyCase("dynamic query", "SELECT query('SELECT * FROM roads')"),
    SqlPolicyCase("unknown function", "SELECT shell(name) FROM roads"),
    SqlPolicyCase("unknown alias", "SELECT * FROM airports"),
)
