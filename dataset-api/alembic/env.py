from logging.config import fileConfig
import sys
from pathlib import Path

from sqlalchemy import engine_from_config, pool, text
from alembic import context

# Add the parent directory to the path so we can import our models
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Import database configuration
from config import config
from database.db import engine
from sqlmodel import SQLModel

DATABASE_URL = config.DATABASE_URL

# Import all models so Alembic can detect them
from models.dataset import (  # noqa: F401
    Collection,
    Dataset,
    DatasetFormat,
    DatasetSource,
    StorageLocation,
)

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Override sqlalchemy.url with our database URL from environment
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target_metadata for autogenerate support
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # Use our existing engine if it's SQLite, otherwise create from config
    if "sqlite" in DATABASE_URL:
        connectable = engine
    else:
        connectable = engine_from_config(
            config.get_section(config.config_ini_section, {}),
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        )

    with connectable.connect() as connection:
        # Enable foreign keys for SQLite
        if "sqlite" in DATABASE_URL:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.commit()

        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
