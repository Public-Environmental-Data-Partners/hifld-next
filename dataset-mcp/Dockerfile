# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS ui-build
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci
COPY ui/ ./
RUN npm run build

FROM python:3.12-slim AS python-deps
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
ENV DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
RUN mkdir -p "${DUCKDB_EXTENSION_DIRECTORY}" \
 && /app/.venv/bin/python -c "import duckdb; c=duckdb.connect(); c.execute(\"SET extension_directory='${DUCKDB_EXTENSION_DIRECTORY}'\"); c.execute('INSTALL httpfs'); c.execute('INSTALL spatial'); c.close()"

FROM python:3.12-slim AS runtime
ENV PATH="/app/.venv/bin:${PATH}" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000 DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions DUCKDB_SPILL_DIRECTORY=/var/lib/dataset-mcp/spill
WORKDIR /app
COPY --from=python-deps /app/.venv /app/.venv
COPY --from=python-deps /opt/duckdb/extensions /opt/duckdb/extensions
COPY . .
COPY --from=ui-build /src/ui/dist ./ui/dist
RUN mkdir -p /var/lib/dataset-mcp/spill \
 && chown -R 65532:65532 /app /opt/duckdb /var/lib/dataset-mcp
USER 65532:65532
EXPOSE 8000
VOLUME ["/var/lib/dataset-mcp/spill"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
CMD ["uvicorn", "app.http_app:app", "--host", "0.0.0.0", "--port", "8000"]
