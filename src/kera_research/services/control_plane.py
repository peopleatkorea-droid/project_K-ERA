from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import func, select

from kera_research.config import (
    CASE_REFERENCE_SALT_FINGERPRINT,
    CONTROL_PLANE_ARTIFACT_DIR,
    CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS,
    CONTROL_PLANE_CASE_DIR,
    CONTROL_PLANE_DIR,
    CONTROL_PLANE_EXPERIMENT_DIR,
    CONTROL_PLANE_REPORT_DIR,
    HIRA_API_KEY,
    PUBLIC_ALIAS_SALT,
    ensure_base_directories,
)
from kera_research.db import (
    CONTROL_PLANE_ENGINE,
    init_control_plane_db,
    model_versions,
    sites,
    validation_runs,
)
from kera_research.domain import (
    utc_now,
    visit_label_from_index,
)
from kera_research.passwords import (
    hash_password,
    is_bcrypt_hash,
    is_pbkdf2_sha256_hash,
    verify_pbkdf2_sha256_hash,
)
from kera_research.services.control_plane_artifacts import ControlPlaneArtifactFacade
from kera_research.services.control_plane_bootstrap_projection import ControlPlaneBootstrapProjectionFacade
from kera_research.services.node_credentials import clear_node_credentials
from kera_research.services.control_plane_catalog import ControlPlaneCatalogFacade
from kera_research.services.control_plane_case_references import ControlPlaneCaseReferenceFacade
from kera_research.services.control_plane_identity_views import ControlPlaneIdentityFacade
from kera_research.services.control_plane_instance_state import ControlPlaneInstanceStateFacade
from kera_research.services.control_plane_models import ControlPlaneModelFacade
from kera_research.services.control_plane_registry_ops import ControlPlaneRegistryOps
from kera_research.services.control_plane_remote_state import ControlPlaneRemoteState
from kera_research.services.control_plane_results import ControlPlaneResultsFacade
from kera_research.services.control_plane_seeding import ControlPlaneSeedingFacade
from kera_research.services.control_plane_workspace_ops import (
    SOURCE_INSTITUTION_ID_UNSET,
    ControlPlaneWorkspaceOps,
)
from kera_research.services.control_plane_workspace_views import ControlPlaneWorkspaceFacade
from kera_research.services.remote_control_plane import RemoteControlPlaneClient
from kera_research.storage import ensure_dir

GOOGLE_AUTH_SENTINEL = "__google__"
APP_SETTING_INSTANCE_STORAGE_ROOT = "instance_storage_root"
APP_SETTING_INSTITUTION_DIRECTORY_LAST_SYNC = "institution_directory_last_sync"
REMOTE_CURRENT_RELEASE_CACHE_SECONDS = 30.0
HIRA_SITE_ID_PATTERN = re.compile(r"^\d{8}$")
PUBLIC_ALIAS_ADJECTIVES: list[tuple[str, str, str]] = [
    ("warm", "따스한", "Warm"),
    ("calm", "차분한", "Calm"),
    ("clear", "맑은", "Clear"),
    ("steady", "든든한", "Steady"),
    ("delicate", "섬세한", "Delicate"),
    ("diligent", "성실한", "Diligent"),
    ("upright", "반듯한", "Upright"),
    ("wise", "지혜로운", "Wise"),
    ("quiet", "조용한", "Quiet"),
    ("agile", "민첩한", "Agile"),
    ("gentle", "푸근한", "Gentle"),
    ("radiant", "빛나는", "Radiant"),
    ("composed", "침착한", "Composed"),
    ("alert", "기민한", "Alert"),
    ("serene", "온화한", "Serene"),
    ("sturdy", "단단한", "Sturdy"),
    ("flexible", "유연한", "Flexible"),
    ("vivid", "선명한", "Vivid"),
    ("kind", "상냥한", "Kind"),
    ("bold", "담대한", "Bold"),
    ("tranquil", "고요한", "Tranquil"),
    ("healthy", "건강한", "Healthy"),
    ("honest", "정직한", "Honest"),
    ("bright", "명민한", "Bright"),
]
PUBLIC_ALIAS_ANIMALS: list[tuple[str, str, str]] = [
    ("gorilla", "고릴라", "Gorilla"),
    ("otter", "수달", "Otter"),
    ("tiger", "호랑이", "Tiger"),
    ("owl", "올빼미", "Owl"),
    ("fox", "여우", "Fox"),
    ("whale", "고래", "Whale"),
    ("squirrel", "다람쥐", "Squirrel"),
    ("penguin", "펭귄", "Penguin"),
    ("dolphin", "돌고래", "Dolphin"),
    ("deer", "사슴", "Deer"),
    ("cheetah", "치타", "Cheetah"),
    ("elephant", "코끼리", "Elephant"),
    ("magpie", "까치", "Magpie"),
    ("crane", "두루미", "Crane"),
    ("panda", "판다", "Panda"),
    ("wolf", "늑대", "Wolf"),
    ("beaver", "비버", "Beaver"),
    ("badger", "오소리", "Badger"),
    ("seaotter", "해달", "Sea Otter"),
    ("hawk", "매", "Hawk"),
    ("lynx", "살쾡이", "Lynx"),
    ("seal", "바다표범", "Seal"),
    ("ibex", "산양", "Ibex"),
    ("goose", "기러기", "Goose"),
]
PUBLIC_ALIAS_TOKEN_PATTERN = re.compile(r"^(?P<adjective>[a-z]+)_(?P<animal>[a-z]+)_(?P<number>\d{3})$")
PUBLIC_ALIAS_LEGACY_PATTERN = re.compile(r"^(?P<adjective>\S+)\s+(?P<animal>\S+)\s+#(?P<number>\d{3})$")
PUBLIC_ALIAS_ANONYMOUS_PATTERN = re.compile(r"^anonymous_member_(?P<code>[a-z0-9]{6})$")
PUBLIC_ALIAS_LEGACY_ANONYMOUS_PATTERN = re.compile(r"^익명 참여자 #(?P<code>[A-Za-z0-9]{6})$")
PUBLIC_ALIAS_ADJECTIVE_KEYS = [item[0] for item in PUBLIC_ALIAS_ADJECTIVES]
PUBLIC_ALIAS_ANIMAL_KEYS = [item[0] for item in PUBLIC_ALIAS_ANIMALS]
PUBLIC_ALIAS_ADJECTIVE_KEY_SET = set(PUBLIC_ALIAS_ADJECTIVE_KEYS)
PUBLIC_ALIAS_ANIMAL_KEY_SET = set(PUBLIC_ALIAS_ANIMAL_KEYS)
PUBLIC_ALIAS_ADJECTIVE_BY_KO = {item[1]: item[0] for item in PUBLIC_ALIAS_ADJECTIVES}
PUBLIC_ALIAS_ADJECTIVE_BY_EN = {item[2].lower(): item[0] for item in PUBLIC_ALIAS_ADJECTIVES}
PUBLIC_ALIAS_ANIMAL_BY_KO = {item[1]: item[0] for item in PUBLIC_ALIAS_ANIMALS}
PUBLIC_ALIAS_ANIMAL_BY_EN = {item[2].lower(): item[0] for item in PUBLIC_ALIAS_ANIMALS}


