"""Utility to load JSON config files from local paths or storage URLs."""

import json
import os
from pathlib import Path
from typing import Any

import httpx

try:
    from google.cloud import storage
except ImportError:
    storage = None


def load_seaweedfs_config(config_path: str) -> Any:
    """Load JSON config from a SeaweedFS filer URL."""
    path = config_path[len("seaweedfs://") :]
    parts = path.split("/", 1)
    bucket_name = parts[0]
    object_path = parts[1] if len(parts) > 1 else ""
    filer_url = os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888").rstrip("/")
    url = f"{filer_url}/buckets/{bucket_name}/{object_path.lstrip('/')}"

    with httpx.Client(timeout=30.0) as client:
        response = client.get(url)
        response.raise_for_status()
        return json.loads(response.text)


def load_json_config(config_path: str) -> Any:
    """
    Load JSON config from a local file path, GCS URL, or SeaweedFS URL.
    
    Args:
        config_path: Local file path, gs://bucket/path, or seaweedfs://bucket/path
        
    Returns:
        Parsed JSON data
    """
    if config_path.startswith("gs://"):
        # Load from GCS
        if storage is None:
            raise ImportError(
                "google-cloud-storage is required for GCS URLs. "
                "Install with: pip install google-cloud-storage"
            )
        
        # Parse gs://bucket/path
        path = config_path[5:]  # Remove gs://
        parts = path.split("/", 1)
        bucket_name = parts[0]
        blob_path = parts[1] if len(parts) > 1 else ""
        
        # Initialize GCS client (uses default credentials)
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        
        # Download and parse JSON
        content = blob.download_as_text()
        return json.loads(content)
    elif config_path.startswith("seaweedfs://"):
        return load_seaweedfs_config(config_path)
    else:
        # Load from local file
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")
        
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
