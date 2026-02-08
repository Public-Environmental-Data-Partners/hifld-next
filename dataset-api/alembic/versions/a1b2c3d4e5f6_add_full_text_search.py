"""add_full_text_search

Revision ID: a1b2c3d4e5f6
Revises: 28b71e5cfc45
Create Date: 2026-01-15 15:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "c18943b5892e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add full-text search support for both PostgreSQL and SQLite."""
    bind = op.get_bind()
    dialect_name = bind.dialect.name

    if dialect_name == "postgresql":
        # PostgreSQL: Use tsvector for full-text search
        # Add tsvector column for full-text search
        op.execute(
            """
            ALTER TABLE datasets 
            ADD COLUMN IF NOT EXISTS search_vector tsvector
        """
        )

        # Create GIN index for fast full-text search
        op.execute(
            """
            CREATE INDEX IF NOT EXISTS datasets_search_vector_idx 
            ON datasets USING GIN (search_vector)
        """
        )

        # Create function to update search_vector
        # Includes slug, name, tags (as text), and description
        op.execute(
            """
            CREATE OR REPLACE FUNCTION datasets_update_search_vector() RETURNS trigger AS $$
            BEGIN
                NEW.search_vector := 
                    setweight(to_tsvector('english', COALESCE(NEW.slug, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(NEW.tags::text, '')), 'A') ||
                    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B');
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        """
        )

        # Create trigger to automatically update search_vector
        op.execute(
            """
            DROP TRIGGER IF EXISTS datasets_search_vector_update ON datasets;
            CREATE TRIGGER datasets_search_vector_update
            BEFORE INSERT OR UPDATE ON datasets
            FOR EACH ROW
            EXECUTE FUNCTION datasets_update_search_vector();
        """
        )

        # Populate search_vector for existing rows
        op.execute(
            """
            UPDATE datasets 
            SET search_vector = 
                setweight(to_tsvector('english', COALESCE(slug, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(tags::text, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(description, '')), 'B');
        """
        )
    else:
        # SQLite: Use FTS5 for full-text search
        # Create FTS5 virtual table for full-text search on datasets
        op.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS datasets_fts USING fts5(
                slug,
                name, 
                tags,
                description,
                content='datasets',
                content_rowid='id'
            )
        """
        )

        # Populate FTS table with existing data
        # Extract tags as space-separated string from JSON object
        op.execute(
            """
            INSERT INTO datasets_fts(rowid, slug, name, tags, description)
            SELECT id, COALESCE(slug, ''), name, 
                   CASE 
                     WHEN tags IS NOT NULL THEN 
                       (SELECT GROUP_CONCAT(value, ' ') 
                        FROM json_each(tags))
                     ELSE ''
                   END,
                   COALESCE(description, '')
            FROM datasets
        """
        )

        # Create triggers to keep FTS table in sync with datasets table
        # Trigger for INSERT
        op.execute(
            """
            CREATE TRIGGER IF NOT EXISTS datasets_fts_insert AFTER INSERT ON datasets BEGIN
                INSERT INTO datasets_fts(rowid, slug, name, tags, description)
                VALUES (
                    new.id, 
                    COALESCE(new.slug, ''),
                    new.name, 
                    CASE 
                      WHEN new.tags IS NOT NULL THEN 
                        (SELECT GROUP_CONCAT(value, ' ') FROM json_each(new.tags))
                      ELSE ''
                    END,
                    COALESCE(new.description, '')
                );
            END
        """
        )

        # Trigger for UPDATE
        op.execute(
            """
            CREATE TRIGGER IF NOT EXISTS datasets_fts_update AFTER UPDATE ON datasets BEGIN
                UPDATE datasets_fts 
                SET slug = COALESCE(new.slug, ''),
                    name = new.name, 
                    tags = CASE 
                             WHEN new.tags IS NOT NULL THEN 
                               (SELECT GROUP_CONCAT(value, ' ') FROM json_each(new.tags))
                             ELSE ''
                           END,
                    description = COALESCE(new.description, '')
                WHERE rowid = new.id;
            END
        """
        )

        # Trigger for DELETE
        op.execute(
            """
            CREATE TRIGGER IF NOT EXISTS datasets_fts_delete AFTER DELETE ON datasets BEGIN
                DELETE FROM datasets_fts WHERE rowid = old.id;
            END
        """
        )


def downgrade() -> None:
    """Remove full-text search support."""
    bind = op.get_bind()
    dialect_name = bind.dialect.name

    if dialect_name == "postgresql":
        # Drop PostgreSQL full-text search
        op.execute("DROP TRIGGER IF EXISTS datasets_search_vector_update ON datasets")
        op.execute("DROP FUNCTION IF EXISTS datasets_update_search_vector()")
        op.execute("DROP INDEX IF EXISTS datasets_search_vector_idx")
        op.execute("ALTER TABLE datasets DROP COLUMN IF EXISTS search_vector")
    else:
        # Drop SQLite FTS5 full-text search
        op.execute("DROP TRIGGER IF EXISTS datasets_fts_delete")
        op.execute("DROP TRIGGER IF EXISTS datasets_fts_update")
        op.execute("DROP TRIGGER IF EXISTS datasets_fts_insert")
        op.execute("DROP TABLE IF EXISTS datasets_fts")
