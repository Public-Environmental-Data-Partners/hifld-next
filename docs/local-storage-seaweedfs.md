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
cd dataset-api
HIFLD_RUN_SEAWEEDFS_INTEGRATION=1 uv run pytest tests/test_storage_client.py -v
```

The integration test uploads a JSON file, verifies listing/glob expansion, downloads it, checks the storage URI, and deletes the object.
