# K-ERA Research Platform

감염성 각막염(infectious keratitis) AI 연구를 위한 데이터셋 큐레이션 및 외부 검증 플랫폼입니다.

이 프로젝트는 임상 진단용 의료기기가 아니라, 다기관 연구 환경에서 슬릿램프 이미지 데이터셋을 정리하고, 병원별 로컬 데이터로 외부 검증을 수행하며, Federated Learning 방식으로 다기관 모델을 점진적으로 개선하는 연구 워크플로우 도구입니다.

한국인 임상의 및 연구자가 최소한의 코딩 지식으로 사용할 수 있도록 Streamlit 기반의 단계형(Case Wizard) UI로 구성했습니다.

## 1. 핵심 철학

- **원본 이미지는 병원 내부 로컬 환경에만 저장합니다.**
- 중앙 서버는 프로젝트 메타데이터, 모델 버전, 기여 통계, 집계된 모델 업데이트만 관리합니다.
- 원본 슬릿램프 이미지를 외부로 전송하지 않아 보안·프라이버시 규정을 준수합니다.
- Federated Learning: 각 병원에서 로컬 파인튜닝 후 가중치 델타만 중앙에 전송합니다.
- 외부 검증(External Validation) → 기여(Contribute) → 중앙 집계(FedAvg Aggregation) 순서를 권장합니다.

## 2. Case Wizard 워크플로우

임상의가 진료 후 단계별로 케이스를 입력하는 7단계 wizard 구조입니다.

```
[1] 환자  →  [2] 방문  →  [3] 이미지  →  [4] 검증  →  [5] 시각화  →  [6] 기여  →  [7] 완료
```

| 단계 | 내용 |
|------|------|
| 1. 환자 | 기존 환자 검색 + 이전 방문 타임라인 확인 / 신규 환자 등록 |
| 2. 방문 | 방문일, Culture 결과, 균종, 콘택트렌즈, 선행요인, **활성기(active_stage)** 여부 입력 |
| 3. 이미지 | 슬릿램프 이미지 다중 업로드, view(white/slit/fluorescein) 지정, 대표 이미지 선택 |
| 4. 검증 | 글로벌 모델 선택, 실행 모드(Auto/CPU/GPU) 선택, 즉시 추론 실행, 예측 확률 바 확인 |
| 5. 시각화 | 원본 이미지 \| MedSAM ROI crop \| Grad-CAM 3단 비교 |
| 6. 기여 | Federated Learning 설명 확인, 로컬 파인튜닝 후 가중치 델타 기여 또는 저장만 선택 |
| 7. 완료 | 감사 메시지 + 사이트 기여 통계 카드 (누적 케이스 수, 기여 횟수, 마지막 기여일) |

사이드바에서 언제든지 **새 케이스**, **대시보드**, **관리자 패널**로 이동할 수 있습니다.

## 3. 지원 모델 구조

### 현재 지원 아키텍처

| 아키텍처 | 용도 |
|----------|------|
| CNN baseline | 경량 baseline, MedSAM crop 없이 동작 |
| ViT baseline | 경량 baseline, MedSAM crop 없이 동작 |
| Swin baseline | 경량 baseline, MedSAM crop 없이 동작 |
| **DenseNet121** | **사전학습 모델(.pth) 연동, MedSAM crop 필수** |
| **DenseNet161** | **사전학습 모델(.pth) 연동, MedSAM crop 필수** |
| **DenseNet169** | **사전학습 모델(.pth) 연동, MedSAM crop 필수** |
| **DenseNet201** | **사전학습 모델(.pth) 연동, MedSAM crop 필수** |

### DenseNet .pth 파일 연동

기존에 DenseNet으로 학습한 `.pth` 파일이 있다면 바로 연동할 수 있습니다.

`_load_densenet_flexible()` 함수가 다음 5가지 checkpoint 형식을 자동으로 처리합니다.

- 일반 state_dict
- `module.` prefix (DataParallel로 학습한 경우)
- `model.` prefix (wrapper 클래스로 저장한 경우)
- `state_dict` key 안에 저장된 경우
- `model_state_dict` key 안에 저장된 경우

`.pth` 파일이 없으면 해당 모델은 `ready: False`로 등록되어 추론에 사용되지 않습니다.

### 초기 학습 (Initial Training)

원본 이미지만 있고 아직 학습 데이터를 정리하지 않은 경우, 앱 내 **관리자 패널 → 초기 학습** 탭에서 처음부터 학습할 수 있습니다.

