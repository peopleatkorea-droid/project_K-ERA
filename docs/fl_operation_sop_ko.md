# 연합학습 운영 / 복구 SOP 초안

이 문서는 K-ERA의 현재 구현을 기준으로, 다기관 연합학습(Federated Learning) 운영 중 이상이 발생했을 때 어떻게 판단하고, 어디까지 롤백하고, 어떤 기준으로 다시 시작할지 정리한 한국어 초안입니다.

적용 범위:

- image-level FL: `ConvNeXt-Tiny (full)`
- visit-level FL: `EfficientNetV2-S MIL (full)`
- federated retrieval corpus expansion: `DINOv2 lesion-crop retrieval`

---

## 1. 목적

이 SOP의 목적은 다음 4가지를 보장하는 것입니다.

1. 이상 징후를 가능한 한 빨리 발견한다.
2. 문제가 있는 모델이 더 넓게 배포되기 전에 확산을 멈춘다.
3. 이전 stable 상태로 빠르게 복구한다.
4. 원인에 따라 재집계, 재라운드, 처음부터 재학습 중 어떤 복구가 맞는지 일관되게 결정한다.

---

## 2. 기본 운영 원칙

- 운영 기본 모델은 한 번에 한 lineage만 `current release`로 본다.
- 새 모델은 가능하면 `pilot -> partial -> full` 순으로 올린다.
- `full` 승격 전에는 반드시 병원별 validation과 node adoption 상태를 확인한다.
- image-level, visit-level, retrieval은 서로 다른 운영 레일로 본다.
- retrieval은 현재 full FL이 아니라 `federated retrieval corpus expansion`으로 본다.
- 문제가 생기면 새 학습보다 먼저 `확산 중지`와 `롤백`을 우선한다.

---

## 3. 역할

### 3.1 Platform Admin

- rollout 생성 / 승격 / rollback 결정
- aggregation 실행 승인
- 중앙 monitoring / audit 확인
- 최종 복구 전략 결정

### 3.2 Site Admin

- 로컬 site round 실행
- site 데이터 품질 확인
- local validation 결과 확인
- 병원별 이상 징후 보고

### 3.3 Researcher

- 케이스 등록 / 분석 / 검토
- 품질 낮은 사례, 해석 이상 사례 보고

---

## 4. 평시 운영 절차

1. 병원별 eligible case를 확인한다.
2. local site round를 실행한다.
3. model update를 review한다.
4. 승인된 update만 aggregate한다.
5. 새 global version을 registry에 등록한다.
6. `pilot` rollout을 먼저 적용한다.
7. pilot 병원의 validation, adoption, 이상 신호를 확인한다.
8. 문제가 없으면 `partial`, 이후 `full`로 올린다.

---

## 5. 이상 징후 정의

다음 중 하나라도 발생하면 이상으로 본다.

- pilot 병원의 validation 성능이 stable baseline보다 의미 있게 하락
- 특정 병원 update만 유독 outlier처럼 큼
- node adoption이 늦어 expected version과 실제 version이 계속 불일치
- 로컬 round의 eligible case/image 수가 지나치게 작음
- 특정 병원만 반복적으로 lagging / unknown 상태
- retrieval corpus sync 이후 similar case 품질이 급격히 저하
- 병원 현장에서 “결과가 이상하다”는 정성 피드백이 반복

권장 임시 기준:

- `balanced accuracy`가 baseline 대비 `0.03` 이상 하락
- `AUROC`가 baseline 대비 `0.05` 이상 하락
- rollout 후 24시간 내 aligned node 비율이 `90%` 미만
- site round의 eligible case/image 수가 사전에 정한 최소치 미만

위 수치는 운영 초안이며, 실제 pilot 결과를 보고 조정합니다.

---

## 6. 이상 감지 시 즉시 조치

1. 새 `site round` 실행을 잠시 중단한다.
2. pending review update의 추가 승인을 보류한다.
3. 새 aggregation 실행을 중단한다.
4. 이미 `pilot`이면 `partial` 승격을 금지한다.
5. 이미 `partial`이면 `full` 승격을 금지한다.
6. admin monitoring 화면에서 아래를 먼저 확인한다.

- 현재 release version
- active rollout stage
- aligned / lagging / unknown node 수
- 병원별 latest reported adopted version
- 병원별 latest validation version
- 최근 audit trail

