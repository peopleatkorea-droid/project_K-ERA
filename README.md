# K-ERA Research Platform

감염성 각막염(infectious keratitis) AI 연구를 위한 데이터셋 큐레이션 및 외부 검증 플랫폼 MVP입니다.

이 프로젝트는 임상 진단용 의료기기가 아니라, 다기관 연구 환경에서 슬릿램프 이미지 데이터셋을 정리하고, 병원별 로컬 데이터로 외부 검증을 수행하며, 필요 시 로컬 파인튜닝까지 지원하는 연구 워크플로우 도구입니다.

한국인 임상의 및 연구자가 최소한의 코딩 지식으로 사용할 수 있도록 Streamlit 기반의 단순한 UI로 구성했습니다.

현재 UI는 다음 방향을 반영합니다.

- 임상의 중심 단계형 워크플로우
- 한국어 기본, 영어 전환 지원
- 모바일에서 결과와 통계를 확인하기 쉬운 반응형 요약 카드 및 탭 구조

## 1. 핵심 철학

- 원본 이미지는 병원 내부 로컬 환경에만 저장합니다.
- 중앙 SaaS 서버는 프로젝트, 메타데이터, 모델 버전, 검증 통계, 모델 업데이트만 관리합니다.
- 원본 슬릿램프 이미지를 중앙 서버로 업로드할 필요가 없습니다.
- 다기관 협업을 전제로 설계되어 있습니다.
- 외부 검증을 먼저 수행한 뒤, 선택적으로 로컬 파인튜닝을 진행합니다.

즉, 이 플랫폼은 "데이터는 각 병원에 남기고, 연구 관리와 모델 개선 흐름만 중앙에서 연결하는 구조"를 목표로 합니다.

## 2. 시스템 구조

### SaaS Control Plane

중앙에서 관리하는 영역입니다.

- 사용자 로그인
- 프로젝트 관리
- 사이트(병원) 등록
- 균종 드롭다운 및 신규 균종 요청 승인
- 모델 버전 관리
- 외부 검증 통계 저장
- 모델 업데이트 등록
- 향후 federated aggregation 확장 준비

### Local Data Plane

각 병원 내부에서 운영하는 영역입니다.

- 이미지 로컬 저장
- 환자/방문/이미지 메타데이터 저장
- 데이터셋 manifest 자동 생성
- MedSAM ROI 생성
- Grad-CAM 시각화
- 외부 검증 수행
- 선택적 로컬 파인튜닝

## 3. 주요 기능

- 감염성 각막염 연구 프로젝트 생성
- 병원별 site 등록
- 환자 등록
- 방문(visit) 등록
- culture-proven 케이스만 입력 허용
- 세균/진균 균종 선택
- 신규 균종 요청 및 관리자 승인
- 슬릿램프 이미지 업로드
- 이미지별 view 수동 지정
- 대표 이미지 선택
- manifest 자동 생성
- 글로벌 모델 기반 external validation
- validation summary 및 case-level prediction 저장
- Grad-CAM / ViT CAM / Swin CAM 시각화
- MedSAM ROI 생성
- 선택적 로컬 파인튜닝
- full weights / weight delta / aggregated update 형식의 업데이트 등록
- 한국어 / 영어 UI 전환
- 모바일에서 검증 요약 및 통계 확인 가능

## 4. 지원 모델 구조

현재 MVP는 세 가지 아키텍처를 모두 지원합니다.

- CNN baseline
- ViT baseline
- Swin baseline

외부 검증 화면에서 사용할 글로벌 모델을 선택할 수 있습니다.

- `global-cnn-baseline-v0.1`
- `global-vit-baseline-v0.1`
- `global-swin-baseline-v0.1`

현재 포함된 모델은 연구용 워크플로우를 검증하기 위한 경량 baseline입니다. 실제 연구 성능을 위한 최종 모델은 아니며, 추후 사전학습된 stronger backbone으로 교체하는 것을 권장합니다.

## 5. 연구 데이터 입력 규칙

### 필수 조건

- culture-proven keratitis case만 허용
- 방문 등록 시 `culture_confirmed = true`여야 함

### 필수 환자 정보

- `patient_id`
- `sex`
- `age`

### 필수 방문 정보

- `visit_date`
- `culture_confirmed`
- `culture_category`
- `culture_species`
- `contact_lens_use`
- `predisposing_factor`

### 이미지 정보

각 업로드 이미지에 대해 사용자가 직접 다음을 지정합니다.

- `view`
  - `white`
  - `slit`
  - `fluorescein`
- `is_representative`

자동 view 분류는 하지 않습니다.

## 6. 균종 관리

초기 드롭다운은 다음을 포함합니다.

### Bacterial

- Staphylococcus aureus
- Staphylococcus epidermidis
- Streptococcus pneumoniae
- Pseudomonas aeruginosa
- Moraxella
- Nocardia
- Other

### Fungal

- Fusarium
- Aspergillus
- Candida
- Curvularia
- Alternaria
- Other

