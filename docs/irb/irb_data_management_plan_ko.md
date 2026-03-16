# IRB 데이터 관리계획서 초안

## 1. 목적

본 문서는 K-ERA 기반 감염성 각막염 연구에서 수집·저장·전송·보관되는 데이터의 범위와 보호조치를 설명하기 위한 데이터 관리계획서 초안이다.

## 2. 데이터 흐름 요약

```text
[기관 내부 브라우저]
   |
   v
[K-ERA Local Node]
   |- patient_id, actual_visit_date, 원본 이미지, 파생 산출물 저장
   |- EXIF 제거
   |- image_id 기반 파일명 생성
   |
   v
[K-ERA Control Plane]
   |- case_reference_id
   |- visit label (Initial / FU #N)
   |- validation / contribution / registry 상태
   |- 저해상도 review thumbnail (해당 시)
```

## 3. 데이터 항목 구분

### 3.1 기관 내부 Local Node 저장 항목

- patient ID
- chart alias
- local case code
- `actual_visit_date`
- 원본 안과 이미지
- ROI crop, lesion crop, mask, Grad-CAM 등 파생 산출물

### 3.2 중앙 Control Plane 저장 항목

- `case_reference_id`
- 방문 라벨(`Initial`, `FU #N`)
- 연구 registry 상태(`analysis_only`, `candidate`, `included`, `excluded`)
- validation / contribution 이력
- 성능지표, 모델 버전, 실험 메타데이터
- 승인 검토용 저해상도 썸네일(해당 시)

## 4. 가명처리 방식

중앙에서 사용하는 식별자는 다음 규칙으로 생성된다.

```text
case_reference_id = SHA256(KERA_CASE_REFERENCE_SALT + site_id + patient_id + visit_date)
```

설명:

- `patient_id`는 로컬 기관 내부에서만 원문으로 보관될 수 있다.
- 중앙에는 raw patient ID 대신 `case_reference_id`만 저장한다.
- `visit_date`는 중앙 공유 시 `Initial`, `FU #N` 등 방문 라벨만 사용한다.
- 정확한 방문일은 `actual_visit_date`로 로컬 저장에 한정한다.

따라서 중앙 저장본은 `추가정보 없이는 특정 개인을 알아보기 어려운 가명처리 정보`를 목표로 한다.

## 5. 영상정보 처리 방식

- 업로드 단계에서 EXIF 메타데이터를 제거한다.
- 저장 파일명은 원본 파일명이 아니라 `image_id` 기반 이름을 사용한다.
- review 목적으로 중앙 전송이 필요한 경우 저해상도 thumbnail만 사용한다.
- 원본 이미지 전체를 중앙 공용 저장소에 반출하는 것은 기본 구조로 하지 않는다.

## 6. 접근권한 관리

지원 역할:

- `admin`
- `site_admin`
- `researcher`
- `viewer`

권한 원칙:

- 각 사용자는 승인된 site에만 접근한다.
- 중앙 control plane은 인증 토큰 기반으로 접근한다.
- 원본 로컬 데이터는 site 단위 workspace 경로에 분리 저장한다.
- registry 활성화 여부는 site 단위 설정(`research_registry_enabled`)으로 관리한다.

## 7. 보관 및 파기 계획

- 로컬 원본 데이터: 기관 정책 및 연구기간에 따라 보관
- 중앙 registry 데이터: 연구 종료 후 `[보관기간]` 동안 보관 후 파기 또는 별도 승인된 보관체계로 이관
- 파기 시:
  - 데이터베이스 레코드 삭제
  - JSON report 및 thumbnail 삭제
  - 파일시스템 아티팩트 삭제

## 8. 재식별 위험 관리

재식별 위험을 줄이기 위해 다음을 적용한다.

- 중앙 저장 시 raw patient ID 미보관
- 정확한 달력 날짜 대신 방문 라벨 사용
- 원본 경로 미공유
- 기관 외부에서는 추가정보 없이 원문 환자 식별 불가하도록 설계

다만 로컬 기관 내부에는 patient ID와 실제 방문일이 남아 있으므로, 본 구조는 `완전 익명화`가 아니라 `가명처리`에 해당함을 명시한다.

## 9. Research Registry 운영 원칙

- 사이트가 registry를 활성화해야 함
- 사용자가 사이트별로 1회 registry opt-in 해야 함
- 적격 케이스는 자동 `candidate` 또는 `included` 상태가 될 수 있음
- 각 케이스는 `Included / Excluded` 상태를 화면에서 확인 가능
- 필요 시 케이스별 opt-out 가능

## 10. 기관 유형별 운영 권장

### 10.1 대학병원 / 승인된 기관

- research registry 활성화 가능
- 다기관 연구 cohort 포함 가능
- 중앙 검증 및 연구 registry 참여 권장

### 10.2 개인의원 / 소규모 기관

- 우선 `analysis-only` 운영 권장
- registry 참여는 기관 승인 구조가 정리된 후 확장
- 중앙 연구 dataset 핵심 편입은 별도 검토 권장

## 11. 별첨으로 권장되는 자료

- 시스템 아키텍처 도식
- case_reference_id 생성 개념도
- registry 상태 화면 캡처
- 관리자 검토용 thumbnail 예시
- Local Node 설치 위치 및 접근권한 표