def _safe_artifact_name(value: str, fallback: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in str(value or "").strip())
    collapsed = normalized.strip("._")
    return collapsed or fallback


def _infer_remote_source_provider(download_url: str) -> str:
    normalized = str(download_url or "").strip().lower()
    if "sharepoint.com" in normalized or "onedrive" in normalized:
        return "onedrive_sharepoint"
    if normalized:
        return "http_download"
    return "local"


def _site_display_label(site: dict[str, Any] | None, fallback: str = "") -> str:
    if not isinstance(site, dict):
        return fallback
    hospital_name = str(site.get("hospital_name") or "").strip()
    if hospital_name:
        return hospital_name
    display_name = str(site.get("display_name") or "").strip()
    if display_name:
        return display_name
    site_id = str(site.get("site_id") or "").strip()
    return site_id or fallback


def _make_public_alias(seed: str, *, attempt: int = 0) -> str:
    normalized_seed = str(seed or "").strip()
    digest = hashlib.sha256(f"{PUBLIC_ALIAS_SALT}::{normalized_seed}::{attempt}".encode("utf-8")).digest()
    adjective = PUBLIC_ALIAS_ADJECTIVE_KEYS[int.from_bytes(digest[0:2], "big") % len(PUBLIC_ALIAS_ADJECTIVE_KEYS)]
    animal = PUBLIC_ALIAS_ANIMAL_KEYS[int.from_bytes(digest[2:4], "big") % len(PUBLIC_ALIAS_ANIMAL_KEYS)]
    number = int.from_bytes(digest[4:6], "big") % 1000
    return f"{adjective}_{animal}_{number:03d}"


def _normalize_public_alias_token(value: str) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None

    token_match = PUBLIC_ALIAS_TOKEN_PATTERN.fullmatch(normalized)
    if token_match:
        adjective_key = token_match.group("adjective")
        animal_key = token_match.group("animal")
        number = token_match.group("number")
        if adjective_key in PUBLIC_ALIAS_ADJECTIVE_KEY_SET and animal_key in PUBLIC_ALIAS_ANIMAL_KEY_SET:
            return f"{adjective_key}_{animal_key}_{number}"

    anonymous_match = PUBLIC_ALIAS_ANONYMOUS_PATTERN.fullmatch(normalized)
    if anonymous_match:
        return f"anonymous_member_{anonymous_match.group('code').lower()}"

    legacy_match = PUBLIC_ALIAS_LEGACY_PATTERN.fullmatch(normalized)
    if legacy_match:
        adjective_key = (
            PUBLIC_ALIAS_ADJECTIVE_BY_KO.get(legacy_match.group("adjective"))
            or PUBLIC_ALIAS_ADJECTIVE_BY_EN.get(legacy_match.group("adjective").lower())
        )
        animal_key = (
            PUBLIC_ALIAS_ANIMAL_BY_KO.get(legacy_match.group("animal"))
            or PUBLIC_ALIAS_ANIMAL_BY_EN.get(legacy_match.group("animal").lower())
        )
        if adjective_key and animal_key:
            return f"{adjective_key}_{animal_key}_{legacy_match.group('number')}"

    legacy_anonymous_match = PUBLIC_ALIAS_LEGACY_ANONYMOUS_PATTERN.fullmatch(normalized)
    if legacy_anonymous_match:
        return f"anonymous_member_{legacy_anonymous_match.group('code').lower()}"

    return None


