'''Add per-user Google Calendar OAuth connections.'''

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = '20260825_0016'
down_revision = '20260823_0015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if not inspector.has_table('google_calendar_connections'):
        op.create_table(
            'google_calendar_connections',
            sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id'), primary_key=True),
            sa.Column('user_id', sa.String(36), primary_key=True),
            sa.Column('calendar_id', sa.String(255), nullable=False, server_default='primary'),
            sa.Column('encrypted_refresh_token', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        )
    if not inspector.has_table('google_calendar_oauth_states'):
        op.create_table(
            'google_calendar_oauth_states',
            sa.Column('id', sa.String(64), primary_key=True),
            sa.Column('workspace_id', sa.String(36), sa.ForeignKey('workspaces.id'), nullable=False),
            sa.Column('user_id', sa.String(36), nullable=False),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index(
            'ix_google_calendar_oauth_states_workspace_id',
            'google_calendar_oauth_states',
            ['workspace_id'],
        )


def downgrade() -> None:
    op.drop_index(
        'ix_google_calendar_oauth_states_workspace_id',
        table_name='google_calendar_oauth_states',
    )
    op.drop_table('google_calendar_oauth_states')
    op.drop_table('google_calendar_connections')
