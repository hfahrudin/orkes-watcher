"""run final state

runs.final_state: the graph state when the run ended (run_end.final_state, optional
within contract 1.0). Existing runs stay NULL.

Revision ID: b7e2f4a91c3d
Revises: 8cb418ebdb59
Create Date: 2026-10-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'b7e2f4a91c3d'
down_revision: Union[str, None] = '8cb418ebdb59'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('final_state', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('runs', 'final_state')
