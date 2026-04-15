# K-ERA Research Platform

감염성 각막염(infectious keratitis) 연구를 위한 다기관 연합학습 플랫폼입니다. 병원 내부에서 케이스 등록, AI 검증, 로컬 학습, 기여, 연합 집계를 하나의 웹 앱 안에서 수행할 수 있습니다.

> **중요:** 이 프로젝트는 연구 워크플로우용 소프트웨어이며, 임상 진단 또는 치료 의사결정용 의료기기가 아닙니다.
>
> **변경 정책:** UX/UI 변경(랜딩 화면, 레이아웃, 카피, 로그인 흐름, 정보 우선순위 포함)은 프로젝트 소유자의 명시적 승인 없이 구현하지 않습니다. 리팩토링은 기본적으로 기존 UX를 보존해야 합니다.

---

## 이 프로젝트를 어떻게 쓰나

K-ERA는 현재 아래 두 화면을 함께 쓰는 구조입니다.

1. **웹 포털 (`k-era.org`)**
   - Google 로그인
   - 기관 접근 요청 / 승인
   - 운영자 승인 처리
   - 데스크톱 설치본 다운로드
2. **Windows 데스크톱 앱**
   - 환자 이미지 업로드
   - 저장된 환자 목록 보기
   - 케이스 작성 / 검토 / 분석
   - 병원 PC 안에서 실제 연구 작업 수행

즉, **웹은 계정과 접근 관리 중심**, **실제 환자 케이스 작업은 데스크톱 앱 중심**으로 이해하면 됩니다.

### 어떤 사람이 무엇을 보면 되나

- **의료진 / 연구자**: 아래 `의료진 / 연구자용 빠른 시작`
- **운영자 / 관리자**: 아래 `운영자용 배포 절차`
- **개발자 / 기술 담당자**: 아래 `개발자 / 운영 담당자용 실행 방법`

---

## 의료진 / 연구자용 빠른 시작

### 처음 사용하는 사용자

1. `k-era.org`에 접속합니다.
2. Google 계정으로 로그인합니다.
3. 소속 병원을 검색하고 접근 요청을 제출합니다.
4. 승인되면 바로 다음 단계로 넘어갑니다.
5. 웹 화면에 데스크톱 설치 버튼이 보이면 앱을 설치합니다.
6. 이후 실제 환자 케이스 작업은 데스크톱 앱에서 진행합니다.

### 웹에서 할 수 있는 일

- 내 계정 승인 상태 확인
- 병원 접근 요청 제출
- 운영자 화면 접근
- 데스크톱 설치본 다운로드

### 데스크톱 앱에서 할 수 있는 일

- 저장된 환자 목록 보기
- 방문별 이미지 확인
- 새 케이스 저장
- AI 분석 / 검토 / 기여
- 연구용 로컬 학습과 연합학습 참여

### 꼭 알아둘 점

- `k-era.org`는 **환자 케이스를 직접 여는 메인 작업 화면이 아닙니다.**
- 환자 케이스 작업은 **데스크톱 앱**에서 진행하는 것이 현재 기본 운영 방식입니다.
- 웹 포털에서 보이는 설치 버튼은 승인된 사용자가 데스크톱 앱으로 넘어가도록 돕는 용도입니다.

---

## 운영자용 배포 절차

### 현재 권장 설치본

- **Windows CPU 설치본**
- 형식: **NSIS current-user installer**
- 일반 사용자 권한으로 설치 가능

### 설치본 용량

- 현재 CPU 설치본 파일 크기: 약 `940 MB`
- 설치 후 첫 실행까지 포함한 디스크 사용량: 대략 `2.3 GB`

### 현재 배포 방식

- 승인된 사용자가 `k-era.org`에 로그인
- 병원을 선택
- 웹 포털에서 데스크톱 설치 버튼 클릭
- 외부 저장소(현재는 OneDrive)에 올린 설치 파일로 이동

### 새 버전 배포 순서

