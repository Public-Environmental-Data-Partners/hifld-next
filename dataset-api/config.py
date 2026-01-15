"""Configuration module for dataset-api.

Loads environment variables from .env files with precedence:
1. .env.local (local development, not committed)
2. .env (default configuration, can be committed)
3. Environment variables
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Get the directory containing this file
BASE_DIR = Path(__file__).resolve().parent

# Load environment variables with precedence
# Only load .env files if DATABASE_URL is not already set (i.e., in production)
# This prevents .env files from overriding Cloud Run environment variables
if not os.getenv("DATABASE_URL"):
    load_dotenv(BASE_DIR / ".env")  # Load defaults first
    load_dotenv(BASE_DIR / ".env.local", override=True)  # Override with local settings


class Config:
    """API configuration - only includes settings needed by the FastAPI app."""

    # Database configuration
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./local.db")
    DATABASE_ECHO: bool = os.getenv("DATABASE_ECHO", "false").lower() == "true"

    @classmethod
    def is_sqlite(cls) -> bool:
        """Check if using SQLite database."""
        return "sqlite" in cls.DATABASE_URL.lower()

    @classmethod
    def is_postgres(cls) -> bool:
        """Check if using PostgreSQL database."""
        return "postgres" in cls.DATABASE_URL.lower()


class ScriptsConfig(Config):
    """Extended configuration for scripts - includes storage settings for dataset processing."""

    # Storage configuration (only needed for dataset processing scripts)
    STORAGE_TYPE: str = os.getenv("STORAGE_TYPE", "seaweedfs")
    SEAWEEDFS_FILER_URL: str = os.getenv("SEAWEEDFS_FILER_URL", "http://localhost:8888")
    SEAWEEDFS_BUCKET: str = os.getenv("SEAWEEDFS_BUCKET", "hifld")

    # GCS configuration (if using GCS storage)
    GCS_BUCKET: str | None = os.getenv("GCS_BUCKET")
    GCS_PROJECT: str | None = os.getenv("GCS_PROJECT")


# Create singleton instances
config = Config()
scripts_config = ScriptsConfig()
