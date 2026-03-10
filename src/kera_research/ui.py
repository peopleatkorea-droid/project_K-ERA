from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import plotly.express as px
import streamlit as st

from kera_research.config import APP_NAME
from kera_research.domain import (
    CONTACT_LENS_OPTIONS,
    CULTURE_SPECIES,
    EXECUTION_MODES,
    PREDISPOSING_FACTORS,
    SEX_OPTIONS,
    VIEW_OPTIONS,
)
from kera_research.i18n import SUPPORTED_LANGUAGES, t
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.pipeline import ResearchWorkflowService

PAGE_META = {
    "dashboard": {
        "ko": "프로젝트 대시보드",
        "en": "Project Dashboard",
        "description_ko": "프로젝트, 병원 사이트, 모델 버전, 검증 이력을 한눈에 확인하고 초기 설정을 시작합니다.",
        "description_en": "Review projects, sites, model versions, and validation history before starting the workflow.",
        "phase": "setup",
    },
    "patient_registration": {
        "ko": "환자 등록",
        "en": "Patient Registration",
        "description_ko": "환자 기본 정보만 먼저 간단히 등록합니다.",
        "description_en": "Register only the essential patient information first.",
        "phase": "data_entry",
    },
    "visit_entry": {
        "ko": "방문 정보 입력",
        "en": "Visit Entry",
        "description_ko": "culture-proven 각막염 방문 정보를 구조화하여 입력합니다.",
        "description_en": "Enter structured visit information for culture-proven keratitis cases.",
        "phase": "data_entry",
    },
    "image_upload": {
        "ko": "이미지 업로드 및 view 지정",
        "en": "Image Upload and View Assignment",
        "description_ko": "슬릿램프 이미지를 업로드하고 view를 직접 지정합니다.",
        "description_en": "Upload slit-lamp images and manually assign the view type.",
        "phase": "data_entry",
    },
    "representative_selection": {
        "ko": "대표 이미지 선택",
        "en": "Representative Image Selection",
        "description_ko": "대표 이미지를 선택해 CPU 환경에서도 효율적으로 처리할 수 있게 합니다.",
        "description_en": "Select representative images for efficient processing, especially in CPU mode.",
        "phase": "data_entry",
    },
    "dataset_review": {
        "ko": "데이터셋 검토",
        "en": "Dataset Review",
        "description_ko": "현재까지 입력된 데이터가 manifest로 어떻게 구성되는지 검토합니다.",
        "description_en": "Review how the entered records are organized into the dataset manifest.",
        "phase": "data_entry",
    },
    "validation_run": {
        "ko": "외부 검증 실행",
        "en": "Run External Validation",
        "description_ko": "현재 글로벌 모델로 우선 외부 검증을 수행합니다.",
        "description_en": "Run external validation with the selected global model before local training.",
        "phase": "validation",
    },
    "validation_dashboard": {
        "ko": "검증 결과 대시보드",
        "en": "Validation Results Dashboard",
        "description_ko": "검증 요약 통계와 증례별 예측 결과를 검토합니다.",
        "description_en": "Review validation summaries and case-level predictions.",
        "phase": "review",
    },
    "gradcam_viewer": {
        "ko": "설명 시각화 뷰어",
        "en": "Explanation Viewer",
        "description_ko": "모델이 주목한 영역을 시각적으로 확인합니다.",
        "description_en": "Inspect model attention and explanation overlays.",
        "phase": "review",
    },
    "medsam_viewer": {
        "ko": "MedSAM ROI 뷰어",
        "en": "MedSAM ROI Viewer",
        "description_ko": "각막 ROI 마스크와 crop 결과를 확인합니다.",
        "description_en": "Inspect corneal ROI masks and cropped outputs.",
        "phase": "review",
    },
}

PAGES = list(PAGE_META.keys())

PHASE_META = {
    "setup": {"ko": "시작", "en": "Setup"},
    "data_entry": {"ko": "데이터 입력", "en": "Data Entry"},
    "validation": {"ko": "검증", "en": "Validation"},
    "review": {"ko": "결과 확인", "en": "Review"},
}


def run_app() -> None:
    st.set_page_config(page_title=APP_NAME, page_icon="K", layout="wide")
    init_session_state()
    inject_custom_css()

    lang = st.session_state.get("lang", "ko")
    control_plane = ControlPlaneStore()
    workflow, workflow_error = bootstrap_workflow(control_plane)

    render_sidebar(control_plane, lang)
    user = st.session_state.get("user")
    if not user:
        render_login_screen(lang)
        return

    context = resolve_context(control_plane)
    render_primary_navigation(lang)
    page_id = st.session_state.get("page_id", PAGES[0])
    site_store = SiteStore(context["site"]["site_id"]) if context["site"] else None

    st.title(APP_NAME)
    st.caption(
        t(
            lang,
            "병원 로컬 이미지를 중앙으로 올리지 않고, 감염성 각막염 연구 데이터셋 정리와 외부 검증, 선택적 로컬 파인튜닝을 수행하는 연구 플랫폼입니다.",
            "A research platform for infectious keratitis dataset curation, external validation, and optional local fine-tuning without uploading raw local images.",
        ),
    )
    render_page_intro(page_id, lang)
    if workflow_error:
        st.error(workflow_error)

    if site_store is not None:
        render_workflow_status(control_plane, context, site_store, lang)

    if page_id == "dashboard":
        render_project_dashboard(control_plane, context, workflow, lang)
        return

    if not context["project"] or not context["site"]:
        st.warning(
            t(
                lang,
                "데이터 입력과 검증을 사용하려면 먼저 대시보드에서 프로젝트와 사이트를 생성하세요.",
                "Create a project and a site from the dashboard before using the local data workflows.",
            ),
        )
        return

    if page_id == "patient_registration":
        render_patient_registration(site_store, lang)
    elif page_id == "visit_entry":
        render_visit_entry(control_plane, site_store, user, lang)
    elif page_id == "image_upload":
        render_image_upload(site_store, lang)
    elif page_id == "representative_selection":
        render_representative_selection(site_store, lang)
    elif page_id == "dataset_review":
        render_dataset_review(site_store, lang)
    elif page_id == "validation_run":
        render_external_validation(control_plane, workflow, context, site_store, lang)
    elif page_id == "validation_dashboard":
        render_validation_dashboard(control_plane, context, lang)
    elif page_id == "gradcam_viewer":
        render_gradcam_viewer(site_store, lang)
    elif page_id == "medsam_viewer":
        render_medsam_viewer(site_store, lang)