1. 새 Windows CPU 설치본을 빌드합니다.
2. OneDrive 같은 외부 저장소에 업로드합니다.
3. `k-era.org`의 운영자 화면에서 `데스크톱 설치본 관리`로 들어갑니다.
4. 아래 항목을 등록하고 활성화합니다.
   - 버전
   - 설치 파일 URL
   - SHA256
   - 파일 크기
   - 메모

즉, **버전이 바뀔 때마다 Vercel 환경변수를 다시 수정할 필요는 없습니다.**

### 현재 OneDrive 방식의 한계

- 링크를 아는 사람은 접근할 수 있습니다.
- 따라서 현재 웹 포털은 “설치 링크를 보여주고 기록을 남기는 문” 역할입니다.
- 더 강한 다운로드 통제가 필요해지면 `R2/S3/Azure Blob + signed URL` 구조로 옮기는 것이 좋습니다.

---

## 제품 구성 요약

### 웹 포털

- 계정 로그인
- 기관 승인
- 운영자 기능
- 설치본 배포

### 데스크톱 앱

- 환자별 저장 기록 관리
- 이미지 업로드 및 검토
- 케이스 작성
- AI 분석
- 연구 기여

### 중앙 서버가 하는 일

- 사용자 / 권한 / 병원 접근 관리
- 모델 버전 관리
- 연합학습 집계 기록 관리
- 데스크톱 설치본 배포 정보 관리

### 병원 PC가 하는 일

- 환자 메타데이터 저장
- 방문 정보 저장
- 원본 이미지와 파생 이미지 저장
- 실제 케이스 작업 실행

---

## 연구 기능 요약

### 기본 분석 구성

- **주 분석 모델**: `EfficientNetV2-S MIL (full)`
- **보조 이미지 모델**: `ConvNeXt-Tiny (full)`
- **유사 증례 검색**: `DINOv2 lesion-crop retrieval`

### 현재 연구 정책

- 모든 사용자는 케이스를 저장하고 분석할 수 있습니다.
- 배양 상태는 `positive / negative / not_done / unknown`을 사용합니다.
- 연합학습 기여와 연구 registry 포함은 아래 조건을 모두 만족할 때만 허용합니다.
  - `positive`
  - `active`
  - `images > 0`
  - `research registry consent`
  - `registry included`

### 현재 한계

- Poisson subsampling을 반영하는 Gaussian RDP accountant와 누적 budget snapshot은 있습니다. 필요하면 `gaussian_rdp_full_participation` 또는 `gaussian_basic_composition`으로 override할 수 있습니다. 다만 PRV 계열 accountant는 아직 없습니다.
- secure aggregation도 아직 없습니다.
- production/staging 같은 운영 환경에서는 signed federated update가 강제되지 않으면 FL round와 aggregation이 차단됩니다.

운영 절차 초안은 [docs/fl_operation_sop_ko.md](docs/fl_operation_sop_ko.md)를 참고하세요.

---

## 개발자 / 운영 담당자용 실행 방법

아래는 개발/운영 담당자를 위한 실행 경로입니다. 의료진 사용 안내가 아니라 **기술 담당자용**입니다.

### 요구사항

- Windows PowerShell
- Python 3.11
- `uv`
- Node.js / npm

### 1. 개발 환경 준비

```powershell
.\scripts\setup_local_node.ps1
```

이 스크립트는 repo-root `.venv`를 `uv` 기준으로 맞추고, CPU/GPU 프로필과 기본 런타임 검사를 함께 수행합니다.

수동으로 맞추려면:

```powershell
uv venv .venv --python 3.11
uv sync --frozen --extra cpu --extra dev
```

### 2. 환경변수 준비

루트에 `.env.local` 파일을 만들고 `.env.example`을 참고합니다.

최소 예시:

```dotenv
NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL=http://127.0.0.1:8000
KERA_CONTROL_PLANE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/kera_control_plane?sslmode=require
KERA_CONTROL_PLANE_DEV_AUTH=false
KERA_SITE_STORAGE_SOURCE=local
```

### 3. 로컬 실행

```powershell
.\scripts\run_local_node.ps1
```

이 스크립트는 FastAPI와 Next 개발 서버를 함께 띄웁니다.

