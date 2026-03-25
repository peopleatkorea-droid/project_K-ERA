from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import unicodedata
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
YEAR_DIR_PATTERN = re.compile(r"^(?P<year>\d{4})년$")
DATE_DIR_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FILENAME_TIMESTAMP_PATTERN = re.compile(r"(?P<ts>(?:19|20)\d{12})")
PATIENT_ALLOWED_PATTERN = re.compile(r"[^0-9A-Za-z가-힣]+")

CLEAN_FIELDNAMES = [
    "image_id",
    "image_path",
    "relative_path",
    "file_name",
    "file_stem",
    "extension",
    "file_size_bytes",
    "capture_year",
    "visit_date",
    "capture_timestamp",
    "patient_folder_raw",
    "patient_folder_parent_raw",
    "patient_key_normalized",
    "patient_key_sha1",
    "patient_quality",
    "path_depth",
    "structure_type",
    "needs_review",
    "review_reason",
]

ANOMALY_FIELDNAMES = [
    "image_id",
    "image_path",
    "relative_path",
    "file_name",
    "file_stem",
    "extension",
    "file_size_bytes",
    "capture_year",
    "visit_date",
    "capture_timestamp",
    "patient_folder_raw",
    "patient_folder_parent_raw",
    "patient_key_normalized",
    "patient_key_sha1",
    "patient_quality",
    "path_depth",
    "structure_type",
    "anomaly_reason",
]