def init_session_state() -> None:
    st.session_state.setdefault("user", None)
    st.session_state.setdefault("page_id", PAGES[0])
    st.session_state.setdefault("lang", "ko")


def inject_custom_css() -> None:
    st.markdown(
        """
        <style>
        :root {
            --kera-ink: #17324d;
            --kera-muted: #61788f;
            --kera-accent: #0d8f8a;
            --kera-accent-soft: #e8f6f5;
            --kera-warm: #f6f1e8;
            --kera-card: rgba(255, 255, 255, 0.86);
            --kera-border: rgba(23, 50, 77, 0.10);
        }

        .stApp {
            background:
                radial-gradient(circle at top right, rgba(13, 143, 138, 0.10), transparent 26%),
                radial-gradient(circle at top left, rgba(214, 180, 104, 0.12), transparent 24%),
                linear-gradient(180deg, #f4f7fb 0%, #eef4f2 100%);
            color: var(--kera-ink);
            font-family: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
        }

        .kera-hero {
            background: linear-gradient(135deg, rgba(255,255,255,0.92), rgba(232,246,245,0.92));
            border: 1px solid var(--kera-border);
            border-radius: 22px;
            padding: 1.1rem 1.25rem 1rem 1.25rem;
            margin: 0.35rem 0 1rem 0;
            box-shadow: 0 18px 40px rgba(23, 50, 77, 0.06);
        }

        .kera-eyebrow {
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--kera-accent);
            margin-bottom: 0.35rem;
        }

        .kera-hero h3 {
            margin: 0 0 0.25rem 0;
            color: var(--kera-ink);
            font-size: 1.35rem;
        }

        .kera-hero p {
            margin: 0;
            color: var(--kera-muted);
            font-size: 0.95rem;
            line-height: 1.5;
        }

        .kera-card {
            background: var(--kera-card);
            border: 1px solid var(--kera-border);
            border-radius: 18px;
            padding: 0.95rem 1rem;
            box-shadow: 0 10px 28px rgba(23, 50, 77, 0.05);
        }

        .kera-card h4 {
            margin: 0 0 0.4rem 0;
            color: var(--kera-ink);
            font-size: 1rem;
        }

        .kera-card p {
            margin: 0;
            color: var(--kera-muted);
            line-height: 1.5;
            font-size: 0.92rem;
        }

        .kera-stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 0.75rem;
            margin: 0.2rem 0 0.8rem 0;
        }

        .kera-stat-card {
            background: var(--kera-card);
            border: 1px solid var(--kera-border);
            border-radius: 18px;
            padding: 0.9rem 1rem;
            box-shadow: 0 10px 24px rgba(23, 50, 77, 0.05);
        }

        .kera-stat-label {
            color: var(--kera-muted);
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.03em;
            text-transform: uppercase;
        }

        .kera-stat-value {
            color: var(--kera-ink);
            font-size: 1.45rem;
            font-weight: 800;
            margin-top: 0.25rem;
        }

        .kera-stat-note {
            color: var(--kera-muted);
            font-size: 0.82rem;
            margin-top: 0.2rem;
            line-height: 1.4;
        }

        .kera-chip-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-top: 0.6rem;
        }

        .kera-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            border-radius: 999px;
            padding: 0.35rem 0.7rem;
            background: rgba(255,255,255,0.72);
            border: 1px solid var(--kera-border);
            color: var(--kera-ink);
            font-size: 0.88rem;
            font-weight: 600;
        }

        .kera-chip.complete {
            background: rgba(13, 143, 138, 0.12);
            color: #0b6c68;
        }

        .kera-chip.pending {
            background: rgba(214, 180, 104, 0.16);
            color: #8a6531;
        }

        .kera-tip {
            background: rgba(13, 143, 138, 0.08);
            border: 1px solid rgba(13, 143, 138, 0.18);
            color: #185754;
            border-radius: 16px;
            padding: 0.85rem 1rem;
            margin: 0.4rem 0 1rem 0;
        }

        @media (max-width: 640px) {
            .kera-hero {
                border-radius: 18px;
                padding: 0.95rem 1rem;
            }

            .kera-stat-value {
                font-size: 1.25rem;
            }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def bootstrap_workflow(control_plane: ControlPlaneStore) -> tuple[ResearchWorkflowService | None, str | None]:
    try:
        return ResearchWorkflowService(control_plane), None
    except Exception as exc:  # pragma: no cover - UI guard
        return None, f"Workflow services are unavailable: {exc}"


def page_label(page_id: str, lang: str) -> str:
    return PAGE_META[page_id]["ko"] if lang == "ko" else PAGE_META[page_id]["en"]


def phase_label(phase_id: str, lang: str) -> str:
    return PHASE_META[phase_id]["ko"] if lang == "ko" else PHASE_META[phase_id]["en"]


def render_primary_navigation(lang: str) -> None:
    current_page_id = st.session_state.get("page_id", PAGES[0])
    current_phase = PAGE_META[current_page_id]["phase"]
    phase_options = list(PHASE_META.keys())
    selected_phase = st.radio(
        t(lang, "연구 단계", "Workflow Stage"),
        phase_options,
        index=phase_options.index(current_phase),
        horizontal=True,
        format_func=lambda value: phase_label(value, lang),
    )

    phase_pages = [page_id for page_id in PAGES if PAGE_META[page_id]["phase"] == selected_phase]
    selected_page = st.radio(
        t(lang, "화면 선택", "Screen"),
        phase_pages,
        index=phase_pages.index(current_page_id) if current_page_id in phase_pages else 0,
        horizontal=True,
        label_visibility="collapsed",
        format_func=lambda value: page_label(value, lang),
    )
    st.session_state["page_id"] = selected_page


def render_page_intro(page_id: str, lang: str) -> None:
    description = PAGE_META[page_id]["description_ko"] if lang == "ko" else PAGE_META[page_id]["description_en"]
    st.markdown(
        f"""
        <div class="kera-hero">
            <div class="kera-eyebrow">Research Workflow</div>
            <h3>{page_label(page_id, lang)}</h3>
            <p>{description}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_stat_grid(cards: list[dict[str, str]]) -> None:
    html = "".join(
        f"""
        <div class="kera-stat-card">
            <div class="kera-stat-label">{card['label']}</div>
            <div class="kera-stat-value">{card['value']}</div>
            <div class="kera-stat-note">{card.get('note', '')}</div>
        </div>
        """
        for card in cards
    )
    st.markdown(f"<div class='kera-stat-grid'>{html}</div>", unsafe_allow_html=True)


def workflow_snapshot(
    control_plane: ControlPlaneStore,
    context: dict[str, Any],
    site_store: SiteStore,
    lang: str,
) -> dict[str, Any]:
    patient_count = len(site_store.list_patients())
    visit_count = len(site_store.list_visits())
    image_count = len(site_store.list_images())
    manifest_count = len(site_store.dataset_records())
    validation_count = len(
        control_plane.list_validation_runs(
            context["project"]["project_id"],
            context["site"]["site_id"],
        ),
    )

    step_state = {
        t(lang, "프로젝트", "Project"): bool(context["project"]),
        t(lang, "사이트", "Site"): bool(context["site"]),
        t(lang, "환자", "Patients"): patient_count > 0,
        t(lang, "방문", "Visits"): visit_count > 0,
        t(lang, "이미지", "Images"): image_count > 0,
        "Manifest": manifest_count > 0,
        t(lang, "검증", "Validation"): validation_count > 0,
    }

    if patient_count == 0:
        next_action = t(lang, "다음 권장 단계: 환자 등록부터 시작하세요.", "Recommended next step: start with patient registration.")
    elif visit_count == 0:
        next_action = t(lang, "다음 권장 단계: 방문 정보를 입력하세요.", "Recommended next step: enter visit information.")
    elif image_count == 0:
        next_action = t(lang, "다음 권장 단계: 업로드할 슬릿램프 이미지를 추가하세요.", "Recommended next step: upload slit-lamp images.")
    elif manifest_count == 0:
        next_action = t(lang, "다음 권장 단계: manifest를 생성하세요.", "Recommended next step: generate the manifest.")
    elif validation_count == 0:
        next_action = t(lang, "다음 권장 단계: external validation을 먼저 실행하세요.", "Recommended next step: run external validation first.")
    else:
        next_action = t(
            lang,
            "검증이 완료되었습니다. 결과를 검토하거나 선택적으로 로컬 fine-tuning을 진행할 수 있습니다.",
            "Validation is complete. Review the results or proceed with optional local fine-tuning.",
        )

    return {
        "patients": patient_count,
        "visits": visit_count,
        "images": image_count,
        "manifest_rows": manifest_count,
        "validations": validation_count,
        "step_state": step_state,
        "next_action": next_action,
    }


def render_workflow_status(
    control_plane: ControlPlaneStore,
    context: dict[str, Any],
    site_store: SiteStore,
    lang: str,
) -> None:
    snapshot = workflow_snapshot(control_plane, context, site_store, lang)
    completed = sum(1 for done in snapshot["step_state"].values() if done)
    progress_ratio = completed / len(snapshot["step_state"])

    render_stat_grid(
        [
            {"label": t(lang, "환자", "Patients"), "value": str(snapshot["patients"]), "note": t(lang, "등록 완료 환자 수", "Registered patients")},
            {"label": t(lang, "방문", "Visits"), "value": str(snapshot["visits"]), "note": t(lang, "입력된 방문 수", "Recorded visits")},
            {"label": t(lang, "이미지", "Images"), "value": str(snapshot["images"]), "note": t(lang, "업로드된 이미지 수", "Uploaded images")},
            {"label": t(lang, "검증", "Validations"), "value": str(snapshot["validations"]), "note": t(lang, "완료된 검증 수", "Completed validations")},
        ],
    )
    st.markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "현재 작업 위치", "Current workspace")}</h4>
            <p><strong>{context['project']['name']}</strong> / {context['site']['display_name']}</p>
            <p>{snapshot['next_action']}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.progress(
        progress_ratio,
        text=t(
            lang,
            f"연구 워크플로우 진행률 {completed}/{len(snapshot['step_state'])}",
            f"Workflow progress {completed}/{len(snapshot['step_state'])}",
        ),
    )
    chip_html = "".join(
        f"<div class='kera-chip {'complete' if done else 'pending'}'>{t(lang, '완료', 'Done') if done else t(lang, '대기', 'Pending')} {label}</div>"
        for label, done in snapshot["step_state"].items()
    )
    st.markdown(f"<div class='kera-chip-row'>{chip_html}</div>", unsafe_allow_html=True)


