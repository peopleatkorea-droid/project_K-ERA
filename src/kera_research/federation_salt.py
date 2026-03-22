from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

DEFAULT_CASE_REFERENCE_SALT = "kera-case-reference-v1"
FEDERATION_SALT_FILENAME = "federation_salt.json"


@dataclass(frozen=True)
class FederationSaltValues:
    case_reference_salt: str
    patient_reference_salt: str
    public_alias_salt: str
    source: str
    path: Path


def _normalize_text(value: str | None) -> str:
    return str(value or "").strip()


def federation_salt_path(control_plane_dir: Path) -> Path:
    return control_plane_dir / FEDERATION_SALT_FILENAME


def _read_stored_salts(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    stored: dict[str, str] = {}
    for key in ("case_reference_salt", "patient_reference_salt", "public_alias_salt", "source"):
        normalized = _normalize_text(payload.get(key))
        if normalized:
            stored[key] = normalized
    return stored


def _write_stored_salts(
    path: Path,
    *,
    case_reference_salt: str,
    patient_reference_salt: str,
    public_alias_salt: str,
    source: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "case_reference_salt": case_reference_salt,
        "patient_reference_salt": patient_reference_salt,
        "public_alias_salt": public_alias_salt,
        "source": source,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")


def resolve_federation_salts(
    *,
    control_plane_dir: Path,
    environ: Mapping[str, str] | None = None,
) -> FederationSaltValues:
    env = environ or os.environ
    path = federation_salt_path(control_plane_dir)
    stored = _read_stored_salts(path)
    legacy_secret = _normalize_text(env.get("KERA_API_SECRET"))

    case_reference_salt = (
        _normalize_text(env.get("KERA_CASE_REFERENCE_SALT"))
        or stored.get("case_reference_salt", "")
        or legacy_secret
        or DEFAULT_CASE_REFERENCE_SALT
    )
    patient_reference_salt = (
        _normalize_text(env.get("KERA_PATIENT_REFERENCE_SALT"))
        or stored.get("patient_reference_salt", "")
        or case_reference_salt
    )
    public_alias_salt = (
        _normalize_text(env.get("KERA_PUBLIC_ALIAS_SALT"))
        or stored.get("public_alias_salt", "")
        or case_reference_salt
    )

    if any(
        _normalize_text(env.get(key))
        for key in ("KERA_CASE_REFERENCE_SALT", "KERA_PATIENT_REFERENCE_SALT", "KERA_PUBLIC_ALIAS_SALT")
    ):
        source = "explicit_env"
    elif stored.get("case_reference_salt"):
        source = stored.get("source", "") or "stored"
    elif legacy_secret:
        source = "legacy_kera_api_secret"
    else:
        source = "default"

    if (
        stored.get("case_reference_salt") != case_reference_salt
        or stored.get("patient_reference_salt") != patient_reference_salt
        or stored.get("public_alias_salt") != public_alias_salt
        or stored.get("source") != source
    ):
        try:
            _write_stored_salts(
                path,
                case_reference_salt=case_reference_salt,
                patient_reference_salt=patient_reference_salt,
                public_alias_salt=public_alias_salt,
                source=source,
            )
        except OSError:
            pass

    return FederationSaltValues(
        case_reference_salt=case_reference_salt,
        patient_reference_salt=patient_reference_salt,
        public_alias_salt=public_alias_salt,
        source=source,
        path=path,
    )
