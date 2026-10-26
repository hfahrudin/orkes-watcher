"""orkes contract 1.0

New run fields from the orkes trace contract (working_context/INTEGRATION_AGREEMENT.md),
the per-project abandoned-run timeout, and node_stats re-keyed from node_id to node_name
(orkes node_ids change on every graph build). Existing node_stats rows with the same
name are merged by summing their counters.

Revision ID: 9d53cdca8361
Revises: ffdfd6a9592f
Create Date: 2026-10-26 10:54:48.273946

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9d53cdca8361'
down_revision: Union[str, None] = 'ffdfd6a9592f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _rekey_node_stats(new_key="node_name")
    op.add_column('projects', sa.Column('abandon_after_minutes', sa.Integer(), server_default='30', nullable=False))
    op.add_column('runs', sa.Column('failed_node', sa.String(), nullable=True))
    op.add_column('runs', sa.Column('graph_description', sa.Text(), nullable=True))
    op.add_column('runs', sa.Column('graph_nodes', postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column('runs', sa.Column('contract_version', sa.String(), nullable=True))
    op.add_column('runs', sa.Column('sdk_version', sa.String(), nullable=True))
    op.add_column('runs', sa.Column('last_event_at', sa.DateTime(timezone=True), nullable=True))
    # ### end Alembic commands ###


def downgrade() -> None:
    op.drop_column('runs', 'last_event_at')
    op.drop_column('runs', 'sdk_version')
    op.drop_column('runs', 'contract_version')
    op.drop_column('runs', 'graph_nodes')
    op.drop_column('runs', 'graph_description')
    op.drop_column('runs', 'failed_node')
    op.drop_column('projects', 'abandon_after_minutes')
    _rekey_node_stats(new_key="node_id")


def _rekey_node_stats(new_key: str) -> None:
    """Rebuilds node_stats with a (project_id, <new_key>) primary key. Upgrading merges rows
    that share a node_name; downgrading uses node_name as the restored node_id."""
    key_cols = [sa.Column("node_name", sa.String(), nullable=False)]
    if new_key == "node_id":
        key_cols.insert(0, sa.Column("node_id", sa.String(), nullable=False))
    op.create_table(
        "node_stats_new",
        sa.Column("project_id", sa.UUID(), nullable=False),
        *key_cols,
        sa.Column("run_count", sa.BigInteger(), nullable=False),
        sa.Column("visit_count", sa.BigInteger(), nullable=False),
        sa.Column("total_duration_us", sa.BigInteger(), nullable=False),
        sa.Column("last_updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], name="node_stats_new_project_id_fkey", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", new_key, name="node_stats_new_pkey"),
    )
    id_select = "node_name, " if new_key == "node_id" else ""
    id_insert = "node_id, " if new_key == "node_id" else ""
    op.execute(
        f"""
        INSERT INTO node_stats_new (project_id, {id_insert}node_name, run_count, visit_count, total_duration_us, last_updated_at)
        SELECT project_id, {id_select}node_name, SUM(run_count), SUM(visit_count), SUM(total_duration_us), MAX(last_updated_at)
        FROM node_stats GROUP BY project_id, node_name
        """
    )
    op.drop_table("node_stats")
    op.rename_table("node_stats_new", "node_stats")
    op.execute("ALTER TABLE node_stats RENAME CONSTRAINT node_stats_new_pkey TO node_stats_pkey")
    op.execute("ALTER TABLE node_stats RENAME CONSTRAINT node_stats_new_project_id_fkey TO node_stats_project_id_fkey")
