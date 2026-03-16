# IRB 동의면제 / Registry 설명 문안 초안

## 1. 동의면제 신청 사유서 초안

아래 문안은 **후향적 최소위험 연구**를 전제로 한 초안이다. 기관 양식에 맞춰 문장 길이만 조정해서 사용할 수 있다.

### 1.1 동의면제 신청 사유

본 연구는 기존 진료과정 또는 기존 연구활동을 통해 확보된 감염성 각막염 임상영상 및 임상 메타데이터를 활용하는 후향적 연구이다. 연구 수행 과정에서 연구대상자에게 추가 처치, 중재, 침습적 검사 또는 직접 접촉이 이루어지지 않는다.

본 연구에서 중앙 control plane에 저장되는 정보는 raw patient ID나 정확한 방문일이 아니라 `case_reference_id` 및 방문 라벨(`Initial`, `FU #N`) 중심의 가명처리 정보이며, 원본 영상 및 추가 연결정보는 각 기관 내부 Local Node에 보관된다. 따라서 연구대상자에게 가해지는 위험은 주로 개인정보 보호와 관련된 최소위험 수준으로 판단된다.

또한 연구대상자 전원에게 개별적으로 연락하여 동의를 다시 획득하는 것은 현실적으로 매우 어렵고, 상당수 연구대상자에 대해서는 연락처 변경, 진료 종료, 추적 불가 등의 사유로 동의 획득이 불가능하거나 현저히 곤란할 수 있다.

연구대상자 동의를 면제하더라도 연구대상자의 권리와 복지에 중대한 영향을 미치지 않도록 다음 조치를 적용한다.

- 중앙 저장 시 `case_reference_id` 기반 가명처리
- 정확한 방문일 미공유, `actual_visit_date` 로컬 보관
- EXIF 제거 및 `image_id` 기반 파일명 저장
- 접근권한 제한, 로그 관리, 사이트별 분리 저장
- 연구 종료 후 보관기간 경과 시 파기 또는 별도 승인 절차에 따른 보관

이에 본 연구는 최소위험 연구로서 연구대상자 동의면제를 요청한다.

## 2. 연구자/기관 사용자용 Registry 설명문 초안

이 문안은 환자 동의서가 아니라 **K-ERA를 사용하는 연구자/기관 사용자**에게 보여주는 registry 설명문 초안이다.

### 2.1 짧은 UI 문안

#### 국문

K-ERA Research Registry 안내

K-ERA는 감염성 각막염 연구를 위한 AI 분석 기능을 제공합니다. 동의하시면, 이 기관에서 분석한 적격 케이스의 가명처리된 연구데이터가 다기관 registry 및 모델 검증/개선 연구에 포함될 수 있습니다.

- 중앙에는 raw patient ID 대신 `case_reference_id`가 저장됩니다.
- 실제 방문일은 중앙에 저장되지 않으며 방문 라벨만 사용됩니다.
- 원본 이미지는 기관 내부 저장소에 보관됩니다.
- 각 케이스는 이후 `Included / Excluded` 상태로 확인하고 제외할 수 있습니다.

`[ ] 가명처리된 연구데이터의 registry 활용에 동의합니다.`

#### 영문

K-ERA Research Registry

K-ERA provides AI-based analysis for infectious keratitis research. If you agree, eligible cases analysed at your institution may be included in a multicenter research registry using pseudonymized research data.

- The central registry stores `case_reference_id` instead of raw patient IDs.
- Exact calendar dates are not stored centrally; only visit labels are used.
- Raw images remain in the institution-local workspace.
- Each case can later be reviewed as `Included / Excluded` and opted out when appropriate.

`[ ] I agree to the use of pseudonymized research data in the registry.`

## 3. 케이스별 상태 안내 문구

### 3.1 Included 상태

- 국문: 이 케이스는 현재 research registry에 포함되어 있습니다.
- 영문: This case is currently included in the research registry.

### 3.2 Excluded 상태

- 국문: 이 케이스는 현재 research registry에서 제외되어 있습니다.
- 영문: This case is currently excluded from the research registry.

### 3.3 분석 전용 상태

- 국문: 이 케이스는 분석에는 사용되지만 중앙 research registry에는 포함되지 않습니다.
- 영문: This case is available for analysis only and is not included in the central research registry.

## 4. IRB 제출 시 설명 포인트

IRB나 개인정보 담당 검토 시에는 아래 표현을 일관되게 유지하는 편이 안전하다.

- `원본 이미지는 기관 내부 Local Node에 저장`
- `중앙에는 case_reference_id 및 방문 라벨 기반 가명처리 정보 저장`
- `registry 참여는 사이트 활성화 + 사용자 1회 opt-in 기반`
- `케이스별 opt-out 가능`
- `무료 분석과 연구 registry는 기능적으로 연결되지만, 숨겨진 자동동의 방식은 사용하지 않음`

## 5. 피하는 것이 좋은 표현

아래 문구는 IRB, 연구윤리, 저자 기준 측면에서 오해를 만들 수 있으므로 피하는 편이 낫다.

- `기여하면 공저자 보장`
- `동의만 하면 법적으로 문제 없음`
- `완전 익명 데이터`
- `자동으로 논문 참여`

대신 아래 표현을 권장한다.

- `가명처리된 연구데이터`
- `다기관 registry`
- `연구데이터 및 모델 개선에 기여`
- `향후 연구 결과물에서 기여 사실이 별도로 검토될 수 있음`
