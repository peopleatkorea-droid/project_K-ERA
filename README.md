# K-ERA Research Platform

감염성 각막염(infectious keratitis) 연구를 위한 다기관 연합학습 플랫폼입니다. 병원 내부에서 케이스 등록, AI 검증, 로컬 학습, 기여, 연합 집계를 하나의 웹 앱 안에서 수행할 수 있습니다.

> **중요:** 이 프로젝트는 연구 워크플로우용 소프트웨어이며, 임상 진단 또는 치료 의사결정용 의료기기가 아닙니다.
>
> **변경 정책:** UX/UI 변경(랜딩 화면, 레이아웃, 카피, 로그인 흐름, 정보 우선순위 포함)은 프로젝트 소유자의 명시적 승인 없이 구현하지 않습니다. 리팩토링은 기본적으로 기존 UX를 보존해야 합니다.

---

## 아키텍처

### 웹 앱 (Next.js + FastAPI)

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

### 데스크탑 앱 (Tauri)

```
[Tauri 데스크탑 앱]
   |
   +-- [Desktop Shell UI]  (React, desktop-shell/)
   |      |
   |      v
   +-- [내장 FastAPI 서버]  (Python 런타임 자동 시작)
          |
          +-- Data Plane DB     (로컬 SQLite)
          +-- <저장 루트>/sites/<SITE_ID>/...
          |
          +-- [Remote Control Plane]  (선택, 연합학습 / 모델 동기화용)
```

데스크탑 앱은 Tauri 셸이 Python 런타임과 FastAPI 서버를 내장해 병원 PC 단독으로 동작합니다. 웹 앱과 동일한 FastAPI 백엔드를 사용하며, Remote Control Plane 연동 시 연합학습과 모델 배포가 가능합니다.

기본 저장 루트: `앱 폴더의 상위 디렉토리\KERA_DATA\`

> **CPU 데스크톱 용량 안내:** 현재 CPU 배포본은 설치 후 첫 실행까지 합쳐 대략 `2.3 GB`의 디스크 공간이 필요합니다.
> 설치 직후 앱 자체가 약 `1.0 GB`를 차지하고, 첫 실행 때 `%LOCALAPPDATA%\KERA\runtime` 아래로 Python 런타임이 약 `1.3 GB` 추가로 풀립니다.

메타데이터는 SQLite(기본) 또는 PostgreSQL에 저장되고, 원본 이미지와 파생 artifact는 파일 시스템에 저장됩니다.

---

## 현재 AI / 연합학습 구성

- **주 분석 모델**: `EfficientNetV2-S MIL (full)`
  - visit-level bag inference / validation / visit-level federated round의 기본 모델입니다.
- **보조 image-level 모델**: `ConvNeXt-Tiny (full)`
  - image-level support와 image-level federated round의 기본 모델입니다.
- **similar case retrieval**: `DINOv2 lesion-crop retrieval`
  - AI Clinic similar case 검색용 retrieval profile이며, analysis model과 분리되어 동작합니다.

### 학습 / 기여 정책

- 모든 사용자는 케이스를 저장하고 분석할 수 있습니다.
- `culture_status`는 `positive / negative / not_done / unknown`을 사용합니다.
- 연합학습 기여와 연구 registry 포함은 아래 조건을 모두 만족할 때만 허용합니다.
  - `positive`
  - `active`
  - `images > 0`
  - `research registry consent`
  - `registry included`

### 다기관 similar case 확장

- DINO retrieval은 현재 **full federated learning**이 아니라 **federated retrieval corpus expansion** 방식으로 운영합니다.
- 각 병원은 같은 retrieval profile / preprocessing / normalization 기준으로 positive case embedding을 생성합니다.
- 중앙 control plane에는 embedding과 최소 메타데이터, 선택적으로 thumbnail만 업로드합니다.
- AI Clinic은 로컬 케이스를 query로 사용하되, cross-site positive corpus에서 top-k similar case를 검색할 수 있습니다.

### 연합학습 round 구조

- **Image-level FL**: `ConvNeXt-Tiny (full)`
  - `site-round background job -> pending_review model update -> FedAvg`
  - 집계 가중치는 `n_images`
- **Visit-level FL**: `EfficientNetV2-S MIL (full)`
  - `site-round background job -> pending_review model update -> FedAvg`
  - 집계 가중치는 `n_cases`
- 집계 시에는 `same architecture + same base model + same federated_round_type`만 함께 aggregate됩니다.

### 운영 / 복구 문서

- 연합학습 운영 및 rollback / 재집계 / 재학습 절차 초안: [docs/fl_operation_sop_ko.md](docs/fl_operation_sop_ko.md)

---

## 요구사항

- Windows PowerShell
- Python 3.11
- uv
- Node.js / npm

---

## 빠른 실행

### 1. 의존성 설치

```powershell
.\scripts\setup_local_node.ps1
```

이 스크립트는 repo-root `.venv`를 `uv`로 생성/재사용하고, `uv.lock` 기준으로 CPU/GPU 프로필을 sync한 뒤 기본 health check(bcrypt, faiss 포함)를 수행합니다.

수동으로 맞추려면 아래 기준을 사용합니다.

```powershell
uv venv .venv --python 3.11
uv sync --frozen --extra cpu --extra dev
```

옵션:

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile cpu
.\scripts\setup_local_node.ps1 -TorchProfile gpu
```

### 2. 환경변수 설정

루트에 `.env.local` 파일을 생성합니다. `.env.example`을 참고하세요.

local-first control plane까지 같이 쓰는 현재 기준 최소 예시는 아래와 같습니다.

```dotenv
NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL=http://127.0.0.1:8000
KERA_CONTROL_PLANE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kera_control_plane?sslmode=require
KERA_CONTROL_PLANE_DEV_AUTH=false
KERA_SITE_STORAGE_SOURCE=local
```

`KERA_CONTROL_PLANE_NODE_ID`, `KERA_CONTROL_PLANE_NODE_TOKEN`은 최초 등록 후 로컬에 자동 저장되므로 보통 직접 넣지 않습니다.

### 3. 앱 실행

```powershell
.\scripts\run_local_node.ps1
```

FastAPI 서버와 Next.js 개발 서버를 함께 실행하고, 사용 가능한 포트를 자동으로 찾아 브라우저를 엽니다.
이 상태에서 병원 로컬 앱은 기본 화면(`/`)으로, local-first 중앙 control plane은 `/control-plane`으로 접속할 수 있습니다.

