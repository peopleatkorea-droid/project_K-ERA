# K-ERA Research Platform

감염성 각막염(infectious keratitis) 연구를 위한 로컬 연구 노드입니다. 현재 이 저장소의 기본 실행 경로는 `FastAPI + Next.js` 웹 앱이며, 병원 내부에서 케이스 등록, 검증, 로컬 학습, 기여, 운영 관리를 한 저장소 안에서 수행할 수 있습니다.

중요: 이 프로젝트는 연구 워크플로우용 소프트웨어이며, 임상 진단 또는 치료 의사결정용 의료기기가 아닙니다.

## 현재 앱 상태

현재 코드 기준으로 동작하는 핵심 구성은 아래와 같습니다.

- `frontend/`: Next.js 15 + React 19 웹 UI
- `src/kera_research/api/app.py`: FastAPI API 서버
- `storage/`: SQLite DB, 사이트별 원본 이미지, validation artifact, model update 저장
- `<기본 저장 루트>/models/`: 로컬 학습/검증에 사용하는 모델 파일 저장 위치
- `scripts/run_local_node.ps1`: API와 웹 프론트엔드를 함께 띄우는 기본 런처

이 저장소는 더 이상 Streamlit 기반 앱을 기본 경로로 사용하지 않습니다. 현재 사용자 흐름과 실행 스크립트는 모두 웹 스택 기준입니다.

## 현재 구현 범위

### 1. 인증과 접근 제어

- JWT 기반 로그인
- Google Sign-In 로그인 지원
- 기관(site) 및 역할(role) 접근 요청 제출
- `admin`, `site_admin`의 접근 요청 승인/반려
- 로컬 계정(username/password) 시드 지원

지원 역할:

- `admin`
- `site_admin`
- `researcher`
- `viewer`

### 2. Case Canvas

웹의 기본 작업 화면은 문서형 `Case Canvas`입니다.

- 환자 등록
- 방문 등록
- 다중 이미지 업로드
- 대표 이미지 지정
- 저장된 케이스 목록 조회
- 브라우저 로컬 draft autosave / draft 복구
- 한/영 UI 전환
- 사이트별 요약 지표 조회
- 최근 validation / contribution 활동 조회

케이스 저장 흐름은 대체로 아래 순서입니다.

1. 환자 정보 입력
2. 방문 정보 입력
3. 슬릿램프 이미지 업로드
4. 케이스 저장
5. ROI preview / validation / contribution 실행

### 3. 케이스 단위 AI 워크플로우

저장된 케이스에 대해 아래 기능이 연결되어 있습니다.

- ROI preview 생성
- MedSAM 기반 ROI crop / mask 생성 시도
- 케이스 단위 validation 실행
- Grad-CAM artifact 조회
- validation history 조회
- case contribution 실행
- contribution history 조회

현재 contribution은 활성 병변(`visit_status == active`) 케이스에만 허용됩니다.

### 4. 사이트 단위 운영 기능

운영 화면(`Operations Workspace`)에서는 아래 기능이 구현되어 있습니다.

- bulk import CSV + 이미지 아카이브 업로드
- import template CSV 다운로드
- 인스턴스 기본 저장 경로 설정
- 사이트별 저장 경로 설정
- 기존 사이트 데이터 저장 경로 마이그레이션
- 사이트 전체 external validation 실행
- validation run 목록 조회
- misclassified case 조회
- site comparison 조회
- initial training 실행
- cross-validation 실행 및 리포트 조회
- model registry 조회
- model update review
- federated aggregation 실행
- project / site / user 관리

권한 차이:

- `admin`: 전체 운영 기능 사용 가능
- `site_admin`: 사이트 중심 운영 기능 사용 가능

저장 경로 관련 권한:

- `admin`, `site_admin` 모두 운영 화면에서 저장 경로를 관리할 수 있습니다.
- 데이터가 없는 사이트는 저장 경로만 바로 바꿀 수 있습니다.
- 이미 환자/방문/이미지가 있는 사이트는 `Migrate existing data`로 폴더 이동과 경로 재작성을 함께 수행합니다.

## 현재 구조

```text
[Browser]
   |
   v
[Next.js Web UI]  http://localhost:3000
   |
   v
[FastAPI API]     http://localhost:8000
   |
   +-- SQLite or PostgreSQL metadata
   +-- storage/sites/<SITE_ID>/data/raw
   +-- storage/sites/<SITE_ID>/artifacts
   +-- storage/sites/<SITE_ID>/validation
   +-- storage/sites/<SITE_ID>/model_updates
   +-- <기본 저장 루트>/models/
```

메타데이터는 기본적으로 SQLite에 저장되고, 원본 이미지와 파생 artifact는 파일 시스템에 저장됩니다.