- ImageNet pretrained DenseNet을 backbone으로 사용
- 관리자가 직접 train/val split 비율, 에폭 수, 학습률을 설정
- augmentation(좌우 반전, 밝기/대비 jitter) 자동 적용
- Cosine Annealing LR scheduler 사용
- 실시간 progress bar + 학습/검증 손실 차트 제공
- best validation loss 기준 모델 자동 저장 후 모델 레지스트리에 등록

## 4. Federated Learning

### 구조 (B안: 이미지 외부 전송 없음)

```
[병원 A 로컬 파인튜닝] ──┐
[병원 B 로컬 파인튜닝] ──┼──▶ 가중치 델타만 중앙 전송 ──▶ FedAvg 집계 ──▶ 새 글로벌 모델 배포
[병원 C 로컬 파인튜닝] ──┘
```

- 원본 이미지는 각 병원 로컬에만 존재합니다.
- 중앙에는 **가중치 델타(weight delta)** 만 전송됩니다.
- 집계는 **케이스 수 가중 FedAvg(weighted average)** 방식으로 수행됩니다.
- 관리자가 집계 시 참여 사이트와 round를 선택합니다.

### 기여 통계

각 사이트의 기여 이력은 `contributions.json`에 저장됩니다.

- 누적 기여 케이스 수
- 기여 횟수
- 마지막 기여일

기여 완료 후 7단계 완료 화면에서 확인할 수 있습니다.

## 5. 시스템 구조

### SaaS Control Plane

중앙에서 관리하는 영역입니다.

- 사용자 로그인
- 프로젝트 관리
- 사이트(병원) 등록
- 균종 드롭다운 및 신규 균종 요청 승인
- 모델 버전 관리
- 검증 통계 저장
- **기여 이력 및 집계 기록 관리**
- **Federated aggregation (FedAvg) 실행 및 새 모델 버전 등록**

### Local Data Plane

각 병원 내부에서 운영하는 영역입니다.

- 이미지 로컬 저장
- 환자/방문/이미지 메타데이터 저장
- 데이터셋 manifest 자동 생성
- MedSAM ROI 생성
- **DenseNet 추론 (MedSAM crop → DenseNet 파이프라인)**
- Grad-CAM 시각화
- 외부 검증 수행 (per-case 즉시 추론)
- **로컬 파인튜닝 후 가중치 델타 생성**
- **초기 학습 (ImageNet pretrained DenseNet 처음부터 학습)**

## 6. 주요 기능

### Case Wizard

- 7단계 단계형 입력 화면
- 환자 검색 및 이전 방문 타임라인
- 신규 환자 등록
- Culture 정보 입력 (confirmed, category, species)
- **active_stage(활성기)** 토글: 활성기 케이스 학습 기여 우선 적용
- 슬릿램프 이미지 다중 업로드 (view 지정, 대표 이미지 선택)
- 즉시 추론(per-case validation)
- 원본 | MedSAM crop | Grad-CAM 3단 비교 시각화
- Federated Learning 기여 또는 저장만 선택

### 일괄 데이터 임포트

기존에 정리된 데이터가 있거나 다량의 케이스를 한 번에 입력할 때 사용합니다.

- **관리자 패널 → 데이터 임포트** 탭 사용
- CSV 템플릿 다운로드 → 작성 후 ZIP(CSV + 이미지)으로 압축
- ZIP 업로드 → 자동 파싱 및 데이터 저장

### 연구 대시보드

- 누적 케이스 수, Culture 분포(bacterial/fungal) 차트
- 최근 검증 이력 테이블

### 관리자 패널 (6탭)

| 탭 | 기능 |
|----|------|
| 데이터 임포트 | CSV 템플릿 다운로드 + ZIP 일괄 임포트 |
| 초기 학습 | ImageNet pretrained DenseNet 처음부터 학습 |
| 모델 관리 | 글로벌 모델 목록, 버전 관리 |
| 사이트 관리 | 병원 등록 및 조회 |
| 균종 관리 | 균종 드롭다운 관리 및 신규 요청 승인 |
| Federated | 기여 이력 조회, FedAvg 집계 실행, 새 모델 배포 |

## 7. 연구 데이터 입력 규칙

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
- `active_stage` (활성기 여부, 기본값 true)

### 이미지 정보

각 업로드 이미지에 대해 사용자가 직접 다음을 지정합니다.

- `view`
  - `white`
  - `slit`
  - `fluorescein`