개별 실행도 가능합니다.

```powershell
.\scripts\run_api_server.ps1
.\scripts\run_web_frontend.ps1
```

### 4. local-first control plane 등록 흐름

오늘 기준으로 병원 PC 최초 등록은 아래 순서가 기본입니다.

1. `.env.local`에 중앙 DB와 control-plane 관련 값을 넣습니다.
2. `.\scripts\run_local_node.ps1` 또는 `.\scripts\run_api_server.ps1`, `.\scripts\run_web_frontend.ps1`로 앱을 띄웁니다.
3. `http://127.0.0.1:3000/control-plane`에서 로그인합니다.
4. control plane에서 node를 등록합니다.
5. 로컬 FastAPI가 `node_id` / `node_token`을 자동 저장합니다.

Windows에서는 이 자격증명이 DPAPI로 로컬 저장되며, 이후에는 `.env.local`에 `KERA_CONTROL_PLANE_NODE_ID`, `KERA_CONTROL_PLANE_NODE_TOKEN`을 직접 넣지 않아도 됩니다.

수동 등록이 필요하면 아래 스크립트를 사용할 수 있습니다.

```powershell
.\scripts\register_local_node.ps1 `
  -ApiBaseUrl http://127.0.0.1:8000 `
  -ControlPlaneBaseUrl http://127.0.0.1:3000/control-plane/api `
  -ControlPlaneUserToken <control-plane-access-token> `
  -SiteId my-site `
  -DisplayName "My Site" `
  -HospitalName "My Hospital" `
  -Overwrite
```

### 5. 런타임 E2E smoke test

중앙 control plane과 로컬 node를 함께 띄워 실제 흐름을 검증하려면:

```powershell
.\scripts\run_control_plane_e2e_smoke.ps1
```

이 스크립트는 다음을 자동으로 확인합니다.

- control plane dev login
- current model publish
- node register
- node bootstrap
- current release 조회
- model update metadata 업로드
- validation summary 업로드

### 6. 2026-03-18 업데이트

- 중앙 control plane을 Next.js 안에서 local-first 구조로 운영할 수 있게 정리했습니다.
- 병원 PC 최초 등록 시 `node_id` / `node_token`을 Windows DPAPI로 자동 저장합니다.
- 병원 PC 핵심 경로는 remote control plane 우선으로 동작합니다.
  - `bootstrap`
  - `heartbeat`
  - `current release`
  - `model update metadata upload`
  - `validation summary upload`
  - `LLM relay`

### 7. 2026-04-13 ~ 2026-04-14 운영 / 배포 업데이트

- Tauri desktop runtime의 CSP를 더 이상 `null`로 두지 않고 명시적으로 설정했습니다.
- `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `frontend/package.json`, `pyproject.toml`의 버전은 현재 `1.0.0`으로 맞춰져 있습니다.
- FastAPI 런타임도 같은 버전(`1.0.0`)을 health / readiness / liveness 응답에 보고합니다.
- `frontend/scripts/sync-desktop-version.mjs`를 추가해 `npm run tauri:dev*`, `npm run tauri:build` 실행 전 버전 드리프트를 자동으로 정리하도록 했습니다.
- `npm run desktop:verify`는 이제 desktop bundle resource 확인뿐 아니라 `CSP 설정 여부`와 `desktop/web/python 버전 일치`까지 같이 검사합니다.
- 로그인 rate limit은 control-plane DB 기반으로 기록되어 프로세스 재시작 뒤에도 동일한 제한 창(`5분 / 10회`)을 유지합니다. DB 경로가 일시적으로 실패하면 기존 in-memory fallback으로 내려갑니다.
- control plane과 data plane 모두 Alembic baseline을 도입했고, startup 시 현재 DB를 `head`로 맞춥니다.
  - control plane baseline revision: `20260413_01`
  - data plane baseline revision: `20260413_02`
- data plane은 기존 `create_all + custom migration` 경로를 먼저 유지한 뒤 Alembic `head`를 적용합니다. 즉 기존 로컬 SQLite 보정 로직은 그대로 두면서, 이후 schema change는 Alembic revision으로 누적할 수 있습니다.
- `control_plane_schema_state`, `data_plane_schema_state`는 이제 각각 현재 Alembic revision을 기록합니다.
- migration 상태 확인/적용은 아래처럼 실행할 수 있습니다.
  - control plane: `uv run python -m kera_research.control_plane_alembic current`
  - control plane: `uv run python -m kera_research.control_plane_alembic upgrade head`
  - data plane: `uv run python -m kera_research.data_plane_alembic current`
  - data plane: `uv run python -m kera_research.data_plane_alembic upgrade head`
- API에는 운영용 probe와 기본 metrics endpoint가 추가되었습니다.
  - `GET /api/live`: 프로세스 liveness와 버전, uptime 확인
  - `GET /api/ready`: storage / DB / model artifact / background queue 상태를 반영한 readiness 확인
  - `GET /api/health`: readiness payload + 상세 runtime check / request metrics
  - `GET /api/metrics`: Prometheus text exposition 형식의 in-memory request metrics
- 모든 API 응답에는 `X-Request-ID`가 포함되고, 서버는 route template 기준의 structured request log와 request duration metrics를 남깁니다.
- 선택형 Sentry error aggregation / performance trace hook도 추가했습니다. `KERA_SENTRY_DSN`이 없으면 비활성 상태를 유지하고, DSN이 있으면 FastAPI exception/error event와 traces를 수집할 수 있습니다.
- 연합학습 보강도 추가했습니다.
  - `KERA_FEDERATED_UPDATE_SIGNING_SECRET`가 있으면 각 site의 weight delta update에 HMAC 서명이 붙고, 중앙 registry는 서명을 검증합니다.
  - `KERA_REQUIRE_SIGNED_FEDERATED_UPDATES=true`이면 unsigned delta는 등록/집계 전에 거절됩니다.
  - aggregation 전략은 `KERA_FEDERATED_AGGREGATION_STRATEGY=fedavg|coordinate_median|trimmed_mean`으로 고를 수 있고, `trimmed_mean`은 `KERA_FEDERATED_AGGREGATION_TRIM_RATIO`를 사용합니다.
  - 선택형 client-side delta hardening으로 `KERA_FEDERATED_DELTA_CLIP_NORM`, `KERA_FEDERATED_DELTA_NOISE_MULTIPLIER`, `KERA_FEDERATED_DELTA_QUANTIZATION_BITS=8|16`을 지원합니다.
  - 이 보강은 trusted consortium 환경을 목표로 한 1차 가드입니다. secure aggregation이나 formal DP accountant를 대체하지는 않습니다.
