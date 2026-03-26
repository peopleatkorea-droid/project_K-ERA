from __future__ import annotations

import argparse
import json
import logging
import os
import smtplib
import ssl
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.config import STORAGE_DIR
from kera_research.domain import utc_now
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.ssl_archive import scan_ssl_archive, write_ssl_archive_outputs
from kera_research.services.ssl_pretraining import SSLTrainingConfig, resolve_device, run_ssl_pretraining_with_progress

LOGGER = logging.getLogger("transformer_weekend_plan")


@dataclass(slots=True)
class SSLStageSpec:
    stage_id: str
    title: str
    architecture: str
    augment_preset: str
    epochs: int
    batch_size: int
    learning_rate: float
    weight_decay: float
    image_size: int = 224
    init_mode: str = "imagenet"
    num_workers: int = 8
    min_patient_quality: str = "medium"
    include_review_rows: bool = False
    use_amp: bool = True
    estimated_hours: float = 6.0
    stage_type: str = field(init=False, default="ssl")


@dataclass(slots=True)
class TrainStageSpec:
    stage_id: str
    title: str
    architecture: str
    pretraining_source: str
    fine_tuning_mode: str
    learning_rate: float
    batch_size: int
    epochs: int
    crop_mode: str = "automated"
    case_aggregation: str = "mean"
    val_split: float = 0.2
    test_split: float = 0.2
    backbone_learning_rate: float | None = None
    head_learning_rate: float | None = None
    warmup_epochs: int = 0
    early_stop_patience: int | None = None
    partial_unfreeze_blocks: int = 1
    ssl_stage_id: str | None = None
    candidate_group: str | None = None
    select_best_from_group: str | None = None
    final_variant: str | None = None
    inherit_selected_hyperparameters: bool = False
    use_full_dataset_refit: bool = False
    estimated_hours: float = 2.5
    stage_type: str = field(init=False, default="train")


@dataclass(slots=True)
class SMTPSettings:
    host: str
    port: int
    username: str
    password: str
    sender: str
    use_tls: bool = True


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare and run the weekend ViT -> DINOv2 -> Swin transformer experiment plan.",
    )
    parser.add_argument("--archive-base-dir", type=Path, default=Path(r"C:\전안부 사진"))
    parser.add_argument("--site-id", default="", help="Site ID for downstream training. Default: auto-detect largest non-empty site.")
    parser.add_argument("--device", default="cuda", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--plan-root", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true", help="Write the resolved plan without starting any experiments.")
    parser.add_argument("--email-to", default=os.getenv("KERA_NOTIFICATION_EMAIL_TO", ""))
    parser.add_argument("--email-interval-minutes", type=int, default=90)
    parser.add_argument("--heartbeat-dir", type=Path, default=STORAGE_DIR / "weekend_plan_logs")
    parser.add_argument("--heartbeat-interval-hours", type=float, default=3.0)
    parser.add_argument("--ssl-epochs", type=int, default=12)
    parser.add_argument("--ssl-learning-rate", type=float, default=1e-4)
    parser.add_argument("--ssl-weight-decay", type=float, default=1e-4)
    parser.add_argument("--ssl-num-workers", type=int, default=8)
    parser.add_argument("--train-epochs", type=int, default=30)
    parser.add_argument("--train-batch-size", type=int, default=16)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--test-split", type=float, default=0.2)
    parser.add_argument("--include-current-ssl-controls", action="store_true")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def configure_logging(log_path: Path, log_level: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=getattr(logging, str(log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path, encoding="utf-8"),
        ],
    )


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def detect_site_id() -> tuple[str, dict[str, Any]]:
    sites_root = STORAGE_DIR / "sites"
    candidates: list[tuple[int, str, dict[str, Any]]] = []
    if not sites_root.exists():
        raise RuntimeError(f"Sites root does not exist: {sites_root}")
    for site_dir in sorted(sites_root.iterdir()):
        if not site_dir.is_dir():
            continue
        try:
            summary = SiteStore(site_dir.name).site_summary_stats()
        except Exception as exc:
            LOGGER.warning("Skipping site %s during auto-detect: %s", site_dir.name, exc)
            continue
        image_count = int(summary.get("n_images") or 0)
        if image_count <= 0:
            continue
        candidates.append((image_count, site_dir.name, summary))
    if not candidates:
        raise RuntimeError("No non-empty local site could be auto-detected.")
    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    best = candidates[0]
    return best[1], best[2]


def resolve_site_id(requested_site_id: str) -> tuple[str, dict[str, Any]]:
    normalized = str(requested_site_id or "").strip()
    if normalized:
        store = SiteStore(normalized)
        return normalized, store.site_summary_stats()
    return detect_site_id()


def load_smtp_settings() -> SMTPSettings | None:
    username = str(os.getenv("KERA_SMTP_USERNAME") or "").strip()
    password = str(os.getenv("KERA_SMTP_PASSWORD") or "").strip()
    host = str(os.getenv("KERA_SMTP_HOST") or "").strip()
    sender = str(os.getenv("KERA_SMTP_FROM") or username).strip()
    if not username or not password:
        return None
    if not host:
        host = "smtp.gmail.com" if username.lower().endswith("@gmail.com") else ""
    if not host:
        return None
    port = int(str(os.getenv("KERA_SMTP_PORT") or "587").strip() or "587")
    use_tls = str(os.getenv("KERA_SMTP_USE_TLS") or "true").strip().lower() not in {"0", "false", "no"}
    return SMTPSettings(
        host=host,
        port=port,
        username=username,
        password=password,
        sender=sender or username,
        use_tls=use_tls,
    )


