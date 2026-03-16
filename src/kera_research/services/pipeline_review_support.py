from __future__ import annotations

import base64
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageFilter, ImageOps, ImageStat

from kera_research.domain import INDEX_TO_LABEL, make_id, utc_now
from kera_research.services.data_plane import SiteStore
from kera_research.services.modeling import require_torch, torch
from kera_research.storage import ensure_dir, write_json

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchReviewSupport:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _compute_image_qa_metrics(self, image_path: str) -> dict[str, Any]:
        with Image.open(image_path) as image:
            normalized = ImageOps.exif_transpose(image)
            grayscale = normalized.convert("L")
            luminance = ImageStat.Stat(grayscale)
            edges = grayscale.filter(ImageFilter.FIND_EDGES)
            edge_stats = ImageStat.Stat(edges)
            return {
                "width": int(normalized.width),
                "height": int(normalized.height),
                "mean_brightness": round(float(luminance.mean[0]), 3),
                "contrast_stddev": round(float(luminance.stddev[0]), 3),
                "edge_density": round(float(edge_stats.mean[0]), 3),
            }

    def _write_review_thumbnail(
        self,
        source_path: str,
        output_path: Path,
        *,
        max_size: tuple[int, int] = (320, 320),
    ) -> str:
        ensure_dir(output_path.parent)
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            thumbnail = normalized.copy()
            thumbnail.thumbnail(max_size)
            suffix = output_path.suffix.lower()
            if suffix == ".png":
                if thumbnail.mode not in {"RGB", "RGBA", "L"}:
                    thumbnail = thumbnail.convert("RGBA" if "A" in thumbnail.getbands() else "RGB")
                thumbnail.save(output_path, format="PNG")
            else:
                if thumbnail.mode not in {"RGB", "L"}:
                    thumbnail = thumbnail.convert("RGB")
                thumbnail.save(output_path, format="JPEG", quality=88, optimize=True)
        return str(output_path)

    def _build_embedded_review_artifact(
        self,
        source_path: str,
        output_path: Path,
        *,
        max_size: tuple[int, int],
    ) -> dict[str, Any] | None:
        if not source_path or not Path(source_path).exists():
            return None
        saved_path = self._write_review_thumbnail(source_path, output_path, max_size=max_size)
        thumbnail_bytes = Path(saved_path).read_bytes()
        media_type = "image/png" if output_path.suffix.lower() == ".png" else "image/jpeg"
        return {
            "media_type": media_type,
            "encoding": "base64",
            "bytes_b64": base64.b64encode(thumbnail_bytes).decode("ascii"),
        }

    def _build_approval_report(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        prepared_records: list[dict[str, Any]],
        update_id: str,
        patient_id: str,
        visit_date: str,
    ) -> tuple[dict[str, Any], Path]:
        service = self.service
        case_reference_id = service.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        representative = service._select_representative_record(case_records)
        prepared_representative = next(
            (
                item
                for item in prepared_records
                if item.get("source_image_path") == representative.get("image_path")
            ),
            prepared_records[0],
        )

        review_dir = site_store.update_dir / update_id
        source_thumb_path = review_dir / "source_thumbnail.jpg"
        roi_thumb_path = review_dir / "roi_thumbnail.jpg"
        mask_thumb_path = review_dir / "mask_thumbnail.png"

        artifacts: dict[str, dict[str, Any] | None] = {
            "source_thumbnail": None,
            "roi_thumbnail": None,
            "mask_thumbnail": None,
        }

        source_image_path = str(representative.get("image_path") or "")
        source_thumb = self._build_embedded_review_artifact(
            source_image_path,
            source_thumb_path,
            max_size=(128, 128),
        )
        if source_thumb:
            artifacts["source_thumbnail"] = source_thumb

        roi_crop_path = str(prepared_representative.get("roi_crop_path") or prepared_representative.get("lesion_crop_path") or "")
        roi_thumb = self._build_embedded_review_artifact(
            roi_crop_path,
            roi_thumb_path,
            max_size=(320, 320),
        )
        if roi_thumb:
            artifacts["roi_thumbnail"] = roi_thumb

        medsam_mask_path = str(prepared_representative.get("medsam_mask_path") or prepared_representative.get("lesion_mask_path") or "")
        mask_thumb = self._build_embedded_review_artifact(
            medsam_mask_path,
            mask_thumb_path,
            max_size=(320, 320),
        )
        if mask_thumb:
            artifacts["mask_thumbnail"] = mask_thumb

        source_metrics = self._compute_image_qa_metrics(source_image_path) if source_image_path else {}
        roi_metrics = self._compute_image_qa_metrics(roi_crop_path) if roi_crop_path else {}
        mask_metrics = self._compute_image_qa_metrics(medsam_mask_path) if medsam_mask_path else {}

        roi_area_ratio = None
        if source_metrics and roi_metrics:
            source_area = max(1, int(source_metrics["width"]) * int(source_metrics["height"]))
            roi_area = int(roi_metrics["width"]) * int(roi_metrics["height"])
            roi_area_ratio = round(float(roi_area / source_area), 4)

        report = {
            "report_id": make_id("approval"),
            "update_id": update_id,
            "site_id": site_store.site_id,
            "case_reference_id": case_reference_id,
            "generated_at": utc_now(),
            "case_summary": {
                "image_count": len(case_records),
                "representative_view": representative.get("view"),
                "views": [str(item.get("view") or "unknown") for item in case_records],
                "culture_category": representative.get("culture_category"),
                "culture_species": representative.get("culture_species"),
                "is_single_case_delta": True,
            },
            "qa_metrics": {
                "source": source_metrics,
                "roi_crop": roi_metrics,
                "medsam_mask": mask_metrics,
                "roi_area_ratio": roi_area_ratio,
            },
            "privacy_controls": {
                "source_thumbnail_max_side_px": 128,
                "derived_thumbnail_max_side_px": 320,
                "upload_exif_removed": True,
                "stored_filename_policy": "randomized_image_id_only",
                "review_media_policy": "thumbnail_only_for_admin_review",
            },
            "artifacts": artifacts,
        }
        report_path = review_dir / "approval_report.json"
        write_json(report_path, report)
        return report, report_path

    def _compute_delta_quality_summary(self, delta_path: str | Path) -> dict[str, Any]:
        try:
            require_torch()
            checkpoint = torch.load(delta_path, map_location="cpu", weights_only=True)
            delta_state = checkpoint.get("state_dict") if isinstance(checkpoint, dict) else None
            if not isinstance(delta_state, dict):
                raise ValueError("Delta file has no readable state_dict.")
            self.service.model_manager._validate_deltas([delta_state])
            total_norm = 0.0
            parameter_count = 0
            for tensor in delta_state.values():
                t = tensor.float()
                total_norm += float(t.norm().item()) ** 2
                parameter_count += int(t.numel())
            l2_norm = total_norm ** 0.5
            return {
                "score": 25,
                "status": "ok",
                "flags": [],
                "l2_norm": round(float(l2_norm), 6),
                "parameter_count": parameter_count,
                "message": "Delta integrity and norm look valid.",
            }
        except Exception as exc:
            return {
                "score": 0,
                "status": "invalid",
                "flags": ["delta_invalid"],
                "l2_norm": None,
                "parameter_count": None,
                "message": str(exc),
            }

    def _build_update_quality_summary(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        delta_path: str | Path,
        approval_report: dict[str, Any],
    ) -> dict[str, Any]:
        service = self.service
        qa_metrics = approval_report.get("qa_metrics") if isinstance(approval_report, dict) else {}
        source_metrics = qa_metrics.get("source") if isinstance(qa_metrics, dict) else {}
        roi_area_ratio = qa_metrics.get("roi_area_ratio") if isinstance(qa_metrics, dict) else None

        image_flags: list[str] = []
        image_strengths: list[str] = []
        brightness = float(source_metrics.get("mean_brightness", 0.0) or 0.0)
        contrast = float(source_metrics.get("contrast_stddev", 0.0) or 0.0)
        edge_density = float(source_metrics.get("edge_density", 0.0) or 0.0)
        image_score = 25
        if brightness and (brightness < 35 or brightness > 225):
            image_flags.append("brightness_out_of_range")
            image_score -= 8
        else:
            image_strengths.append("brightness_ok")
        if contrast and contrast < 18:
            image_flags.append("low_contrast")
            image_score -= 8
        else:
            image_strengths.append("contrast_ok")
        if edge_density and edge_density < 5:
            image_flags.append("low_edge_density")
            image_score -= 9
        else:
            image_strengths.append("edge_density_ok")
        image_score = max(0, image_score)

        crop_flags: list[str] = []
        crop_strengths: list[str] = []
        crop_score = 25
        if roi_area_ratio is None:
            crop_flags.append("crop_ratio_missing")
            crop_score -= 12
        else:
            ratio_value = float(roi_area_ratio)
            if ratio_value < 0.03:
                crop_flags.append("crop_too_tight")
                crop_score -= 12
            elif ratio_value > 0.95:
                crop_flags.append("crop_too_wide")
                crop_score -= 12
            else:
                crop_strengths.append("crop_ratio_ok")
        crop_score = max(0, crop_score)

        validation_result = service._predict_case(
            site_store,
            case_records,
            model_version,
            execution_device,
            generate_gradcam=False,
            generate_medsam=False,
        )
        validation_flags: list[str] = []
        validation_strengths: list[str] = []
        validation_score = 25 if bool(validation_result.get("predicted_index")) == bool(validation_result.get("true_index")) else 8
        if validation_result.get("predicted_index") == validation_result.get("true_index"):
            validation_strengths.append("validation_match")
            validation_status = "match"
        else:
            validation_flags.append("validation_mismatch")
            validation_status = "mismatch"

        delta_summary = self._compute_delta_quality_summary(delta_path)

        policy_flags: list[str] = []
        policy_score = 25
        has_additional_organisms = any(bool(record.get("additional_organisms")) for record in case_records)
        if has_additional_organisms:
            policy_flags.append("polymicrobial_excluded")
            policy_score = 0

        strengths = image_strengths + crop_strengths + validation_strengths
        risk_flags = image_flags + crop_flags + validation_flags + list(delta_summary.get("flags") or []) + policy_flags
        total_score = max(0, min(100, image_score + crop_score + validation_score + int(delta_summary.get("score") or 0) + policy_score))
        if "delta_invalid" in risk_flags or "polymicrobial_excluded" in risk_flags:
            recommendation = "reject_candidate"
        elif total_score >= 80:
            recommendation = "approve_candidate"
        elif total_score >= 60:
            recommendation = "needs_review"
        else:
            recommendation = "reject_candidate"

        return {
            "quality_score": total_score,
            "recommendation": recommendation,
            "image_quality": {
                "score": image_score,
                "status": "ok" if not image_flags else "review",
                "flags": image_flags,
                "mean_brightness": round(brightness, 3) if brightness else None,
                "contrast_stddev": round(contrast, 3) if contrast else None,
                "edge_density": round(edge_density, 3) if edge_density else None,
            },
            "crop_quality": {
                "score": crop_score,
                "status": "ok" if not crop_flags else "review",
                "flags": crop_flags,
                "roi_area_ratio": round(float(roi_area_ratio), 4) if roi_area_ratio is not None else None,
            },
            "delta_quality": delta_summary,
            "validation_consistency": {
                "score": validation_score,
                "status": validation_status,
                "flags": validation_flags,
                "predicted_label": INDEX_TO_LABEL[int(validation_result["predicted_index"])],
                "true_label": INDEX_TO_LABEL[int(validation_result["true_index"])],
                "prediction_probability": round(float(validation_result["predicted_probability"]), 4),
                "decision_threshold": round(float(validation_result.get("decision_threshold") or 0.5), 4),
                "is_correct": bool(validation_result["predicted_index"] == validation_result["true_index"]),
            },
            "policy_checks": {
                "score": policy_score,
                "status": "blocked" if policy_flags else "ok",
                "flags": policy_flags,
                "has_additional_organisms": has_additional_organisms,
                "training_policy": "exclude_polymicrobial",
            },
            "risk_flags": risk_flags,
            "strengths": strengths,
        }
