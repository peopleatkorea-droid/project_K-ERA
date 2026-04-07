import io
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from kera_research.api.routes.site_shared import assert_site_access_only
from kera_research.domain import normalize_actual_visit_date, normalize_patient_pseudonym, normalize_visit_label


def build_site_imports_router(support: Any) -> APIRouter:
    router = APIRouter()

    get_control_plane = support.get_control_plane
    get_approved_user = support.get_approved_user
    require_admin_workspace_permission = support.require_admin_workspace_permission
    require_site_access = support.require_site_access
    user_can_access_site = support.user_can_access_site
    bool_from_value = support.bool_from_value
    coerce_text = support.coerce_text
    import_template_rows = support.import_template_rows

    @router.get("/api/sites/{site_id}/import/template.csv")
    def download_import_template(
        site_id: str,
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> Response:
        require_admin_workspace_permission(user)
        assert_site_access_only(user, site_id, user_can_access_site=user_can_access_site)
        template_csv = "\n".join(import_template_rows).encode("utf-8-sig")
        return Response(
            content=template_csv,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="kera_import_template.csv"'},
        )

    @router.post("/api/sites/{site_id}/import/bulk")
    async def bulk_import_site_data(
        site_id: str,
        csv_file: UploadFile = File(...),
        files: list[UploadFile] = File(default=[]),
        cp=Depends(get_control_plane),
        user: dict[str, Any] = Depends(get_approved_user),
    ) -> dict[str, Any]:
        require_admin_workspace_permission(user)
        site_store = require_site_access(cp, user, site_id)

        csv_name = (csv_file.filename or "").lower()
        if not csv_name.endswith(".csv"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bulk import requires a CSV metadata file.")

        csv_bytes = await csv_file.read()
        try:
            import_df = pd.read_csv(io.BytesIO(csv_bytes))
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unable to parse CSV: {exc}") from exc

        required_columns = [
            "patient_id",
            "sex",
            "age",
            "visit_date",
            "image_filename",
            "view",
        ]
        missing_columns = [column for column in required_columns if column not in import_df.columns]
        if missing_columns:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing columns: {', '.join(missing_columns)}",
            )

        image_bytes: dict[str, bytes] = {}
        image_sources: dict[str, str] = {}
        for upload in files:
            upload_name = Path(upload.filename or "").name
            if not upload_name:
                continue
            content = await upload.read()
            if upload_name.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(io.BytesIO(content)) as archive:
                        for member in archive.namelist():
                            if member.endswith("/"):
                                continue
                            image_name = Path(member).name
                            if not image_name or image_name.startswith(".") or ".." in member:
                                continue
                            image_bytes[image_name] = archive.read(member)
                            image_sources[image_name] = upload_name
                except zipfile.BadZipFile as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid ZIP archive: {upload_name}",
                    ) from exc
            else:
                image_bytes[upload_name] = content
                image_sources[upload_name] = upload_name

        import_df = import_df.where(pd.notnull(import_df), None)
        patient_cache = {item["patient_id"] for item in site_store.list_patients()}
        visit_cache = {(item["patient_id"], item["visit_date"]) for item in site_store.list_visits()}
        existing_images = site_store.list_images()
        image_cache: set[tuple[str, str, str]] = set()
        for item in existing_images:
            image_name = Path(str(item.get("image_path") or "")).name
            image_cache.add((item["patient_id"], item["visit_date"], image_name))

        imported_images = 0
        skipped_images = 0
        created_patients = 0
        created_visits = 0
        errors: list[str] = []

        for row_index, row in import_df.iterrows():
            try:
                patient_id = normalize_patient_pseudonym(coerce_text(row.get("patient_id")))
                visit_date = normalize_visit_label(coerce_text(row.get("visit_date")))
                actual_visit_date = normalize_actual_visit_date(coerce_text(row.get("actual_visit_date")))
                file_name = Path(coerce_text(row.get("image_filename"))).name
                if not patient_id or not visit_date or not file_name:
                    errors.append(f"Row {row_index + 2}: patient_id, visit_date, image_filename are required.")
                    skipped_images += 1
                    continue
                if file_name not in image_bytes:
                    errors.append(f"{file_name}: file not found in uploaded ZIP or image bundle.")
                    skipped_images += 1
                    continue

                if patient_id not in patient_cache:
                    site_store.create_patient(
                        patient_id=patient_id,
                        sex=coerce_text(row.get("sex"), "unknown") or "unknown",
                        age=int(float(row.get("age") or 0)),
                        chart_alias=coerce_text(row.get("chart_alias")),
                        local_case_code=coerce_text(row.get("local_case_code")),
                        created_by_user_id=user["user_id"],
                    )
                    patient_cache.add(patient_id)
                    created_patients += 1

                visit_key = (patient_id, visit_date)
                if visit_key not in visit_cache:
                    raw_factors = coerce_text(row.get("predisposing_factor"))
                    factors = [item.strip() for item in raw_factors.split("|") if item.strip()]
                    raw_culture_status = (
                        coerce_text(row.get("culture_status"))
                        .strip()
                        .lower()
                        .replace("-", "_")
                        .replace(" ", "_")
                    )
                    culture_confirmed = bool_from_value(row.get("culture_confirmed"), False)
                    if raw_culture_status not in {"positive", "negative", "not_done", "unknown"}:
                        raw_culture_status = "positive" if culture_confirmed else "unknown"
                    site_store.create_visit(
                        patient_id=patient_id,
                        visit_date=visit_date,
                        actual_visit_date=actual_visit_date,
                        culture_status=raw_culture_status,
                        culture_confirmed=culture_confirmed,
                        culture_category=coerce_text(row.get("culture_category")) or None,
                        culture_species=coerce_text(row.get("culture_species")) or None,
                        additional_organisms=[],
                        contact_lens_use=coerce_text(row.get("contact_lens_use"), "unknown") or "unknown",
                        predisposing_factor=factors,
                        other_history=coerce_text(row.get("other_history")),
                        visit_status=coerce_text(row.get("visit_status"), "active") or "active",
                        active_stage=bool_from_value(row.get("active_stage"), True),
                        smear_result=coerce_text(row.get("smear_result")),
                        polymicrobial=bool_from_value(row.get("polymicrobial"), False),
                        created_by_user_id=user["user_id"],
                    )
                    visit_cache.add(visit_key)
                    created_visits += 1

                if any(
                    cached_patient == patient_id
                    and cached_visit_date == visit_date
                    and cached_image_name.endswith(f"_{file_name}")
                    for cached_patient, cached_visit_date, cached_image_name in image_cache
                ):
                    skipped_images += 1
                    continue

                saved_image = site_store.add_image(
                    patient_id=patient_id,
                    visit_date=visit_date,
                    view=coerce_text(row.get("view"), "white") or "white",
                    is_representative=bool_from_value(row.get("is_representative"), False),
                    file_name=file_name,
                    content=image_bytes[file_name],
                    created_by_user_id=user["user_id"],
                )
                image_cache.add((patient_id, visit_date, Path(saved_image["image_path"]).name))
                imported_images += 1
            except Exception as exc:
                skipped_images += 1
                errors.append(f"Row {row_index + 2}: {exc}")

        return {
            "site_id": site_id,
            "rows_received": int(len(import_df.index)),
            "files_received": len(image_bytes),
            "created_patients": created_patients,
            "created_visits": created_visits,
            "imported_images": imported_images,
            "skipped_images": skipped_images,
            "errors": errors[:100],
            "file_sources": image_sources,
        }

    return router