---

## 7. 1차 분류: 무엇이 잘못됐는가

이상 발생 시 아래 4가지로 먼저 분류합니다.

### 7.1 배포 문제

예:

- rollout은 바뀌었는데 일부 node가 예전 모델 유지
- node adoption이 늦거나 실패

대응:

- 먼저 rollout / bootstrap / current release 전달 문제를 확인
- 모델 자체보다는 배포/동기화 문제로 판단

### 7.2 local round 문제

예:

- 어떤 병원의 eligible 수가 너무 적음
- local fine-tune이 과도하거나 noise가 큼

대응:

- 해당 site round를 제외 후보로 둠
- 같은 stable base로 다시 site round 수행 가능

### 7.3 aggregation 문제

예:

- 집계 대상 선택이 잘못됨
- 승인된 update 중 일부가 outlier

대응:

- bad update 제외 후 다시 aggregate
- 같은 base model에서 aggregation redo

### 7.4 base model / policy 문제

예:

- 학습 정책 자체가 안 맞음
- 같은 base로 계속 가도 품질이 회복되지 않음

대응:

- stable seed부터 새 lineage로 다시 시작

---

## 8. 롤백 SOP

가장 먼저 할 일은 서비스 모델을 안정 버전으로 되돌리는 것입니다.

### 8.1 롤백 조건

- pilot 결과가 즉시 나쁨
- partial rollout에서 다수 병원 regression
- adoption mismatch가 커서 운영 혼선이 발생
- 임상 현장에서 잘못된 해석 위험이 있다고 판단

### 8.2 롤백 절차

1. 가장 최근 stable model version을 선택한다.
2. 새 rollout을 `rollback` 또는 `full` 형태로 생성해 stable version으로 되돌린다.
3. node adoption이 stable version으로 정렬될 때까지 모니터링한다.
4. aligned node 비율이 회복되면 incident를 1차 안정화로 본다.

### 8.3 롤백 후 확인

- current release가 stable version으로 보이는지
- lagging node가 계속 남는지
- pilot/partial 대상 병원이 expected version과 일치하는지
- rollback 직후 validation이 stable baseline 수준으로 회복되는지

---

## 9. 재집계(aggregation redo) SOP

다음 상황이면 처음부터 재학습보다 `재집계`가 우선입니다.

- base model은 괜찮다.
- 문제는 일부 update 선택 또는 aggregation 구성이다.

절차:

1. 문제로 의심되는 site update를 식별한다.
2. 해당 update를 제외한 approved update 집합을 다시 만든다.
3. 같은 stable base model 기준으로 aggregation을 다시 실행한다.
4. 새 version 이름에 `redo`, `hotfix`, `recovery` 같은 suffix를 붙인다.
5. pilot rollout부터 다시 시작한다.

권장 메모:

- 제외한 update id
- 제외 이유
- 재집계 기준 base model
- 새 validation 요약

### 9.1 재집계 / replay 체크리스트

실제 incident 대응에서는 아래 순서를 고정합니다.

1. `GET /api/admin/aggregations/jobs`로 최근 aggregation job 상태를 확인한다.
2. 마지막 실패 job이 있으면 `GET /api/admin/aggregations/jobs/{job_id}`로 payload, source update 수, error를 확인한다.
3. 승인된 update 목록을 다시 검토해 제외할 update를 결정한다.
4. 필요하면 먼저 stable version으로 rollout rollback을 걸어 확산을 멈춘다.
5. 제외/재승인 정리가 끝난 뒤 `POST /api/admin/aggregations/run`으로 새 aggregation job을 시작한다.
6. 새 job id를 incident 문서에 기록한다.
7. 아래 항목을 함께 남긴다.

- aggregation job id
- source update id 목록
- aggregation strategy / trim ratio
- dp accounting summary 유무
- rollout 여부
- rollback 기준 version

---

## 10. 같은 base에서 site round 재실행 SOP

다음 상황이면 site round 재실행이 맞습니다.

- 특정 병원 local round가 노이즈가 심함
- eligible 수가 너무 적었음
- local hyperparameter가 과했음

절차:

1. stable base model을 고정한다.
2. 문제 병원의 local round만 다시 실행한다.
3. 새 update를 review한다.
4. 이전 문제 update는 제외한다.
5. 승인된 새 update로 다시 aggregate한다.

---

