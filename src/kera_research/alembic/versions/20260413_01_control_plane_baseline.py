"""Control-plane Alembic baseline for the current schema.

This revision is intentionally a no-op. Existing databases are stamped to this
baseline after the current create_all + custom migration path has brought the
control-plane schema to the expected shape. Future control-plane schema changes
should be added as Alembic revisions on top of this baseline.
"""

from __future__ import annotations


revision = "20260413_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    raise RuntimeError("Control-plane baseline downgrade is not supported.")