def render_sidebar(control_plane: ControlPlaneStore, lang: str) -> None:
    st.sidebar.title(t(lang, "탐색", "Navigation"))
    selected_lang = st.sidebar.selectbox(
        t(lang, "언어", "Language"),
        list(SUPPORTED_LANGUAGES.keys()),
        index=list(SUPPORTED_LANGUAGES.keys()).index(lang),
        format_func=lambda value: SUPPORTED_LANGUAGES[value],
    )
    if selected_lang != lang:
        st.session_state["lang"] = selected_lang
        st.rerun()

    st.sidebar.caption(
        t(
            lang,
            "권장 순서: 대시보드 -> 환자 -> 방문 -> 이미지 -> 검증",
            "Suggested order: Dashboard -> Patient -> Visit -> Image -> Validation",
        ),
    )

    user = st.session_state.get("user")
    if user:
        st.sidebar.success(f"{user['full_name']} ({user['role']})")
        if st.sidebar.button(t(lang, "로그아웃", "Log out")):
            st.session_state["user"] = None
            st.rerun()
    else:
        with st.sidebar.form("login_form"):
            username = st.text_input(t(lang, "사용자 이름", "Username"))
            password = st.text_input(t(lang, "비밀번호", "Password"), type="password")
            submitted = st.form_submit_button(t(lang, "로그인", "Log in"))
        if submitted:
            user = control_plane.authenticate(username, password)
            if user:
                st.session_state["user"] = user
                st.rerun()
            st.sidebar.error(t(lang, "사용자 이름 또는 비밀번호가 올바르지 않습니다.", "Invalid username or password."))