## 11. 처음부터 재학습 SOP

다음 상황이면 `처음부터 다시`가 맞습니다.

- base model 선택이 잘못됨
- aggregation redo 후에도 regression이 반복됨
- 여러 병원에서 공통으로 성능이 나쁨
- training policy 자체가 맞지 않음

절차:

1. 현재 운영 stable model을 서비스용 fallback으로 유지한다.
2. 새 lineage의 `stable seed model`을 하나 정한다.
3. 새 lineage 이름을 분명히 만든다.
   - 예: `visit_effnet_mil_lineage_b_2026q2`
4. 병원별 eligible 기준을 다시 점검한다.
5. image-level과 visit-level을 각각 별도 round로 다시 수행한다.
6. update review를 다시 한다.
7. aggregation을 새로 수행한다.
8. 반드시 `pilot -> partial -> full` 순으로 다시 검증한다.

중요:

- 기존 stable lineage를 즉시 지우지 않는다.
- 새 lineage가 안정화되기 전까지는 이전 stable lineage를 rollback 기준으로 보존한다.

---

## 12. Retrieval 전용 복구 SOP

retrieval은 classifier/MIL과 다르게 봐야 합니다.

- 현재 retrieval은 full FL이 아니라 `corpus expansion`이다.
- 따라서 복구도 “재학습”보다 `정리 / 재동기화 / 재색인`이 우선이다.

복구 절차:

1. retrieval signature mismatch 여부 확인
2. 특정 site sync가 잘못됐는지 확인
3. 중앙 corpus에서 문제 site/profile entry를 정리
4. site별 sync를 다시 수행
5. 중앙 index를 다시 구성
6. top-k similar case 품질을 샘플 검토

적용 상황:

- preprocessing이 바뀌었는데 signature 관리가 어긋남
- 잘못된 site embedding이 섞임
- 삭제되어야 할 stale entry가 남음

---

## 13. 운영자가 꼭 확인해야 할 모니터링 항목

### 13.1 롤아웃 관점

- current release version
- active rollout stage
- target site 수
- aligned node 수
- lagging node 수
- unknown node 수

### 13.2 병원 관점

- latest reported adopted version
- latest validation version
- latest validation run date
- last seen
- local eligible case/image 수

### 13.3 학습 관점

- update 수
- 승인 대기 update 수
- aggregation 대상 수
- 각 site round의 eligible 규모
- outlier update 존재 여부

### 13.4 retrieval 관점

- retrieval signature
- local eligible case 수
- synced count / deleted count
- active sync job 존재 여부

---

## 14. 기록해야 하는 incident 메모

이상 발생 시 아래를 남깁니다.

- incident 시작 시각
- 영향 받은 version / rollout id
- 영향 범위
- 이상 신호
- 1차 원인 가설
- 즉시 조치 내역
- rollback 여부
- 제외한 update id 목록
- 재집계 또는 재학습 여부
- 최종 재배포 결과

---

## 15. 현재 구조에서 가능한 것 / 아직 수동인 것

### 가능한 것

- stable version으로 rollback
- bad update 제외 후 재집계
- site round 재실행
- stable seed 기준 새 lineage 재시작
- retrieval corpus purge / resync / reindex

### 아직 수동인 것

- one-click lineage reset
- 자동 quarantine
- 자동 승격 중단 규칙
- 자동 incident report 생성

즉 현재는 “복구 불가능”한 상태가 아니라, “운영 절차로 복구 가능한 상태”입니다.

---

## 16. 다음 단계 권장

운영 안정성을 더 높이려면 다음을 순서대로 추가하는 것이 좋습니다.

1. rollout 승격/중단 수치 기준 확정
2. lineage 메타데이터 명시화
   - `parent_model_version_id`
   - `aggregation_round_id`
   - `training_policy_version`
   - `eligible_case_snapshot`
3. site round 최소 eligible 기준 확정
4. incident 템플릿 정형화
5. rollback drill을 정기적으로 수행

---

## 17. 한 줄 운영 원칙

문제가 생기면 먼저 확산을 멈추고 stable version으로 되돌린 뒤, `배포 문제 / local round 문제 / aggregation 문제 / base policy 문제` 중 어디인지 분류하고, 그 결과에 따라 `롤백 유지`, `재집계`, `site round 재실행`, `처음부터 재학습`을 선택합니다.
