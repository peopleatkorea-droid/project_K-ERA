from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.services.ssl_pretraining import SSLTrainingConfig, run_ssl_pretraining


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run BYOL self-supervised pretraining on the generated anterior-segment archive manifest.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=REPO_ROOT / "artifacts" / "ssl_archive" / "ssl_archive_manifest_clean.csv",
        help="Clean archive manifest CSV.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "artifacts" / "ssl_runs" / "byol_convnext_tiny_default",
        help="Directory where checkpoints and logs will be written.",
    )
    parser.add_argument(
        "--architecture",
        default="convnext_tiny",
        choices=["densenet121", "convnext_tiny", "swin", "vit", "dinov2", "efficientnet_v2_s"],
        help="Backbone architecture for SSL pretraining.",
    )
    parser.add_argument(
        "--init-mode",
        default="imagenet",
        choices=["imagenet", "random"],
        help="Backbone initialization mode before SSL pretraining.",
    )
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--num-workers", type=int, default=8)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-images", type=int, default=None)
    parser.add_argument("--max-steps-per-epoch", type=int, default=None)
    parser.add_argument(
        "--min-patient-quality",
        default="medium",
        choices=["low", "medium", "high"],
        help="Drop manifest rows below this patient-folder quality threshold.",
    )
    parser.add_argument(
        "--include-review-rows",
        action="store_true",
        help="Keep low-quality patient-folder rows that were marked for review.",
    )
    parser.add_argument(
        "--disable-amp",
        action="store_true",
        help="Disable mixed precision even on CUDA.",
    )
    parser.add_argument("--save-every", type=int, default=1)
    parser.add_argument("--base-momentum", type=float, default=0.99)
    parser.add_argument("--resume-checkpoint", type=Path, default=None)
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config = SSLTrainingConfig(
        manifest_path=str(args.manifest.expanduser().resolve()),
        output_dir=str(args.output_dir.expanduser().resolve()),
        architecture=args.architecture,
        init_mode=args.init_mode,
        image_size=args.image_size,
        batch_size=args.batch_size,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        num_workers=args.num_workers,
        device=args.device,
        seed=args.seed,
        max_images=args.max_images,
        max_steps_per_epoch=args.max_steps_per_epoch,
        include_review_rows=bool(args.include_review_rows),
        min_patient_quality=args.min_patient_quality,
        use_amp=not bool(args.disable_amp),
        save_every=args.save_every,
        base_momentum=args.base_momentum,
        resume_checkpoint=str(args.resume_checkpoint.expanduser().resolve()) if args.resume_checkpoint else None,
    )

    summary = run_ssl_pretraining(config)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