- baseline 컨테이너 자산도 추가했습니다.
  - `Dockerfile.api`: FastAPI / worker 공용 이미지
  - `frontend/Dockerfile.web`: Next.js production 이미지
  - `docker-compose.yml`: `api + worker + web` 3개 서비스를 한 번에 띄우는 baseline stack
- compose 기본값은 SQLite volume을 사용하지만, `KERA_CONTROL_PLANE_DATABASE_URL`, `KERA_DATA_PLANE_DATABASE_URL` 환경변수를 주면 외부 PostgreSQL / 별도 DB로도 바꿀 수 있습니다.
- compose stack은 이제 `api / worker / web` healthcheck와 `service_healthy` 의존관계를 포함합니다.
- split mode에서 비어 보이던 site/workspace 응답은 remote bootstrap + local cache 기준으로 계속 보이게 복구했습니다.
- `.\scripts\run_control_plane_e2e_smoke.ps1`로 실제 런타임 흐름을 한 번에 검증할 수 있습니다.
- 2026-04-14 기준으로 Windows 첫 배포 경로는 `CPU + NSIS current-user installer`를 권장합니다. 이 경로는 현재 로컬 smoke에서 `package -> install -> first launch`까지 통과한 상태입니다.

### 7-1. 컨테이너 baseline 실행

웹/SaaS 형태의 baseline 런타임을 로컬에서 띄우려면:

```powershell
docker compose up --build
```

기본 포트:

- web: `http://localhost:3000`
- api: `http://localhost:8000`

기본 compose는 named volume에 SQLite control/data plane을 저장합니다. 외부 DB를 쓰려면 `.env` 또는 셸 환경변수로 아래 값을 덮어씁니다.

```dotenv
KERA_CONTROL_PLANE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kera_control_plane
KERA_DATA_PLANE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kera_data_plane
```

선택형 Sentry observability를 켜려면 아래 값을 추가합니다.

```dotenv
KERA_SENTRY_DSN=https://<public>@<org>.ingest.sentry.io/<project>
KERA_SENTRY_ENVIRONMENT=production
KERA_SENTRY_TRACES_SAMPLE_RATE=0.1
KERA_SENTRY_PROFILES_SAMPLE_RATE=0.0
```

### 7-2. Windows 설치형 배포 권장 경로

현재 Windows 설치형 배포는 `CPU + NSIS current-user installer`를 기본 경로로 권장합니다.

- 권장 package build: `cd frontend && npm run desktop:package:cpu:nsis`
- 권장 설치 smoke: `cd frontend && npm run desktop:smoke-installed:cpu`
- 산출물 확인: `cd frontend && npm run desktop:verify-package:nsis`
- MSI 관리자 검증이 필요하면 `cd frontend && npm run desktop:package:cpu:msi`, `powershell -ExecutionPolicy Bypass -File ./scripts/run-desktop-installer-smoke.ps1 -Profile cpu -InstallerType msi -LaunchSeconds 15`처럼 별도 경로로 확인합니다.

참고:

- NSIS installer는 `currentUser` 모드로 동작해서 관리자 권한 없이 설치할 수 있습니다.
- MSI는 여전히 관리자 권한 전제를 두는 경로라, 병원 PC 일반 사용자 배포 기준 기본 경로로는 권장하지 않습니다.
- `desktop:smoke-installed:cpu`는 비관리자 세션이면 자동으로 NSIS current-user installer를 우선 사용합니다.
- `desktop:smoke-installed:cpu:nsis`, `desktop:verify-package:nsis`, `tauri:build:nsis`는 권장 배포 경로만 따로 확인할 때 사용합니다.

공용 FastAPI 서버 1대를 두고 다른 PC에서 같은 관리자/프로젝트/site를 보려면, 클라이언트 PC에서는 로컬 API를 띄우지 말고 아래처럼 frontend만 공용 API에 연결하세요.

```powershell
.\scripts\run_local_node.ps1 -SharedApiBaseUrl http://YOUR-SHARED-API:8000
```

또는 `.env.local`에 `KERA_INTERNAL_API_BASE_URL`을 넣어도 동일하게 동작합니다.

새 PC에서 관리자/프로젝트/site만 같은 중앙 DB를 보게 하려면 `.env.local`을 직접 편집하지 않고 아래 한 줄로 생성할 수 있습니다.

```powershell
.\scripts\configure_shared_control_plane_client.ps1 -ControlPlaneDatabaseUrl "postgresql://.../kera_control_plane?sslmode=require&channel_binding=require"
```

### 7. Tauri 데스크탑 앱 실행 (개발)

Tauri 데스크탑 앱을 개발 모드로 실행하려면:

```powershell
cd .\frontend
node .\scripts\run-tauri-dev.mjs
```

이 스크립트는 Python sidecar 서버와 Tauri 앱을 함께 시작합니다. 실행 전 `setup_local_node.ps1`로 의존성이 설치되어 있어야 합니다.

#### 데스크탑 패키지 빌드 (CPU/GPU 선택)

```powershell
# CPU 전용 패키지 빌드
cd .\frontend
node .\scripts\run-desktop-profile-command.mjs package cpu

# GPU(CUDA) 패키지 빌드
node .\scripts\run-desktop-profile-command.mjs package gpu
```

데스크탑 배포판(`.exe` 인스톨러)은 GitHub Actions `desktop-release` 워크플로(`v*` 태그 푸시 시 자동 실행)로 생성할 수 있습니다.

#### 데스크탑 앱 인증 흐름

데스크탑 앱은 웹 앱과 별개의 인증 경로를 사용합니다.

- **Google 로그인**: Tauri 셸 내 브라우저 창에서 OAuth 인증 후 토큰을 로컬 세션에 저장
- **로컬 로그인**: Remote Control Plane 없이 dev 모드에서 직접 로그인
- 세션은 `DESKTOP_TOKEN_KEY`로 로컬 스토리지에 캐시되며, 앱 재시작 시 자동 복원

