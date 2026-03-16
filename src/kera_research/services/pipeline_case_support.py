from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageOps

from kera_research.services.artifacts import CORNEA_CROP_STYLE, LESION_CROP_STYLE
from kera_research.services.data_plane import SiteStore
from kera_research.services.quality import score_slit_lamp_image
from kera_research.storage import ensure_dir, write_json

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchCaseSupport:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _crop_metadata_dir(self, site_store: SiteStore, crop_mode: str) -> Path:
        return ensure_dir(site_store.artifact_dir / f"{crop_mode}_preview_meta")

    def _lesion_prompt_box_signature(self, lesion_prompt_box: dict[str, Any] | None) -> str | None:
        if not isinstance(lesion_prompt_box, dict):
            return None
        normalized = {
            key: round(float(lesion_prompt_box[key]), 6)
            for key in ("x0", "y0", "x1", "y1")
            if key in lesion_prompt_box
        }
        if len(normalized) != 4:
            return None
        payload = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]

    def _load_cached_crop(
        self,
        *,
        metadata_path: Path,
        mask_path: Path,
        crop_path: Path,
        mask_key: str = "medsam_mask_path",
        crop_key: str = "roi_crop_path",
        expected_backend: str | None = None,
        expected_crop_style: str | None = None,
        expected_prompt_signature: str | None = None,
    ) -> dict[str, Any] | None:
        if not (crop_path.exists() and mask_path.exists() and metadata_path.exists()):
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        backend = str(metadata.get("backend") or "").strip() or "unknown"
        crop_style = str(metadata.get("crop_style") or "").strip()
        if backend == "unknown" or backend.startswith("fallback_after_medsam_error"):
            return None
        normalized_expected_backend = str(expected_backend or "").strip().lower()
        if normalized_expected_backend and backend.startswith("external_") and normalized_expected_backend not in backend.lower():
            return None
        if expected_crop_style and crop_style != expected_crop_style:
            return None
        if expected_prompt_signature is not None and metadata.get("prompt_signature") != expected_prompt_signature:
            return None
        return {
            mask_key: str(mask_path),
            crop_key: str(crop_path),
            "backend": backend,
            "crop_style": crop_style or None,
            "medsam_error": metadata.get("medsam_error"),
            "prompt_signature": metadata.get("prompt_signature"),
        }

    def _save_crop_metadata(
        self,
        metadata_path: Path,
        result: dict[str, Any],
        *,
        crop_style: str,
        prompt_signature: str | None = None,
    ) -> None:
        write_json(
            metadata_path,
            {
                "backend": result.get("backend", "unknown"),
                "crop_style": crop_style,
                "medsam_error": result.get("medsam_error"),
                "prompt_signature": prompt_signature,
            },
        )

    def _ensure_roi_crop(self, site_store: SiteStore, image_path: str) -> dict[str, Any]:
        artifact_name = Path(image_path).stem
        mask_path = site_store.medsam_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.roi_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = self._crop_metadata_dir(site_store, "roi")
        metadata_path = metadata_dir / f"{artifact_name}.json"
        cached = self._load_cached_crop(
            metadata_path=metadata_path,
            mask_path=mask_path,
            crop_path=crop_path,
            expected_backend=self.service.medsam_service.backend,
            expected_crop_style=CORNEA_CROP_STYLE,
        )
        if cached:
            return cached
        result = self.service.medsam_service.generate_roi(image_path, mask_path, crop_path)
        self._save_crop_metadata(metadata_path, result, crop_style=CORNEA_CROP_STYLE)
        return {
            "medsam_mask_path": result["medsam_mask_path"],
            "roi_crop_path": result["roi_crop_path"],
            "backend": result.get("backend", "unknown"),
            "crop_style": CORNEA_CROP_STYLE,
            "medsam_error": result.get("medsam_error"),
        }

    def _pixel_prompt_box(self, image_path: str, lesion_prompt_box: dict[str, Any]) -> list[float]:
        required_keys = ("x0", "y0", "x1", "y1")
        if not all(key in lesion_prompt_box for key in required_keys):
            raise ValueError("Lesion prompt box is incomplete.")
        with Image.open(image_path) as image:
            normalized = ImageOps.exif_transpose(image)
            width, height = normalized.size
        x0 = min(max(float(lesion_prompt_box["x0"]), 0.0), 1.0)
        y0 = min(max(float(lesion_prompt_box["y0"]), 0.0), 1.0)
        x1 = min(max(float(lesion_prompt_box["x1"]), 0.0), 1.0)
        y1 = min(max(float(lesion_prompt_box["y1"]), 0.0), 1.0)
        if x1 <= x0 or y1 <= y0:
            raise ValueError("Lesion prompt box is invalid.")
        return [x0 * width, y0 * height, x1 * width, y1 * height]

    def _ensure_lesion_crop(
        self,
        site_store: SiteStore,
        record: dict[str, Any],
        expand_ratio: float = 2.5,
        lesion_prompt_box: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        lesion_prompt_box = lesion_prompt_box if lesion_prompt_box is not None else record.get("lesion_prompt_box")
        if not isinstance(lesion_prompt_box, dict):
            raise ValueError("Representative image for this case requires a saved lesion box.")
        prompt_signature = self._lesion_prompt_box_signature(lesion_prompt_box)
        artifact_name = Path(record["image_path"]).stem
        mask_path = site_store.lesion_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.lesion_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = self._crop_metadata_dir(site_store, "lesion")
        metadata_path = metadata_dir / f"{artifact_name}.json"
        cached = self._load_cached_crop(
            metadata_path=metadata_path,
            mask_path=mask_path,
            crop_path=crop_path,
            mask_key="lesion_mask_path",
            crop_key="lesion_crop_path",
            expected_backend=self.service.medsam_service.backend,
            expected_crop_style=LESION_CROP_STYLE,
            expected_prompt_signature=prompt_signature,
        )
        if cached:
            return cached
        prompt_box = self._pixel_prompt_box(record["image_path"], lesion_prompt_box)
        result = self.service.medsam_service.generate_lesion_roi(
            record["image_path"],
            mask_path,
            crop_path,
            prompt_box=prompt_box,
            expand_ratio=expand_ratio,
        )
        self._save_crop_metadata(
            metadata_path,
            result,
            crop_style=LESION_CROP_STYLE,
            prompt_signature=prompt_signature,
        )
        return {
            "lesion_mask_path": result["medsam_mask_path"],
            "lesion_crop_path": result["roi_crop_path"],
            "backend": result.get("backend", "unknown"),
            "crop_style": LESION_CROP_STYLE,
            "medsam_error": result.get("medsam_error"),
            "prompt_signature": prompt_signature,
        }

    def _prepare_records_for_model(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        crop_mode: str,
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        normalized_crop_mode = self.service._normalize_crop_mode(crop_mode)
        if normalized_crop_mode == "manual":
            records = [record for record in records if isinstance(record.get("lesion_prompt_box"), dict)]
            if not records:
                raise ValueError("Manual lesion crop requires at least one saved lesion box.")

        for record in records:
            item = {**record, "source_image_path": record["image_path"]}
            if normalized_crop_mode == "automated":
                roi = self._ensure_roi_crop(site_store, record["image_path"])
                item["medsam_mask_path"] = roi["medsam_mask_path"]
                item["roi_crop_path"] = roi["roi_crop_path"]
                item["image_path"] = roi["roi_crop_path"]
                item["crop_mode"] = "automated"
            elif normalized_crop_mode == "manual":
                lesion = self._ensure_lesion_crop(site_store, record)
                item["lesion_mask_path"] = lesion["lesion_mask_path"]
                item["lesion_crop_path"] = lesion["lesion_crop_path"]
                item["image_path"] = lesion["lesion_crop_path"]
                item["crop_mode"] = "manual"
            prepared.append(item)
        return prepared

    def _select_representative_record(self, records: list[dict[str, Any]]) -> dict[str, Any]:
        representative = next((item for item in records if item.get("is_representative")), None)
        return representative or records[0]

    def _normalize_metadata_text(self, value: Any) -> str:
        return str(value or "").strip().lower()

    def _normalize_predisposing_factors(self, value: Any) -> list[str]:
        if isinstance(value, list):
            raw_items = value
        else:
            raw_items = str(value or "").split("|")
        normalized = [str(item).strip().lower() for item in raw_items if str(item).strip()]
        seen: set[str] = set()
        ordered: list[str] = []
        for item in normalized:
            if item in seen:
                continue
            seen.add(item)
            ordered.append(item)
        return ordered

    def _representative_quality_scores(
        self,
        representative_record: dict[str, Any],
        quality_cache: dict[str, dict[str, Any] | None],
    ) -> dict[str, Any] | None:
        image_path = str(representative_record.get("image_path") or "").strip()
        if not image_path:
            return None
        if image_path not in quality_cache:
            try:
                quality_cache[image_path] = score_slit_lamp_image(
                    image_path,
                    view=representative_record.get("view"),
                )
            except Exception:
                quality_cache[image_path] = None
        return quality_cache[image_path]

    def _case_metadata_snapshot(
        self,
        summary: dict[str, Any],
        case_records: list[dict[str, Any]],
        quality_cache: dict[str, dict[str, Any] | None],
    ) -> dict[str, Any]:
        representative = self._select_representative_record(case_records)
        quality_scores = self._representative_quality_scores(representative, quality_cache)
        predisposing = self._normalize_predisposing_factors(
            summary.get("predisposing_factor")
            if summary.get("predisposing_factor") is not None
            else representative.get("predisposing_factor")
        )
        return {
            "sex": str(summary.get("sex") or representative.get("sex") or "").strip(),
            "age": summary.get("age"),
            "representative_view": str(
                summary.get("representative_view")
                or representative.get("view")
                or ""
            ).strip(),
            "visit_status": str(summary.get("visit_status") or representative.get("visit_status") or "").strip(),
            "active_stage": bool(
                summary.get("active_stage")
                if summary.get("active_stage") is not None
                else representative.get("active_stage", str(summary.get("visit_status") or "").strip().lower() == "active")
            ),
            "is_initial_visit": bool(summary.get("is_initial_visit", representative.get("is_initial_visit", False))),
            "contact_lens_use": str(summary.get("contact_lens_use") or representative.get("contact_lens_use") or "").strip(),
            "predisposing_factor": predisposing,
            "smear_result": str(summary.get("smear_result") or representative.get("smear_result") or "").strip(),
            "polymicrobial": bool(summary.get("polymicrobial", representative.get("polymicrobial", False))),
            "additional_organisms": list(summary.get("additional_organisms") or representative.get("additional_organisms") or []),
            "other_history": str(summary.get("other_history") or representative.get("other_history") or "").strip(),
            "image_count": int(summary.get("image_count") or len(case_records)),
            "quality_score": quality_scores.get("quality_score") if quality_scores else None,
            "view_score": quality_scores.get("view_score") if quality_scores else None,
        }

    def _metadata_alignment(
        self,
        query_metadata: dict[str, Any],
        candidate_metadata: dict[str, Any],
    ) -> dict[str, list[str]]:
        matched_fields: list[str] = []
        conflicted_fields: list[str] = []

        for field_name in ("representative_view", "visit_status", "contact_lens_use", "smear_result"):
            query_value = self._normalize_metadata_text(query_metadata.get(field_name))
            candidate_value = self._normalize_metadata_text(candidate_metadata.get(field_name))
            if not query_value or not candidate_value:
                continue
            if query_value == candidate_value:
                matched_fields.append(field_name)
            else:
                conflicted_fields.append(field_name)

        query_active_stage = query_metadata.get("active_stage")
        candidate_active_stage = candidate_metadata.get("active_stage")
        if isinstance(query_active_stage, bool) and isinstance(candidate_active_stage, bool):
            if query_active_stage == candidate_active_stage:
                matched_fields.append("active_stage")
            else:
                conflicted_fields.append("active_stage")

        query_polymicrobial = query_metadata.get("polymicrobial")
        candidate_polymicrobial = candidate_metadata.get("polymicrobial")
        if isinstance(query_polymicrobial, bool) and isinstance(candidate_polymicrobial, bool):
            if query_polymicrobial == candidate_polymicrobial:
                matched_fields.append("polymicrobial")
            else:
                conflicted_fields.append("polymicrobial")

        query_factors = set(self._normalize_predisposing_factors(query_metadata.get("predisposing_factor")))
        candidate_factors = set(self._normalize_predisposing_factors(candidate_metadata.get("predisposing_factor")))
        if query_factors and candidate_factors:
            if query_factors.intersection(candidate_factors):
                matched_fields.append("predisposing_factor")
            else:
                conflicted_fields.append("predisposing_factor")

        return {
            "matched_fields": matched_fields,
            "conflicted_fields": conflicted_fields,
        }

    def _metadata_reranking_adjustment(
        self,
        query_metadata: dict[str, Any],
        candidate_metadata: dict[str, Any],
    ) -> dict[str, Any]:
        adjustment = 0.0
        details: dict[str, float] = {}

        query_view = self._normalize_metadata_text(query_metadata.get("representative_view"))
        candidate_view = self._normalize_metadata_text(candidate_metadata.get("representative_view"))
        if query_view and candidate_view:
            value = 0.03 if query_view == candidate_view else -0.01
            details["view"] = round(value, 4)
            adjustment += value

        query_active = query_metadata.get("active_stage")
        candidate_active = candidate_metadata.get("active_stage")
        if isinstance(query_active, bool) and isinstance(candidate_active, bool):
            value = 0.02 if query_active == candidate_active else -0.04
            details["active_stage"] = round(value, 4)
            adjustment += value

        query_status = self._normalize_metadata_text(query_metadata.get("visit_status"))
        candidate_status = self._normalize_metadata_text(candidate_metadata.get("visit_status"))
        if query_status and candidate_status:
            value = 0.015 if query_status == candidate_status else -0.015
            details["visit_status"] = round(value, 4)
            adjustment += value

        quality_score = candidate_metadata.get("quality_score")
        if isinstance(quality_score, (int, float)):
            if quality_score < 35:
                value = -0.03
            elif quality_score < 50:
                value = -0.015
            else:
                value = 0.005
            details["quality_score"] = round(value, 4)
            adjustment += value

        query_contact_lens = self._normalize_metadata_text(query_metadata.get("contact_lens_use"))
        candidate_contact_lens = self._normalize_metadata_text(candidate_metadata.get("contact_lens_use"))
        if query_contact_lens and candidate_contact_lens:
            value = 0.015 if query_contact_lens == candidate_contact_lens else -0.01
            details["contact_lens_use"] = round(value, 4)
            adjustment += value

        query_smear = self._normalize_metadata_text(query_metadata.get("smear_result"))
        candidate_smear = self._normalize_metadata_text(candidate_metadata.get("smear_result"))
        if query_smear and candidate_smear:
            value = 0.015 if query_smear == candidate_smear else -0.01
            details["smear_result"] = round(value, 4)
            adjustment += value

        query_polymicrobial = query_metadata.get("polymicrobial")
        candidate_polymicrobial = candidate_metadata.get("polymicrobial")
        if isinstance(query_polymicrobial, bool) and isinstance(candidate_polymicrobial, bool):
            value = 0.01 if query_polymicrobial == candidate_polymicrobial else -0.015
            details["polymicrobial"] = round(value, 4)
            adjustment += value

        query_factors = set(self._normalize_predisposing_factors(query_metadata.get("predisposing_factor")))
        candidate_factors = set(self._normalize_predisposing_factors(candidate_metadata.get("predisposing_factor")))
        if query_factors and candidate_factors:
            value = 0.02 if query_factors.intersection(candidate_factors) else -0.01
            details["predisposing_factor"] = round(value, 4)
            adjustment += value

        return {
            "adjustment": round(adjustment, 4),
            "details": details,
            "alignment": self._metadata_alignment(query_metadata, candidate_metadata),
        }