def render_login_screen(lang: str) -> None:
    st.markdown(
        f"""
        <div class="kera-hero">
            <div class="kera-eyebrow">Welcome</div>
            <h3>{t(lang, "연구 시작 전 로그인", "Sign in to start the research workflow")}</h3>
            <p>{t(lang, "좌측 사이드바에서 로그인하면 프로젝트 생성, 병원 사이트 등록, 데이터 입력, 외부 검증까지 순서대로 진행할 수 있습니다.", "Use the left sidebar to sign in, then proceed through project setup, site registration, data entry, and external validation.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    guide_columns = st.columns(3)
    guide_columns[0].markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "1. 프로젝트 생성", "1. Create a project")}</h4>
            <p>{t(lang, "연구명과 설명만 입력하면 바로 시작할 수 있습니다.", "You can start immediately with only a project name and short description.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    guide_columns[1].markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "2. 병원별 로컬 입력", "2. Site-local data entry")}</h4>
            <p>{t(lang, "환자, 방문, 이미지 정보는 병원 로컬 폴더에만 저장됩니다.", "Patient, visit, and image records remain in the hospital-local folder.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    guide_columns[2].markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "3. 외부 검증 우선", "3. Validate first")}</h4>
            <p>{t(lang, "새 데이터는 먼저 검증하고, 필요할 때만 로컬 fine-tuning을 진행합니다.", "New data should be externally validated first, then locally fine-tuned only when needed.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.markdown(
        f"""
        <div class="kera-tip">
            {t(lang, "기본 계정", "Default accounts")}: <strong>admin / admin123</strong>, <strong>researcher / research123</strong><br/>
            {t(lang, "로그인 입력창은 좌측 사이드바에 있습니다.", "The sign-in form is located in the left sidebar.")}
        </div>
        """,
        unsafe_allow_html=True,
    )


def resolve_context(control_plane: ControlPlaneStore) -> dict[str, Any]:
    lang = st.session_state.get("lang", "ko")
    projects = control_plane.list_projects()
    project = None
    site = None

    if projects:
        project_lookup = {
            f"{item['name']} ({item['project_id']})": item
            for item in projects
        }
        project_label = st.sidebar.selectbox(t(lang, "프로젝트", "Project"), list(project_lookup.keys()))
        project = project_lookup[project_label]

        sites = control_plane.list_sites(project["project_id"])
        if sites:
            site_lookup = {
                f"{item['display_name']} ({item['site_id']})": item
                for item in sites
            }
            site_label = st.sidebar.selectbox(t(lang, "사이트", "Site"), list(site_lookup.keys()))
            site = site_lookup[site_label]
        else:
            st.sidebar.info(t(lang, "이 프로젝트에는 아직 등록된 사이트가 없습니다.", "No site is registered for this project yet."))
    else:
        st.sidebar.info(t(lang, "아직 생성된 프로젝트가 없습니다.", "No project exists yet."))

    return {"project": project, "site": site}


def render_project_dashboard(
    control_plane: ControlPlaneStore,
    context: dict[str, Any],
    workflow: ResearchWorkflowService | None,
    lang: str,
) -> None:
    projects = control_plane.list_projects()
    sites = control_plane.list_sites()
    validations = control_plane.list_validation_runs()
    model_versions = control_plane.list_model_versions()
    updates = control_plane.list_model_updates()
    requests_df = pd.DataFrame(control_plane.list_organism_requests())

    render_stat_grid(
        [
            {"label": t(lang, "프로젝트", "Projects"), "value": str(len(projects)), "note": t(lang, "활성 연구 프로젝트", "Active research projects")},
            {"label": t(lang, "사이트", "Sites"), "value": str(len(sites)), "note": t(lang, "등록된 병원 사이트", "Registered hospital sites")},
            {"label": t(lang, "검증", "Validations"), "value": str(len(validations)), "note": t(lang, "전체 검증 실행 수", "Total validation runs")},
            {"label": t(lang, "모델", "Models"), "value": str(len(model_versions)), "note": t(lang, "사용 가능한 모델 버전", "Available model versions")},
            {"label": t(lang, "균종 요청", "Organism Requests"), "value": str(int((requests_df["status"] == "pending").sum()) if not requests_df.empty else 0), "note": t(lang, "대기 중 승인 요청", "Pending approvals")},
        ],
    )

    quick_columns = st.columns(3)
    quick_columns[0].markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "연구 시작", "Start the study")}</h4>
            <p>{t(lang, "프로젝트를 만들고 병원 site를 등록하면 바로 로컬 데이터 입력을 시작할 수 있습니다.", "Create a project and register a hospital site to start local data entry immediately.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    quick_columns[1].markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "데이터 보안", "Data security")}</h4>
            <p>{t(lang, "원본 이미지는 site 로컬 경로에만 저장되고 중앙에는 올라가지 않습니다.", "Raw images remain in the site-local folder and are not uploaded centrally.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    quick_columns[2].markdown(
        f"""
        <div class="kera-card">
            <h4>{t(lang, "권장 흐름", "Recommended flow")}</h4>
            <p>{t(lang, "입력 후 바로 학습하지 말고 먼저 external validation을 수행하도록 설계되어 있습니다.", "The platform is intentionally designed so that external validation comes before local training.")}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    overview_tab, project_tab, catalog_tab = st.tabs(
        [
            t(lang, "개요", "Overview"),
            t(lang, "프로젝트 설정", "Project Setup"),
            t(lang, "균종 관리", "Organisms"),
        ],
    )

    with overview_tab:
        st.subheader(t(lang, "중앙 관리 현황", "Control plane overview"))
        global_models = [item for item in model_versions if item.get("stage") == "global"]
        if global_models:
            model_labels = ", ".join(
                f"{item['version_name']} [{item.get('architecture', 'cnn')}]"
                for item in global_models
            )
            st.info(t(lang, f"사용 가능한 글로벌 모델: {model_labels}", f"Available global models: {model_labels}"))
        else:
            st.warning(t(lang, "아직 등록된 글로벌 모델이 없습니다.", "No global model is registered yet."))

        if projects:
            st.dataframe(pd.DataFrame(projects), use_container_width=True)
        if sites:
            st.dataframe(pd.DataFrame(sites), use_container_width=True)
        if model_versions:
            st.dataframe(pd.DataFrame(model_versions), use_container_width=True)
        if updates:
            st.dataframe(pd.DataFrame(updates), use_container_width=True)

    with project_tab:
        st.subheader(t(lang, "프로젝트 생성", "Create project"))
        with st.form("create_project_form"):
            project_name = st.text_input(t(lang, "프로젝트 이름", "Project name"))
            description = st.text_area(t(lang, "프로젝트 설명", "Project description"))
            submitted = st.form_submit_button(t(lang, "프로젝트 생성", "Create project"))
        if submitted:
            if not project_name.strip():
                st.error(t(lang, "프로젝트 이름이 필요합니다.", "Project name is required."))
            else:
                control_plane.create_project(project_name.strip(), description.strip(), st.session_state["user"]["user_id"])
                st.success(t(lang, "프로젝트가 생성되었습니다.", "Project created."))

        if context["project"]:
            st.subheader(t(lang, "로컬 사이트 등록", "Register local site"))
            with st.form("create_site_form"):
                site_code = st.text_input(t(lang, "사이트 코드", "Site code"), help=t(lang, "병원 내부에서 안정적으로 사용할 수 있는 site 식별자를 사용하세요.", "Use a stable hospital-local site identifier."))
                display_name = st.text_input(t(lang, "사이트 표시 이름", "Site display name"))
                hospital_name = st.text_input(t(lang, "병원명", "Hospital name"))
                submitted = st.form_submit_button(t(lang, "사이트 등록", "Register site"))
            if submitted:
                try:
                    control_plane.create_site(
                        context["project"]["project_id"],
                        site_code.strip(),
                        display_name.strip(),
                        hospital_name.strip(),
                    )
                    st.success(t(lang, "사이트가 등록되었습니다.", "Site registered."))
                except Exception as exc:
                    st.error(str(exc))
        else:
            st.info(t(lang, "사이트를 등록하기 전에 먼저 프로젝트를 생성하세요.", "Create a project before registering a site."))

        if workflow is None:
            st.warning(t(lang, "모델 서비스가 현재 사용 불가능합니다.", "Model services are currently unavailable."))

    with catalog_tab:
        catalog = control_plane.list_organisms()
        st.subheader(t(lang, "배양 균종 목록", "Culture species catalog"))
        catalog_columns = st.columns(2)
        catalog_columns[0].dataframe(pd.DataFrame({"bacterial": catalog["bacterial"]}), use_container_width=True)
        catalog_columns[1].dataframe(pd.DataFrame({"fungal": catalog["fungal"]}), use_container_width=True)

        st.subheader(t(lang, "신규 균종 요청", "Organism requests"))
        if requests_df.empty:
            st.info(t(lang, "아직 요청된 신규 균종이 없습니다.", "No organism requests yet."))
        else:
            st.dataframe(requests_df, use_container_width=True)
            pending_requests = [item for item in control_plane.list_organism_requests("pending")]
            if st.session_state["user"]["role"] == "admin" and pending_requests:
                request_lookup = {
                    f"{item['requested_species']} ({item['culture_category']}) [{item['request_id']}]": item
                    for item in pending_requests
                }
                selected_label = st.selectbox(t(lang, "대기 중 요청", "Pending request"), list(request_lookup.keys()))
                if st.button(t(lang, "선택한 균종 승인", "Approve selected organism")):
                    control_plane.approve_organism(
                        request_lookup[selected_label]["request_id"],
                        st.session_state["user"]["user_id"],
                    )
                    st.success(t(lang, "균종이 승인되어 목록에 추가되었습니다.", "Organism approved and added to the dropdown list."))
            elif st.session_state["user"]["role"] != "admin":
                st.info(t(lang, "신규 균종 승인 권한은 관리자에게만 있습니다.", "Only administrators can approve organism requests."))


def render_patient_registration(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "환자 등록", "Patient registration"))
    st.caption(t(lang, "환자 기본 정보만 먼저 간단하게 입력합니다. 방문 정보와 이미지는 다음 단계에서 입력합니다.", "Enter only essential patient details here. Visit and image information come next."))
    with st.form("patient_form"):
        form_columns = st.columns(3)
        patient_id = form_columns[0].text_input("Patient ID", placeholder=t(lang, "예: P001", "e.g. P001"))
        sex = form_columns[1].selectbox(t(lang, "성별", "Sex"), SEX_OPTIONS)
        age = form_columns[2].number_input(t(lang, "나이", "Age"), min_value=0, max_value=120, value=50)
        submitted = st.form_submit_button(t(lang, "환자 저장", "Save patient"))
    if submitted:
        try:
            site_store.create_patient(patient_id.strip(), sex, int(age))
            st.success(t(lang, "환자 정보가 로컬에 저장되었습니다.", "Patient record saved locally."))
        except Exception as exc:
            st.error(str(exc))

    patients = site_store.list_patients()
    if patients:
        st.dataframe(pd.DataFrame(patients), use_container_width=True)
    else:
        st.info(t(lang, "아직 등록된 환자가 없습니다.", "No patient records yet."))


