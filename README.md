# K-ERA Research Platform

감염성 각막염(infectious keratitis) 연구를 위한 데이터셋 운영, 외부 검증, 로컬 학습, Federated Learning 집계를 지원하는 연구 플랫폼입니다.

이 저장소에는 현재 웹 기반 Local Node가 기본 실행 경로로 들어 있습니다.

- `FastAPI + Next.js Web Local Node`: 연구자/임상의가 병원 내부에서 직접 사용하는 주 실행 앱

중요: 이 프로젝트는 연구 워크플로우용이며, 임상 진단/치료 의사결정용 의료기기가 아닙니다.

## 1. 앱의 목적

이 앱의 목적은 다음 4가지를 하나의 연구 워크플로우로 묶는 것입니다.

1. 병원 내부 원본 슬릿램프 이미지를 외부 반출 없이 구조화해 저장
2. 케이스 단위 또는 사이트 전체 단위로 글로벌 모델 외부 검증 수행
3. 로컬 데이터로 fine-tuning 후 weight delta만 중앙에 기여
4. 여러 기관의 delta를 weighted FedAvg로 집계해 새 글로벌 모델 생성

즉, "원본 이미지는 병원 내부에 남기고, 중앙에는 메타데이터/지표/모델 업데이트만 전달"하는 구조를 목표로 합니다.

## 2. 현재 구현 상태 요약

2026-03 기준, 코드상 구현 상태는 아래와 같습니다.

### Web Local Node

- 문서형 `Case Canvas` 구현 완료
- 환자/방문/이미지 등록 구현
- 케이스 단위 validation / ROI preview / Grad-CAM 확인 구현
- 사이트 전체 external validation 구현
- 데이터 일괄 임포트 구현
- 초기 학습(initial training) 구현
- 환자 단위 cross-validation 구현
- Federated aggregation 구현
- 사이트/프로젝트/사용자 관리 화면 구현

### FastAPI + Next.js Web

- JWT 로그인 구현
- Google Sign-In 기반 연구자 온보딩 구현
- 기관/역할 접근 요청(access request) 제출 및 승인 구현
- 사이트별 요약 조회 구현
- 환자/방문/이미지/케이스 요약 API 구현
- 저장된 케이스 단위 validation / ROI preview / contribution API 구현
- validation artifact, ROI artifact, case history, site activity API 구현
- 사이트 전체 external validation 실행 및 최근 metric 조회 API 구현
- Next.js 웹 UI는 인증, 승인 요청, 승인 큐, 문서형 케이스 캔버스, 저장된 케이스 검증/ROI preview/기여/히스토리 조회까지 연결됨

### 아직 진행 중인 부분

- 학습/집계 작업은 현재 동기식 실행이며 별도 worker/job runner는 연결되지 않았습니다.
- MedSAM은 외부 스크립트가 설정되면 실제 호출하고, 아니면 fallback ROI를 생성합니다.
- Streamlit 기반 레거시 UI 소스는 제거되었고, 기본 실행 경로는 FastAPI + Next.js만 사용합니다.

### 2026-03-11 웹 마이그레이션 업데이트

오늘 기준으로 웹 스택 쪽에 아래 항목이 추가되었습니다.