def _looks_like_local_absolute_path(value: str) -> bool:
    normalized = str(value or "").strip()
    if not normalized:
        return False
    parsed = urlsplit(normalized)
    if parsed.scheme in {"http", "https"}:
        return False
    if normalized.startswith(("\\\\", "//", "/")):
        return True
    return bool(re.match(r"^[a-zA-Z]:[\\/]", normalized))


def _sanitize_remote_payload(value: Any, *, key: str | None = None) -> Any:
    normalized_key = str(key or "").strip().lower()
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            child_key = str(raw_key)
            child_key_normalized = child_key.strip().lower()
            if child_key_normalized in {"artifact_path", "central_artifact_path"}:
                continue
            child_value = _sanitize_remote_payload(raw_value, key=child_key)
            if child_value is None and child_key_normalized.endswith("_path"):
                continue
            sanitized[child_key] = child_value
        return sanitized
    if isinstance(value, list):
        sanitized_items = [_sanitize_remote_payload(item, key=key) for item in value]
        return [item for item in sanitized_items if item is not None]
    if isinstance(value, str):
        if normalized_key.endswith("_url"):
            return value
        if _looks_like_local_absolute_path(value):
            if normalized_key.endswith("_path"):
                return None
            return Path(value).name or None
    return value
INSTITUTION_SEARCH_ALIASES: dict[str, set[str]] = {
    "seoul": {"seoul", "서울"},
    "서울": {"seoul", "서울"},
    "busan": {"busan", "부산"},
    "부산": {"busan", "부산"},
    "daegu": {"daegu", "대구"},
    "대구": {"daegu", "대구"},
    "incheon": {"incheon", "인천"},
    "인천": {"incheon", "인천"},
    "gwangju": {"gwangju", "광주"},
    "광주": {"gwangju", "광주"},
    "daejeon": {"daejeon", "대전"},
    "대전": {"daejeon", "대전"},
    "ulsan": {"ulsan", "울산"},
    "울산": {"ulsan", "울산"},
    "sejong": {"sejong", "세종"},
    "세종": {"sejong", "세종"},
    "gyeonggi": {"gyeonggi", "경기", "경기도"},
    "경기": {"gyeonggi", "경기", "경기도"},
    "gangwon": {"gangwon", "강원", "강원도"},
    "강원": {"gangwon", "강원", "강원도"},
    "chungbuk": {"chungbuk", "충북", "충청북도"},
    "충북": {"chungbuk", "충북", "충청북도"},
    "chungnam": {"chungnam", "충남", "충청남도"},
    "충남": {"chungnam", "충남", "충청남도"},
    "jeonbuk": {"jeonbuk", "전북", "전라북도"},
    "전북": {"jeonbuk", "전북", "전라북도"},
    "jeonnam": {"jeonnam", "전남", "전라남도"},
    "전남": {"jeonnam", "전남", "전라남도"},
    "gyeongbuk": {"gyeongbuk", "경북", "경상북도"},
    "경북": {"gyeongbuk", "경북", "경상북도"},
    "gyeongnam": {"gyeongnam", "경남", "경상남도"},
    "경남": {"gyeongnam", "경남", "경상남도"},
    "jeju": {"jeju", "제주", "제주도", "제주특별자치도"},
    "제주": {"jeju", "제주", "제주도", "제주특별자치도"},
    "hospital": {"hospital", "병원"},
    "병원": {"hospital", "병원"},
    "university": {"university", "대학교", "대학"},
    "대학교": {"university", "대학교", "대학"},
    "대학": {"university", "대학교", "대학"},
    "clinic": {"clinic", "클리닉", "의원", "안과"},
    "클리닉": {"clinic", "클리닉", "의원", "안과"},
    "의원": {"clinic", "클리닉", "의원", "안과"},
    "eye": {"eye", "안과"},
    "안과": {"eye", "안과"},
}


def _hash_password(plain: str) -> str:
    return hash_password(plain)


def _is_bcrypt_hash(value: str) -> bool:
    return is_bcrypt_hash(value)


def _is_pbkdf2_sha256_hash(value: str) -> bool:
    return is_pbkdf2_sha256_hash(value)