def render_visit_entry(control_plane: ControlPlaneStore, site_store: SiteStore, user: dict[str, Any], lang: str) -> None:
    st.subheader(t(lang, "방문 정보 입력", "Visit entry"))
    st.caption(t(lang, "이 화면은 culture-proven keratitis case만 입력할 수 있습니다.", "Only culture-proven keratitis cases can be entered on this screen."))
    patients = site_store.list_patients()
    if not patients:
        st.warning(t(lang, "먼저 환자를 등록하세요.", "Register a patient first."))
        return

    patient_options = {item["patient_id"]: item for item in patients}
    with st.form("visit_form"):
        top_columns = st.columns(3)
        patient_id = top_columns[0].selectbox(t(lang, "환자", "Patient"), list(patient_options.keys()))
        visit_date = top_columns[1].date_input(t(lang, "방문일", "Visit date"))
        culture_confirmed = top_columns[2].checkbox(t(lang, "배양 확인", "Culture confirmed"), value=True)

        middle_columns = st.columns(3)
        culture_category = middle_columns[0].selectbox(t(lang, "배양 범주", "Culture category"), list(CULTURE_SPECIES.keys()))
        species_options = control_plane.list_organisms(culture_category)
        culture_species = middle_columns[1].selectbox(t(lang, "배양 균종", "Culture species"), species_options)
        contact_lens_use = middle_columns[2].selectbox(t(lang, "콘택트렌즈 사용", "Contact lens use"), CONTACT_LENS_OPTIONS)

        predisposing_factor = st.multiselect(t(lang, "선행 위험인자", "Predisposing factors"), PREDISPOSING_FACTORS)
        other_history = st.text_area(t(lang, "기타 병력", "Other history"), placeholder=t(lang, "필요한 경우에만 간단히 입력", "Optional short note"))
        submitted = st.form_submit_button(t(lang, "방문 저장", "Save visit"))
    if submitted:
        try:
            site_store.create_visit(
                patient_id=patient_id,
                visit_date=str(visit_date),
                culture_confirmed=culture_confirmed,
                culture_category=culture_category,
                culture_species=culture_species,
                contact_lens_use=contact_lens_use,
                predisposing_factor=predisposing_factor,
                other_history=other_history.strip(),
            )
            st.success(t(lang, "방문 정보가 로컬에 저장되었습니다.", "Visit saved locally."))
        except Exception as exc:
            st.error(str(exc))

    with st.expander(t(lang, "신규 균종 요청", "Request a new organism entry")):
        requested_species = st.text_input(t(lang, "요청 균종명", "Requested species"))
        if st.button(t(lang, "균종 요청 제출", "Submit organism request")):
            if not requested_species.strip():
                st.error(t(lang, "균종명을 입력한 뒤 제출하세요.", "Enter a species name before submitting."))
            else:
                control_plane.request_new_organism(culture_category, requested_species.strip(), user["user_id"])
                st.success(t(lang, "균종 요청이 관리자에게 전달되었습니다.", "Organism request submitted to administrators."))

    visits = site_store.list_visits()
    if visits:
        st.dataframe(pd.DataFrame(visits), use_container_width=True)
    else:
        st.info(t(lang, "아직 입력된 방문 정보가 없습니다.", "No visits yet."))