- Notion 스타일에 가까운 `Case Canvas` 도입
- 환자/방문/이미지 입력을 문서형 화면에서 인라인 편집으로 처리
- 브라우저 로컬 기반 draft autosave / 복구
- 저장된 케이스에 대한 ROI preview
- 저장된 케이스에 대한 validation 실행과 Grad-CAM / ROI artifact 확인
- 저장된 케이스에 대한 contribution 실행과 기여 통계 확인
- selected case 기준 validation / contribution history 조회
- 웹 워크스페이스에서 site-level validation 실행 및 최근 run 확인
- 사이트 단위 recent activity / pending update 요약
- 로그인/승인 화면을 워크스페이스와 같은 다크 톤으로 정리
- 웹 UI 한/영(i18n) 토글 추가
- 로그인/승인 화면과 주요 Case/Operations Workspace 헤더/상태 문구를 한/영으로 전환 가능
- 2차 i18n으로 운영 화면 세부 폼 라벨, 대시보드/히스토리 패널, 주요 오류 토스트까지 한/영 전환 범위를 확대
- legacy 콘솔은 admin 전용 fallback으로 제한
- selected case validation 결과에 confidence 게이지와 상태 배지 추가
- admin/site_admin용 `Operations Workspace` 추가
- 웹에서 access request review, initial training, cross-validation, model registry, federated aggregation 실행 가능
- FastAPI에 model registry / model update / aggregation / training endpoint 추가
- `tests/test_api_http.py`에 access review, validation, contribution, training, aggregation HTTP 테스트 추가
- 웹 `Operations Workspace`에 bulk import, project/site/user 관리, 고급 validation 비교, misclassification review 추가
- FastAPI에 bulk import, admin project/site/user 관리, site comparison, validation case listing endpoint 추가
- `run_local_node.ps1` 기본 런처가 Streamlit 대신 FastAPI + Next.js 두 프로세스를 올리도록 변경
- 기본 실행 경로에서 Streamlit fallback/legacy 콘솔 제거

즉, 웹 UI는 더 이상 "승인용 보조 콘솔" 수준이 아니라, 실제 임상 입력과 운영 관리의 기본 경로가 되었습니다. 현재 기본 런처와 기본 사용자 흐름은 모두 FastAPI + Next.js 기준입니다.

## 3. 전체 구조

```text
[병원 내부 Local Node]
  Next.js UI
  FastAPI API
  SQLite/PostgreSQL 메타데이터 저장
  원본 이미지 저장
  MedSAM / Grad-CAM / PyTorch 학습

            │
            │ weight delta / 집계 메타데이터
            ▼

[중앙 Control Plane 논리]
  프로젝트 / 사이트 / 모델 버전 / 기여 / 집계 이력 관리
```

현재 저장소는 단일 리포지토리 안에 Local Node와 중앙 Control Plane 로직을 함께 담고 있습니다.

## 4. 주요 사용자 흐름

### 4.1 Web Case Canvas

현재 웹 앱의 핵심 입력 흐름은 문서형 Case Canvas와 우측 슬라이드오버 패널입니다.

```text
[1] 환자/방문 속성 입력 → [2] 이미지 업로드 → [3] 저장 → [4] 검증 → [5] 시각화 → [6] 기여 → [7] 완료
```

각 단계에서 가능한 일:

| 단계 | 구현 내용 |
|------|-----------|
| 1. 환자 | 기존 환자 검색, 신규 환자 등록, 이전 방문 타임라인 확인 |
| 2. 방문 | culture 정보, 균종, contact lens, predisposing factor, visit status, smear 결과 입력 |
| 3. 이미지 | 다중 이미지 업로드, `view` 지정, 대표 이미지 선택 |
| 4. 검증 | 글로벌 모델 선택, CPU/GPU/Auto 실행, 단일 케이스 즉시 추론 |
| 5. 시각화 | 원본 이미지, MedSAM ROI crop, Grad-CAM 결과 비교 |
| 6. 기여 | 로컬 fine-tuning 후 weight delta 생성 및 기여 |
| 7. 완료 | 기여 결과와 통계 확인 |

### 4.2 Web Dashboard

웹 대시보드에는 다음이 포함됩니다.

- 사이트별 환자/방문/활성기 방문 수
- 고정 patient split 현황
- 사이트 전체 external validation 실행
- 최신 validation AUROC / Accuracy / Sensitivity / Specificity / F1 확인
- 최근 validation 이력 및 데이터 분포 확인

### 4.3 Operations Workspace

현재 운영 화면은 실제 코드 기준으로 다음 탭을 가집니다.

#### `admin` 권한

