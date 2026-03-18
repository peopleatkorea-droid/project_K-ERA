# Control Plane Split Migration

현재 K-ERA가 single-DB SQLite로 운영 중인 병원 로컬 노드를, 다음 구조로 전환할 때 사용하는 절차입니다.

- `control plane`: Neon PostgreSQL
- `data plane`: 병원 로컬 SQLite
- `control plane files`: 공유 스토리지
- `raw patient data / images`: 병원 로컬 파일시스템

## 목표 경계

중앙으로 이동:

- `users`
- `projects`
- `sites`
- `institution_directory`
- `organism_catalog`
- `organism_requests`
- `access_requests`
- `validation_runs`
- `model_versions`
- `model_updates`
- `experiments`
- `contributions`
- `aggregations`
- `app_settings`

병원 로컬 유지:

- `patients`
- `visits`
- `images`
- `site_patient_splits`
- `site_jobs`
- `sites/<SITE_ID>/data/raw`
- raw `patient_id`
- `actual_visit_date`
- 로컬 `image_path`

## 권장 환경변수

병원 노드:

```powershell
KERA_CONTROL_PLANE_API_BASE_URL=https://<control-plane-host>/control-plane/api
KERA_LOCAL_CONTROL_PLANE_DATABASE_URL=sqlite:///C:/Users/USER/Downloads/KERA_DATA/control_plane_cache.db
KERA_DATA_PLANE_DATABASE_URL=sqlite:///C:/Users/USER/Downloads/KERA_DATA/kera.db
KERA_STORAGE_DIR=C:\Users\USER\Downloads\KERA_DATA
KERA_CONTROL_PLANE_DIR=Z:\KERA_SHARED\control_plane
KERA_CONTROL_PLANE_ARTIFACT_DIR=Z:\KERA_SHARED\control_plane\artifacts
KERA_MODEL_DIR=Z:\KERA_SHARED\models
KERA_MODEL_DISTRIBUTION_MODE=download_url
```

집/관리자 PC:

```powershell
KERA_CONTROL_PLANE_DATABASE_URL=postgresql://<neon-user>:<password>@<host>/<db>?sslmode=require
KERA_DATA_PLANE_DATABASE_URL=sqlite:///C:/Users/USER/Downloads/KERA_DATA/home_empty_data_plane.db
KERA_CONTROL_PLANE_DIR=Z:\KERA_SHARED\control_plane
KERA_CONTROL_PLANE_ARTIFACT_DIR=Z:\KERA_SHARED\control_plane\artifacts
KERA_MODEL_DIR=Z:\KERA_SHARED\models
KERA_MODEL_DISTRIBUTION_MODE=download_url
```

주의:

- `KERA_CONTROL_PLANE_DIR`와 `KERA_MODEL_DIR`은 집/병원 관리자 PC에서 같은 공유 경로로 보이게 맞추는 것을 권장합니다.
- `KERA_DATA_PLANE_DATABASE_URL`은 병원에서만 실제 환자 데이터가 있는 로컬 SQLite를 가리켜야 합니다.
- 최소 리스크 cutover를 원하면 병원에서는 기존 single-DB 파일 `kera.db`를 그대로 data plane DB로 재사용해도 됩니다. 이 경우 로컬 DB 안에 옛 control-plane 테이블이 남아 있어도 앱은 Neon을 control plane으로 사용합니다.

## 실행 순서

1. 현재 로컬 SQLite 백업 생성
2. dry-run 수행
3. source row count 확인
4. target row count 비교
5. path audit 확인
6. 승인 후 실제 migration 실행
7. `.env.local`을 split mode로 전환
8. 병원/집 양쪽에서 표시 항목 검증

## Dry-Run

```powershell
.\.venv\Scripts\python.exe .\scripts\migrate_control_plane_to_split.py `
  --source-url sqlite:///C:/Users/USER/Downloads/KERA_DATA/kera.db `
  --target-url "postgresql://<neon-user>:<password>@<host>/<db>?sslmode=require" `
  --rewrite-control-plane-dir "Z:\KERA_SHARED\control_plane" `
  --rewrite-control-plane-artifact-dir "Z:\KERA_SHARED\control_plane\artifacts" `
  --rewrite-model-dir "Z:\KERA_SHARED\models"
```

Dry-run은 target row count `before`, `would_insert`, `would_update`, path audit, filesystem audit를 JSON 리포트와 콘솔 출력으로 남깁니다.

기본 리포트 경로:

- `artifacts/control_plane_migration_report.json`

## 실제 Migration

