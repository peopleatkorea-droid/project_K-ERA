# K-ERA Research Platform

감염성 각막염(infectious keratitis) 연구를 위한 다기관 연합학습 플랫폼입니다. 병원 내부에서 케이스 등록, AI 검증, 로컬 학습, 기여, 연합 집계를 하나의 웹 앱 안에서 수행할 수 있습니다.

> **중요:** 이 프로젝트는 연구 워크플로우용 소프트웨어이며, 임상 진단 또는 치료 의사결정용 의료기기가 아닙니다.

---

## 아키텍처

```
[Browser]
   |
   v
[Next.js Web UI]  http://localhost:3000
   |
   v
[FastAPI API]     http://localhost:8000
   |
   +-- Control Plane DB  (사용자, 프로젝트, 모델 레지스트리, 집계 이력)
   +-- Data Plane DB     (환자, 방문, 이미지 메타데이터)
   +-- <저장 루트>/sites/<SITE_ID>/data/raw/         원본 이미지
   +-- <저장 루트>/sites/<SITE_ID>/artifacts/        ROI crop, mask, Grad-CAM, embedding
   +-- <저장 루트>/sites/<SITE_ID>/validation/       검증 결과 및 리포트
   +-- <저장 루트>/sites/<SITE_ID>/model_updates/    기여 delta
   +-- <저장 루트>/models/                           글로벌 모델 파일
```

기본 저장 루트: `앱 폴더의 상위 디렉토리\KERA_DATA\`

메타데이터는 SQLite(기본) 또는 PostgreSQL에 저장되고, 원본 이미지와 파생 artifact는 파일 시스템에 저장됩니다.

---

## 요구사항

- Windows PowerShell
- Python 3.10, 3.11, 또는 3.12
- Node.js / npm

---

## 빠른 실행

### 1. 의존성 설치

```powershell
.\scripts\setup_local_node.ps1
```

이 스크립트는 `.venv` 생성, Python 패키지 설치, GPU 유무 감지 후 CPU/GPU용 torch 설치, 기본 health check(bcrypt, faiss 포함)를 수행합니다.

옵션:

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile cpu
.\scripts\setup_local_node.ps1 -TorchProfile gpu
```

### 2. 환경변수 설정

루트에 `.env.local` 파일을 생성합니다. `.env.example`을 참고하세요.

### 3. 앱 실행

```powershell
.\scripts\run_local_node.ps1
```

FastAPI 서버와 Next.js 개발 서버를 함께 실행하고, 사용 가능한 포트를 자동으로 찾아 브라우저를 엽니다.

개별 실행도 가능합니다.

```powershell
.\scripts\run_api_server.ps1
.\scripts\run_web_frontend.ps1
```

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `KERA_ADMIN_USERNAME` | 초기 admin 계정 사용자 이름 |
| `KERA_ADMIN_PASSWORD` | 초기 admin 계정 비밀번호 |
| `KERA_RESEARCHER_USERNAME` | 초기 researcher 계정 사용자 이름 |
| `KERA_RESEARCHER_PASSWORD` | 초기 researcher 계정 비밀번호 |
| `KERA_API_SECRET` | JWT 서명 키 |
| `KERA_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID (백엔드) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID (프론트엔드) |
| `KERA_CONTROL_PLANE_DATABASE_URL` | 중앙 control plane DB (사용자, 권한, 프로젝트, 모델 레지스트리) |
| `KERA_CONTROL_PLANE_ARTIFACT_DIR` | 중앙 delta 및 control plane 파일 아티팩트 저장 경로 |
| `KERA_DATA_PLANE_DATABASE_URL` | 병원 로컬 data plane DB (환자, 방문, 이미지) |
| `KERA_STORAGE_DIR` | 기본 저장 루트 경로 (예: `D:\KERA_DATA`) |
| `KERA_DATABASE_URL` / `DATABASE_URL` | 단일 DB 방식 사용 시 (control/data plane 미분리) |
| `KERA_CASE_REFERENCE_SALT` | case_reference_id 해시 salt (다기관 환경에서 모든 노드가 동일 값 사용 권장) |
| `MEDSAM_SCRIPT` | MedSAM 실행 스크립트 경로 |
| `MEDSAM_CHECKPOINT` | MedSAM 체크포인트 경로 |
| `KERA_AI_CLINIC_OPENAI_API_KEY` | AI Clinic LLM 추천 기능용 OpenAI API 키 |
| `KERA_AI_CLINIC_LLM_MODEL` | 사용할 LLM 모델명 (기본: gpt-4o-mini) |
| `KERA_AI_CLINIC_LLM_BASE_URL` | LLM API base URL (OpenAI 호환 엔드포인트) |
| `KERA_AI_CLINIC_LLM_TIMEOUT_SECONDS` | LLM 요청 타임아웃 (초) |

**참고:**
- 로컬 계정(`KERA_ADMIN_USERNAME` 등)은 해당 환경변수가 있을 때만 앱 시작 시 시드됩니다.
- `KERA_GOOGLE_CLIENT_ID`와 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`는 실행 스크립트가 서버/프론트엔드에서 서로 보완되도록 처리합니다.
- `KERA_CONTROL_PLANE_DATABASE_URL`과 `KERA_DATA_PLANE_DATABASE_URL`을 모두 지정하면 control/data plane DB가 분리됩니다. 미지정 시 단일 DB(`KERA_DATABASE_URL` 또는 기본 SQLite)를 공용으로 사용합니다.
- 아무 DB도 지정하지 않으면 기본값은 `앱 폴더의 상위 디렉토리\KERA_DATA\kera.db`입니다.

