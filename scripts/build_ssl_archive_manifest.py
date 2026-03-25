from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = REPO_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from kera_research.services.ssl_archive import scan_ssl_archive, write_ssl_archive_outputs


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scan an external anterior-segment archive and generate SSL-ready clean/anomaly manifests.",
    )
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=Path(r"E:\전안부 사진"),
        help="Base archive directory to scan.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "artifacts" / "ssl_archive",
        help="Directory where CSV and summary outputs will be written.",
    )
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    clean_rows, anomaly_rows, summary = scan_ssl_archive(args.base_dir)
    outputs = write_ssl_archive_outputs(args.output_dir, clean_rows, anomaly_rows, summary)

    print(json.dumps({"summary": summary, "outputs": outputs}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