- `is_representative`

자동 view 분류는 하지 않습니다.

## 8. 균종 관리

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

## 9. 폴더 구조

### 로컬 데이터 (병원 내부)

```text
storage/sites/<site_id>/
  data/raw/<patient_id>/<visit_date>/image_file.jpg
  patients.json
  visits.json
  images.json
  manifests/dataset_manifest.csv
  artifacts/gradcam/
  artifacts/medsam_masks/
  artifacts/roi_crops/
  model_updates/
  contributions.json
```

### 중앙 Control Plane

```text
storage/control_plane/
  projects.json
  sites.json
  organism_catalog.json
  organism_requests.json
  model_registry.json
  validation_runs.json
  validation_cases/
  model_updates.json
  contributions/
  aggregations/
```

## 10. Manifest 스키마

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
- `active_stage`
- `view`
- `image_path`
- `is_representative`

상세 스키마는 [docs/dataset_schema.md](docs/dataset_schema.md) 문서를 참고하면 됩니다.

## 11. 실행 환경

### 권장 스택

- Python 3.10+
- Streamlit
- PyTorch
- torchvision
- pandas
- plotly
- Pillow
- scikit-learn

### 임상의용 권장 실행 방식

임상의 또는 일반 연구자가 직접 `pip install`을 입력하는 방식은 권장하지 않습니다.

권장 구조는 다음과 같습니다.

- 연구자/임상의: 브라우저만 사용
- 병원 IT 또는 설치 담당자: Local Node 1회 설치 및 업데이트 담당

설치 담당자는 프로젝트 루트에서 아래 두 명령만 사용하면 됩니다.

```powershell
.\scripts\setup_local_node.ps1
.\scripts\run_local_node.ps1
```

이 스크립트는 가상환경 생성, 패키지 설치, 기본 health check, Streamlit 실행을 순서대로 처리합니다.

상세 운영 방식은 [docs/local_node_deployment.md](docs/local_node_deployment.md)를 참고하면 됩니다.

### 개발/테스트용 수동 설치

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 실행

```powershell
.\scripts\run_local_node.ps1
```

브라우저가 열리면 로그인 후 사용할 수 있습니다.

### 기본 계정

- 관리자: `admin / admin123`
- 연구자: `researcher / research123`

## 12. GPU / CPU 동작 방식

앱은 실행 시 하드웨어를 자동 감지합니다.

실행 모드는 다음 세 가지입니다.

| 모드 | 동작 |
|------|------|
| Auto | CUDA 가능 시 GPU, 아니면 CPU 자동 선택 |
| CPU mode | 대표 이미지 중심 추론, classifier head 중심 제한적 학습 |
| GPU mode | 전체 배치 처리, MedSAM batch, 전체 모델 fine-tuning |

## 13. MedSAM 및 시각화

### MedSAM

- 환경변수 `MEDSAM_SCRIPT`, `MEDSAM_CHECKPOINT` 설정 시 외부 MedSAM 추론 스크립트 호출
- 설정이 없을 경우 fallback ROI 생성 로직 동작 (워크플로우 테스트용)
- DenseNet 모델은 MedSAM crop을 필수 전처리로 사용 (`requires_medsam_crop: True`)

### 설명 가능성 시각화

| 모델 | 시각화 방식 |
|------|------------|
| CNN | Grad-CAM overlay |
| ViT | patch embedding 기반 CAM overlay |
| Swin | hierarchical window stage 기반 CAM overlay |
| DenseNet | Grad-CAM (denseblock4 타겟) |

## 14. 프로젝트 구조

```text
project_K-ERA/
├── app.py                              # Streamlit 실행 진입점
├── requirements.txt                    # 의존성 목록 (torchvision 포함)
├── src/kera_research/
│   ├── config.py                       # 경로, 기본 계정, 모델 기본 설정
│   ├── domain.py                       # 공통 상수, 옵션값, 스키마 정의
│   ├── storage.py                      # JSON/CSV 저장 유틸리티
│   ├── ui.py                           # Streamlit UI (Case Wizard 7단계)
│   └── services/
│       ├── control_plane.py            # 중앙 메타데이터, 기여 통계, FedAvg 집계
│       ├── data_plane.py               # 병원 로컬 데이터 저장소
│       ├── hardware.py                 # CPU/GPU 감지
│       ├── runtime.py                  # 로컬 노드 설치 상태 및 AI 준비 상태 점검
│       ├── artifacts.py                # MedSAM 어댑터
│       ├── modeling.py                 # CNN/ViT/Swin/DenseNet 모델, 추론, 시각화, 학습
│       └── pipeline.py                 # validation, contribution, initial training orchestration
├── docs/
│   ├── dataset_schema.md               # 데이터 스키마 문서
│   └── local_node_deployment.md        # Local Node 설치 및 운영 가이드
└── scripts/
    ├── setup_local_node.ps1            # Local Node 자동 설치 스크립트
    └── run_local_node.ps1              # Local Node 실행 스크립트
```