- 기본 화면(`/`)은 웹 포털/메인 화면입니다.
- 운영/승인 화면은 `/control-plane` 경로에서 확인할 수 있습니다.

개별 실행:

```powershell
.\scripts\run_api_server.ps1
.\scripts\run_web_frontend.ps1
```

### 4. Windows 설치본 빌드

권장 경로:

```powershell
cd .\frontend
npm run desktop:package:cpu:nsis
```

검증:

```powershell
cd .\frontend
npm run desktop:verify-package:nsis
npm run desktop:smoke-installed:cpu:nsis
```

MSI는 별도 관리자 검증 경로로만 유지합니다.

### 5. 데스크톱 앱 개발 실행

```powershell
cd .\frontend
npm run tauri:dev
```

### 6. 런타임 검증

```powershell
.\scripts\run_control_plane_e2e_smoke.ps1
```

이 스크립트는 로그인, 등록, bootstrap, release 조회, 업로드 흐름까지 한 번에 확인합니다.

### 7. 컨테이너 실행

```powershell
docker compose up --build
```

기본 포트:

- web: `http://localhost:3000`
- api: `http://localhost:8000`

### 8. 보안 / 운영 상태 요약

- 로그인 rate limit은 control-plane DB 기반으로 유지됩니다.
- control plane과 data plane 모두 Alembic baseline을 갖고 있습니다.
- API에는 `live`, `ready`, `health`, `metrics` endpoint가 있습니다.
- 선택형 Sentry hook이 있습니다.
- signed federated update가 production/staging runtime에서 강제됩니다.
- 기본값은 `gaussian_rdp_poisson_subsampled` accountant이며, aggregation별 누적 privacy budget 보고에 최신 참여율(`aggregated_site_count / available_site_count`)을 반영합니다. 필요하면 `gaussian_rdp_full_participation` 또는 `gaussian_basic_composition`으로 override할 수 있습니다. 다만 PRV accountant와 secure aggregation은 아직 없습니다.
- admin workspace의 federation 섹션에서는 현재 privacy budget, aggregation별 round accounting, 누적 privacy budget JSON export를 바로 확인할 수 있습니다.
- privacy budget JSON export는 이제 브라우저 조립이 아니라 서버가 생성한 canonical report를 내려받는 방식이고, export 이벤트는 control-plane audit trail에 기록됩니다. audit payload에는 accountant, accountant scope, sampling rate, target delta, 참여 범위까지 같이 남습니다.
- canonical privacy report에는 `report_schema_version`과 `limitations`가 같이 포함됩니다. 따라서 JSON만 봐도 현재 값이 `full_participation bound`, `PRV 미적용`, `secure aggregation 없음` 같은 한계 위에서 나온 숫자인지 바로 확인할 수 있습니다.
- canonical privacy report와 누적 budget snapshot에는 최신 aggregation의 참여 병원 범위(`aggregated_site_count / available_site_count / participation_rate`)와 accountant 가정(`poisson_subsampling` 또는 `full_participation`, `no_secure_aggregation`)이 같이 포함됩니다.
- admin federation 화면에서도 현재 budget과 각 aggregation에 대해 `Coverage`와 `Assumptions`를 직접 보여 주도록 맞췄습니다. 즉, 누적 epsilon/delta 숫자만이 아니라 최근 집계가 몇 개 병원 참여 기준인지와 어떤 accountant 가정으로 계산됐는지를 화면에서 바로 확인할 수 있습니다.
- 필요하면 `KERA_FEDERATED_DP_WARN_EPSILON`, `KERA_FEDERATED_DP_MAX_EPSILON`로 누적 epsilon 가드레일을 걸 수 있습니다. 현재 budget 카드에는 `Budget guardrail` 상태가 보이고, 최대 임계값을 넘길 집계는 서버가 `409`로 차단합니다.
- local/python control-plane fallback도 이제 `audit_events`를 저장합니다. 따라서 web main control-plane뿐 아니라 local admin runtime에서도 privacy report export와 federation monitoring 이력이 `recent_audit_events`에 함께 남습니다.

### 9. 참고: 현재 배포 자동화