1. 데이터 임포트
2. 초기 학습
3. Cross-Validation
4. 모델 관리
5. 사이트 관리
6. 균종 관리
7. 사용자 권한
8. Federated 집계

#### `site_admin` 권한

- 데이터 임포트
- 초기 학습
- Cross-Validation
- 모델 관리
- 사이트 관리(조회 중심)

## 5. 웹/API 스택 구현 범위

README에 기존에 잘 드러나지 않았던 부분입니다. 이 저장소에는 별도 웹 스택이 포함되어 있습니다.

### FastAPI API

구현된 주요 엔드포인트:

- `/api/health`
- `/api/public/sites`
- `/api/auth/login`
- `/api/auth/google`
- `/api/auth/me`
- `/api/auth/access-requests`
- `/api/auth/request-access`
- `/api/admin/access-requests`
- `/api/admin/access-requests/{request_id}/review`
- `/api/sites`
- `/api/sites/{site_id}/summary`
- `/api/sites/{site_id}/activity`
- `/api/sites/{site_id}/cases`
- `/api/sites/{site_id}/validations`
- `/api/sites/{site_id}/validations/run`
- `/api/sites/{site_id}/cases/validate`
- `/api/sites/{site_id}/cases/contribute`
- `/api/sites/{site_id}/cases/roi-preview`
- `/api/sites/{site_id}/cases/roi-preview/artifacts/{artifact_kind}`
- `/api/sites/{site_id}/cases/history`
- `/api/sites/{site_id}/patients`
- `/api/sites/{site_id}/visits`
- `/api/sites/{site_id}/images`
- `/api/sites/{site_id}/images/representative`
- `/api/sites/{site_id}/images/{image_id}/content`
- `/api/sites/{site_id}/validations/{validation_id}/artifacts/{artifact_kind}`
- `/api/sites/{site_id}/manifest.csv`

### Next.js 웹 프론트엔드

현재 웹 UI에서 가능한 일:

- Google 계정 로그인
- 로컬 관리자 계정 로그인
- 기관/역할 접근 요청 제출
- 승인 상태 확인
- 관리자/사이트 관리자의 접근 요청 승인/반려
- 접근 가능한 사이트 목록 확인
- 사이트 요약 지표 조회
- 사이트 activity 요약 조회
- 문서형 케이스 캔버스에서 환자/방문/이미지 작성
- 브라우저 로컬 draft 복구
- 저장된 케이스 이미지 확인
- 저장된 케이스 ROI preview
- 저장된 케이스 validation 실행 및 artifact 확인
- 저장된 케이스 contribution 실행
- selected case 기준 validation / contribution history 확인
- site-level validation 실행 및 최근 run 확인
- manifest CSV 다운로드

즉, 웹 UI가 이미 케이스 입력과 검토, 운영 관리의 기본 경로를 담당합니다.

## 6. 인증과 권한

### 현재 지원 권한

- `admin`
- `site_admin`
- `researcher`
- `viewer`

### 인증 방식

- Web: 로컬 username/password + Google Sign-In

### 로컬 계정 시드

- 로컬 username/password 계정은 환경변수로 지정했을 때만 시드됩니다.
- 예: `KERA_ADMIN_USERNAME`, `KERA_ADMIN_PASSWORD`
- 연구자 계정도 필요하면 `KERA_RESEARCHER_USERNAME`, `KERA_RESEARCHER_PASSWORD`를 지정합니다.

### Google 온보딩 흐름

1. 사용자가 Google 계정으로 로그인
2. 기본 권한은 `viewer` 상태로 생성
3. 기관(site)과 역할(role) 접근 요청 제출
4. `admin` 또는 해당 사이트의 `site_admin`이 승인/반려
5. 승인 후 사이트 접근 가능

## 7. 데이터 저장 구조

현재 구현은 "JSON 파일 중심"이 아니라 "SQLAlchemy 기반 DB + 아티팩트 파일" 구조입니다.

