import asyncio
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from storage.storage_client import SeaweedFSFilerClient


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
