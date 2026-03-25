# Dataset and Validation Schema

## Research scope

This schema is designed for a research workflow tool for infectious keratitis image curation and model evaluation. It is intentionally restricted to culture-proven cases.

## Required patient fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `patient_id` | string | Yes | Hospital-local identifier |
| `sex` | enum | Yes | `female`, `male`, `other`, `unknown` |
| `age` | integer | Yes | Age at registration |

## Required visit fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `visit_date` | date string | Yes | Stored as `YYYY-MM-DD` |
| `culture_confirmed` | boolean | Yes | Must be `true` |
| `culture_category` | enum | Yes | `bacterial`, `fungal` |
| `culture_species` | enum | Yes | Controlled vocabulary with request/approval flow |
| `contact_lens_use` | enum | Yes | Structured risk factor |
| `predisposing_factor` | string array | Yes | Multi-select list |
| `other_history` | string | No | Free-text context |

## Supported species catalog

### Bacterial

- `Staphylococcus aureus`
- `Staphylococcus epidermidis`
- `Streptococcus pneumoniae`
- `Pseudomonas aeruginosa`
- `Gemella species`
- `Moraxella`
- `Nocardia`
- `Other`

### Fungal

- `Fusarium`
- `Aspergillus`
- `Candida`
- `Curvularia`
- `Alternaria`
- `Other`

If a species is missing, users can request it. Administrators approve requests and extend the shared dropdown list centrally.

## Structured clinical risk fields

### `contact_lens_use`

- `none`
- `soft contact lens`
- `rigid gas permeable`
- `orthokeratology`
- `unknown`

### `predisposing_factor`

- `trauma`
- `contact lens`
- `ocular surface disease`
- `topical steroid use`
- `post surgery`
- `neurotrophic`
- `unknown`

## Image-level fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `view` | enum | Yes | Manual only: `white`, `slit`, `fluorescein` |
| `image_path` | string | Yes | Local path only |
| `is_representative` | boolean | Yes | Manual selection flag |

## Local storage path

```text
<storage_root>/sites/<site_id>/data/raw/<patient_id>/<visit_date>/image_file.jpg
```

## Minimum manifest schema

Each manifest row is image-level and combines patient, visit, and image metadata:

| Field | Type |
| --- | --- |
| `patient_id` | string |
| `sex` | string |
| `age` | integer |
| `visit_date` | string |
| `culture_confirmed` | boolean |
| `culture_category` | string |
| `culture_species` | string |
| `contact_lens_use` | string |
| `predisposing_factor` | pipe-delimited string |
| `view` | string |
| `image_path` | string |
| `is_representative` | boolean |

## Validation summary schema

Stored in the control plane:

| Field | Type |
| --- | --- |
| `validation_id` | string |
| `project_id` | string |
| `site_id` | string |
| `model_version` | string |
| `model_version_id` | string |
| `model_architecture` | string | `cnn`, `vit`, `swin` |
| `run_date` | timestamp string |
| `n_patients` | integer |
| `n_images` | integer |
| `AUROC` | float or null |
| `accuracy` | float |
| `sensitivity` | float |
| `specificity` | float |
| `F1` | float |
| `case_predictions_path` | string |

## Case-level prediction schema

Stored per validation run in the control plane:

| Field | Type |
| --- | --- |
| `validation_id` | string |
| `patient_id` | string |
| `true_label` | string |
| `predicted_label` | string |
| `prediction_probability` | float |
| `is_correct` | boolean |
| `gradcam_path` | string or null |
| `medsam_mask_path` | string or null |
| `roi_crop_path` | string or null |

## Model update schema

| Field | Type |
| --- | --- |
| `update_id` | string |
| `site_id` | string |
| `base_model_version_id` | string |
| `architecture` | string | `cnn`, `vit`, `swin` |
| `upload_type` | string |
| `execution_device` | string |
| `artifact_path` | string |
| `created_at` | timestamp string |
| `training_summary` | object |

Supported upload types:

- `full model weights`
- `weight delta`
- `aggregated update`