class EmailNotifier:
    def __init__(self, *, recipient: str, settings: SMTPSettings | None, plan_id: str) -> None:
        self.recipient = str(recipient or "").strip()
        self.settings = settings
        self.plan_id = plan_id

    @property
    def enabled(self) -> bool:
        return bool(self.recipient and self.settings is not None)

    def send(self, subject: str, body: str) -> None:
        if not self.enabled:
            return
        assert self.settings is not None
        message = EmailMessage()
        message["Subject"] = subject
        message["From"] = self.settings.sender
        message["To"] = self.recipient
        message.set_content(body)
        try:
            with smtplib.SMTP(self.settings.host, self.settings.port, timeout=30) as server:
                if self.settings.use_tls:
                    server.starttls(context=ssl.create_default_context())
                server.login(self.settings.username, self.settings.password)
                server.send_message(message)
        except Exception as exc:
            LOGGER.warning("Email notification failed: %s", exc)


def default_ssl_batch_size(architecture: str) -> int:
    return {"vit": 12, "swin": 12}.get(str(architecture or "").strip().lower(), 12)


def default_experiment_stages(args: argparse.Namespace) -> list[SSLStageSpec | TrainStageSpec]:
    ssl_epochs = int(args.ssl_epochs)
    ssl_lr = float(args.ssl_learning_rate)
    ssl_weight_decay = float(args.ssl_weight_decay)
    batch_size = int(args.train_batch_size)
    train_epochs = int(args.train_epochs)
    val_split = float(args.val_split)
    test_split = float(args.test_split)

    stages: list[SSLStageSpec | TrainStageSpec] = [
        TrainStageSpec(
            stage_id="vit_baseline_full",
            title="ViT baseline full fine-tuning",
            architecture="vit",
            pretraining_source="imagenet",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=8e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=6,
            estimated_hours=2.5,
        ),
        SSLStageSpec(
            stage_id="vit_ssl_weak_ocular",
            title="ViT SSL pretraining (weak ocular recipe)",
            architecture="vit",
            augment_preset="weak_ocular",
            epochs=ssl_epochs,
            batch_size=default_ssl_batch_size("vit"),
            learning_rate=ssl_lr,
            weight_decay=ssl_weight_decay,
            num_workers=int(args.ssl_num_workers),
            estimated_hours=6.0,
        ),
        TrainStageSpec(
            stage_id="vit_ssl_linear_probe",
            title="ViT SSL linear probe",
            architecture="vit",
            pretraining_source="ssl",
            ssl_stage_id="vit_ssl_weak_ocular",
            fine_tuning_mode="linear_probe",
            learning_rate=3e-4,
            head_learning_rate=3e-4,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=1,
            early_stop_patience=5,
            candidate_group="vit_ssl_candidates",
            estimated_hours=1.5,
        ),
        TrainStageSpec(
            stage_id="vit_ssl_partial_ft",
            title="ViT SSL partial fine-tuning",
            architecture="vit",
            pretraining_source="ssl",
            ssl_stage_id="vit_ssl_weak_ocular",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=9e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=6,
            partial_unfreeze_blocks=1,
            candidate_group="vit_ssl_candidates",
            estimated_hours=2.5,
        ),
        TrainStageSpec(
            stage_id="vit_ssl_full_ft",
            title="ViT SSL full fine-tuning",
            architecture="vit",
            pretraining_source="ssl",
            ssl_stage_id="vit_ssl_weak_ocular",
            fine_tuning_mode="full",
            learning_rate=3e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=7.5e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=6,
            candidate_group="vit_ssl_candidates",
            estimated_hours=2.5,
        ),
        SSLStageSpec(
            stage_id="dinov2_ssl_weak_ocular",
            title="DINOv2 SSL pretraining (weak ocular recipe)",
            architecture="dinov2",
            augment_preset="weak_ocular",
            epochs=ssl_epochs,
            batch_size=6,
            learning_rate=ssl_lr,
            weight_decay=ssl_weight_decay,
            num_workers=int(args.ssl_num_workers),
            estimated_hours=6.5,
        ),
        TrainStageSpec(
            stage_id="dinov2_ssl_linear_probe",
            title="DINOv2 SSL linear probe",
            architecture="dinov2",
            pretraining_source="ssl",
            ssl_stage_id="dinov2_ssl_weak_ocular",
            fine_tuning_mode="linear_probe",
            learning_rate=3e-4,
            head_learning_rate=3e-4,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=1,
            early_stop_patience=5,
            candidate_group="dinov2_ssl_candidates",
            estimated_hours=1.5,
        ),
        TrainStageSpec(
            stage_id="dinov2_ssl_partial_ft",
            title="DINOv2 SSL partial fine-tuning",
            architecture="dinov2",
            pretraining_source="ssl",
            ssl_stage_id="dinov2_ssl_weak_ocular",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1e-4,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=2,
            early_stop_patience=5,
            partial_unfreeze_blocks=1,
            candidate_group="dinov2_ssl_candidates",
            estimated_hours=2.5,
        ),
        TrainStageSpec(
            stage_id="dinov2_ssl_full_ft_low_lr",
            title="DINOv2 SSL full fine-tuning (low LR)",
            architecture="dinov2",
            pretraining_source="ssl",
            ssl_stage_id="dinov2_ssl_weak_ocular",
            fine_tuning_mode="full",
            learning_rate=2e-5,
            backbone_learning_rate=8e-6,
            head_learning_rate=6e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=5,
            candidate_group="dinov2_ssl_candidates",
            estimated_hours=3.0,
        ),
        TrainStageSpec(
            stage_id="swin_baseline_full",
            title="Swin baseline full fine-tuning",
            architecture="swin",
            pretraining_source="imagenet",
            fine_tuning_mode="full",
            learning_rate=5e-5,
            backbone_learning_rate=2e-5,
            head_learning_rate=8e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=6,
            estimated_hours=2.5,
        ),
        SSLStageSpec(
            stage_id="swin_ssl_weak_ocular",
            title="Swin SSL pretraining (weak ocular recipe)",
            architecture="swin",
            augment_preset="weak_ocular",
            epochs=ssl_epochs,
            batch_size=default_ssl_batch_size("swin"),
            learning_rate=ssl_lr,
            weight_decay=ssl_weight_decay,
            num_workers=int(args.ssl_num_workers),
            estimated_hours=6.0,
        ),
        TrainStageSpec(
            stage_id="swin_ssl_linear_probe",
            title="Swin SSL linear probe",
            architecture="swin",
            pretraining_source="ssl",
            ssl_stage_id="swin_ssl_weak_ocular",
            fine_tuning_mode="linear_probe",
            learning_rate=3e-4,
            head_learning_rate=3e-4,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=1,
            early_stop_patience=5,
            candidate_group="swin_ssl_candidates",
            estimated_hours=1.5,
        ),
        TrainStageSpec(
            stage_id="swin_ssl_partial_ft",
            title="Swin SSL partial fine-tuning",
            architecture="swin",
            pretraining_source="ssl",
            ssl_stage_id="swin_ssl_weak_ocular",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=1e-4,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=6,
            partial_unfreeze_blocks=1,
            candidate_group="swin_ssl_candidates",
            estimated_hours=2.5,
        ),
        TrainStageSpec(
            stage_id="swin_ssl_full_ft",
            title="Swin SSL full fine-tuning",
            architecture="swin",
            pretraining_source="ssl",
            ssl_stage_id="swin_ssl_weak_ocular",
            fine_tuning_mode="full",
            learning_rate=3e-5,
            backbone_learning_rate=1e-5,
            head_learning_rate=7.5e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            warmup_epochs=3,
            early_stop_patience=6,
            candidate_group="swin_ssl_candidates",
            estimated_hours=2.5,
        ),
        TrainStageSpec(
            stage_id="vit_final_direct",
            title="ViT final direct model from best SSL candidate",
            architecture="vit",
            pretraining_source="ssl",
            fine_tuning_mode="full",
            learning_rate=3e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            select_best_from_group="vit_ssl_candidates",
            final_variant="direct",
            inherit_selected_hyperparameters=True,
            use_full_dataset_refit=True,
            estimated_hours=2.5,
        ),
        TrainStageSpec(
            stage_id="vit_final_lgf",
            title="ViT LGF final model from best SSL candidate",
            architecture="lesion_guided_fusion__vit",
            pretraining_source="ssl",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            crop_mode="paired",
            val_split=val_split,
            test_split=test_split,
            select_best_from_group="vit_ssl_candidates",
            final_variant="lgf",
            inherit_selected_hyperparameters=True,
            use_full_dataset_refit=True,
            estimated_hours=3.0,
        ),
        TrainStageSpec(
            stage_id="dinov2_final_direct",
            title="DINOv2 final direct model from best SSL candidate",
            architecture="dinov2",
            pretraining_source="ssl",
            fine_tuning_mode="full",
            learning_rate=2e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            select_best_from_group="dinov2_ssl_candidates",
            final_variant="direct",
            inherit_selected_hyperparameters=True,
            use_full_dataset_refit=True,
            estimated_hours=3.0,
        ),
        TrainStageSpec(
            stage_id="dinov2_final_lgf",
            title="DINOv2 LGF final model from best SSL candidate",
            architecture="lesion_guided_fusion__dinov2",
            pretraining_source="ssl",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            crop_mode="paired",
            val_split=val_split,
            test_split=test_split,
            select_best_from_group="dinov2_ssl_candidates",
            final_variant="lgf",
            inherit_selected_hyperparameters=True,
            use_full_dataset_refit=True,
            estimated_hours=3.5,
        ),
        TrainStageSpec(
            stage_id="swin_final_direct",
            title="Swin final direct model from best SSL candidate",
            architecture="swin",
            pretraining_source="ssl",
            fine_tuning_mode="full",
            learning_rate=3e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            val_split=val_split,
            test_split=test_split,
            select_best_from_group="swin_ssl_candidates",
            final_variant="direct",
            inherit_selected_hyperparameters=True,
            use_full_dataset_refit=True,
            estimated_hours=2.5,
        ),
        TrainStageSpec(
            stage_id="swin_final_lgf",
            title="Swin LGF final model from best SSL candidate",
            architecture="lesion_guided_fusion__swin",
            pretraining_source="ssl",
            fine_tuning_mode="partial",
            learning_rate=5e-5,
            batch_size=batch_size,
            epochs=train_epochs,
            crop_mode="paired",
            val_split=val_split,
            test_split=test_split,
            select_best_from_group="swin_ssl_candidates",
            final_variant="lgf",
            inherit_selected_hyperparameters=True,
            use_full_dataset_refit=True,
            estimated_hours=3.0,
        ),
    ]

    if args.include_current_ssl_controls:
        vit_current_ssl = SSLStageSpec(
            stage_id="vit_ssl_default_control",
            title="ViT SSL pretraining (current default recipe)",
            architecture="vit",
            augment_preset="default",
            epochs=ssl_epochs,
            batch_size=default_ssl_batch_size("vit"),
            learning_rate=ssl_lr,
            weight_decay=ssl_weight_decay,
            num_workers=int(args.ssl_num_workers),
            estimated_hours=6.0,
        )
        swin_current_ssl = SSLStageSpec(
            stage_id="swin_ssl_default_control",
            title="Swin SSL pretraining (current default recipe)",
            architecture="swin",
            augment_preset="default",
            epochs=ssl_epochs,
            batch_size=default_ssl_batch_size("swin"),
            learning_rate=ssl_lr,
            weight_decay=ssl_weight_decay,
            num_workers=int(args.ssl_num_workers),
            estimated_hours=6.0,
        )
        stages.extend(
            [
                vit_current_ssl,
                TrainStageSpec(
                    stage_id="vit_ssl_default_full_control",
                    title="ViT SSL current-recipe control",
                    architecture="vit",
                    pretraining_source="ssl",
                    ssl_stage_id=vit_current_ssl.stage_id,
                    fine_tuning_mode="full",
                    learning_rate=3e-5,
                    backbone_learning_rate=1e-5,
                    head_learning_rate=7.5e-5,
                    batch_size=batch_size,
                    epochs=train_epochs,
                    val_split=val_split,
                    test_split=test_split,
                    warmup_epochs=3,
                    early_stop_patience=6,
                    estimated_hours=2.5,
                ),
                swin_current_ssl,
                TrainStageSpec(
                    stage_id="swin_ssl_default_full_control",
                    title="Swin SSL current-recipe control",
                    architecture="swin",
                    pretraining_source="ssl",
                    ssl_stage_id=swin_current_ssl.stage_id,
                    fine_tuning_mode="full",
                    learning_rate=3e-5,
                    backbone_learning_rate=1e-5,
                    head_learning_rate=7.5e-5,
                    batch_size=batch_size,
                    epochs=train_epochs,
                    val_split=val_split,
                    test_split=test_split,
                    warmup_epochs=3,
                    early_stop_patience=6,
                    estimated_hours=2.5,
                ),
            ]
        )

    return stages