목록에 없는 균종은 사용자가 요청할 수 있으며, 관리자가 승인하면 중앙 catalog에 반영됩니다.

## 7. 폴더 구조

원본 이미지는 사이트별 로컬 폴더에 저장됩니다.

```text
storage/sites/<site_id>/data/raw/<patient_id>/<visit_date>/image_file.jpg
```

예시:

```text
storage/sites/SNUH/data/raw/P001/2026-03-10/image_01.jpg
```

실행 중 생성되는 주요 로컬 데이터:

- `storage/sites/<site_id>/patients.json`
- `storage/sites/<site_id>/visits.json`
- `storage/sites/<site_id>/images.json`
- `storage/sites/<site_id>/manifests/dataset_manifest.csv`
- `storage/sites/<site_id>/artifacts/gradcam/`
- `storage/sites/<site_id>/artifacts/medsam_masks/`
- `storage/sites/<site_id>/artifacts/roi_crops/`
- `storage/sites/<site_id>/model_updates/`

중앙 control plane에는 다음이 저장됩니다.

- `storage/control_plane/projects.json`
- `storage/control_plane/sites.json`
- `storage/control_plane/organism_catalog.json`
- `storage/control_plane/organism_requests.json`
- `storage/control_plane/model_registry.json`
- `storage/control_plane/validation_runs.json`
- `storage/control_plane/validation_cases/`
- `storage/control_plane/model_updates.json`

## 8. Manifest 스키마

최소 manifest 컬럼은 다음과 같습니다.

- `patient_id`
- `sex`
- `age`
- `visit_date`
- `culture_confirmed`
- `culture_category`
- `culture_species`
- `contact_lens_use`
- `predisposing_factor`
- `view`
- `image_path`
- `is_representative`

상세 스키마는 [docs/dataset_schema.md](docs/dataset_schema.md) 문서를 참고하면 됩니다.

## 9. 실행 환경

### 권장 스택

- Python
- Streamlit
- PyTorch
- pandas
- plotly
- Pillow
- scikit-learn

### 설치

PowerShell 기준:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 실행

```powershell
streamlit run app.py
```

브라우저가 열리면 로그인 후 사용할 수 있습니다.

### 기본 계정

- 관리자: `admin / admin123`
- 연구자: `researcher / research123`

## 10. UI / UX 특징

임상의 사용성을 높이기 위해 다음 요소를 반영했습니다.

- 현재 단계와 다음 권장 작업을 상단에서 바로 확인 가능
- 환자, 방문, 이미지, 검증 진행 상태를 카드형 요약으로 표시
- 입력 화면을 단계별로 분리해 복잡도를 낮춤
- 모델 선택, 실행 모드, 설명 시각화 옵션을 한 화면에서 직관적으로 배치
- 검증 결과는 요약, 추이, 증례 탭으로 나누어 모바일에서도 보기 쉽게 구성

## 11. 다국어(i18n)

현재 지원 언어:

- 한국어
- 영어

앱 좌측 사이드바에서 언어를 전환할 수 있습니다.

권장 정책:

- 기본 운영 언어는 한국어
- 해외 공동연구자와 공유할 때 영어로 전환

현재는 UI 레벨의 한국어/영어 전환을 우선 적용한 상태이며, 향후 더 확장하려면 다음 항목도 함께 국제화하는 것이 좋습니다.

- 내보내기 보고서 문구
- 검증 요약 PDF / 슬라이드 템플릿
- 이메일 알림 및 승인 흐름
- 서버 API 응답 메시지

## 12. 모바일 대응

이 프로젝트는 모바일에서 전체 데이터 입력용으로 최적화된 앱은 아니지만, 다음 용도에는 충분히 대응하도록 구성했습니다.

- 검증 요약 확인
- AUROC / accuracy / sensitivity / specificity 확인
- 증례별 결과 확인
- Grad-CAM 및 ROI 결과 빠른 확인

모바일 대응 방식:

- 반응형 통계 카드
- 탭 기반 결과 화면
- `use_container_width=True` 기반 차트 확장
- 작은 화면에서 자동으로 좁아지는 카드 레이아웃

권장 사용 방식:

- 데이터 입력과 파일 업로드는 데스크톱
- 결과 검토와 통계 확인은 모바일 또는 태블릿

## 13. 사용 순서

실제 연구자가 사용하는 기본 순서는 다음과 같습니다.

1. 프로젝트 생성
2. 사이트(병원) 등록
3. 환자 등록
4. 방문 등록
5. 슬릿램프 이미지 업로드
6. 이미지 view 수동 지정
7. 대표 이미지 선택
8. manifest 생성
9. 현재 글로벌 모델로 external validation 수행
10. validation summary와 case-level prediction 확인
11. 필요 시 로컬 fine-tuning 수행
12. 모델 업데이트만 중앙에 등록

## 14. External Validation 워크플로우

이 플랫폼의 중요한 원칙은 새 사이트 데이터가 들어오면 먼저 external validation을 수행하는 것입니다.