### 8. 2026-03-19 업데이트

- initial training 기준 supervised backbone이 8종으로 확장되었습니다.
  - `DenseNet121`
  - `ConvNeXt-Tiny`
  - `ViT`
  - `Swin`
  - `EfficientNetV2-S`
  - `DINOv2`
  - `DINOv2 Attention MIL`
  - `Dual-input Concat Fusion`
- `dual_input_concat`은 `paired` crop mode에서 `cornea crop + lesion crop` feature를 concat한 single classifier baseline입니다.
- benchmark는 비교 일관성을 위해 기존 7개 single-input backbone만 순차 학습합니다. `dual_input_concat`은 단일 학습/교차검증용 baseline입니다.
- visit 단위 분석을 위해 `mean`, `logit_mean`, `quality_weighted_mean`, `attention_mil` 집계를 지원합니다.
- `dinov2_mil`은 visit 안의 여러 이미지를 attention으로 통합해 visit-level 예측을 수행하고, 대표 이미지는 highest-attention 컷으로 자동 선택합니다.
- case validation 뒤에는 prediction snapshot, structured analysis, root-cause/action tag, LLM/local fallback summary를 포함한 post-mortem이 함께 생성됩니다.
- 7종 benchmark 진행 카드에는 전체 퍼센트, 현재 architecture, 순서, 남은 모델 수와 함께 ETA가 표시됩니다.
- 단일 initial training과 benchmark는 작업 중단이 가능하고, benchmark는 완료되지 않은 architecture만 다시 시작할 수 있습니다.

### 9. 2026-03-22 ~ 2026-03-24 업데이트

- Tauri 데스크탑 앱이 100개 이상의 Rust 모듈로 분리되어 대규모 리팩토링이 완료되었습니다 (v0.6 → v0.69).
- 데스크탑 전용 Google OAuth 인증 흐름(`auth/desktop/start` → `exchange`)과 세션 캐시가 추가되었습니다.
- Python 백엔드 라우터가 역할별로 분리되었습니다.
  - `admin.py` → `admin_access`, `admin_management`, `admin_registry`, `admin_shared`
  - `cases.py` → `case_analysis`, `case_images`, `case_records`, `case_shared`
  - `sites.py` → `site_training`, `site_imports`, `site_overview`, `site_shared`
- Federation Salt 시스템이 추가되어 다기관 환경에서 케이스/환자/별칭 참조값을 독립적으로 솔팅합니다.
- 데스크탑 패키지 빌드에서 CPU / GPU 두 가지 배포판을 지원합니다.
- GitHub Actions `desktop-release` 워크플로(`v*` 태그 기반)와 `desktop-verify` 워크플로(PR 검증)가 추가되었습니다.
- SQLite N+1 쿼리 수정, CTE 최적화, 인덱스 추가 등 성능 개선이 적용되었습니다.

### 10. 2026-04-07 ~ 2026-04-09 업데이트

- CPU 배포본 안정화 작업을 진행했습니다.
  - `Next production build`
  - `desktop:smoke-installed:cpu`
  - 주요 Python 회귀
  - packaged backend self-check
- 케이스 정책을 `culture_confirmed bool` 중심에서 `culture_status` 중심으로 정리했습니다.
  - `positive / negative / not_done / unknown`
  - 모든 사용자는 저장/분석 가능
  - `positive`일 때만 category/species가 학습/기여에 사용
- validation을 `labeled validation`과 `inference-only`로 분리했습니다.
  - inference-only는 `true_label / is_correct` 없이 pattern support 성격으로 반환합니다.
- AI Clinic retrieval을 analysis model과 분리된 `retrieval_profile` 구조로 고정했습니다.
- 운영 기본 AI 구성을 아래처럼 정리했습니다.
  - 주 분석: `EfficientNetV2-S MIL (full)`
  - 보조 image-level: `ConvNeXt-Tiny (full)`
  - similar case retrieval: `DINOv2 lesion-crop`
- 다기관 similar case 공유를 위해 `federated retrieval corpus expansion`을 추가했습니다.
  - 각 병원 positive / included case embedding을 중앙 retrieval corpus로 sync
  - AI Clinic이 cross-site similar case를 검색 가능
  - retrieval signature 검증으로 동일 profile만 같은 corpus에 포함
- image-level federated learning을 `ConvNeXt-Tiny (full)` 기준으로 추가했습니다.
  - site-round background job
  - pending review update
  - FedAvg aggregation
- visit-level federated learning을 `EfficientNetV2-S MIL (full)` 기준으로 추가했습니다.
  - true MIL bag fine-tune 경로
  - site-round background job
  - pending review update
  - FedAvg aggregation
- 연합학습 / retrieval / embedding status 응답의 `active_job` semantics를 정리했습니다.
  - 완료된 job은 더 이상 `active_job`으로 보이지 않습니다.

---

## 환경변수

