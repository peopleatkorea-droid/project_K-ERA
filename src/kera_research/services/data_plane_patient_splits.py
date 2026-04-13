from __future__ import annotations

from typing import Any


def _deps():
    from kera_research.services import data_plane as dp

    return dp


def load_patient_split(store: Any) -> dict[str, Any]:
    dp = _deps()
    query = dp.select(dp.site_patient_splits.c.split_json).where(
        dp.site_patient_splits.c.site_id == store.site_id
    )
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        row = conn.execute(query).first()
    return dict(row[0]) if row and row[0] else {}


def save_patient_split(store: Any, split_record: dict[str, Any]) -> dict[str, Any]:
    dp = _deps()
    record = {
        "site_id": store.site_id,
        "split_json": split_record,
        "updated_at": dp.utc_now(),
    }
    with dp.DATA_PLANE_ENGINE.begin() as conn:
        existing = conn.execute(
            dp.select(dp.site_patient_splits.c.site_id).where(
                dp.site_patient_splits.c.site_id == store.site_id
            )
        ).first()
        if existing:
            conn.execute(
                dp.update(dp.site_patient_splits)
                .where(dp.site_patient_splits.c.site_id == store.site_id)
                .values(**record)
            )
        else:
            conn.execute(dp.site_patient_splits.insert().values(**record))
    return split_record


def clear_patient_split(store: Any) -> None:
    save_patient_split(store, {})