LLM 설정은 [docs/ai_clinic_llm_setup.md](docs/ai_clinic_llm_setup.md)를 참고하세요.

---

## 현재 기능 범위

### 인증과 접근 제어

- Google Sign-In (기본 연구자 로그인 경로, `/`)
- 로컬 username/password 로그인 (관리자 복구용, `/admin-login`)
- JWT 기반 세션, 2시간 만료
- 기관(site) 및 역할(role) 접근 요청 제출 및 승인/반려

지원 역할: `admin`, `site_admin`, `researcher`, `viewer`

### Case Canvas

웹의 기본 작업 화면입니다.

- 환자 등록 / 방문 등록 / 다중 이미지 업로드 / 대표 이미지 지정
- 저장된 케이스 목록 조회
- 브라우저 로컬 draft autosave / draft 복구
- 한/영 UI 전환
- 사이트별 요약 지표 조회
- 최근 validation / contribution 활동 조회

케이스 저장 흐름:

1. 환자 정보 입력
2. 방문 정보 입력 (culture 확인 필수)
3. 슬릿램프 이미지 업로드
4. 케이스 저장
5. ROI preview → validation → contribution 실행

### 케이스 단위 AI 워크플로우

저장된 케이스에서 아래 기능이 연결됩니다.

- **ROI preview**: MedSAM 기반 각막 ROI crop/mask 자동 생성 (실패 시 fallback ROI 사용)
- **Validation**: 글로벌 모델로 bacterial/fungal 예측 + 신뢰도 + Grad-CAM 시각화
- **Lesion annotation**: 사용자가 병변 bounding box를 그리면 비동기로 lesion mask + lesion crop 자동 생성
- **AI Clinic**: 유사 증례 검색, 텍스트 근거 조회, differential ranking, LLM 기반 워크플로우 추천
- **Contribution**: validation 완료된 active 병변 케이스를 글로벌 모델에 기여 (weight delta 생성)
- Validation / contribution history 조회

### AI Clinic

단순 분류기를 넘어 근거 결합형 의사결정 보조를 제공합니다.

- **유사 증례 검색**: DINOv2 임베딩 + FAISS local index 기반 top-K 유사 환자 검색 (환자 단위 중복 제거)
- **텍스트 근거 검색**: BiomedCLIP 기반 이미지-텍스트 매칭
- **Metadata-aware reranking**: view, visit_status, contact_lens_use, smear_result 등 임상 메타데이터로 순위 보정
- **Differential ranking**: bacterial vs fungal 규칙 기반 초기 ranking + supporting/conflicting evidence 표시
- **Workflow recommendation**: OpenAI API 연결 시 구조화된 추천, 없으면 로컬 fallback 규칙 사용
- **Semantic prompt review (PoC)**: BiomedCLIP으로 이미지와 진단 문구의 일치도 점수 확인

Retrieval backend: `classifier` / `dinov2` / `hybrid` 모드 지원

### 운영 기능 (Operations Workspace)

