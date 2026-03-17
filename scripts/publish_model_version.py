from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.domain import utc_now  # noqa: E402
from kera_research.services.control_plane import ControlPlaneStore  # noqa: E402
from kera_research.services.model_artifacts import ModelArtifactStore  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish a local model file to an existing or new K-ERA model version using a OneDrive/SharePoint download URL."
    )
    parser.add_argument("--database-url", default="", help="Optional control-plane DB URL. Overrides environment for this process.")
    parser.add_argument("--version-id", required=True, help="Existing or new version_id to publish.")
    parser.add_argument("--local-path", required=True, help="Local model checkpoint path on the admin machine.")
    parser.add_argument("--download-url", required=True, help="Permanent OneDrive/SharePoint download URL.")
    parser.add_argument("--version-name", default="", help="Required when creating a new model version.")
    parser.add_argument("--architecture", default="", help="Required when creating a new model version.")
    parser.add_argument("--stage", default="global", help="Model stage. Defaults to global.")
    parser.add_argument("--model-name", default="keratitis_cls", help="Logical model family name.")
    parser.add_argument("--source-provider", default="onedrive_sharepoint", help="Artifact source provider label.")
    parser.add_argument("--set-current", action="store_true", help="Mark the published version as the current global model.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.database_url:
        os.environ["KERA_CONTROL_PLANE_DATABASE_URL"] = args.database_url
        os.environ["KERA_DATABASE_URL"] = ""
        os.environ["DATABASE_URL"] = ""

    artifact_store = ModelArtifactStore()
    cp = ControlPlaneStore()
    existing = next((item for item in cp.list_model_versions() if item.get("version_id") == args.version_id), None)
    if existing is None and (not args.version_name or not args.architecture):
        raise SystemExit("--version-name and --architecture are required when creating a new version.")

    metadata = artifact_store.register_local_metadata(existing or {}, local_path=args.local_path)
    merged = {
        **(existing or {}),
        **metadata,
        "version_id": args.version_id,
        "version_name": args.version_name or str((existing or {}).get("version_name") or "").strip(),
        "model_name": args.model_name or str((existing or {}).get("model_name") or "keratitis_cls"),
        "architecture": args.architecture or str((existing or {}).get("architecture") or "").strip(),
        "stage": args.stage or str((existing or {}).get("stage") or "global"),
        "created_at": str((existing or {}).get("created_at") or utc_now()),
        "download_url": args.download_url.strip(),
        "source_provider": args.source_provider.strip() or "onedrive_sharepoint",
        "publish_required": False,
        "distribution_status": "published",
        "ready": True,
        "is_current": args.set_current or bool((existing or {}).get("is_current", False)),
        "model_path": "",
    }

    published = cp.ensure_model_version(merged)
    print(json.dumps(published, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
