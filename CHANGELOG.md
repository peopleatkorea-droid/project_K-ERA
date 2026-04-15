# Changelog

## 2026-04-15

### Federated privacy accounting and admin reporting

- federated update의 `dp_accounting` summary를 aggregation 결과에만 남기던 상태에서, aggregation마다 누적 `dp_budget` snapshot을 함께 영속 저장하도록 확장했습니다.
- 현재 accountant는 `gaussian_basic_composition` 기준이며, site별/전체 `epsilon`, `delta`, `accounted_updates`, `accounted_aggregations`를 aggregation 시점 기준으로 누적합니다.
- Python control-plane aggregation 경로와 Next main-app-bridge aggregation 경로가 같은 DP summary/budget 구조를 남기도록 맞췄습니다.
- admin workspace의 federation 섹션에 `현재 프라이버시 budget` 카드와 aggregation별 `이번 라운드 privacy accounting` 요약을 추가했습니다.
- README도 현재 상태에 맞게 정리했습니다. 이제 basic composition accountant와 aggregation별 누적 budget snapshot/report는 있다고 명시하고, 아직 없는 것은 고급 accountant와 secure aggregation이라고 구분합니다.
- 관련 검증:
  - `uv run pytest tests/test_federated_update_security.py -q`
  - `uv run pytest tests/test_api_http.py -q -k "aggregation_job_endpoints_persist_status_and_dp_accounting_http"`
  - `frontend/npm run build`
  - `frontend/npm exec vitest run`

### README 정보구조 재정리

- README 상단을 현재 실제 운영 흐름 기준으로 다시 썼습니다.
- 기술 용어 중심 설명(`local-first control plane`, `local node`, `data plane`) 대신, 의료진/연구자가 이해하기 쉬운 표현으로 웹 포털과 데스크톱 앱의 역할을 구분해 설명했습니다.
- `k-era.org`는 로그인, 기관 승인, 설치본 다운로드용 웹 포털이고, 실제 환자 케이스 작업은 Windows 데스크톱 앱에서 진행한다는 점을 앞부분에 명확히 반영했습니다.
- 설치본 배포 절차도 현재 기준으로 정리했습니다. 새 버전은 OneDrive 같은 외부 저장소에 올린 뒤, 운영자 화면의 `데스크톱 설치본 관리`에서 버전 / URL / SHA256 / 크기를 등록하는 흐름을 기준으로 설명합니다.
- README 초반을 `의료진 / 연구자용 빠른 시작`, `운영자용 배포 절차`, `개발자 / 운영 담당자용 실행 방법`으로 다시 나눠, 읽는 사람별로 필요한 내용이 먼저 보이도록 정리했습니다.

## 2026-04-14

### Web installer delivery for control-plane-only deployments

- 승인된 사용자가 `k-era.org` 같은 web control-plane 배포에 로그인한 뒤, 선택한 병원 기준으로 Windows CPU 설치본을 받을 수 있는 desktop release 경로를 추가했습니다.
- Next main-app bridge에 `desktop_releases`, `desktop_download_events` 테이블과 release metadata / download claim API를 추가했습니다.
- 현재 배포 방식은 control-plane DB의 active desktop release를 기준으로 다운로드 클릭 로그를 남기고 외부 installer URL로 redirect 하는 구조입니다.
- platform admin은 admin workspace의 `데스크톱 설치본 관리` 패널에서 CPU release를 등록/활성화할 수 있고, 더 이상 버전 변경 때마다 Vercel env를 수정할 필요가 없습니다.
- `KERA_DESKTOP_CPU_RELEASE_*`는 이제 필수 runtime 설정이 아니라, DB에 release가 아직 없을 때 한 번 초기 시드(seed)하는 용도로만 남겨 두었습니다.
- home page의 `control-plane-only` guard 화면에는 최소 다운로드 카드가 추가되어, web data plane이 없는 환경에서도 바로 데스크톱 설치본으로 넘어갈 수 있습니다.
- `.env.example`과 README에 `KERA_DESKTOP_CPU_RELEASE_*` 설정과 현재 CPU 설치본 메타데이터를 반영했습니다.

### 인증 / API 보안 하드닝

- control-plane 비밀번호 저장 기본값을 Argon2로 전환했고, legacy bcrypt/PBKDF2 row는 로그인 성공 시 Argon2로 자동 재해시되도록 했습니다.
- 로그인 rate limit은 이제 `KERA_TRUST_PROXY_HEADERS=true` 이고 요청이 명시적으로 신뢰한 프록시(`KERA_TRUSTED_PROXY_IPS`)를 통해 들어온 경우에만 `X-Forwarded-For` / `X-Real-IP`를 사용합니다.
- API CORS 기본 허용 origin을 `localhost/127.0.0.1`의 `3000`, `3001`로 축소했고, 추가 origin은 `KERA_CORS_ALLOWED_ORIGINS`로만 열도록 정리했습니다.
- 이미지 업로드는 기존 PIL 재인코딩/픽셀 제한에 더해 magic-byte sniffing과 basename 정규화를 추가했습니다.
- 관련 회귀 테스트를 추가해 Argon2 마이그레이션, trusted proxy rate limit, explicit CORS allowlist, invalid image upload 검증을 고정했습니다.

### 프론트 런타임 안정성 / 공급망 점검 보강

- home page에서 `CaseWorkspace`와 `AdminWorkspace`를 각각 별도 React error boundary로 감싸, 하위 렌더링 예외가 나더라도 전체 세션이 빈 화면으로 죽지 않고 `retry / reload / logout` 복구 경로를 제공하도록 했습니다.
- `frontend/components/ui/runtime-error-boundary.tsx`와 전용 테스트를 추가했습니다.
- `frontend`의 `next`를 `15.5.15`로 올려, production `npm audit --omit=dev --audit-level=high` 기준 고위험 advisory를 제거했습니다.
- `frontend/package.json`에 `npm audit --omit=dev --audit-level=high` 기반 `audit:prod` 스크립트를 추가했습니다.
- 루트 `scripts/run_dependency_audits.ps1`를 추가해 `uv export + uvx pip-audit`와 `frontend npm audit`를 한 번에 실행하고 `artifacts/dependency-audit/`에 보고서를 남기도록 했습니다.
- GitHub Actions에 `dependency-audits` workflow를 추가해 주간/수동 점검 보고서를 업로드하도록 했습니다.