| 변수 | 설명 |
|------|------|
| `KERA_ADMIN_USERNAME` | 초기 admin 계정 사용자 이름 |
| `KERA_ADMIN_PASSWORD` | 초기 admin 계정 비밀번호 |
| `KERA_RESEARCHER_USERNAME` | 초기 researcher 계정 사용자 이름 |
| `KERA_RESEARCHER_PASSWORD` | 초기 researcher 계정 비밀번호 |
| `KERA_API_SECRET` | 레거시 로컬 JWT fallback 키 |
| `KERA_LOCAL_API_JWT_PRIVATE_KEY_B64` | 중앙 control plane이 발급하는 access token의 RS256 private key (서버 전용) |
| `KERA_LOCAL_API_JWT_PUBLIC_KEY_B64` | local node / desktop 앱이 control plane token을 검증할 RS256 public key |
| `KERA_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID (백엔드) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID (프론트엔드) |
| `NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL` | control plane UI가 로컬 FastAPI node와 통신할 때 사용할 base URL |
| `KERA_CONTROL_PLANE_DATABASE_URL` | 중앙 control plane DB (사용자, 권한, 프로젝트, 모델 레지스트리) |
| `KERA_CONTROL_PLANE_API_BASE_URL` | 병원 local node가 중앙 control-plane HTTP API에 붙을 때 사용하는 base URL |
| `KERA_LOCAL_CONTROL_PLANE_DATABASE_URL` | 병원 local node가 중앙 metadata projection/cache를 저장하는 로컬 SQLite DB |
| `KERA_CONTROL_PLANE_SESSION_SECRET` | control plane 세션/JWT 서명용 비밀값 |
| `KERA_CONTROL_PLANE_DEV_AUTH` | 로컬 개발용 dev login 허용 여부 (기본 `false`, 개발 중에만 임시 `true`) |
| `KERA_CONTROL_PLANE_DIR` | 중앙 control plane 파일 루트 (`validation_cases`, `validation_reports`, `experiments`, `artifacts`) |
| `KERA_CONTROL_PLANE_ARTIFACT_DIR` | 중앙 delta 및 control plane 파일 아티팩트 저장 경로 |
| `KERA_DATA_PLANE_DATABASE_URL` | 병원 로컬 data plane DB (환자, 방문, 이미지) |
| `KERA_STORAGE_DIR` | 기본 저장 루트 경로 (예: `D:\KERA_DATA`) |
| `KERA_MODEL_DIR` | 글로벌 모델 파일 공유 경로 |
| `KERA_MODEL_SOURCE_PROVIDER` | 모델 아티팩트 제공자 라벨 (`local`, `onedrive_sharepoint` 등) |
| `KERA_MODEL_AUTO_DOWNLOAD` | `download_url`이 있는 모델을 로컬 `KERA_MODEL_DIR` 캐시로 자동 다운로드할지 여부 |
| `KERA_MODEL_KEEP_VERSIONS` | 로컬 캐시에 유지할 모델 버전 수 |
| `KERA_MODEL_DOWNLOAD_TIMEOUT_SECONDS` | 모델 다운로드 타임아웃(초) |
| `KERA_MODEL_DISTRIBUTION_MODE` | `local_path` 또는 `download_url`. `download_url`이면 새 글로벌 모델은 배포 URL 등록 전 `pending_upload` 상태로 유지 |
| `KERA_CONTROL_PLANE_NODE_ID` | 병원 PC에 발급된 node id. 보통 최초 등록 후 로컬 자격증명 저장소에서 자동 로드 |
| `KERA_CONTROL_PLANE_NODE_TOKEN` | 병원 PC에 발급된 node token. 보통 최초 등록 후 로컬 자격증명 저장소에서 자동 로드 |
| `KERA_SITE_STORAGE_SOURCE` | site 저장소 해석 기준. remote control plane 개발 중에는 `local` 권장 |
| `KERA_FEDERATED_UPDATE_SIGNING_SECRET` | weight delta update 서명용 HMAC 비밀값. multi-site 운영 시 설정 권장 |
| `KERA_FEDERATED_UPDATE_SIGNING_KEY_ID` | 서명 키 회전 시 추적용 key id |
| `KERA_REQUIRE_SIGNED_FEDERATED_UPDATES` | `true`면 unsigned federated delta 등록/집계를 거절 |
| `KERA_FEDERATED_AGGREGATION_STRATEGY` | `fedavg`, `coordinate_median`, `trimmed_mean` 중 선택 |
| `KERA_FEDERATED_AGGREGATION_TRIM_RATIO` | `trimmed_mean`에서 양 끝을 자를 비율 (기본 `0.2`) |
| `KERA_FEDERATED_DELTA_CLIP_NORM` | site-side delta L2 clipping 임계값 |
| `KERA_FEDERATED_DELTA_NOISE_MULTIPLIER` | clipping 후 추가할 Gaussian noise 배수. formal DP accountant는 아직 없음 |
| `KERA_FEDERATED_DELTA_QUANTIZATION_BITS` | 전송/저장 delta 양자화 비트 수 (`8` 또는 `16`) |
| `KERA_ONEDRIVE_TENANT_ID` | OneDrive/SharePoint Graph app의 tenant ID |
| `KERA_ONEDRIVE_CLIENT_ID` | OneDrive/SharePoint Graph app의 client ID |
| `KERA_ONEDRIVE_CLIENT_SECRET` | OneDrive/SharePoint Graph app의 client secret |
| `KERA_ONEDRIVE_DRIVE_ID` | 업로드 대상 document library 또는 drive ID |
| `KERA_ONEDRIVE_ROOT_PATH` | drive 내부에서 K-ERA 모델/델타를 올릴 루트 폴더 경로 |
| `KERA_DATABASE_URL` / `DATABASE_URL` | legacy 단일 DB 호환용. split control/data plane env를 쓰는 운영에서는 비워 두는 것을 권장 |
| `KERA_CASE_REFERENCE_SALT` | case_reference_id 해시 salt (다기관 환경에서 모든 노드가 동일 값 사용 권장) |
| `MEDSAM_SCRIPT` | MedSAM 실행 스크립트 경로 |
| `MEDSAM_CHECKPOINT` | MedSAM 체크포인트 경로 |
| `KERA_AI_CLINIC_OPENAI_API_KEY` | AI Clinic LLM 추천 기능용 OpenAI API 키 |
| `KERA_AI_CLINIC_LLM_MODEL` | 사용할 LLM 모델명 (기본: gpt-4o-mini) |
| `KERA_AI_CLINIC_LLM_BASE_URL` | LLM API base URL (OpenAI 호환 엔드포인트) |
| `KERA_AI_CLINIC_LLM_TIMEOUT_SECONDS` | LLM 요청 타임아웃 (초) |
| `KERA_DESKTOP_RUNTIME_MODE` | 데스크탑 앱 런타임 모드. `packaged`(배포판) 또는 개발 시 미설정. 빌드 스크립트가 자동으로 주입 |
| `KERA_DESKTOP_EMBED_VENV` | 데스크탑 패키지 빌드 시 번들할 Python venv 경로. 기본값: `.venv` |

**참고:**
- 로컬 계정(`KERA_ADMIN_USERNAME` 등)은 해당 환경변수가 있을 때만 앱 시작 시 시드됩니다.
- `KERA_GOOGLE_CLIENT_ID`와 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`는 실행 스크립트가 서버/프론트엔드에서 서로 보완되도록 처리합니다.
- 불특정 사용자 배포에서는 `KERA_LOCAL_API_JWT_PRIVATE_KEY_B64`를 중앙 control plane 서버에만 두고, `KERA_LOCAL_API_JWT_PUBLIC_KEY_B64`만 desktop/local node에 배포하세요.
- 중앙 owner(Next.js control plane)는 `KERA_CONTROL_PLANE_DATABASE_URL`을 사용합니다. 병원 local node는 `KERA_CONTROL_PLANE_API_BASE_URL`과 `KERA_LOCAL_CONTROL_PLANE_DATABASE_URL`을 사용하고, `KERA_DATA_PLANE_DATABASE_URL`은 병원 로컬 DB를 가리켜야 합니다.
- `KERA_DATABASE_URL` / `DATABASE_URL`는 legacy 호환용입니다. split env를 함께 쓰는 경우에는 실제로 다른 DB를 가리킬 때만 경고가 발생하며, 운영 설정에서는 가능하면 비워 두는 편이 안전합니다.
- remote control plane cache SQLite가 손상된 경우 local node는 startup 시 cache 파일을 같은 경로에서 quarantine 후 재생성합니다. 별도 `.recovered.db`로 우회하지 않습니다.
- 아무 DB도 지정하지 않으면 기본값은 `앱 폴더의 상위 디렉토리\KERA_DATA\kera.db`입니다.
- 집/병원 등 여러 관리자 PC에서 같은 validation metadata와 model registry artifact를 보려면 `KERA_CONTROL_PLANE_DIR`과 `KERA_MODEL_DIR`을 모든 관리자 PC에서 동일한 공유 경로로 맞추는 것을 권장합니다.
- OneDrive/SharePoint 자동 발행을 쓰려면 `KERA_MODEL_DISTRIBUTION_MODE=download_url`과 `KERA_ONEDRIVE_*`를 함께 설정하세요. 그러면 관리자 Registry의 `자동 발행` 버튼으로 모델/델타를 바로 업로드하고 링크를 등록할 수 있습니다.
- Graph 설정이 없으면 기존처럼 `scripts/publish_model_version.py` 또는 관리자 수동 URL 등록으로 계속 운영할 수 있습니다.