def is_supported_image_path(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS


def normalize_patient_key(raw_value: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(raw_value or "")).strip()
    if not normalized:
        return ""
    return PATIENT_ALLOWED_PATTERN.sub("", normalized).upper()


def patient_quality(raw_value: str, normalized_key: str) -> tuple[str, str]:
    raw_text = unicodedata.normalize("NFKC", str(raw_value or "")).strip()
    if not normalized_key:
        return "low", "empty_or_non_alnum_patient_folder"
    if len(normalized_key) < 2:
        return "low", "short_patient_folder"
    if re.fullmatch(r"[0-9]{4,}", normalized_key):
        return "high", ""
    if re.fullmatch(r"[0-9A-Z가-힣]{2,64}", normalized_key):
        return "high", ""
    if any(character.isalnum() or ("\uac00" <= character <= "\ud7a3") for character in raw_text):
        return "medium", ""
    return "low", "suspicious_patient_folder"


def _sha1_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def _extract_capture_timestamp(file_name: str) -> str:
    match = FILENAME_TIMESTAMP_PATTERN.search(file_name)
    if not match:
        return ""
    try:
        parsed = datetime.strptime(match.group("ts"), "%Y%m%d%H%M%S")
    except ValueError:
        return ""
    return parsed.isoformat(timespec="seconds")


def classify_archive_image(base_dir: Path, image_path: Path) -> tuple[bool, dict[str, Any]]:
    relative_path = image_path.relative_to(base_dir)
    parts = list(relative_path.parts)
    structure_type = "unknown"
    capture_year = ""
    visit_date = ""
    anomaly_reason = ""
    patient_folder_raw = ""
    patient_folder_parent_raw = ""

    year_match = YEAR_DIR_PATTERN.match(parts[0]) if len(parts) >= 1 else None
    if year_match:
        capture_year = year_match.group("year")
    else:
        anomaly_reason = "invalid_year_folder"
    if len(parts) >= 2 and DATE_DIR_PATTERN.match(parts[1]):
        visit_date = parts[1]
    elif not anomaly_reason:
        anomaly_reason = "invalid_visit_date_folder"

    if not anomaly_reason:
        if len(parts) == 4:
            structure_type = "year_date_patient_image"
            patient_folder_raw = parts[2]
        elif len(parts) == 3:
            structure_type = "year_date_image"
            anomaly_reason = "missing_patient_folder"
        elif len(parts) >= 5:
            structure_type = "year_date_patient_nested_image"
            patient_folder_parent_raw = parts[2]
            patient_folder_raw = parts[3]
            anomaly_reason = "nested_patient_folder"
        else:
            structure_type = f"unexpected_depth_{len(parts)}"
            anomaly_reason = "unexpected_path_depth"

    patient_key_normalized = normalize_patient_key(patient_folder_raw)
    quality, quality_reason = patient_quality(patient_folder_raw, patient_key_normalized)
    if quality_reason and not anomaly_reason and structure_type == "year_date_patient_image":
        review_reason = quality_reason
    else:
        review_reason = ""

    common_row = {
        "image_id": _sha1_text(str(relative_path).replace("\\", "/"))[:16],
        "image_path": str(image_path),
        "relative_path": str(relative_path).replace("\\", "/"),
        "file_name": image_path.name,
        "file_stem": image_path.stem,
        "extension": image_path.suffix.lower(),
        "file_size_bytes": int(image_path.stat().st_size),
        "capture_year": capture_year,
        "visit_date": visit_date,
        "capture_timestamp": _extract_capture_timestamp(image_path.name),
        "patient_folder_raw": patient_folder_raw,
        "patient_folder_parent_raw": patient_folder_parent_raw,
        "patient_key_normalized": patient_key_normalized,
        "patient_key_sha1": _sha1_text(patient_key_normalized)[:16] if patient_key_normalized else "",
        "patient_quality": quality,
        "path_depth": len(parts),
        "structure_type": structure_type,
    }

    if anomaly_reason:
        anomaly_row = dict(common_row)
        anomaly_row["anomaly_reason"] = anomaly_reason
        return False, anomaly_row

    clean_row = dict(common_row)
    clean_row["needs_review"] = quality == "low"
    clean_row["review_reason"] = review_reason
    return True, clean_row


def scan_ssl_archive(base_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    base_dir = base_dir.expanduser().resolve()
    if not base_dir.exists():
        raise FileNotFoundError(f"Base directory does not exist: {base_dir}")
    if not base_dir.is_dir():
        raise NotADirectoryError(f"Base directory is not a directory: {base_dir}")

    clean_rows: list[dict[str, Any]] = []
    anomaly_rows: list[dict[str, Any]] = []
    extension_counts: Counter[str] = Counter()
    quality_counts: Counter[str] = Counter()
    anomaly_counts: Counter[str] = Counter()
    year_counts: Counter[str] = Counter()

    for root, _dirs, files in os.walk(base_dir):
        root_path = Path(root)
        for file_name in files:
            file_path = root_path / file_name
            if not is_supported_image_path(file_path):
                continue
            extension_counts[file_path.suffix.lower()] += 1
            is_clean, row = classify_archive_image(base_dir, file_path)
            if row.get("capture_year"):
                year_counts[str(row["capture_year"])] += 1
            if is_clean:
                quality_counts[str(row["patient_quality"])] += 1
                clean_rows.append(row)
            else:
                anomaly_counts[str(row["anomaly_reason"])] += 1
                anomaly_rows.append(row)

    summary = {
        "base_dir": str(base_dir),
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "total_supported_images": len(clean_rows) + len(anomaly_rows),
        "clean_images": len(clean_rows),
        "anomaly_images": len(anomaly_rows),
        "extension_counts": dict(sorted(extension_counts.items())),
        "patient_quality_counts": dict(sorted(quality_counts.items())),
        "anomaly_reason_counts": dict(sorted(anomaly_counts.items())),
        "capture_year_counts": dict(sorted(year_counts.items())),
    }
    return clean_rows, anomaly_rows, summary


def _write_rows_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_ssl_archive_outputs(
    output_dir: Path,
    clean_rows: list[dict[str, Any]],
    anomaly_rows: list[dict[str, Any]],
    summary: dict[str, Any],
) -> dict[str, str]:
    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    clean_path = output_dir / "ssl_archive_manifest_clean.csv"
    anomaly_path = output_dir / "ssl_archive_manifest_anomalies.csv"
    summary_path = output_dir / "ssl_archive_manifest_summary.json"

    _write_rows_csv(clean_path, CLEAN_FIELDNAMES, clean_rows)
    _write_rows_csv(anomaly_path, ANOMALY_FIELDNAMES, anomaly_rows)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "clean_manifest_path": str(clean_path),
        "anomaly_manifest_path": str(anomaly_path),
        "summary_path": str(summary_path),
    }
