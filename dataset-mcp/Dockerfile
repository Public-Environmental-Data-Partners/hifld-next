# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS ui-build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/map-core/package.json ./packages/map-core/
COPY packages/map-ui/package.json ./packages/map-ui/
COPY dataset-mcp/ui/package.json ./dataset-mcp/ui/
COPY webapp/package.json ./webapp/
RUN npm ci
COPY packages/map-core ./packages/map-core
COPY packages/map-ui ./packages/map-ui
COPY dataset-mcp/ui ./dataset-mcp/ui
RUN npm run --workspace @hifld/dataset-mcp-ui build

FROM python:3.12-slim AS python-deps
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY dataset-mcp/pyproject.toml dataset-mcp/uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
ENV PATH="/app/.venv/bin:${PATH}" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000
WORKDIR /app
COPY --from=python-deps /app/.venv /app/.venv
COPY dataset-mcp/ .
COPY --from=ui-build /workspace/dataset-mcp/ui/dist ./ui/dist
RUN chown -R 65532:65532 /app
USER 65532:65532
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"
CMD ["uvicorn", "app.http_app:app", "--host", "0.0.0.0", "--port", "8000"]
