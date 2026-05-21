"""Database connection and session management using SQLModel."""

import logging
import os
from collections.abc import Generator

from sqlmodel import SQLModel, Session, create_engine

from config import config
from models.dataset import (
    Collection,
    Dataset,
    File,
    FileFormat,
    FileSource,
    Format,
    StorageLocation,
)


REGISTERED_MODEL_TYPES = (
    Collection,
    Dataset,
    File,
    FileFormat,
    FileSource,
    Format,
    StorageLocation,
)

# Set up SQLAlchemy logging to show all database operations
# This helps debug unnecessary writes
# Defaults to disabled - set ENABLE_DB_DEBUG=true to enable
enable_echo = config.DATABASE_ECHO or os.getenv("ENABLE_DB_DEBUG", "false").lower() == "true"
if enable_echo:
    sqlalchemy_logger = logging.getLogger("sqlalchemy.engine")
    sqlalchemy_logger.setLevel(logging.INFO)  # Log all SQL statements
    sqlalchemy_pool_logger = logging.getLogger("sqlalchemy.pool")
    sqlalchemy_pool_logger.setLevel(logging.INFO)

# Get database URL from config
DATABASE_URL = config.DATABASE_URL

# Create engine with appropriate settings
if config.is_sqlite():
    engine = create_engine(
        DATABASE_URL,
        echo=enable_echo,  # Log all SQL queries when enabled
        connect_args={
            "check_same_thread": False,
            "timeout": 30.0,  # 30 second timeout for SQLite operations
        },
        pool_pre_ping=True,  # Verify connections before using
    )
else:
    # PostgreSQL with connection pooling
    engine = create_engine(
        DATABASE_URL,
        echo=enable_echo,  # Log all SQL queries when enabled
        pool_size=10,  # Increased from 5 to handle more concurrent requests
        max_overflow=20,  # Increased from 10
        pool_pre_ping=True,  # Verify connections before using
        pool_recycle=3600,  # Recycle connections after 1 hour
        connect_args={
            "connect_timeout": 10,  # 10 second connection timeout
            "options": "-c statement_timeout=30000",  # 30 second query timeout
        },
    )


def get_db() -> Generator[Session]:
    """Dependency for FastAPI to get database sessions."""
    db = Session(engine)
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db_session() -> Session:
    """Get a database session (caller must close it)."""
    return Session(engine)


def init_db() -> None:
    """Initialize database tables."""
    SQLModel.metadata.create_all(engine)
