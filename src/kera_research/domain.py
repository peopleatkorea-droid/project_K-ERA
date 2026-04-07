from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Iterable
from uuid import uuid4

SEX_OPTIONS = ["female", "male", "unknown"]
CONTACT_LENS_OPTIONS = [
    "none",
    "soft contact lens",
    "rigid gas permeable",
    "orthokeratology",
    "unknown",
]
PREDISPOSING_FACTORS = [
    "trauma",
    "contact lens",
    "ocular surface disease",
    "topical steroid use",
    "post surgery",
    "neurotrophic",
    "unknown",
]
VIEW_OPTIONS = ["white", "slit", "fluorescein"]
SMEAR_RESULT_OPTIONS = ["not done", "positive", "negative", "unknown", "other"]
VISIT_STATUS_OPTIONS = ["active", "improving", "scar"]
USER_ROLE_OPTIONS = ["admin", "site_admin", "researcher", "viewer"]
EXECUTION_MODES = ["Auto", "CPU mode", "GPU mode"]
DENSENET_VARIANTS = ["densenet121"]
ATTENTION_MIL_ARCHITECTURES = [
    "dinov2_mil",
    "swin_mil",
    "efficientnet_v2_s_mil",
    "convnext_tiny_mil",
    "densenet121_mil",
    "efficientnet_v2_s_dinov2_lesion_mil",
]
PAIRED_ATTENTION_MIL_ARCHITECTURES = [
    "efficientnet_v2_s_dinov2_lesion_mil",
]
BASE_TRAINING_ARCHITECTURES = [
    "densenet121",
    "convnext_tiny",
    "vit",
    "swin",
    "efficientnet_v2_s",
    "dinov2",
    *ATTENTION_MIL_ARCHITECTURES,
    "dual_input_concat",
]
LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX = "lesion_guided_fusion__"
THREE_SCALE_LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX = "lesion_guided_fusion_3scale__"
LESION_GUIDED_FUSION_ARCHITECTURE_PREFIXES = (
    LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX,
    THREE_SCALE_LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX,
)
LESION_GUIDED_FUSION_BACKBONES = ["efficientnet_v2_s", "densenet121", "convnext_tiny", "vit", "swin", "dinov2"]
LESION_GUIDED_FUSION_ARCHITECTURES = [
    f"{LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX}{backbone}"
    for backbone in LESION_GUIDED_FUSION_BACKBONES
]
THREE_SCALE_LESION_GUIDED_FUSION_ARCHITECTURES = [
    f"{THREE_SCALE_LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX}{backbone}"
    for backbone in LESION_GUIDED_FUSION_BACKBONES
]
TRAINING_ARCHITECTURES = [
    *BASE_TRAINING_ARCHITECTURES,
    *LESION_GUIDED_FUSION_ARCHITECTURES,
    *THREE_SCALE_LESION_GUIDED_FUSION_ARCHITECTURES,
]
MODEL_ARCHITECTURES = list(dict.fromkeys(TRAINING_ARCHITECTURES))

CULTURE_SPECIES = {
    "bacterial": [
        "Staphylococcus aureus",
        "Staphylococcus epidermidis",
        "Staphylococcus hominis",
        "Coagulase-negative Staphylococcus",
        "Other Staphylococcus species",
        "Streptococcus pneumoniae",
        "Streptococcus viridans group",
        "Other Streptococcus species",
        "Enterococcus faecalis",
        "Gemella species",
        "Granulicatella species",
        "Pseudomonas aeruginosa",
        "Moraxella",
        "Corynebacterium",
        "Rothia",
        "Serratia marcescens",
        "Bacillus",
        "Other Gram-positive rods",
        "Other Gram-negative rods",
        "Haemophilus influenzae",
        "Klebsiella pneumoniae",
        "Enterobacter",
        "Citrobacter",
        "Burkholderia",
        "Pandoraea species",
        "Stenotrophomonas",
        "Achromobacter",
        "Nocardia",
        "Other",
    ],
    "fungal": [
        # Common molds first, then the remaining named molds, then yeasts, then catch-alls.
        "Fusarium",
        "Aspergillus",
        "Acremonium",
        "Alternaria",
        "Australiasca species",
        "Beauveria bassiana",
        "Bipolaris",
        "Cladophialophora",
        "Cladosporium",
        "Colletotrichum",
        "Curvularia",
        "Exserohilum",
        "Lasiodiplodia",
        "Paecilomyces",
        "Penicillium",
        "Scedosporium",
        "Other Molds",
        "Candida",
        "Other Yeasts",
        "Other",
    ],
}


def order_culture_species(category: str | None, species_names: Iterable[str]) -> list[str]:
    normalized_category = str(category or "").strip().lower()
    canonical_order = CULTURE_SPECIES.get(normalized_category, [])
    canonical_rank = {species.casefold(): index for index, species in enumerate(canonical_order)}
    deduped_species: list[str] = []
    seen: set[str] = set()

    for raw_species in species_names:
        species = str(raw_species or "").strip()
        if not species:
            continue
        species_key = species.casefold()
        if species_key in seen:
            continue
        seen.add(species_key)
        deduped_species.append(species)

    if not canonical_order:
        return sorted(deduped_species, key=str.casefold)

    return sorted(
        deduped_species,
        key=lambda species: (
            0 if species.casefold() in canonical_rank else 1,
            canonical_rank.get(species.casefold(), len(canonical_rank)),
            species.casefold(),
        ),
    )