LLM 설정은 [docs/ai_clinic_llm_setup.md](docs/ai_clinic_llm_setup.md)를 참고하세요.

IRB 제출용 초안은 [docs/irb/README.md](docs/irb/README.md)를 참고하세요.

Single-DB에서 split control/data plane으로 전환할 때는 [docs/control_plane_split_migration.md](docs/control_plane_split_migration.md)를 참고하세요.

로컬에서 먼저 중앙 control plane을 띄우는 개발 흐름은 [docs/control_plane_local_first_dev.md](docs/control_plane_local_first_dev.md)를 참고하세요.
로컬 runtime 검증은 `.\scripts\run_control_plane_e2e_smoke.ps1`로 한 번에 확인할 수 있습니다.

---

## 현재 기능 범위

### 인증과 접근 제어

**웹 앱:**
- Google Sign-In (기본 연구자 로그인 경로, `/`)
- 로컬 username/password 로그인 (관리자 복구용, `/admin-login`)
- 새/마이그레이션 비밀번호는 Argon2로 저장하고, 기존 bcrypt/PBKDF2 row는 성공적인 로그인 시 Argon2로 무중단 재해시합니다.
- JWT 기반 세션, 2시간 만료
- 기관(site) 및 역할(role) 접근 요청 제출 및 승인/반려

**데스크탑 앱:**
- Google OAuth 토큰 교환 (`/auth/desktop/start` → `/auth/desktop/exchange`)
- 개발 모드 로컬 로그인 (`KERA_CONTROL_PLANE_DEV_AUTH=true` 이고 localhost/loopback 요청에서만)
  - 추가 가드: runtime environment가 `production/staging`으로 보이거나 control-plane base URL이 localhost가 아니면 dev-login route는 아예 등록되지 않습니다.
- 세션은 로컬에 캐시되어 앱 재시작 시 자동 복원

지원 역할: `admin`, `site_admin`, `researcher`, `viewer`

### 데스크탑 앱 (Tauri)

Tauri 기반 Windows 데스크탑 앱으로, 병원 PC 단독 설치 운영을 위한 별도 실행 경로입니다.

- Python 런타임과 FastAPI 서버를 앱 내에 내장 — 별도 서버 설치 불필요
- CPU / GPU(CUDA) 두 가지 패키지 배포판 지원
- Google OAuth 및 로컬 로그인 지원
- Remote Control Plane 연동 시 연합학습, 모델 동기화, 사이트 활동 리더보드 사용 가능
- 웹 앱과 동일한 케이스 등록, 검증, AI Clinic, 학습/기여 워크플로우 제공

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
- **Prediction post-mortem**: validation 직후 structured analysis와 root-cause/action tag, 사람용 요약을 함께 생성
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

### 학습 / benchmark / visit 분석

- **initial training architectures**:
  - single-input: `DenseNet121`, `ConvNeXt-Tiny`, `ViT`, `Swin`, `EfficientNetV2-S`, `DINOv2`
  - visit-level MIL: `DINOv2 Attention MIL`
  - dual-input fusion: `Dual-input Concat Fusion`
- **7-model supervised benchmark**: 동일 split과 runtime 설정으로 7개 backbone을 순차 학습합니다.
- **DINOv2 classifier**: retrieval 전용이 아니라 supervised classifier backbone으로도 학습할 수 있습니다.
- **Dual-input Concat Fusion**:
  - 입력 단위: `paired` crop mode의 `cornea crop + lesion crop`
  - shared DINOv2 encoder로 두 crop feature를 추출
  - feature concat 후 single classifier로 예측
  - case-level aggregation은 현재 `mean`, `logit_mean`, `quality_weighted_mean`을 사용
  - branch-aware Grad-CAM은 아직 지원하지 않습니다
- **visit aggregation**:
  - `mean`
  - `logit_mean`
  - `quality_weighted_mean`
  - `attention_mil` (`dinov2_mil`)
- **DINOv2 Attention MIL**:
  - 입력 단위: `patient_id + visit_date`
  - 각 이미지에서 DINOv2 feature 추출
  - attention pooling으로 visit-level logits 생성
  - attention top image를 model-representative image로 사용
- **job UX**:
  - benchmark progress에 현재 architecture, 순서, remaining count, ETA 표시
  - running job 중단 지원
  - cancelled / partial benchmark는 남은 architecture만 resume 가능

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

**Federation Salt:**

다기관 환경에서 케이스 참조, 환자 참조, 공개 별칭의 솔팅값을 기관별로 분리 관리합니다.

