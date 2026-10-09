# Local SeaweedFS Storage

SeaweedFS is the supported local object-storage backend for HIFLD Next.

## Start Services

```bash
docker compose up -d seaweedfs-master seaweedfs-volume seaweedfs-filer
```

Endpoints:

- Filer HTTP API: `http://localhost:8888`
- S3-compatible API: `http://localhost:8333`

## Verify

```bash
cd dataset-mcp
HIFLD_TEST_SEAWEED_ENDPOINT=http://localhost:8333 \
HIFLD_TEST_SEAWEED_BUCKET=hifld-local-published \
HIFLD_TEST_SEAWEED_OBJECT=path/to/an/existing.parquet \
uv run pytest tests/integration/test_seaweedfs.py -v
```

Replace the object key with an existing published GeoParquet fixture. The test
reads two rows using request-scoped S3 credentials; it does not modify objects.
For conversion, promotion, catalog refresh, webapp and feature-server acceptance,
follow [the local Portolan workflow](local-portolan.md).
