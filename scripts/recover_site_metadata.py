from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> int:
    load_env_file(ROOT_DIR / ".env.local")
    load_env_file(ROOT_DIR / ".env")

    parser = argparse.ArgumentParser(description="Recover site metadata rows from backup or manifest.")
    parser.add_argument("--site-id", required=True, help="Site identifier to recover.")
    parser.add_argument(
        "--source",
        choices=("auto", "backup", "manifest"),
        default="auto",
        help="Recovery source selection. 'auto' prefers metadata_backup.json, then falls back to dataset_manifest.csv.",
    )
    parser.add_argument("--backup-path", help="Optional explicit metadata backup path.")
    parser.add_argument(
        "--force-replace",
        action="store_true",
        help="Replace existing patients/visits/images rows for the site before restoring.",
    )
    args = parser.parse_args()

    from kera_research.services.data_plane import SiteStore

    site_store = SiteStore(str(args.site_id).strip())
    backup_path = str(args.backup_path).strip() if args.backup_path else None
    if args.source == "backup":
        candidate = Path(backup_path).expanduser() if backup_path else site_store.metadata_backup_path()
        if not candidate.exists():
            raise SystemExit(f"Backup file not found: {candidate}")
        result = site_store.recover_metadata(
            prefer_backup=True,
            force_replace=bool(args.force_replace),
            backup_path=str(candidate),
        )
    elif args.source == "manifest":
        result = site_store.recover_metadata(
            prefer_backup=False,
            force_replace=bool(args.force_replace),
            backup_path=backup_path,
        )
    else:
        result = site_store.recover_metadata(
            prefer_backup=True,
            force_replace=bool(args.force_replace),
            backup_path=backup_path,
        )

    payload = {
        "site_id": site_store.site_id,
        "site_dir": str(site_store.site_dir),
        "manifest_path": str(site_store.manifest_path),
        "metadata_backup_path": str(site_store.metadata_backup_path()),
        **result,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