- `federation_salt.json` — control plane 디렉토리에 저장되는 salt 파일
- `case_reference_salt`, `patient_reference_salt`, `public_alias_salt` 세 값을 독립 관리
- 기존 단일 `KERA_CASE_REFERENCE_SALT` 환경변수와 하위 호환됩니다.
- 마이그레이션 가이드: [docs/federation-salt-migration.md](docs/federation-salt-migration.md)

**기여 공개 별칭 (Public Alias):**

- Google 로그인 사용자는 최초 인증 시 `warm_gorilla_221` 형태의 language-neutral 별칭이 자동 생성됩니다.
- 기여 이력과 사이트 활동 리더보드에는 실명 대신 별칭이 표시됩니다.
- 한국어: `따스한 고릴라 #221`, 영어: `Warm Gorilla #221` 형태로 locale에 맞게 렌더링됩니다.

### 연구 registry / 가명처리 정책

2026-03-16 기준으로 K-ERA는 `로컬 입력`과 `중앙 registry 저장`을 분리해서 다룹니다.

- 병원 로컬 workspace에서는 내부 차트 ID / MRN 형태의 `patient_id`를 사용할 수 있습니다.
- 다만 환자 **실명은 입력하지 않는 것**을 원칙으로 합니다.
- `visit_date`는 중앙 공유용 기준값으로 `Initial`, `FU #1`, `FU #2` 같은 방문 라벨만 사용합니다.
- 실제 달력 날짜가 필요하면 `actual_visit_date`에 저장하며, 이 값은 로컬 워크스페이스 기준으로만 보관합니다.
- 중앙 control plane / 연구 registry에는 raw `patient_id`, 정확한 방문일, 원본 경로 대신 `case_reference_id` 중심으로 저장합니다.
- 업로드 이미지는 저장 시 EXIF 메타데이터를 제거하고, 파일명은 원본명이 아닌 `image_id` 기반 이름으로 바뀝니다.

즉, 현재 방향은 다음과 같습니다.

- **로컬 병원 노드**: 내부 운영에 필요한 차트 ID와 실제 방문일을 보관
- **중앙 registry / validation / contribution 이력**: `case_reference_id`와 방문 라벨 중심으로 저장

이 구조는 중앙 저장본을 `익명정보`라기보다 `가명처리된 연구 데이터`에 가깝게 운영하기 위한 설계입니다.

### Research Registry

K-ERA는 `무료 분석 + 1회 registry opt-in + 이후 자동 포함 + 케이스별 opt-out` 방향으로 설계되어 있습니다.

- 사이트(병원) 단위로 `research_registry_enabled`를 켜고 끌 수 있습니다.
- 사용자는 사이트별로 한 번 research registry 동의를 등록할 수 있습니다.
- registry가 활성화된 사이트에서, 사용자가 동의한 뒤 분석/검증된 케이스는 자동으로 registry 상태를 가질 수 있습니다.
- 각 케이스는 `analysis_only`, `candidate`, `included`, `excluded` 같은 상태를 가집니다.
- 케이스 화면에서는 `Included / Excluded` 상태를 확인하고, 케이스별 제외 또는 재포함을 제어할 수 있습니다.

이 구조는 기존의 로컬 fine-tuning용 `weight delta contribution`과는 별개입니다.

- **기존 contribution**: 로컬 학습 결과(weight delta)를 중앙에 업로드
- **research registry**: 연구 데이터셋 후보 / 포함 상태를 관리

### 기관 참여 방향

현재 코드와 운영 방향을 함께 보면 다음처럼 가져가는 것이 권장됩니다.

- **대학병원 / 승인된 기관**: research registry 활성화 후 자동 포함 흐름 사용 가능
- **개인의원 / 소규모 기관**: 우선 `analysis-only`로 시작하고, 기관 정책 또는 승인 구조가 정리되면 registry 참여 확장

즉, `무료 분석`은 넓게 열고, `중앙 연구 dataset 포함`은 사이트 정책과 동의 흐름을 거쳐 단계적으로 여는 방향입니다.

### 연구용 CLI

HTTP API와 별개로 직접 실행 가능합니다.

```powershell
uv run python -m kera_research.cli train --site-id <SITE_ID>
uv run python -m kera_research.cli train --site-id <SITE_ID> --architecture dual_input_concat --crop-mode paired
uv run python -m kera_research.cli cross-validate --site-id <SITE_ID>
uv run python -m kera_research.cli cross-validate --site-id <SITE_ID> --architecture dual_input_concat --crop-mode paired
uv run python -m kera_research.cli external-validate --site-id <SITE_ID> --project-id <PROJECT_ID>
uv run python -m kera_research.cli export-report --validation-id <VALIDATION_ID> --output .\report.json
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
KERA_CONTROL_PLANE_DIR=/mnt/central-server/control_plane
KERA_CONTROL_PLANE_ARTIFACT_DIR=/mnt/central-server/control_plane/artifacts
KERA_DATA_PLANE_DATABASE_URL=sqlite:///D:/KERA_DATA/kera_data.db
KERA_STORAGE_DIR=D:\KERA_DATA
KERA_MODEL_DIR=/mnt/central-server/models
KERA_MODEL_DISTRIBUTION_MODE=download_url
```

- 중앙 control plane: Neon Postgres 등 클라우드 DB 권장
- 중앙 control plane 파일: 공유 스토리지(예: SMB/NAS, mounted drive) 권장
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

데스크탑 인증 (Next.js 라우트):

- `POST /control-plane/api/main/auth/desktop/start`
- `POST /control-plane/api/main/auth/desktop/exchange`
- `GET /control-plane/api/main/auth/desktop/status`

데스크탑 / 로컬 노드 (FastAPI):

- `GET /api/desktop/self-check`
- `GET /api/control-plane/node/status`
- `POST /api/control-plane/node/register`
- `POST /api/control-plane/node/credentials`

사이트 작업:

- `GET /api/sites`
- `GET /api/sites/{site_id}/summary`
- `GET /api/sites/{site_id}/research-registry/settings`
- `PATCH /api/sites/{site_id}/research-registry/settings`
- `POST /api/sites/{site_id}/research-registry/consent`
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
- `POST /api/sites/{site_id}/training/initial/benchmark`
- `POST /api/sites/{site_id}/training/initial/benchmark/resume`
- `POST /api/sites/{site_id}/training/cross-validation`
- `GET /api/sites/{site_id}/jobs/{job_id}`
- `POST /api/sites/{site_id}/jobs/{job_id}/cancel`
- `POST /api/sites/{site_id}/import/bulk`

