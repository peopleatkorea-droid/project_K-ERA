from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from kera_research.domain import DENSENET_VARIANTS, INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
from kera_research.services.artifacts import MedSAMService
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.modeling import ModelManager
from kera_research.storage import write_json


class ResearchWorkflowService:
    def __init__(self, control_plane: ControlPlaneStore) -> None:
        self.control_plane = control_plane
        self.model_manager = ModelManager()
        self.medsam_service = MedSAMService()

        for baseline in self.model_manager.ensure_baseline_models():
            self.control_plane.ensure_model_version(baseline)

    def _ensure_roi_crop(self, site_store: SiteStore, image_path: str) -> dict[str, str]:
        artifact_name = Path(image_path).stem
        mask_path = site_store.medsam_mask_dir / f"{artifact_name}_mask.png"
        crop_path = site_store.roi_crop_dir / f"{artifact_name}_crop.png"
        if crop_path.exists() and mask_path.exists():
            return {
                "medsam_mask_path": str(mask_path),
                "roi_crop_path": str(crop_path),
            }
        result = self.medsam_service.generate_roi(image_path, mask_path, crop_path)
        return {
            "medsam_mask_path": result["medsam_mask_path"],
            "roi_crop_path": result["roi_crop_path"],
        }

    def _prepare_records_for_model(
        self,
        site_store: SiteStore,
        records: list[dict[str, Any]],
        requires_crop: bool,
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        for record in records:
            item = {**record, "source_image_path": record["image_path"]}
            if requires_crop:
                roi = self._ensure_roi_crop(site_store, record["image_path"])
                item["medsam_mask_path"] = roi["medsam_mask_path"]
                item["roi_crop_path"] = roi["roi_crop_path"]
                item["image_path"] = roi["roi_crop_path"]
            prepared.append(item)
        return prepared

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

        requires_crop = model_version.get("requires_medsam_crop", False)
        model = self.model_manager.load_model(model_version, execution_device)
        grouped = manifest_df.groupby(["patient_id", "visit_date"], sort=False)
        case_predictions: list[dict[str, Any]] = []
        summary_targets: list[int] = []
        summary_predictions: list[int] = []
        summary_probabilities: list[float] = []

        for (patient_id, visit_date), patient_frame in grouped:
            prepared_records = self._prepare_records_for_model(
                site_store,
                patient_frame.to_dict("records"),
                requires_crop=requires_crop,
            )
            image_probabilities: list[float] = []
            artifact_refs: dict[str, Any] = {
                "gradcam_path": None,
                "medsam_mask_path": None,
                "roi_crop_path": None,
            }

            representative_rows = patient_frame[patient_frame["is_representative"] == True]
            artifact_row = representative_rows.iloc[0].to_dict() if not representative_rows.empty else patient_frame.iloc[0].to_dict()
            prepared_artifact = next(
                (
                    record
                    for record in prepared_records
                    if record["source_image_path"] == artifact_row["image_path"]
                ),
                prepared_records[0],
            )

            for record in prepared_records:
                prediction = self.model_manager.predict_image(model, record["image_path"], execution_device)
                image_probabilities.append(prediction.probability)

            predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
            predicted_index = 1 if predicted_probability >= 0.5 else 0
            true_index = LABEL_TO_INDEX[patient_frame.iloc[0]["culture_category"]]

            should_run_artifacts = bool(artifact_row["is_representative"]) or execution_device == "cuda"
            if should_run_artifacts and generate_medsam:
                roi = self._ensure_roi_crop(site_store, artifact_row["image_path"])
                artifact_refs["medsam_mask_path"] = roi["medsam_mask_path"]
                artifact_refs["roi_crop_path"] = roi["roi_crop_path"]
            if should_run_artifacts and generate_gradcam:
                artifact_name = Path(artifact_row["image_path"]).stem
                gradcam_path = self.model_manager.generate_explanation(
                    model,
                    model_version,
                    prepared_artifact["image_path"],
                    execution_device,
                    site_store.gradcam_dir / f"{artifact_name}_gradcam.png",
                    target_class=predicted_index,
                )
                artifact_refs["gradcam_path"] = gradcam_path

            case_predictions.append(
                {
                    "validation_id": "",
                    "patient_id": patient_id,
                    "visit_date": visit_date,
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

        requires_crop = model_version.get("requires_medsam_crop", False)
        model = self.model_manager.load_model(model_version, execution_device)
        prepared_records = self._prepare_records_for_model(
            site_store,
            case_df.to_dict("records"),
            requires_crop=requires_crop,
        )

        rep_rows = case_df[case_df["is_representative"] == True]
        artifact_row = rep_rows.iloc[0].to_dict() if not rep_rows.empty else case_df.iloc[0].to_dict()
        prepared_artifact = next(
            (
                record
                for record in prepared_records
                if record["source_image_path"] == artifact_row["image_path"]
            ),
            prepared_records[0],
        )

        artifact_refs: dict[str, Any] = {
            "gradcam_path": None,
            "medsam_mask_path": None,
            "roi_crop_path": None,
        }
        if generate_medsam or requires_crop:
            roi = self._ensure_roi_crop(site_store, artifact_row["image_path"])
            artifact_refs["medsam_mask_path"] = roi["medsam_mask_path"]
            artifact_refs["roi_crop_path"] = roi["roi_crop_path"]

        image_probabilities: list[float] = []
        for record in prepared_records:
            prediction = self.model_manager.predict_image(model, record["image_path"], execution_device)
            image_probabilities.append(prediction.probability)

        predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
        predicted_index = 1 if predicted_probability >= 0.5 else 0
        true_index = LABEL_TO_INDEX[case_df.iloc[0]["culture_category"]]

        if generate_gradcam:
            artifact_name = Path(artifact_row["image_path"]).stem
            gradcam_path = self.model_manager.generate_explanation(
                model,
                model_version,
                prepared_artifact["image_path"],
                execution_device,
                site_store.gradcam_dir / f"{artifact_name}_gradcam.png",
                target_class=predicted_index,
            )
            artifact_refs["gradcam_path"] = gradcam_path

        validation_id = make_id("validation")
        case_prediction: dict[str, Any] = {
            "validation_id": validation_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "true_label": INDEX_TO_LABEL[true_index],
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "prediction_probability": predicted_probability,
            "is_correct": bool(true_index == predicted_index),
            **artifact_refs,
        }

        summary: dict[str, Any] = {
            "validation_id": validation_id,
            "project_id": project_id,
            "site_id": site_store.site_id,
            "model_version": model_version["version_name"],
            "model_version_id": model_version["version_id"],
            "model_architecture": model_version.get("architecture", "densenet121"),
            "run_date": utc_now(),
            "patient_id": patient_id,
            "visit_date": visit_date,
            "n_images": int(len(case_df)),
            "predicted_label": INDEX_TO_LABEL[predicted_index],
            "true_label": INDEX_TO_LABEL[true_index],
            "is_correct": bool(true_index == predicted_index),
            "prediction_probability": predicted_probability,
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

        records = self._prepare_records_for_model(
            site_store,
            case_df.to_dict("records"),
            requires_crop=True,
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

        update_metadata: dict[str, Any] = {
            "update_id": make_id("update"),
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": "weight delta",
            "execution_device": execution_device,
            "artifact_path": str(delta_path),
            "n_cases": 1,
            "contributed_by": user_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
            "created_at": utc_now(),
            "training_input_policy": "medsam_roi_crop_only",
            "training_summary": result,
            "status": "pending_upload",
        }
        self.control_plane.register_model_update(update_metadata)

        contribution = {
            "contribution_id": make_id("contrib"),
            "user_id": user_id,
            "site_id": site_store.site_id,
            "patient_id": patient_id,
            "visit_date": visit_date,
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
        """사이트 전체 데이터로 DenseNet 초기 학습을 수행합니다."""
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")
        if not use_medsam_crops:
            raise ValueError("Initial training is MedSAM crop-only.")

        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            requires_crop=True,
        )
        saved_split = None if regenerate_split else site_store.load_patient_split() or None

        result = self.model_manager.initial_train(
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=execution_device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            test_split=test_split,
            use_pretrained=use_pretrained,
            saved_split=saved_split,
            progress_callback=progress_callback,
        )
        patient_split = {
            **result["patient_split"],
            "site_id": site_store.site_id,
        }
        site_store.save_patient_split(patient_split)
        result["patient_split"] = patient_split

        version_name = f"global-{architecture}-v{make_id('init')[:6]}"
        new_version = {
            "version_id": make_id("model"),
            "version_name": version_name,
            "architecture": architecture,
            "stage": "global",
            "base_version_id": None,
            "model_path": output_model_path,
            "requires_medsam_crop": use_medsam_crops,
            "training_input_policy": "medsam_roi_crop_only",
            "created_at": utc_now(),
            "is_current": True,
            "notes": (
                f"Initial training with MedSAM crops: "
                f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
            ),
            "notes_ko": (
                f"MedSAM crop 기반 초기 학습 모델: "
                f"train {result['n_train_patients']}명 / val {result['n_val_patients']}명 / test {result['n_test_patients']}명, "
                f"최고 val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
            ),
            "notes_en": (
                f"Initial training with MedSAM crops: "
                f"train {result['n_train_patients']} / val {result['n_val_patients']} / test {result['n_test_patients']} patients, "
                f"best val_acc={result['best_val_acc']:.3f}, test_acc={result['test_metrics']['accuracy']:.3f}"
            ),
            "ready": True,
        }
        self.control_plane.ensure_model_version(new_version)
        result["version_name"] = version_name
        result["model_version"] = new_version
        return result

    def run_cross_validation(
        self,
        site_store: SiteStore,
        architecture: str,
        output_dir: str,
        execution_device: str,
        num_folds: int = 5,
        epochs: int = 30,
        learning_rate: float = 1e-4,
        batch_size: int = 16,
        val_split: float = 0.2,
        use_pretrained: bool = True,
        use_medsam_crops: bool = True,
    ) -> dict[str, Any]:
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("Cross-validation requires a non-empty dataset.")
        if not use_medsam_crops:
            raise ValueError("Cross-validation is MedSAM crop-only.")

        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            requires_crop=True,
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
        )
        report = {
            **result,
            "site_id": site_store.site_id,
            "training_input_policy": "medsam_roi_crop_only",
        }
        report_path = site_store.validation_dir / f"{report['cross_validation_id']}.json"
        write_json(report_path, report)
        report["report_path"] = str(report_path)
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
        records = self._prepare_records_for_model(
            site_store,
            manifest_df.to_dict("records"),
            requires_crop=True,
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

        update_metadata = {
            "update_id": make_id("update"),
            "site_id": site_store.site_id,
            "base_model_version_id": model_version["version_id"],
            "architecture": architecture,
            "upload_type": upload_type,
            "execution_device": execution_device,
            "artifact_path": str(upload_path),
            "created_at": utc_now(),
            "training_input_policy": "medsam_roi_crop_only",
            "training_summary": result,
        }
        self.control_plane.register_model_update(update_metadata)
        return update_metadata
