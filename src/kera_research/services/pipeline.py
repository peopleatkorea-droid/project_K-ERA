from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import pandas as pd
from PIL import Image, ImageFilter, ImageOps, ImageStat

from kera_research.config import CASE_REFERENCE_SALT_FINGERPRINT
from kera_research.domain import DENSENET_VARIANTS, INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
from kera_research.services.artifacts import MedSAMService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.modeling import ModelManager
from kera_research.storage import ensure_dir, write_json


class ResearchWorkflowService:
    def __init__(self, control_plane: ControlPlaneStore) -> None:
        self.control_plane = control_plane
        self.model_manager = ModelManager()
        self.medsam_service = MedSAMService()

        for baseline in self.model_manager.ensure_baseline_models():
            self.control_plane.ensure_model_version(baseline)

    def _normalize_crop_mode(self, crop_mode: str | None) -> str:
        normalized = str(crop_mode or "automated").strip().lower()
        if normalized in {"automated", "manual", "both"}:
            return normalized
        return "automated"

    def _resolve_model_crop_mode(self, model_version: dict[str, Any]) -> str:
        if model_version.get("ensemble_mode") == "weighted_average":
            return "both"
        crop_mode = str(model_version.get("crop_mode") or "").strip().lower()
        if crop_mode:
            return self._normalize_crop_mode(crop_mode)
        return "automated" if model_version.get("requires_medsam_crop", False) else "raw"

    def _crop_metadata_dir(self, site_store: SiteStore, crop_mode: str) -> Path:
        return ensure_dir(site_store.artifact_dir / f"{crop_mode}_preview_meta")

    def _load_cached_crop(
        self,
        *,
        metadata_path: Path,
        mask_path: Path,
        crop_path: Path,
        mask_key: str = "medsam_mask_path",
        crop_key: str = "roi_crop_path",
    ) -> dict[str, Any] | None:
        if not (crop_path.exists() and mask_path.exists() and metadata_path.exists()):
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        backend = str(metadata.get("backend") or "").strip() or "unknown"
        if backend == "unknown" or backend.startswith("fallback_after_medsam_error"):
            return None
        return {
            mask_key: str(mask_path),
            crop_key: str(crop_path),
            "backend": backend,
            "medsam_error": metadata.get("medsam_error"),
        }

    def _save_crop_metadata(self, metadata_path: Path, result: dict[str, Any]) -> None:
        write_json(
            metadata_path,
            {
                "backend": result.get("backend", "unknown"),
                "medsam_error": result.get("medsam_error"),
            },
        )

    def _ensure_roi_crop(self, site_store: SiteStore, image_path: str) -> dict[str, Any]:
        artifact_name = Path(image_path).stem
        mask_path = site_store.medsam_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.roi_crop_dir / f"{artifact_name}_crop.png"
        metadata_dir = self._crop_metadata_dir(site_store, "roi")
        metadata_path = metadata_dir / f"{artifact_name}.json"
        cached = self._load_cached_crop(metadata_path=metadata_path, mask_path=mask_path, crop_path=crop_path)
        if cached:
            return cached
        result = self.medsam_service.generate_roi(image_path, mask_path, crop_path)
        self._save_crop_metadata(metadata_path, result)
        return {
            "medsam_mask_path": result["medsam_mask_path"],
            "roi_crop_path": result["roi_crop_path"],
            "backend": result.get("backend", "unknown"),
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

    def _ensure_lesion_crop(self, site_store: SiteStore, record: dict[str, Any], expand_ratio: float = 2.5) -> dict[str, Any]:
        lesion_prompt_box = record.get("lesion_prompt_box")
        if not isinstance(lesion_prompt_box, dict):
            raise ValueError("Representative image for this case requires a saved lesion box.")
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
        )
        if cached:
            return cached
        prompt_box = self._pixel_prompt_box(record["image_path"], lesion_prompt_box)
        result = self.medsam_service.generate_lesion_roi(
            record["image_path"],
            mask_path,
            crop_path,
            prompt_box=prompt_box,
            expand_ratio=expand_ratio,
        )
        self._save_crop_metadata(metadata_path, result)
        return {
            "lesion_mask_path": result["medsam_mask_path"],
            "lesion_crop_path": result["roi_crop_path"],
            "backend": result.get("backend", "unknown"),
            "medsam_error": result.get("medsam_error"),
        }

    def _prepare_records_for_model(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        crop_mode: str,
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        normalized_crop_mode = self._normalize_crop_mode(crop_mode)
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

    def _group_case_records(self, records: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in records:
            grouped.setdefault((str(record["patient_id"]), str(record["visit_date"])), []).append(record)
        return list(grouped.values())

    def _predict_case_probability_with_loaded_model(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        model: Any,
        execution_device: str,
    ) -> dict[str, Any]:
        crop_mode = self._resolve_model_crop_mode(model_version)
        prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
        image_probabilities: list[float] = []
        for record in prepared_records:
            prediction = self.model_manager.predict_image(model, record["image_path"], execution_device)
            image_probabilities.append(float(prediction.probability))
        predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
        true_index = LABEL_TO_INDEX[str(case_records[0]["culture_category"])]
        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_probability": predicted_probability,
            "predicted_index": 1 if predicted_probability >= 0.5 else 0,
            "crop_mode": crop_mode,
            "n_model_inputs": len(prepared_records),
        }

    def _collect_case_probabilities(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
    ) -> dict[tuple[str, str], dict[str, Any]]:
        if not records:
            return {}
        model = self.model_manager.load_model(model_version, execution_device)
        predictions: dict[tuple[str, str], dict[str, Any]] = {}
        for case_records in self._group_case_records(records):
            case_prediction = self._predict_case_probability_with_loaded_model(
                site_store,
                case_records,
                model_version,
                model,
                execution_device,
            )
            predictions[(case_prediction["patient_id"], case_prediction["visit_date"])] = case_prediction
        return predictions

    def _optimize_ensemble_weights(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        automated_model_version: dict[str, Any],
        manual_model_version: dict[str, Any],
        execution_device: str,
    ) -> dict[str, Any]:
        automated_predictions = self._collect_case_probabilities(
            site_store,
            records,
            automated_model_version,
            execution_device,
        )
        manual_predictions = self._collect_case_probabilities(
            site_store,
            records,
            manual_model_version,
            execution_device,
        )
        common_case_keys = [
            key
            for key in automated_predictions.keys()
            if key in manual_predictions
        ]
        if not common_case_keys:
            return {
                "ensemble_weights": {"automated": 0.5, "manual": 0.5},
                "selection_metric": "default_no_overlap",
                "selection_metrics": None,
                "n_validation_cases": 0,
            }

        best_result: dict[str, Any] | None = None
        for index in range(21):
            automated_weight = round(index * 0.05, 2)
            manual_weight = round(1.0 - automated_weight, 2)
            true_labels: list[int] = []
            predicted_labels: list[int] = []
            positive_probabilities: list[float] = []
            for case_key in common_case_keys:
                automated_probability = float(automated_predictions[case_key]["predicted_probability"])
                manual_probability = float(manual_predictions[case_key]["predicted_probability"])
                blended_probability = float((automated_weight * automated_probability) + (manual_weight * manual_probability))
                true_index = int(automated_predictions[case_key]["true_index"])
                true_labels.append(true_index)
                positive_probabilities.append(blended_probability)
                predicted_labels.append(1 if blended_probability >= 0.5 else 0)
            metrics = self.model_manager.classification_metrics(true_labels, predicted_labels, positive_probabilities)
            score_tuple = (
                float(metrics["AUROC"]) if metrics.get("AUROC") is not None else -1.0,
                float(metrics.get("accuracy") or 0.0),
                float(metrics.get("F1") or 0.0),
                -abs(automated_weight - 0.5),
            )
            candidate = {
                "ensemble_weights": {
                    "automated": automated_weight,
                    "manual": manual_weight,
                },
                "selection_metric": "AUROC",
                "selection_metrics": metrics,
                "n_validation_cases": len(common_case_keys),
                "score_tuple": score_tuple,
            }
            if best_result is None or candidate["score_tuple"] > best_result["score_tuple"]:
                best_result = candidate

        assert best_result is not None
        best_result.pop("score_tuple", None)
        return best_result

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
        case_reference_id = self.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        representative = self._select_representative_record(case_records)
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

    def _resolve_ensemble_components(self, model_version: dict[str, Any]) -> tuple[list[dict[str, Any]], list[float]]:
        component_ids = list(model_version.get("component_model_version_ids") or [])
        if len(component_ids) < 2:
            raise ValueError("Ensemble model is missing component model versions.")
        versions_by_id = {item["version_id"]: item for item in self.control_plane.list_model_versions()}
        components: list[dict[str, Any]] = []
        for version_id in component_ids:
            component = versions_by_id.get(version_id)
            if component is None:
                raise ValueError(f"Unknown ensemble component model: {version_id}")
            components.append(component)
        weight_map = model_version.get("ensemble_weights") or {}
        if isinstance(weight_map, dict):
            raw_weights = [float(weight_map.get(component.get("crop_mode") or "automated", 0.5)) for component in components]
        else:
            raw_weights = [0.5 for _ in components]
        total = sum(raw_weights) or float(len(raw_weights))
        normalized = [weight / total for weight in raw_weights]
        return components, normalized

    def _artifact_refs_for_case(
        self,
        site_store: SiteStore,
        *,
        artifact_row: dict[str, Any],
        prepared_artifact: dict[str, Any],
        crop_mode: str,
        model_reference: dict[str, Any],
        model: Any,
        execution_device: str,
        predicted_index: int,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> dict[str, Any]:
        artifact_refs: dict[str, Any] = {
            "gradcam_path": None,
            "medsam_mask_path": None,
            "roi_crop_path": None,
            "lesion_mask_path": None,
            "lesion_crop_path": None,
        }
        if crop_mode == "automated" and generate_medsam:
            roi = self._ensure_roi_crop(site_store, artifact_row["image_path"])
            artifact_refs["medsam_mask_path"] = roi["medsam_mask_path"]
            artifact_refs["roi_crop_path"] = roi["roi_crop_path"]
        if crop_mode == "manual" and generate_medsam:
            lesion = self._ensure_lesion_crop(site_store, artifact_row)
            artifact_refs["lesion_mask_path"] = lesion["lesion_mask_path"]
            artifact_refs["lesion_crop_path"] = lesion["lesion_crop_path"]
        if generate_gradcam:
            artifact_name = Path(artifact_row["image_path"]).stem
            gradcam_path = self.model_manager.generate_explanation(
                model,
                model_reference,
                prepared_artifact["image_path"],
                execution_device,
                site_store.gradcam_dir / f"{artifact_name}_{crop_mode}_gradcam.png",
                target_class=predicted_index,
            )
            artifact_refs["gradcam_path"] = gradcam_path
        return artifact_refs

    def _predict_case_with_model(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        *,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> dict[str, Any]:
        crop_mode = self._resolve_model_crop_mode(model_version)
        prepared_records = self._prepare_records_for_model(site_store, case_records, crop_mode=crop_mode)
        model = self.model_manager.load_model(model_version, execution_device)

        artifact_row = self._select_representative_record(case_records)
        prepared_artifact = next(
            (
                record
                for record in prepared_records
                if record["source_image_path"] == artifact_row["image_path"]
            ),
            prepared_records[0],
        )

        image_probabilities: list[float] = []
        for record in prepared_records:
            prediction = self.model_manager.predict_image(model, record["image_path"], execution_device)
            image_probabilities.append(prediction.probability)

        predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
        predicted_index = 1 if predicted_probability >= 0.5 else 0
        true_index = LABEL_TO_INDEX[str(case_records[0]["culture_category"])]

        artifact_refs = self._artifact_refs_for_case(
            site_store,
            artifact_row=artifact_row,
            prepared_artifact=prepared_artifact,
            crop_mode=crop_mode,
            model_reference=model_version,
            model=model,
            execution_device=execution_device,
            predicted_index=predicted_index,
            generate_gradcam=generate_gradcam,
            generate_medsam=generate_medsam,
        )

        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_index": predicted_index,
            "predicted_probability": predicted_probability,
            "crop_mode": crop_mode,
            "n_source_images": len(case_records),
            "n_model_inputs": len(prepared_records),
            "component_model_version_id": model_version.get("version_id"),
            "component_model_version_name": model_version.get("version_name"),
            **artifact_refs,
        }

    def _predict_case(
        self,
        site_store: SiteStore,
        case_records: list[dict[str, Any]],
        model_version: dict[str, Any],
        execution_device: str,
        *,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> dict[str, Any]:
        if model_version.get("ensemble_mode") != "weighted_average":
            return self._predict_case_with_model(
                site_store,
                case_records,
                model_version,
                execution_device,
                generate_gradcam=generate_gradcam,
                generate_medsam=generate_medsam,
            )

        components, weights = self._resolve_ensemble_components(model_version)
        component_predictions: list[dict[str, Any]] = []
        for component in components:
            component_predictions.append(
                self._predict_case_with_model(
                    site_store,
                    case_records,
                    component,
                    execution_device,
                    generate_gradcam=generate_gradcam and self._resolve_model_crop_mode(component) == "automated",
                    generate_medsam=generate_medsam,
                )
            )

        automated_prediction = next((item for item in component_predictions if item.get("crop_mode") == "automated"), None)
        manual_prediction = next((item for item in component_predictions if item.get("crop_mode") == "manual"), None)
        predicted_probability = float(
            sum(weight * float(prediction["predicted_probability"]) for weight, prediction in zip(weights, component_predictions))
        )
        predicted_index = 1 if predicted_probability >= 0.5 else 0
        true_index = int(component_predictions[0]["true_index"])

        merged_artifacts = {
            "gradcam_path": automated_prediction.get("gradcam_path") if automated_prediction else None,
            "medsam_mask_path": automated_prediction.get("medsam_mask_path") if automated_prediction else None,
            "roi_crop_path": automated_prediction.get("roi_crop_path") if automated_prediction else None,
            "lesion_mask_path": manual_prediction.get("lesion_mask_path") if manual_prediction else None,
            "lesion_crop_path": manual_prediction.get("lesion_crop_path") if manual_prediction else None,
        }

        return {
            "patient_id": str(case_records[0]["patient_id"]),
            "visit_date": str(case_records[0]["visit_date"]),
            "true_index": true_index,
            "predicted_index": predicted_index,
            "predicted_probability": predicted_probability,
            "crop_mode": "both",
            "n_source_images": len(case_records),
            "n_model_inputs": sum(int(item.get("n_model_inputs", 0)) for item in component_predictions),
            "ensemble_component_predictions": component_predictions,
            "ensemble_weights": {
                (component.get("crop_mode") or self._resolve_model_crop_mode(component)): round(weight, 4)
                for component, weight in zip(components, weights)
            },
            **merged_artifacts,
        }

    def run_external_validation(
        self,
        project_id: str,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        generate_gradcam: bool,
        generate_medsam: bool,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], pd.DataFrame]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("No uploaded images are available for validation.")

        grouped = manifest_df.groupby(["patient_id", "visit_date"], sort=False)
        case_predictions: list[dict[str, Any]] = []
        summary_targets: list[int] = []
        summary_predictions: list[int] = []
        summary_probabilities: list[float] = []

        for (patient_id, visit_date), patient_frame in grouped:
            case_result = self._predict_case(
                site_store,
                patient_frame.to_dict("records"),
                model_version,
                execution_device,
                generate_gradcam=generate_gradcam,
                generate_medsam=generate_medsam,
            )
            predicted_probability = float(case_result["predicted_probability"])
            predicted_index = int(case_result["predicted_index"])
            true_index = int(case_result["true_index"])

            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "true_label": INDEX_TO_LABEL[true_index],
                    "predicted_label": INDEX_TO_LABEL[predicted_index],
                    "prediction_probability": predicted_probability,
                    "is_correct": bool(true_index == predicted_index),
                    "crop_mode": case_result.get("crop_mode"),
                    "n_source_images": case_result.get("n_source_images"),
                    "n_model_inputs": case_result.get("n_model_inputs"),
                    "ensemble_weights": case_result.get("ensemble_weights"),
                    "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
                    "gradcam_path": case_result.get("gradcam_path"),
                    "medsam_mask_path": case_result.get("medsam_mask_path"),
                    "roi_crop_path": case_result.get("roi_crop_path"),
                    "lesion_mask_path": case_result.get("lesion_mask_path"),
                    "lesion_crop_path": case_result.get("lesion_crop_path"),
                }
            )
            summary_targets.append(true_index)
            summary_predictions.append(predicted_index)
            summary_probabilities.append(predicted_probability)

        validation_id = make_id("validation")
        for case_prediction in case_predictions:
            case_prediction["validation_id"] = validation_id

        metrics = self.model_manager.classification_metrics(
            summary_targets,
            summary_predictions,
            summary_probabilities,
        )
        summary = {
            "validation_id": validation_id,
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version.get("architecture", "cnn"),
            "run_date": utc_now(),
            "n_patients": int(manifest_df["patient_id"].nunique()),
            "n_cases": int(manifest_df[["patient_id", "visit_date"]].drop_duplicates().shape[0]),
            "n_images": int(len(manifest_df)),
            "AUROC": metrics["AUROC"],
            "accuracy": metrics["accuracy"],
            "sensitivity": metrics["sensitivity"],
            "specificity": metrics["specificity"],
            "F1": metrics["F1"],
            "confusion_matrix": metrics["confusion_matrix"],
            "roc_curve": metrics["roc_curve"],
            "n_correct": int(sum(pred == target for pred, target in zip(summary_predictions, summary_targets))),
            "n_incorrect": int(sum(pred != target for pred, target in zip(summary_predictions, summary_targets))),
        }
        saved_summary = self.control_plane.save_validation_run(summary, case_predictions)
        return saved_summary, case_predictions, manifest_df

    def run_case_validation(
        self,
        project_id: str,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        generate_gradcam: bool = True,
        generate_medsam: bool = True,
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        """단일 케이스(환자 1명, 방문 1회)에 대해 즉시 검증을 수행합니다."""
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        case_result = self._predict_case(
            site_store,
            case_df.to_dict("records"),
            model_version,
            execution_device,
            generate_gradcam=generate_gradcam,
            generate_medsam=generate_medsam,
        )
        predicted_probability = float(case_result["predicted_probability"])
        predicted_index = int(case_result["predicted_index"])
        true_index = int(case_result["true_index"])

        validation_id = make_id("validation")
        case_prediction: dict[str, Any] = {
            "validation_id": validation_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "true_label": INDEX_TO_LABEL[true_index],
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "prediction_probability": predicted_probability,
            "is_correct": bool(true_index == predicted_index),
            "crop_mode": case_result.get("crop_mode"),
            "n_source_images": case_result.get("n_source_images"),
            "n_model_inputs": case_result.get("n_model_inputs"),
            "ensemble_weights": case_result.get("ensemble_weights"),
            "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
            "gradcam_path": case_result.get("gradcam_path"),
            "medsam_mask_path": case_result.get("medsam_mask_path"),
            "roi_crop_path": case_result.get("roi_crop_path"),
            "lesion_mask_path": case_result.get("lesion_mask_path"),
            "lesion_crop_path": case_result.get("lesion_crop_path"),
        }

        summary: dict[str, Any] = {
            "validation_id": validation_id,
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version.get("architecture", "densenet121"),
            "crop_mode": case_result.get("crop_mode"),
            "run_date": utc_now(),
            "patient_id": patient_id,
            "visit_date": visit_date,
            "n_images": int(len(case_df)),
            "n_model_inputs": int(case_result.get("n_model_inputs", len(case_df))),
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "true_label": INDEX_TO_LABEL[true_index],
            "is_correct": bool(true_index == predicted_index),
            "prediction_probability": predicted_probability,
            "ensemble_weights": case_result.get("ensemble_weights"),
        }
        saved_summary = self.control_plane.save_validation_run(summary, [case_prediction])
        return saved_summary, [case_prediction]

    def preview_case_roi(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        """Generate MedSAM ROI previews for a single visit without requiring a model."""
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        previews: list[dict[str, Any]] = []
        for record in case_df.to_dict("records"):
            roi = self._ensure_roi_crop(site_store, record["image_path"])
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": record.get("view", "unknown"),
                    "is_representative": bool(record.get("is_representative")),
                    "source_image_path": record["image_path"],
                    "medsam_mask_path": roi["medsam_mask_path"],
                    "roi_crop_path": roi["roi_crop_path"],
                    "backend": roi.get("backend", "unknown"),
                    "medsam_error": roi.get("medsam_error"),
                }
            )
        previews.sort(
            key=lambda item: (
                not item["is_representative"],
                item["view"],
                item["source_image_path"],
            )
        )
        return previews

    def preview_case_lesion(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        boxed_records = [
            record
            for record in case_df.to_dict("records")
            if isinstance(record.get("lesion_prompt_box"), dict)
        ]
        if not boxed_records:
            raise ValueError("This case requires at least one saved lesion box.")

        previews: list[dict[str, Any]] = []
        for record in boxed_records:
            lesion = self._ensure_lesion_crop(site_store, record)
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": record.get("view", "unknown"),
                    "is_representative": bool(record.get("is_representative")),
                    "source_image_path": record["image_path"],
                    "lesion_mask_path": lesion["lesion_mask_path"],
                    "lesion_crop_path": lesion["lesion_crop_path"],
                    "backend": lesion.get("backend", "unknown"),
                    "medsam_error": lesion.get("medsam_error"),
                    "lesion_prompt_box": record.get("lesion_prompt_box"),
                }
            )
        previews.sort(
            key=lambda item: (
                not item["is_representative"],
                item["view"],
                item["source_image_path"],
            )
        )
        return previews

    def contribute_case(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        user_id: str,
    ) -> dict[str, Any]:
        """케이스 기여: 로컬 파인튜닝 → weight delta 저장 → 기여 등록."""
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No data found for patient {patient_id} / {visit_date}.")
        crop_mode = self._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for local fine-tuning contributions.")

        records = self._prepare_records_for_model(
            site_store,
            case_df.to_dict("records"),
            crop_mode=crop_mode,
        )

        full_finetune = execution_device == "cuda"
        epochs = 1 if execution_device == "cpu" else 3
        architecture = model_version.get("architecture", "densenet121")
        output_model_path = site_store.update_dir / f"{make_id(architecture)}_weights.pth"

        result = self.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=full_finetune,
            epochs=epochs,
        )

        delta_path = site_store.update_dir / f"{make_id('delta')}.pth"
        self.model_manager.save_weight_delta(
            model_version["model_path"],
            result["output_model_path"],
            delta_path,
        )

        update_id = make_id("update")
        artifact_metadata = self.control_plane.store_model_update_artifact(
            delta_path,
            update_id=update_id,
            artifact_kind="delta",
        )
        case_reference_id = self.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        approval_report, _approval_report_path = self._build_approval_report(
            site_store,
            case_df.to_dict("records"),
            records,
            update_id,
            patient_id,
            visit_date,
        )

        update_metadata: dict[str, Any] = {
            "update_id": update_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            **artifact_metadata,
            "n_cases": 1,
            "contributed_by": user_id,
            "case_reference_id": case_reference_id,
            "salt_fingerprint": CASE_REFERENCE_SALT_FINGERPRINT,
            "created_at": utc_now(),
            "crop_mode": crop_mode,
            "training_input_policy": "medsam_cornea_crop_only" if crop_mode == "automated" else "medsam_lesion_crop_only",
            "training_summary": result,
            "approval_report": approval_report,
            "status": "pending_review",
        }
        self.control_plane.register_model_update(update_metadata)

        contribution = {
            "contribution_id": make_id("contrib"),
            "user_id": user_id,
            "site_id": site_store.site_id,
            "case_reference_id": case_reference_id,
            "update_id": update_metadata["update_id"],
            "created_at": utc_now(),
        }
        self.control_plane.register_contribution(contribution)
        return update_metadata

    def run_initial_training(
        self,
        site_store: SiteStore,
        architecture: str,
        output_model_path: str,
        execution_device: str,
        crop_mode: str = "automated",
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        test_split: float = 0.2,
        use_pretrained: bool = True,
        use_medsam_crops: bool = True,
        regenerate_split: bool = False,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """사이트 전체 데이터로 automated/manual crop 기반 초기 학습을 수행합니다."""
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")
        if not use_medsam_crops:
            raise ValueError("Initial training is MedSAM cornea-crop-only.")
        normalized_crop_mode = self._normalize_crop_mode(crop_mode)
        training_modes = ["automated", "manual"] if normalized_crop_mode == "both" else [normalized_crop_mode]

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                    "crop_mode": normalized_crop_mode,
                    "component_crop_mode": payload.get("component_crop_mode"),
                    "component_index": payload.get("component_index"),
                    "component_count": len(training_modes),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(
            stage="preparing_data",
            message="Preparing manifest and patient split.",
            percent=3,
        )

        saved_split = None if regenerate_split else site_store.load_patient_split() or None
        crop_modes_to_train = training_modes
        created_versions: list[dict[str, Any]] = []
        component_results: list[dict[str, Any]] = []
        shared_patient_split: dict[str, Any] | None = saved_split

        for component_index, component_crop_mode in enumerate(crop_modes_to_train, start=1):
            emit_progress(
                stage="preparing_component",
                message=f"Preparing {component_crop_mode} training set.",
                percent=8 if len(crop_modes_to_train) == 1 else 5 + int(((component_index - 1) / len(crop_modes_to_train)) * 10),
                component_crop_mode=component_crop_mode,
                component_index=component_index,
            )
            records = self._prepare_records_for_model(
                site_store,
                manifest_df.to_dict("records"),
                crop_mode=component_crop_mode,
            )
            component_output_path = output_model_path
            if normalized_crop_mode == "both":
                output = Path(output_model_path)
                component_output_path = str(output.with_name(f"{output.stem}_{component_crop_mode}{output.suffix}"))

            training_start_percent = 10 + int(((component_index - 1) * 70) / len(crop_modes_to_train))
            training_end_percent = 10 + int((component_index * 70) / len(crop_modes_to_train))

            def component_progress_callback(epoch: int, total_epochs: int, train_loss: float, val_acc: float) -> None:
                progress_ratio = epoch / max(1, total_epochs)
                percent = training_start_percent + int((training_end_percent - training_start_percent) * progress_ratio)
                emit_progress(
                    stage="training_component",
                    message=f"Training {component_crop_mode} model.",
                    percent=percent,
                    component_crop_mode=component_crop_mode,
                    component_index=component_index,
                    epoch=epoch,
                    epochs=total_epochs,
                    train_loss=round(float(train_loss), 4),
                    val_acc=round(float(val_acc), 4),
                )

            result = self.model_manager.initial_train(
                records=records,
                architecture=architecture,
                output_model_path=component_output_path,
                device=execution_device,
                epochs=epochs,
                learning_rate=learning_rate,
                batch_size=batch_size,
                val_split=val_split,
                test_split=test_split,
                use_pretrained=use_pretrained,
                saved_split=shared_patient_split,
                progress_callback=component_progress_callback,
            )
            patient_split = {
                **result["patient_split"],
                "site_id": site_store.site_id,
            }
            shared_patient_split = patient_split
            site_store.save_patient_split(patient_split)
            result["patient_split"] = patient_split
            result["crop_mode"] = component_crop_mode
            version_name = f"global-{architecture}-{component_crop_mode}-v{make_id('init')[:6]}"
            new_version = {
                "version_id": make_id("model"),
                "version_name": version_name,
                "architecture": architecture,
                "stage": "global",
                "base_version_id": None,
                "model_path": component_output_path,
                "requires_medsam_crop": use_medsam_crops,
                "crop_mode": component_crop_mode,
                "training_input_policy": (
                    "medsam_cornea_crop_only" if component_crop_mode == "automated" else "medsam_lesion_crop_only"
                ),
                "created_at": utc_now(),
                "is_current": normalized_crop_mode != "both" and component_crop_mode == normalized_crop_mode,
                "notes": (
                    f"Initial training with {'MedSAM cornea crops' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crops'}: "
                    f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                    f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "notes_ko": (
                    f"{'MedSAM cornea crop' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crop'} 기반 초기 학습 모델: "
                    f"train {result['n_train_patients']}명 / val {result['n_val_patients']}명 / test {result['n_test_patients']}명, "
                    f"최고 val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "notes_en": (
                    f"Initial training with {'MedSAM cornea crops' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crops'}: "
                    f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                    f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "ready": True,
            }
            created_versions.append(self.control_plane.ensure_model_version(new_version))
            emit_progress(
                stage="registering_component",
                message=f"Registering {component_crop_mode} model version.",
                percent=training_end_percent,
                component_crop_mode=component_crop_mode,
                component_index=component_index,
            )
            result["version_name"] = version_name
            result["model_version"] = created_versions[-1]
            component_results.append(result)

        if normalized_crop_mode != "both":
            emit_progress(
                stage="completed",
                message="Initial training completed.",
                percent=100,
                component_crop_mode=normalized_crop_mode,
                component_index=1,
            )
            return component_results[0]

        emit_progress(
            stage="selecting_ensemble",
            message="Optimizing ensemble weights on validation split.",
            percent=88,
        )
        val_patient_ids = set(str(patient_id) for patient_id in (shared_patient_split or {}).get("val_patient_ids", []))
        validation_records = [
            record
            for record in manifest_df.to_dict("records")
            if str(record["patient_id"]) in val_patient_ids
        ]
        automated_version = next(
            (version for version in created_versions if self._resolve_model_crop_mode(version) == "automated"),
            created_versions[0],
        )
        manual_version = next(
            (version for version in created_versions if self._resolve_model_crop_mode(version) == "manual"),
            created_versions[-1],
        )
        ensemble_selection = self._optimize_ensemble_weights(
            site_store,
            validation_records,
            automated_version,
            manual_version,
            execution_device,
        )

        ensemble_version = self.control_plane.ensure_model_version(
            {
                "version_id": make_id("model"),
                "version_name": f"global-{architecture}-ensemble-v{make_id('ens')[:6]}",
                "architecture": architecture,
                "stage": "global",
                "base_version_id": None,
                "model_path": "",
                "requires_medsam_crop": True,
                "crop_mode": "both",
                "ensemble_mode": "weighted_average",
                "component_model_version_ids": [item["version_id"] for item in created_versions],
                "ensemble_weights": ensemble_selection["ensemble_weights"],
                "training_input_policy": "medsam_cornea_plus_lesion_ensemble",
                "created_at": utc_now(),
                "is_current": True,
                "notes": (
                    "Weighted-average ensemble of automated cornea crop and manual lesion-centered crop models. "
                    f"Selected weights on validation split: automated={ensemble_selection['ensemble_weights']['automated']:.2f}, "
                    f"manual={ensemble_selection['ensemble_weights']['manual']:.2f}."
                ),
                "notes_ko": (
                    "자동 cornea crop 모델과 manual lesion-centered crop 모델의 가중 평균 ensemble입니다. "
                    f"검증 분할에서 선택된 가중치: automated={ensemble_selection['ensemble_weights']['automated']:.2f}, "
                    f"manual={ensemble_selection['ensemble_weights']['manual']:.2f}."
                ),
                "notes_en": (
                    "Weighted-average ensemble of automated cornea crop and manual lesion-centered crop models. "
                    f"Selected weights on validation split: automated={ensemble_selection['ensemble_weights']['automated']:.2f}, "
                    f"manual={ensemble_selection['ensemble_weights']['manual']:.2f}."
                ),
                "ensemble_selection_metric": ensemble_selection["selection_metric"],
                "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
                "ensemble_validation_case_count": ensemble_selection["n_validation_cases"],
                "ready": True,
            }
        )
        emit_progress(
            stage="finalizing",
            message="Finalizing ensemble model registration.",
            percent=97,
        )
        emit_progress(
            stage="completed",
            message="Initial training completed.",
            percent=100,
        )
        return {
            "training_id": make_id("train"),
            "crop_mode": "both",
            "component_results": component_results,
            "ensemble_weights": ensemble_selection["ensemble_weights"],
            "ensemble_selection_metric": ensemble_selection["selection_metric"],
            "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
            "ensemble_validation_case_count": ensemble_selection["n_validation_cases"],
            "model_versions": created_versions + [ensemble_version],
            "model_version": ensemble_version,
            "version_name": ensemble_version["version_name"],
            "patient_split": shared_patient_split,
        }

    def run_cross_validation(
        self,
        site_store: SiteStore,
        architecture: str,
        output_dir: str,
        execution_device: str,
        crop_mode: str = "automated",
        num_folds: int = 5,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        use_pretrained: bool = True,
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("Cross-validation requires a non-empty dataset.")
        if not use_medsam_crops:
            raise ValueError("Cross-validation is MedSAM cornea-crop-only.")
        normalized_crop_mode = self._normalize_crop_mode(crop_mode)
        if normalized_crop_mode == "both":
            raise ValueError("Cross-validation currently supports automated or manual crop mode, not both.")

        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            crop_mode=normalized_crop_mode,
        )

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                    "crop_mode": normalized_crop_mode,
                    "fold_index": payload.get("fold_index"),
                    "num_folds": payload.get("num_folds", num_folds),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(
            stage="preparing_data",
            message="Preparing cross-validation splits.",
            percent=3,
        )

        def on_cross_validation_progress(progress: dict[str, Any]) -> None:
            stage = str(progress.get("stage") or "running")
            fold_index = int(progress.get("fold_index") or 1)
            total_folds = int(progress.get("num_folds") or num_folds)
            if stage == "preparing_fold":
                percent = 8 + int(((fold_index - 1) / max(1, total_folds)) * 80)
                emit_progress(
                    stage="preparing_fold",
                    message=f"Preparing fold {fold_index}/{total_folds}.",
                    percent=percent,
                    fold_index=fold_index,
                    num_folds=total_folds,
                )
                return
            epoch = int(progress.get("epoch") or 0)
            total_epochs = int(progress.get("epochs") or epochs)
            fold_base = 10 + int(((fold_index - 1) * 80) / max(1, total_folds))
            fold_end = 10 + int((fold_index * 80) / max(1, total_folds))
            epoch_ratio = epoch / max(1, total_epochs)
            percent = fold_base + int((fold_end - fold_base) * epoch_ratio)
            emit_progress(
                stage="training_fold",
                message=f"Running fold {fold_index}/{total_folds}.",
                percent=percent,
                fold_index=fold_index,
                num_folds=total_folds,
                epoch=epoch,
                epochs=total_epochs,
                train_loss=round(float(progress.get("train_loss") or 0.0), 4),
                val_acc=round(float(progress.get("val_acc") or 0.0), 4),
            )

        result = self.model_manager.cross_validate(
            records=records,
            architecture=architecture,
            output_dir=output_dir,
            device=execution_device,
            num_folds=num_folds,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            use_pretrained=use_pretrained,
            progress_callback=on_cross_validation_progress,
        )
        emit_progress(
            stage="finalizing",
            message="Saving cross-validation report.",
            percent=96,
        )
        report = {
            **result,
            "site_id": site_store.site_id,
            "crop_mode": normalized_crop_mode,
            "training_input_policy": "medsam_cornea_crop_only" if normalized_crop_mode == "automated" else "medsam_lesion_crop_only",
        }
        report_path = site_store.validation_dir / f"{report['cross_validation_id']}.json"
        write_json(report_path, report)
        report["report_path"] = str(report_path)
        emit_progress(
            stage="completed",
            message="Cross-validation completed.",
            percent=100,
        )
        return report

    def run_local_fine_tuning(
        self,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        upload_type: str,
        epochs: int,
    ) -> dict[str, Any]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("No manifest records are available for fine-tuning.")
        crop_mode = self._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for local fine-tuning contributions.")
        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            crop_mode=crop_mode,
        )

        full_finetune = execution_device == "cuda"
        if execution_device == "cpu":
            epochs = min(int(epochs), 3)

        architecture = model_version.get("architecture", "cnn")
        output_model_path = site_store.update_dir / f"{make_id(architecture)}_weights.pt"
        result = self.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=full_finetune,
            epochs=int(epochs),
        )

        upload_path = Path(result["output_model_path"])
        if upload_type == "weight delta":
            upload_path = site_store.update_dir / f"{make_id('delta')}.pt"
            self.model_manager.save_weight_delta(
                model_version["model_path"],
                result["output_model_path"],
                upload_path,
            )
        elif upload_type == "aggregated update":
            upload_path = site_store.update_dir / f"{make_id('agg')}.pt"
            self.model_manager.save_weight_delta(
                model_version["model_path"],
                result["output_model_path"],
                upload_path,
            )

        update_id = make_id("update")
        update_metadata = {
            "update_id": update_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": upload_type,
            "execution_device": execution_device,
            "artifact_path": str(upload_path),
            **self.control_plane.store_model_update_artifact(
                upload_path,
                update_id=update_id,
                artifact_kind="delta" if upload_type == "weight delta" else "model",
            ),
            "created_at": utc_now(),
            "training_input_policy": "medsam_cornea_crop_only" if crop_mode == "automated" else "medsam_lesion_crop_only",
            "training_summary": result,
        }
        self.control_plane.register_model_update(update_metadata)
        return update_metadata
