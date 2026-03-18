from __future__ import annotations

from typing import Any, Callable

from sqlalchemy import and_, delete, select, update

from kera_research.config import DEFAULT_USERS
from kera_research.db import CONTROL_PLANE_ENGINE, organism_catalog, users
from kera_research.domain import CULTURE_SPECIES


class ControlPlaneSeedingFacade:
    def __init__(self, *, normalize_password_storage: Callable[[str], str]) -> None:
        self.normalize_password_storage = normalize_password_storage

    def seed_defaults(self) -> None:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing_users = {row.username for row in conn.execute(select(users.c.username))}
            for user_record in DEFAULT_USERS:
                if user_record["username"] not in existing_users:
                    conn.execute(users.insert().values(**user_record))

            existing_password_rows = conn.execute(select(users.c.user_id, users.c.password)).all()
            for user_id, stored_password in existing_password_rows:
                normalized_password = self.normalize_password_storage(str(stored_password or ""))
                if normalized_password != str(stored_password or ""):
                    conn.execute(
                        update(users)
                        .where(users.c.user_id == user_id)
                        .values(password=normalized_password)
                    )

            conn.execute(
                update(users)
                .where(and_(users.c.role != "admin", users.c.site_ids.is_(None)))
                .values(site_ids=[])
            )
            conn.execute(
                update(users)
                .where(users.c.registry_consents.is_(None))
                .values(registry_consents={})
            )

            conn.execute(
                delete(organism_catalog).where(
                    and_(
                        organism_catalog.c.culture_category == "bacterial",
                        organism_catalog.c.species_name == "Moraxella spp",
                    )
                )
            )

            existing_catalog = {
                (row.culture_category, row.species_name)
                for row in conn.execute(select(organism_catalog.c.culture_category, organism_catalog.c.species_name))
            }
            for category, species_list in CULTURE_SPECIES.items():
                for species_name in species_list:
                    if (category, species_name) in existing_catalog:
                        continue
                    conn.execute(
                        organism_catalog.insert().values(
                            culture_category=category,
                            species_name=species_name,
                        )
                    )
