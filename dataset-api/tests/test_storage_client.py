import asyncio
import os
import sys
import types
import uuid
from pathlib import Path

import httpx
import gcsfs
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from storage.storage_client import GCSStorageClient, SeaweedFSFilerClient


def test_seaweedfs_list_files_uses_filer_http_recursively(monkeypatch):
    payloads = {
        "/buckets/hifld/root/?limit=10000": {
            "Entries": [
                {
                    "FullPath": "/buckets/hifld/root/dataset",
                    "Mode": 2147484153,
                    "Mime": "",
                    "FileSize": 0,
                    "Md5": None,
                },
                {
                    "FullPath": "/buckets/hifld/root/top.json",
                    "Mode": 432,
                    "Mime": "application/json",
                    "FileSize": 2,
                    "Md5": "abc",
                },
            ]
        },
        "/buckets/hifld/root/dataset/?limit=10000": {
            "Entries": [
                {
                    "FullPath": "/buckets/hifld/root/dataset/file.parquet",
                    "Mode": 432,
                    "Mime": "application/x-parquet",
                    "FileSize": 10,
                    "Md5": "def",
                }
            ]
        },
    }
    requested_paths: list[str] = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers=None):
            request = httpx.Request("GET", url)
            requested_paths.append(request.url.raw_path.decode())
            return httpx.Response(
                200,
                json=payloads[request.url.raw_path.decode()],
                request=request,
            )

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    client = SeaweedFSFilerClient(
        filer_url="http://localhost:8888",
        bucket="hifld",
    )
    files = asyncio.run(client.list_files("root"))

    assert requested_paths == [
        "/buckets/hifld/root/?limit=10000",
        "/buckets/hifld/root/dataset/?limit=10000",
    ]
    assert files == [
        "root/dataset/file.parquet",
        "root/top.json",
    ]


def test_gcs_expand_glob_pattern_includes_nested_recursive_parquet(monkeypatch):
    class FakeBucket:
        pass

    class FakeStorageClient:
        def bucket(self, bucket_name):
            return FakeBucket()

    class FakeGoogleStorage:
        @staticmethod
        def Client(project=None):
            return FakeStorageClient()

    class FakeGCSFileSystem:
        def find(self, prefix, detail=False):
            assert (
                prefix
                == "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/"
            )
            assert detail is False
            return [
                "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=01/part-000.parquet",
                "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=02/part-000.parquet",
                "gs://hifld-next-datasets-prod/wbd/10-digit-hu-watershed/v1.0.0/geoparquet/_metadata",
            ]

    fake_cloud = types.SimpleNamespace(storage=FakeGoogleStorage)
    monkeypatch.setitem(sys.modules, "google", types.SimpleNamespace(cloud=fake_cloud))
    monkeypatch.setitem(sys.modules, "google.cloud", fake_cloud)
    monkeypatch.setitem(sys.modules, "google.cloud.storage", FakeGoogleStorage)
    monkeypatch.setattr(gcsfs, "GCSFileSystem", FakeGCSFileSystem)

    client = GCSStorageClient(bucket="hifld-next-datasets-prod")
    files = asyncio.run(
        client.expand_glob_pattern(
            "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet"
        )
    )

    assert files == [
        "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=01/part-000.parquet",
        "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=02/part-000.parquet",
    ]


def test_seaweedfs_expand_glob_pattern_uses_filer_listing(monkeypatch):
    async def fake_list_files(self, prefix):
        assert prefix == "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/"
        return [
            "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=01/part-000.parquet",
            "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=02/part-000.parquet",
            "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/_metadata",
        ]

    monkeypatch.setattr(SeaweedFSFilerClient, "list_files", fake_list_files)

    client = SeaweedFSFilerClient(
        filer_url="http://localhost:8888",
        s3_url="http://localhost:8333",
        bucket="drp-hifld-copy-formatted",
    )
    files = asyncio.run(
        client.expand_glob_pattern(
            "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/**/*.parquet"
        )
    )

    assert files == [
        "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=01/part-000.parquet",
        "wbd/10-digit-hu-watershed/v1.0.0/geoparquet/huc2=02/part-000.parquet",
    ]


@pytest.mark.skipif(
    os.getenv("HIFLD_RUN_SEAWEEDFS_INTEGRATION") != "1",
    reason="Set HIFLD_RUN_SEAWEEDFS_INTEGRATION=1 to test local SeaweedFS",
)
def test_seaweedfs_integration_round_trips_file_and_expands_glob(tmp_path):
    bucket = os.getenv("SEAWEEDFS_BUCKET", "hifld")
    client = SeaweedFSFilerClient(
        filer_url=os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888"),
        s3_url=os.getenv("SEAWEEDFS_S3_URL", "http://localhost:8333"),
        bucket=bucket,
    )
    prefix = f"codex-storage-test/{uuid.uuid4().hex}"
    remote_path = f"{prefix}/metadata/sample.json"
    local_file = tmp_path / "sample.json"
    downloaded_file = tmp_path / "downloaded.json"
    local_file.write_text('{"status":"ok"}', encoding="utf-8")

    async def scenario():
        try:
            public_url = await client.upload_file(
                local_file,
                remote_path,
                content_type="application/json",
            )

            assert public_url == f"{client.filer_url}/buckets/{bucket}/{remote_path}"
            assert client.path_to_storage_uri(remote_path) == (
                f"s3://{bucket}/{remote_path}?endpoint_url={client.s3_url}"
            )
            assert client.parse_url_to_path(public_url) == remote_path
            assert await client.file_exists(remote_path)
            assert await client.list_files(prefix) == [remote_path]
            assert await client.expand_glob_pattern(f"{prefix}/**/*.json") == [
                remote_path
            ]
            assert await client.get_file_size(remote_path) == len('{"status":"ok"}')

            await client.download_file(remote_path, downloaded_file)
            assert downloaded_file.read_text(encoding="utf-8") == '{"status":"ok"}'
        finally:
            await client.delete_file(remote_path)

    asyncio.run(scenario())