### 기본 DB

- 기본 DB: `storage/kera.db` (SQLite)
- 환경변수 `KERA_DATABASE_URL` 또는 `DATABASE_URL`로 다른 DB 사용 가능
- `requirements.txt`에 `psycopg2-binary`가 포함되어 있어 PostgreSQL 연결도 고려한 구조입니다

### DB에 저장되는 주요 엔터티

- users
- access_requests
- projects
- sites
- organism_catalog
- organism_requests
- patients
- visits
- images
- validation_runs
- model_versions
- model_updates
- contributions
- aggregations
- site_patient_splits
- site_jobs

### 파일로 저장되는 주요 아티팩트

```text
storage/
  kera.db
  control_plane/
    validation_cases/
      <validation_id>.json
  sites/<site_id>/
    data/raw/<patient_id>/<visit_date>/*
    manifests/dataset_manifest.csv
    artifacts/gradcam/*
    artifacts/medsam_masks/*
    artifacts/roi_crops/*
    validation/<cross_validation_id>.json
    model_updates/*
```

## 8. 연구 데이터 스키마

### 환자 정보

- `patient_id`
- `sex`
- `age`
- `chart_alias`
- `local_case_code`

### 방문 정보

기존 README보다 실제 구현 필드가 더 많습니다.

- `visit_date`
- `culture_confirmed`
- `culture_category`
- `culture_species`
- `contact_lens_use`
- `predisposing_factor`
- `visit_status`
  - `active`
  - `improving`
  - `scar`
- `active_stage`
- `smear_result`
  - `not done`
  - `positive`
  - `negative`
  - `unknown`
  - `other`
- `polymicrobial`
- `other_history`

### 이미지 정보

- `view`
  - `white`
  - `slit`
  - `fluorescein`
- `is_representative`
- `image_path`

### Manifest 컬럼

현재 manifest는 최소 컬럼보다 확장된 형태로 생성됩니다.

- `site_id`
- `patient_id`
- `chart_alias`
- `local_case_code`
- `sex`
- `age`
- `visit_date`
- `culture_confirmed`
- `culture_category`
- `culture_species`
- `contact_lens_use`
- `predisposing_factor`
- `visit_status`
- `active_stage`
- `other_history`
- `smear_result`
- `polymicrobial`
- `view`
- `image_path`
- `is_representative`

자세한 설명은 [docs/dataset_schema.md](docs/dataset_schema.md)를 참고하면 됩니다.

## 9. 데이터 입력/임포트 규칙

### 단일 케이스 입력

- 웹 Case Canvas에서 환자 → 방문 → 이미지 순으로 등록
- 방문이 먼저 있어야 이미지 업로드 가능
- `culture_confirmed = true`인 case만 허용

### 일괄 임포트

관리자 패널의 데이터 임포트 기능에서 지원합니다.

- CSV 템플릿 다운로드 가능
- ZIP 이미지 또는 개별 이미지 파일 업로드 가능
- CSV의 `image_filename`과 실제 업로드 파일명을 매칭
- 환자/방문이 없으면 자동 생성 후 이미지 적재

CSV 템플릿에는 다음 확장 컬럼이 포함됩니다.

- `chart_alias`
- `local_case_code`
- `visit_status`
- `active_stage`
- `smear_result`
- `polymicrobial`
- `other_history`

## 10. 지원 모델 및 AI 기능

### 지원 아키텍처

| 아키텍처 | 상태 | 특징 |
|----------|------|------|
| CNN baseline | 구현됨 | 경량 baseline, raw image 사용 |
| ViT baseline | 구현됨 | 경량 baseline, raw image 사용 |
| Swin baseline | 구현됨 | 경량 baseline, raw image 사용 |
| DenseNet121 | 구현됨 | MedSAM crop 필수 |
| DenseNet161 | 구현됨 | MedSAM crop 필수 |
| DenseNet169 | 구현됨 | MedSAM crop 필수 |
| DenseNet201 | 구현됨 | MedSAM crop 필수 |

