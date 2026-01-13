"""add_version_to_dataset_sources

Revision ID: 500128d4cf3a
Revises: 9358346313b3
Create Date: 2026-01-01 20:46:31.848534

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '500128d4cf3a'
down_revision: Union[str, Sequence[str], None] = '9358346313b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite doesn't support ALTER TABLE for constraints, so use batch mode
    with op.batch_alter_table('dataset_sources', schema=None) as batch_op:
        # Add version column with default value 1
        batch_op.add_column(
            sa.Column('version', sa.Integer(), nullable=False, server_default='1')
        )
        
        # Add unique constraint on (dataset_format_id, storage_location_id, version)
        batch_op.create_unique_constraint(
            'uq_source_version',
            ['dataset_format_id', 'storage_location_id', 'version']
        )
    
    # Set all existing records to version 1 (explicitly, though default should handle it)
    op.execute("UPDATE dataset_sources SET version = 1 WHERE version IS NULL OR version = 0")


def downgrade() -> None:
    """Downgrade schema."""
    # SQLite doesn't support ALTER TABLE for constraints, so use batch mode
    with op.batch_alter_table('dataset_sources', schema=None) as batch_op:
        # Drop the unique constraint
        batch_op.drop_constraint('uq_source_version', type_='unique')
        
        # Drop the version column
        batch_op.drop_column('version')