def _verify_pbkdf2_sha256_hash(password: str, encoded: str) -> bool:
    return verify_pbkdf2_sha256_hash(password, encoded)


def _normalize_password_storage(value: str) -> str:
    normalized = str(value or "")
    if (
        not normalized
        or normalized == GOOGLE_AUTH_SENTINEL
        or _is_bcrypt_hash(normalized)
        or _is_pbkdf2_sha256_hash(normalized)
    ):
        return normalized
    return _hash_password(normalized)


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping)


def _coerce_payload_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if value is None:
        return {}
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    try:
        return dict(value)
    except (TypeError, ValueError):
        return {}


def _payload_record(row: Any, payload_key: str, extra_keys: list[str]) -> dict[str, Any]:
    mapping = row._mapping
    payload = _coerce_payload_object(mapping[payload_key])
    for key in extra_keys:
        if key not in payload and mapping.get(key) is not None:
            payload[key] = mapping.get(key)
    return payload


def _tokenize_institution_search(value: str) -> list[str]:
    return [token for token in re.split(r"[^0-9a-zA-Z가-힣]+", str(value or "").strip().lower()) if token]


def _expand_institution_search_terms(value: str) -> list[list[str]]:
    groups: list[list[str]] = []
    for token in _tokenize_institution_search(value):
        aliases = sorted(INSTITUTION_SEARCH_ALIASES.get(token, {token}))
        if aliases not in groups:
            groups.append(aliases)
    return groups


def _normalize_registry_consents(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, dict[str, Any]] = {}
    for raw_site_id, raw_payload in value.items():
        site_id = str(raw_site_id or "").strip()
        if not site_id:
            continue
        payload = raw_payload if isinstance(raw_payload, dict) else {}
        enrolled_at = str(payload.get("enrolled_at") or "").strip()
        if not enrolled_at:
            continue
        normalized[site_id] = {
            "enrolled_at": enrolled_at,
            "version": str(payload.get("version") or "v1").strip() or "v1",
        }
    return normalized


def _replace_path_prefix_in_value(value: Any, old_root: Path, new_root: Path) -> Any:
    old_prefix = os.path.normcase(os.path.normpath(str(old_root)))
    new_root_str = str(new_root)

    if isinstance(value, dict):
        return {key: _replace_path_prefix_in_value(item, old_root, new_root) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_path_prefix_in_value(item, old_root, new_root) for item in value]
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value

    normalized_text = os.path.normcase(os.path.normpath(text))
    if normalized_text == old_prefix:
        return new_root_str
    prefix = old_prefix + os.sep
    if normalized_text.startswith(prefix):
        relative_part = text[len(str(old_root)):].lstrip("\\/")
        return str(new_root / Path(relative_part))
    return value


_MODEL_VERSION_LOCK = threading.Lock()