전체 순서는 다음과 같습니다.

1. 데이터 업로드
2. manifest 자동 생성
3. 현재 글로벌 모델로 external validation
4. validation summary 저장
5. case-level prediction 저장
6. 필요 시 Grad-CAM / MedSAM artifact 생성
7. 필요 시 로컬 fine-tuning
8. raw image 대신 model update만 중앙 등록

## 15. GPU / CPU 동작 방식

앱은 실행 시 하드웨어를 자동 감지합니다.

- CPU
- GPU 사용 가능 여부
- GPU 모델명
- CUDA 버전

실행 모드는 다음 세 가지입니다.

- `Auto`
- `CPU mode`
- `GPU mode`

### Auto

- CUDA 가능 시 GPU 사용
- 아니면 CPU 사용

### GPU mode

- 전체 데이터 배치 처리에 적합
- MedSAM batch 처리 가능
- Grad-CAM / ViT CAM / Swin CAM batch 생성 가능
- 전체 모델 fine-tuning 가능

### CPU mode

- 대화형 실행에서는 대표 이미지 중심으로 MedSAM/시각화 제한
- 전체 MedSAM은 background job 형태로 큐잉 가능
- 파인튜닝은 classifier head 중심의 제한적 학습
- epoch 수는 보수적으로 제한

## 16. MedSAM 및 시각화

### MedSAM

다음 두 가지 방식으로 동작합니다.

1. 외부 MedSAM 스크립트 연동
2. fallback ROI 생성

환경변수 `MEDSAM_SCRIPT`, `MEDSAM_CHECKPOINT`를 설정하면 외부 MedSAM 추론 스크립트를 호출할 수 있습니다.

설정이 없을 경우에도 워크플로우를 테스트할 수 있도록 fallback ROI 생성 로직이 동작합니다. 다만 실제 연구에서는 정식 MedSAM inference pipeline으로 교체하는 것이 적절합니다.

### 설명 가능성 시각화

- CNN: Grad-CAM 스타일 overlay
- ViT: patch embedding 기반 CAM overlay
- Swin: hierarchical window stage 기반 CAM overlay

즉, 선택한 모델 구조에 따라 해석 시각화 방식이 달라집니다.

## 17. 프로젝트 구조

- `app.py`
  - Streamlit 실행 진입점
- `requirements.txt`
  - 의존성 목록
- `src/kera_research/config.py`
  - 경로, 기본 계정, 모델 기본 설정
- `src/kera_research/domain.py`
  - 공통 상수, 옵션값, 스키마 정의
- `src/kera_research/storage.py`
  - JSON/CSV 저장 유틸리티
- `src/kera_research/services/control_plane.py`
  - 중앙 메타데이터 저장소
- `src/kera_research/services/data_plane.py`
  - 병원 로컬 데이터 저장소
- `src/kera_research/services/hardware.py`
  - CPU/GPU 감지
- `src/kera_research/services/artifacts.py`
  - MedSAM 어댑터
- `src/kera_research/services/modeling.py`
  - CNN/ViT/Swin 모델, 추론, 시각화, 파인튜닝
- `src/kera_research/services/pipeline.py`
  - external validation 및 training orchestration
- `src/kera_research/ui.py`
  - Streamlit UI 화면
- `docs/dataset_schema.md`
  - 데이터 스키마 문서

## 18. 제공되는 MVP 화면

1. Project dashboard
2. Patient registration
3. Visit entry
4. Image upload + view assignment
5. Representative image selection
6. Dataset review table
7. External validation run
8. Validation results dashboard
9. Grad-CAM viewer
10. MedSAM ROI viewer

## 19. 주의사항

- 이 프로젝트는 연구 워크플로우용입니다.
- 임상 진단이나 치료 의사결정을 위한 소프트웨어가 아닙니다.
- 기본 포함 모델은 데모용 baseline입니다.
- 실제 연구 적용 시 보안, 익명화, 접근권한, 감사로그, IRB 및 기관 정책을 별도로 검토해야 합니다.

## 20. 다음 개발 권장 사항

- stronger pretrained CNN / ViT / Swin backbone 도입
- 실제 MedSAM inference 파이프라인 연결
- 비동기 job queue 및 worker 도입
- 다기관 federated aggregation API 추가
- longitudinal visit modeling 확장
- multimodal fusion 확장
- 성능 비교 대시보드 고도화
- 사용자/권한 체계 강화
- 보고서 및 export 템플릿의 완전한 i18n 확장
- 모바일용 read-only 결과 화면 고도화

## 21. 빠른 시작 요약

처음 실행하는 연구자를 위한 최소 순서만 다시 정리하면 다음과 같습니다.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py
```

로그인 후:

1. 프로젝트 생성
2. 사이트 등록
3. 환자/방문 입력
4. 이미지 업로드
5. 대표 이미지 지정
6. manifest 생성
7. 외부 검증 실행
8. 필요 시 로컬 파인튜닝

이 순서만 따르면 MVP 전체 흐름을 바로 확인할 수 있습니다.