LABEL_TO_INDEX = {"bacterial": 0, "fungal": 1, "unknown": -1, "pending": -1, "none": -1}
INDEX_TO_LABEL = {0: "bacterial", 1: "fungal", -1: "unknown"}

MANIFEST_COLUMNS = [
    "site_id",
    "patient_id",
    "chart_alias",
    "local_case_code",
    "sex",
    "age",
    "visit_date",
    "culture_status",
    "culture_confirmed",
    "culture_category",
    "culture_species",
    "contact_lens_use",
    "predisposing_factor",
    "visit_status",
    "active_stage",
    "other_history",
    "smear_result",
    "polymicrobial",
    "view",
    "image_path",
    "is_representative",
    "lesion_prompt_box",
]

_PATIENT_LOCAL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_VISIT_INITIAL_PATTERN = re.compile(r"^(?:initial|initial visit|초진)$", re.IGNORECASE)
_VISIT_FOLLOW_UP_PATTERN = re.compile(r"^(?:F[\s/]*U|U)[-\s_#]*0*(\d+)$", re.IGNORECASE)
_ACTUAL_VISIT_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_lesion_guided_fusion_architecture(value: str | None) -> bool:
    normalized = str(value or "").strip().lower()
    return any(normalized.startswith(prefix) for prefix in LESION_GUIDED_FUSION_ARCHITECTURE_PREFIXES)


def is_three_scale_lesion_guided_fusion_architecture(value: str | None) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized.startswith(THREE_SCALE_LESION_GUIDED_FUSION_ARCHITECTURE_PREFIX)


def lesion_guided_fusion_backbone(value: str | None) -> str | None:
    normalized = str(value or "").strip().lower()
    if not is_lesion_guided_fusion_architecture(normalized):
        return None
    for prefix in LESION_GUIDED_FUSION_ARCHITECTURE_PREFIXES:
        if normalized.startswith(prefix):
            backbone = normalized[len(prefix) :].strip()
            return backbone or None
    return None


def is_dual_input_training_architecture(value: str | None) -> bool:
    normalized = str(value or "").strip().lower()
    return (
        normalized == "dual_input_concat"
        or normalized in PAIRED_ATTENTION_MIL_ARCHITECTURES
        or is_lesion_guided_fusion_architecture(normalized)
    )


def is_attention_mil_architecture(value: str | None) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized in ATTENTION_MIL_ARCHITECTURES


def is_paired_attention_mil_architecture(value: str | None) -> bool:
    normalized = str(value or "").strip().lower()
    return normalized in PAIRED_ATTENTION_MIL_ARCHITECTURES


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def make_case_reference_id(site_id: str, patient_id: str, visit_date: str, salt: str) -> str:
    payload = "::".join(
        [
            salt.strip(),
            site_id.strip(),
            patient_id.strip(),
            visit_date.strip(),
        ]
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"caseref_{digest[:20]}"


def make_patient_reference_id(site_id: str, patient_id: str, salt: str) -> str:
    payload = "::".join(
        [
            salt.strip(),
            site_id.strip(),
            patient_id.strip(),
        ]
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"ptref_{digest[:20]}"


def visit_index_from_label(value: str) -> int:
    normalized = normalize_visit_label(value)
    if normalized == "Initial":
        return 0
    follow_up_match = _VISIT_FOLLOW_UP_PATTERN.fullmatch(normalized)
    if follow_up_match:
        return max(1, int(follow_up_match.group(1)))
    raise ValueError("Visit reference must resolve to Initial or FU #N.")


def visit_label_from_index(value: int) -> str:
    index = int(value)
    if index <= 0:
        return "Initial"
    return f"FU #{index}"


def normalize_patient_pseudonym(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("Patient ID is required.")
    if not _PATIENT_LOCAL_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Patient ID must use a local chart/MRN-style ID (letters, numbers, ., -, _ only).")
    return normalized


def normalize_visit_label(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError("Visit reference is required.")
    if _VISIT_INITIAL_PATTERN.fullmatch(normalized):
        return "Initial"
    follow_up_match = _VISIT_FOLLOW_UP_PATTERN.fullmatch(normalized)
    if follow_up_match:
        follow_up_number = max(1, int(follow_up_match.group(1)))
        return f"FU #{follow_up_number}"
    raise ValueError("Visit reference must be 'Initial' or 'FU #N'. Store the exact calendar date in actual_visit_date only.")


def normalize_actual_visit_date(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if not _ACTUAL_VISIT_DATE_PATTERN.fullmatch(normalized):
        raise ValueError("Actual visit date must use YYYY-MM-DD format.")
    return normalized


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
