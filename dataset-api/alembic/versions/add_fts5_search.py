"""Add FTS5 full-text search for datasets

Revision ID: add_fts5_search
Revises: 500128d4cf3a
Create Date: 2026-01-01 21:29:29.114000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_fts5_search'
down_revision: Union[str, None] = '500128d4cf3a'
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    """Create FTS5 virtual table and triggers for full-text search."""
    # Check if using SQLite (FTS5 is SQLite-specific)
    bind = op.get_bind()
    if "sqlite" in str(bind.engine.url):
        # Create FTS5 virtual table for dataset search
        # FTS5 requires explicit column definitions
        op.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS datasets_fts USING fts5(
                id UNINDEXED,
                name,
                alias,
                description,
                content='datasets',
                content_rowid='id'
            )
        """)
        
        # Populate FTS5 table with existing data
        op.execute("""
            INSERT INTO datasets_fts(id, name, alias, description)
            SELECT id, name, alias, COALESCE(description, '') FROM datasets
        """)
        
        # Create triggers to keep FTS5 in sync with datasets table
        op.execute("""
            CREATE TRIGGER IF NOT EXISTS datasets_fts_insert AFTER INSERT ON datasets BEGIN
                INSERT INTO datasets_fts(id, name, alias, description)
                VALUES (new.id, new.name, new.alias, COALESCE(new.description, ''));
            END
        """)
        
        op.execute("""
            CREATE TRIGGER IF NOT EXISTS datasets_fts_delete AFTER DELETE ON datasets BEGIN
                DELETE FROM datasets_fts WHERE id = old.id;
            END
        """)
        
        op.execute("""
            CREATE TRIGGER IF NOT EXISTS datasets_fts_update AFTER UPDATE ON datasets BEGIN
                DELETE FROM datasets_fts WHERE id = old.id;
                INSERT INTO datasets_fts(id, name, alias, description)
                VALUES (new.id, new.name, new.alias, COALESCE(new.description, ''));
            END
        """)


def downgrade() -> None:
    """Remove FTS5 table and triggers."""
    bind = op.get_bind()
    if "sqlite" in str(bind.engine.url):
        op.execute("DROP TRIGGER IF EXISTS datasets_fts_update")
        op.execute("DROP TRIGGER IF EXISTS datasets_fts_delete")
        op.execute("DROP TRIGGER IF EXISTS datasets_fts_insert")
        op.execute("DROP TABLE IF EXISTS datasets_fts")

