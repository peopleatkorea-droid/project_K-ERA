"use client";

import { pick, type Locale } from "../../lib/i18n";

export function buildCaseWorkspaceCopy(locale: Locale) {
  return {
    recoveredDraft: pick(
      locale,
      "Recovered the last saved draft properties for this hospital. Re-attach image files before saving.",
      "??蹂묒썝??留덉?留?珥덉븞 ?띿꽦??蹂듦뎄?덉뒿?덈떎. ??????대?吏 ?뚯씪? ?ㅼ떆 泥⑤???二쇱꽭??",
    ),
    recoveredDraftWithAssets: pick(
      locale,
      "Recovered the last saved draft for this hospital, including local images.",
      "이 병원의 마지막 초안을 로컬 이미지까지 포함해 복구했습니다.",
    ),
    unableLoadRecentCases: pick(
      locale,
      "Unable to load recent cases.",
      "理쒓렐 耳?댁뒪瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    unableLoadSiteActivity: pick(
      locale,
      "Unable to load hospital activity.",
      "蹂묒썝 ?쒕룞??遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    unableLoadSiteValidationHistory: pick(
      locale,
      "Unable to load hospital validation history.",
      "蹂묒썝 寃利??대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    unableLoadCaseHistory: pick(
      locale,
      "Unable to load case history.",
      "耳?댁뒪 ?대젰??遺덈윭?ㅼ? 紐삵뻽?듬땲??",
    ),
    selectSavedCaseForRoi: pick(
      locale,
      "Select a saved case before running cornea preview.",
      "媛곷쭑 crop 誘몃━蹂닿린瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??",
    ),
    roiPreviewGenerated: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Cornea preview generated for ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 媛곷쭑 crop 誘몃━蹂닿린瑜??앹꽦?덉뒿?덈떎.`,
      ),
    roiPreviewFailed: pick(
      locale,
      "Cornea preview failed.",
      "媛곷쭑 crop 誘몃━蹂닿린???ㅽ뙣?덉뒿?덈떎.",
    ),
    selectSiteForValidation: pick(
      locale,
      "Select a hospital before running hospital validation.",
      "蹂묒썝 寃利앹쓣 ?ㅽ뻾?섎젮硫?蹂묒썝???좏깮?섏꽭??",
    ),
    siteValidationSaved: (validationId: string) =>
      pick(
        locale,
        `Hospital validation saved as ${validationId}.`,
        `蹂묒썝 寃利앹씠 ${validationId}濡???λ릺?덉뒿?덈떎.`,
      ),
    siteValidationFailed: pick(
      locale,
      "Hospital validation failed.",
      "蹂묒썝 寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    selectSavedCaseForValidation: pick(
      locale,
      "Select a saved case before running validation.",
      "寃利앹쓣 ?ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??",
    ),
    validationSaved: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Validation saved for ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 寃利앹씠 ??λ릺?덉뒿?덈떎.`,
      ),
    validationFailed: pick(
      locale,
      "Validation failed.",
      "寃利앹뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    selectValidationBeforeAiClinic: pick(
      locale,
      "Run validation before opening AI Clinic retrieval.",
      "AI Clinic 寃?됱쓣 ?닿린 ?꾩뿉 癒쇱? 寃利앹쓣 ?ㅽ뻾?섏꽭??",
    ),
    aiClinicReady: (count: number) =>
      pick(
        locale,
        `AI Clinic found ${count} similar patient case(s).`,
        `AI Clinic???좎궗 ?섏옄 耳?댁뒪 ${count}嫄댁쓣 李얠븯?듬땲??`,
      ),
    aiClinicExpandedReady: pick(
      locale,
      "AI Clinic evidence and workflow are ready.",
      "AI Clinic 근거와 workflow가 준비되었습니다.",
    ),
    aiClinicFailed: pick(
      locale,
      "AI Clinic retrieval failed.",
      "AI Clinic 寃?됱뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    aiClinicExpandFirst: pick(
      locale,
      "Load similar-patient retrieval before expanding AI Clinic.",
      "AI Clinic 확장 전에 먼저 유사 환자 검색을 불러오세요.",
    ),
    aiClinicTextUnavailable: pick(
      locale,
      "BiomedCLIP text retrieval is currently unavailable in this runtime.",
      "?꾩옱 ?ㅽ뻾 ?섍꼍?먯꽌??BiomedCLIP ?띿뒪??寃?됱쓣 ?ъ슜?????놁뒿?덈떎.",
    ),
    selectSavedCaseForContribution: pick(
      locale,
      "Select a saved case before contributing.",
      "湲곗뿬瑜??ㅽ뻾?섎젮硫???λ맂 耳?댁뒪瑜??좏깮?섏꽭??",
    ),
    activeOnly: pick(
      locale,
      "Only active visits are enabled for contribution under the current policy.",
      "?꾩옱 ?뺤콉?먯꽌??active 諛⑸Ц留?湲곗뿬?????덉뒿?덈떎.",
    ),
    contributionQueued: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Contribution queued for ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 湲곗뿬媛 ?湲곗뿴???깅줉?섏뿀?듬땲??`,
      ),
    contributionFailed: pick(
      locale,
      "Contribution failed.",
      "湲곗뿬???ㅽ뙣?덉뒿?덈떎.",
    ),
    selectSiteForCase: pick(
      locale,
      "Select a hospital before creating a case.",
      "耳?댁뒪瑜??앹꽦?섎젮硫?蹂묒썝???좏깮?섏꽭??",
    ),
    patientIdRequired: pick(
      locale,
      "Patient ID is required.",
      "?섏옄 ID???꾩닔?낅땲??",
    ),
    visitDateRequired: pick(
      locale,
      "Visit reference is required.",
      "諛⑸Ц 湲곗?媛믪? ?꾩닔?낅땲??",
    ),
    cultureSpeciesRequired: pick(
      locale,
      "Select the primary organism.",
      "???洹좎쥌???좏깮?섏꽭??",
    ),
    imageRequired: pick(
      locale,
      "Add at least one slit-lamp image to save this case.",
      "耳?댁뒪瑜???ν븯?ㅻ㈃ ?멸레???대?吏瑜??섎굹 ?댁긽 異붽??섏꽭??",
    ),
    lesionBoxesRequired: pick(
      locale,
      "Draw a lesion box on every image before saving this case.",
      "케이스를 저장하기 전에 모든 이미지에 병변 박스를 그려 주세요.",
    ),
    patientCreationFailed: pick(
      locale,
      "Patient creation failed.",
      "?섏옄 ?앹꽦???ㅽ뙣?덉뒿?덈떎.",
    ),
    caseSaved: (patientId: string, visitDate: string, siteLabel: string) =>
      pick(
        locale,
        `Case ${patientId} / ${visitDate} saved to ${siteLabel}.`,
        `${patientId} / ${visitDate} 케이스가 ${siteLabel}에 저장되었습니다.`,
      ),
    caseSaveFailed: pick(
      locale,
      "Case save failed.",
      "耳?댁뒪 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    organismAdded: pick(
      locale,
      "Organism added to this visit.",
      "??諛⑸Ц??洹좎쥌??異붽??덉뒿?덈떎.",
    ),
    organismDuplicate: pick(
      locale,
      "That organism is already attached to this visit.",
      "?대? ??諛⑸Ц??異붽???洹좎쥌?낅땲??",
    ),
    intakeComplete: pick(
      locale,
      "Core case intake is marked complete.",
      "湲곕낯 耳?댁뒪 ?낅젰???꾨즺濡??쒖떆?덉뒿?덈떎.",
    ),
    intakeStepRequired: pick(
      locale,
      "Complete the intake section before saving this case.",
      "케이스 저장 전에 intake 섹션을 먼저 완료해 주세요.",
    ),
    intakeOrganismRequired: pick(
      locale,
      "Select the primary organism first.",
      "먼저 대표 균종을 선택해 주세요.",
    ),
    draftAutosaved: (time: string) =>
      pick(locale, `Draft autosaved ${time}`, `${time}에 초안 자동 저장`),
    draftUnsaved: pick(
      locale,
      "Draft changes live only in this tab",
      "초안 변경 내용은 현재 탭에만 유지됩니다.",
    ),
    recentAlerts: pick(locale, "Recent alerts", "최근 알림"),
    recentAlertsCopy: pick(
      locale,
      "Transient toasts stay here for this session.",
      "짧게 사라지는 토스트도 현재 세션에서는 여기 남겨둡니다.",
    ),
    noAlertsYet: pick(
      locale,
      "No alerts yet in this session.",
      "현재 세션에는 아직 알림이 없습니다.",
    ),
    clearAlerts: pick(locale, "Clear alerts", "알림 비우기"),
    alertsKept: pick(locale, "kept", "보관"),
    patientIdLookupFailed: pick(
      locale,
      "Unable to verify duplicate patient IDs right now.",
      "현재는 중복 환자 ID를 확인할 수 없습니다.",
    ),
    unableLoadPatientList: pick(
      locale,
      "Unable to load the patient list.",
      "환자 목록을 불러오지 못했습니다.",
    ),
    patients: pick(locale, "patients", "?섏옄"),
    savedCases: pick(locale, "saved cases", "??λ맂 耳?댁뒪"),
    loadingSavedCases: pick(
      locale,
      "Loading saved cases...",
      "??λ맂 耳?댁뒪瑜?遺덈윭?ㅻ뒗 以?..",
    ),
    noSavedCases: pick(
      locale,
      "No saved cases for this hospital yet.",
      "??蹂묒썝?먮뒗 ?꾩쭅 ??λ맂 耳?댁뒪媛 ?놁뒿?덈떎.",
    ),
    allRecords: pick(locale, "All records", "?꾩껜"),
    myPatientsOnly: pick(locale, "My patients", "???섏옄"),
    patientScopeAll: (count: number) =>
      pick(
        locale,
        `Showing all hospital patients (${count}).`,
        `蹂묒썝 ?꾩껜 ?섏옄 ${count}紐낆쓣 ?쒖떆?⑸땲??`,
      ),
    patientScopeMine: (count: number) =>
      pick(
        locale,
        `Showing only patients registered by you (${count}).`,
        `?닿? ?깅줉???섏옄 ${count}紐낅쭔 ?쒖떆?⑸땲??`,
      ),
    favoriteAdded: pick(
      locale,
      "Case added to favorites.",
      "耳?댁뒪瑜?利먭꺼李얘린??異붽??덉뒿?덈떎.",
    ),
    favoriteRemoved: pick(
      locale,
      "Case removed from favorites.",
      "耳?댁뒪 利먭꺼李얘린瑜??댁젣?덉뒿?덈떎.",
    ),
    visitDeleted: (patientId: string, visitDate: string) =>
      pick(
        locale,
        `Deleted ${patientId} / ${visitDate}.`,
        `${patientId} / ${visitDate} 諛⑸Ц????젣?덉뒿?덈떎.`,
      ),
    patientDeleted: (patientId: string) =>
      pick(
        locale,
        `Deleted patient ${patientId}.`,
        `${patientId} ?섏옄瑜???젣?덉뒿?덈떎.`,
      ),
    deleteVisitFailed: pick(
      locale,
      "Unable to delete the visit.",
      "諛⑸Ц ??젣???ㅽ뙣?덉뒿?덈떎.",
    ),
    representativeUpdated: pick(
      locale,
      "Representative image updated.",
      "????대?吏瑜?蹂寃쏀뻽?듬땲??",
    ),
    representativeUpdateFailed: pick(
      locale,
      "Unable to update the representative image.",
      "????대?吏 蹂寃쎌뿉 ?ㅽ뙣?덉뒿?덈떎.",
    ),
    listViewHeaderCopy: pick(
      locale,
      "Browse saved patients and open the latest case.",
      "????섏옄瑜?蹂닿퀬 理쒖떊 耳?댁뒪瑜??쎈땲??",
    ),
    caseAuthoringHeaderCopy: pick(
      locale,
      "Create, review, and contribute cases from this workspace.",
      "???묒뾽怨듦컙?먯꽌 利앸? ?묒꽦, 寃?? 湲곗뿬瑜?吏꾪뻾?????덉뒿?덈떎.",
    ),
  };
}

export type CaseWorkspaceCopy = ReturnType<typeof buildCaseWorkspaceCopy>;