class WeekendPlanRunner:
    def __init__(
        self,
        *,
        plan_id: str,
        plan_root: Path,
        site_id: str,
        site_summary: dict[str, Any],
        manifest_path: Path,
        execution_device: str,
        notifier: EmailNotifier,
        email_interval_minutes: int,
        heartbeat_dir: Path,
        heartbeat_interval_hours: float,
        stages: list[SSLStageSpec | TrainStageSpec],
    ) -> None:
        self.plan_id = plan_id
        self.plan_root = plan_root
        self.site_id = site_id
        self.site_summary = site_summary
        self.manifest_path = manifest_path
        self.execution_device = execution_device
        self.notifier = notifier
        self.email_interval_seconds = max(900, int(email_interval_minutes) * 60)
        self.heartbeat_dir = heartbeat_dir.expanduser().resolve()
        self.heartbeat_interval_seconds = max(600, int(float(heartbeat_interval_hours) * 3600))
        self.stages = stages
        self.events_path = self.plan_root / "plan_events.jsonl"
        self.summary_path = self.plan_root / "plan_summary.json"
        self.heartbeat_current_path = self.heartbeat_dir / f"{self.plan_id}_current.json"
        self.heartbeat_history_path = self.heartbeat_dir / f"{self.plan_id}_history.jsonl"
        self.last_email_sent_at = 0.0
        self.last_heartbeat_written_at = 0.0
        self.control_plane = ControlPlaneStore()
        self.service = ResearchWorkflowService(self.control_plane)
        self.site_store = SiteStore(site_id)
        self.stage_results: dict[str, dict[str, Any]] = {}

    def summary_payload(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "site_id": self.site_id,
            "site_summary": self.site_summary,
            "execution_device": self.execution_device,
            "manifest_path": str(self.manifest_path),
            "created_at": utc_now(),
            "log_path": str(self.plan_root / "weekend_plan.log"),
            "events_path": str(self.events_path),
            "stages": self.stage_results,
            "estimated_total_hours": round(sum(float(stage.estimated_hours) for stage in self.stages), 1),
        }

    def save_summary(self) -> None:
        write_json(self.summary_path, self.summary_payload())

    def append_event(self, *, stage_id: str, event_type: str, payload: dict[str, Any]) -> None:
        append_jsonl(
            self.events_path,
            {
                "timestamp": utc_now(),
                "plan_id": self.plan_id,
                "stage_id": stage_id,
                "event_type": event_type,
                "payload": payload,
            },
        )

    def heartbeat_payload(self, *, event_type: str, stage_id: str | None = None) -> dict[str, Any]:
        running_stage = next(
            (
                {"stage_id": key, **value}
                for key, value in self.stage_results.items()
                if str(value.get("status") or "").strip().lower() == "running"
            ),
            None,
        )
        completed_count = sum(1 for value in self.stage_results.values() if value.get("status") == "completed")
        failed_count = sum(1 for value in self.stage_results.values() if value.get("status") == "failed")
        return {
            "timestamp": utc_now(),
            "plan_id": self.plan_id,
            "site_id": self.site_id,
            "event_type": event_type,
            "trigger_stage_id": stage_id,
            "execution_device": self.execution_device,
            "completed_stages": completed_count,
            "failed_stages": failed_count,
            "total_stages": len(self.stages),
            "running_stage": running_stage,
            "summary_path": str(self.summary_path),
            "events_path": str(self.events_path),
            "plan_root": str(self.plan_root),
        }

    def write_heartbeat(self, *, event_type: str, stage_id: str | None = None, force: bool = False) -> None:
        now = time.time()
        if not force and now - self.last_heartbeat_written_at < self.heartbeat_interval_seconds:
            return
        payload = self.heartbeat_payload(event_type=event_type, stage_id=stage_id)
        write_json(self.heartbeat_current_path, payload)
        append_jsonl(self.heartbeat_history_path, payload)
        self.last_heartbeat_written_at = now

    def email(self, subject: str, body: str, *, force: bool = False) -> None:
        now = time.time()
        if force or now - self.last_email_sent_at >= self.email_interval_seconds:
            self.notifier.send(subject, body)
            self.last_email_sent_at = now

    def run(self) -> dict[str, Any]:
        self.save_summary()
        self.write_heartbeat(event_type="plan_started", force=True)
        self.email(
            f"[K-ERA] Weekend plan prepared: {self.plan_id}",
            "\n".join(
                [
                    f"Plan ID: {self.plan_id}",
                    f"Site ID: {self.site_id}",
                    f"Device: {self.execution_device}",
                    f"Stages: {len(self.stages)}",
                    f"Estimated total hours: {round(sum(float(stage.estimated_hours) for stage in self.stages), 1)}",
                    f"Summary: {self.summary_path}",
                ]
            ),
            force=True,
        )

        for index, stage in enumerate(self.stages, start=1):
            if stage.stage_type == "ssl":
                self.run_ssl_stage(index=index, spec=stage)
            else:
                self.run_train_stage(index=index, spec=stage)
            self.save_summary()
            self.write_heartbeat(event_type="stage_boundary", stage_id=stage.stage_id, force=True)

        self.write_heartbeat(event_type="plan_completed", force=True)
        self.email(
            f"[K-ERA] Weekend plan finished: {self.plan_id}",
            "\n".join(
                [
                    f"Plan ID: {self.plan_id}",
                    f"Site ID: {self.site_id}",
                    f"Device: {self.execution_device}",
                    f"Summary: {self.summary_path}",
                ]
            ),
            force=True,
        )
        return self.summary_payload()

    def run_ssl_stage(self, *, index: int, spec: SSLStageSpec) -> None:
        stage_root = self.plan_root / "ssl_runs" / spec.stage_id
        summary_path = stage_root / "training_summary.json"
        existing_summary = load_json(summary_path) if summary_path.exists() else None
        if existing_summary and str(existing_summary.get("status") or "").strip().lower() == "completed":
            self.stage_results[spec.stage_id] = {
                "status": "completed",
                "stage_type": "ssl",
                "resumed": True,
                "stage_index": index,
                "config": asdict(spec),
                "result": existing_summary,
            }
            self.append_event(stage_id=spec.stage_id, event_type="reused", payload={"summary_path": str(summary_path)})
            return

        self.stage_results[spec.stage_id] = {
            "status": "running",
            "stage_type": "ssl",
            "stage_index": index,
            "started_at": utc_now(),
            "config": asdict(spec),
            "summary_path": str(summary_path),
        }
        self.append_event(stage_id=spec.stage_id, event_type="started", payload={"title": spec.title})
        self.write_heartbeat(event_type="stage_started", stage_id=spec.stage_id, force=True)
        self.email(
            f"[K-ERA] SSL started: {spec.title}",
            "\n".join(
                [
                    f"Plan ID: {self.plan_id}",
                    f"Stage {index}/{len(self.stages)}: {spec.title}",
                    f"Architecture: {spec.architecture}",
                    f"Augment preset: {spec.augment_preset}",
                    f"Output: {stage_root}",
                ]
            ),
            force=True,
        )

        def progress_callback(payload: dict[str, Any]) -> None:
            compact_payload = {
                "stage": payload.get("stage"),
                "percent": payload.get("percent"),
                "epoch": payload.get("epoch"),
                "epochs": payload.get("epochs"),
                "last_loss": payload.get("last_loss"),
                "message": payload.get("message"),
            }
            self.stage_results[spec.stage_id]["last_progress"] = compact_payload
            self.append_event(stage_id=spec.stage_id, event_type="progress", payload=compact_payload)
            self.write_heartbeat(event_type="stage_progress", stage_id=spec.stage_id)
            self.email(
                f"[K-ERA] SSL progress: {spec.title}",
                "\n".join(
                    [
                        f"Plan ID: {self.plan_id}",
                        f"Stage {index}/{len(self.stages)}: {spec.title}",
                        f"Progress: {payload.get('percent')}%",
                        f"Epoch: {payload.get('epoch')}/{payload.get('epochs')}",
                        f"Loss: {payload.get('last_loss')}",
                        f"Message: {payload.get('message')}",
                        f"Summary: {summary_path}",
                    ]
                ),
            )

        try:
            result = run_ssl_pretraining_with_progress(
                SSLTrainingConfig(
                    manifest_path=str(self.manifest_path),
                    output_dir=str(stage_root),
                    architecture=spec.architecture,
                    init_mode=spec.init_mode,
                    image_size=spec.image_size,
                    augment_preset=spec.augment_preset,
                    batch_size=spec.batch_size,
                    epochs=spec.epochs,
                    learning_rate=spec.learning_rate,
                    weight_decay=spec.weight_decay,
                    num_workers=spec.num_workers,
                    device=self.execution_device,
                    min_patient_quality=spec.min_patient_quality,
                    include_review_rows=spec.include_review_rows,
                    use_amp=spec.use_amp and self.execution_device == "cuda",
                ),
                progress_callback=progress_callback,
            )
            self.stage_results[spec.stage_id].update(
                {
                    "status": "completed",
                    "completed_at": utc_now(),
                    "result": result,
                }
            )
            self.append_event(stage_id=spec.stage_id, event_type="completed", payload={"summary_path": str(summary_path)})
            self.write_heartbeat(event_type="stage_completed", stage_id=spec.stage_id, force=True)
            self.email(
                f"[K-ERA] SSL completed: {spec.title}",
                "\n".join(
                    [
                        f"Plan ID: {self.plan_id}",
                        f"Stage {index}/{len(self.stages)}: {spec.title}",
                        f"Encoder: {result.get('encoder_latest_path')}",
                        f"Summary: {result.get('summary_path')}",
                    ]
                ),
                force=True,
            )
        except Exception as exc:
            self.stage_results[spec.stage_id].update(
                {
                    "status": "failed",
                    "completed_at": utc_now(),
                    "error": str(exc),
                }
            )
            self.append_event(stage_id=spec.stage_id, event_type="failed", payload={"error": str(exc)})
            self.write_heartbeat(event_type="stage_failed", stage_id=spec.stage_id, force=True)
            self.email(
                f"[K-ERA] SSL failed: {spec.title}",
                "\n".join(
                    [
                        f"Plan ID: {self.plan_id}",
                        f"Stage {index}/{len(self.stages)}: {spec.title}",
                        f"Error: {exc}",
                    ]
                ),
                force=True,
            )
            raise

    def resolve_ssl_checkpoint(self, stage_id: str) -> str:
        result = self.stage_results.get(stage_id)
        if not result:
            raise ValueError(f"Referenced SSL stage was not found: {stage_id}")
        resolved = str((result.get("result") or {}).get("encoder_latest_path") or "").strip()
        if not resolved:
            raise ValueError(f"SSL stage does not expose encoder_latest_path: {stage_id}")
        return resolved

    def select_best_candidate(self, candidate_group: str) -> tuple[str, dict[str, Any]]:
        candidates: list[tuple[str, dict[str, Any], dict[str, Any], dict[str, Any]]] = []
        for stage_id, payload in self.stage_results.items():
            if str(payload.get("stage_type") or "") != "train":
                continue
            if str(payload.get("status") or "") != "completed":
                continue
            config = payload.get("config") or {}
            if str(config.get("candidate_group") or "") != candidate_group:
                continue
            result = payload.get("result") or {}
            test_metrics = result.get("test_metrics") or {}
            candidates.append((stage_id, payload, config, test_metrics))

        if not candidates:
            raise ValueError(f"No completed candidate stages were found for group: {candidate_group}")

        def candidate_key(item: tuple[str, dict[str, Any], dict[str, Any], dict[str, Any]]) -> tuple[float, float, float, float]:
            _stage_id, payload, _config, test_metrics = item
            result = payload.get("result") or {}
            test_auroc = float(test_metrics.get("AUROC") or -1.0)
            balanced_accuracy = float(test_metrics.get("balanced_accuracy") or 0.0)
            best_val_acc = float(result.get("best_val_acc") or 0.0)
            test_accuracy = float(test_metrics.get("accuracy") or 0.0)
            generalization_gap_penalty = -abs(best_val_acc - test_accuracy)
            return (test_auroc, balanced_accuracy, generalization_gap_penalty, best_val_acc)

        selected_stage_id, selected_payload, _selected_config, _selected_metrics = max(candidates, key=candidate_key)
        return selected_stage_id, selected_payload

    def resolve_selected_train_spec(self, spec: TrainStageSpec) -> tuple[TrainStageSpec, str | None]:
        selected_stage_id: str | None = None
        if not spec.select_best_from_group:
            return spec, selected_stage_id

        selected_stage_id, selected_payload = self.select_best_candidate(spec.select_best_from_group)
        selected_config = dict(selected_payload.get("config") or {})

        resolved_architecture = str(spec.architecture)
        if spec.final_variant == "direct":
            resolved_architecture = str(selected_config.get("architecture") or spec.architecture)
        elif spec.final_variant == "lgf":
            backbone = str(selected_config.get("architecture") or "").strip()
            if not backbone:
                raise ValueError(f"Selected candidate does not expose an architecture: {selected_stage_id}")
            resolved_architecture = f"lesion_guided_fusion__{backbone}"

        if spec.inherit_selected_hyperparameters:
            resolved_spec = TrainStageSpec(
                stage_id=spec.stage_id,
                title=spec.title,
                architecture=resolved_architecture,
                pretraining_source="ssl",
                fine_tuning_mode=str(selected_config.get("fine_tuning_mode") or spec.fine_tuning_mode),
                learning_rate=float(selected_config.get("learning_rate") or spec.learning_rate),
                batch_size=int(selected_config.get("batch_size") or spec.batch_size),
                epochs=int(selected_config.get("epochs") or spec.epochs),
                crop_mode="paired" if spec.final_variant == "lgf" else str(spec.crop_mode),
                case_aggregation=str(selected_config.get("case_aggregation") or spec.case_aggregation),
                val_split=float(selected_config.get("val_split") or spec.val_split),
                test_split=float(selected_config.get("test_split") or spec.test_split),
                backbone_learning_rate=selected_config.get("backbone_learning_rate", spec.backbone_learning_rate),
                head_learning_rate=selected_config.get("head_learning_rate", spec.head_learning_rate),
                warmup_epochs=int(selected_config.get("warmup_epochs") or spec.warmup_epochs),
                early_stop_patience=selected_config.get("early_stop_patience", spec.early_stop_patience),
                partial_unfreeze_blocks=int(selected_config.get("partial_unfreeze_blocks") or spec.partial_unfreeze_blocks),
                ssl_stage_id=str(selected_config.get("ssl_stage_id") or spec.ssl_stage_id or ""),
                candidate_group=spec.candidate_group,
                select_best_from_group=spec.select_best_from_group,
                final_variant=spec.final_variant,
                inherit_selected_hyperparameters=spec.inherit_selected_hyperparameters,
                use_full_dataset_refit=spec.use_full_dataset_refit,
                estimated_hours=spec.estimated_hours,
            )
        else:
            resolved_spec = TrainStageSpec(
                stage_id=spec.stage_id,
                title=spec.title,
                architecture=resolved_architecture,
                pretraining_source=spec.pretraining_source,
                fine_tuning_mode=spec.fine_tuning_mode,
                learning_rate=spec.learning_rate,
                batch_size=spec.batch_size,
                epochs=spec.epochs,
                crop_mode=spec.crop_mode,
                case_aggregation=spec.case_aggregation,
                val_split=spec.val_split,
                test_split=spec.test_split,
                backbone_learning_rate=spec.backbone_learning_rate,
                head_learning_rate=spec.head_learning_rate,
                warmup_epochs=spec.warmup_epochs,
                early_stop_patience=spec.early_stop_patience,
                partial_unfreeze_blocks=spec.partial_unfreeze_blocks,
                ssl_stage_id=spec.ssl_stage_id,
                candidate_group=spec.candidate_group,
                select_best_from_group=spec.select_best_from_group,
                final_variant=spec.final_variant,
                inherit_selected_hyperparameters=spec.inherit_selected_hyperparameters,
                use_full_dataset_refit=spec.use_full_dataset_refit,
                estimated_hours=spec.estimated_hours,
            )

        if spec.final_variant == "lgf" and resolved_spec.fine_tuning_mode == "linear_probe":
            resolved_spec = TrainStageSpec(
                stage_id=resolved_spec.stage_id,
                title=resolved_spec.title,
                architecture=resolved_spec.architecture,
                pretraining_source=resolved_spec.pretraining_source,
                fine_tuning_mode="partial",
                learning_rate=resolved_spec.learning_rate,
                batch_size=resolved_spec.batch_size,
                epochs=resolved_spec.epochs,
                crop_mode=resolved_spec.crop_mode,
                case_aggregation=resolved_spec.case_aggregation,
                val_split=resolved_spec.val_split,
                test_split=resolved_spec.test_split,
                backbone_learning_rate=resolved_spec.backbone_learning_rate,
                head_learning_rate=resolved_spec.head_learning_rate,
                warmup_epochs=resolved_spec.warmup_epochs,
                early_stop_patience=resolved_spec.early_stop_patience,
                partial_unfreeze_blocks=max(1, resolved_spec.partial_unfreeze_blocks),
                ssl_stage_id=resolved_spec.ssl_stage_id,
                candidate_group=resolved_spec.candidate_group,
                select_best_from_group=resolved_spec.select_best_from_group,
                final_variant=resolved_spec.final_variant,
                inherit_selected_hyperparameters=resolved_spec.inherit_selected_hyperparameters,
                use_full_dataset_refit=resolved_spec.use_full_dataset_refit,
                estimated_hours=resolved_spec.estimated_hours,
            )
        return resolved_spec, selected_stage_id

    def run_train_stage(self, *, index: int, spec: TrainStageSpec) -> None:
        resolved_spec, selected_stage_id = self.resolve_selected_train_spec(spec)
        stage_root = self.plan_root / "downstream" / spec.stage_id
        output_model_path = stage_root / f"{spec.stage_id}.pth"
        result_path = stage_root / "result.json"
        existing_result = load_json(result_path) if result_path.exists() else None
        if existing_result and str(existing_result.get("status") or "").strip().lower() == "completed":
            self.stage_results[spec.stage_id] = {
                "status": "completed",
                "stage_type": "train",
                "resumed": True,
                "stage_index": index,
                "config": asdict(spec),
                "result": existing_result.get("result"),
            }
            self.append_event(stage_id=spec.stage_id, event_type="reused", payload={"result_path": str(result_path)})
            return

        self.stage_results[spec.stage_id] = {
            "status": "running",
            "stage_type": "train",
            "stage_index": index,
            "started_at": utc_now(),
            "config": asdict(resolved_spec),
            "selected_from_stage_id": selected_stage_id,
            "result_path": str(result_path),
            "output_model_path": str(output_model_path),
        }
        self.append_event(
            stage_id=spec.stage_id,
            event_type="started",
            payload={"title": spec.title, "selected_from_stage_id": selected_stage_id},
        )
        self.write_heartbeat(event_type="stage_started", stage_id=spec.stage_id, force=True)
        self.email(
            f"[K-ERA] Training started: {spec.title}",
            "\n".join(
                [
                    f"Plan ID: {self.plan_id}",
                    f"Stage {index}/{len(self.stages)}: {spec.title}",
                    f"Architecture: {resolved_spec.architecture}",
                    f"Mode: {resolved_spec.fine_tuning_mode}",
                    f"Pretraining: {resolved_spec.pretraining_source}",
                    f"Full refit: {'yes' if resolved_spec.use_full_dataset_refit else 'no'}",
                    f"Selected from: {selected_stage_id or '-'}",
                    f"Output: {output_model_path}",
                ]
            ),
            force=True,
        )

        def progress_callback(payload: dict[str, Any]) -> None:
            compact_payload = {
                "stage": payload.get("stage"),
                "percent": payload.get("percent"),
                "epoch": payload.get("epoch"),
                "epochs": payload.get("epochs"),
                "train_loss": payload.get("train_loss"),
                "val_acc": payload.get("val_acc"),
                "message": payload.get("message"),
            }
            self.stage_results[spec.stage_id]["last_progress"] = compact_payload
            self.append_event(stage_id=spec.stage_id, event_type="progress", payload=compact_payload)
            self.write_heartbeat(event_type="stage_progress", stage_id=spec.stage_id)
            self.email(
                f"[K-ERA] Training progress: {spec.title}",
                "\n".join(
                    [
                        f"Plan ID: {self.plan_id}",
                        f"Stage {index}/{len(self.stages)}: {spec.title}",
                        f"Progress: {payload.get('percent')}%",
                        f"Epoch: {payload.get('epoch')}/{payload.get('epochs')}",
                        f"Train loss: {payload.get('train_loss')}",
                        f"Val acc: {payload.get('val_acc')}",
                        f"Message: {payload.get('message')}",
                    ]
                ),
            )

        try:
            ssl_checkpoint_path = self.resolve_ssl_checkpoint(resolved_spec.ssl_stage_id) if resolved_spec.ssl_stage_id else None
            if resolved_spec.use_full_dataset_refit:
                result = self.service.run_full_dataset_refit(
                    site_store=self.site_store,
                    architecture=resolved_spec.architecture,
                    output_model_path=str(output_model_path),
                    execution_device=self.execution_device,
                    crop_mode=resolved_spec.crop_mode,
                    epochs=resolved_spec.epochs,
                    learning_rate=resolved_spec.learning_rate,
                    batch_size=resolved_spec.batch_size,
                    use_pretrained=resolved_spec.pretraining_source != "scratch",
                    pretraining_source=resolved_spec.pretraining_source,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                    case_aggregation=resolved_spec.case_aggregation,
                    use_medsam_crops=True,
                    progress_callback=progress_callback,
                    fine_tuning_mode=resolved_spec.fine_tuning_mode,
                    backbone_learning_rate=resolved_spec.backbone_learning_rate,
                    head_learning_rate=resolved_spec.head_learning_rate,
                    warmup_epochs=resolved_spec.warmup_epochs,
                    early_stop_patience=resolved_spec.early_stop_patience,
                    partial_unfreeze_blocks=resolved_spec.partial_unfreeze_blocks,
                )
            else:
                result = self.service.run_initial_training(
                    site_store=self.site_store,
                    architecture=resolved_spec.architecture,
                    output_model_path=str(output_model_path),
                    execution_device=self.execution_device,
                    crop_mode=resolved_spec.crop_mode,
                    epochs=resolved_spec.epochs,
                    learning_rate=resolved_spec.learning_rate,
                    batch_size=resolved_spec.batch_size,
                    val_split=resolved_spec.val_split,
                    test_split=resolved_spec.test_split,
                    use_pretrained=resolved_spec.pretraining_source != "scratch",
                    pretraining_source=resolved_spec.pretraining_source,
                    ssl_checkpoint_path=ssl_checkpoint_path,
                    case_aggregation=resolved_spec.case_aggregation,
                    use_medsam_crops=True,
                    regenerate_split=False,
                    progress_callback=progress_callback,
                    fine_tuning_mode=resolved_spec.fine_tuning_mode,
                    backbone_learning_rate=resolved_spec.backbone_learning_rate,
                    head_learning_rate=resolved_spec.head_learning_rate,
                    warmup_epochs=resolved_spec.warmup_epochs,
                    early_stop_patience=resolved_spec.early_stop_patience,
                    partial_unfreeze_blocks=resolved_spec.partial_unfreeze_blocks,
                )
            stage_payload = {
                "status": "completed",
                "completed_at": utc_now(),
                "result": result,
                "selected_from_stage_id": selected_stage_id,
            }
            write_json(result_path, stage_payload)
            self.stage_results[spec.stage_id].update(stage_payload)
            self.append_event(
                stage_id=spec.stage_id,
                event_type="completed",
                payload={
                    "selected_from_stage_id": selected_stage_id,
                    "best_val_acc": result.get("best_val_acc"),
                    "best_train_loss": result.get("best_train_loss"),
                    "test_acc": (result.get("test_metrics") or {}).get("accuracy"),
                    "test_auroc": (result.get("test_metrics") or {}).get("AUROC"),
                },
            )
            self.write_heartbeat(event_type="stage_completed", stage_id=spec.stage_id, force=True)
            self.email(
                f"[K-ERA] Training completed: {spec.title}",
                "\n".join(
                    [
                        f"Plan ID: {self.plan_id}",
                        f"Stage {index}/{len(self.stages)}: {spec.title}",
                        f"Best val acc: {result.get('best_val_acc')}",
                        f"Best train loss: {result.get('best_train_loss')}",
                        f"Test acc: {(result.get('test_metrics') or {}).get('accuracy')}",
                        f"Test AUROC: {(result.get('test_metrics') or {}).get('AUROC')}",
                        f"Refit scope: {result.get('refit_scope') or '-'}",
                        f"Selected from: {selected_stage_id or '-'}",
                        f"Result: {result_path}",
                    ]
                ),
                force=True,
            )
        except Exception as exc:
            write_json(
                result_path,
                {
                    "status": "failed",
                    "completed_at": utc_now(),
                    "error": str(exc),
                },
            )
            self.stage_results[spec.stage_id].update(
                {
                    "status": "failed",
                    "completed_at": utc_now(),
                    "error": str(exc),
                }
            )
            self.append_event(stage_id=spec.stage_id, event_type="failed", payload={"error": str(exc)})
            self.write_heartbeat(event_type="stage_failed", stage_id=spec.stage_id, force=True)
            self.email(
                f"[K-ERA] Training failed: {spec.title}",
                "\n".join(
                    [
                        f"Plan ID: {self.plan_id}",
                        f"Stage {index}/{len(self.stages)}: {spec.title}",
                        f"Error: {exc}",
                    ]
                ),
                force=True,
            )
            raise