def render_image_upload(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "이미지 업로드 및 view 지정", "Image upload and view assignment"))
    st.caption(t(lang, "각 이미지에 대해 사용자가 직접 view를 지정합니다. 자동 분류는 하지 않습니다.", "Users assign the image view manually. No automatic view classification is performed."))
    visits = site_store.list_visits()
    if not visits:
        st.warning(t(lang, "이미지를 업로드하기 전에 먼저 방문 정보를 생성하세요.", "Create a visit before uploading images."))
        return

    visit_lookup = {
        f"{item['patient_id']} | {item['visit_date']} | {item['culture_species']}": item
        for item in visits
    }
    selected_label = st.selectbox("Visit", list(visit_lookup.keys()))
    selected_visit = visit_lookup[selected_label]

    uploaded_files = st.file_uploader(
        t(lang, "슬릿램프 이미지 업로드", "Upload slit-lamp images"),
        accept_multiple_files=True,
        type=["png", "jpg", "jpeg"],
    )
    if uploaded_files:
        st.markdown(
            f"""
            <div class="kera-tip">
                {t(lang, "업로드 후 각 이미지에서 <strong>view</strong>와 <strong>대표 이미지 여부</strong>를 직접 지정하세요.", "After upload, manually assign the <strong>view</strong> and whether it is a <strong>representative image</strong>.")}
            </div>
            """,
            unsafe_allow_html=True,
        )
        for index, uploaded_file in enumerate(uploaded_files):
            preview_col, input_col = st.columns([1, 1.2])
            with preview_col:
                st.image(uploaded_file, width=220, caption=uploaded_file.name)
            with input_col:
                st.selectbox("View", VIEW_OPTIONS, key=f"view_{index}_{uploaded_file.name}")
                st.checkbox(t(lang, "대표 이미지", "Representative image"), key=f"representative_{index}_{uploaded_file.name}")

        if st.button(t(lang, "업로드 이미지 저장", "Save uploaded images")):
            saved = 0
            for index, uploaded_file in enumerate(uploaded_files):
                site_store.add_image(
                    patient_id=selected_visit["patient_id"],
                    visit_date=selected_visit["visit_date"],
                    view=st.session_state[f"view_{index}_{uploaded_file.name}"],
                    is_representative=st.session_state[f"representative_{index}_{uploaded_file.name}"],
                    file_name=uploaded_file.name,
                    content=uploaded_file.getvalue(),
                )
                saved += 1
            st.success(
                t(
                    lang,
                    f"{saved}개의 이미지가 로컬 사이트 폴더에 저장되었습니다.",
                    f"Saved {saved} image(s) into the local site folder.",
                ),
            )

    images = site_store.list_images()
    if images:
        st.dataframe(pd.DataFrame(images), use_container_width=True)


def render_representative_selection(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "대표 이미지 선택", "Representative image selection"))
    images = site_store.list_images()
    if not images:
        st.warning(t(lang, "아직 업로드된 이미지가 없습니다.", "No images are available yet."))
        return

    image_df = pd.DataFrame(images)
    editable = st.data_editor(
        image_df[["image_id", "patient_id", "visit_date", "view", "is_representative", "image_path"]],
        use_container_width=True,
        hide_index=True,
        disabled=["image_id", "patient_id", "visit_date", "view", "image_path"],
        column_config={
            "is_representative": st.column_config.CheckboxColumn(t(lang, "대표 이미지", "Representative")),
        },
    )
    if st.button(t(lang, "대표 이미지 설정 저장", "Save representative flags")):
        updates = {
            row["image_id"]: row["is_representative"]
            for _, row in editable.iterrows()
        }
        site_store.update_representative_flags(updates)
        st.success(t(lang, "대표 이미지 설정이 업데이트되었습니다.", "Representative image flags updated."))

    preview_lookup = {row["image_id"]: row for _, row in image_df.iterrows()}
    selected_image_id = st.selectbox(t(lang, "미리보기 이미지", "Preview image"), list(preview_lookup.keys()))
    st.image(preview_lookup[selected_image_id]["image_path"], use_container_width=True)


def render_dataset_review(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "데이터셋 검토", "Dataset review"))
    st.caption(t(lang, "입력된 환자, 방문, 이미지 정보를 image-level manifest 형태로 자동 정리합니다.", "Patient, visit, and image records are automatically organized into an image-level manifest."))
    if st.button(t(lang, "Manifest 생성", "Generate manifest")):
        manifest_df = site_store.generate_manifest()
        st.success(t(lang, "로컬 환자, 방문, 이미지 정보로부터 manifest가 생성되었습니다.", "Manifest generated from local patient, visit, and image records."))
    else:
        manifest_df = site_store.load_manifest()

    if manifest_df.empty:
        st.info(t(lang, "manifest가 비어 있습니다. 먼저 방문 정보와 이미지를 입력하세요.", "The manifest is empty. Add visits and images first."))
        return

    st.dataframe(manifest_df, use_container_width=True)
    st.download_button(
        t(lang, "Manifest CSV 다운로드", "Download manifest CSV"),
        data=manifest_df.to_csv(index=False).encode("utf-8"),
        file_name="dataset_manifest.csv",
        mime="text/csv",
    )


