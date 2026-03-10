from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from kera_research.domain import INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
from kera_research.services.artifacts import MedSAMService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.modeling import ModelManager


class ResearchWorkflowService:
    def __init__(self, control_plane: ControlPlaneStore) -> None:
        self.control_plane = control_plane
        self.model_manager = ModelManager()
        self.medsam_service = MedSAMService()

        for baseline in self.model_manager.ensure_baseline_models():
            self.control_plane.ensure_model_version(baseline)

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

        model = self.model_manager.load_model(model_version, execution_device)
        grouped = manifest_df.groupby("patient_id")
        case_predictions: list[dict[str, Any]] = []
        summary_targets: list[int] = []
        summary_predictions: list[int] = []
        summary_probabilities: list[float] = []

        for patient_id, patient_frame in grouped:
            image_probabilities: list[float] = []
            artifact_refs: dict[str, Any] = {
                "gradcam_path": None,
                "medsam_mask_path": None,
                "roi_crop_path": None,
            }

            representative_rows = patient_frame[patient_frame["is_representative"] == True]
            artifact_row = representative_rows.iloc[0] if not representative_rows.empty else patient_frame.iloc[0]

            for _, row in patient_frame.iterrows():
                prediction = self.model_manager.predict_image(model, row["image_path"], execution_device)
                image_probabilities.append(prediction.probability)

            predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
            predicted_index = 1 if predicted_probability >= 0.5 else 0
            true_index = LABEL_TO_INDEX[patient_frame.iloc[0]["culture_category"]]

            should_run_artifacts = bool(artifact_row["is_representative"]) or execution_device == "cuda"
            if should_run_artifacts and generate_medsam:
                artifact_name = Path(artifact_row["image_path"]).stem
                medsam_result = self.medsam_service.generate_roi(
                    artifact_row["image_path"],
                    site_store.medsam_mask_dir / f"{artifact_name}_mask.png",
                    site_store.roi_crop_dir / f"{artifact_name}_crop.png",
                )
                artifact_refs["medsam_mask_path"] = medsam_result["medsam_mask_path"]
                artifact_refs["roi_crop_path"] = medsam_result["roi_crop_path"]
            if should_run_artifacts and generate_gradcam:
                artifact_name = Path(artifact_row["image_path"]).stem
                gradcam_path = self.model_manager.generate_explanation(
                    model,
                    model_version,
                    artifact_row["image_path"],
                    execution_device,
                    site_store.gradcam_dir / f"{artifact_name}_gradcam.png",
                    target_class=predicted_index,
                )
                artifact_refs["gradcam_path"] = gradcam_path

            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": patient_id,
                    "true_label": INDEX_TO_LABEL[true_index],
                    "predicted_label": INDEX_TO_LABEL[predicted_index],
                    "prediction_probability": predicted_probability,
                    "is_correct": bool(true_index == predicted_index),
                    **artifact_refs,
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
            "n_images": int(len(manifest_df)),
            "AUROC": metrics["AUROC"],
            "accuracy": metrics["accuracy"],
            "sensitivity": metrics["sensitivity"],
            "specificity": metrics["specificity"],
            "F1": metrics["F1"],
        }
        saved_summary = self.control_plane.save_validation_run(summary, case_predictions)
        return saved_summary, case_predictions, manifest_df

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

        full_finetune = execution_device == "cuda"
        if execution_device == "cpu":
            epochs = min(int(epochs), 3)

        architecture = model_version.get("architecture", "cnn")
        output_model_path = site_store.update_dir / f"{make_id(architecture)}_weights.pt"
        result = self.model_manager.fine_tune(
            records=manifest_df.to_dict("records"),
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

        update_metadata = {
            "update_id": make_id("update"),
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": upload_type,
            "execution_device": execution_device,
            "artifact_path": str(upload_path),
            "created_at": utc_now(),
            "training_summary": result,
        }
        self.control_plane.register_model_update(update_metadata)
        return update_metadata
