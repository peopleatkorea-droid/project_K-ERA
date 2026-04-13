from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool

from kera_research.db import CONTROL_PLANE_DATABASE_URL, CONTROL_PLANE_METADATA

config = context.config
target_metadata = config.attributes.get("control_plane_metadata", CONTROL_PLANE_METADATA)


def _configured_url() -> str:
    return str(config.get_main_option("sqlalchemy.url") or CONTROL_PLANE_DATABASE_URL)


def run_migrations_offline() -> None:
    context.configure(
        url=_configured_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = engine_from_config(
        {"sqlalchemy.url": _configured_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        future=True,
    )
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