### DB runtime / split-env 가드 정리

- split control/data plane 구성이 켜진 상태에서 `KERA_DATABASE_URL` / `DATABASE_URL`가 같이 설정돼 있어도, 실제 resolved control/data plane URL과 같은 값을 가리키면 더 이상 경고하지 않도록 정리했습니다.
- legacy DB env가 split URL과 실제로 충돌할 때만 경고를 띄우도록 바꿔, 운영 로그와 테스트 출력의 노이즈를 줄였습니다.
- production/staging처럼 보이는 runtime에서는 legacy `KERA_DATABASE_URL` / `DATABASE_URL` fallback을 기본적으로 거절하고, 정말 필요한 경우에만 `KERA_ALLOW_LEGACY_SINGLE_DB_FALLBACK=true`로 명시적으로 승인하도록 바꿨습니다.
- remote control plane cache SQLite가 손상된 경우에는 import 시 `.recovered.db`로 우회하지 않고, startup/init 시 같은 경로에서 quarantine 후 재생성하도록 복구 경계를 단순화했습니다.
- Windows에서 손상 cache quarantine 중 파일 핸들 경합이 날 수 있는 경로에는 짧은 retry를 넣어 local cache 재빌드가 더 안정적으로 완료되게 했습니다.

### Federated learning hardening

- weight delta update에 선택형 HMAC 서명을 추가했습니다. `KERA_FEDERATED_UPDATE_SIGNING_SECRET`가 설정되면 site가 delta metadata에 서명하고, control plane registry는 제출과 집계 전에 서명을 검증합니다.
- `KERA_REQUIRE_SIGNED_FEDERATED_UPDATES=true`이면 unsigned 또는 tampered delta update를 거절하도록 했습니다.
- production/staging 같은 runtime에서는 `KERA_REQUIRE_SIGNED_FEDERATED_UPDATES=true`와 `KERA_FEDERATED_UPDATE_SIGNING_SECRET`가 같이 설정되지 않으면 FL round/aggregation이 차단되도록 가드를 강화했습니다.
- aggregation 전략을 `fedavg`, `coordinate_median`, `trimmed_mean` 중에서 고를 수 있게 했고, aggregation payload에 실제 전략/trim ratio/weighting mode를 기록합니다.
- site-side delta hardening으로 L2 clipping, Gaussian noise, 8/16-bit symmetric quantization을 추가했습니다. formal DP accountant나 secure aggregation은 아직 포함하지 않습니다.
- `KERA_FEDERATED_DP_ACCOUNTANT_DELTA`가 함께 설정되면 site update metadata에 basic composition 기반 DP accounting entry를 붙이고, aggregation payload에는 site별/전체 누적 summary를 기록합니다.
- production/staging runtime에서는 formal DP accountant 부재를 명시적으로 승인하지 않으면 image-level / visit-level FL round와 aggregation을 시작하지 않도록 가드를 추가했습니다.
- `KERA_REQUIRE_SECURE_AGGREGATION=true`를 설정하면 secure aggregation이 구현되기 전까지 FL round/aggregation이 `503`으로 차단됩니다.
- `KERA_REQUIRE_FORMAL_DP_ACCOUNTING=true`를 설정하면 formal DP accountant가 구현되기 전까지 FL round/aggregation이 `503`으로 차단됩니다.
- admin aggregation job 상태를 control plane DB에 영속 저장하도록 바꿨고, aggregation job list/detail API가 프로세스 재시작 뒤에도 상태를 계속 보여주도록 정리했습니다.
- federated update security/unit test, modeling delta quantization/robust aggregation test, API aggregation/signature 회귀 테스트를 추가했습니다.

### Windows 설치형 배포 경로 정리

- CPU 설치형 기본 배포 경로를 `NSIS current-user installer`로 정리했습니다.
- `frontend/src-tauri/tauri.conf.json`에서 NSIS `installMode`를 `currentUser`로 고정해, 일반 사용자 세션에서도 설치가 가능하도록 맞췄습니다.
- `frontend/src-tauri/installer-hooks.nsh`의 preinstall 안내는 silent install일 때 자동으로 건너뛰도록 정리해, installer smoke가 대화상자에서 멈추지 않게 했습니다.
- `frontend/scripts/run-desktop-installer-smoke.ps1`는 비관리자 세션에서 NSIS를 자동 우선 선택하고, installer별 timeout/log 기록과 MSI/NSIS 단독 진단 모드를 지원하도록 확장했습니다.
- `frontend/scripts/verify-tauri-package.mjs`는 `--type nsis|msi` 필터를 지원하도록 확장했습니다.
- `frontend/package.json`에 `desktop:package:cpu:nsis`, `desktop:package:cpu:msi`, `desktop:verify-package:nsis`, `desktop:verify-package:msi`, `desktop:smoke-installed:cpu:nsis`, `tauri:build:nsis`, `tauri:build:msi` 스크립트를 추가했습니다.
- 현재 로컬 검증 기준으로 `desktop:package:cpu:nsis -> desktop:smoke-installed:cpu` 경로는 통과했고, MSI는 관리자 권한 전제의 별도 검증 경로로 남겨 두었습니다.

## 2026-04-13

### Desktop runtime / release guard 보강