| 기능 | admin | site_admin |
|------|:-----:|:----------:|
| Bulk import (CSV + 이미지 ZIP) | O | O |
| 저장 경로 설정 / 마이그레이션 | O | O |
| External validation 실행 | O | O |
| Validation run 목록 / misclassified case 조회 | O | O |
| Site comparison (다기관 성능 비교) | O | O |
| ROC curve 비교 | O | O |
| Initial training 실행 | O | O |
| Cross-validation 실행 및 리포트 조회 | O | O |
| Multi-model benchmark training | O | O |
| Case-level multi-model compare | O | O |
| Model registry 조회 | O | O |
| Model update review | O | - |
| Federated aggregation 실행 | O | - |
| Experiment registry 조회 | O | - |
| Project / site / user 관리 | O | - |

### 연합학습 (Federated Learning)

- 각 병원 노드에서 로컬 fine-tuning → weight delta 생성 → 중앙 업로드
- 중앙 관리자: delta 검토(썸네일, SHA256) → 승인 → FedAvg 집계 → 새 글로벌 모델 배포
- 원본 이미지는 병원 밖으로 반출되지 않음
- 중앙에 올라가는 것: 검토용 저해상도 썸네일(source 128px, ROI/mask 320px), weight delta, 비식별 메타데이터

**비식별화:**
```
case_reference_id = SHA256(KERA_CASE_REFERENCE_SALT + site_id + patient_id + visit_date)
```
중앙 control plane에는 환자 ID 대신 이 해시 키만 저장됩니다.

### 연구용 CLI

HTTP API와 별개로 직접 실행 가능합니다.

```powershell
python -m kera_research.cli train --site-id <SITE_ID>
python -m kera_research.cli cross-validate --site-id <SITE_ID>
python -m kera_research.cli external-validate --site-id <SITE_ID> --project-id <PROJECT_ID>
python -m kera_research.cli export-report --validation-id <VALIDATION_ID> --output .\report.json
```

---

## 저장 구조

기본 저장 루트는 `앱 폴더의 상위 디렉토리\KERA_DATA\`입니다. `KERA_STORAGE_DIR`로 변경 가능합니다 (예: `KERA_STORAGE_DIR=D:\KERA_DATA`).

```
<저장 루트>/
  kera.db                                        기본 SQLite DB (control/data plane 미분리 시)
  control_plane/                                 validation case JSON, aggregation 메타데이터
  models/                                        글로벌 모델 파일
  sites/<SITE_ID>/
    data/raw/                                    원본 이미지 (EXIF 제거, image_id 기반 파일명)
    artifacts/
      roi_crops/                                 각막 ROI crop
      medsam_masks/                              MedSAM segmentation mask
      lesion_masks/                              병변 mask
      lesion_crops/                              soft-masked 병변 crop
      gradcam/                                   Grad-CAM 시각화
      embeddings/                                AI Clinic 검색용 embedding
    validation/                                  검증 결과 JSON, cross-validation 리포트
    model_updates/                               로컬 contribution delta