def prepare_manifest(archive_base_dir: Path, plan_root: Path) -> tuple[Path, dict[str, Any], dict[str, str]]:
    manifest_dir = plan_root / "manifest"
    clean_rows, anomaly_rows, manifest_summary = scan_ssl_archive(archive_base_dir.expanduser().resolve())
    manifest_paths = write_ssl_archive_outputs(manifest_dir, clean_rows, anomaly_rows, manifest_summary)
    return Path(manifest_paths["clean_manifest_path"]), manifest_summary, manifest_paths


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    plan_id = f"transformer_weekend_plan_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    plan_root = (args.plan_root or (REPO_ROOT / "artifacts" / "weekend_plans" / plan_id)).expanduser().resolve()
    log_path = plan_root / "weekend_plan.log"
    configure_logging(log_path, args.log_level)

    execution_device = resolve_device(args.device)
    if execution_device == "cpu":
        LOGGER.warning("The weekend plan is configured for unattended transformer experiments. CPU execution will likely exceed 52 hours.")

    site_id, site_summary = resolve_site_id(args.site_id)
    manifest_path, manifest_summary, manifest_paths = prepare_manifest(args.archive_base_dir, plan_root)
    stages = default_experiment_stages(args)
    smtp_settings = load_smtp_settings()
    notifier = EmailNotifier(recipient=args.email_to, settings=smtp_settings, plan_id=plan_id)

    summary_payload = {
        "plan_id": plan_id,
        "created_at": utc_now(),
        "archive_base_dir": str(args.archive_base_dir.expanduser().resolve()),
        "site_id": site_id,
        "site_summary": site_summary,
        "execution_device": execution_device,
        "manifest": {
            "clean_manifest_path": str(manifest_path),
            "paths": manifest_paths,
            "summary": manifest_summary,
        },
        "email_notifications_enabled": notifier.enabled,
        "email_recipient": args.email_to or None,
        "heartbeat_dir": str(args.heartbeat_dir.expanduser().resolve()),
        "heartbeat_interval_hours": float(args.heartbeat_interval_hours),
        "estimated_total_hours": round(sum(float(stage.estimated_hours) for stage in stages), 1),
        "stages": [asdict(stage) for stage in stages],
        "log_path": str(log_path),
    }
    write_json(plan_root / "plan_summary.json", summary_payload)

    LOGGER.info(
        "Prepared transformer weekend plan: site_id=%s device=%s stages=%s estimated_hours=%.1f email_enabled=%s",
        site_id,
        execution_device,
        len(stages),
        summary_payload["estimated_total_hours"],
        notifier.enabled,
    )

    if args.dry_run:
        return 0

    runner = WeekendPlanRunner(
        plan_id=plan_id,
        plan_root=plan_root,
        site_id=site_id,
        site_summary=site_summary,
        manifest_path=manifest_path,
        execution_device=execution_device,
        notifier=notifier,
        email_interval_minutes=int(args.email_interval_minutes),
        heartbeat_dir=args.heartbeat_dir,
        heartbeat_interval_hours=float(args.heartbeat_interval_hours),
        stages=stages,
    )
    runner.save_summary()
    runner.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
