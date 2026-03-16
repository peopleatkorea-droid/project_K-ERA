# K-ERA IRB 제출 초안 패키지

이 폴더는 K-ERA Research Platform 기반 연구를 위한 **IRB 제출 초안**입니다.

목적은 다음과 같습니다.

- 기관별 IRB 양식에 붙여 넣을 수 있는 공통 본문 제공
- K-ERA의 현재 구현 상태를 반영한 개인정보/가명처리/registry 흐름 정리
- 연구계획서, 동의면제 사유서, 데이터 관리계획을 분리해서 재사용 가능하게 구성

## 포함 문서

- [irb_protocol_draft_ko.md](./irb_protocol_draft_ko.md)
  - 연구계획서 본문 초안
- [irb_consent_waiver_and_registry_draft_ko.md](./irb_consent_waiver_and_registry_draft_ko.md)
  - 동의면제 검토 문안, 연구 registry 설명 문안, 연구자용 안내 문구
- [irb_data_management_plan_ko.md](./irb_data_management_plan_ko.md)
  - 데이터 흐름, 가명처리 구조, 보관/접근권한/파기 계획

## 현재 초안이 전제하는 연구 형태

- 연구 유형: 다기관 감염성 각막염 임상영상 기반 AI 연구
- 플랫폼: K-ERA Research Platform
- 데이터: 세극등/형광염색/백색광 안과 이미지 + 임상 메타데이터
- 중앙 저장: `case_reference_id` 중심의 가명처리 데이터
- 로컬 저장: 기관 내부 patient ID, 실제 방문일(`actual_visit_date`), 원본 이미지
- registry: 사이트 활성화 + 사용자 1회 opt-in + 이후 자동 포함 + 케이스별 opt-out

## 사용 전 반드시 채워야 하는 항목

아래 값은 각 기관 제출본에서 반드시 실제 정보로 교체해야 합니다.

- `[연구과제명]`
- `[연구책임자명]`
- `[소속기관명]`
- `[공동연구기관명]`
- `[연구기간]`
- `[목표 모집 규모]`
- `[IRB 제출 버전/날짜]`
- `[문의 이메일/전화번호]`

## 제출 시 실무 권장

1. 이 초안을 기관 표준 연구계획서 양식에 맞춰 복사
2. `동의면제`와 `환자동의 필요` 중 기관 방침에 맞는 경로 선택
3. 기관별 데이터 반출 범위와 Local Node 설치 위치를 실제 운영안으로 수정
4. 영상 예시, 화면 캡처, 데이터 흐름도는 별첨으로 첨부
5. 법무/IRB 간사 검토 시 “가명정보”, “연구 registry”, “중앙 저장 범위” 설명을 동일하게 유지

## 참고한 공식 기준

- 생명윤리 및 안전에 관한 법률 제2조(정의): 인간대상연구 및 개인식별정보 정의  
  https://www.law.go.kr/LSW/lsBdyPrint.do?chrClsCd=010201&efYd=20170726&joNo=0002%3A00&lsiSeq=195393
- 생명윤리 및 안전에 관한 법률 제16조(인간대상연구의 동의)  
  https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0016&lsiSeq=276665&urlMode=lsScJoRltInfoR
- 개인정보위 가명정보 안내  
  https://www.pipc.go.kr/np/default/page.do?mCode=D040010000%28
- 보건복지부 「보건의료데이터 활용 가이드라인」 및 개정 안내  
  https://www.mohw.go.kr/board.es?act=view&bid=0019&list_no=1480112&mid=a10411010300&tag=
  https://www.mohw.go.kr/board.es?act=view&bid=0027&list_no=374311&mid=a10503010100&nPage=217&tag=

## 주의

이 문서는 **실무 초안**입니다. 최종 제출본은 각 기관 IRB 양식, 소속기관 법무/개인정보 담당 검토, 연구책임자 판단에 맞춰 수정해야 합니다.
