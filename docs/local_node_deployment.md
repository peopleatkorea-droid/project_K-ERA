# Local Node 배포 가이드

## 목적

K-ERA는 중앙 SaaS와 병원 내부 Local Node를 분리해 운영하는 것을 권장합니다.

- 중앙 SaaS: 프로젝트, 사용자, 모델 버전, 검증 통계 관리
- Local Node: 이미지 저장, AI 추론, MedSAM, Grad-CAM, 로컬 fine-tuning 실행

임상의 또는 연구자는 브라우저만 사용하고, Python 설치나 `pip install`은 병원 IT 또는 설치 담당자가 처리하는 구조를 목표로 합니다.

## 왜 Local Node가 필요한가

- 원본 슬릿램프 이미지는 병원 내부에만 저장해야 함
- PyTorch, CUDA, MedSAM 같은 AI 의존성은 사용자 PC마다 직접 설치시키면 운영이 어려움
- 외부 검증과 로컬 학습은 병원 내부 GPU 워크스테이션 또는 서버에서 실행하는 편이 안정적임

## 권장 운영 방식

### 1. 중앙 SaaS

- 클라우드 또는 기관 중앙 서버
- 프로젝트 관리
- 사용자 인증
- 모델 버전 관리
- 검증 통계 저장
- 모델 업데이트 저장

### 2. 병원별 Local Node

- 병원 내부 Windows 워크스테이션 또는 서버
- `.venv` 기반 Python 실행 환경
- PyTorch/FastAPI/Next.js 실행 환경 설치
- 이미지 로컬 저장소 접근
- 브라우저로 내부 사용자 접속

## 설치 담당자용 기본 절차

프로젝트 루트에서 아래만 실행하면 됩니다.

```powershell
.\scripts\configure_local_node.ps1 `
  -ControlPlaneDatabaseUrl "postgresql://<neon-user>:<password>@<host>/<db>?sslmode=require" `
  -StorageDir "D:\KERA_DATA" `
  -SharedRoot "C:\Users\USER\OneDrive - 제주대학교\KERA model" `
  -CaseReferenceSalt "<shared-case-reference-salt>" `
  -GoogleClientId "<google-client-id>" `
  -HiraApiKey "<hira-api-key>" `
  -OneDriveTenantId "<entra-tenant-id>" `
  -OneDriveClientId "<graph-client-id>" `
  -OneDriveClientSecret "<graph-client-secret>" `
  -OneDriveDriveId "<sharepoint-drive-id>" `
  -OneDriveRootPath "KERA model"

