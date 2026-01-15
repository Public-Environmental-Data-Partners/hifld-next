"""Utility to load JSON config files from local paths or GCS URLs."""

import json
import os
from pathlib import Path
from typing import Any

try:
    from google.cloud import storage
except ImportError:
    storage = None


def load_json_config(config_path: str) -> Any:
    """
    Load JSON config from a local file path or GCS URL (gs://bucket/path).
    
    Args:
        config_path: Local file path or GCS URL (gs://bucket/path)
        
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
    else:
        # Load from local file
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")
        
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

