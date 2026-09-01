"""Auto-discovered local development application for ``fastapi dev``."""

from fastapi import FastAPI

from app.development import development_settings, local_seaweedfs_credentials
from app.production import create_production_app

app: FastAPI = create_production_app(
    development_settings(),
    install_extensions=True,
    seaweedfs_credentials=local_seaweedfs_credentials(),
)
