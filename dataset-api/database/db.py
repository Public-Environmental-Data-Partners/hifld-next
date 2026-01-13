"""Database connection and session management using SQLModel."""

from sqlmodel import SQLModel, create_engine, Session
from config import config

# Get database URL from config
DATABASE_URL = config.DATABASE_URL

# Create engine with appropriate settings
engine = create_engine(
    DATABASE_URL,
    echo=config.DATABASE_ECHO,
    connect_args={"check_same_thread": False} if config.is_sqlite() else {},
    # PostgreSQL connection pooling settings
    pool_size=5 if config.is_postgres() else None,
    max_overflow=10 if config.is_postgres() else None,
    pool_pre_ping=True if config.is_postgres() else False,
)


def get_db():
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


def init_db():
    """Initialize database tables."""
    from models.dataset import (  # noqa: F401
        Collection,
        Dataset,
        DatasetFormat,
        DatasetSource,
        StorageLocation,
    )

    SQLModel.metadata.create_all(engine)