### DenseNet 체크포인트 로딩

기존 `.pth`를 유연하게 읽도록 구현되어 있습니다.

- 일반 `state_dict`
- `module.` prefix
- `model.` prefix
- `state_dict` key 래핑
- `model_state_dict` key 래핑
- `weights` key 래핑

DenseNet 글로벌 모델 파일이 `models/`에 없으면 모델 버전은 등록되지만 `ready: false` 상태가 됩니다.

### 구현된 AI 작업

- 단일 이미지 추론
- 단일 케이스 validation
- 사이트 전체 external validation
- Grad-CAM / CAM 기반 설명 생성
- MedSAM ROI crop 생성
- 초기 학습(initial training)
- 환자 단위 cross-validation
- 로컬 fine-tuning
- weight delta 저장
- weighted FedAvg aggregation

## 11. MedSAM 동작 방식

### 외부 MedSAM 연결

아래 환경변수가 설정되어 있고 실제 파일이 존재하면 외부 MedSAM 스크립트를 호출합니다.

- `MEDSAM_SCRIPT`
- `MEDSAM_CHECKPOINT`

기본 탐색 위치:

- `scripts/medsam_auto_roi.py`
- `MedSAM-main/work_dir/MedSAM/medsam_vit_b.pth`

### fallback 동작

외부 MedSAM이 없거나 실행 실패 시:

- 중심부 타원형 mask를 생성
- 그 영역을 crop해서 ROI로 사용

따라서 MedSAM 환경이 없어도 전체 워크플로우 자체는 테스트할 수 있습니다.

## 12. 학습 기능

### 초기 학습

구현 내용:

- DenseNet 계열 학습
- ImageNet pretrained 백본 사용 가능
- patient-level split 고정 저장
- train/val/test 분리
- augmentation 적용
- class imbalance weight 적용
- cosine annealing scheduler 사용
- best validation accuracy 기준 저장
- test set metric 계산
- 완료 후 글로벌 모델 버전 자동 등록

### Cross-Validation

README에 누락되어 있었지만 실제 구현되어 있습니다.

- patient-level fold 기준
- StratifiedKFold 가능 시 사용
- fold별 모델 저장
- 평균/표준편차 metric 계산
- 결과 JSON 리포트 저장

### Federated Learning

현재 구현된 흐름:

1. 각 사이트가 로컬 fine-tuning 실행
2. base model 대비 weight delta 저장
3. 중앙 관리자가 pending delta 목록 확인
4. weighted FedAvg 수행
5. 새 글로벌 모델 버전 등록
6. 기존 pending update 상태를 `aggregated`로 변경

## 13. 실행 모드

### Web Local Node

권장 실행:

```powershell
.\scripts\setup_local_node.ps1
.\scripts\run_local_node.ps1
```

`setup_local_node.ps1`는 기본적으로 하드웨어를 감지해 CPU/GPU torch 프로필을 자동 선택합니다.

### FastAPI API 서버

```powershell
.\scripts\run_api_server.ps1
```

기본 주소:

- `http://localhost:8000`

### Next.js 웹 프론트엔드

```powershell
.\scripts\run_web_frontend.ps1
```

기본 주소:

- `http://localhost:3000`

`run_web_frontend.ps1`는 `node_modules`가 없으면 자동으로 `npm install`을 수행합니다.

## 14. CPU / GPU 동작

앱은 하드웨어를 자동 감지합니다.

| 선택 | 실제 장치 결정 |
|------|----------------|
| `Auto` | CUDA 가능 시 `cuda`, 아니면 `cpu` |
| `CPU mode` | 항상 `cpu` |
| `GPU mode` | CUDA 가능 시 `cuda`, 아니면 `cpu`로 fallback |

일부 학습 로직은 CPU일 때 더 짧은 epoch 또는 제한된 fine-tuning 전략을 사용합니다.

