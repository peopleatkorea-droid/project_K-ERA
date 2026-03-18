# Changelog

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