운영 / 관리자:

- `GET /api/admin/overview`
- `POST /api/admin/institutions/sync`
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

전체 엔드포인트 목록은 [src/kera_research/api/routes/](src/kera_research/api/routes/)에서 라우터별로 확인할 수 있습니다.

---

## 테스트

```powershell
uv run python -m unittest tests.test_api_http
uv run python -m unittest tests.test_modeling
```

포함 범위: 로그인, 접근 요청 승인, 케이스 validation/contribution, 저장 경로 설정/마이그레이션, initial training, cross-validation, bulk import, aggregation, experiment registry, 운영 API 일부, artifact validation, calibration metric 출력

---

## 현재 한계와 주의사항

- 데스크탑 앱(Tauri)은 현재 Windows 전용입니다. macOS / Linux 빌드는 지원하지 않습니다.
- 데스크탑 앱의 내장 Python 런타임은 앱 시작 시 자동으로 시작되며, 초기 로딩에 수 초가 소요될 수 있습니다.
- 케이스 단위 validation, AI Clinic retrieval/report 생성 등 일부 작업은 여전히 API 요청-응답 안에서 동기 실행됩니다.
- 사이트 단위 validation, initial training, multi-model benchmark, cross-validation은 `site_jobs`에 큐잉되며, 별도 worker(`uv run python -m kera_research.worker`)가 처리합니다. `.\scripts\run_local_node.ps1`는 이 worker를 함께 실행하지만, API만 단독 실행하면 해당 작업은 `queued` 상태에 머무를 수 있습니다.
- training / benchmark ETA는 `elapsed time + current percent` 기반 추정치이므로 정확한 wall-clock 보장은 아닙니다.
- job cancel은 안전 지점에서 반영됩니다. 보통 현재 epoch 또는 stage가 끝난 뒤 중단됩니다.
- benchmark resume은 `남은 architecture 재큐잉` 방식입니다. 중단된 architecture의 mid-epoch checkpoint resume은 아직 지원하지 않습니다.
- AI Clinic embedding indexing / backfill, lesion live preview, 관리자 aggregation은 현재 별도 외부 큐가 아니라 API 프로세스 내부 daemon thread로 실행됩니다. 따라서 API 프로세스 재시작이나 종료 시 해당 작업은 중단될 수 있습니다.
- MedSAM은 로컬 스크립트와 체크포인트가 준비된 경우에만 사용하며, 그렇지 않으면 fallback ROI 경로를 사용합니다.
- 프론트엔드 실행 스크립트는 개발 서버(`next dev`) 기준입니다.
- 프론트엔드는 기본적으로 동일 origin의 `/api/...`로 요청하고, Next 개발 서버가 내부적으로 `http://127.0.0.1:8000` API로 프록시합니다. 다른 주소를 써야 하면 `KERA_INTERNAL_API_BASE_URL` 또는 `NEXT_PUBLIC_API_BASE_URL`을 설정합니다.
- CORS 기본 허용 origin은 `localhost/127.0.0.1`의 `3000`, `3001`만 포함합니다. 추가 웹 origin이 필요하면 `KERA_CORS_ALLOWED_ORIGINS=https://example.org,https://admin.example.org`처럼 명시적으로 설정합니다.
- 역방향 프록시 뒤에서 로그인 rate limit을 정확히 적용하려면 `KERA_TRUST_PROXY_HEADERS=true`와 `KERA_TRUSTED_PROXY_IPS`를 함께 설정해야 합니다. 신뢰한 프록시가 아닐 때는 `X-Forwarded-For`/`X-Real-IP`를 무시합니다.
- 배포용 인증, 비밀 관리, 감사 로깅, 장애 복구는 연구용 로컬 노드 수준으로만 구성되어 있습니다.

### 프론트엔드 빌드/캐시 트러블슈팅

개발 서버가 비정상 종료되었거나 Next 캐시가 꼬인 경우 아래 증상이 일시적으로 나타날 수 있습니다.

- `/_error` 또는 `/500` prerender 실패
- `.next` 내부 청크 누락 (`Cannot find module './xxx.js'`)
- `app/globals.css`에서 `tailwindcss` 모듈 해석 실패

이 경우 프론트엔드 디렉토리에서 캐시를 지우고 다시 빌드합니다.

```powershell
cd .\frontend
npm run rebuild
```

개발 서버도 캐시를 비운 상태로 다시 띄울 수 있습니다.

```powershell
cd .\frontend
npm run dev:clean
```

---

## 관련 문서

- [docs/local_node_deployment.md](docs/local_node_deployment.md)
- [docs/dataset_schema.md](docs/dataset_schema.md)
- [docs/ai_clinic_llm_setup.md](docs/ai_clinic_llm_setup.md)
- [docs/federation-salt-migration.md](docs/federation-salt-migration.md) — Federation Salt 마이그레이션 가이드
- [docs/tauri-packaged-runtime-layout.md](docs/tauri-packaged-runtime-layout.md) — 데스크탑 패키지 런타임 구조
- [docs/desktop-installed-smoke.md](docs/desktop-installed-smoke.md) — 데스크탑 설치 후 smoke test 가이드
- [docs/tauri-embedded-ui-plan.md](docs/tauri-embedded-ui-plan.md) — Tauri 임베디드 UI 설계 문서
- [CHANGELOG.md](CHANGELOG.md)

---

## 데스크탑 릴리즈 서명 (Desktop Release Signing)

- Tauri 업데이터 서명 키는 절대 이 저장소에 커밋하지 않습니다.
- `TAURI_SIGNING_PRIVATE_KEY`는 GitHub Actions Secrets에만 보관합니다.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`는 키 생성 시 암호를 설정한 경우에만 설정합니다.
- 데스크탑 앱 빌드에는 `frontend/src-tauri/tauri.conf.json`에 업데이터 public key만 포함합니다.
- `desktop-release` 워크플로는 `frontend/~/.tauri/` 경로에 추적된 파일이 있으면 자동으로 빌드를 실패 처리합니다.
- 업데이터 키 교체: `cd frontend && npm run desktop:rotate-updater-key`
