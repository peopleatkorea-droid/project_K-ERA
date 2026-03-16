import type { Metadata } from "next";

import { LegalDocument } from "../../components/ui/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service | K-ERA Research Web",
  description: "Terms of Service for K-ERA Research Web.",
};

const sections = [
  {
    koTitle: "1. 목적 및 효력",
    enTitle: "1. Scope and Effect",
    koItems: [
      '본 약관은 K-ERA Research Web(이하 "서비스")의 이용조건, 권리·의무 및 책임사항을 정합니다.',
      "이용자는 본 약관에 동의함으로써 서비스를 이용할 수 있습니다.",
      "운영자는 관련 법령 범위 내에서 약관을 변경할 수 있으며, 변경 시 서비스 내 공지 또는 합리적인 방법으로 안내할 수 있습니다.",
    ],
    enItems: [
      'These Terms govern the conditions of use, rights, obligations, and responsibilities for K-ERA Research Web (the "Service").',
      "By using the Service, you agree to these Terms.",
      "The operator may revise these Terms to the extent permitted by applicable law, and changes may be announced through the Service or other reasonable notice methods.",
    ],
  },
  {
    koTitle: "2. 서비스의 성격",
    enTitle: "2. Nature of the Service",
    koItems: [
      "서비스는 감염성 각막염 연구를 위한 웹 기반 연구 플랫폼입니다.",
      "서비스는 케이스 등록, 이미지 업로드, 병변 분할, validation, contribution, aggregation, AI Clinic 검색 및 워크플로 추천 등 연구 보조 기능을 제공할 수 있습니다.",
      "일부 기능은 시험적 또는 베타 상태일 수 있으며, 특정 모델 출력이나 성능 수치는 항상 동일하게 재현되거나 보장되지 않습니다.",
    ],
    enItems: [
      "The Service is a web-based research platform for infectious keratitis workflows.",
      "The Service may provide research-support features including case registration, image upload, lesion segmentation, validation, contribution, aggregation, AI Clinic retrieval, and workflow recommendation.",
      "Some features may remain experimental or beta, and specific model outputs or performance levels are not guaranteed to be consistent or error-free.",
    ],
  },
  {
    koTitle: "3. 계정 및 이용자 의무",
    enTitle: "3. Accounts and User Responsibilities",
    koItems: [
      "이용자는 자신의 계정 정보를 정확하게 관리하고 무단 사용을 방지해야 합니다.",
      "이용자는 관련 법령, 소속 기관 정책, 연구윤리, IRB 또는 기타 승인 절차를 준수해야 합니다.",
      "이용자는 본인에게 적법한 권한이 없는 환자 정보, 이미지, 문서 또는 제3자 권리를 침해하는 자료를 업로드하거나 처리해서는 안 됩니다.",
      "이용자는 서비스 사용 전에 필요한 기관 내부 승인, 데이터 사용 권한, 연구 수행 권한을 스스로 확인해야 합니다.",
    ],
    enItems: [
      "Users must accurately manage their account credentials and prevent unauthorised access.",
      "Users must comply with applicable law, institutional policy, research ethics, IRB requirements, and other approval processes applicable to their use of the Service.",
      "Users must not upload or process patient data, images, documents, or other materials unless they have lawful authority to do so and such use does not infringe third-party rights.",
      "Users are responsible for confirming that all necessary institutional permissions, data-use approvals, and research authorisations are in place before using the Service.",
    ],
  },
  {
    koTitle: "4. 의료적 판단 및 연구 책임",
    enTitle: "4. Clinical and Research Responsibility",
    koItems: [
      "서비스의 AI 분석, 유사 증례 검색, differential ranking, 워크플로 추천 등은 연구 및 의사결정 보조 수단일 뿐이며, 최종 진단, 치료, 처방, 시술 또는 의료적 판단을 대체하지 않습니다.",
      "서비스 결과물의 임상적 해석, 연구적 활용, 논문 게재, 대외 발표, 기관 제출 또는 법적 적합성에 대한 최종 책임은 이용자와 이용 기관에 있습니다.",
      "서비스는 응급 의료 대응 또는 자율적 진료 결정을 위한 의료기기로 제공되지 않습니다.",
    ],
    enItems: [
      "AI analyses, similar-case retrieval, differential ranking, and workflow recommendations provided by the Service are decision-support tools for research purposes only and do not replace final clinical judgment, diagnosis, treatment, prescribing, or procedures.",
      "Users and their institutions remain solely responsible for the clinical interpretation, research use, publication, presentation, institutional submission, and legal appropriateness of any Service output.",
      "The Service is not provided as a medical device for emergency care or autonomous clinical decision-making.",
    ],
  },
  {
    koTitle: "5. 데이터 및 콘텐츠 권리",
    enTitle: "5. Data and Content Rights",
    koItems: [
      "이용자가 입력하거나 업로드한 연구 데이터, 이미지, 메모 및 기타 콘텐츠에 대한 권리는 원칙적으로 해당 이용자 또는 정당한 권리자에게 귀속됩니다.",
      "운영자는 서비스 제공, 저장, 보안, 백업, 장애 대응, 기능 개선 및 관련 운영 목적 범위에서만 해당 데이터를 처리합니다.",
      "AI 출력물, 파생 산출물 및 추천 결과는 자동 생성 결과를 포함할 수 있으므로, 이용자는 이를 독립적으로 검토하고 필요 시 수정해야 합니다.",
    ],
    enItems: [
      "Rights in research data, images, notes, and other content uploaded or entered by users remain, in principle, with the relevant user or lawful rights holder.",
      "The operator processes such data only as necessary to provide, store, secure, back up, maintain, and improve the Service and respond to incidents.",
      "AI outputs, derived artifacts, and recommendation results may include automated content and must be independently reviewed and, where necessary, corrected by the user.",
    ],
  },
  {
    koTitle: "6. 금지행위 및 이용 제한",
    enTitle: "6. Prohibited Conduct and Restrictions",
    koItems: [
      "다음 행위는 금지됩니다: 불법행위, 악성 트래픽 유발, 시스템 침해 시도, 계정 도용, 타인 사칭, 허위 정보 등록, 서비스 운영 방해, 무단 데이터 수집 또는 권리침해 콘텐츠 업로드.",
      "운영자는 약관 또는 법령 위반, 보안 위험, 서비스 남용, 기관 정책 위반이 의심되는 경우 경고, 기능 제한, 접근 제한, 계정 정지 또는 삭제 조치를 할 수 있습니다.",
      "운영자는 서비스 안정성 또는 보안 확보를 위해 일부 기능을 사전 고지 없이 변경, 제한 또는 중단할 수 있습니다.",
    ],
    enItems: [
      "Prohibited conduct includes unlawful activity, malicious traffic, attempts to compromise the system, account misuse, impersonation, false registration, interference with operations, unauthorised data collection, and uploading infringing content.",
      "The operator may issue warnings or restrict features, access, or accounts where misuse, legal violations, security risks, or institutional policy breaches are suspected.",
      "The operator may modify, restrict, or suspend parts of the Service without prior notice where necessary for stability, maintenance, or security.",
    ],
  },
  {
    koTitle: "7. 서비스 중단 및 책임 제한",
    enTitle: "7. Disclaimer and Limitation of Liability",
    koItems: [
      "운영자는 안정적인 서비스 제공을 위해 합리적으로 노력하지만, 외부 인증 서비스 장애, 외부 API 장애, 네트워크 문제, 인프라 장애, 보안 사고, 유지보수, 불가항력 사유로 서비스가 중단되거나 지연될 수 있습니다.",
      "법령상 허용되는 범위에서 운영자는 이러한 사유로 인한 간접손해, 특별손해, 결과손해 또는 기대이익 손실에 대해 책임이 제한될 수 있습니다.",
      "특히 외부 AI API, Google 인증, 모델 추론 환경, 기관별 로컬 실행 환경의 가용성은 운영자가 전적으로 보장하지 않습니다.",
    ],
    enItems: [
      "The operator will make reasonable efforts to provide a stable Service, but interruptions or delays may occur due to authentication provider failures, external API failures, network problems, infrastructure incidents, maintenance, security events, or force majeure.",
      "To the extent permitted by law, the operator's liability for indirect, special, consequential, or lost-profit damages arising from such events may be limited.",
      "In particular, the availability of external AI APIs, Google authentication, model inference environments, and institution-specific local execution environments is not fully guaranteed by the operator.",
    ],
  },
  {
    koTitle: "8. 해지 및 탈퇴",
    enTitle: "8. Termination",
    koItems: [
      "이용자는 언제든지 계정 삭제 또는 이용 중단을 요청할 수 있습니다.",
      "운영자는 법령 위반, 약관 위반, 보안상 위험, 반복적 오남용 또는 기관 요청이 있는 경우 서비스 이용을 제한하거나 종료할 수 있습니다.",
      "탈퇴 또는 종료 이후에도 법령, 보안, 감사 또는 연구 운영상 필요한 범위의 정보는 일정 기간 보관될 수 있습니다.",
    ],
    enItems: [
      "Users may request account deletion or discontinue use of the Service at any time.",
      "The operator may restrict or terminate access in cases of legal violations, breach of these Terms, security risks, repeated misuse, or institutional requests.",
      "Even after termination, certain data may be retained for a limited period as required for law, security, audit, or research operations.",
    ],
  },
  {
    koTitle: "9. 준거법 및 관할",
    enTitle: "9. Governing Law and Jurisdiction",
    koItems: [
      "본 약관은 대한민국 법령을 준거법으로 합니다.",
      "서비스 이용과 관련하여 분쟁이 발생하는 경우 관련 법령에 따른 관할 법원을 따릅니다.",
    ],
    enItems: [
      "These Terms are governed by the laws of the Republic of Korea.",
      "Any dispute arising from use of the Service shall be handled by the competent court under applicable law.",
    ],
  },
  {
    koTitle: "10. 문의처 및 시행일",
    enTitle: "10. Contact and Effective Date",
    koItems: [
      "운영 문의: kera-research@jnuh.ac.kr",
      "보조 문의처: dr.jinho.jeong@gmail.com",
      "시행일: 2026-03-16",
    ],
    enItems: [
      "Operational contact: kera-research@jnuh.ac.kr",
      "Secondary contact: dr.jinho.jeong@gmail.com",
      "Effective date: March 16, 2026",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      titleKo="이용약관"
      titleEn="Terms of Service"
      introKo='본 문서는 K-ERA Research Web(이하 "서비스")의 사용 조건과 연구·운영 책임 범위를 설명합니다.'
      introEn="These terms explain the conditions of use, research responsibilities, and operational boundaries of K-ERA Research Web."
      sections={sections}
    />
  );
}
