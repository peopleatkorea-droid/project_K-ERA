from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from kera_research.domain import DENSENET_VARIANTS, INDEX_TO_LABEL, LABEL_TO_INDEX, make_id, utc_now
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

        rep_rows = case_df[case_df["is_representative"] == True]
        artifact_row = rep_rows.iloc[0] if not rep_rows.empty else case_df.iloc[0]

        # MedSAM crop이 필요한 모델(DenseNet)은 대표 이미지 crop 먼저 생성
        artifact_refs: dict[str, Any] = {
            "gradcam_path": None,
            "medsam_mask_path": None,
            "roi_crop_path": None,
        }
        if generate_medsam or requires_crop:
            artifact_name = Path(artifact_row["image_path"]).stem
            medsam_result = self.medsam_service.generate_roi(
                artifact_row["image_path"],
                site_store.medsam_mask_dir / f"{artifact_name}_mask.png",
                site_store.roi_crop_dir / f"{artifact_name}_crop.png",
            )
            artifact_refs["medsam_mask_path"] = medsam_result["medsam_mask_path"]
            artifact_refs["roi_crop_path"] = medsam_result["roi_crop_path"]

        # 추론: DenseNet은 crop 이미지로, 나머지는 원본으로
        image_probabilities: list[float] = []
        for _, row in case_df.iterrows():
            infer_path = row["image_path"]
            if requires_crop and artifact_refs["roi_crop_path"]:
                infer_path = artifact_refs["roi_crop_path"]
            prediction = self.model_manager.predict_image(model, infer_path, execution_device)
            image_probabilities.append(prediction.probability)

        predicted_probability = float(sum(image_probabilities) / len(image_probabilities))
        predicted_index = 1 if predicted_probability >= 0.5 else 0
        true_index = LABEL_TO_INDEX[case_df.iloc[0]["culture_category"]]

        if generate_gradcam:
            artifact_name = Path(artifact_row["image_path"]).stem
            gradcam_input = artifact_refs["roi_crop_path"] or artifact_row["image_path"]
            gradcam_path = self.model_manager.generate_explanation(
                model,
                model_version,
                gradcam_input,
                execution_device,
                site_store.gradcam_dir / f"{artifact_name}_gradcam.png",
                target_class=predicted_index,
            )
            artifact_refs["gradcam_path"] = gradcam_path

        validation_id = make_id("validation")
        case_prediction: dict[str, Any] = {
            "validation_id": validation_id,
            "patient_id": patient_id,
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

        # DenseNet은 crop 이미지 경로를 사용해야 합니다
        records = case_df.to_dict("records")
        requires_crop = model_version.get("requires_medsam_crop", False)
        if requires_crop:
            updated_records = []
            for rec in records:
                crop_candidates = list(site_store.roi_crop_dir.glob(f"{Path(rec['image_path']).stem}_crop.png"))
                if crop_candidates:
                    rec = {**rec, "image_path": str(crop_candidates[0])}
                updated_records.append(rec)
            records = updated_records

        full_finetune = execution_device == "cuda"
        epochs = min(3, 1) if execution_device == "cpu" else 3
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
        use_pretrained: bool = True,
        use_medsam_crops: bool = True,
        progress_callback: Any = None,
    ) -> dict[str, Any]:
        """사이트 전체 데이터로 DenseNet 초기 학습을 수행합니다.

        use_medsam_crops=True이면 이미 생성된 ROI crop 이미지를 우선 사용합니다.
        crop이 없는 이미지는 원본을 사용합니다.
        """
        manifest_df = site_store.generate_manifest()
        if manifest_df.empty:
            raise ValueError("학습 데이터가 없습니다. 먼저 이미지를 등록하세요.")

        records = manifest_df.to_dict("records")

        if use_medsam_crops:
            updated: list[dict[str, Any]] = []
            for rec in records:
                stem = Path(rec["image_path"]).stem
                crops = list(site_store.roi_crop_dir.glob(f"{stem}_crop.png"))
                if crops:
                    rec = {**rec, "image_path": str(crops[0])}
                updated.append(rec)
            records = updated

        result = self.model_manager.initial_train(
            records=records,
            architecture=architecture,
            output_model_path=output_model_path,
            device=execution_device,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size,
            val_split=val_split,
            use_pretrained=use_pretrained,
            progress_callback=progress_callback,
        )

        version_name = f"global-{architecture}-v{make_id('init')[:6]}"
        new_version = {
            "version_id": make_id("model"),
            "version_name": version_name,
            "architecture": architecture,
            "stage": "global",
            "base_version_id": None,
            "model_path": output_model_path,
            "requires_medsam_crop": use_medsam_crops,
            "created_at": utc_now(),
            "notes": f"Initial training: {result['n_train']} train / {result['n_val']} val, best val_acc={result['best_val_acc']:.3f}",
            "notes_ko": f"초기 학습 모델: train {result['n_train']}건 / val {result['n_val']}건, 최고 val_acc={result['best_val_acc']:.3f}",
            "notes_en": f"Initial training: {result['n_train']} train / {result['n_val']} val, best val_acc={result['best_val_acc']:.3f}",
            "ready": True,
        }
        self.control_plane.ensure_model_version(new_version)
        result["version_name"] = version_name
        result["model_version"] = new_version
        return result

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