def render_external_validation(
    control_plane: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    context: dict[str, Any],
    site_store: SiteStore,
    lang: str,
) -> None:
    st.subheader(t(lang, "외부 검증 실행", "External validation"))
    st.caption(t(lang, "새 사이트 데이터는 학습 전에 먼저 external validation을 수행하는 것이 권장됩니다.", "New site data should be externally validated before any local training.")) 
    if workflow is None:
        st.error(t(lang, "워크플로우 서비스를 사용할 수 없습니다. 먼저 전체 의존성을 설치하세요.", "Workflow services are unavailable. Install the full requirements first."))
        return

    hardware = detect_hardware()
    global_models = [
        item for item in control_plane.list_model_versions()
        if item.get("stage") == "global"
    ]
    if not global_models:
        st.error(t(lang, "등록된 글로벌 모델 버전이 없습니다.", "No global model version is registered."))
        return

    model_lookup = {
        f"{item['version_name']} [{item.get('architecture', 'cnn')}]": item
        for item in global_models
    }

    render_stat_grid(
        [
            {"label": "CPU", "value": hardware["cpu_name"], "note": t(lang, "현재 사용 가능한 CPU", "Available CPU")},
            {"label": "GPU", "value": t(lang, "사용 가능" if hardware["gpu_available"] else "없음", "Available" if hardware["gpu_available"] else "None"), "note": hardware["gpu_name"] or "N/A"},
            {"label": "CUDA", "value": hardware["cuda_version"] or "N/A", "note": t(lang, "CUDA 버전", "CUDA version")},
        ],
    )

    selector_columns = st.columns([1, 1.4])
    selected_mode = selector_columns[0].selectbox(t(lang, "실행 모드", "Execution mode"), EXECUTION_MODES)
    selected_model_label = selector_columns[1].selectbox(t(lang, "검증 모델", "Validation model"), list(model_lookup.keys()))
    selected_model = model_lookup[selected_model_label]
    execution_device = resolve_execution_mode(selected_mode, hardware)
    option_columns = st.columns(2)
    generate_gradcam = option_columns[0].checkbox(t(lang, "설명 시각화 생성", "Generate explanation artifacts"), value=True)
    generate_medsam = option_columns[1].checkbox(t(lang, "MedSAM ROI 생성", "Generate MedSAM ROI artifacts"), value=True)
    selected_model_note = selected_model.get("notes_ko") if lang == "ko" else selected_model.get("notes_en")
    st.info(
        t(
            lang,
            f"선택 모델 설명: {selected_model_note or selected_model.get('notes', '')}",
            f"Selected model note: {selected_model_note or selected_model.get('notes', '')}",
        ),
    )
    st.caption(
        t(
            lang,
            f"선택 아키텍처: `{selected_model.get('architecture', 'cnn')}`. CNN은 Grad-CAM 스타일, ViT는 patch-token CAM, Swin은 마지막 hierarchical stage 기반 CAM을 사용합니다.",
            f"Selected architecture: `{selected_model.get('architecture', 'cnn')}`. CNN uses Grad-CAM-style maps, ViT uses patch-token CAM, and Swin uses hierarchical stage CAM.",
        ),
    )

    if execution_device == "cpu":
        st.info(
            t(
                lang,
                "CPU 모드에서는 대화형 검증 중 representative image 중심으로 시각화와 ROI 생성 범위를 제한합니다. 전체 MedSAM batch는 background job으로 큐잉할 수 있습니다.",
                "CPU mode limits interactive explanation and ROI generation to representative images. Full MedSAM batch processing can be queued as a background job.",
            ),
        )
        if st.button(t(lang, "전체 MedSAM batch 작업 큐 등록", "Queue full MedSAM batch job")):
            job = site_store.enqueue_job("medsam_batch", {"scope": "full_manifest"})
            st.success(t(lang, f"작업 {job['job_id']}가 큐에 등록되었습니다.", f"Queued job {job['job_id']}."))
        if st.button(t(lang, "대기 중 작업 지금 실행", "Process queued jobs now")):
            processed = process_background_jobs(site_store, workflow)
            st.success(t(lang, f"{processed}개의 대기 작업을 처리했습니다.", f"Processed {processed} queued job(s)."))

    if st.button(t(lang, "외부 검증 실행", "Run external validation")):
        try:
            summary, case_predictions, manifest_df = workflow.run_external_validation(
                project_id=context["project"]["project_id"],
                site_store=site_store,
                model_version=selected_model,
                execution_device=execution_device,
                generate_gradcam=generate_gradcam,
                generate_medsam=generate_medsam,
            )
            st.session_state["latest_validation_summary"] = summary
            st.session_state["latest_validation_cases"] = case_predictions
            st.success(t(lang, "외부 검증이 완료되어 중앙 control plane에 저장되었습니다.", "External validation completed and saved to the control plane."))
            render_stat_grid(
                [
                    {"label": "AUROC", "value": "N/A" if summary["AUROC"] is None else f"{summary['AUROC']:.3f}", "note": t(lang, "검증 요약", "Validation summary")},
                    {"label": t(lang, "정확도", "Accuracy"), "value": f"{summary['accuracy']:.3f}", "note": t(lang, "전체 정확도", "Overall accuracy")},
                    {"label": t(lang, "민감도", "Sensitivity"), "value": f"{summary['sensitivity']:.3f}", "note": t(lang, "양성 탐지율", "Positive detection rate")},
                    {"label": t(lang, "특이도", "Specificity"), "value": f"{summary['specificity']:.3f}", "note": t(lang, "음성 판별률", "Negative discrimination rate")},
                ],
            )
            result_tabs = st.tabs([t(lang, "요약", "Summary"), t(lang, "증례", "Cases")])
            with result_tabs[0]:
                st.dataframe(pd.DataFrame([summary]), use_container_width=True)
                st.caption(t(lang, f"{manifest_df['patient_id'].nunique()}명 환자 / {len(manifest_df)}장 이미지 검증 완료", f"Validated {manifest_df['patient_id'].nunique()} patients / {len(manifest_df)} images."))
            with result_tabs[1]:
                st.dataframe(pd.DataFrame(case_predictions), use_container_width=True)
        except Exception as exc:
            st.error(str(exc))

    latest_summary = st.session_state.get("latest_validation_summary")
    if latest_summary:
        st.subheader(t(lang, "최근 검증 요약", "Latest validation summary"))
        st.json(latest_summary)

    st.divider()
    st.subheader(t(lang, "선택적 로컬 fine-tuning", "Optional local fine-tuning"))
    site_runs = control_plane.list_validation_runs(context["project"]["project_id"], site_store.site_id)
    if not site_runs:
        st.warning(t(lang, "먼저 external validation을 실행하세요. 로컬 fine-tuning은 그 이후 단계로 제한됩니다.", "Run external validation first. Local fine-tuning is intentionally gated behind that step."))
        return

    upload_type = st.selectbox(
        t(lang, "모델 업데이트 업로드 형식", "Model update upload type"),
        ["full model weights", "weight delta", "aggregated update"],
    )
    default_epochs = 5 if execution_device == "cuda" else 2
    epochs = st.number_input(t(lang, "Epoch 수", "Epochs"), min_value=1, max_value=20, value=default_epochs)
    if execution_device == "cpu":
        st.caption(t(lang, "CPU 모드에서는 backbone을 고정하고 classifier head만 학습하며 epoch는 최대 3으로 제한됩니다.", "CPU mode freezes the selected backbone and trains only the classifier head, with epochs capped at 3."))
    else:
        st.caption(t(lang, "GPU 모드에서는 선택한 아키텍처에 대해 전체 fine-tuning이 가능합니다.", "GPU mode allows full fine-tuning for the selected architecture."))

    if st.button(t(lang, "로컬 fine-tuning 실행 및 업데이트 등록", "Run local fine-tuning and register update")):
        try:
            update_metadata = workflow.run_local_fine_tuning(
                site_store=site_store,
                model_version=selected_model,
                execution_device=execution_device,
                upload_type=upload_type,
                epochs=int(epochs),
            )
            st.success(t(lang, "로컬 fine-tuning이 완료되었고 모델 업데이트가 중앙에 등록되었습니다.", "Local fine-tuning finished and the model update was registered centrally."))
            st.json(update_metadata)
        except Exception as exc:
            st.error(str(exc))