```

**이미지 저장 정책:**
- 업로드 시 EXIF 메타데이터를 제거합니다.
- 파일명은 원본 파일명이 아닌 생성된 `image_id` 기반 이름을 사용합니다.

### 저장 경로 설정 (운영 화면)

- **인스턴스 기본 저장 루트 변경**: 이후 새로 생성되는 사이트의 기본 저장 경로가 바뀝니다.
- **사이트 저장 루트 변경**: 데이터가 없는 사이트는 경로만 갱신합니다.
- **기존 사이트 데이터 마이그레이션**: 데이터가 있는 사이트는 폴더 이동 + 내부 경로 참조 재작성을 함께 수행합니다.

> 데이터가 있는 사이트는 단순 경로 변경이 아니라 반드시 마이그레이션을 사용해야 합니다. 수동으로 폴더만 옮기면 DB/JSON의 경로 참조가 깨질 수 있습니다.

마이그레이션 시 재작성되는 항목: 이미지 DB의 `image_path`, validation case JSON 내 artifact 경로, cross-validation JSON 경로, model update payload 내 로컬 경로, 사이트 메타데이터의 `local_storage_root`

### 다기관 운영 권장 구성

```
KERA_CONTROL_PLANE_DATABASE_URL=postgresql://central.example.com/kera_control
KERA_CONTROL_PLANE_ARTIFACT_DIR=/mnt/central-server/artifacts
KERA_DATA_PLANE_DATABASE_URL=sqlite:///D:/KERA_DATA/kera_data.db
KERA_STORAGE_DIR=D:\KERA_DATA
```

- 중앙 control plane: Neon Postgres 등 클라우드 DB 권장
- 병원 Local Node data plane: 각 PC 로컬 SQLite 또는 병원 내부 DB

---

## 주요 API 범위

공통 / 인증:

- `GET /api/health`
- `GET /api/public/sites`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `GET /api/auth/me`
- `POST /api/auth/request-access`

사이트 작업:

- `GET /api/sites`
- `GET /api/sites/{site_id}/summary`
- `GET /api/sites/{site_id}/cases`
- `POST /api/sites/{site_id}/patients`
- `POST /api/sites/{site_id}/visits`
- `POST /api/sites/{site_id}/images`
- `GET /api/sites/{site_id}/cases/roi-preview`
- `POST /api/sites/{site_id}/cases/validate`
- `POST /api/sites/{site_id}/cases/contribute`
- `POST /api/sites/{site_id}/cases/ai-clinic`
- `GET /api/sites/{site_id}/images/{image_id}/semantic-prompts`
- `POST /api/sites/{site_id}/images/{image_id}/lesion-live-preview`
- `POST /api/sites/{site_id}/ai-clinic/embeddings/backfill`
- `POST /api/sites/{site_id}/validations/run`
- `POST /api/sites/{site_id}/training/initial`
- `POST /api/sites/{site_id}/training/cross-validation`
- `POST /api/sites/{site_id}/import/bulk`

운영 / 관리자:

- `GET /api/admin/overview`
- `GET /api/admin/storage-settings`
- `PATCH /api/admin/storage-settings`
- `GET /api/admin/model-versions`
- `GET /api/admin/model-updates`
- `POST /api/admin/model-updates/{update_id}/review`
- `GET /api/admin/aggregations`
- `POST /api/admin/aggregations/run`
- `GET /api/admin/experiments`
- `GET /api/admin/experiments/{experiment_id}`
- `GET /api/admin/projects`
- `POST /api/admin/projects`
- `GET /api/admin/sites`
- `POST /api/admin/sites`
- `PATCH /api/admin/sites/{site_id}`
- `PATCH /api/admin/sites/{site_id}/storage-root`
- `POST /api/admin/sites/{site_id}/storage-root/migrate`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/site-comparison`

전체 엔드포인트 목록은 [src/kera_research/api/app.py](src/kera_research/api/app.py)에서 확인할 수 있습니다.

---

## 테스트

```powershell
python -m unittest tests.test_api_http
python -m unittest tests.test_modeling
```

포함 범위: 로그인, 접근 요청 승인, 케이스 validation/contribution, 저장 경로 설정/마이그레이션, initial training, cross-validation, bulk import, aggregation, experiment registry, 운영 API 일부, artifact validation, calibration metric 출력

---

## 현재 한계와 주의사항

- 케이스 단위 validation, AI Clinic retrieval/report 생성 등 일부 작업은 여전히 API 요청-응답 안에서 동기 실행됩니다.
- 사이트 단위 validation, initial training, multi-model benchmark, cross-validation은 `site_jobs`에 큐잉되며, 별도 worker(`python -m kera_research.worker`)가 처리합니다. `.\scripts\run_local_node.ps1`는 이 worker를 함께 실행하지만, API만 단독 실행하면 해당 작업은 `queued` 상태에 머무를 수 있습니다.
- AI Clinic embedding indexing / backfill, lesion live preview, 관리자 aggregation은 현재 별도 외부 큐가 아니라 API 프로세스 내부 daemon thread로 실행됩니다. 따라서 API 프로세스 재시작이나 종료 시 해당 작업은 중단될 수 있습니다.
- MedSAM은 로컬 스크립트와 체크포인트가 준비된 경우에만 사용하며, 그렇지 않으면 fallback ROI 경로를 사용합니다.
- 프론트엔드 실행 스크립트는 개발 서버(`next dev`) 기준입니다.
- 배포용 인증, 비밀 관리, 감사 로깅, 장애 복구는 연구용 로컬 노드 수준으로만 구성되어 있습니다.

---

## 관련 문서

- [docs/local_node_deployment.md](docs/local_node_deployment.md)
- [docs/dataset_schema.md](docs/dataset_schema.md)
- [docs/ai_clinic_llm_setup.md](docs/ai_clinic_llm_setup.md)
- [CHANGELOG.md](CHANGELOG.md)
