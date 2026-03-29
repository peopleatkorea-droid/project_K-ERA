from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps
from kera_research.services.biomedclip_runtime import BIOMEDCLIP_MODEL_ID, ensure_biomedclip_runtime


@dataclass(frozen=True)
class PromptEntry:
    prompt_id: str
    label: str
    prompt: str
    layer_id: str
    layer_label: str


_STANDARD_PROMPTS: dict[str, list[PromptEntry]] = {
    "diagnosis": [
        PromptEntry("fungal_keratitis", "Fungal keratitis", "a slit lamp photograph of fungal keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("bacterial_keratitis", "Bacterial keratitis", "a slit lamp photograph of bacterial keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("acanthamoeba_keratitis", "Acanthamoeba keratitis", "a slit lamp photograph of acanthamoeba keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("herpetic_epithelial_keratitis", "Herpetic epithelial keratitis", "a slit lamp photograph of herpetic epithelial keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("herpetic_stromal_keratitis", "Herpetic stromal keratitis", "a slit lamp photograph of herpetic stromal keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("neurotrophic_keratitis", "Neurotrophic keratitis", "a slit lamp photograph of neurotrophic keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("marginal_keratitis", "Marginal keratitis", "a slit lamp photograph of marginal keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("sterile_corneal_ulcer", "Sterile corneal ulcer", "a slit lamp photograph of sterile corneal ulcer", "diagnosis", "Diagnosis"),
        PromptEntry("infectious_corneal_ulcer", "Corneal ulcer of infectious origin", "a slit lamp photograph of corneal ulcer of infectious origin", "diagnosis", "Diagnosis"),
        PromptEntry("severe_microbial_keratitis", "Severe microbial keratitis", "a slit lamp photograph of severe microbial keratitis", "diagnosis", "Diagnosis"),
    ],
    "morphology": [
        PromptEntry("feathery_borders", "Feathery borders", "a slit lamp photograph of a corneal ulcer with feathery borders", "morphology", "Morphology"),
        PromptEntry("irregular_serrated_margins", "Irregular serrated margins", "a slit lamp photograph of a corneal ulcer with irregular serrated margins", "morphology", "Morphology"),
        PromptEntry("well_defined_margins", "Well-defined margins", "a slit lamp photograph of a corneal ulcer with well-defined margins", "morphology", "Morphology"),
        PromptEntry("indistinct_borders", "Indistinct borders", "a slit lamp photograph of a corneal ulcer with indistinct borders", "morphology", "Morphology"),
        PromptEntry("dense_stromal_infiltrate", "Dense stromal infiltrate", "a slit lamp photograph showing dense stromal infiltrate", "morphology", "Morphology"),
        PromptEntry("fluffy_stromal_infiltrate", "Fluffy stromal infiltrate", "a slit lamp photograph showing fluffy stromal infiltrate", "morphology", "Morphology"),
        PromptEntry("patchy_stromal_opacity", "Patchy stromal opacity", "a slit lamp photograph showing patchy stromal opacity", "morphology", "Morphology"),
        PromptEntry("central_corneal_infiltrate", "Central corneal infiltrate", "a slit lamp photograph showing central corneal infiltrate", "morphology", "Morphology"),
        PromptEntry("paracentral_corneal_infiltrate", "Paracentral corneal infiltrate", "a slit lamp photograph showing paracentral corneal infiltrate", "morphology", "Morphology"),
        PromptEntry("satellite_lesions", "Satellite lesions", "a slit lamp photograph showing satellite lesions around a corneal ulcer", "morphology", "Morphology"),
        PromptEntry("multiple_small_infiltrates", "Multiple small stromal infiltrates", "a slit lamp photograph showing multiple small stromal infiltrates around the main lesion", "morphology", "Morphology"),
        PromptEntry("ring_shaped_infiltrate", "Ring-shaped stromal infiltrate", "a slit lamp photograph showing a ring-shaped stromal infiltrate", "morphology", "Morphology"),
        PromptEntry("immune_ring_infiltrate", "Immune ring infiltrate", "a slit lamp photograph showing immune ring infiltrate in the cornea", "morphology", "Morphology"),
        PromptEntry("dendritic_epithelial_lesion", "Dendritic epithelial lesion", "a slit lamp photograph showing a dendritic epithelial lesion", "morphology", "Morphology"),
        PromptEntry("geographic_epithelial_ulcer", "Geographic epithelial ulcer", "a slit lamp photograph showing geographic epithelial ulcer", "morphology", "Morphology"),
        PromptEntry("epithelial_defect_with_infiltrate", "Epithelial defect with stromal infiltrate", "a slit lamp photograph showing epithelial defect with stromal infiltrate", "morphology", "Morphology"),
        PromptEntry("stromal_edema", "Stromal edema around infiltrate", "a slit lamp photograph showing stromal edema around the infiltrate", "morphology", "Morphology"),
        PromptEntry("stromal_haze", "Stromal haze", "a slit lamp photograph showing stromal haze in the cornea", "morphology", "Morphology"),
        PromptEntry("stromal_necrosis", "Corneal stromal necrosis", "a slit lamp photograph showing corneal stromal necrosis", "morphology", "Morphology"),
        PromptEntry("rough_corneal_surface", "Rough corneal surface", "a slit lamp photograph showing rough corneal surface around the ulcer", "morphology", "Morphology"),
        PromptEntry("dry_elevated_plaque", "Dry elevated corneal plaque", "a slit lamp photograph showing dry elevated corneal plaque", "morphology", "Morphology"),
        PromptEntry("elevated_surface_infiltrate", "Elevated surface infiltrate", "a slit lamp photograph showing stromal infiltrate with elevated surface", "morphology", "Morphology"),
        PromptEntry("peripheral_ulcer", "Peripheral corneal ulcer", "a slit lamp photograph showing peripheral corneal ulcer", "morphology", "Morphology"),
        PromptEntry("central_ulcer", "Central corneal ulcer", "a slit lamp photograph showing central corneal ulcer", "morphology", "Morphology"),
        PromptEntry("paracentral_ulcer", "Paracentral corneal ulcer", "a slit lamp photograph showing paracentral corneal ulcer", "morphology", "Morphology"),
    ],
    "complication": [
        PromptEntry("hypopyon", "Hypopyon", "a slit lamp photograph showing hypopyon in the anterior chamber", "complication", "Complication"),
        PromptEntry("corneal_thinning", "Corneal thinning", "a slit lamp photograph showing corneal thinning around the ulcer", "complication", "Complication"),
        PromptEntry("impending_perforation", "Impending corneal perforation", "a slit lamp photograph showing impending corneal perforation", "complication", "Complication"),
        PromptEntry("corneal_perforation", "Corneal perforation", "a slit lamp photograph showing corneal perforation", "complication", "Complication"),
        PromptEntry("descemetocele", "Descemetocele formation", "a slit lamp photograph showing descemetocele formation", "complication", "Complication"),
        PromptEntry("severe_corneal_edema", "Severe corneal edema", "a slit lamp photograph showing severe corneal edema", "complication", "Complication"),
        PromptEntry("endothelial_inflammatory_reaction", "Endothelial inflammatory reaction", "a slit lamp photograph showing endothelial inflammatory reaction", "complication", "Complication"),
        PromptEntry("anterior_chamber_inflammation", "Anterior chamber inflammation", "a slit lamp photograph showing anterior chamber inflammation", "complication", "Complication"),
        PromptEntry("large_epithelial_defect", "Large corneal epithelial defect", "a slit lamp photograph showing large corneal epithelial defect", "complication", "Complication"),
        PromptEntry("stromal_melt", "Severe corneal ulcer with stromal melt", "a slit lamp photograph showing severe corneal ulcer with stromal melt", "complication", "Complication"),
    ],
}

_FLUORESCEIN_PROMPTS: dict[str, list[PromptEntry]] = {
    "diagnosis": [
        PromptEntry("fungal_keratitis_fluorescein", "Fungal keratitis", "a slit lamp photograph with fluorescein staining showing fungal keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("bacterial_keratitis_fluorescein", "Bacterial keratitis", "a slit lamp photograph with fluorescein staining showing bacterial keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("acanthamoeba_keratitis_fluorescein", "Acanthamoeba keratitis", "a slit lamp photograph with fluorescein staining showing acanthamoeba keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("herpetic_epithelial_keratitis_fluorescein", "Herpetic epithelial keratitis", "a slit lamp photograph with fluorescein staining showing herpetic epithelial keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("neurotrophic_keratitis_fluorescein", "Neurotrophic keratitis", "a slit lamp photograph with fluorescein staining showing neurotrophic keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("infectious_corneal_ulcer_fluorescein", "Infectious corneal ulcer", "a slit lamp photograph with fluorescein staining showing infectious corneal ulcer", "diagnosis", "Diagnosis"),
        PromptEntry("microbial_keratitis_fluorescein", "Microbial keratitis", "a slit lamp photograph with fluorescein staining showing microbial keratitis", "diagnosis", "Diagnosis"),
        PromptEntry("severe_corneal_ulcer_fluorescein", "Severe corneal ulcer", "a slit lamp photograph with fluorescein staining showing severe corneal ulcer", "diagnosis", "Diagnosis"),
        PromptEntry("epithelial_defect_due_to_infection", "Epithelial defect due to infection", "a slit lamp photograph with fluorescein staining showing corneal epithelial defect due to infection", "diagnosis", "Diagnosis"),
        PromptEntry("active_corneal_ulcer_fluorescein", "Active corneal ulcer", "a slit lamp photograph with fluorescein staining showing active corneal ulcer", "diagnosis", "Diagnosis"),
    ],
    "morphology": [
        PromptEntry("central_epithelial_defect", "Central epithelial defect", "a slit lamp photograph with fluorescein staining showing a central epithelial defect", "morphology", "Morphology"),
        PromptEntry("large_epithelial_defect_fluorescein", "Large epithelial defect", "a slit lamp photograph with fluorescein staining showing a large epithelial defect", "morphology", "Morphology"),
        PromptEntry("paracentral_epithelial_defect", "Paracentral epithelial defect", "a slit lamp photograph with fluorescein staining showing a paracentral epithelial defect", "morphology", "Morphology"),
        PromptEntry("irregular_epithelial_defect", "Irregular epithelial defect", "a slit lamp photograph with fluorescein staining showing irregular epithelial defect", "morphology", "Morphology"),
        PromptEntry("dendritic_lesion_fluorescein", "Dendritic epithelial lesion", "a slit lamp photograph with fluorescein staining showing a dendritic epithelial lesion", "morphology", "Morphology"),
        PromptEntry("branching_dendritic_staining", "Branching dendritic staining", "a slit lamp photograph with fluorescein staining showing branching dendritic staining", "morphology", "Morphology"),
        PromptEntry("geographic_ulcer_fluorescein", "Geographic epithelial ulcer", "a slit lamp photograph with fluorescein staining showing geographic epithelial ulcer", "morphology", "Morphology"),
        PromptEntry("enlarged_dendritic_ulcer", "Enlarged dendritic ulcer", "a slit lamp photograph with fluorescein staining showing enlarged dendritic ulcer", "morphology", "Morphology"),
        PromptEntry("punctate_epithelial_erosions", "Punctate epithelial erosions", "a slit lamp photograph with fluorescein staining showing punctate epithelial erosions", "morphology", "Morphology"),
        PromptEntry("diffuse_punctate_staining", "Diffuse punctate staining", "a slit lamp photograph with fluorescein staining showing diffuse punctate staining", "morphology", "Morphology"),
        PromptEntry("scattered_superficial_staining", "Scattered superficial epithelial staining", "a slit lamp photograph with fluorescein staining showing scattered superficial epithelial staining", "morphology", "Morphology"),
        PromptEntry("fluorescein_stained_corneal_ulcer", "Fluorescein-stained corneal ulcer", "a slit lamp photograph with fluorescein staining showing a fluorescein-stained corneal ulcer", "morphology", "Morphology"),
        PromptEntry("irregular_staining_margins", "Irregular staining margins", "a slit lamp photograph with fluorescein staining showing irregular staining margins", "morphology", "Morphology"),
        PromptEntry("large_stained_ulcer_base", "Large stained ulcer base", "a slit lamp photograph with fluorescein staining showing a large stained ulcer base", "morphology", "Morphology"),
        PromptEntry("patchy_epithelial_staining", "Patchy epithelial staining", "a slit lamp photograph with fluorescein staining showing patchy epithelial staining", "morphology", "Morphology"),
        PromptEntry("pooling_in_ulcer_base", "Fluorescein pooling in ulcer base", "a slit lamp photograph with fluorescein staining showing fluorescein pooling in the ulcer base", "morphology", "Morphology"),
        PromptEntry("pooling_in_corneal_depression", "Pooling in corneal depression", "a slit lamp photograph with fluorescein staining showing pooling in corneal depression", "morphology", "Morphology"),
        PromptEntry("intense_staining_center", "Intense staining at ulcer center", "a slit lamp photograph with fluorescein staining showing intense staining at ulcer center", "morphology", "Morphology"),
        PromptEntry("rough_epithelial_surface", "Rough corneal epithelial surface", "a slit lamp photograph with fluorescein staining showing rough corneal epithelial surface", "morphology", "Morphology"),
        PromptEntry("irregular_surface_staining", "Irregular epithelial surface staining", "a slit lamp photograph with fluorescein staining showing irregular epithelial surface staining", "morphology", "Morphology"),
        PromptEntry("uneven_epithelial_staining", "Uneven epithelial staining", "a slit lamp photograph with fluorescein staining showing uneven epithelial staining", "morphology", "Morphology"),
        PromptEntry("peripheral_epithelial_defect", "Peripheral epithelial defect", "a slit lamp photograph with fluorescein staining showing peripheral epithelial defect", "morphology", "Morphology"),
        PromptEntry("central_corneal_staining", "Central corneal staining", "a slit lamp photograph with fluorescein staining showing central corneal staining", "morphology", "Morphology"),
        PromptEntry("paracentral_staining_pattern", "Paracentral staining pattern", "a slit lamp photograph with fluorescein staining showing paracentral staining pattern", "morphology", "Morphology"),
    ],
    "complication": [
        PromptEntry("aqueous_leakage", "Aqueous leakage from cornea", "a slit lamp photograph with fluorescein staining showing aqueous leakage from the cornea", "complication", "Complication"),
        PromptEntry("positive_seidel_test", "Positive Seidel test", "a slit lamp photograph with fluorescein staining showing a positive Seidel test", "complication", "Complication"),
        PromptEntry("corneal_perforation_fluorescein", "Corneal perforation", "a slit lamp photograph with fluorescein staining showing corneal perforation", "complication", "Complication"),
        PromptEntry("severe_corneal_thinning", "Severe corneal thinning", "a slit lamp photograph with fluorescein staining showing severe corneal thinning", "complication", "Complication"),
        PromptEntry("descemetocele_fluorescein", "Descemetocele formation", "a slit lamp photograph with fluorescein staining showing descemetocele formation", "complication", "Complication"),
        PromptEntry("epithelial_defect_with_stromal_exposure", "Large epithelial defect with stromal exposure", "a slit lamp photograph with fluorescein staining showing large epithelial defect with stromal exposure", "complication", "Complication"),
        PromptEntry("corneal_melt_fluorescein", "Corneal melt", "a slit lamp photograph with fluorescein staining showing corneal melt", "complication", "Complication"),
        PromptEntry("deep_corneal_ulcer", "Deep corneal ulcer", "a slit lamp photograph with fluorescein staining showing deep corneal ulcer", "complication", "Complication"),
        PromptEntry("extensive_epithelial_loss", "Extensive epithelial loss", "a slit lamp photograph with fluorescein staining showing extensive epithelial loss", "complication", "Complication"),
        PromptEntry("severe_surface_damage", "Severe corneal surface damage", "a slit lamp photograph with fluorescein staining showing severe corneal surface damage", "complication", "Complication"),
    ],
}


_PROMPT_DICTIONARIES = {
    "standard": _STANDARD_PROMPTS,
    "fluorescein": _FLUORESCEIN_PROMPTS,
}


def _dictionary_name_for_view(view: str) -> str:
    return "fluorescein" if view.strip().lower() == "fluorescein" else "standard"


class SemanticPromptScoringService:
    MODEL_ID = BIOMEDCLIP_MODEL_ID

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._client: dict[str, Any] | None = None

    def _load_client(self) -> dict[str, Any]:
        runtime = ensure_biomedclip_runtime(os.getenv("KERA_BIOMEDCLIP_DEVICE") or "auto")
        torch = runtime.torch
        model = runtime.model
        preprocess = runtime.preprocess
        tokenizer = runtime.tokenizer
        device = runtime.device
        prompt_features: dict[str, dict[str, Any]] = {}
        with torch.no_grad():
            for dictionary_name, layers in _PROMPT_DICTIONARIES.items():
                flattened_entries = [entry for layer_entries in layers.values() for entry in layer_entries]
                tokens = tokenizer([entry.prompt for entry in flattened_entries])
                if hasattr(tokens, "to"):
                    tokens = tokens.to(device)
                text_features = model.encode_text(tokens)
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                prompt_features[dictionary_name] = {
                    "entries": flattened_entries,
                    "features": text_features,
                    "layers": layers,
                }

        return {
            "torch": torch,
            "model": model,
            "preprocess": preprocess,
            "device": device,
            "prompt_features": prompt_features,
        }

    def _ensure_client(self) -> dict[str, Any]:
        runtime = ensure_biomedclip_runtime(os.getenv("KERA_BIOMEDCLIP_DEVICE") or "auto")
        if self._client is not None and self._client.get("device") == runtime.device:
            return self._client
        with self._lock:
            runtime = ensure_biomedclip_runtime(os.getenv("KERA_BIOMEDCLIP_DEVICE") or "auto")
            if self._client is None or self._client.get("device") != runtime.device:
                self._client = self._load_client()
        return self._client

    def warmup(self) -> None:
        self._ensure_client()

    def score_image(
        self,
        image_path: str | Path,
        *,
        view: str,
        top_k: int = 3,
        persistence_dir: Path | None = None,
    ) -> dict[str, Any]:
        client = self._ensure_client()
        top_k = min(max(int(top_k), 1), 5)
        image_file = Path(image_path)
        if not image_file.exists():
            raise FileNotFoundError(f"Image file not found: {image_file}")

        torch = client["torch"]
        model = client["model"]
        preprocess = client["preprocess"]
        device = client["device"]
        dictionary_name = _dictionary_name_for_view(view)
        dictionary_payload = client["prompt_features"][dictionary_name]
        entries: list[PromptEntry] = dictionary_payload["entries"]
        text_features = dictionary_payload["features"]

        with Image.open(image_file) as handle:
            normalized = ImageOps.exif_transpose(handle).convert("RGB")
            image_tensor = preprocess(normalized).unsqueeze(0).to(device)

        with torch.no_grad():
            image_features = model.encode_image(image_tensor)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            score_tensor = (image_features @ text_features.T).squeeze(0).detach().cpu()

        scored_entries: list[dict[str, Any]] = []
        for index, entry in enumerate(entries):
            scored_entries.append(
                {
                    "prompt_id": entry.prompt_id,
                    "label": entry.label,
                    "prompt": entry.prompt,
                    "layer_id": entry.layer_id,
                    "layer_label": entry.layer_label,
                    "score": round(float(score_tensor[index].item()), 4),
                }
            )

        overall_top_matches = sorted(scored_entries, key=lambda item: item["score"], reverse=True)[:top_k]

        return {
            "model_name": "BiomedCLIP",
            "model_id": self.MODEL_ID,
            "image_path": str(image_file),
            "view": view,
            "dictionary_name": dictionary_name,
            "top_k": top_k,
            "overall_top_matches": overall_top_matches,
            "layers": [],
        }
