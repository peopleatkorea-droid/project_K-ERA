import type { Metadata } from "next";

import { LegalDocument } from "../../components/ui/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy | K-ERA Research Web",
  description: "Privacy Policy for K-ERA Research Web.",
};

const sections = [
  {
    koTitle: "1. 수집하는 개인정보 및 연구 데이터",
    enTitle: "1. Personal Data and Research Data We Process",
    koItems: [
      "K-ERA는 감염성 각막염 연구 워크플로를 제공하기 위해 다음 정보를 처리할 수 있습니다.",
      "계정 및 인증 정보: Google 로그인 시 제공되는 이메일, 표시 이름, 프로필 이미지, Google 계정 식별자. 관리자 복구 경로를 사용하는 경우에는 로컬 계정 정보가 포함될 수 있습니다.",
      "기관 및 권한 정보: 소속 병원, 요청 역할, 접근 요청 메시지, 승인 상태, 검토 메모.",
      "케이스 및 임상 메타데이터: 환자 ID, chart alias, local case code, 방문일, 실제 방문일, 성별, 나이, 배양 결과, 원인균 분류, 콘택트렌즈 사용력, 위험인자, 도말검사 결과, 병력, 방문 상태 등 사용자가 입력한 연구 데이터.",
      "이미지 및 파생 산출물: 업로드된 세극등/형광염색/백색광 이미지, 대표 이미지 설정, 병변 박스, ROI crop, lesion crop, segmentation mask, Grad-CAM, validation artifact 등 서비스가 생성하거나 저장하는 연구 산출물.",
      "검색 및 추천용 데이터: AI Clinic 유사 증례 검색을 위한 embedding, 검색 인덱스, 모델 출력값, 유사 증례 요약, differential ranking 결과.",
      "기술 로그: 접속 시각, 오류 로그, 작업 상태 로그, 브라우저/기기 정보, 보안 및 운영 목적의 시스템 로그.",
    ],
    enItems: [
      "K-ERA processes the following categories of data to operate its infectious keratitis research workflow.",
      "Account and authentication data: email address, display name, profile image, and Google account identifier returned during Google Sign-In. Local account credentials may be processed for administrator recovery only.",
      "Institution and access data: hospital affiliation, requested role, access request message, approval state, and reviewer notes.",
      "Case and clinical metadata: patient ID, chart alias, local case code, visit dates, sex, age, culture confirmation, organism category, contact lens history, risk factors, smear result, history, visit status, and other research data entered by users.",
      "Images and derived artifacts: uploaded slit-lamp, fluorescein, and white-light images, representative image settings, lesion boxes, ROI crops, lesion crops, segmentation masks, Grad-CAM outputs, validation artifacts, and related derived files.",
      "Search and recommendation data: embeddings, vector indices, model outputs, similar-case summaries, and differential ranking data used by AI Clinic features.",
      "Technical logs: access timestamps, error logs, background job logs, browser/device data, and other operational or security logs.",
    ],
  },
  {
    koTitle: "2. 수집 및 이용 목적",
    enTitle: "2. Purpose of Processing",
    koItems: [
      "이용자 인증, 계정 관리, 병원별 접근 권한 관리.",
      "환자 방문 등록, 이미지 업로드, 케이스 저장, 검증, 기여, 모델 운영 등 연구 워크플로 제공.",
      "병변 분할, validation, contribution, aggregation, AI Clinic 검색/추천 등 AI 기능 제공.",
      "서비스 안정성 확보, 오류 분석, 보안 모니터링, 성능 개선.",
      "문의 대응, 운영 공지, 접근 요청 및 검토 처리.",
    ],
    enItems: [
      "User authentication, account administration, and institution-level access control.",
      "Provision of the clinical research workflow, including patient visit registration, image upload, case storage, validation, contribution, and model operations.",
      "Operation of AI features such as lesion segmentation, validation, contribution, aggregation, and AI Clinic search/recommendation.",
      "Service stability, error analysis, security monitoring, and product improvement.",
      "Responding to inquiries, sending operational notices, and managing approval workflows.",
    ],
  },
  {
    koTitle: "3. 외부 서비스 이용 및 정보 전송",
    enTitle: "3. Third-Party Services and Data Transfer",
    koItems: [
      "Google Sign-In: 연구자 로그인 처리를 위해 Google 인증 서비스를 사용합니다. 이 과정에서 Google은 인증에 필요한 계정 정보를 처리할 수 있습니다.",
      "클라우드/인프라 서비스: 서비스 운영, 저장, 백업, 보안 모니터링을 위해 호스팅 및 인프라 제공자가 기술 로그와 저장 데이터를 처리할 수 있습니다.",
      "선택적 AI Clinic LLM 연동: 서버에 AI Clinic LLM 기능이 설정된 경우, 이용자가 AI Clinic 워크플로 추천 기능을 실행할 때 요청에 필요한 제한된 텍스트/구조화 데이터가 OpenAI 호환 API로 전송될 수 있습니다.",
      "위 LLM 전송에는 일반적으로 케이스 요약, 모델 출력, 유사 증례 요약, 임상 메타데이터 일부가 포함될 수 있으며, 해당 기능은 설정되지 않은 경우 로컬 fallback 로직으로 동작합니다.",
      "K-ERA는 이용자의 케이스 원문이나 연구 데이터를 이용자 동의 없이 자사 모델 학습 목적으로 사용하는 것을 기본 정책으로 하지 않습니다.",
    ],
    enItems: [
      "Google Sign-In: Google authentication services are used for researcher login. Google may process account information required for identity verification.",
      "Cloud hosting and infrastructure: hosting or infrastructure providers may process stored service data and technical logs as necessary to run, secure, and back up the service.",
      "Optional AI Clinic LLM integration: if AI Clinic LLM support is configured on the server, limited text and structured context required for a workflow recommendation request may be sent to an OpenAI-compatible API when a user explicitly invokes that feature.",
      "Such LLM transfers generally involve case summaries, model outputs, similar-case summaries, and selected clinical metadata required for the request. If the LLM integration is not configured, AI Clinic uses a local fallback workflow.",
      "K-ERA does not adopt a default policy of using user research content to train its own models without user consent.",
    ],
  },
  {
    koTitle: "4. 보유 및 이용 기간",
    enTitle: "4. Retention Period",
    koItems: [
      "계정 및 기관 접근 정보는 계정 삭제 또는 운영상 삭제 조치 시까지 보관할 수 있습니다.",
      "케이스, 이미지, 임상 메타데이터 및 연구 산출물은 해당 기관의 연구 운영 목적과 삭제 요청 처리 시점까지 보관할 수 있습니다.",
      "운영 및 보안 로그는 일반적으로 최대 90일 범위에서 보관하며, 법령상 또는 보안상 필요가 있는 경우 예외가 있을 수 있습니다.",
      "관계 법령에 따라 별도 보관 의무가 있는 경우 해당 기간 동안 보관할 수 있습니다.",
    ],
    enItems: [
      "Account and institution-access records may be retained until account deletion or administrative removal.",
      "Cases, images, clinical metadata, and research artifacts may be retained until deletion is requested and processed, or as required for institution-level research operations.",
      "Operational and security logs are generally retained for up to 90 days, subject to legal, security, or incident-response exceptions.",
      "Where applicable law requires longer retention, the relevant data may be retained for the legally required period.",
    ],
  },
  {
    koTitle: "5. 이용자의 권리",
    enTitle: "5. Your Rights",
    koItems: [
      "이용자는 자신의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요청할 수 있습니다.",
      "계정 삭제, 기관 접근 철회, 케이스 삭제 요청은 운영자 또는 소속 기관 관리자 권한 체계를 통해 처리될 수 있습니다.",
      "의료·연구 데이터의 특성상 일부 정보는 기관 정책, 감사, 법적 의무에 따라 즉시 삭제되지 않을 수 있습니다.",
    ],
    enItems: [
      "Users may request access to, correction of, deletion of, or restriction of processing of their personal data.",
      "Requests involving account deletion, institution access withdrawal, or case deletion may be handled through the operator or authorized institution administrators.",
      "Because the service can process medical or research-related records, some data may not be deleted immediately where institutional policy, audit requirements, or legal obligations apply.",
    ],
  },
  {
    koTitle: "6. 안전성 확보 조치",
    enTitle: "6. Security Measures",
    koItems: [
      "접근권한 관리, 인증 토큰 기반 접근 통제, 저장 경로 분리, 로그 모니터링, 업로드 파일 크기 제한, 보안상 필요한 기술적·관리적 조치를 적용합니다.",
      "연구 데이터는 병원/사이트 단위 워크스페이스 구조 안에서 관리되며, 서비스는 원본 데이터의 무분별한 외부 반출을 방지하는 방향으로 설계되어 있습니다.",
    ],
    enItems: [
      "K-ERA applies reasonable technical and organisational safeguards, including access control, token-based authentication, separated storage paths, log monitoring, and upload constraints.",
      "Research data is managed within site-scoped workspaces, and the service is designed to reduce unnecessary external transfer of raw institutional data.",
    ],
  },
  {
    koTitle: "7. 문의처 및 시행일",
    enTitle: "7. Contact and Effective Date",
    koItems: [
      "개인정보 및 운영 문의: kera-research@jnuh.ac.kr",
      "보조 문의처: dr.jinho.jeong@gmail.com",
      "시행일: 2026-03-16",
    ],
    enItems: [
      "Privacy and operational contact: kera-research@jnuh.ac.kr",
      "Secondary contact: dr.jinho.jeong@gmail.com",
      "Effective date: March 16, 2026",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      titleKo="개인정보처리방침"
      titleEn="Privacy Policy"
      introKo='본 문서는 K-ERA Research Web(이하 "서비스") 및 관련 연구 워크플로에서 처리되는 개인정보와 연구 데이터에 대한 기본 방침을 설명합니다.'
      introEn="This document explains the core policy for personal data and research data processed by K-ERA Research Web and its related research workflow."
      sections={sections}
    />
  );
}