```powershell
.\.venv\Scripts\python.exe .\scripts\migrate_control_plane_to_split.py `
  --source-url sqlite:///C:/Users/USER/Downloads/KERA_DATA/kera.db `
  --target-url "postgresql://<neon-user>:<password>@<host>/<db>?sslmode=require" `
  --rewrite-control-plane-dir "Z:\KERA_SHARED\control_plane" `
  --rewrite-control-plane-artifact-dir "Z:\KERA_SHARED\control_plane\artifacts" `
  --rewrite-model-dir "Z:\KERA_SHARED\models" `
  --sanitize-control-plane-files `
  --execute
```

정책:

- 기본 정책은 모든 대상 테이블에 대해 `upsert_by_primary_key`
- source DB에 없는 테이블은 `skip_missing_or_external_schema`
- PostgreSQL의 integer PK sequence는 실행 후 자동 동기화

## 검증 체크리스트

병원과 집에서 모두 확인:

- 같은 `project`
- 같은 `site`
- 같은 `user`
- 같은 `access_request`
- 같은 `organism_catalog`
- 같은 `validation_runs` summary
- 같은 `model_versions`
- 같은 `model_updates`
- 같은 `experiments`
- 같은 `contributions`
- 같은 `aggregations`

병원에서만 확인:

- `patients`
- `visits`
- `images`
- raw 원본 이미지
- 실제 `actual_visit_date`
- 로컬 `image_path`

## Path Audit 해석

다음이 보이면 공유 스토리지 또는 path rewrite가 필요합니다.

- `model_versions.payload_json.model_path`
- `validation_runs.case_predictions_path`
- `model_updates.payload_json.*path`
- `experiments.payload_json.*path`
- control-plane JSON 파일 내부의 절대경로

다음이 보이면 중앙 공유 전에 sanitize가 필요합니다.

- control-plane filesystem audit 안의 raw `patient_id`
- control-plane filesystem audit 안의 정확한 `visit_date` / `actual_visit_date`

## Rollback

DB rollback:

1. 앱 중지
2. `.env.local`에서 `KERA_CONTROL_PLANE_DATABASE_URL`, `KERA_DATA_PLANE_DATABASE_URL`을 split 전 상태로 되돌림
3. 필요 시 `C:\Users\USER\Downloads\KERA_DATA\kera.pre_split_backup_<timestamp>.db`를 원래 `kera.db`로 복원

Neon rollback:

1. Neon 백업 또는 branch/restore point가 있으면 해당 시점으로 복원
2. 복원이 없으면 대상 control-plane 테이블을 비우고 local backup에서 다시 migrate

파일 rollback:

1. 공유 `control_plane` 디렉토리의 rewritten 파일 또는 새 artifact 제거
2. 이전 로컬 `KERA_STORAGE_DIR` 구조를 다시 사용

## 범위 밖

이번 전환은 control plane 분리까지입니다. 다음은 범위 밖입니다.

- 환자/방문/이미지 자체를 Neon으로 이전
- 병원 원본 이미지 반출
- data plane을 중앙 DB로 통합

## OneDrive/SharePoint 모델 배포

공유 저장소 대신 OneDrive/SharePoint 다운로드 링크를 쓸 때는 두 가지 방식이 있습니다.

- 권장: `KERA_ONEDRIVE_*` Graph 설정을 넣고 관리자 Registry의 `자동 발행` 버튼 사용
- 수동 fallback: 아래처럼 업로드 후 `scripts/publish_model_version.py`로 URL 등록

자동 발행을 쓰지 않는 경우 새 글로벌 모델을 바로 current로 쓰지 말고 다음 순서를 사용합니다.

1. 관리자 노드에서 학습 또는 aggregation 실행
2. 새 모델 version이 `pending_upload` 상태로 생성되는지 확인
3. 관리자 PC에서 모델 파일을 OneDrive/SharePoint 버전 폴더에 업로드
4. 공유 다운로드 URL 생성
5. 아래 스크립트로 해당 version을 publish

```powershell
.\.venv\Scripts\python.exe .\scripts\publish_model_version.py `
  --database-url "postgresql://<neon-user>:<password>@<host>/<db>?sslmode=require" `
  --version-id <MODEL_VERSION_ID> `
  --local-path "C:\Users\USER\OneDrive - 제주대학교\KERA model\keratitis_cls\1.1.0\model.pt" `
  --download-url "https://...sharepoint.com/...download..." `
  --set-current
```

publish 후 각 클라이언트 PC는 `download_url`을 통해 모델을 로컬 `KERA_MODEL_DIR\cache\...`에 자동 캐시합니다.