### 설치 프로필

로컬 설치 스크립트는 배포 안정성을 위해 torch 의존성을 CPU/GPU 프로필로 분리합니다.

- `requirements.txt`: torch를 제외한 공통 애플리케이션 패키지
- `requirements-cpu.txt`: CPU용 torch/torchvision
- `requirements-gpu-cu128.txt`: CUDA 12.8용 GPU torch/torchvision

기본 설치:

```powershell
.\scripts\setup_local_node.ps1
```

- NVIDIA GPU가 감지되면 GPU 프로필을 설치
- GPU가 없으면 CPU 프로필을 설치

강제 설치 예시:

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile cpu
.\scripts\setup_local_node.ps1 -TorchProfile gpu
```

기관 정책상 별도 PyTorch index가 필요하면 GPU 프로필에만 아래 옵션을 추가합니다.

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile gpu -TorchIndexUrl "<GPU용 torch index url>"
```

## 15. 폴더 구조

```text
project_K-ERA/
├── app.py
├── README.md
├── requirements.txt
├── requirements-cpu.txt
├── requirements-gpu-cu128.txt
├── frontend/
│   ├── app/page.tsx
│   └── lib/api.ts
├── src/kera_research/
│   ├── api/app.py
│   ├── db.py
│   ├── config.py
│   ├── domain.py
│   └── services/
│       ├── artifacts.py
│       ├── control_plane.py
│       ├── data_plane.py
│       ├── hardware.py
│       ├── modeling.py
│       ├── pipeline.py
│       └── runtime.py
├── scripts/
│   ├── setup_local_node.ps1
│   ├── run_local_node.ps1
│   ├── run_api_server.ps1
│   ├── run_web_frontend.ps1
│   └── medsam_auto_roi.py
├── docs/
│   ├── dataset_schema.md
│   └── local_node_deployment.md
└── storage/
    ├── kera.db
    ├── control_plane/
    └── sites/
```

## 16. 빠른 시작

### 웹 Local Node로 바로 확인하기

1. Local Node 설치

```powershell
.\scripts\setup_local_node.ps1
```

2. API + 프론트 동시 실행

```powershell
.\scripts\run_local_node.ps1
```

3. 로그인 후 순서

- 프로젝트 생성
- 사이트 등록
- 기관/역할 승인 또는 관리자 로그인
- 새 케이스 입력
- 이미지 업로드
- validation / ROI preview / misclassification review 확인
- contribution 또는 운영 작업 실행

### 웹 스택까지 같이 확인하기

1. API 서버 실행

```powershell
.\scripts\run_api_server.ps1
```

2. 프론트엔드 실행

```powershell
.\scripts\run_web_frontend.ps1
```

3. 브라우저에서 `http://localhost:3000` 접속

## 17. 문서에 새로 반영한 구현 항목

기존 README에 비해 이번에 반영한 핵심 구현 항목은 다음과 같습니다.

- FastAPI + Next.js 웹 스택 존재
- Google 로그인 및 기관 승인 워크플로우
- SQLAlchemy 기반 DB 저장 구조
- 환자/방문 스키마의 확장 필드
- 관리자 패널의 실제 탭 수(교차검증, 사용자 권한 포함)
- patient-level cross-validation
- 사이트 전체 external validation
- 사용자/권한 관리
- API 실행 스크립트와 웹 프론트엔드 실행 스크립트

## 18. 한계와 다음 단계

- 웹 프론트엔드가 현재 기본 운영 UI입니다.
- 별도 worker/job queue, audit log, 더 세분화된 권한 체계는 후속 작업이 필요합니다.
- Streamlit 레거시 UI 소스는 제거되었고, 현재 앱은 FastAPI + Next.js만 사용합니다.
- 실제 운영 전에는 IRB, 보안, 접근통제, 익명화 정책을 별도로 검토해야 합니다.