class ControlPlaneStore:
    def __init__(self, root: Path | None = None) -> None:
        ensure_base_directories()
        init_control_plane_db()
        self.root = root or CONTROL_PLANE_DIR
        self.artifact_root = CONTROL_PLANE_ARTIFACT_DIR
        ensure_dir(self.root)
        ensure_dir(CONTROL_PLANE_CASE_DIR)
        ensure_dir(CONTROL_PLANE_REPORT_DIR)
        ensure_dir(CONTROL_PLANE_EXPERIMENT_DIR)
        ensure_dir(self.artifact_root)
        self.remote_control_plane = RemoteControlPlaneClient()
        self.identity = ControlPlaneIdentityFacade(
            self,
            google_auth_sentinel=GOOGLE_AUTH_SENTINEL,
            normalize_registry_consents=_normalize_registry_consents,
            normalize_password_storage=_normalize_password_storage,
            normalize_public_alias_token=_normalize_public_alias_token,
            make_public_alias=_make_public_alias,
        )
        self.instance_state = ControlPlaneInstanceStateFacade(
            self,
            instance_storage_root_setting_key=APP_SETTING_INSTANCE_STORAGE_ROOT,
            institution_directory_last_sync_setting_key=APP_SETTING_INSTITUTION_DIRECTORY_LAST_SYNC,
        )
        self.bootstrap_projection = ControlPlaneBootstrapProjectionFacade(
            self,
            infer_remote_source_provider=_infer_remote_source_provider,
            site_display_label=_site_display_label,
        )
        self.references = ControlPlaneCaseReferenceFacade()
        self.artifacts = ControlPlaneArtifactFacade(
            artifact_root=self.artifact_root,
            infer_remote_source_provider=_infer_remote_source_provider,
            safe_artifact_name=_safe_artifact_name,
        )
        self.registry = ControlPlaneRegistryOps(
            self,
            payload_record=_payload_record,
        )
        self.workspace = ControlPlaneWorkspaceOps(
            self,
            site_id_pattern=HIRA_SITE_ID_PATTERN,
            payload_record=_payload_record,
            replace_path_prefix_in_value=_replace_path_prefix_in_value,
            sanitize_remote_payload=_sanitize_remote_payload,
        )
        self.remote_state = ControlPlaneRemoteState(
            root=self.root,
            remote_control_plane=self.remote_control_plane,
            remote_node_sync_enabled=self.remote_node_sync_enabled,
            clear_remote_credentials=clear_node_credentials,
            cache_remote_release_locally=self._cache_remote_release_locally,
            bootstrap_refresh_seconds=CONTROL_PLANE_BOOTSTRAP_REFRESH_SECONDS,
            release_cache_seconds=REMOTE_CURRENT_RELEASE_CACHE_SECONDS,
        )
        self.models = ControlPlaneModelFacade(self)
        self.results = ControlPlaneResultsFacade(self)
        self.workspace_views = ControlPlaneWorkspaceFacade(self)
        self.seeding = ControlPlaneSeedingFacade(
            normalize_password_storage=_normalize_password_storage,
        )
        self.catalog = ControlPlaneCatalogFacade(
            self,
            hira_api_key=HIRA_API_KEY,
            institution_directory_last_sync_setting_key=APP_SETTING_INSTITUTION_DIRECTORY_LAST_SYNC,
            expand_institution_search_terms=_expand_institution_search_terms,
        )
        self._seed_defaults()

    def remote_control_plane_enabled(self) -> bool:
        return self.remote_control_plane.is_configured()

    def remote_node_sync_enabled(self) -> bool:
        return self.remote_control_plane.is_configured() and self.remote_control_plane.has_node_credentials()

    def reload_remote_control_plane_credentials(self) -> dict[str, str] | None:
        return self.remote_control_plane.reload_credentials()

    def clear_remote_control_plane_state(self, *, clear_persisted_credentials: bool = False) -> None:
        self.remote_state.clear(clear_persisted_credentials=clear_persisted_credentials)

    def remote_node_os_info(self) -> str:
        return self.remote_state.remote_node_os_info()

    def remote_bootstrap_state(self, *, force_refresh: bool = False) -> dict[str, Any] | None:
        return self.remote_state.bootstrap_state(force_refresh=force_refresh)

    def record_remote_node_heartbeat(
        self,
        *,
        app_version: str = "",
        os_info: str = "",
        status: str = "ok",
    ) -> dict[str, Any] | None:
        return self.remote_state.record_node_heartbeat(
            app_version=app_version,
            os_info=os_info,
            status=status,
        )

    def _remote_current_release_manifest(self, *, force_refresh: bool = False) -> dict[str, Any] | None:
        return self.remote_state.current_release_manifest(force_refresh=force_refresh)

    def _normalize_remote_release(self, release: dict[str, Any]) -> dict[str, Any]:
        return self.bootstrap_projection.normalize_remote_release(release)

    def _cache_remote_release_locally(self, release: dict[str, Any]) -> dict[str, Any]:
        return self.bootstrap_projection.cache_remote_release_locally(release)

    def sanitize_remote_payload(self, value: Any, *, key: str | None = None) -> Any:
        return _sanitize_remote_payload(value, key=key)

    def infer_remote_source_provider(self, download_url: str) -> str:
        return _infer_remote_source_provider(download_url)

    def case_reference_salt_fingerprint(self) -> str:
        return CASE_REFERENCE_SALT_FINGERPRINT

    def site_display_label(self, site: dict[str, Any] | None, fallback: str = "") -> str:
        return _site_display_label(site, fallback)

    def payload_record(self, row: Any, payload_key: str, extra_keys: list[str]) -> dict[str, Any]:
        return _payload_record(row, payload_key, extra_keys)

    def _remote_bootstrap_project_records(self) -> list[dict[str, Any]]:
        return self.bootstrap_projection.remote_bootstrap_project_records()

    def _remote_bootstrap_site_records(self) -> list[dict[str, Any]]:
        return self.bootstrap_projection.remote_bootstrap_site_records()

    def default_instance_storage_root(self) -> Path:
        return self.instance_state.default_instance_storage_root()

    def configured_default_instance_storage_root(self) -> Path:
        return self.instance_state.configured_default_instance_storage_root()

    def instance_storage_root_source(self) -> str:
        return self.instance_state.instance_storage_root_source()

    def get_app_setting(self, setting_key: str) -> str | None:
        return self.instance_state.get_app_setting(setting_key)

    def set_app_setting(self, setting_key: str, setting_value: str) -> str:
        return self.instance_state.set_app_setting(setting_key, setting_value)

    def institution_directory_sync_status(self) -> dict[str, Any]:
        return self.instance_state.institution_directory_sync_status()

    def instance_storage_root(self) -> str:
        return self.instance_state.instance_storage_root()

    def site_storage_root(self, site_id: str) -> str:
        return self.instance_state.site_storage_root(site_id)

    def _sha256_file(self, path: Path) -> str:
        return self.artifacts.sha256_file(path)

    def case_reference_id(self, site_id: str, patient_id: str, visit_date: str) -> str:
        return self.references.case_reference_id(site_id, patient_id, visit_date)

    def patient_reference_id(self, site_id: str, patient_id: str) -> str:
        return self.references.patient_reference_id(site_id, patient_id)

    def _normalize_case_reference(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.references.normalize_case_reference(record)

    def _normalize_validation_record(self, site_id: str, record: dict[str, Any]) -> dict[str, Any]:
        return self.references.normalize_validation_record(site_id, record)

    def model_update_artifact_key(self, *, update_id: str, artifact_kind: str = "delta", filename: str = "") -> str:
        return self.artifacts.model_update_artifact_key(
            update_id=update_id,
            artifact_kind=artifact_kind,
            filename=filename,
        )

    def model_update_artifact_path_for_key(self, artifact_key: str) -> Path:
        return self.artifacts.model_update_artifact_path_for_key(artifact_key)

    def normalize_model_update_artifact_metadata(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.artifacts.normalize_model_update_artifact_metadata(record)

    def resolve_model_update_artifact_path(
        self,
        record: dict[str, Any],
        *,
        allow_download: bool = True,
    ) -> Path:
        return self.artifacts.resolve_model_update_artifact_path(record, allow_download=allow_download)

    def publish_model_update_artifact(
        self,
        update_id: str,
        *,
        download_url: str,
        artifact_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.models.publish_model_update_artifact(
            update_id,
            download_url=download_url,
            artifact_metadata=artifact_metadata,
        )

    def store_model_update_artifact(
        self,
        source_path: str | Path,
        *,
        update_id: str,
        artifact_kind: str = "delta",
    ) -> dict[str, Any]:
        return self.artifacts.store_model_update_artifact(
            source_path,
            update_id=update_id,
            artifact_kind=artifact_kind,
        )

    def _seed_defaults(self) -> None:
        self.seeding.seed_defaults()

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        return self.identity.authenticate(username, password)

    def _serialize_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        return self.identity.serialize_user(user_record)

    def _load_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.load_user_by_id(user_id)

    def _load_user_by_username(self, username: str) -> dict[str, Any] | None:
        return self.identity.load_user_by_username(username)

    def _load_user_by_google_sub(self, google_sub: str) -> dict[str, Any] | None:
        return self.identity.load_user_by_google_sub(google_sub)

    def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_id(user_id)

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_username(username)

    def get_user_by_google_sub(self, google_sub: str) -> dict[str, Any] | None:
        return self.identity.get_user_by_google_sub(google_sub)

    def list_users(self) -> list[dict[str, Any]]:
        return self.identity.list_users()

    def delete_user(self, user_id: str) -> None:
        return self.identity.delete_user(user_id)

    def upsert_user(self, user_record: dict[str, Any]) -> dict[str, Any]:
        return self.identity.upsert_user(user_record)

    def ensure_google_user(self, google_sub: str, email: str, full_name: str) -> dict[str, Any]:
        return self.identity.ensure_google_user(google_sub, email, full_name)

    def get_user_public_alias(self, user_id: str) -> str | None:
        return self.identity.get_user_public_alias(user_id)

    def list_user_public_aliases(self, user_ids: list[str]) -> dict[str, str]:
        return self.identity.list_user_public_aliases(user_ids)

    def user_approval_status(self, user: dict[str, Any]) -> str:
        return self.identity.user_approval_status(user)

    def submit_access_request(
        self,
        user_id: str,
        requested_site_id: str,
        requested_role: str,
        message: str = "",
        *,
        requested_site_label: str = "",
        requested_site_source: str = "site",
    ) -> dict[str, Any]:
        return self.identity.submit_access_request(
            user_id,
            requested_site_id,
            requested_role,
            message,
            requested_site_label=requested_site_label,
            requested_site_source=requested_site_source,
        )

    def latest_access_request(self, user_id: str) -> dict[str, Any] | None:
        return self.identity.latest_access_request(user_id)

    def list_access_requests(
        self,
        status: str | None = None,
        site_ids: list[str] | None = None,
        user_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.identity.list_access_requests(status=status, site_ids=site_ids, user_id=user_id)

    def review_access_request(
        self,
        request_id: str,
        reviewer_user_id: str,
        decision: str,
        assigned_role: str | None = None,
        assigned_site_id: str | None = None,
        reviewer_notes: str = "",
    ) -> dict[str, Any]:
        return self.identity.review_access_request(
            request_id,
            reviewer_user_id,
            decision,
            assigned_role=assigned_role,
            assigned_site_id=assigned_site_id,
            reviewer_notes=reviewer_notes,
        )

    def accessible_sites_for_user(self, user: dict[str, Any]) -> list[dict[str, Any]]:
        return self.identity.accessible_sites_for_user(user)

    def user_can_access_site(self, user: dict[str, Any], site_id: str | None) -> bool:
        return self.identity.user_can_access_site(user, site_id)

    def list_projects(self) -> list[dict[str, Any]]:
        return self.workspace_views.list_projects()

    def create_project(self, name: str, description: str, owner_user_id: str) -> dict[str, Any]:
        return self.workspace_views.create_project(name, description, owner_user_id)

    def list_sites(self, project_id: str | None = None) -> list[dict[str, Any]]:
        return self.workspace_views.list_sites(project_id)

    def get_site(self, site_id: str) -> dict[str, Any] | None:
        return self.workspace_views.get_site(site_id)

    def get_site_by_source_institution_id(self, source_institution_id: str) -> dict[str, Any] | None:
        return self.workspace_views.get_site_by_source_institution_id(source_institution_id)

    def list_institutions(
        self,
        *,
        search: str = "",
        sido_code: str | None = None,
        sggu_code: str | None = None,
        open_only: bool = True,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        return self.catalog.list_institutions(
            search=search,
            sido_code=sido_code,
            sggu_code=sggu_code,
            open_only=open_only,
            limit=limit,
        )

    def get_institution(self, institution_id: str) -> dict[str, Any] | None:
        return self.catalog.get_institution(institution_id)

    def upsert_institutions(self, records: list[dict[str, Any]]) -> int:
        return self.catalog.upsert_institutions(records)

    def sync_hira_ophthalmology_directory(
        self,
        *,
        page_size: int = 100,
        max_pages: int | None = None,
        service_key: str | None = None,
    ) -> dict[str, Any]:
        return self.catalog.sync_hira_ophthalmology_directory(
            page_size=page_size,
            max_pages=max_pages,
            service_key=service_key,
        )

    def create_site(
        self,
        project_id: str,
        site_code: str | None = None,
        display_name: str | None = None,
        hospital_name: str = "",
        source_institution_id: str | None = None,
        research_registry_enabled: bool = True,
    ) -> dict[str, Any]:
        return self.workspace.create_site(
            project_id,
            site_code,
            display_name,
            hospital_name,
            source_institution_id=source_institution_id,
            research_registry_enabled=research_registry_enabled,
        )

    def update_site_metadata(
        self,
        site_id: str,
        display_name: str | None = None,
        hospital_name: str = "",
        source_institution_id: str | None | object = SOURCE_INSTITUTION_ID_UNSET,
        research_registry_enabled: bool | None = None,
    ) -> dict[str, Any]:
        return self.workspace.update_site_metadata(
            site_id,
            display_name,
            hospital_name,
            source_institution_id=source_institution_id,
            research_registry_enabled=research_registry_enabled,
        )

    def update_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        return self.workspace.update_site_storage_root(site_id, storage_root)

    def migrate_site_storage_root(self, site_id: str, storage_root: str) -> dict[str, Any]:
        return self.workspace.migrate_site_storage_root(site_id, storage_root)

    def get_registry_consent(self, user_id: str, site_id: str) -> dict[str, Any] | None:
        return self.identity.get_registry_consent(user_id, site_id)

    def set_registry_consent(self, user_id: str, site_id: str, *, version: str = "v1") -> dict[str, Any]:
        return self.identity.set_registry_consent(user_id, site_id, version=version)

    def list_organisms(self, category: str | None = None) -> list[str] | dict[str, list[str]]:
        return self.catalog.list_organisms(category)

    def request_new_organism(
        self,
        culture_category: str,
        requested_species: str,
        requested_by: str,
    ) -> dict[str, Any]:
        return self.catalog.request_new_organism(culture_category, requested_species, requested_by)

    def list_organism_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        return self.catalog.list_organism_requests(status)

    def approve_organism(self, request_id: str, approver_user_id: str) -> dict[str, Any]:
        return self.catalog.approve_organism(request_id, approver_user_id)

    def list_validation_runs(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self.results.list_validation_runs(project_id=project_id, site_id=site_id, limit=limit)

    def site_validation_site_summaries(
        self,
        site_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return self.results.site_validation_site_summaries(site_ids=site_ids)

    def validation_run_summary(
        self,
        project_id: str | None = None,
        site_id: str | None = None,
    ) -> dict[str, Any]:
        return self.results.validation_run_summary(project_id=project_id, site_id=site_id)

    def list_validation_cases(
        self,
        *,
        validation_id: str | None = None,
        site_id: str | None = None,
        patient_reference_id: str | None = None,
        case_reference_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.results.list_validation_cases(
            validation_id=validation_id,
            site_id=site_id,
            patient_reference_id=patient_reference_id,
            case_reference_id=case_reference_id,
        )

    def save_validation_run(
        self,
        summary: dict[str, Any],
        case_predictions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return self.results.save_validation_run(summary, case_predictions)

    def load_case_predictions(self, validation_id: str) -> list[dict[str, Any]]:
        return self.results.load_case_predictions(validation_id)

    def update_validation_case_prediction(
        self,
        validation_id: str,
        *,
        case_reference_id: str,
        updates: dict[str, Any],
    ) -> dict[str, Any] | None:
        return self.results.update_validation_case_prediction(
            validation_id,
            case_reference_id=case_reference_id,
            updates=updates,
        )

    def save_experiment(self, experiment_record: dict[str, Any]) -> dict[str, Any]:
        return self.results.save_experiment(experiment_record)

    def get_experiment(self, experiment_id: str) -> dict[str, Any] | None:
        return self.results.get_experiment(experiment_id)

    def list_experiments(
        self,
        *,
        site_id: str | None = None,
        experiment_type: str | None = None,
        status_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.results.list_experiments(
            site_id=site_id,
            experiment_type=experiment_type,
            status_filter=status_filter,
        )

    def list_model_versions(self) -> list[dict[str, Any]]:
        return self.models.list_model_versions()

    def _set_model_current_flag(
        self,
        conn: Any,
        version_id: str,
        is_current: bool,
    ) -> None:
        return self.registry.set_model_current_flag(conn, version_id, is_current)

    def ensure_model_version(self, model_metadata: dict[str, Any]) -> dict[str, Any]:
        return self.models.ensure_model_version(model_metadata)

    def current_global_model(self) -> dict[str, Any] | None:
        return self.models.current_global_model()

    def archive_model_version(self, version_id: str) -> dict[str, Any]:
        return self.models.archive_model_version(version_id)

    def register_model_update(self, update_metadata: dict[str, Any]) -> dict[str, Any]:
        return self.models.register_model_update(update_metadata)

    def get_model_update(self, update_id: str) -> dict[str, Any] | None:
        return self.models.get_model_update(update_id)

    def update_model_update(self, update_id: str, updates: dict[str, Any]) -> dict[str, Any]:
        return self.models.update_model_update(update_id, updates)

    def update_model_update_statuses(self, update_ids: list[str], status: str) -> None:
        self.models.update_model_update_statuses(update_ids, status)

    def review_model_update(
        self,
        update_id: str,
        reviewer_user_id: str,
        decision: str,
        reviewer_notes: str = "",
    ) -> dict[str, Any]:
        return self.models.review_model_update(update_id, reviewer_user_id, decision, reviewer_notes)

    def list_model_updates(self, site_id: str | None = None) -> list[dict[str, Any]]:
        return self.models.list_model_updates(site_id)

    def register_contribution(self, contribution: dict[str, Any]) -> dict[str, Any]:
        return self.registry.register_contribution(contribution)

    def list_contributions(self, user_id: str | None = None, site_id: str | None = None) -> list[dict[str, Any]]:
        return self.registry.list_contributions(user_id=user_id, site_id=site_id)

    def get_contribution_leaderboard(
        self,
        *,
        user_id: str | None = None,
        site_id: str | None = None,
        limit: int = 5,
    ) -> dict[str, Any]:
        return self.registry.get_contribution_leaderboard(user_id=user_id, site_id=site_id, limit=limit)

    def get_contribution_stats(self, user_id: str | None = None) -> dict[str, Any]:
        return self.registry.get_contribution_stats(user_id)

    def list_aggregations(self) -> list[dict[str, Any]]:
        return self.models.list_aggregations()

    def register_aggregation(
        self,
        base_model_version_id: str,
        new_model_path: str,
        new_version_name: str,
        architecture: str,
        site_weights: dict[str, int],
        requires_medsam_crop: bool = False,
        decision_threshold: float | None = None,
        threshold_selection_metric: str | None = None,
        threshold_selection_metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.models.register_aggregation(
            base_model_version_id,
            new_model_path,
            new_version_name,
            architecture,
            site_weights,
            requires_medsam_crop=requires_medsam_crop,
            decision_threshold=decision_threshold,
            threshold_selection_metric=threshold_selection_metric,
            threshold_selection_metrics=threshold_selection_metrics,
        )

    def get_public_statistics(self) -> dict[str, Any]:
        """Return aggregated public statistics (no auth required)."""
        from sqlalchemy import func

        with CONTROL_PLANE_ENGINE.begin() as conn:
            # Count sites
            site_count_result = conn.execute(select(func.count()).select_from(sites)).scalar() or 0

            # Get current model version name
            current_model_row = conn.execute(
                select(model_versions.c.version_name)
                .where(model_versions.c.is_current == True)
                .order_by(model_versions.c.created_at.desc())
                .limit(1)
            ).first()
            current_model = current_model_row[0] if current_model_row else None

            # Sum validation run stats for total cases and images
            validation_stats = conn.execute(
                select(
                    func.sum(validation_runs.c.n_cases),
                    func.sum(validation_runs.c.n_images),
                )
            ).first()
            total_cases = validation_stats[0] or 0 if validation_stats else 0
            total_images = validation_stats[1] or 0 if validation_stats else 0

        return {
            "site_count": int(site_count_result),
            "total_cases": int(total_cases),
            "total_images": int(total_images),
            "current_model_version": current_model,
            "last_updated": utc_now(),
        }