## 빠른 실행

### 요구사항

- Windows PowerShell
- Python 3.10, 3.11, 또는 3.12
- Node.js / npm

### 1. 의존성 설치

```powershell
.\scripts\setup_local_node.ps1
```

이 스크립트는 다음을 수행합니다.

- `.venv` 생성
- Python 패키지 설치
- GPU 유무를 보고 CPU/GPU용 torch 패키지 설치
- 기본 health check 실행

옵션 예시:

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile cpu
.\scripts\setup_local_node.ps1 -TorchProfile gpu
```

### 2. 환경변수 설정

선택적으로 `.env.local`에 값을 넣을 수 있습니다.

주요 환경변수:

- `KERA_ADMIN_USERNAME`
- `KERA_ADMIN_PASSWORD`
- `KERA_RESEARCHER_USERNAME`
- `KERA_RESEARCHER_PASSWORD`
- `KERA_API_SECRET`
- `KERA_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `KERA_CONTROL_PLANE_DATABASE_URL`
- `KERA_CONTROL_PLANE_ARTIFACT_DIR`
- `KERA_DATA_PLANE_DATABASE_URL`
- `KERA_STORAGE_DIR`
- `KERA_DATABASE_URL`
- `DATABASE_URL`
- `MEDSAM_SCRIPT`
- `MEDSAM_CHECKPOINT`

설명:

- 로컬 계정은 환경변수가 있을 때만 시드됩니다.
- `KERA_GOOGLE_CLIENT_ID`와 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`는 서버/프런트엔드에서 서로 보완되도록 스크립트가 처리합니다.
- `KERA_CONTROL_PLANE_DATABASE_URL`를 지정하면 로그인/권한/프로젝트/모델 레지스트리 같은 중앙 control plane 메타데이터를 별도 DB로 분리할 수 있습니다.
- `KERA_CONTROL_PLANE_ARTIFACT_DIR`를 지정하면 delta/중앙 검토 산출물 같은 control plane 파일 아티팩트를 별도 경로에 저장할 수 있습니다.
- `KERA_DATA_PLANE_DATABASE_URL`를 지정하면 환자/방문/이미지와 같은 로컬 data plane 메타데이터를 별도 DB로 둘 수 있습니다.
- `KERA_STORAGE_DIR`를 지정하면 기본 SQLite DB, 사이트 원본 이미지, validation artifact 저장 루트를 지정한 경로로 옮길 수 있습니다.
- 두 변수를 지정하지 않으면 기존과 동일하게 `KERA_DATABASE_URL` 또는 `DATABASE_URL` 하나를 공용 DB로 사용합니다.
- 아무 DB도 지정하지 않으면 기본값은 `앱 폴더의 상위 디렉토리\\KERA_DATA\\kera.db`입니다.

### 3. 앱 실행

기본 실행:

```powershell
.\scripts\run_local_node.ps1
```

이 스크립트는 다음을 수행합니다.

- FastAPI 서버 실행
- Next.js 개발 서버 실행
- 사용 가능한 포트를 찾아 자동 조정
- 브라우저 자동 오픈

개별 실행도 가능합니다.

```powershell
.\scripts\run_api_server.ps1
.\scripts\run_web_frontend.ps1
```

## 저장 구조

기본 저장 위치는 `앱 폴더의 상위 디렉토리\\KERA_DATA\\`입니다.

권장:

- 설치형 배포나 실제 운영에서는 기본값을 그대로 쓰거나, 필요하면 `KERA_STORAGE_DIR`로 별도 경로를 지정하는 편이 좋습니다.
- 예: `KERA_STORAGE_DIR=D:\KERA_DATA`
- 이렇게 하면 원본 이미지, SQLite DB, validation artifact가 Git 작업 폴더 밖에 저장됩니다.

이미지 저장 정책:

- 업로드 시 EXIF 메타데이터를 제거합니다.
- 저장 파일명은 원본 파일명이 아니라 생성된 `image_id` 기반 이름을 사용합니다.

- `<기본 저장 루트>/kera.db`: 기본 SQLite DB. control plane / data plane 분리 변수를 지정하지 않으면 공용 DB로 사용됩니다.
- `<기본 저장 루트>/control_plane/`: validation case JSON, aggregation 메타데이터 등
- `<기본 저장 루트>/sites/<SITE_ID>/data/raw/`: 원본 이미지
- `<기본 저장 루트>/sites/<SITE_ID>/artifacts/gradcam/`: Grad-CAM 결과
- `<기본 저장 루트>/sites/<SITE_ID>/artifacts/roi_crops/`: ROI crop
- `<기본 저장 루트>/sites/<SITE_ID>/artifacts/medsam_masks/`: MedSAM mask
- `<기본 저장 루트>/sites/<SITE_ID>/validation/`: validation 결과 및 cross-validation 리포트
- `<기본 저장 루트>/sites/<SITE_ID>/model_updates/`: 로컬 contribution 결과물

기본 DB는 SQLAlchemy를 사용하며 PostgreSQL 연결도 가능하도록 구성되어 있습니다.

### 저장 경로 설정

기본 동작:

- 별도 설정이 없으면 사이트 데이터는 `앱 폴더의 상위 디렉토리\\KERA_DATA\\sites\\<SITE_ID>\\` 아래에 저장됩니다.
- `KERA_STORAGE_DIR`를 지정하면 기본 루트가 `<KERA_STORAGE_DIR>/sites/<SITE_ID>/`로 바뀝니다.

운영 화면에서 가능한 작업:

- 인스턴스 기본 저장 루트 변경
  - 예: `D:\KERA_DATA`
  - 이후 새로 생성되는 사이트의 기본 저장 경로는 `<기본 루트>\<SITE_ID>`가 됩니다.
- 선택한 사이트 저장 루트 변경
  - 데이터가 없는 사이트는 경로만 갱신합니다.
- 기존 사이트 데이터 마이그레이션
  - 데이터가 있는 사이트는 폴더를 새 경로로 이동하고, 내부 경로 참조도 함께 재작성합니다.

예시:

- 인스턴스 A: `D:\HospitalAData`
- 인스턴스 B: `E:\HospitalBData`

현재 구현 기준으로 마이그레이션 시 함께 갱신되는 항목:

- 이미지 DB의 `image_path`
- validation case JSON 안의 artifact 경로
- 사이트 validation / cross-validation JSON 안의 경로
- model update payload 안의 사이트 로컬 경로
- 사이트 메타데이터의 `local_storage_root`

주의:

- 기존 데이터가 있는 사이트는 단순 경로 변경이 아니라 마이그레이션을 사용해야 합니다.
- 사이트별 파일 경로는 현재 DB와 JSON에 문자열로 저장되므로, 수동으로 폴더만 옮기면 참조가 깨질 수 있습니다.

다기관 운영에서는 보통 아래 구성이 적절합니다.

- `KERA_CONTROL_PLANE_DATABASE_URL`: 중앙 Postgres/Neon
- `KERA_CONTROL_PLANE_ARTIFACT_DIR`: 중앙 서버 또는 공유 스토리지 경로
- `KERA_DATA_PLANE_DATABASE_URL`: 병원 Local Node의 로컬 SQLite 또는 병원 내부 DB

이렇게 설정하면 로그인 정보와 권한은 중앙에서 관리하고, 환자/방문/이미지 메타데이터는 병원 내부에 남길 수 있습니다.

기여(review) 워크플로우는 원본 이미지를 중앙으로 올리지 않고, 중앙 검토용 저해상도 썸네일만 모델 업데이트 레코드에 포함시키는 방향을 권장합니다. 현재 구현은 review thumbnail을 중앙 model update payload에 포함시켜 다른 PC에서도 같은 기여 썸네일을 볼 수 있게 설계되어 있습니다.
weight delta는 중앙 control plane artifact 경로에 복사되며, 집계는 로컬 경로보다 이 중앙 artifact 경로를 우선 사용합니다.

## 2026-03-12 기준 다기관 관련 추가 구현

오늘 반영된 다기관 운영 관련 핵심 변경은 아래와 같습니다.

### 1. 중앙 DB와 로컬 DB 분리

- `KERA_CONTROL_PLANE_DATABASE_URL`
  - 로그인, 권한, 프로젝트, 사이트, 모델 버전, 모델 업데이트, 집계 이력 등 중앙 운영 메타데이터 저장
- `KERA_DATA_PLANE_DATABASE_URL`
  - 환자, 방문, 이미지, 로컬 학습 관련 메타데이터 저장
- 기존 `KERA_DATABASE_URL` 또는 `DATABASE_URL` 하나만 쓰는 단일 DB 방식도 계속 지원

권장 구성:

- 중앙 control plane: Neon Postgres
- 병원 Local Node data plane: 각 PC 또는 병원 내부 SQLite/Postgres

### 2. 중앙 검토용 썸네일 공유

학습 기여 시 중앙으로 올라가는 것은 원본 이미지가 아니라 검토용 저해상도 썸네일입니다.

- source thumbnail: 최대 128px
- ROI thumbnail: 최대 320px
- mask thumbnail: 최대 320px
- EXIF 제거 유지

이 썸네일은 model update의 `approval_report` payload에 포함되므로, 같은 병원의 다른 PC나 중앙 관리자 화면에서도 검토할 수 있습니다.

반대로 중앙에 올리지 않는 항목:

- 원본 이미지
- full-size ROI crop
- full-size MedSAM mask

### 3. delta 중앙 저장 및 중앙 집계

기여 시 생성되는 weight delta는 이제 로컬 경로만 기록하는 것이 아니라 중앙 artifact 경로에도 복사됩니다.

- 로컬 경로: `artifact_path`
- 중앙 경로: `central_artifact_path`
- 추가 메타데이터:
  - `central_artifact_name`
  - `central_artifact_size_bytes`
  - `central_artifact_sha256`
  - `artifact_storage`

집계(FedAvg)는 로컬 파일 경로보다 중앙 artifact 경로를 우선 사용합니다. 따라서 기여를 올린 PC의 로컬 delta 파일이 없어져도 중앙 복사본이 남아 있으면 집계가 가능합니다.

관련 환경변수:

- `KERA_CONTROL_PLANE_ARTIFACT_DIR`
  - 중앙 delta 및 control plane 파일 아티팩트 저장 경로

### 4. 중앙 기여 메타데이터 비식별화

중앙 control plane에 저장되는 기여 메타데이터에서는 `patient_id`, `visit_date`를 직접 저장하지 않도록 변경했습니다.

대신 아래 필드를 사용합니다.

- `case_reference_id`

이 값은 아래 정보를 바탕으로 생성한 해시 기반 참조 키입니다.

- `site_id`
- `patient_id`
- `visit_date`
- `KERA_CASE_REFERENCE_SALT`

목적:

- 중앙에서는 환자 식별자 없이 같은 케이스를 안정적으로 추적
- 로컬에서는 기존처럼 `patient_id + visit_date`로 케이스 작업 유지
- case history, contribution history, 운영 화면의 최근 기여 목록은 계속 동작

관련 환경변수:

- `KERA_CASE_REFERENCE_SALT`
  - 모든 설치본에서 동일하게 맞추는 것을 권장
  - 지정하지 않으면 `KERA_API_SECRET` 또는 기본 fallback 문자열을 사용

### 5. 현재 중앙에 남는 정보와 남지 않는 정보

중앙에 남는 정보:

- 사용자 계정과 권한
- 프로젝트/사이트 정보
- 모델 버전 및 업데이트 상태
- 집계 이력
- 중앙 검토용 썸네일
- `case_reference_id`
- 비식별 QA 메트릭
- delta 중앙 저장 경로 및 무결성 정보

중앙에 남기지 않는 정보:

- 원본 이미지
- 환자 ID
- visit_date
- 로컬 원본 파일 경로

### 6. 실행/검증 메모

- `scripts/setup_local_node.ps1`는 `bcrypt` health check를 포함하도록 보강되었습니다.
- 주요 HTTP 테스트는 `tests/test_api_http.py` 기준으로 통과 상태입니다.

권장 검증 명령:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_api_http
```