## 15. 사용 순서

### 신규 케이스 입력 (Case Wizard)

1. 사이드바에서 사이트(병원) 선택
2. **새 케이스** 버튼 클릭
3. 환자 검색 또는 신규 등록
4. 방문 정보 입력 (culture 결과, 균종, active_stage 등)
5. 슬릿램프 이미지 업로드 및 view 지정
6. 글로벌 모델로 즉시 검증 실행
7. Grad-CAM / MedSAM crop 시각화 확인
8. Federated Learning 기여 또는 저장만 선택
9. 기여 통계 확인 후 완료

### 일괄 데이터 임포트

1. **관리자 패널 → 데이터 임포트** 탭 이동
2. CSV 템플릿 다운로드
3. 케이스 정보 입력 후 이미지와 함께 ZIP으로 압축
4. ZIP 파일 업로드

### 처음부터 학습 (원본 이미지만 있는 경우)

1. 일괄 임포트로 원본 이미지 및 메타데이터 등록
2. **관리자 패널 → 초기 학습** 탭 이동
3. 사이트, 모델 아키텍처, 하이퍼파라미터 설정
4. 학습 시작 → 실시간 학습 곡선 모니터링
5. 완료 후 모델 레지스트리에 자동 등록

### Federated Aggregation (관리자)

1. **관리자 패널 → Federated** 탭 이동
2. 각 사이트의 기여 이력 확인
3. 집계에 참여할 사이트 선택
4. FedAvg 집계 실행
5. 새 글로벌 모델 버전으로 등록 및 배포

## 16. UI / UX 특징

- 7단계 wizard 구조로 복잡한 데이터 입력을 단순화
- 상단 step indicator로 현재 위치와 진행 상황 표시
- 환자 이전 방문 타임라인 표시
- 즉시 추론 결과를 확률 바(probability bar)로 시각적으로 표시
- 원본 | MedSAM crop | Grad-CAM 3단 비교 화면
- 기여 완료 후 통계 카드(누적 케이스, 기여 횟수, 마지막 기여일) 표시
- AI 모듈이 준비되지 않은 경우 설치 상태 안내 표시
- 한국어 기본, 영어 전환 지원

## 17. 다국어(i18n)

현재 지원 언어:

- 한국어 (기본)
- 영어

앱 좌측 사이드바에서 언어를 전환할 수 있습니다.

## 18. 주의사항

- 이 프로젝트는 연구 워크플로우용입니다.
- 임상 진단이나 치료 의사결정을 위한 소프트웨어가 아닙니다.
- 기본 포함 모델(CNN/ViT/Swin baseline)은 데모용입니다.
- DenseNet .pth 파일은 별도로 준비해야 합니다.
- 실제 연구 적용 시 보안, 익명화, 접근권한, 감사로그, IRB 및 기관 정책을 별도로 검토해야 합니다.

## 19. 다음 개발 권장 사항

- 실제 MedSAM inference 파이프라인 연결 (현재 fallback ROI 사용)
- 비동기 job queue 및 worker 도입 (초기 학습, 집계 background 처리)
- 다기관 federated aggregation REST API 추가
- 사용자/권한 체계 강화 (RBAC, 2FA)
- 감사로그(audit trail) 추가
- 보고서 및 export 템플릿 완전한 i18n 확장
- longitudinal visit modeling 확장
- multimodal fusion 확장
- 성능 비교 대시보드 고도화
- 모바일용 read-only 결과 화면 고도화

## 20. 빠른 시작 요약

```powershell
.\scripts\setup_local_node.ps1
.\scripts\run_local_node.ps1
```

로그인 후:

1. 사이트 등록 (관리자 패널)
2. 새 케이스 버튼 클릭
3. 환자 → 방문 → 이미지 → 검증 → 시각화 → 기여 → 완료

이 순서만 따르면 MVP 전체 흐름을 바로 확인할 수 있습니다.