.\scripts\setup_local_node.ps1
.\scripts\run_local_node.ps1
```

첫 번째 스크립트는 중앙/로컬 경로 체계를 자동으로 `.env.local`에 맞춥니다.

- `KERA_CONTROL_PLANE_DATABASE_URL`
- `KERA_DATA_PLANE_DATABASE_URL`
- `KERA_STORAGE_DIR`
- `KERA_CONTROL_PLANE_DIR`
- `KERA_CONTROL_PLANE_ARTIFACT_DIR`
- `KERA_MODEL_DIR`
- `KERA_MODEL_DISTRIBUTION_MODE`
- `KERA_CASE_REFERENCE_SALT`
- `KERA_ONEDRIVE_TENANT_ID`
- `KERA_ONEDRIVE_CLIENT_ID`
- `KERA_ONEDRIVE_CLIENT_SECRET`
- `KERA_ONEDRIVE_DRIVE_ID`
- `KERA_ONEDRIVE_ROOT_PATH`

이때 `SharedRoot` 아래에는 자동으로 다음 경로가 생성됩니다.

- `control_plane`
- `control_plane\artifacts`
- `models`

중요:

- 모든 병원 노드는 같은 `ControlPlaneDatabaseUrl`을 사용해야 합니다.
- 모든 병원 노드는 같은 `CaseReferenceSalt`를 사용해야 합니다.
- `download_url` 배포를 자동화하려면 모든 노드가 같은 `KERA_ONEDRIVE_*` 읽기 설정을 가져야 합니다.
- `StorageDir`만 병원별 로컬 경로로 다르게 두면 됩니다.

두 번째 스크립트는 다음을 자동 처리합니다.

- 가상환경 생성
- 필수 패키지 설치
- NVIDIA GPU 감지 후 CPU/GPU torch 프로필 자동 선택
- 기본 health check 수행

세 번째 스크립트는 Local Node 앱을 실행합니다.

## 중앙 로그인 DB 분리

여러 기관이 같은 로그인/권한 체계를 공유해야 한다면 Local Node마다 별도 계정을 두기보다 중앙 control plane DB를 두는 편이 낫습니다.

- `KERA_CONTROL_PLANE_DATABASE_URL`: 중앙 Postgres/Neon 권장
- `KERA_CONTROL_PLANE_ARTIFACT_DIR`: 중앙 서버 또는 공유 스토리지 권장
- `KERA_DATA_PLANE_DATABASE_URL`: 병원 내부 SQLite 또는 병원 내부 DB 권장

이 구성을 사용하면 아래처럼 분리됩니다.

- 중앙 DB: `users`, `access_requests`, `projects`, `sites`, `model_versions`, `model_updates`, `aggregations`
- 병원 로컬 DB: `patients`, `visits`, `images`, `site_patient_splits`, `site_jobs`

기여 검토가 여러 PC에서 필요하다면 원본 이미지를 중앙으로 보내는 대신, 저해상도 review thumbnail만 중앙 `model_updates` payload에 포함시키는 구성이 적절합니다. 이렇게 하면 같은 병원 또는 중앙 관리자가 다른 PC에서 접속해도 기여 썸네일을 확인할 수 있습니다.
weight delta는 중앙 artifact 경로로 복사한 뒤 그 경로를 기준으로 집계하는 구성이 안정적입니다. 이렇게 하면 로컬 PC의 원본 delta 파일이 삭제되거나 오프라인이어도 중앙 집계가 가능합니다.

환경변수를 따로 주지 않으면 단일 DB를 계속 사용하며, 기본 경로는 `앱 폴더의 상위 디렉토리\\KERA_DATA\\kera.db`입니다.

## GPU 환경에서의 설치

기본 스크립트는 아래 프로필을 사용합니다.

- `requirements.txt`: torch 제외 공통 패키지
- `requirements-cpu.txt`: CPU용 torch/torchvision
- `requirements-gpu-cu128.txt`: CUDA 12.8용 torch/torchvision

기본값은 `-TorchProfile auto`이며, `nvidia-smi`로 NVIDIA GPU를 감지하면 GPU 프로필을 설치하고 아니면 CPU 프로필을 설치합니다.

```powershell
.\scripts\setup_local_node.ps1
```

설치 담당자가 프로필을 명시적으로 고정할 수도 있습니다.

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile cpu
.\scripts\setup_local_node.ps1 -TorchProfile gpu
```

기관 GPU 정책상 특정 PyTorch wheel index가 필요하다면 설치 담당자가 아래처럼 실행할 수 있습니다.

```powershell
.\scripts\setup_local_node.ps1 -TorchProfile gpu -TorchIndexUrl "<GPU용 torch index url>"
```

## 임상의 사용자 경험 원칙

- 임상의에게 `pip install`, `torch`, `CUDA` 같은 메시지를 직접 보여주지 않음
- AI 기능이 아직 준비되지 않았을 때는:
  - 데이터 입력은 계속 가능
  - AI 검증 기능은 준비 중
  - 설치 담당자에게 문의 필요
  정도만 표시

## 향후 권장 고도화

- Windows Installer (`.msi`) 또는 배포 패키지 제공
- 병원 IT용 무인 설치 옵션
- 설치 후 자동 self-check
- 서비스형 실행으로 백그라운드 부팅 자동화
- 중앙 SaaS에서 Local Node 상태를 원격 확인하는 health ping