## 주요 API 범위

README에는 현재 자주 쓰는 범위만 정리합니다.

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
- `POST /api/sites/{site_id}/cases/validate`
- `POST /api/sites/{site_id}/cases/contribute`
- `GET /api/sites/{site_id}/cases/roi-preview`
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

## 테스트

현재 저장소에는 주요 HTTP 워크플로우를 검증하는 테스트가 포함되어 있습니다.

```powershell
python -m unittest tests.test_api_http
```

포함 범위:

- 로그인
- 접근 요청 승인
- 케이스 validation / contribution
- 저장 경로 설정 / 마이그레이션
- initial training
- cross-validation
- bulk import
- aggregation
- 운영 API 일부

## 현재 한계와 주의사항

현재 코드 기준으로 아래 사항은 문서에 남겨둘 필요가 있습니다.

- 학습, validation, aggregation은 백그라운드 worker 없이 API 요청에서 동기 실행됩니다.
- `site_jobs` 테이블 구조는 있으나, 별도 작업 큐 실행기는 연결되어 있지 않습니다.
- MedSAM은 로컬 스크립트와 체크포인트가 준비되면 사용하고, 그렇지 않으면 fallback ROI 경로에 의존합니다.
- 프런트엔드 실행 스크립트는 개발 서버(`next dev`) 기준입니다.
- 배포용 인증, 비밀 관리, 감사 로깅, 장애 복구는 연구용 로컬 노드 수준으로만 구성되어 있습니다.

## 관련 문서

- [local_node_deployment.md](docs/local_node_deployment.md)
- [react_migration_checklist.md](docs/react_migration_checklist.md)
- [dataset_schema.md](docs/dataset_schema.md)