- GitHub Actions에는 `desktop-verify`, `desktop-release`, `dependency-audits` workflow가 있습니다.
- 현재 실사용 설치본 배포는 **GitHub Release 자동 배포가 아니라**, 웹 포털의 `데스크톱 설치본 관리`를 통한 DB 기반 활성화가 기준입니다.
- GitHub Actions의 desktop release workflow는 계속 유지되지만, 현재 운영 흐름의 중심은 아닙니다.

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
| `KERA_FEDERATED_UPDATE_SIGNING_SECRET` | weight delta update 서명용 HMAC 비밀값. production/staging multi-site 운영에서는 사실상 필수 |
| `KERA_FEDERATED_UPDATE_SIGNING_KEY_ID` | 서명 키 회전 시 추적용 key id |
| `KERA_REQUIRE_SIGNED_FEDERATED_UPDATES` | `true`면 unsigned federated delta 등록/집계를 거절. production/staging runtime에서는 이 값과 signing secret이 같이 없으면 FL이 차단됨 |
| `KERA_FEDERATED_AGGREGATION_STRATEGY` | `fedavg`, `coordinate_median`, `trimmed_mean` 중 선택 |
| `KERA_FEDERATED_AGGREGATION_TRIM_RATIO` | `trimmed_mean`에서 양 끝을 자를 비율 (기본 `0.2`) |
| `KERA_FEDERATED_DELTA_CLIP_NORM` | site-side delta L2 clipping 임계값 |
| `KERA_FEDERATED_DELTA_NOISE_MULTIPLIER` | clipping 후 추가할 Gaussian noise 배수. `KERA_FEDERATED_DP_ACCOUNTANT_DELTA`와 같이 쓰면 기본 `gaussian_rdp_poisson_subsampled` accountant와 누적 budget snapshot을 계산 |
| `KERA_FEDERATED_DP_ACCOUNTANT_MODE` | DP accountant 모드. 기본값은 `gaussian_rdp_poisson_subsampled`이고, 필요하면 `gaussian_rdp_full_participation` 또는 `gaussian_basic_composition`으로 override 가능 |
| `KERA_FEDERATED_DP_WARN_EPSILON` | 누적 epsilon 경고 임계값. 설정하면 admin federation 화면과 privacy report에 warning 상태가 표시 |
| `KERA_FEDERATED_DP_MAX_EPSILON` | 누적 epsilon 최대 임계값. 설정하면 projected privacy budget이 이 값을 넘는 aggregation은 차단 |
| `KERA_FEDERATED_DELTA_QUANTIZATION_BITS` | 전송/저장 delta 양자화 비트 수 (`8` 또는 `16`) |
| `KERA_REQUIRE_SECURE_AGGREGATION` | `true`면 secure aggregation이 없는 빌드에서 FL round/aggregation을 시작하지 않음 |
| `KERA_REQUIRE_FORMAL_DP_ACCOUNTING` | `true`면 DP accountant가 없는 빌드에서 FL round/aggregation을 시작하지 않음. 현재는 Poisson subsampling을 반영하는 Gaussian RDP accountant까지 구현되어 있음 |
| `KERA_ACKNOWLEDGE_NON_DP_FEDERATED_TRAINING` | production/staging runtime에서 DP accountant 없이 FL을 돌릴 때 필요한 명시적 운영 승인 |
| `KERA_ALLOW_LEGACY_SINGLE_DB_FALLBACK` | production/staging runtime에서 legacy `KERA_DATABASE_URL` / `DATABASE_URL` fallback을 계속 쓸 때 필요한 명시적 승인 |
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
- `KERA_DATABASE_URL` / `DATABASE_URL`는 legacy 호환용입니다. split env를 함께 쓰는 경우에는 실제로 다른 DB를 가리킬 때만 경고가 발생합니다.
- production/staging처럼 보이는 runtime에서는 legacy single-DB fallback이 기본적으로 차단됩니다. 정말 필요한 경우에만 `KERA_ALLOW_LEGACY_SINGLE_DB_FALLBACK=true`로 명시적으로 승인하세요.
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