- Tauri desktop runtime의 CSP를 더 이상 `null`로 두지 않고 명시적으로 설정했습니다.
- `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, `frontend/package.json`, `pyproject.toml` 버전을 `1.0.0`으로 정렬했습니다.
- `frontend/scripts/sync-desktop-version.mjs`를 추가했고, `npm run tauri:dev*`, `npm run tauri:build` 전에 desktop/web/python 버전을 자동 동기화하도록 연결했습니다.
- `frontend/scripts/verify-desktop-runtime.mjs`가 이제 desktop bundle 검사 외에 `CSP 설정 여부`와 `tauri/cargo/package/pyproject 버전 일치`도 확인합니다.

### 인증 / 마이그레이션 운영 가드 보강

- `auth.py`의 로그인 rate limit을 control-plane DB 기반으로 바꿔 프로세스 재시작 뒤에도 제한 창이 유지되도록 수정했습니다.
- DB 경로가 일시적으로 실패하는 경우에는 기존 in-memory limiter로 안전하게 fallback 하도록 유지했습니다.
- control plane에는 Alembic baseline revision(`20260413_01`)을, data plane에는 Alembic baseline revision(`20260413_02`)을 도입했습니다.
- startup 시 control plane은 기존 `create_all + custom migration` 뒤 `upgrade head`를 적용하고, data plane도 기존 `create_all + custom migration` 뒤 `upgrade head`를 적용하도록 연결했습니다.
- 앞으로 schema change는 `src/kera_research/alembic/versions/`와 `src/kera_research/alembic_data_plane/versions/` 아래 Alembic revision으로 추가할 수 있고, `uv run python -m kera_research.control_plane_alembic ...`, `uv run python -m kera_research.data_plane_alembic ...` 경로로 관리할 수 있습니다.
- control plane schema state와 data plane schema state는 이제 각각 현재 Alembic revision을 기록합니다.
- 관련 회귀 테스트를 추가해 `restart 이후 rate limit 지속`, `schema state row 기록`, `preview cold miss는 원본 즉시 응답 + backfill queue` 동작을 계속 검증하도록 했습니다.

### API observability / health probe 보강

- FastAPI 런타임 버전을 `1.0.0`으로 정렬하고, `/api/live`, `/api/ready`, `/api/health`가 동일한 버전을 보고하도록 맞췄습니다.
- request-id middleware를 추가해 모든 API 응답에 `X-Request-ID`를 포함하고, route template 기준의 structured request log를 남기도록 했습니다.
- in-memory request metrics recorder와 `GET /api/metrics` Prometheus text endpoint를 추가했습니다.
- `/api/health`와 `/api/ready`는 이제 storage, SQLite readiness, model artifact readiness, disk usage, background queue hung 여부를 함께 반환합니다.
- `/api/health`에는 control/data plane DB `SELECT 1` probe도 포함해, 프로세스 생존과 실제 DB readiness를 분리해서 보게 했습니다.
- background queue failure는 더 이상 `print`로 삼키지 않고 structured warning log로 남기도록 정리했습니다.
- `KERA_SENTRY_DSN` 기반의 선택형 Sentry integration을 추가해, 운영 환경에서는 error aggregation과 trace sampling을 바로 붙일 수 있게 했습니다.
- remote control plane은 미설정 상태와 실제 bootstrap 실패를 구분해, optional dependency 문제를 `degraded`로 분리하도록 health semantics를 정리했습니다.

### 웹/SaaS baseline 컨테이너 자산 추가

- `Dockerfile.api`, `frontend/Dockerfile.web`, `docker-compose.yml`를 추가했습니다.
- baseline stack은 `api + worker + web` 3개 서비스로 구성되고, 기본값은 volume-backed SQLite를 사용합니다.
- 환경변수 override로 외부 PostgreSQL control/data plane에 연결할 수 있게 구성했습니다.
- compose stack에는 `api / worker / web` healthcheck와 `service_healthy` 의존관계를 추가했습니다.

### Windows 설치형 배포 가드 보강

- NSIS installer를 `currentUser` 모드로 고정해, 일반 사용자 세션에서도 CPU 설치형 배포를 기본 경로로 사용할 수 있게 했습니다.
- NSIS preinstall 안내 `MessageBox`는 silent install일 때 자동으로 건너뛰도록 바꿔, installer smoke가 대화상자에서 멈추지 않게 했습니다.
- `run-desktop-installer-smoke.ps1`는 installer별 timeout/log 기록, MSI/NSIS 단독 진단, 비관리자 세션의 NSIS 우선 선택을 지원합니다.
- `desktop:package:cpu:nsis`, `desktop:verify-package:nsis`, `desktop:smoke-installed:cpu:nsis`, `tauri:build:nsis` 스크립트를 추가해 권장 배포 경로를 명시했습니다.

## 2026-04-07 ~ 2026-04-09

### CPU 배포 안정화

- CPU 설치형 배포본 기준으로 `Next production build`, `desktop:smoke-installed:cpu`, packaged backend self-check, 주요 Python 회귀를 다시 녹색으로 맞췄습니다.
- 설치형 smoke script와 packaged runtime layout 인식을 정리해, installed desktop smoke가 실제 배포 산출물 구조를 따라가도록 수정했습니다.
- packaged seed model / bundled model registration 경로를 정리해 clean install 기준 분석 모델 초기화가 안정적으로 동작하도록 맞췄습니다.

### 케이스 정책 분리 및 분석 전용 흐름

- `culture_confirmed` 중심 정책을 `culture_status = positive / negative / not_done / unknown` 중심으로 재정리했습니다.
- 모든 사용자는 케이스를 저장하고 분석할 수 있게 유지하면서, `positive` 케이스만 학습/기여에 사용하도록 백엔드 정책을 분리했습니다.
- `registry include` / `contribution`은 `positive + active + images>0 + consent + included` 조건을 모두 만족할 때만 허용하도록 강제했습니다.
- validation은 `labeled validation`과 `inference-only`를 분리했고, inference-only 결과는 정답 판정이 아니라 pattern support 성격으로 반환하도록 맞췄습니다.

### 운영 기본 AI 구성 정리

- 운영 기본 분석 모델을 `EfficientNetV2-S MIL (full)`로 정리했습니다.
- 보조 image-level support 모델을 `ConvNeXt-Tiny (full)`로 추가했습니다.
- AI Clinic similar case retrieval 기본값은 `DINOv2 lesion-crop`으로 고정했습니다.
- retrieval은 analysis model에서 분리된 `retrieval_profile`로 운영되도록 정리했습니다.

### Federated Retrieval Corpus Expansion

- DINO retrieval을 full FL 대신 `federated retrieval corpus expansion` 구조로 확장했습니다.
- 각 병원은 같은 retrieval profile / preprocessing / normalization 기준으로 positive registry case embedding을 생성하고, 중앙 control plane retrieval corpus로 sync할 수 있습니다.
- 중앙 corpus는 `retrieval_signature`를 기준으로 profile 호환성을 강제합니다.
- AI Clinic은 로컬 query case를 기준으로 cross-site similar case를 검색할 수 있고, remote case에 site label / preview thumbnail / culture metadata를 함께 반환할 수 있습니다.
- retrieval corpus sync는 background site job으로 동작하고, bulk import / metadata recover / raw sync / visit/image mutation 뒤 auto sync가 이어지도록 연결했습니다.

### Image-level Federated Learning

- `ConvNeXt-Tiny (full)` 기준 image-level federated learning을 추가했습니다.
- 구조는 `site-round background job -> pending_review model update -> FedAvg`입니다.
- eligible policy는 `positive + active + included + images>0`이고, aggregation weight는 `n_images`를 사용합니다.
- web API, desktop sidecar, Tauri transport, job runner, aggregation metadata까지 end-to-end로 연결했습니다.
- image-level round progress에는 eligible case/image 수, epoch progress, aggregation metadata를 포함하도록 확장했습니다.

### Visit-level Federated Learning

- `EfficientNetV2-S MIL (full)` 기준 visit-level federated learning을 추가했습니다.
- `ModelManager.fine_tune()`가 image-level 루프가 아니라 visit bag MIL 경로를 타도록 branch를 추가했습니다.
- 구조는 `site-round background job -> pending_review model update -> FedAvg`이고, aggregation weight는 `n_cases`를 사용합니다.
- image-level round, single-case contribution delta와 섞여 aggregate되지 않도록 `federated_round_type` guard를 추가했습니다.
- preferred operating model 선택, API route, desktop sidecar, Tauri command, TypeScript transport까지 모두 연결했습니다.

### 운영 상태 / 회귀 정리

- FL / embedding / federated retrieval status 응답의 `active_job` semantics를 정리했습니다.
  - `queued/running`만 active로 간주
  - completed job은 `active_job: null`
- 같은 모델이라도 `epochs / learning_rate / batch_size / execution_device`가 다르면 기존 active FL job을 재사용하지 않도록 수정했습니다.
- 회귀 테스트를 보강해 image-level FL, visit-level FL, retrieval status, embedding status, aggregation guard를 계속 검증하도록 추가했습니다.

## 2026-03-22 ~ 2026-03-24

### Tauri 데스크탑 앱 대규모 모듈화 (v0.6 → v0.69)

- 기존 `main.rs` 모놀리식 구조에서 **100개 이상의 Rust 모듈**로 분리했습니다.
  - 케이스 처리: `desktop_case_queries`, `desktop_case_mutations`, `desktop_case_preview_commands`, `desktop_case_ai_clinic_run_commands` 등
  - 환자/방문 관리: `desktop_patient_board_commands`, `desktop_patient_visit_mutations`, `desktop_visit_create/update/delete_mutation`
  - 사이트/학습: `desktop_site_training_commands`, `desktop_site_validation_commands`, `desktop_site_activity_*` (리더보드 포함)
  - 로컬 런타임: `desktop_local_runtime_orchestration`, `desktop_bundled_runtime`, `desktop_ml_sidecar_runtime`
  - 로컬 API 브릿지: `desktop_local_api_bridge`, `desktop_local_api_json_bridge`, `desktop_local_api_multipart_bridge`

### 데스크탑 전용 인증 시스템 구축

- `frontend/desktop-shell/main.tsx` — Google OAuth, 로컬 로그인, 세션 캐싱을 통합한 데스크탑 셸 앱 신규 작성
- `desktop-shell/desktop-landing.tsx` — 데스크탑 전용 랜딩 화면 추가
- Next.js API 라우트 신규 추가:
  - `auth/desktop/start` — Google OAuth 시작
  - `auth/desktop/exchange` — 토큰 교환
  - `auth/desktop/status` — 인증 상태 확인
- `src/kera_research/services/local_api_jwt.py` — 데스크탑 로컬 API 전용 JWT 발급 서비스
- `src/kera_research/services/local_api_secret.py` — 로컬 API 시크릿 관리
- `admin-login/page.tsx` — 데스크탑 환경 관리자 로그인 UI 업데이트

### Python 백엔드 라우터 대규모 분리 (리팩토링)

기존 거대한 단일 파일들을 역할별로 분리했습니다.

| 기존 파일 | 분리된 파일 |
|-----------|-------------|
| `admin.py` (900줄) | `admin_access.py`, `admin_management.py`, `admin_registry.py`, `admin_shared.py` |
| `cases.py` (1700줄) | `case_analysis.py`, `case_images.py`, `case_records.py`, `case_shared.py` |
| `sites.py` (800줄) | `site_training.py`, `site_imports.py`, `site_overview.py`, `site_shared.py` |

- `src/kera_research/api/models.py` — Pydantic 요청 모델 통합
- `src/kera_research/api/routes/desktop.py` — 데스크탑 전용 엔드포인트 (`/api/desktop/self-check`, `/api/control-plane/node/*`)
- `src/kera_research/api/control_plane_sync.py` — control plane 동기화 루프

### Federation Salt 시스템 추가

- `src/kera_research/federation_salt.py` — 다기관 연합 환경에서 케이스/환자/별칭 참조값을 기관별로 솔팅하는 서비스
  - `FederationSaltValues` (case_reference_salt, patient_reference_salt, public_alias_salt) 관리
  - `docs/federation-salt-migration.md` 마이그레이션 가이드 문서 추가

### 데스크탑 CPU/GPU 패키지 빌드 분리

- `frontend/scripts/run-desktop-profile-command.mjs` — `cpu` / `gpu` 두 가지 패키징 프로파일 지원
- `frontend/scripts/run-tauri-build.mjs` — 패키지드 런타임 빌드 스크립트
- GitHub Actions 워크플로 신규 추가:
  - `.github/workflows/desktop-release.yml` — 버전 태그(`v*`) 기반 자동 릴리즈 빌드 (Windows)
  - `.github/workflows/desktop-verify.yml` — PR 시 데스크탑 빌드 검증
  - 서명 키 미포함 여부 자동 검사 포함
- `docs/desktop-installed-smoke.md` — 설치 후 smoke test 가이드 문서 추가
- `docs/tauri-packaged-runtime-layout.md` — 패키지드 런타임 레이아웃 문서 추가

### 랜딩 페이지 개선

- `frontend/components/public/landing-google-cta.tsx` — 재사용 가능한 Google 로그인 CTA 컴포넌트 분리
- 랜딩 페이지 이미지 자산 추가 (`desktop-dist/landing/` — CTA, 제주, medSAM, 워크플로 등 12종)
- 랜딩 영어/한국어 뷰 업데이트

### 성능 최적화 (v0.61 ~ v0.64)

- SQLite N+1 쿼리 수정, CTE 범위 최적화, 인덱스 추가
- 케이스 목록 로드 시 critical path에서 stat/preview 호출 제거
- 이미지 로드 병렬화 적용

### 검증

- `frontend`: `npx tsc --noEmit`
- `frontend`: `npx vitest run`
- Vercel 배포 및 auth 연동 확인 (v0.65 ~ v0.684)

## 2026-03-19

### 예측 post-mortem 피드백 루프 추가

- case validation 직후 `prediction snapshot -> structured analysis -> root-cause/action tag -> human-readable summary` 흐름을 생성하는 post-mortem 모듈을 추가했습니다.
- validation 결과에는 아래 정보가 함께 저장되고 UI에 출력됩니다.
  - prediction snapshot (`predicted_label`, `confidence`, `model_version`, representative image, embedding reference, peer-model disagreement)
  - structured analysis (`cam overlap`, `neighbor purity / distance`, `image quality`, `site-level concentration`)
  - root-cause tags / action tags
  - LLM 또는 local fallback 기반 post-mortem summary
- validation panel과 contribution history에서 post-mortem 결과를 바로 확인할 수 있게 했습니다.
- control plane validation record payload에도 post-mortem을 다시 반영하도록 저장 경로를 확장했습니다.

### dual-input concat fusion baseline 추가

- 새 supervised architecture `dual_input_concat`을 추가했습니다.
  - shared DINOv2 encoder
  - `cornea crop + lesion crop` paired input
  - feature concat 후 single classifier로 최종 예측
- 새 crop mode `paired`를 추가해 모든 이미지에서 `cornea crop + lesion crop` 쌍을 한 번에 준비할 수 있게 했습니다.
- initial training, cross-validation, inference, case embedding, CLI, model version metadata, admin training UI까지 `dual_input_concat + paired` 경로를 연결했습니다.
- 기존 weighted-average late ensemble(`crop_mode=both`)은 유지하고, 새 fusion baseline은 별도 architecture로 병행 비교할 수 있게 했습니다.
- 7-model benchmark는 기존 single-input baseline 비교용으로 유지하고, `dual_input_concat`은 benchmark 대상에서 제외했습니다.
- 현재 `dual_input_concat`에는 branch-aware explanation이 아직 없어서 Grad-CAM은 비활성화됩니다.

### DINOv2 학습 backbone / 7종 benchmark 확장

- supervised initial training architecture에 `dinov2`를 추가해 DenseNet/ConvNeXt처럼 확률 출력 분류기로 학습할 수 있게 했습니다.
- 기본 benchmark 세트를 `vit`, `swin`, `dinov2`, `dinov2_mil`, `convnext_tiny`, `densenet121`, `efficientnet_v2_s`의 7종 순차 학습으로 확장했습니다.
- 모델 버전 메타데이터와 UI 옵션에 `case_aggregation`, `bag_level`을 함께 저장하도록 정리했습니다.

### visit 기반 집계 / DINOv2 Attention MIL 추가

- image-level 모델의 visit 단위 집계 방식으로 `mean`, `logit_mean`, `quality_weighted_mean`을 추가했습니다.
- `dinov2_mil` 아키텍처를 새로 추가했습니다.
  - DINOv2 feature extractor
  - attention-based MIL pooling
  - visit-level bag training / inference
- `dinov2_mil`은 attention score가 가장 높은 이미지를 model-representative image로 자동 선택하고, validation 결과에 attention score를 함께 남깁니다.
- case validation / external validation / model version serialization에 visit aggregation 관련 메타데이터를 확장했습니다.

### 학습 job UX 개선

- 단일 initial training과 7종 benchmark 카드에 `예상 남은 시간(ETA)`을 추가했습니다.
- 단일 initial training과 benchmark에 `중단(Stop)` 버튼을 추가했습니다.
- benchmark는 중단 또는 일부 실패 후 `남은 architecture만 재시작`할 수 있게 resume endpoint와 UI를 추가했습니다.
- job status에 `cancelling`, `cancelled` 흐름을 추가했고, benchmark는 partial result와 completed/remaining architecture 목록을 유지합니다.

### API / 운영 경로 추가

- 새 endpoint:
  - `POST /api/sites/{site_id}/training/initial/benchmark/resume`
  - `POST /api/sites/{site_id}/jobs/{job_id}/cancel`
- job worker는 cancel 요청을 polling하면서 안전 지점에서 중단하도록 변경했습니다.

### 검증

- `python -m py_compile src/kera_research/services/job_runner.py src/kera_research/services/data_plane.py src/kera_research/api/app.py src/kera_research/api/routes/sites.py src/kera_research/api/route_support.py`
- `frontend`: `npm run test:run -- training-section.test.tsx`
- `python`: `py -3 -m py_compile src/kera_research/services/modeling.py src/kera_research/services/pipeline.py src/kera_research/services/pipeline_case_support.py src/kera_research/services/pipeline_domains.py src/kera_research/api/case_model_versions.py src/kera_research/domain.py src/kera_research/cli.py`
- `frontend`: `npx vitest run components/admin-workspace/training-section.test.tsx`
- `frontend`: `npx tsc --noEmit`

## 2026-03-18

### 문서 / 실행 가이드 정리

- README 빠른 실행 섹션에 local-first control plane 기준 최소 `.env.local` 예시를 추가했습니다.
- README에 `2026-03-18 업데이트` 요약을 넣어 오늘 정리한 control plane, DPAPI credential 저장, remote 우선 경로, smoke test 흐름을 바로 확인할 수 있게 했습니다.
- 현재 앱 실행 경로를 `setup_local_node -> .env.local -> run_local_node -> /control-plane 등록 -> smoke test` 순서로 문서화했습니다.

### local-first control plane 마무리

- Next.js 기반 중앙 control plane에 `dev-login`, `logout`, `health`, `validation-runs` admin 조회를 추가했습니다.
- 기존 Neon/Postgres 레거시 스키마와 새 control-plane 스키마가 같이 동작하도록 호환 마이그레이션을 추가했습니다.
- control plane UI에서 node 등록 후 로컬 FastAPI로 자격증명 저장까지 자동 시도하도록 연결했습니다.

### 병원 PC remote control plane 경로 정리

- 병원 PC는 `bootstrap`, `heartbeat`, `current release`, `model update metadata upload`, `validation summary upload`, `LLM relay`를 원격 control plane 우선으로 사용합니다.
- `node_id` / `node_token`은 Windows에서 DPAPI로 저장하도록 추가했습니다.
- `KERA_SITE_STORAGE_SOURCE=local` 기본 경로를 기준으로 site storage lookup을 remote-control-plane 안전 모드로 고정했습니다.

### 레거시 workspace split mode 정리

- split mode에서 빈 값으로 내려가던 `site summary`, `site activity`, `site validations`, `site model versions`, `patient trajectory` 응답을 remote bootstrap + local cache 기반으로 계속 제공하도록 수정했습니다.
- remote 업로드 성공 시에도 로컬 cache를 유지해서 기존 workspace/history 흐름이 끊기지 않도록 했습니다.

### 실행/검증 스크립트 추가

- `scripts/register_local_node.ps1`: 수동 node 등록 + 로컬 credential 저장
- `scripts/run_control_plane_e2e_smoke.ps1`: Next.js control plane + FastAPI local node 실제 런타임 E2E smoke test

### 한국어 공개 랜딩 문구 정리

- 한국어 랜딩의 개발자 노트 섹션에서 좌측 하단 보조 이미지를 제거해 메시지 집중도를 높였습니다.
- 확장 메시지를 `제주에서 시작된 가능성, / 더 많은 진료에 / 닿도록 준비합니다`로 정리했습니다.
- privacy / federated learning 설명 용어를 한국어 톤으로 통일했습니다.
  - `Weight Delta` → `가중치 변화량`
  - `Control Plane` → `중앙 서버`
  - `Local Node` → `내부 노드`
  - `FedAvg` → `연합 집계`
- 원본 외부 반출 설명도 더 자연스럽게 다듬었습니다.
  - `저해상도 각막 이미지` / `썸네일` → `저해상도 각막 미리보기`
  - FAQ 문구는 `저해상도 각막 미리보기(최대 128px)` 기준으로 정리했습니다.

### split mode 사이트 선택 안정화

- 로컬 site directory 기준으로 사이트 목록이 바뀌었을 때, 현재 선택된 site가 더 이상 유효하지 않으면 프론트가 자동으로 첫 번째 유효 site로 fallback 하도록 수정했습니다.
- site cleanup 이후 이전에 선택된 site id가 남아 화면이 비는 상태를 줄였습니다.

### 케이스 / 목록 미리보기 성능 개선

- 저장 케이스를 열 때 같은 환자의 전체 방문 갤러리를 즉시 prefetch 하던 동작을 제거했습니다.
- 선택된 케이스 이미지는 대표 이미지를 먼저, 나머지는 병렬로 불러오도록 바꿨습니다.
- 목록과 케이스 미리보기는 원본 image blob 대신 경량 preview blob을 사용하도록 전환했습니다.
- 새 API 추가: `GET /api/sites/{site_id}/images/{image_id}/preview`
  - EXIF orientation을 반영한 뒤 축소 JPEG preview를 반환합니다.
  - patient list thumbnail과 saved case preview는 이 endpoint를 사용합니다.
- 타임라인의 다른 방문은 더 이상 자동 preload 하지 않으므로, 이미지가 아직 로드되지 않은 방문에는 `방문 열기` 유도 문구가 보이도록 UI를 조정했습니다.

### site_id / 병원 표기 정리

- 제주대학교병원 로컬/중앙 데이터를 `JNUH`에서 HIRA 8자리 기준 `39100103`으로 마이그레이션했습니다.
- `display_name`은 별칭(`JNUH`)으로 유지하고, UI의 기본 병원 표기는 `hospital_name` 우선으로 통일했습니다.
- case workspace, admin workspace, 공개 랜딩, 접근 요청 화면에서 raw `site_id` 노출을 줄이고 병원 정식명칭 중심으로 보이도록 정리했습니다.
- admin 병원 등록/승인 폼은 `HIRA site ID` 기준 문구로 바꾸고, 별칭 입력은 선택 사항으로 정리했습니다.
- HIRA 연동 site 생성은 `source_institution_id`가 실제 8자리 코드일 때만 `site_id`로 승격하도록 backend 정규화를 추가했습니다.

### Google 로그인 공개 별칭 / 기여 랭킹 익명화

- control plane `users` 테이블에 `public_alias` 컬럼과 unique index를 추가했습니다.
- Google 로그인 사용자는 첫 인증 시 `warm_gorilla_221` 같은 language-neutral canonical alias가 자동 생성되고, JWT / `/api/auth/me`에도 함께 내려가도록 정리했습니다.
- 기여 이력에는 `user_id`와 함께 `public_alias`를 같이 기록해, 케이스 히스토리에서 실명 없이 익명 표시가 가능해졌습니다.
- site activity 응답에 전역 contribution leaderboard를 추가하고, 최근 기여 내역도 alias 중심으로 보이도록 확장했습니다.
- 프론트는 canonical alias를 locale에 맞춰 렌더하도록 바꿔서, 한국어에서는 `따스한 고릴라 #221`, 영어에서는 `Warm Gorilla #221`로 보이게 했습니다.
- case workspace contribution 패널에 `공개 별칭`, 현재 순위, 익명 leaderboard를 추가했습니다.

### 검증

- `frontend`: `npx tsc --noEmit`
- `frontend`: `npx vitest run components/case-workspace/contribution-history-panel.test.tsx`
- `frontend`: `npx vitest run home-page.integration.test.tsx`
- `python`: `py_compile` (`control_plane.py`, `api/app.py`, `api/route_helpers.py`, `pipeline.py`, `pipeline_domains.py`)

## 2026-03-14 ~ 2026-03-15

### 로그인 UI 분리

- 메인 `/` 로그인 화면은 연구자 기본 진입 경로인 Google 로그인만 보이도록 정리했습니다.
- 로컬 username/password 로그인은 관리자 복구용 별도 경로 `/admin-login`으로 분리했습니다.
- 백엔드 인증 정책은 유지하고, 프론트 UI만 분리했습니다.
- 메인 로그인 화면 하단에 관리자용 보조 링크 추가 (`관리자 학습`, `관리자 교차 검증`, `관리자 병원 검증`).
  - 링크 클릭 시 `/admin-login?next=...` 형태로 이동하며, 로그인 후 지정된 운영 섹션으로 자동 복귀합니다.

### BiomedCLIP semantic prompt review PoC

- 저장된 케이스 이미지를 대상으로 BiomedCLIP 기반 semantic prompt scoring을 확인할 수 있는 PoC를 추가했습니다.
- 이미지 1장을 선택하면 view(`white/slit/fluorescein`)에 맞는 prompt dictionary를 적용해 top-k 결과와 score를 볼 수 있습니다.
- 지원 입력: `whole image`, `cornea crop`, `lesion crop`
- 관련 API: `GET /api/sites/{site_id}/images/{image_id}/semantic-prompts`

### lesion box 기반 비동기 MedSAM live preview

- 사용자가 lesion boxing을 저장하면 별도 수동 버튼 없이 비동기 preview job이 실행되도록 변경했습니다.
- job 완료 후 lesion mask와 lesion crop이 자동 갱신됩니다.
- 저사양 환경을 고려해 프론트에서 live preview 토글을 켜고 끌 수 있는 구조를 유지합니다.
- lesion preview cache는 box-aware하게 변경해, box가 바뀌면 기존 crop을 재사용하지 않습니다.
- 관련 API: `POST /api/sites/{site_id}/images/{image_id}/lesion-live-preview`

### 실험 registry 추가

control plane에 experiment registry를 추가했습니다.

자동 저장 대상: `initial_training`, `cross_validation`, `external_validation`, `local_fine_tuning`, `case_contribution_fine_tuning`

저장 항목: `experiment_id`, `site_id`, `experiment_type`, `status`, `model_version_id`, `execution_device`, `dataset_version`(manifest hash, patient/case/row 수), `parameters`(architecture, crop_mode, epochs, lr, batch_size, split, seed), `metrics`, `patient_split`, `report_path`

추가 API:
- `GET /api/admin/experiments`
- `GET /api/admin/experiments/{experiment_id}`

### 모델 artifact self-validation 강화

새로 저장되는 모델/델타 아티팩트에는 `artifact_metadata`가 함께 저장됩니다.

포함 항목: `artifact_format`, `artifact_type`, `architecture`, `num_classes`, `label_schema`, `preprocess`, `preprocess_signature`, `crop_mode`, `training_input_policy`, `saved_at`

모델 로드 시 검증 항목: checkpoint architecture, class count, crop mode, training input policy, preprocess signature, state_dict 존재 여부

### 연구용 CLI 분리

HTTP API와 별개로 직접 실행할 수 있는 CLI를 추가했습니다 (`src/kera_research/cli.py`).

```powershell
python -m kera_research.cli train --site-id <SITE_ID>
python -m kera_research.cli cross-validate --site-id <SITE_ID>
python -m kera_research.cli external-validate --site-id <SITE_ID> --project-id <PROJECT_ID>
python -m kera_research.cli export-report --validation-id <VALIDATION_ID> --output .\report.json
```

### 평가 리포트 확장

- 추가 지표: `balanced_accuracy`, `brier_score`, `ece`, calibration bins
- 외부검증 summary에 `confusion_matrix`, `roc_curve`, `site_metrics` 포함
- validation summary를 case prediction JSON과 별도로 report artifact JSON으로도 저장

### 웹 UI에서 연구 실행 바로가기 추가

- 기본 작업 화면에서 `초기 학습`, `교차 검증`, `병원 검증`, `리포트 내보내기` 항목으로 바로 이동 가능합니다.
- 관리자 워크스페이스 대시보드에서 `병원 검증 실행` 버튼 및 결과 JSON 내보내기 추가.

### AI Clinic 기능 확장

- `similar patient retrieval`: 케이스 단위 임베딩으로 유사 환자 top-K 검색, 환자 단위 중복 제거 적용
- `text evidence retrieval`: BiomedCLIP 기반 이미지-텍스트 검색 경로 추가
- `workflow recommendation`: OpenAI API 연결 시 구조화된 추천 생성, 없으면 로컬 fallback 규칙 적용
- `risk-ranked differential`: bacterial vs fungal 기준 초기 differential ranking (규칙 기반), supporting/conflicting evidence 함께 표시
- `metadata-aware reranking`: view, visit_status, active_stage, contact_lens_use, predisposing_factor, smear_result, polymicrobial, quality score를 반영한 retrieval 순위 보정
- AI Clinic UI: 유사 케이스 카드에 similarity, metadata adjustment, quality score 등 상세 정보 표시

### 이미지 전처리 / Retrieval 인프라 보강

- lesion crop을 단순 box crop에서 soft-masked lesion crop으로 변경 (병변 바깥 영역 attenuation 적용)
- 이미지별 quality/view score 추가 (blur, exposure, contrast, resolution, view consistency 합산)
- case embedding cache 추가 (케이스 입력 후 background job으로 임베딩 생성/저장, retrieval 시 재사용)
- embedding backfill API 추가: `POST /api/sites/{site_id}/ai-clinic/embeddings/backfill`
- CUDA 우선 indexing: GPU가 있으면 background indexing이 자동으로 CUDA 사용
- DINOv2 retrieval backend 추가: `classifier`, `dinov2`, `hybrid` mode 지원, DINOv2 미준비 시 classifier fallback
- FAISS local index 추가: site-local FAISS index 우선 사용, 불가 시 brute-force cache retrieval fallback

### 모델 비교 / 연구용 벤치마크 보강

- ROC curve compare UI: 여러 validation run의 ROC curve를 한 그래프에 겹쳐 볼 수 있음
- 4-model benchmark training: ViT, Swin, ConvNeXt-Tiny, DenseNet121을 동일 split 기준으로 순차 학습 및 결과 비교
- case-level multi-model compare: 같은 케이스를 여러 model version으로 동시에 validation해 결과를 나란히 확인

### 설정 / 운영 보강

- `.env.example`에 AI Clinic LLM 환경변수 예시 추가
- `docs/ai_clinic_llm_setup.md` 추가 (OpenAI API 키 설정 방법 및 주의사항)
- `setup_local_node.ps1` health check에 `faiss` import 검증 추가

---

## 2026-03-12

### 중앙 DB와 로컬 DB 분리

- `KERA_CONTROL_PLANE_DATABASE_URL`: 로그인, 권한, 프로젝트, 사이트, 모델 버전, 모델 업데이트, 집계 이력 등 중앙 운영 메타데이터
- `KERA_DATA_PLANE_DATABASE_URL`: 환자, 방문, 이미지, 로컬 학습 관련 메타데이터
- 기존 `KERA_DATABASE_URL` / `DATABASE_URL` 단일 DB 방식도 계속 지원

권장 구성: 중앙 control plane은 Neon Postgres, 병원 Local Node data plane은 로컬 SQLite 또는 병원 내부 DB

### 중앙 검토용 썸네일 공유

학습 기여 시 중앙으로 올라가는 것은 원본 이미지가 아니라 검토용 저해상도 썸네일입니다.

- source thumbnail: 최대 128px
- ROI thumbnail: 최대 320px
- mask thumbnail: 최대 320px
- EXIF 제거 유지

중앙에 올리지 않는 항목: 원본 이미지, full-size ROI crop, full-size MedSAM mask

### delta 중앙 저장 및 중앙 집계

기여 시 생성되는 weight delta는 로컬 경로(`artifact_path`)와 중앙 artifact 경로(`central_artifact_path`) 모두에 저장됩니다.

추가 메타데이터: `central_artifact_name`, `central_artifact_size_bytes`, `central_artifact_sha256`, `artifact_storage`

집계(FedAvg)는 중앙 artifact 경로를 우선 사용하므로, 로컬 delta 파일이 없어져도 집계가 가능합니다.

### 중앙 기여 메타데이터 비식별화

중앙 control plane에는 `patient_id`, `visit_date` 대신 `case_reference_id`를 저장합니다.

`case_reference_id = SHA256(KERA_CASE_REFERENCE_SALT + site_id + patient_id + visit_date)`

- 중앙에서는 환자 식별자 없이 동일 케이스를 안정적으로 추적
- 로컬에서는 기존처럼 `patient_id + visit_date`로 케이스 작업 유지

관련 환경변수: `KERA_CASE_REFERENCE_SALT` (모든 설치본에서 동일하게 맞추는 것을 권장, 미지정 시 `KERA_API_SECRET` 또는 기본 fallback 사용)

### 실행/검증 메모

- `scripts/setup_local_node.ps1`에 `bcrypt` health check 추가
- 주요 HTTP 테스트는 `tests/test_api_http.py` 기준으로 통과 상태

### 비동기 job worker queue 추가

- 학습/검증 실행 경로를 웹 요청 내부 thread 실행에서 `DB queue + 별도 worker` 구조로 확장했습니다.
- `site_jobs`를 실제 queue처럼 쓰기 위해 lease/claim metadata를 추가했습니다.
  - `queue_name`, `priority`, `attempt_count`, `max_attempts`
  - `claimed_by`, `claimed_at`, `heartbeat_at`
  - `available_at`, `started_at`, `finished_at`
- 새 worker 모듈 추가:
  - `src/kera_research/services/job_runner.py`
  - `src/kera_research/worker.py`
- 다음 작업이 queue 기반으로 실행되도록 변경했습니다.
  - `initial training`
  - `benchmark training`
  - `cross-validation`
  - `site validation`
- API는 이제 작업을 enqueue만 하고 즉시 `job_id`를 반환합니다.
- 프론트는 기존 `site job polling`을 유지하면서, 병원 검증도 job 완료까지 polling 후 결과를 반영하도록 변경했습니다.
- 로컬 실행 스크립트 보강:
  - `scripts/run_job_worker.ps1` 추가
  - `scripts/run_local_node.ps1`가 API, worker, frontend를 함께 실행
- stale running job 재큐잉을 위한 heartbeat/reclaim 로직을 worker에 추가했습니다.
- 관련 테스트를 queue 기반 흐름에 맞게 갱신했습니다.
