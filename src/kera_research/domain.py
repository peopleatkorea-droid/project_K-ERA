from __future__ import annotations

import hashlib
from datetime import datetime, timezone
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
DENSENET_VARIANTS = ["densenet121", "densenet161", "densenet169", "densenet201"]
TRAINING_ARCHITECTURES = [*DENSENET_VARIANTS, "convnext_tiny"]
MODEL_ARCHITECTURES = ["cnn", "vit", "swin", *TRAINING_ARCHITECTURES]

CULTURE_SPECIES = {
    "bacterial": [
        "Staphylococcus aureus",
        "Staphylococcus epidermidis",
        "Staphylococcus hominis",
        "Coagulase-negative Staphylococcus",
        "Streptococcus pneumoniae",
        "Streptococcus viridans group",
        "Pseudomonas aeruginosa",
        "Moraxella",
        "Corynebacterium",
        "Serratia marcescens",
        "Bacillus",
        "Haemophilus influenzae",
        "Klebsiella pneumoniae",
        "Enterobacter",
        "Burkholderia",
        "Nocardia",
        "Other",
    ],
    "fungal": [
        "Fusarium",
        "Aspergillus",
        "Candida",
        "Curvularia",
        "Alternaria",
        "Colletotrichum",
        "Acremonium",
        "Lasiodiplodia",
        "Cladophialophora",
        "Australiasca",
        "Penicillium",
        "Bipolaris",
        "Scedosporium",
        "Paecilomyces",
        "Exserohilum",
        "Cladosporium",
        "Other",
    ],
}

LABEL_TO_INDEX = {"bacterial": 0, "fungal": 1}
INDEX_TO_LABEL = {0: "bacterial", 1: "fungal"}

MANIFEST_COLUMNS = [
    "site_id",
    "patient_id",
    "chart_alias",
    "local_case_code",
    "sex",
    "age",
    "visit_date",
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


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
