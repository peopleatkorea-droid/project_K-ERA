from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, update

from kera_research.config import BASE_DIR, BUILT_IN_SITE_ROOT_DIR, SITE_ROOT_DIR
from kera_research.db import CONTROL_PLANE_ENGINE, app_settings, institution_directory
from kera_research.domain import utc_now


class ControlPlaneInstanceStateFacade:
    def __init__(
        self,
        store: Any,
        *,
        instance_storage_root_setting_key: str,
        institution_directory_last_sync_setting_key: str,
    ) -> None:
        self.store = store
        self.instance_storage_root_setting_key = instance_storage_root_setting_key
        self.institution_directory_last_sync_setting_key = institution_directory_last_sync_setting_key

    def _resolve_storage_path(self, value: str | Path) -> Path:
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = (BASE_DIR / candidate).resolve()
        else:
            candidate = candidate.resolve()
        return candidate

    def built_in_instance_storage_root(self) -> Path:
        return BUILT_IN_SITE_ROOT_DIR.resolve()

    def default_instance_storage_root(self) -> Path:
        return self.built_in_instance_storage_root()

    def configured_default_instance_storage_root(self) -> Path:
        return SITE_ROOT_DIR.resolve()

    def get_app_setting(self, setting_key: str) -> str | None:
        normalized_key = setting_key.strip()
        if not normalized_key:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(app_settings.c.setting_value).where(app_settings.c.setting_key == normalized_key)
            ).first()
        if row is None:
            return None
        value = str(row[0] or "").strip()
        return value or None

    def set_app_setting(self, setting_key: str, setting_value: str) -> str:
        normalized_key = setting_key.strip()
        normalized_value = setting_value.strip()
        if not normalized_key:
            raise ValueError("Setting key is required.")
        if not normalized_value:
            raise ValueError("Setting value is required.")
        record = {
            "setting_key": normalized_key,
            "setting_value": normalized_value,
            "updated_at": utc_now(),
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            existing = conn.execute(
                select(app_settings.c.setting_key).where(app_settings.c.setting_key == normalized_key)
            ).first()
            if existing:
                conn.execute(
                    update(app_settings)
                    .where(app_settings.c.setting_key == normalized_key)
                    .values(**record)
                )
            else:
                conn.execute(app_settings.insert().values(**record))
        return normalized_value

    def institution_directory_sync_status(self) -> dict[str, Any]:
        raw = self.get_app_setting(self.institution_directory_last_sync_setting_key)
        if raw:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict):
                return {
                    "source": str(payload.get("source") or "hira"),
                    "pages_synced": int(payload["pages_synced"]) if payload.get("pages_synced") is not None else None,
                    "total_count": int(payload["total_count"]) if payload.get("total_count") is not None else None,
                    "institutions_synced": int(payload.get("institutions_synced") or 0),
                    "synced_at": str(payload.get("synced_at") or "").strip() or None,
                }

        with CONTROL_PLANE_ENGINE.begin() as conn:
            count_row = conn.execute(
                select(
                    func.count(institution_directory.c.institution_id),
                    func.max(institution_directory.c.synced_at),
                )
            ).first()
        institutions_synced = int(count_row[0] or 0) if count_row is not None else 0
        synced_at = str(count_row[1] or "").strip() if count_row is not None else ""
        return {
            "source": "hira",
            "pages_synced": None,
            "total_count": institutions_synced or None,
            "institutions_synced": institutions_synced,
            "synced_at": synced_at or None,
        }

    def instance_storage_root_source(self) -> str:
        built_in_root = str(self.built_in_instance_storage_root())
        configured_default_root = str(self.configured_default_instance_storage_root())
        configured = self.get_app_setting(self.instance_storage_root_setting_key)
        if configured:
            resolved_configured = str(self._resolve_storage_path(configured))
            if resolved_configured == built_in_root:
                return "built_in_default"
            if resolved_configured == configured_default_root and os.getenv("KERA_STORAGE_DIR", "").strip():
                return "environment_default"
            return "custom"
        if os.getenv("KERA_STORAGE_DIR", "").strip():
            return "environment_default"
        return "built_in_default"

    def instance_storage_root(self) -> str:
        configured = self.get_app_setting(self.instance_storage_root_setting_key)
        if configured:
            return str(self._resolve_storage_path(configured))
        return str(self.configured_default_instance_storage_root())

    def site_storage_root(self, site_id: str) -> str:
        site = self.store.get_site(site_id)
        configured = str(site.get("local_storage_root") or "").strip() if site else ""
        if configured:
            return str(self._resolve_storage_path(configured))
        return str(Path(self.instance_storage_root()) / site_id)
