# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS dependencies
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY feature-server/pyproject.toml feature-server/uv.lock ./
RUN uv sync --frozen --no-dev \
 && mkdir -p "$DUCKDB_EXTENSION_DIRECTORY" \
 && .venv/bin/python -c "import duckdb; c=duckdb.connect(); c.execute(\"SET extension_directory='$DUCKDB_EXTENSION_DIRECTORY'\"); c.execute('INSTALL httpfs'); c.execute('INSTALL spatial'); c.close()"

FROM python:3.12-slim
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions FEATURE_SERVER_TEMP_DIRECTORY=/var/lib/feature-server/spill
WORKDIR /app
COPY --from=dependencies /app/.venv /app/.venv
COPY --from=dependencies /opt/duckdb/extensions /opt/duckdb/extensions
COPY feature-server/ .
RUN mkdir -p /var/lib/feature-server/spill && chown -R 65532:65532 /app /opt/duckdb /var/lib/feature-server
USER 65532:65532
EXPOSE 8000
VOLUME ["/var/lib/feature-server/spill"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000"]
