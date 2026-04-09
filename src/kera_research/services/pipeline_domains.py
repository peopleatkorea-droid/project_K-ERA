from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from kera_research.config import CASE_REFERENCE_SALT_FINGERPRINT, MODEL_DISTRIBUTION_MODE
from kera_research.domain import INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
from kera_research.services.data_plane import SiteStore
from kera_research.storage import write_json

if TYPE_CHECKING:
    from kera_research.services.pipeline import ResearchWorkflowService


class ResearchValidationWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

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
        service = self.service
        case_records = site_store.case_records_for_visit(patient_id, visit_date)
        if not case_records:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        case_result = service._predict_case(
            site_store,
            case_records,
            model_version,
            execution_device,
            generate_gradcam=generate_gradcam,
            generate_medsam=generate_medsam,
        )
        predicted_probability = float(case_result["predicted_probability"])
        predicted_index = int(case_result["predicted_index"])
        true_index = int(case_result["true_index"])
        validation_mode = "labeled" if true_index != -1 else "inference_only"
        prediction_snapshot: dict[str, Any] | None = None
        try:
            prediction_snapshot = service.prediction_postmortem_analyzer.build_prediction_snapshot(
                site_store,
                case_records=case_records,
                model_version=model_version,
                execution_device=execution_device,
                case_result=case_result,
            )
        except Exception as exc:
            prediction_snapshot = {
                "error": str(exc),
                "model_version_id": model_version.get("version_id"),
                "model_version_name": model_version.get("version_name"),
                "execution_device": execution_device,
            }

        validation_id = make_id("validation")
        true_label = INDEX_TO_LABEL.get(true_index, "unknown") if true_index != -1 else None
        case_prediction: dict[str, Any] = {
            "validation_id": validation_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "validation_mode": validation_mode,
            "true_label": true_label,
            "predicted_label": INDEX_TO_LABEL.get(predicted_index, "unknown"),
            "prediction_probability": predicted_probability,
            "is_correct": bool(true_index == predicted_index) if true_index != -1 else None,
            "decision_threshold": case_result.get("decision_threshold"),
            "crop_mode": case_result.get("crop_mode"),
            "case_aggregation": case_result.get("case_aggregation"),
            "n_source_images": case_result.get("n_source_images"),
            "n_model_inputs": case_result.get("n_model_inputs"),
            "ensemble_weights": case_result.get("ensemble_weights"),
            "ensemble_component_predictions": case_result.get("ensemble_component_predictions"),
            "instance_attention_scores": case_result.get("instance_attention_scores"),
            "quality_weights": case_result.get("quality_weights"),
            "model_representative_source_image_path": case_result.get("model_representative_source_image_path"),
            "model_representative_image_path": case_result.get("model_representative_image_path"),
            "model_representative_index": case_result.get("model_representative_index"),
            "gradcam_path": case_result.get("gradcam_path"),
            "gradcam_heatmap_path": case_result.get("gradcam_heatmap_path"),
            "gradcam_cornea_path": case_result.get("gradcam_cornea_path"),
            "gradcam_cornea_heatmap_path": case_result.get("gradcam_cornea_heatmap_path"),
            "gradcam_lesion_path": case_result.get("gradcam_lesion_path"),
            "gradcam_lesion_heatmap_path": case_result.get("gradcam_lesion_heatmap_path"),
            "medsam_mask_path": case_result.get("medsam_mask_path"),
            "roi_crop_path": case_result.get("roi_crop_path"),
            "lesion_mask_path": case_result.get("lesion_mask_path"),
            "lesion_crop_path": case_result.get("lesion_crop_path"),
            "prediction_snapshot": prediction_snapshot,
        }

        summary: dict[str, Any] = {
            "validation_id": validation_id,
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version.get("architecture", "densenet121"),
            "crop_mode": case_result.get("crop_mode"),
            "case_aggregation": case_result.get("case_aggregation"),
            "validation_mode": validation_mode,
            "run_date": utc_now(),
            "patient_id": patient_id,
            "visit_date": visit_date,
            "n_images": int(len(case_records)),
            "n_model_inputs": int(case_result.get("n_model_inputs", len(case_records))),
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "true_label": true_label,
            "is_correct": bool(true_index == predicted_index) if true_index != -1 else None,
            "prediction_probability": predicted_probability,
            "ensemble_weights": case_result.get("ensemble_weights"),
        }
        saved_summary = service.control_plane.save_validation_run(summary, [case_prediction])
        site_store.record_case_validation_history(
            patient_id,
            visit_date,
            {
                "validation_id": saved_summary["validation_id"],
                "run_date": saved_summary.get("run_date"),
                "model_version": saved_summary.get("model_version"),
                "model_version_id": saved_summary.get("model_version_id"),
                "model_architecture": saved_summary.get("model_architecture"),
                "run_scope": "case",
                "validation_mode": validation_mode,
                "predicted_label": case_prediction.get("predicted_label"),
                "true_label": case_prediction.get("true_label"),
                "prediction_probability": case_prediction.get("prediction_probability"),
                "is_correct": case_prediction.get("is_correct"),
                "prediction_snapshot": prediction_snapshot,
            },
        )
        return saved_summary, [case_prediction]

    def preview_case_roi(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        service = self.service
        case_records = site_store.case_records_for_visit(patient_id, visit_date)
        if not case_records:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        previews: list[dict[str, Any]] = []
        for record in case_records:
            roi = service._ensure_roi_crop(site_store, record["image_path"])
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
        service = self.service
        image_records = site_store.list_images_for_visit(patient_id, visit_date)
        if not image_records:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        boxed_records = [
            record
            for record in image_records
            if isinstance(record.get("lesion_prompt_box"), dict)
        ]
        if not boxed_records:
            raise ValueError("This case requires at least one saved lesion box.")

        previews: list[dict[str, Any]] = []
        for record in boxed_records:
            lesion = service._ensure_lesion_crop(site_store, record)
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
                    "prompt_signature": lesion.get("prompt_signature"),
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

    def list_stored_case_lesion_previews(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
    ) -> list[dict[str, Any]]:
        service = self.service
        case_records = site_store.case_records_for_visit(patient_id, visit_date)
        if not case_records:
            raise ValueError(f"No images found for patient {patient_id} / {visit_date}.")

        boxed_records = [
            record
            for record in case_records
            if isinstance(record.get("lesion_prompt_box"), dict)
        ]
        if not boxed_records:
            return []

        previews: list[dict[str, Any]] = []
        for record in boxed_records:
            lesion = service._load_stored_lesion_crop(site_store, record)
            previews.append(
                {
                    "patient_id": patient_id,
                    "visit_date": visit_date,
                    "view": record.get("view", "unknown"),
                    "is_representative": bool(record.get("is_representative")),
                    "source_image_path": record["image_path"],
                    "lesion_mask_path": lesion.get("lesion_mask_path") if lesion else None,
                    "lesion_crop_path": lesion.get("lesion_crop_path") if lesion else None,
                    "backend": lesion.get("backend", "unknown") if lesion else "unknown",
                    "medsam_error": lesion.get("medsam_error") if lesion else None,
                    "lesion_prompt_box": record.get("lesion_prompt_box"),
                    "prompt_signature": lesion.get("prompt_signature") if lesion else service._lesion_prompt_box_signature(record.get("lesion_prompt_box")),
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

    def preview_image_lesion(
        self,
        site_store: SiteStore,
        image_id: str,
        *,
        lesion_prompt_box: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        service = self.service
        record = site_store.get_image(image_id)
        if record is None:
            raise ValueError("Image not found.")
        effective_box = lesion_prompt_box if lesion_prompt_box is not None else record.get("lesion_prompt_box")
        if not isinstance(effective_box, dict):
            raise ValueError("This image requires a saved lesion box.")
        lesion = service._ensure_lesion_crop(site_store, record, lesion_prompt_box=effective_box)
        return {
            "patient_id": record["patient_id"],
            "visit_date": record["visit_date"],
            "view": record.get("view", "unknown"),
            "is_representative": bool(record.get("is_representative")),
            "source_image_path": record["image_path"],
            "lesion_mask_path": lesion["lesion_mask_path"],
            "lesion_crop_path": lesion["lesion_crop_path"],
            "backend": lesion.get("backend", "unknown"),
            "medsam_error": lesion.get("medsam_error"),
            "lesion_prompt_box": effective_box,
            "prompt_signature": lesion.get("prompt_signature"),
        }


class ResearchContributionWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def contribute_case(
        self,
        site_store: SiteStore,
        patient_id: str,
        visit_date: str,
        model_version: dict[str, Any],
        execution_device: str,
        user_id: str,
        user_public_alias: str | None = None,
        contribution_group_id: str | None = None,
        registry_consent_granted: bool = False,
    ) -> dict[str, Any]:
        service = self.service
        policy_state = site_store.case_research_policy_state(patient_id, visit_date)
        if not policy_state.get("is_positive"):
            raise ValueError("Federated learning contribution is restricted to culture-positive cases.")
        if not policy_state.get("is_active"):
            raise ValueError("Federated learning contribution is restricted to active visits.")
        if not policy_state.get("has_images"):
            raise ValueError("Federated learning contribution requires at least one saved image.")
        if not bool(registry_consent_granted):
            raise ValueError("Join the research registry before contributing this case.")
        if not policy_state.get("is_registry_included"):
            raise ValueError("Include this case in the research registry before contributing it.")
        manifest_df = site_store.generate_manifest()
        case_df = manifest_df[
            (manifest_df["patient_id"] == patient_id)
            & (manifest_df["visit_date"] == visit_date)
        ]
        if case_df.empty:
            raise ValueError(f"No data found for patient {patient_id} / {visit_date}.")

        # Federated Learning Data Quality Filter:
        # Restrict contribution of model updates to cases with a confirmed ground truth label (bacterial/fungal).
        first_record = case_df.iloc[0]
        culture_cat = str(first_record.get("culture_category") or "unknown").strip().lower()
        if LABEL_TO_INDEX.get(culture_cat, -1) == -1:
            raise ValueError(
                f"Federated learning contribution requires a definitive Ground Truth (Bacterial or Fungal). "
                f"Case culture category {culture_cat!r} is not eligible."
            )

        crop_mode = service._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for local fine-tuning contributions.")

        records = service._prepare_records_for_model(
            site_store,
            case_df.to_dict("records"),
            crop_mode=crop_mode,
        )

        full_finetune = execution_device == "cuda"
        epochs = 1 if execution_device == "cpu" else 3
        architecture = model_version.get("architecture", "densenet121")
        output_model_path = site_store.update_dir / f"{make_id(architecture)}_weights.pth"

        result = service.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=full_finetune,
            epochs=epochs,
        )

        delta_path = site_store.update_dir / f"{make_id('delta')}.pth"
        base_model_path = service.model_manager.resolve_model_path(model_version, allow_download=True)
        service.model_manager.save_weight_delta(
            base_model_path,
            result["output_model_path"],
            delta_path,
        )

        update_id = make_id("update")
        artifact_metadata = service.control_plane.store_model_update_artifact(
            delta_path,
            update_id=update_id,
            artifact_kind="delta",
        )
        case_reference_id = service.control_plane.case_reference_id(site_store.site_id, patient_id, visit_date)
        approval_report, _approval_report_path = service._build_approval_report(
            site_store,
            case_df.to_dict("records"),
            records,
            update_id,
            patient_id,
            visit_date,
        )
        quality_summary = service._build_update_quality_summary(
            site_store,
            case_df.to_dict("records"),
            model_version,
            execution_device,
            delta_path,
            approval_report,
        )

        update_metadata: dict[str, Any] = {
            "update_id": update_id,
            "contribution_group_id": str(contribution_group_id or "").strip() or None,
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
            "preprocess_signature": service.model_manager.preprocess_signature(),
            "num_classes": len(LABEL_TO_INDEX),
            "crop_mode": crop_mode,
            "training_input_policy": self.service.training_workflow._training_input_policy_for_crop_mode(crop_mode),
            "training_summary": result,
            "approval_report": approval_report,
            "quality_summary": quality_summary,
            "status": "pending_review",
        }
        update_metadata = service.control_plane.register_model_update(update_metadata)
        update_metadata["experiment"] = service._register_experiment(
            site_store,
            experiment_type="case_contribution_fine_tuning",
            status="completed",
            created_at=str(update_metadata["created_at"]),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "base_model_version_id": model_version["version_id"],
                "architecture": architecture,
                "upload_type": "weight delta",
                "patient_id": patient_id,
                "visit_date": visit_date,
                "crop_mode": crop_mode,
            },
            metrics={
                "average_loss": result.get("average_loss"),
                "quality_score": quality_summary.get("quality_score") if isinstance(quality_summary, dict) else None,
            },
            report_payload=update_metadata,
            model_version=model_version,
        )

        contribution = {
            "contribution_id": make_id("contrib"),
            "contribution_group_id": str(contribution_group_id or "").strip() or None,
            "user_id": user_id,
            "public_alias": str(user_public_alias or "").strip() or None,
            "site_id": site_store.site_id,
            "case_reference_id": case_reference_id,
            "update_id": update_metadata["update_id"],
            "created_at": utc_now(),
        }
        service.control_plane.register_contribution(contribution)
        site_store.record_case_contribution_history(
            patient_id,
            visit_date,
            {
                "contribution_id": contribution["contribution_id"],
                "contribution_group_id": contribution.get("contribution_group_id"),
                "created_at": contribution["created_at"],
                "user_id": contribution["user_id"],
                "public_alias": contribution.get("public_alias"),
                "case_reference_id": contribution.get("case_reference_id"),
                "update_id": update_metadata["update_id"],
                "update_status": update_metadata.get("status"),
                "upload_type": update_metadata.get("upload_type"),
                "architecture": update_metadata.get("architecture"),
                "execution_device": update_metadata.get("execution_device"),
                "base_model_version_id": update_metadata.get("base_model_version_id"),
            },
        )
        site_store.mark_visit_fl_retained(
            patient_id,
            visit_date,
            scope="case_contribution_single_case",
            update_id=str(update_metadata.get("update_id") or "").strip() or None,
        )
        return update_metadata


class ResearchTrainingWorkflow:
    def __init__(self, service: ResearchWorkflowService) -> None:
        self.service = service

    def _validate_architecture_crop_mode(self, architecture: str, crop_mode: str) -> None:
        is_dual_input = self.service.model_manager.is_dual_input_architecture(architecture)
        if is_dual_input and crop_mode != "paired":
            raise ValueError("Dual-input fusion architectures require paired crop mode.")
        if crop_mode == "paired" and not is_dual_input:
            raise ValueError("Paired crop mode is currently reserved for dual-input fusion architectures.")

    def _training_input_policy_for_crop_mode(self, crop_mode: str) -> str:
        if crop_mode == "manual":
            return "medsam_lesion_crop_only"
        if crop_mode == "paired":
            return "medsam_cornea_plus_lesion_paired_fusion"
        if crop_mode == "raw":
            return "raw_or_model_defined"
        return "medsam_cornea_crop_only"

    def _crop_mode_description(self, crop_mode: str) -> str:
        if crop_mode == "manual":
            return "MedSAM lesion-centered crops"
        if crop_mode == "paired":
            return "paired cornea and lesion crops"
        if crop_mode == "raw":
            return "full-frame source images"
        return "MedSAM cornea crops"

    def _eligible_image_level_federated_rows(
        self,
        site_store: SiteStore,
    ) -> tuple[Any, list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("No manifest records are available for image-level federated learning.")

        eligible_case_keys: set[tuple[str, str]] = set()
        eligible_summaries: list[dict[str, Any]] = []
        skipped = {
            "not_positive": 0,
            "not_active": 0,
            "not_included": 0,
            "no_images": 0,
        }
        for summary in site_store.list_case_summaries():
            patient_id = str(summary.get("patient_id") or "").strip()
            visit_date = str(summary.get("visit_date") or "").strip()
            if not patient_id or not visit_date:
                continue
            try:
                policy_state = site_store.case_research_policy_state(patient_id, visit_date)
            except ValueError:
                continue
            if not bool(policy_state.get("is_positive")):
                skipped["not_positive"] += 1
                continue
            if not bool(policy_state.get("is_active")):
                skipped["not_active"] += 1
                continue
            if not bool(policy_state.get("is_registry_included")):
                skipped["not_included"] += 1
                continue
            if not bool(policy_state.get("has_images")):
                skipped["no_images"] += 1
                continue
            eligible_case_keys.add((patient_id, visit_date))
            eligible_summaries.append(summary)

        if not eligible_case_keys:
            raise ValueError(
                "No eligible culture-positive active registry-included cases with saved images are available for image-level federated learning."
            )

        manifest_rows = [
            row
            for row in manifest_df.to_dict("records")
            if (str(row.get("patient_id") or "").strip(), str(row.get("visit_date") or "").strip()) in eligible_case_keys
        ]
        if not manifest_rows:
            raise ValueError("Eligible federated learning cases do not have manifest rows yet.")

        eligible_manifest_df = manifest_df[
            manifest_df.apply(
                lambda row: (
                    str(row.get("patient_id") or "").strip(),
                    str(row.get("visit_date") or "").strip(),
                )
                in eligible_case_keys,
                axis=1,
            )
        ].copy()
        return eligible_manifest_df, manifest_rows, skipped, eligible_summaries

    def _eligible_visit_level_federated_rows(
        self,
        site_store: SiteStore,
    ) -> tuple[Any, list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
        return self._eligible_image_level_federated_rows(site_store)

    def run_image_level_federated_round(
        self,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        *,
        epochs: int = 1,
        learning_rate: float = 5e-5,
        batch_size: int = 8,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        service = self.service
        architecture = str(model_version.get("architecture") or "").strip().lower()
        if architecture != "convnext_tiny":
            raise ValueError("Image-level federated learning currently supports only ConvNeXt-Tiny.")
        if bool(model_version.get("bag_level", False)):
            raise ValueError("Image-level federated learning requires an image-level ConvNeXt-Tiny model.")

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                    "architecture": "convnext_tiny",
                    "model_version_id": model_version.get("version_id"),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "eligible_case_count": payload.get("eligible_case_count"),
                    "eligible_image_count": payload.get("eligible_image_count"),
                }
            )

        emit_progress(stage="preparing_data", message="Collecting eligible image-level FL cases.", percent=5)
        eligible_manifest_df, manifest_rows, skipped, eligible_summaries = self._eligible_image_level_federated_rows(site_store)
        crop_mode = service._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for image-level federated learning.")

        records = service._prepare_records_for_model(
            site_store,
            manifest_rows,
            crop_mode=crop_mode,
        )
        if not records:
            raise ValueError("No prepared image records are available for image-level federated learning.")

        eligible_case_count = int(len({(str(row.get("patient_id") or ""), str(row.get("visit_date") or "")) for row in manifest_rows}))
        eligible_image_count = int(len(records))
        if eligible_case_count < 1 or eligible_image_count < 1:
            raise ValueError("Image-level federated learning requires at least one eligible case and one image.")

        representative_summary = sorted(
            eligible_summaries,
            key=lambda item: (
                -int(item.get("image_count") or 0),
                str(item.get("patient_id") or ""),
                str(item.get("visit_date") or ""),
            ),
        )[0]
        representative_patient_id = str(representative_summary.get("patient_id") or "").strip()
        representative_visit_date = str(representative_summary.get("visit_date") or "").strip()
        representative_case_records = site_store.case_records_for_visit(representative_patient_id, representative_visit_date)
        representative_prepared_records = [
            item
            for item in records
            if str(item.get("patient_id") or "").strip() == representative_patient_id
            and str(item.get("visit_date") or "").strip() == representative_visit_date
        ]
        if not representative_case_records or not representative_prepared_records:
            raise ValueError("Representative case artifacts are unavailable for review packaging.")

        output_model_path = site_store.update_dir / f"{make_id('convnext_tiny_fl_round')}_weights.pth"

        def local_progress(epoch: int, total_epochs: int, train_loss: float, _val_acc: float | None = None) -> None:
            emit_progress(
                stage="training",
                message="Running local ConvNeXt-Tiny image-level update.",
                percent=10 + int(70 * (epoch / max(1, total_epochs))),
                epoch=epoch,
                epochs=total_epochs,
                train_loss=round(float(train_loss), 4),
                eligible_case_count=eligible_case_count,
                eligible_image_count=eligible_image_count,
            )

        result = service.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=True,
            epochs=max(1, int(epochs)),
            learning_rate=float(learning_rate),
            batch_size=int(batch_size),
            progress_callback=local_progress,
        )

        emit_progress(
            stage="packaging_delta",
            message="Packaging weight delta and review bundle.",
            percent=85,
            eligible_case_count=eligible_case_count,
            eligible_image_count=eligible_image_count,
        )
        delta_path = site_store.update_dir / f"{make_id('delta')}.pth"
        base_model_path = service.model_manager.resolve_model_path(model_version, allow_download=True)
        service.model_manager.save_weight_delta(
            base_model_path,
            result["output_model_path"],
            delta_path,
        )

        update_id = make_id("update")
        artifact_metadata = service.control_plane.store_model_update_artifact(
            delta_path,
            update_id=update_id,
            artifact_kind="delta",
        )
        approval_report, approval_report_path = service._build_approval_report(
            site_store,
            representative_case_records,
            representative_prepared_records,
            update_id,
            representative_patient_id,
            representative_visit_date,
        )
        approval_report["case_summary"] = {
            **dict(approval_report.get("case_summary") or {}),
            "image_count": eligible_image_count,
            "eligible_case_count": eligible_case_count,
            "eligible_image_count": eligible_image_count,
            "representative_patient_reference_id": service.control_plane.patient_reference_id(
                site_store.site_id,
                representative_patient_id,
            ),
            "representative_case_reference_id": service.control_plane.case_reference_id(
                site_store.site_id,
                representative_patient_id,
                representative_visit_date,
            ),
            "is_single_case_delta": False,
            "scope": "site_image_level_round",
        }
        approval_report["round_scope"] = {
            "round_type": "image_level_site_round",
            "architecture": "convnext_tiny",
            "base_model_version_id": model_version.get("version_id"),
            "eligible_case_count": eligible_case_count,
            "eligible_image_count": eligible_image_count,
            "skipped": skipped,
        }
        write_json(approval_report_path, approval_report)
        quality_summary = service._build_update_quality_summary(
            site_store,
            representative_case_records,
            model_version,
            execution_device,
            delta_path,
            approval_report,
        )

        emit_progress(
            stage="registering_update",
            message="Registering image-level federated update.",
            percent=95,
            eligible_case_count=eligible_case_count,
            eligible_image_count=eligible_image_count,
        )
        update_metadata: dict[str, Any] = {
            "update_id": update_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": "convnext_tiny",
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            **artifact_metadata,
            "n_cases": eligible_case_count,
            "n_images": eligible_image_count,
            "aggregation_weight": eligible_image_count,
            "aggregation_weight_unit": "images",
            "federated_round_type": "image_level_site_round",
            "representative_case_reference_id": approval_report["case_summary"].get("representative_case_reference_id"),
            "representative_patient_reference_id": approval_report["case_summary"].get("representative_patient_reference_id"),
            "salt_fingerprint": CASE_REFERENCE_SALT_FINGERPRINT,
            "created_at": utc_now(),
            "preprocess_signature": service.model_manager.preprocess_signature(),
            "num_classes": len(LABEL_TO_INDEX),
            "crop_mode": crop_mode,
            "training_input_policy": self._training_input_policy_for_crop_mode(crop_mode),
            "training_summary": {
                **result,
                "eligible_case_count": eligible_case_count,
                "eligible_image_count": eligible_image_count,
                "epochs": max(1, int(epochs)),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "fine_tuning_mode": "full",
            },
            "approval_report": approval_report,
            "quality_summary": quality_summary,
            "status": "pending_review",
        }
        update_metadata = service.control_plane.register_model_update(update_metadata)
        retained_cases: set[tuple[str, str]] = set()
        for records in eligible_case_groups:
            if not records:
                continue
            retained_cases.add(
                (
                    str(records[0].get("patient_id") or "").strip(),
                    str(records[0].get("visit_date") or "").strip(),
                )
            )
        for retained_patient_id, retained_visit_date in retained_cases:
            if retained_patient_id and retained_visit_date:
                site_store.mark_visit_fl_retained(
                    retained_patient_id,
                    retained_visit_date,
                    scope="image_level_site_round",
                    update_id=str(update_metadata.get("update_id") or "").strip() or None,
                )
        update_metadata["experiment"] = service._register_experiment(
            site_store,
            experiment_type="image_level_federated_round",
            status="completed",
            created_at=str(update_metadata["created_at"]),
            execution_device=execution_device,
            manifest_df=eligible_manifest_df,
            parameters={
                "base_model_version_id": model_version["version_id"],
                "architecture": "convnext_tiny",
                "epochs": max(1, int(epochs)),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "fine_tuning_mode": "full",
                "crop_mode": crop_mode,
                "aggregation_weight_unit": "images",
            },
            metrics={
                "average_loss": result.get("average_loss"),
                "eligible_case_count": eligible_case_count,
                "eligible_image_count": eligible_image_count,
                "quality_score": quality_summary.get("quality_score") if isinstance(quality_summary, dict) else None,
            },
            report_payload=update_metadata,
            model_version=model_version,
        )
        emit_progress(
            stage="completed",
            message="Image-level federated round completed.",
            percent=100,
            eligible_case_count=eligible_case_count,
            eligible_image_count=eligible_image_count,
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": execution_device,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
            "update": update_metadata,
            "eligible_case_count": eligible_case_count,
            "eligible_image_count": eligible_image_count,
            "skipped": skipped,
        }

    def run_visit_level_federated_round(
        self,
        site_store: SiteStore,
        model_version: dict[str, Any],
        execution_device: str,
        *,
        epochs: int = 1,
        learning_rate: float = 5e-5,
        batch_size: int = 4,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        service = self.service
        architecture = str(model_version.get("architecture") or "").strip().lower()
        if architecture != "efficientnet_v2_s_mil":
            raise ValueError("Visit-level federated learning currently supports only EfficientNetV2-S MIL.")
        if not bool(model_version.get("bag_level", False)):
            raise ValueError("Visit-level federated learning requires a bag-level EfficientNetV2-S MIL model.")

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                    "architecture": "efficientnet_v2_s_mil",
                    "model_version_id": model_version.get("version_id"),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "eligible_case_count": payload.get("eligible_case_count"),
                    "eligible_image_count": payload.get("eligible_image_count"),
                }
            )

        emit_progress(stage="preparing_data", message="Collecting eligible visit-level FL cases.", percent=5)
        eligible_manifest_df, manifest_rows, skipped, eligible_summaries = self._eligible_visit_level_federated_rows(site_store)
        crop_mode = service._resolve_model_crop_mode(model_version)
        if crop_mode == "both":
            raise ValueError("Ensemble models are not supported for visit-level federated learning.")

        records = service._prepare_records_for_model(
            site_store,
            manifest_rows,
            crop_mode=crop_mode,
        )
        if not records:
            raise ValueError("No prepared visit records are available for visit-level federated learning.")

        eligible_case_count = int(len({(str(row.get("patient_id") or ""), str(row.get("visit_date") or "")) for row in manifest_rows}))
        eligible_image_count = int(len(records))
        if eligible_case_count < 1 or eligible_image_count < 1:
            raise ValueError("Visit-level federated learning requires at least one eligible case and one image.")

        representative_summary = sorted(
            eligible_summaries,
            key=lambda item: (
                -int(item.get("image_count") or 0),
                str(item.get("patient_id") or ""),
                str(item.get("visit_date") or ""),
            ),
        )[0]
        representative_patient_id = str(representative_summary.get("patient_id") or "").strip()
        representative_visit_date = str(representative_summary.get("visit_date") or "").strip()
        representative_case_records = site_store.case_records_for_visit(representative_patient_id, representative_visit_date)
        representative_prepared_records = [
            item
            for item in records
            if str(item.get("patient_id") or "").strip() == representative_patient_id
            and str(item.get("visit_date") or "").strip() == representative_visit_date
        ]
        if not representative_case_records or not representative_prepared_records:
            raise ValueError("Representative case artifacts are unavailable for review packaging.")

        output_model_path = site_store.update_dir / f"{make_id('efficientnet_v2_s_mil_fl_round')}_weights.pth"

        def local_progress(epoch: int, total_epochs: int, train_loss: float, _val_acc: float | None = None) -> None:
            emit_progress(
                stage="training",
                message="Running local EfficientNetV2-S MIL visit-level update.",
                percent=10 + int(70 * (epoch / max(1, total_epochs))),
                epoch=epoch,
                epochs=total_epochs,
                train_loss=round(float(train_loss), 4),
                eligible_case_count=eligible_case_count,
                eligible_image_count=eligible_image_count,
            )

        result = service.model_manager.fine_tune(
            records=records,
            base_model_reference=model_version,
            output_model_path=output_model_path,
            device=execution_device,
            full_finetune=True,
            epochs=max(1, int(epochs)),
            learning_rate=float(learning_rate),
            batch_size=int(batch_size),
            progress_callback=local_progress,
        )

        emit_progress(
            stage="packaging_delta",
            message="Packaging visit-level weight delta and review bundle.",
            percent=85,
            eligible_case_count=eligible_case_count,
            eligible_image_count=eligible_image_count,
        )
        delta_path = site_store.update_dir / f"{make_id('delta')}.pth"
        base_model_path = service.model_manager.resolve_model_path(model_version, allow_download=True)
        service.model_manager.save_weight_delta(
            base_model_path,
            result["output_model_path"],
            delta_path,
        )

        update_id = make_id("update")
        artifact_metadata = service.control_plane.store_model_update_artifact(
            delta_path,
            update_id=update_id,
            artifact_kind="delta",
        )
        approval_report, approval_report_path = service._build_approval_report(
            site_store,
            representative_case_records,
            representative_prepared_records,
            update_id,
            representative_patient_id,
            representative_visit_date,
        )
        approval_report["case_summary"] = {
            **dict(approval_report.get("case_summary") or {}),
            "image_count": eligible_image_count,
            "eligible_case_count": eligible_case_count,
            "eligible_image_count": eligible_image_count,
            "representative_patient_reference_id": service.control_plane.patient_reference_id(
                site_store.site_id,
                representative_patient_id,
            ),
            "representative_case_reference_id": service.control_plane.case_reference_id(
                site_store.site_id,
                representative_patient_id,
                representative_visit_date,
            ),
            "is_single_case_delta": False,
            "scope": "site_visit_level_round",
        }
        approval_report["round_scope"] = {
            "round_type": "visit_level_site_round",
            "architecture": "efficientnet_v2_s_mil",
            "base_model_version_id": model_version.get("version_id"),
            "eligible_case_count": eligible_case_count,
            "eligible_image_count": eligible_image_count,
            "skipped": skipped,
        }
        write_json(approval_report_path, approval_report)
        quality_summary = service._build_update_quality_summary(
            site_store,
            representative_case_records,
            model_version,
            execution_device,
            delta_path,
            approval_report,
        )

        emit_progress(
            stage="registering_update",
            message="Registering visit-level federated update.",
            percent=95,
            eligible_case_count=eligible_case_count,
            eligible_image_count=eligible_image_count,
        )
        update_metadata: dict[str, Any] = {
            "update_id": update_id,
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": "efficientnet_v2_s_mil",
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            **artifact_metadata,
            "n_cases": eligible_case_count,
            "n_images": eligible_image_count,
            "aggregation_weight": eligible_case_count,
            "aggregation_weight_unit": "cases",
            "federated_round_type": "visit_level_site_round",
            "representative_case_reference_id": approval_report["case_summary"].get("representative_case_reference_id"),
            "representative_patient_reference_id": approval_report["case_summary"].get("representative_patient_reference_id"),
            "salt_fingerprint": CASE_REFERENCE_SALT_FINGERPRINT,
            "created_at": utc_now(),
            "preprocess_signature": service.model_manager.preprocess_signature(),
            "num_classes": len(LABEL_TO_INDEX),
            "crop_mode": crop_mode,
            "training_input_policy": self._training_input_policy_for_crop_mode(crop_mode),
            "training_summary": {
                **result,
                "eligible_case_count": eligible_case_count,
                "eligible_image_count": eligible_image_count,
                "epochs": max(1, int(epochs)),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "fine_tuning_mode": "full",
            },
            "approval_report": approval_report,
            "quality_summary": quality_summary,
            "status": "pending_review",
        }
        update_metadata = service.control_plane.register_model_update(update_metadata)
        retained_cases: set[tuple[str, str]] = set()
        for records in eligible_case_groups:
            if not records:
                continue
            retained_cases.add(
                (
                    str(records[0].get("patient_id") or "").strip(),
                    str(records[0].get("visit_date") or "").strip(),
                )
            )
        for retained_patient_id, retained_visit_date in retained_cases:
            if retained_patient_id and retained_visit_date:
                site_store.mark_visit_fl_retained(
                    retained_patient_id,
                    retained_visit_date,
                    scope="visit_level_site_round",
                    update_id=str(update_metadata.get("update_id") or "").strip() or None,
                )
        update_metadata["experiment"] = service._register_experiment(
            site_store,
            experiment_type="visit_level_federated_round",
            status="completed",
            created_at=str(update_metadata["created_at"]),
            execution_device=execution_device,
            manifest_df=eligible_manifest_df,
            parameters={
                "base_model_version_id": model_version["version_id"],
                "architecture": "efficientnet_v2_s_mil",
                "epochs": max(1, int(epochs)),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "fine_tuning_mode": "full",
                "crop_mode": crop_mode,
                "aggregation_weight_unit": "cases",
            },
            metrics={
                "average_loss": result.get("average_loss"),
                "eligible_case_count": eligible_case_count,
                "eligible_image_count": eligible_image_count,
                "quality_score": quality_summary.get("quality_score") if isinstance(quality_summary, dict) else None,
            },
            report_payload=update_metadata,
            model_version=model_version,
        )
        emit_progress(
            stage="completed",
            message="Visit-level federated round completed.",
            percent=100,
            eligible_case_count=eligible_case_count,
            eligible_image_count=eligible_image_count,
        )
        return {
            "site_id": site_store.site_id,
            "execution_device": execution_device,
            "model_version": {
                "version_id": model_version.get("version_id"),
                "version_name": model_version.get("version_name"),
                "architecture": model_version.get("architecture"),
            },
            "update": update_metadata,
            "eligible_case_count": eligible_case_count,
            "eligible_image_count": eligible_image_count,
            "skipped": skipped,
        }

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
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | None = None,
        case_aggregation: str = "mean",
        use_medsam_crops: bool = True,
        regenerate_split: bool = False,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        service = self.service
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")
        if not use_medsam_crops:
            raise ValueError("Initial training is MedSAM cornea-crop-only.")
        normalized_crop_mode = service._normalize_crop_mode(crop_mode)
        self._validate_architecture_crop_mode(architecture, normalized_crop_mode)
        normalized_case_aggregation = service.model_manager.normalize_case_aggregation(case_aggregation, architecture)
        normalized_pretraining_source = service.model_manager.normalize_training_pretraining_source(
            pretraining_source,
            use_pretrained=use_pretrained,
        )
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
                    "case_aggregation": normalized_case_aggregation,
                    "component_crop_mode": payload.get("component_crop_mode"),
                    "component_index": payload.get("component_index"),
                    "component_count": len(training_modes),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(stage="preparing_data", message="Preparing manifest and patient split.", percent=3)

        # Initial training should always reflect the current dataset rather than a stale saved split.
        effective_regenerate_split = True
        saved_split = None if effective_regenerate_split else site_store.load_patient_split() or None
        created_versions: list[dict[str, Any]] = []
        component_results: list[dict[str, Any]] = []
        shared_patient_split: dict[str, Any] | None = saved_split

        for component_index, component_crop_mode in enumerate(training_modes, start=1):
            emit_progress(
                stage="preparing_component",
                message=f"Preparing {component_crop_mode} training set.",
                percent=8 if len(training_modes) == 1 else 5 + int(((component_index - 1) / len(training_modes)) * 10),
                component_crop_mode=component_crop_mode,
                component_index=component_index,
            )
            records = service._prepare_records_for_model(
                site_store,
                manifest_df.to_dict("records"),
                crop_mode=component_crop_mode,
            )
            component_output_path = output_model_path
            if normalized_crop_mode == "both":
                output = Path(output_model_path)
                component_output_path = str(output.with_name(f"{output.stem}_{component_crop_mode}{output.suffix}"))

            training_start_percent = 10 + int(((component_index - 1) * 70) / len(training_modes))
            training_end_percent = 10 + int((component_index * 70) / len(training_modes))

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

            result = service.model_manager.initial_train(
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
                pretraining_source=normalized_pretraining_source,
                ssl_checkpoint_path=ssl_checkpoint_path,
                saved_split=shared_patient_split,
                crop_mode=component_crop_mode,
                case_aggregation=normalized_case_aggregation,
                training_input_policy=self._training_input_policy_for_crop_mode(component_crop_mode),
                progress_callback=component_progress_callback,
                fine_tuning_mode=fine_tuning_mode,
                backbone_learning_rate=backbone_learning_rate,
                head_learning_rate=head_learning_rate,
                warmup_epochs=warmup_epochs,
                early_stop_patience=early_stop_patience,
                partial_unfreeze_blocks=partial_unfreeze_blocks,
            )
            patient_split = {**result["patient_split"], "site_id": site_store.site_id}
            shared_patient_split = patient_split
            site_store.save_patient_split(patient_split)
            result["patient_split"] = patient_split
            result["crop_mode"] = component_crop_mode
            version_name = f"global-{architecture}-{component_crop_mode}-v{make_id('init')[:6]}"
            new_version = {
                "version_id": make_id("model"),
                "version_name": version_name,
                "model_name": "keratitis_cls",
                "architecture": architecture,
                "stage": "global",
                "base_version_id": None,
                "model_path": component_output_path,
                "filename": Path(component_output_path).name,
                "requires_medsam_crop": use_medsam_crops,
                "crop_mode": component_crop_mode,
                "case_aggregation": result.get("case_aggregation", normalized_case_aggregation),
                "bag_level": bool(result.get("bag_level", False)),
                "training_input_policy": self._training_input_policy_for_crop_mode(component_crop_mode),
                "preprocess_signature": service.model_manager.preprocess_signature(),
                "num_classes": len(LABEL_TO_INDEX),
                "decision_threshold": result.get("decision_threshold", 0.5),
                "threshold_selection_metric": result.get("threshold_selection_metric"),
                "threshold_selection_metrics": result.get("threshold_selection_metrics"),
                "created_at": utc_now(),
                "publish_required": MODEL_DISTRIBUTION_MODE == "download_url",
                "is_current": (
                    MODEL_DISTRIBUTION_MODE != "download_url"
                    and normalized_crop_mode != "both"
                    and component_crop_mode == normalized_crop_mode
                ),
                "notes": (
                    f"Initial training with {self._crop_mode_description(component_crop_mode)}"
                    f" using {result.get('case_aggregation', normalized_case_aggregation)} aggregation: "
                    f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                    f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "notes_ko": (
                    f"{'MedSAM cornea crop' if component_crop_mode == 'automated' else 'MedSAM lesion-centered crop' if component_crop_mode == 'manual' else 'paired cornea + lesion crop'} 기반 "
                    f"{result.get('case_aggregation', normalized_case_aggregation)} 집계 초기 학습 모델: "
                    f"train {result['n_train_patients']}명 / val {result['n_val_patients']}명 / test {result['n_test_patients']}명, "
                    f"최고 val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "notes_en": (
                    f"Initial training with {self._crop_mode_description(component_crop_mode)}"
                    f" using {result.get('case_aggregation', normalized_case_aggregation)} aggregation: "
                    f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                    f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
                ),
                "ready": True,
            }
            created_versions.append(service.control_plane.ensure_model_version(new_version))
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
            experiment = service._register_experiment(
                site_store,
                experiment_type="initial_training",
                status="completed",
                created_at=utc_now(),
                execution_device=execution_device,
                manifest_df=manifest_df,
                parameters={
                    "architecture": architecture,
                    "crop_mode": normalized_crop_mode,
                    "epochs": int(epochs),
                    "learning_rate": float(learning_rate),
                    "batch_size": int(batch_size),
                    "val_split": float(val_split),
                    "test_split": float(test_split),
                    "use_pretrained": bool(normalized_pretraining_source != "scratch"),
                    "pretraining_source": normalized_pretraining_source,
                    "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
                    "case_aggregation": normalized_case_aggregation,
                    "regenerate_split": bool(effective_regenerate_split),
                    "seed": 42,
                    "fine_tuning_mode": str(fine_tuning_mode or "full"),
                    "backbone_learning_rate": float(backbone_learning_rate) if backbone_learning_rate is not None else None,
                    "head_learning_rate": float(head_learning_rate) if head_learning_rate is not None else None,
                    "warmup_epochs": int(max(0, warmup_epochs)),
                    "early_stop_patience": int(early_stop_patience) if early_stop_patience is not None else None,
                    "partial_unfreeze_blocks": int(max(1, partial_unfreeze_blocks)),
                },
                metrics={
                    "best_val_acc": component_results[0].get("best_val_acc"),
                    "val_metrics": component_results[0].get("val_metrics"),
                    "test_metrics": component_results[0].get("test_metrics"),
                    "decision_threshold": component_results[0].get("decision_threshold"),
                },
                report_payload=component_results[0],
                model_version=created_versions[-1],
                patient_split=shared_patient_split,
            )
            component_results[0]["experiment"] = experiment
            emit_progress(
                stage="completed",
                message="Initial training completed.",
                percent=100,
                component_crop_mode=normalized_crop_mode,
                component_index=1,
            )
            return component_results[0]

        emit_progress(stage="selecting_ensemble", message="Optimizing ensemble weights on validation split.", percent=88)
        val_patient_ids = set(str(patient_id) for patient_id in (shared_patient_split or {}).get("val_patient_ids", []))
        validation_records = [
            record
            for record in manifest_df.to_dict("records")
            if str(record["patient_id"]) in val_patient_ids
        ]
        automated_version = next(
            (version for version in created_versions if service._resolve_model_crop_mode(version) == "automated"),
            created_versions[0],
        )
        manual_version = next(
            (version for version in created_versions if service._resolve_model_crop_mode(version) == "manual"),
            created_versions[-1],
        )
        ensemble_selection = service._optimize_ensemble_weights(
            site_store,
            validation_records,
            automated_version,
            manual_version,
            execution_device,
        )

        ensemble_version = service.control_plane.ensure_model_version(
            {
                "version_id": make_id("model"),
                "version_name": f"global-{architecture}-ensemble-v{make_id('ens')[:6]}",
                "model_name": "keratitis_cls",
                "architecture": architecture,
                "stage": "global",
                "base_version_id": None,
                "model_path": "",
                "requires_medsam_crop": True,
                "crop_mode": "both",
                "ensemble_mode": "weighted_average",
                "case_aggregation": "weighted_average",
                "bag_level": False,
                "component_model_version_ids": [item["version_id"] for item in created_versions],
                "ensemble_weights": ensemble_selection["ensemble_weights"],
                "training_input_policy": "medsam_cornea_plus_lesion_ensemble",
                "preprocess_signature": service.model_manager.preprocess_signature(),
                "num_classes": len(LABEL_TO_INDEX),
                "decision_threshold": ensemble_selection["decision_threshold"],
                "threshold_selection_metric": ensemble_selection["threshold_selection_metric"],
                "threshold_selection_metrics": ensemble_selection["threshold_selection_metrics"],
                "created_at": utc_now(),
                "publish_required": False,
                "is_current": MODEL_DISTRIBUTION_MODE != "download_url",
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
        emit_progress(stage="finalizing", message="Finalizing ensemble model registration.", percent=97)
        emit_progress(stage="completed", message="Initial training completed.", percent=100)
        experiment_result = {
            "training_id": make_id("train"),
            "crop_mode": "both",
            "case_aggregation": "weighted_average",
            "component_results": component_results,
            "ensemble_weights": ensemble_selection["ensemble_weights"],
            "ensemble_selection_metric": ensemble_selection["selection_metric"],
            "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
            "decision_threshold": ensemble_selection["decision_threshold"],
            "threshold_selection_metric": ensemble_selection["threshold_selection_metric"],
            "threshold_selection_metrics": ensemble_selection["threshold_selection_metrics"],
            "ensemble_validation_case_count": ensemble_selection["n_validation_cases"],
            "model_versions": created_versions + [ensemble_version],
            "model_version": ensemble_version,
            "version_name": ensemble_version["version_name"],
            "patient_split": shared_patient_split,
        }
        experiment = service._register_experiment(
            site_store,
            experiment_type="initial_training",
            status="completed",
            created_at=utc_now(),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "architecture": architecture,
                "crop_mode": "both",
                "epochs": int(epochs),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "val_split": float(val_split),
                "test_split": float(test_split),
                "use_pretrained": bool(normalized_pretraining_source != "scratch"),
                "pretraining_source": normalized_pretraining_source,
                "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
                "case_aggregation": normalized_case_aggregation,
                "regenerate_split": bool(effective_regenerate_split),
                "seed": 42,
            },
            metrics={
                "ensemble_selection_metric": ensemble_selection["selection_metric"],
                "ensemble_selection_metrics": ensemble_selection["selection_metrics"],
                "ensemble_weights": ensemble_selection["ensemble_weights"],
                "decision_threshold": ensemble_selection["decision_threshold"],
            },
            report_payload=experiment_result,
            model_version=ensemble_version,
            patient_split=shared_patient_split,
        )
        experiment_result["experiment"] = experiment
        return experiment_result

    def run_full_dataset_refit(
        self,
        site_store: SiteStore,
        architecture: str,
        output_model_path: str,
        execution_device: str,
        crop_mode: str = "automated",
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        use_pretrained: bool = True,
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | None = None,
        case_aggregation: str = "mean",
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
        fine_tuning_mode: str = "full",
        backbone_learning_rate: float | None = None,
        head_learning_rate: float | None = None,
        warmup_epochs: int = 0,
        early_stop_patience: int | None = None,
        partial_unfreeze_blocks: int = 1,
    ) -> dict[str, Any]:
        service = self.service
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")
        if not use_medsam_crops:
            raise ValueError("Full-dataset refit is MedSAM crop-based.")
        normalized_crop_mode = service._normalize_crop_mode(crop_mode)
        self._validate_architecture_crop_mode(architecture, normalized_crop_mode)
        normalized_case_aggregation = service.model_manager.normalize_case_aggregation(case_aggregation, architecture)
        normalized_pretraining_source = service.model_manager.normalize_training_pretraining_source(
            pretraining_source,
            use_pretrained=use_pretrained,
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
                    "case_aggregation": normalized_case_aggregation,
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(stage="preparing_refit", message="Preparing full-dataset refit records.", percent=5)
        records = service._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            crop_mode=normalized_crop_mode,
        )
        if not records:
            raise ValueError("No records are available for the requested full-dataset refit.")

        def refit_progress_callback(epoch: int, total_epochs: int, train_loss: float, val_acc: float | None) -> None:
            progress_ratio = epoch / max(1, total_epochs)
            percent = 10 + int(80 * progress_ratio)
            emit_progress(
                stage="training_refit",
                message="Training final model on all available cases.",
                percent=percent,
                epoch=epoch,
                epochs=total_epochs,
                train_loss=round(float(train_loss), 4),
                val_acc=round(float(val_acc), 4) if val_acc is not None else None,
            )

        result = service.model_manager.refit_all_cases(
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=execution_device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            use_pretrained=use_pretrained,
            pretraining_source=normalized_pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            crop_mode=normalized_crop_mode,
            case_aggregation=normalized_case_aggregation,
            training_input_policy=self._training_input_policy_for_crop_mode(normalized_crop_mode),
            progress_callback=refit_progress_callback,
            fine_tuning_mode=fine_tuning_mode,
            backbone_learning_rate=backbone_learning_rate,
            head_learning_rate=head_learning_rate,
            warmup_epochs=warmup_epochs,
            early_stop_patience=early_stop_patience,
            partial_unfreeze_blocks=partial_unfreeze_blocks,
        )
        patient_ids = list(dict.fromkeys(str(record["patient_id"]) for record in records))
        refit_scope = {
            "split_id": make_id("split"),
            "strategy": "patient_level_full_dataset_refit",
            "site_id": site_store.site_id,
            "patient_ids": patient_ids,
            "n_train_patients": len(patient_ids),
            "n_train": len(records),
            "created_at": utc_now(),
        }
        version_name = f"global-{architecture}-{normalized_crop_mode}-refitall-v{make_id('refit')[:6]}"
        new_version = {
            "version_id": make_id("model"),
            "version_name": version_name,
            "model_name": "keratitis_cls",
            "architecture": architecture,
            "stage": "global",
            "base_version_id": None,
            "model_path": output_model_path,
            "filename": Path(output_model_path).name,
            "requires_medsam_crop": use_medsam_crops,
            "crop_mode": normalized_crop_mode,
            "case_aggregation": result.get("case_aggregation", normalized_case_aggregation),
            "bag_level": bool(result.get("bag_level", False)),
            "training_input_policy": self._training_input_policy_for_crop_mode(normalized_crop_mode),
            "preprocess_signature": service.model_manager.preprocess_signature(),
            "num_classes": len(LABEL_TO_INDEX),
            "decision_threshold": result.get("decision_threshold", 0.5),
            "threshold_selection_metric": result.get("threshold_selection_metric", "default"),
            "threshold_selection_metrics": result.get("threshold_selection_metrics"),
            "created_at": utc_now(),
            "publish_required": False,
            "is_current": False,
            "notes": (
                f"Full-dataset refit on all available cases with {self._crop_mode_description(normalized_crop_mode)} "
                f"using {result.get('case_aggregation', normalized_case_aggregation)} aggregation: "
                f"{len(patient_ids)} patients / {len(records)} records, best train_loss={float(result.get('best_train_loss') or 0.0):.4f}. "
                "This model was trained after winner selection and does not include a holdout evaluation split."
            ),
            "notes_ko": (
                f"{self._crop_mode_description(normalized_crop_mode)} 기반 "
                f"{result.get('case_aggregation', normalized_case_aggregation)} 집계로 전체 데이터 refit: "
                f"{len(patient_ids)}명 / {len(records)} records, best train_loss={float(result.get('best_train_loss') or 0.0):.4f}. "
                "winner 선정 후 전체 데이터로 다시 학습한 모델이며, 별도 holdout 평가는 포함하지 않습니다."
            ),
            "notes_en": (
                f"Full-dataset refit on all available cases with {self._crop_mode_description(normalized_crop_mode)} "
                f"using {result.get('case_aggregation', normalized_case_aggregation)} aggregation: "
                f"{len(patient_ids)} patients / {len(records)} records, best train_loss={float(result.get('best_train_loss') or 0.0):.4f}. "
                "This model was trained after winner selection and does not include a holdout evaluation split."
            ),
            "ready": True,
        }
        model_version = service.control_plane.ensure_model_version(new_version)
        result["model_version"] = model_version
        result["version_name"] = version_name
        result["patient_split"] = refit_scope
        experiment = service._register_experiment(
            site_store,
            experiment_type="final_refit",
            status="completed",
            created_at=utc_now(),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "architecture": architecture,
                "crop_mode": normalized_crop_mode,
                "epochs": int(epochs),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "use_pretrained": bool(normalized_pretraining_source != "scratch"),
                "pretraining_source": normalized_pretraining_source,
                "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
                "case_aggregation": normalized_case_aggregation,
                "seed": 42,
                "full_dataset_refit": True,
                "fine_tuning_mode": str(fine_tuning_mode or "full"),
                "backbone_learning_rate": float(backbone_learning_rate) if backbone_learning_rate is not None else None,
                "head_learning_rate": float(head_learning_rate) if head_learning_rate is not None else None,
                "warmup_epochs": int(max(0, warmup_epochs)),
                "early_stop_patience": int(early_stop_patience) if early_stop_patience is not None else None,
                "partial_unfreeze_blocks": int(max(1, partial_unfreeze_blocks)),
            },
            metrics={
                "best_train_loss": result.get("best_train_loss"),
                "epochs_completed": result.get("epochs_completed"),
                "stopped_early": result.get("stopped_early"),
                "decision_threshold": result.get("decision_threshold", 0.5),
            },
            report_payload=result,
            model_version=model_version,
            patient_split=refit_scope,
        )
        result["experiment"] = experiment
        emit_progress(stage="completed", message="Full-dataset refit completed.", percent=100)
        return result

    def run_retrieval_baseline(
        self,
        site_store: SiteStore,
        execution_device: str,
        crop_mode: str = "automated",
        top_k: int = 10,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        import numpy as np

        from kera_research.services.retrieval import Dinov2ImageRetriever

        service = self.service
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")

        def emit_progress(**payload: Any) -> None:
            if progress_callback is None:
                return
            progress_callback(
                {
                    "stage": payload.get("stage"),
                    "message": payload.get("message"),
                    "percent": int(payload.get("percent", 0)),
                }
            )

        emit_progress(stage="preparing_data", message="Preparing records.", percent=5)
        records = service._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            crop_mode=crop_mode,
        )
        if not records:
            raise ValueError("No readable images after applying crop mode.")

        # Group by patient_id
        from collections import defaultdict

        patient_to_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in records:
            patient_to_records[str(record["patient_id"])].append(record)

        patient_ids = sorted(patient_to_records.keys())
        n_patients = len(patient_ids)
        if n_patients < 2:
            raise ValueError("At least 2 patients required for LOOCV retrieval baseline.")

        emit_progress(stage="embedding", message="Extracting embeddings for all images.", percent=10)
        retriever = Dinov2ImageRetriever()
        all_image_paths = [str(record["image_path"]) for record in records]
        all_embeddings = retriever.encode_images(all_image_paths, execution_device)

        # Map image_path → embedding index
        path_to_idx = {path: i for i, path in enumerate(all_image_paths)}

        patient_embeddings: dict[str, np.ndarray] = {}
        patient_labels: dict[str, int] = {}
        for patient_id in patient_ids:
            patient_records = patient_to_records[patient_id]
            patient_indices = [path_to_idx[str(record["image_path"])] for record in patient_records]
            patient_embedding = np.mean(all_embeddings[patient_indices], axis=0).astype(np.float32)
            patient_norm = float(np.linalg.norm(patient_embedding))
            patient_embeddings[patient_id] = patient_embedding / max(patient_norm, 1e-12)
            patient_labels[patient_id] = LABEL_TO_INDEX[str(patient_records[0]["culture_category"])]

        true_labels: list[int] = []
        predicted_labels: list[int] = []
        positive_probabilities: list[float] = []
        test_predictions: list[dict[str, Any]] = []
        softmax_temperature = 0.1

        emit_progress(stage="loocv", message="Running leave-one-patient-out evaluation.", percent=20)
        for patient_idx, query_patient_id in enumerate(patient_ids):
            query_records = patient_to_records[query_patient_id]
            db_patient_ids = [patient_id for patient_id in patient_ids if patient_id != query_patient_id]
            if not db_patient_ids:
                continue

            query_embedding = patient_embeddings[query_patient_id]
            db_embeddings = np.stack([patient_embeddings[patient_id] for patient_id in db_patient_ids], axis=0)
            db_labels_int = [patient_labels[patient_id] for patient_id in db_patient_ids]

            # Cosine similarity
            similarities = db_embeddings @ query_embedding  # shape (N,)

            # Top-K temperature-softmax vote over patient-level neighbors.
            k = min(top_k, len(db_patient_ids))
            top_indices = np.argsort(similarities)[::-1][:k]
            top_sims = similarities[top_indices]
            top_labels = [db_labels_int[i] for i in top_indices]
            stabilized_logits = (top_sims - float(np.max(top_sims))) / softmax_temperature
            vote_weights = np.exp(stabilized_logits)
            weight_total = float(np.sum(vote_weights))
            if weight_total <= 1e-12:
                p_fungal = 0.5
            else:
                p_fungal = float(
                    np.sum([weight for weight, label in zip(vote_weights.tolist(), top_labels) if label == 1]) / weight_total
                )

            patient_label = patient_labels[query_patient_id]
            predicted_label = 1 if p_fungal >= 0.5 else 0
            true_labels.append(patient_label)
            predicted_labels.append(predicted_label)
            positive_probabilities.append(float(p_fungal))
            test_predictions.append(
                {
                    "sample_key": f"patient::{query_patient_id}",
                    "sample_kind": "patient",
                    "patient_id": query_patient_id,
                    "visit_date": None,
                    "true_label": INDEX_TO_LABEL[patient_label],
                    "true_label_index": patient_label,
                    "predicted_label": INDEX_TO_LABEL[predicted_label],
                    "predicted_label_index": predicted_label,
                    "positive_probability": float(p_fungal),
                    "is_correct": bool(patient_label == predicted_label),
                    "source_image_paths": [str(record["image_path"]) for record in query_records],
                }
            )

            percent = 20 + int((patient_idx + 1) / n_patients * 75)
            emit_progress(
                stage="loocv",
                message=f"Evaluated {patient_idx + 1}/{n_patients} patients.",
                percent=percent,
            )

        if not true_labels:
            raise ValueError("No patient-level predictions were produced.")

        emit_progress(stage="metrics", message="Computing metrics.", percent=96)
        metrics = service.model_manager.classification_metrics(true_labels, predicted_labels, positive_probabilities)

        training_id = make_id("retrieval")
        n_total_images = len(records)
        result: dict[str, Any] = {
            "training_id": training_id,
            "version_name": f"retrieval-dinov2-loocv-{training_id[:8]}",
            "output_model_path": "",
            "n_train": 0,
            "n_val": 0,
            "n_test": n_patients,
            "n_test_cases": n_patients,
            "n_test_images": n_total_images,
            "n_train_patients": 0,
            "n_val_patients": 0,
            "n_test_patients": n_patients,
            "best_val_acc": None,
            "use_pretrained": True,
            "crop_mode": crop_mode,
            "top_k": top_k,
            "evaluation_mode": "loocv_patient_level",
            "vote_mode": "temperature_softmax_patient_knn",
            "softmax_temperature": softmax_temperature,
            "val_metrics": metrics,
            "test_metrics": metrics,
            "test_predictions": test_predictions,
        }
        emit_progress(stage="completed", message="Retrieval baseline LOOCV completed.", percent=100)
        return result

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
        pretraining_source: str | None = None,
        ssl_checkpoint_path: str | None = None,
        case_aggregation: str = "mean",
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        service = self.service
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("Cross-validation requires a non-empty dataset.")
        if not use_medsam_crops:
            raise ValueError("Cross-validation is MedSAM cornea-crop-only.")
        normalized_crop_mode = service._normalize_crop_mode(crop_mode)
        self._validate_architecture_crop_mode(architecture, normalized_crop_mode)
        normalized_case_aggregation = service.model_manager.normalize_case_aggregation(case_aggregation, architecture)
        normalized_pretraining_source = service.model_manager.normalize_training_pretraining_source(
            pretraining_source,
            use_pretrained=use_pretrained,
        )
        if normalized_crop_mode == "both":
            raise ValueError("Cross-validation currently supports automated, manual, or paired crop mode, not both.")

        records = service._prepare_records_for_model(
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
                    "case_aggregation": normalized_case_aggregation,
                    "fold_index": payload.get("fold_index"),
                    "num_folds": payload.get("num_folds", num_folds),
                    "epoch": payload.get("epoch"),
                    "epochs": payload.get("epochs"),
                    "train_loss": payload.get("train_loss"),
                    "val_acc": payload.get("val_acc"),
                }
            )

        emit_progress(stage="preparing_data", message="Preparing cross-validation splits.", percent=3)

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

        result = service.model_manager.cross_validate(
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
            pretraining_source=normalized_pretraining_source,
            ssl_checkpoint_path=ssl_checkpoint_path,
            case_aggregation=normalized_case_aggregation,
            progress_callback=on_cross_validation_progress,
        )
        emit_progress(stage="finalizing", message="Saving cross-validation report.", percent=96)
        report = {
            **result,
            "site_id": site_store.site_id,
            "crop_mode": normalized_crop_mode,
            "case_aggregation": normalized_case_aggregation,
            "training_input_policy": self._training_input_policy_for_crop_mode(normalized_crop_mode),
        }
        report_path = site_store.validation_dir / f"{report['cross_validation_id']}.json"
        write_json(report_path, report)
        report["report_path"] = str(report_path)
        report["experiment"] = service._register_experiment(
            site_store,
            experiment_type="cross_validation",
            status="completed",
            created_at=str(report.get("created_at") or utc_now()),
            execution_device=execution_device,
            manifest_df=manifest_df,
            parameters={
                "architecture": architecture,
                "crop_mode": normalized_crop_mode,
                "num_folds": int(num_folds),
                "epochs": int(epochs),
                "learning_rate": float(learning_rate),
                "batch_size": int(batch_size),
                "val_split": float(val_split),
                "use_pretrained": bool(normalized_pretraining_source != "scratch"),
                "pretraining_source": normalized_pretraining_source,
                "ssl_checkpoint_path": str(ssl_checkpoint_path) if ssl_checkpoint_path else None,
                "case_aggregation": normalized_case_aggregation,
                "seed": 42,
            },
            metrics=report.get("aggregate_metrics", {}),
            report_payload=report,
            model_version=None,
        )
        emit_progress(stage="completed", message="Cross-validation completed.", percent=100)
        return report