def render_validation_dashboard(control_plane: ControlPlaneStore, context: dict[str, Any], lang: str) -> None:
    st.subheader(t(lang, "검증 결과 대시보드", "Validation results dashboard"))
    runs = control_plane.list_validation_runs(context["project"]["project_id"], context["site"]["site_id"])
    if not runs:
        st.info(t(lang, "이 사이트에 대한 검증 결과가 아직 없습니다.", "No validation runs found for this site."))
        return

    run_df = pd.DataFrame(runs).sort_values("run_date")
    latest = run_df.iloc[-1]
    render_stat_grid(
        [
            {"label": "AUROC", "value": "N/A" if pd.isna(latest["AUROC"]) else f"{latest['AUROC']:.3f}", "note": t(lang, "최근 검증", "Latest run")},
            {"label": t(lang, "정확도", "Accuracy"), "value": f"{latest['accuracy']:.3f}", "note": latest["model_version"]},
            {"label": t(lang, "민감도", "Sensitivity"), "value": f"{latest['sensitivity']:.3f}", "note": latest["validation_id"]},
            {"label": t(lang, "특이도", "Specificity"), "value": f"{latest['specificity']:.3f}", "note": latest["model_architecture"]},
        ],
    )

    summary_tab, trend_tab, cases_tab = st.tabs(
        [
            t(lang, "요약", "Summary"),
            t(lang, "추이", "Trends"),
            t(lang, "증례", "Cases"),
        ],
    )
    with summary_tab:
        st.dataframe(run_df, use_container_width=True)

    with trend_tab:
        metric_chart_df = run_df.melt(
            id_vars=["run_date", "validation_id"],
            value_vars=["accuracy", "sensitivity", "specificity", "F1"],
            var_name="metric",
            value_name="value",
        )
        st.plotly_chart(
            px.line(metric_chart_df, x="run_date", y="value", color="metric", markers=True),
            use_container_width=True,
        )
        if run_df["AUROC"].notna().any():
            st.plotly_chart(
                px.bar(run_df, x="validation_id", y="AUROC", color="model_version"),
                use_container_width=True,
            )

    with cases_tab:
        validation_lookup = {item["validation_id"]: item for item in runs}
        selected_validation_id = st.selectbox(t(lang, "검증 실행 선택", "Validation run"), list(validation_lookup.keys()))
        case_predictions = control_plane.load_case_predictions(selected_validation_id)
        if case_predictions:
            case_df = pd.DataFrame(case_predictions)
            filter_columns = st.columns([1, 1.2])
            incorrect_only = filter_columns[0].checkbox(t(lang, "오분류만 보기", "Incorrect only"), value=False)
            patient_search = filter_columns[1].text_input(t(lang, "환자 ID 검색", "Search patient ID"))
            if incorrect_only:
                case_df = case_df[case_df["is_correct"] == False]
            if patient_search.strip():
                case_df = case_df[case_df["patient_id"].astype(str).str.contains(patient_search.strip(), case=False)]
            st.dataframe(case_df, use_container_width=True)


def render_gradcam_viewer(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "설명 시각화 뷰어", "Explanation viewer"))
    st.caption(
        t(
            lang,
            "CNN은 Grad-CAM 스타일, ViT는 patch-token CAM, Swin은 hierarchical stage CAM overlay를 생성합니다.",
            "CNN uses Grad-CAM-style overlays, ViT uses patch-token CAM overlays, and Swin uses hierarchical stage CAM overlays.",
        ),
    )
    files = site_store.artifact_files("gradcam")
    if not files:
        st.info(t(lang, "아직 생성된 설명 시각화 artifact가 없습니다.", "No explanation artifacts exist yet."))
        return

    selected_file = st.selectbox(t(lang, "Artifact 선택", "Artifact"), [str(path) for path in files])
    st.image(selected_file, use_container_width=True)


def render_medsam_viewer(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "MedSAM ROI 뷰어", "MedSAM ROI viewer"))
    masks = site_store.artifact_files("medsam_mask")
    if not masks:
        st.info(t(lang, "아직 생성된 MedSAM ROI artifact가 없습니다.", "No MedSAM ROI artifacts exist yet."))
        return

    selected_mask = st.selectbox(t(lang, "Mask 선택", "Mask"), [str(path) for path in masks])
    mask_path = Path(selected_mask)
    crop_candidate = site_store.roi_crop_dir / mask_path.name.replace("_mask", "_crop")

    columns = st.columns(2)
    columns[0].image(selected_mask, caption=t(lang, "Mask", "Mask"), use_container_width=True)
    if crop_candidate.exists():
        columns[1].image(str(crop_candidate), caption=t(lang, "ROI crop", "ROI crop"), use_container_width=True)
    else:
        columns[1].warning(t(lang, "대응되는 ROI crop을 찾지 못했습니다.", "Matching ROI crop not found."))


def process_background_jobs(site_store: SiteStore, workflow: ResearchWorkflowService) -> int:
    processed = 0
    manifest_df = site_store.generate_manifest()
    if manifest_df.empty:
        return processed

    for job in site_store.list_jobs("queued"):
        if job["job_type"] != "medsam_batch":
            continue
        for _, row in manifest_df.iterrows():
            artifact_name = Path(row["image_path"]).stem
            workflow.medsam_service.generate_roi(
                row["image_path"],
                site_store.medsam_mask_dir / f"{artifact_name}_mask.png",
                site_store.roi_crop_dir / f"{artifact_name}_crop.png",
            )
        site_store.update_job_status(job["job_id"], "completed", {"processed_images": int(len(manifest_df))})
        processed += 1
    return processed
