from __future__ import annotations

from html import escape
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
    SMEAR_RESULT_OPTIONS,
    USER_ROLE_OPTIONS,
    VISIT_STATUS_OPTIONS,
    VIEW_OPTIONS,
)
from kera_research.i18n import t
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.runtime import detect_local_node_status
from kera_research.storage import read_json

# ──────────────────────────────────────────────
# Wizard step definitions
# ──────────────────────────────────────────────
WIZARD_STEPS = ["patient", "visit", "images", "validation", "visualization", "contribution", "thankyou"]

STEP_LABELS = {
    "patient":       {"ko": "환자 선택",    "en": "Patient"},
    "visit":         {"ko": "방문 정보",    "en": "Visit"},
    "images":        {"ko": "이미지 업로드", "en": "Images"},
    "validation":    {"ko": "검증",         "en": "Validate"},
    "visualization": {"ko": "시각화",       "en": "Visualize"},
    "contribution":  {"ko": "기여 결정",    "en": "Contribute"},
    "thankyou":      {"ko": "완료",         "en": "Done"},
}


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

def run_app() -> None:
    st.set_page_config(page_title=APP_NAME, page_icon="🔬", layout="wide")
    _init_session_state()
    _inject_css(st.session_state.get("theme", "light"))

    lang = st.session_state.get("lang", "ko")
    runtime_status = detect_local_node_status()
    cp = ControlPlaneStore()
    workflow, workflow_error = _bootstrap_workflow(cp)

    user = _render_sidebar(cp, workflow, runtime_status, lang)
    if not user:
        _render_login(cp, lang)
        return

    page = st.session_state.get("page", "wizard")
    if page == "admin" and not _can_open_admin(user):
        st.session_state["page"] = "dashboard"
        page = "dashboard"
        st.warning(t(lang, "이 계정은 관리자 화면에 접근할 수 없습니다.", "This account cannot access the admin workspace."))
    if page == "wizard" and not _can_edit_cases(user):
        st.session_state["page"] = "dashboard"
        page = "dashboard"
        st.info(t(lang, "이 계정은 읽기 전용입니다. 대시보드만 사용할 수 있습니다.", "This account is read-only and can use the dashboard only."))
    if page == "wizard":
        _render_wizard(cp, workflow, workflow_error, user, runtime_status, lang)
    elif page == "dashboard":
        _render_dashboard(cp, workflow, runtime_status, user, lang)
    elif page == "admin":
        _render_admin(cp, workflow, user, lang)


# ──────────────────────────────────────────────
# Session state
# ──────────────────────────────────────────────

def _init_session_state() -> None:
    st.session_state.setdefault("user", None)
    st.session_state.setdefault("page", "wizard")
    st.session_state.setdefault("lang", "ko")
    st.session_state.setdefault("theme", "light")
    # wizard state
    st.session_state.setdefault("wiz_step", "patient")
    st.session_state.setdefault("wiz_site_id", None)
    st.session_state.setdefault("wiz_patient", None)
    st.session_state.setdefault("wiz_visit", None)
    st.session_state.setdefault("wiz_images", [])
    st.session_state.setdefault("wiz_roi_preview", None)
    st.session_state.setdefault("wiz_validation", None)
    st.session_state.setdefault("wiz_contributed", False)
    st.session_state.setdefault("wiz_update_metadata", None)


def _reset_wizard(keep_site: bool = True) -> None:
    site_id = st.session_state.get("wiz_site_id")
    _init_session_state()
    st.session_state["wiz_step"] = "patient"
    st.session_state["wiz_patient"] = None
    st.session_state["wiz_visit"] = None
    st.session_state["wiz_images"] = []
    st.session_state["wiz_roi_preview"] = None
    st.session_state["wiz_validation"] = None
    st.session_state["wiz_contributed"] = False
    st.session_state["wiz_update_metadata"] = None
    if keep_site:
        st.session_state["wiz_site_id"] = site_id


# ──────────────────────────────────────────────
# Bootstrap
# ──────────────────────────────────────────────

def _bootstrap_workflow(cp: ControlPlaneStore) -> tuple[ResearchWorkflowService | None, str | None]:
    try:
        return ResearchWorkflowService(cp), None
    except Exception as exc:
        return None, str(exc)


def _get_site_store(site_id: str | None) -> SiteStore | None:
    if not site_id:
        return None
    return SiteStore(site_id)


def _get_execution_device(mode: str) -> str:
    hw = detect_hardware()
    return resolve_execution_mode(mode, hw)


def _project_id_for_site(cp: ControlPlaneStore, site_id: str | None) -> str:
    if not site_id:
        return "default"
    site = next((item for item in cp.list_sites() if item["site_id"] == site_id), None)
    if site:
        return site.get("project_id", "default")
    projects = cp.list_projects()
    return projects[0]["project_id"] if projects else "default"


def _site_display_name(cp: ControlPlaneStore, site_id: str | None) -> str:
    if not site_id:
        return "No Site Selected"
    site = next((item for item in cp.list_sites() if item["site_id"] == site_id), None)
    if not site:
        return site_id
    return site.get("display_name") or site.get("hospital_name") or site_id


def _user_role(user: dict[str, Any] | None) -> str:
    return (user or {}).get("role", "viewer")


def _can_edit_cases(user: dict[str, Any] | None) -> bool:
    return _user_role(user) in {"admin", "site_admin", "researcher"}


def _can_open_admin(user: dict[str, Any] | None) -> bool:
    return _user_role(user) in {"admin", "site_admin"}


def _render_page_header(
    eyebrow: str,
    title: str,
    subtitle: str,
    meta_items: list[str] | None = None,
) -> None:
    chips = "".join(
        f"<span class='kera-meta-chip'>{escape(item)}</span>"
        for item in (meta_items or [])
        if item
    )
    meta_html = f"<div class='kera-meta-strip'>{chips}</div>" if chips else ""
    st.markdown(
        f"""
<section class="kera-page-header">
  <div class="kera-eyebrow">{escape(eyebrow)}</div>
  <h1 class="kera-page-title">{escape(title)}</h1>
  <p class="kera-page-subtitle">{escape(subtitle)}</p>
  {meta_html}
</section>
""",
        unsafe_allow_html=True,
    )


# ──────────────────────────────────────────────
# Sidebar
# ──────────────────────────────────────────────

def _render_sidebar(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    runtime_status: dict[str, Any],
    lang: str,
) -> dict[str, Any] | None:
    with st.sidebar:
        st.markdown(
            f"""
<section class="kera-brand-block">
  <div class="kera-eyebrow">Culture-Proven Workflow</div>
  <div class="kera-brand-title">{escape(APP_NAME)}</div>
  <p class="kera-brand-copy">
    Structured intake, ROI evidence review, and contribution-ready training in one clinician workflow.
  </p>
</section>
""",
            unsafe_allow_html=True,
        )

        col_l, col_r = st.columns(2)
        with col_l:
            if st.button("한국어", use_container_width=True, key="btn_ko"):
                st.session_state["lang"] = "ko"
                st.rerun()
        with col_r:
            if st.button("English", use_container_width=True, key="btn_en"):
                st.session_state["lang"] = "en"
                st.rerun()

        st.divider()

        user = st.session_state.get("user")
        if not user:
            return None

        st.markdown(
            f"""
<div class="kera-sidebar-user">
  <div class="kera-sidebar-label">Signed In</div>
  <h4>{escape(user.get('full_name', user['username']))}</h4>
  <p>{escape(user['role'].capitalize())} · {escape(user['username'])}</p>
</div>
""",
            unsafe_allow_html=True,
        )

        accessible_sites = cp.accessible_sites_for_user(user)
        if accessible_sites:
            site_options = {s["site_id"]: f"{s['display_name']} ({s['site_id']})" for s in accessible_sites}
            current_site = st.session_state.get("wiz_site_id") or accessible_sites[0]["site_id"]
            if current_site not in site_options:
                current_site = accessible_sites[0]["site_id"]
            st.caption(t(lang, "현재 병원 사이트", "Current Hospital Site"))
            selected_site = st.selectbox(
                t(lang, "병원 사이트", "Hospital Site"),
                options=list(site_options.keys()),
                format_func=lambda x: site_options[x],
                index=list(site_options.keys()).index(current_site),
                key="sidebar_site_select",
            )
            if selected_site != st.session_state.get("wiz_site_id"):
                st.session_state["wiz_site_id"] = selected_site
                _reset_wizard()
                st.rerun()
        else:
            st.info(t(lang, "이 계정에 할당된 사이트가 없습니다. 관리자에게 사이트 권한을 요청하세요.", "No sites are assigned to this account. Ask an admin for site access."))

        st.divider()

        if _can_edit_cases(user):
            if st.button(
                t(lang, "새 케이스 입력", "New Case"),
                use_container_width=True,
                type="primary",
                key="btn_new_case",
            ):
                _reset_wizard()
                st.session_state["page"] = "wizard"
                st.rerun()

        if st.button(
            t(lang, "대시보드", "Dashboard"),
            use_container_width=True,
            key="btn_dashboard",
        ):
            st.session_state["page"] = "dashboard"
            st.rerun()

        if _can_open_admin(user):
            if st.button(
                t(lang, "운영 관리", "Admin"),
                use_container_width=True,
                key="btn_admin",
            ):
                st.session_state["page"] = "admin"
                st.rerun()

        st.divider()

        hw = detect_hardware()
        hw_label = "GPU Ready" if hw["gpu_available"] else "CPU Only"
        ai_label = "AI Engine Online" if runtime_status["ai_engine_ready"] else "AI Setup Needed"
        node_label = hw.get("gpu_name") or hw.get("cpu_name", "Local Node")
        st.markdown(
            f"""
<div class="kera-status-panel">
  <div class="kera-sidebar-label">Local Node</div>
  <div class="kera-status-title">{escape(hw_label)}</div>
  <div class="kera-status-copy">{escape(node_label)}</div>
  <div class="kera-status-foot">{escape(ai_label)}</div>
</div>
""",
            unsafe_allow_html=True,
        )

        if st.button(t(lang, "로그아웃", "Log out"), use_container_width=True, key="btn_logout"):
            st.session_state["user"] = None
            st.rerun()

    return user


# ──────────────────────────────────────────────
# Login
# ──────────────────────────────────────────────

def _render_login(cp: ControlPlaneStore, lang: str) -> None:
    st.markdown("<div class='kera-login-spacer'></div>", unsafe_allow_html=True)
    hero_col, form_col = st.columns([1.35, 0.95], gap="large")

    with hero_col:
        st.markdown(
            f"""
<section class="kera-login-hero">
  <div class="kera-eyebrow">Clinician Research Console</div>
  <h1>{escape(APP_NAME)}</h1>
  <p>
    External validation, MedSAM ROI review, Grad-CAM evidence, and contribution-ready
    training in one evening workflow for culture-proven keratitis.
  </p>
  <div class="kera-login-highlights">
    <span>External Validation</span>
    <span>MedSAM ROI</span>
    <span>Contribution Tracking</span>
    <span>Federated Updates</span>
  </div>
</section>
""",
            unsafe_allow_html=True,
        )

    with form_col:
        st.markdown(
            f"""
<section class="kera-login-panel">
  <div class="kera-sidebar-label">{escape(t(lang, '보안 로그인', 'Secure Sign In'))}</div>
  <h3>{escape(t(lang, '연구 워크플로우 시작', 'Enter the Research Workflow'))}</h3>
  <p>{escape(t(lang, '등록된 계정으로 로그인해 병원별 케이스를 관리하세요.', 'Use your registered account to manage site-specific cases.'))}</p>
</section>
""",
            unsafe_allow_html=True,
        )
        with st.form("login_form"):
            username = st.text_input(t(lang, "사용자 이름", "Username"))
            password = st.text_input(t(lang, "비밀번호", "Password"), type="password")
            if st.form_submit_button(t(lang, "로그인", "Login"), use_container_width=True):
                user = cp.authenticate(username, password)
                if user:
                    st.session_state["user"] = user
                    st.rerun()
                else:
                    st.error(t(lang, "사용자 이름 또는 비밀번호가 올바르지 않습니다.", "Invalid credentials."))


# ──────────────────────────────────────────────
# Wizard step indicator
# ──────────────────────────────────────────────

def _render_step_indicator(current_step: str, lang: str) -> None:
    steps = WIZARD_STEPS
    current_idx = steps.index(current_step) if current_step in steps else 0
    parts = []
    for i, s in enumerate(steps):
        label = STEP_LABELS[s][lang]
        if i < current_idx:
            parts.append(
                f"<span class='kera-step is-complete'><span class='kera-step-index'>{i + 1:02d}</span>{escape(label)}</span>"
            )
        elif i == current_idx:
            parts.append(f"<span class='kera-step is-active'><span class='kera-step-index'>{i + 1:02d}</span>{escape(label)}</span>")
        else:
            parts.append(f"<span class='kera-step'><span class='kera-step-index'>{i + 1:02d}</span>{escape(label)}</span>")
    st.markdown(
        "<div class='kera-stepper'>" + "".join(parts) + "</div>",
        unsafe_allow_html=True,
    )


# ──────────────────────────────────────────────
# Wizard router
# ──────────────────────────────────────────────

def _render_wizard(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    workflow_error: str | None,
    user: dict[str, Any],
    runtime_status: dict[str, Any],
    lang: str,
) -> None:
    site_id = st.session_state.get("wiz_site_id")
    site_store = _get_site_store(site_id)
    step = st.session_state.get("wiz_step", "patient")
    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")

    meta_items = [t(lang, f"Site: {_site_display_name(cp, site_id)}", f"Site: {_site_display_name(cp, site_id)}")]
    if patient:
        meta_items.append(f"Patient {patient['patient_id']}")
    if visit:
        meta_items.append(f"Visit {visit['visit_date']}")
        meta_items.append(visit.get("culture_category", "").capitalize())

    _render_page_header(
        eyebrow=t(lang, "Clinician Case Wizard", "Clinician Case Wizard"),
        title=t(lang, "Keratitis Case Workspace", "Keratitis Case Workspace"),
        subtitle=t(
            lang,
            "환자 등록부터 ROI 확인, external validation, 학습 기여 결정까지 한 흐름으로 진행합니다.",
            "Move from patient intake to ROI review, external validation, and contribution in one focused workflow.",
        ),
        meta_items=meta_items,
    )

    if workflow_error and not runtime_status["ai_engine_ready"]:
        st.warning(
            t(
                lang,
                "⚠️ AI 모듈이 준비되지 않았습니다. 데이터 입력은 가능하나 검증·학습 기능은 로컬 노드 설치 후 사용하세요.",
                "⚠️ AI module not ready. Data entry is available, but validation/training requires local node setup.",
            )
        )

    _render_step_indicator(step, lang)

    if not site_store:
        st.warning(t(lang, "먼저 사이드바에서 병원 사이트를 선택하거나 관리자에게 사이트 등록을 요청하세요.", "Select a hospital site from the sidebar or ask an admin to register one."))
        return

    if not cp.user_can_access_site(user, site_id):
        st.error(t(lang, "현재 선택한 사이트에 접근할 수 없습니다.", "You do not have access to the selected site."))
        return

    if not _can_edit_cases(user):
        st.info(t(lang, "이 계정은 읽기 전용입니다. 대시보드에서 결과만 확인할 수 있습니다.", "This account is read-only. Use the dashboard to review results."))
        return

    if step == "patient":
        _step_patient(site_store, lang)
    elif step == "visit":
        _step_visit(cp, site_store, lang)
    elif step == "images":
        _step_images(workflow, site_store, runtime_status, lang)
    elif step == "validation":
        _step_validation(cp, workflow, site_store, user, runtime_status, lang)
    elif step == "visualization":
        _step_visualization(site_store, lang)
    elif step == "contribution":
        _step_contribution(cp, workflow, site_store, user, runtime_status, lang)
    elif step == "thankyou":
        _step_thankyou(cp, user, lang)


# ──────────────────────────────────────────────
# Step 1: Patient
# ──────────────────────────────────────────────

def _step_patient(site_store: SiteStore, lang: str) -> None:
    st.subheader(t(lang, "환자 선택 또는 신규 등록", "Select or Register Patient"))
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '기존 환자를 다시 선택하거나 새 환자를 등록하세요.', 'Select a returning patient or register a new one.'))}</strong>
  <span>{escape(t(lang, 'follow-up 방문은 기존 환자를 선택해 이어서 기록하고, 새 환자는 여기서 바로 등록합니다.', 'Use existing patients for follow-up visits and register new patients here for first-time entry.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    patients = site_store.list_patients()
    left_col, right_col = st.columns([1.2, 0.95], gap="large")

    with left_col:
        st.markdown(f"**{t(lang, '복귀 환자 선택', 'Returning Patient')}**")
        if patients:
            search = st.text_input(
                t(lang, "환자 ID 검색", "Search by Patient ID"),
                key="patient_search",
                placeholder="P001",
            )
            filtered = [p for p in patients if search.lower() in p["patient_id"].lower()] if search else patients

            for p in filtered[:20]:
                visits = site_store.list_visits_for_patient(p["patient_id"])
                visit_summary = f"{len(visits)}{t(lang, '회 방문', ' visit(s)')}"
                last_visit = visits[-1]["visit_date"] if visits else t(lang, "없음", "None")
                col1, col2 = st.columns([3, 1], gap="small")
                with col1:
                    alias_note = " · ".join(
                        item for item in [p.get("chart_alias", ""), p.get("local_case_code", "")]
                        if item
                    )
                    card_html = (
                        f"<div class='kera-card'>"
                        f"<strong>{escape(p['patient_id'])}</strong><br>"
                        f"<span style='color:var(--kera-muted)'>{escape(str(p['sex']))} · {p['age']}{t(lang, '세', 'y')} · {escape(visit_summary)}</span><br>"
                        f"<span style='color:var(--kera-muted)'>{t(lang, '최근 방문', 'Last visit')}: {escape(last_visit)}</span>"
                    )
                    if alias_note:
                        card_html += f"<br><span style='color:var(--kera-muted)'>{escape(alias_note)}</span>"
                    card_html += "</div>"
                    st.markdown(card_html, unsafe_allow_html=True)
                with col2:
                    if st.button(t(lang, "선택", "Select"), key=f"sel_{p['patient_id']}"):
                        st.session_state["wiz_patient"] = p
                        st.session_state["wiz_visit"] = None
                        st.session_state["wiz_images"] = []
                        st.session_state["wiz_roi_preview"] = None
                        st.session_state["wiz_validation"] = None
                        st.session_state["wiz_step"] = "visit"
                        st.rerun()
        else:
            st.info(t(lang, "아직 등록된 환자가 없습니다.", "No patients have been registered yet."))

    with right_col:
        st.markdown(f"**{t(lang, '새 환자 등록', 'Register New Patient')}**")
        with st.form("new_patient_form"):
            pid = st.text_input(t(lang, "환자 ID *", "Patient ID *"), placeholder="P001")
            col_s, col_a = st.columns(2)
            with col_s:
                sex = st.selectbox(t(lang, "성별 *", "Sex *"), SEX_OPTIONS)
            with col_a:
                age = st.number_input(t(lang, "나이 *", "Age *"), min_value=1, max_value=120, value=50)
            col_alias, col_case = st.columns(2)
            with col_alias:
                chart_alias = st.text_input(t(lang, "Chart alias (선택)", "Chart alias (optional)"))
            with col_case:
                local_case_code = st.text_input(t(lang, "Local case code (선택)", "Local case code (optional)"))
            st.caption(t(lang, "신규 등록 후 바로 방문 정보 입력 단계로 이동합니다.", "After registration, you will move directly to visit details."))
            if st.form_submit_button(t(lang, "등록 후 다음 단계", "Register & Continue"), use_container_width=True):
                try:
                    patient = site_store.create_patient(
                        pid.strip(),
                        sex,
                        int(age),
                        chart_alias=chart_alias,
                        local_case_code=local_case_code,
                    )
                    st.session_state["wiz_patient"] = patient
                    st.session_state["wiz_visit"] = None
                    st.session_state["wiz_images"] = []
                    st.session_state["wiz_roi_preview"] = None
                    st.session_state["wiz_validation"] = None
                    st.session_state["wiz_step"] = "visit"
                    st.rerun()
                except ValueError as exc:
                    st.error(str(exc))


# ──────────────────────────────────────────────
# Step 2: Visit
# ──────────────────────────────────────────────

def _step_visit(cp: ControlPlaneStore, site_store: SiteStore, lang: str) -> None:
    patient = st.session_state.get("wiz_patient")
    if not patient:
        st.session_state["wiz_step"] = "patient"
        st.rerun()
        return

    st.subheader(t(lang, "방문 정보 입력", "Enter Visit Details"))
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '이번 방문의 미생물 정보와 임상 맥락을 함께 정리하세요.', 'Capture the microbiology and clinical context for this visit.'))}</strong>
  <span>{escape(t(lang, 'follow-up 방문이면 이전 이력을 참고해 active stage 여부와 이번 방문의 사진 세트를 준비하면 됩니다.', 'For follow-up visits, use the prior timeline to decide active stage and prepare the new image set.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<div class='kera-chip complete'>Patient {patient['patient_id']} · {patient['sex']} · {patient['age']}{t(lang, '세', 'y')}</div>",
        unsafe_allow_html=True,
    )

    # 이전 방문 타임라인
    prev_visits = site_store.list_visits_for_patient(patient["patient_id"])
    if prev_visits:
        st.markdown(f"**{t(lang, '이전 방문 이력', 'Previous Visits')}**")
        status_labels = {
            "active": t(lang, "활성기", "Active"),
            "improving": t(lang, "호전 중", "Improving"),
            "scar": t(lang, "반흔/비활성", "Scar / Inactive"),
        }
        status_icons = {"active": "🔴", "improving": "🟠", "scar": "🟢"}
        timeline_html = "<div class='kera-chip-row'>"
        for v in sorted(prev_visits, key=lambda x: x["visit_date"]):
            cat_label = "🦠 " + v.get("culture_category", "").capitalize()
            status = v.get("visit_status", "active" if v.get("active_stage") else "scar")
            stage = f"{status_icons.get(status, '⚪')} {status_labels.get(status, status)}"
            timeline_html += f"<span class='kera-chip'>{v['visit_date']} {cat_label} {stage}</span>"
        timeline_html += "</div>"
        st.markdown(timeline_html, unsafe_allow_html=True)
        st.markdown("")

    organisms = cp.list_organisms()
    bacterial_list = organisms.get("bacterial", []) if isinstance(organisms, dict) else []
    fungal_list = organisms.get("fungal", []) if isinstance(organisms, dict) else []
    request_option = t(lang, "목록에 없음 - 추가 요청", "Not listed - request addition")
    user = st.session_state.get("user") or {}

    with st.form("visit_form"):
        st.markdown(f"**{t(lang, 'Visit Core', 'Visit Core')}**")
        visit_date = st.date_input(t(lang, "방문 날짜 *", "Visit Date *"))
        culture_confirmed = st.checkbox(t(lang, "Culture-proven 확인 (필수)", "Culture-proven confirmed (required)"), value=True)

        col_cat, col_sp = st.columns(2)
        with col_cat:
            culture_category = st.radio(
                t(lang, "감염 종류 *", "Culture Category *"),
                options=["bacterial", "fungal"],
                format_func=lambda x: t(lang, "세균성" if x == "bacterial" else "진균성", x.capitalize()),
                horizontal=True,
            )
        with col_sp:
            species_list = bacterial_list if culture_category == "bacterial" else fungal_list
            species_options = species_list[:] if species_list else []
            species_options.append(request_option)
            culture_species = st.selectbox(t(lang, "균종 *", "Species *"), species_options)
            requested_species = ""
            if culture_species == request_option:
                requested_species = st.text_input(
                    t(lang, "신규 균종 이름 *", "Requested species *"),
                    placeholder="Aspergillus flavus",
                )

        st.markdown(f"**{t(lang, 'Clinical Context', 'Clinical Context')}**")
        col_cl, col_pf = st.columns(2)
        with col_cl:
            contact_lens_use = st.selectbox(t(lang, "콘택트렌즈 사용", "Contact Lens Use"), CONTACT_LENS_OPTIONS)
        with col_pf:
            predisposing_factor = st.multiselect(t(lang, "위험인자", "Predisposing Factors"), PREDISPOSING_FACTORS)

        st.markdown(f"**{t(lang, 'Stage and Notes', 'Stage and Notes')}**")
        visit_status = st.selectbox(
            t(lang, "방문 상태", "Visit Status"),
            VISIT_STATUS_OPTIONS,
            format_func=lambda value: {
                "active": t(lang, "활성기", "Active"),
                "improving": t(lang, "호전 중", "Improving"),
                "scar": t(lang, "반흔 / 비활성", "Scar / Inactive"),
            }[value],
            help=t(lang, "현재 방문의 활동성을 기록합니다. active 상태만 학습 기여 대상으로 간주합니다.", "Capture the current disease activity. Only active visits are treated as training-eligible by default."),
        )
        col_smear, col_poly = st.columns(2)
        with col_smear:
            smear_result = st.selectbox(
                t(lang, "Smear result (선택)", "Smear result (optional)"),
                SMEAR_RESULT_OPTIONS,
            )
        with col_poly:
            polymicrobial = st.checkbox(
                t(lang, "Polymicrobial (선택)", "Polymicrobial (optional)"),
                value=False,
            )
        other_history = st.text_area(t(lang, "기타 병력 (선택)", "Other History (optional)"), height=80)

        col_back, col_next = st.columns(2)
        with col_back:
            back = st.form_submit_button(t(lang, "← 이전", "← Back"), use_container_width=True)
        with col_next:
            submitted = st.form_submit_button(t(lang, "다음 →", "Next →"), use_container_width=True, type="primary")

    if back:
        st.session_state["wiz_step"] = "patient"
        st.rerun()

    if submitted:
        if not culture_confirmed:
            st.error(t(lang, "Culture-proven 케이스만 입력 가능합니다.", "Only culture-proven cases are allowed."))
        else:
            try:
                culture_species_value = culture_species
                if culture_species == request_option:
                    if not requested_species.strip():
                        st.error(t(lang, "신규 균종 이름을 입력하세요.", "Enter the requested species name."))
                        return
                    culture_species_value = requested_species.strip()
                    cp.request_new_organism(
                        culture_category=culture_category,
                        requested_species=culture_species_value,
                        requested_by=user.get("user_id", "unknown"),
                    )
                visit = site_store.create_visit(
                    patient_id=patient["patient_id"],
                    visit_date=str(visit_date),
                    culture_confirmed=culture_confirmed,
                    culture_category=culture_category,
                    culture_species=culture_species_value,
                    contact_lens_use=contact_lens_use,
                    predisposing_factor=predisposing_factor,
                    other_history=other_history,
                    active_stage=visit_status == "active",
                    visit_status=visit_status,
                    smear_result=smear_result,
                    polymicrobial=polymicrobial,
                )
                if culture_species == request_option:
                    st.info(t(lang, "균종 추가 요청을 접수했습니다. 현재 케이스에는 입력한 이름으로 저장했습니다.", "Species request submitted. This case was saved with the entered species name."))
                st.session_state["wiz_visit"] = visit
                st.session_state["wiz_images"] = []
                st.session_state["wiz_roi_preview"] = None
                st.session_state["wiz_validation"] = None
                st.session_state["wiz_step"] = "images"
                st.rerun()
            except ValueError as exc:
                st.error(str(exc))


# ──────────────────────────────────────────────
# Step 3: Images
# ──────────────────────────────────────────────

def _step_images(
    workflow: ResearchWorkflowService | None,
    site_store: SiteStore,
    runtime_status: dict[str, Any],
    lang: str,
) -> None:
    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")
    if not patient or not visit:
        st.session_state["wiz_step"] = "patient"
        st.rerun()
        return

    st.subheader(t(lang, "이미지 세트 구성", "Build the Visit Image Set"))
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '이번 방문의 이미지 세트를 구성하세요.', 'Build the image set for this visit.'))}</strong>
  <span>{escape(t(lang, 'white, slit, fluorescein을 섞어서 올릴 수 있고, 대표 이미지를 한 장 지정하면 ROI preview와 validation의 기준 이미지로 사용됩니다.', 'You can mix white, slit, and fluorescein views. Mark one representative image to anchor ROI preview and validation.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )
    st.markdown(
        f"<div class='kera-chip-row'>"
        f"<span class='kera-chip complete'>Patient {patient['patient_id']}</span>"
        f"<span class='kera-chip complete'>Visit {visit['visit_date']}</span>"
        f"<span class='kera-chip complete'>{visit['culture_category'].capitalize()} · {visit['culture_species']}</span>"
        f"</div>",
        unsafe_allow_html=True,
    )

    uploaded_files = st.file_uploader(
        t(lang, "이미지 선택 (여러 장 가능)", "Select images (multiple allowed)"),
        accept_multiple_files=True,
        type=["jpg", "jpeg", "png", "bmp", "tiff"],
        key="image_uploader",
    )

    saved_images = st.session_state.get("wiz_images") or site_store.list_images_for_visit(patient["patient_id"], visit["visit_date"])
    st.session_state["wiz_images"] = saved_images
    roi_preview = st.session_state.get("wiz_roi_preview")

    if uploaded_files:
        st.markdown(f"**{t(lang, '업로드 전 뷰 배정', 'Assign Views Before Upload')}**")
        pending: list[dict[str, Any]] = []
        for i, f in enumerate(uploaded_files):
            col_img, col_view, col_rep = st.columns([1.5, 1, 0.7], gap="large")
            with col_img:
                st.image(f, use_container_width=True, caption=f.name)
            with col_view:
                view = st.selectbox(
                    t(lang, "View", "View"),
                    VIEW_OPTIONS,
                    key=f"view_{i}_{f.name}",
                )
            with col_rep:
                is_rep = st.checkbox(
                    t(lang, "대표", "Rep."),
                    key=f"rep_{i}_{f.name}",
                    value=(i == 0 and not saved_images),
                )
            pending.append({"file": f, "view": view, "is_representative": is_rep})

        if st.button(t(lang, "✅ 업로드 확정", "✅ Confirm Upload"), type="primary"):
            for item in pending:
                try:
                    record = site_store.add_image(
                        patient_id=patient["patient_id"],
                        visit_date=visit["visit_date"],
                        view=item["view"],
                        is_representative=item["is_representative"],
                        file_name=item["file"].name,
                        content=item["file"].read(),
                    )
                    saved_images.append(record)
                except Exception as exc:
                    st.error(f"{item['file'].name}: {exc}")
            st.session_state["wiz_images"] = saved_images
            st.session_state["wiz_roi_preview"] = None
            st.session_state["wiz_validation"] = None
            if workflow is not None and runtime_status["ai_engine_ready"]:
                try:
                    st.session_state["wiz_roi_preview"] = workflow.preview_case_roi(
                        site_store=site_store,
                        patient_id=patient["patient_id"],
                        visit_date=visit["visit_date"],
                    )
                except Exception:
                    st.session_state["wiz_roi_preview"] = None
            st.success(t(lang, f"{len(pending)}장 업로드 완료!", f"{len(pending)} image(s) uploaded!"))
            st.rerun()

    if saved_images:
        view_counts = pd.Series([img.get("view", "unknown") for img in saved_images]).value_counts()
        rep_count = sum(1 for img in saved_images if img.get("is_representative"))
        st.markdown(f"**{t(lang, '이번 방문에 저장된 이미지', 'Saved Images for This Visit')}**")
        st.markdown(
            "<div class='kera-stat-grid'>"
            f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '전체 이미지', 'Total Images')}</div><div class='kera-stat-value'>{len(saved_images)}</div></div>"
            f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '대표 이미지', 'Representative')}</div><div class='kera-stat-value'>{rep_count}</div></div>"
            f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '등록된 View', 'Views Used')}</div><div class='kera-stat-value'>{len(view_counts)}</div></div>"
            "</div>",
            unsafe_allow_html=True,
        )
        cols = st.columns(min(len(saved_images), 4))
        for i, img in enumerate(saved_images):
            with cols[i % 4]:
                try:
                    st.image(img["image_path"], use_container_width=True)
                    st.caption(f"{img['view']} {'⭐' if img['is_representative'] else ''}")
                except Exception:
                    st.caption(img["image_path"])

    if saved_images and workflow is not None and runtime_status["ai_engine_ready"]:
        control_cols = st.columns([1, 1, 1.2], gap="large")
        with control_cols[1]:
            if st.button(t(lang, "ROI 미리보기", "Preview ROI"), use_container_width=True, key="btn_preview_roi"):
                try:
                    with st.spinner(t(lang, "MedSAM ROI 생성 중...", "Generating MedSAM ROI preview...")):
                        previews = workflow.preview_case_roi(
                            site_store=site_store,
                            patient_id=patient["patient_id"],
                            visit_date=visit["visit_date"],
                        )
                    st.session_state["wiz_roi_preview"] = previews
                    st.success(t(lang, "ROI 미리보기를 생성했습니다.", "ROI preview is ready."))
                    st.rerun()
                except Exception as exc:
                    st.error(f"{t(lang, 'ROI 생성 오류:', 'ROI preview error:')} {exc}")
    elif saved_images:
        st.info(
            t(
                lang,
                "이미지는 저장되었습니다. ROI 미리보기와 validation은 로컬 AI 엔진이 준비되면 사용할 수 있습니다.",
                "Images are saved. ROI preview and validation are available once the local AI engine is ready.",
            )
        )

    if roi_preview:
        st.markdown(f"**{t(lang, 'MedSAM ROI 미리보기', 'MedSAM ROI Preview')}**")
        for preview in roi_preview:
            st.markdown(
                f"<div class='kera-chip-row'>"
                f"<span class='kera-chip complete'>{preview['view']}</span>"
                f"<span class='kera-chip {'complete' if preview['is_representative'] else 'pending'}'>{t(lang, '대표 이미지', 'Representative') if preview['is_representative'] else t(lang, '보조 이미지', 'Supporting image')}</span>"
                f"</div>",
                unsafe_allow_html=True,
            )
            col_original, col_roi = st.columns([1.15, 1], gap="large")
            with col_original:
                st.markdown(f"<div class='kera-image-label'>{escape(t(lang, '원본', 'Original'))}</div>", unsafe_allow_html=True)
                st.image(preview["source_image_path"], use_container_width=True)
            with col_roi:
                st.markdown(f"<div class='kera-image-label'>{escape(t(lang, 'MedSAM ROI', 'MedSAM ROI'))}</div>", unsafe_allow_html=True)
                st.image(preview["roi_crop_path"], use_container_width=True)

    col_back, col_preview, col_next = st.columns([1, 1, 1.2], gap="large")
    with col_back:
        if st.button(t(lang, "← 이전", "← Back"), use_container_width=True):
            st.session_state["wiz_step"] = "visit"
            st.rerun()
    with col_preview:
        if not saved_images or workflow is None or not runtime_status["ai_engine_ready"]:
            st.button(t(lang, "ROI 미리보기", "Preview ROI"), disabled=True, use_container_width=True, key="btn_preview_roi_disabled")
    with col_next:
        if saved_images:
            if st.button(t(lang, "검증 실행 →", "Run Validation →"), use_container_width=True, type="primary"):
                st.session_state["wiz_step"] = "validation"
                st.rerun()
        else:
            st.button(t(lang, "검증 실행 →", "Run Validation →"), disabled=True, use_container_width=True)


# ──────────────────────────────────────────────
# Step 4: Validation
# ──────────────────────────────────────────────

def _step_validation(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    site_store: SiteStore,
    user: dict[str, Any],
    runtime_status: dict[str, Any],
    lang: str,
) -> None:
    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")
    validation = st.session_state.get("wiz_validation")

    st.subheader(t(lang, "🔬 외부 검증 (External Validation)", "🔬 External Validation"))

    if validation:
        _render_validation_result(validation, lang)
        col_back, col_next = st.columns(2)
        with col_back:
            if st.button(t(lang, "← 이전", "← Back"), use_container_width=True):
                st.session_state["wiz_step"] = "images"
                st.rerun()
        with col_next:
            if st.button(t(lang, "시각화 보기 →", "View Visualization →"), use_container_width=True, type="primary"):
                st.session_state["wiz_step"] = "visualization"
                st.rerun()
        return

    if not runtime_status["ai_engine_ready"] or workflow is None:
        st.error(t(lang, "AI 모듈이 준비되지 않아 검증을 실행할 수 없습니다. 로컬 노드 설치를 확인하세요.", "AI module not ready. Check local node installation."))
        if st.button(t(lang, "← 이전", "← Back"), use_container_width=True):
            st.session_state["wiz_step"] = "images"
            st.rerun()
        return

    # 모델 선택
    models = [m for m in cp.list_model_versions() if m.get("ready", True)]
    if not models:
        st.error(t(lang, "등록된 글로벌 모델이 없습니다. 먼저 초기 글로벌 학습을 실행하세요.", "No global model registered. Run initial global training first."))
        st.info(t(lang, "이미지 단계에서는 MedSAM ROI 미리보기만 먼저 사용할 수 있습니다.", "You can still use MedSAM ROI preview from the image step first."))
        return

    model_options = {m["version_id"]: f"{m['version_name']} ({m['architecture']})" for m in models}
    current_model = cp.current_global_model()
    default_model_id = current_model["version_id"] if current_model and current_model.get("ready", True) else models[0]["version_id"]
    default_index = next((index for index, item in enumerate(models) if item["version_id"] == default_model_id), 0)
    selected_model_id = st.selectbox(
        t(lang, "글로벌 모델 선택", "Select Global Model"),
        options=list(model_options.keys()),
        format_func=lambda x: model_options[x],
        index=default_index,
    )
    selected_model = next((m for m in models if m["version_id"] == selected_model_id), models[0])

    hw = detect_hardware()
    exec_mode = st.radio(
        t(lang, "실행 모드", "Execution Mode"),
        EXECUTION_MODES,
        horizontal=True,
        index=0,
    )
    device = resolve_execution_mode(exec_mode, hw)

    if selected_model.get("requires_medsam_crop"):
        st.info(t(lang, "📌 이 모델은 MedSAM ROI 크롭 후 추론합니다 (DenseNet 학습 조건과 동일).", "📌 This model uses MedSAM ROI crop before inference (matches DenseNet training)."))

    col_back, col_run = st.columns(2)
    with col_back:
        if st.button(t(lang, "← 이전", "← Back"), use_container_width=True):
            st.session_state["wiz_step"] = "images"
            st.rerun()
    with col_run:
        run_btn = st.button(t(lang, "🔬 검증 실행", "🔬 Run Validation"), use_container_width=True, type="primary")

    if run_btn:
        with st.spinner(t(lang, "추론 중... 잠시만요 ☕", "Running inference... please wait ☕")):
            try:
                summary, case_preds = workflow.run_case_validation(
                    project_id=_project_id_for_site(cp, site_store.site_id),
                    site_store=site_store,
                    patient_id=patient["patient_id"],
                    visit_date=visit["visit_date"],
                    model_version=selected_model,
                    execution_device=device,
                    generate_gradcam=True,
                    generate_medsam=True,
                )
                st.session_state["wiz_validation"] = {
                    "summary": summary,
                    "case_predictions": case_preds,
                    "model_version": selected_model,
                    "device": device,
                }
                st.rerun()
            except Exception as exc:
                st.error(f"{t(lang, '검증 오류:', 'Validation error:')} {exc}")


def _render_validation_result(validation: dict[str, Any], lang: str) -> None:
    summary = validation["summary"]
    pred_label = summary.get("predicted_label", "")
    true_label = summary.get("true_label", "")
    prob = summary.get("prediction_probability", 0.0)
    is_correct = summary.get("is_correct", False)
    pred_label_ko = "세균성" if pred_label == "bacterial" else "진균성"
    pred_label_en = pred_label.capitalize() if pred_label else "Unknown"
    agreement_label = t(lang, "Culture 일치" if is_correct else "Culture 불일치", "Matches Culture" if is_correct else "Differs from Culture")
    agreement_tone = "is-good" if is_correct else "is-caution"
    dominant_pct = prob * 100 if pred_label == "bacterial" else (1 - prob) * 100
    model_name = validation.get("model_version", {}).get("version_name", "Global model")

    st.markdown(
        f"""
<section class="kera-result-hero">
  <div class="kera-result-topline">
    <span class="kera-result-kicker">{escape(t(lang, 'External Validation Result', 'External Validation Result'))}</span>
    <span class="kera-result-badge {agreement_tone}">{escape(agreement_label)}</span>
  </div>
  <div class="kera-result-main">
    <div>
      <div class="kera-result-label">{escape(t(lang, 'Predicted Organism', 'Predicted Organism'))}</div>
      <div class="kera-result-value">{escape(t(lang, pred_label_ko, pred_label_en))}</div>
      <div class="kera-result-caption">{escape(t(lang, '선택된 글로벌 모델 기준 결과', 'Based on the selected global model'))}</div>
    </div>
    <div class="kera-result-number">
      <span>{dominant_pct:.1f}%</span>
      <small>{escape(t(lang, 'dominant confidence', 'dominant confidence'))}</small>
    </div>
  </div>
  <div class="kera-prob-track">
    <div class="kera-prob-fill" style="width:{prob*100:.1f}%"></div>
  </div>
  <div class="kera-prob-labels">
    <span>Bacterial</span>
    <span>Fungal</span>
  </div>
</section>
""",
        unsafe_allow_html=True,
    )

    c1, c2, c3 = st.columns(3)
    with c1:
        _stat_card(t(lang, "AI 예측", "AI Prediction"), t(lang, pred_label_ko, pred_label_en), model_name, lang)
    with c2:
        _stat_card(t(lang, "신뢰도", "Confidence"), f"{prob * 100:.1f}%", t(lang, "모델 점수", "model score"), lang)
    with c3:
        _stat_card(
            t(lang, "Culture 비교", "Culture Check"),
            t(lang, "일치" if is_correct else "검토 필요", "Match" if is_correct else "Needs Review"),
            agreement_label,
            lang,
        )


# ──────────────────────────────────────────────
# Step 5: Visualization
# ──────────────────────────────────────────────

def _step_visualization(site_store: SiteStore, lang: str) -> None:
    validation = st.session_state.get("wiz_validation")
    if not validation:
        st.session_state["wiz_step"] = "validation"
        st.rerun()
        return

    st.subheader(t(lang, "시각화 결과", "Visualization Review"))
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '대표 이미지와 모델 근거를 함께 확인하세요.', 'Review the representative image and the model evidence together.'))}</strong>
  <span>{escape(t(lang, '원본, MedSAM ROI, Grad-CAM을 같은 맥락에서 비교하도록 정리했습니다.', 'Original image, MedSAM ROI, and Grad-CAM are arranged for comparison in one view.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    case_preds = validation.get("case_predictions", [])
    pred = case_preds[0] if case_preds else {}

    gradcam_path = pred.get("gradcam_path")
    roi_crop_path = pred.get("roi_crop_path")
    medsam_mask_path = pred.get("medsam_mask_path")

    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")

    # 대표 이미지 원본
    rep_images = site_store.list_images_for_visit(patient["patient_id"], visit["visit_date"])
    rep_path = next((img["image_path"] for img in rep_images if img.get("is_representative")), None)
    if not rep_path and rep_images:
        rep_path = rep_images[0]["image_path"]

    col1, col2, col3 = st.columns([1.4, 1, 1], gap="large")
    with col1:
        st.markdown(f"<div class='kera-image-label'>{escape(t(lang, '원본 대표 이미지', 'Original Representative'))}</div>", unsafe_allow_html=True)
        if rep_path and Path(rep_path).exists():
            st.image(rep_path, use_container_width=True)
        else:
            st.info(t(lang, "이미지를 불러올 수 없습니다.", "Image not available."))

    with col2:
        st.markdown(f"<div class='kera-image-label'>{escape(t(lang, 'MedSAM ROI Crop', 'MedSAM ROI Crop'))}</div>", unsafe_allow_html=True)
        if roi_crop_path and Path(roi_crop_path).exists():
            st.image(roi_crop_path, use_container_width=True)
            st.caption(t(lang, "각막 ROI 자동 크롭", "Auto-cropped corneal ROI"))
        else:
            st.info(t(lang, "ROI 크롭 결과 없음", "No ROI crop available"))

    with col3:
        st.markdown(f"<div class='kera-image-label'>{escape(t(lang, 'Grad-CAM 히트맵', 'Grad-CAM Heatmap'))}</div>", unsafe_allow_html=True)
        if gradcam_path and Path(gradcam_path).exists():
            st.image(gradcam_path, use_container_width=True)
            st.caption(t(lang, "모델이 주목한 영역 (빨강 = 고영향)", "Model attention (red = high impact)"))
        else:
            st.info(t(lang, "Grad-CAM 결과 없음", "No Grad-CAM available"))

    if medsam_mask_path and Path(medsam_mask_path).exists():
        with st.expander(t(lang, "MedSAM 마스크 보기", "View MedSAM Mask"), expanded=False):
            st.image(medsam_mask_path, use_container_width=True)

    # 검증 결과 요약도 표시
    st.markdown("---")
    _render_validation_result(validation, lang)

    col_back, col_next = st.columns(2)
    with col_back:
        if st.button(t(lang, "← 검증 결과로", "← Back to Validation"), use_container_width=True):
            st.session_state["wiz_step"] = "validation"
            st.rerun()
    with col_next:
        if st.button(t(lang, "기여 결정 →", "Contribution →"), use_container_width=True, type="primary"):
            st.session_state["wiz_step"] = "contribution"
            st.rerun()


# ──────────────────────────────────────────────
# Step 6: Contribution
# ──────────────────────────────────────────────

def _step_contribution(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    site_store: SiteStore,
    user: dict[str, Any],
    runtime_status: dict[str, Any],
    lang: str,
) -> None:
    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")
    validation = st.session_state.get("wiz_validation")

    st.subheader(t(lang, "🤝 학습 기여 결정", "🤝 Contribute to Training"))

    visit_status = visit.get("visit_status", "active" if visit and visit.get("active_stage", False) else "scar") if visit else "scar"
    is_active = visit_status == "active"
    if is_active:
        st.success(
            t(
                lang,
                "🔴 이 케이스는 **활성기(active)**로 표시되어 있습니다. 학습 기여 시 모델 개선에 직접 반영됩니다.",
                "🔴 This case is marked as **active**. Your contribution will directly improve the model.",
            )
        )
    elif visit_status == "improving":
        st.info(
            t(
                lang,
                "🟠 이 케이스는 **호전 중(improving)** 상태입니다. 기본적으로는 저장 중심으로 다루고, 별도 연구 정책이 정해지면 학습에 반영하는 편이 좋습니다.",
                "🟠 This case is marked as **improving**. It is usually better handled as a stored follow-up case unless you define a separate training policy.",
            )
        )
    else:
        st.info(
            t(
                lang,
                "이 케이스는 **반흔/비활성(scar/inactive)** 상태입니다. 기본적으로는 저장 중심으로 다루는 것이 좋습니다.",
                "This case is marked as **scar/inactive**. It is usually better handled as a stored follow-up record.",
            )
        )

    st.markdown(
        t(
            lang,
            """
**기여하면 어떻게 되나요?**
- 이미지는 병원 밖으로 전송되지 않습니다
- 로컬에서 학습 후 **가중치 차분(weight delta)**만 중앙 서버에 업로드됩니다
- 여러 기관의 가중치를 집계해 글로벌 모델이 개선됩니다 (Federated Learning)
""",
            """
**What happens when you contribute?**
- Your images never leave this hospital
- Training uses MedSAM ROI crops only to keep the learning input policy consistent
- Only the **weight delta** (model update) is uploaded to the central server
- Multiple sites' updates are aggregated to improve the global model (Federated Learning)
""",
        )
    )

    if validation:
        st.markdown("---")
        _render_validation_result(validation, lang)
        st.markdown("---")

    col_yes, col_no = st.columns(2)
    with col_yes:
        contribute_btn = st.button(
            t(lang, "✅ 기여하기", "✅ Contribute"),
            use_container_width=True,
            type="primary",
            key="btn_contribute_yes",
            disabled=not is_active,
        )
    with col_no:
        skip_btn = st.button(
            t(lang, "➡ 기여 없이 저장", "➡ Save without Contributing"),
            use_container_width=True,
            key="btn_contribute_no",
        )
    if not is_active:
        st.caption(t(lang, "현재 정책에서는 active 방문만 기본 학습 기여 대상으로 허용합니다.", "Under the current policy, only active visits are enabled for training contribution."))

    if col_yes and contribute_btn:
        if not runtime_status["ai_engine_ready"] or workflow is None:
            st.error(t(lang, "AI 모듈이 준비되지 않아 학습을 실행할 수 없습니다.", "AI module not ready for training."))
        else:
            model_version = validation["model_version"] if validation else cp.current_global_model()
            device = validation.get("device", "cpu") if validation else "cpu"
            with st.spinner(t(lang, "로컬 학습 중... 잠시만요 ☕", "Running local fine-tuning... ☕")):
                try:
                    update_metadata = workflow.contribute_case(
                        site_store=site_store,
                        patient_id=patient["patient_id"],
                        visit_date=visit["visit_date"],
                        model_version=model_version,
                        execution_device=device,
                        user_id=user["user_id"],
                    )
                    st.session_state["wiz_contributed"] = True
                    st.session_state["wiz_update_metadata"] = update_metadata
                    st.session_state["wiz_step"] = "thankyou"
                    st.rerun()
                except Exception as exc:
                    st.error(f"{t(lang, '학습 오류:', 'Training error:')} {exc}")

    if skip_btn:
        st.session_state["wiz_contributed"] = False
        st.session_state["wiz_step"] = "thankyou"
        st.rerun()


# ──────────────────────────────────────────────
# Step 7: Thank you
# ──────────────────────────────────────────────

def _step_thankyou(cp: ControlPlaneStore, user: dict[str, Any], lang: str) -> None:
    contributed = st.session_state.get("wiz_contributed", False)
    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")

    stats = cp.get_contribution_stats(user_id=user["user_id"])
    name = user.get("full_name", user["username"])

    if contributed:
        st.markdown(
            f"""
<section class='kera-closure-card is-positive'>
  <div class='kera-sidebar-label'>{escape(t(lang, 'Contribution Recorded', 'Contribution Recorded'))}</div>
  <div class='kera-closure-title'>
    {t(lang, f'감사합니다, {name} 선생님!', f'Thank you, Dr. {name}!')}
  </div>
  <div class='kera-closure-copy'>
    {t(lang, '이 케이스가 글로벌 모델 개선에 기여됩니다.', 'This case will contribute to improving the global model.')}
  </div>
</section>
""",
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            f"""
<section class='kera-closure-card'>
  <div class='kera-sidebar-label'>{escape(t(lang, 'Case Saved', 'Case Saved'))}</div>
  <div class='kera-closure-title'>
    {t(lang, '케이스가 저장되었습니다', 'Case Saved')}
  </div>
</section>
""",
            unsafe_allow_html=True,
        )

    # 기여 통계 카드
    st.markdown("<div class='kera-stat-grid'>", unsafe_allow_html=True)
    _stat_card(t(lang, "내 누적 기여", "My Contributions"), str(stats["user_contributions"]), t(lang, "케이스", "cases"), lang)
    _stat_card(t(lang, "전체 기여 케이스", "Total Contributions"), str(stats["total_contributions"]), t(lang, "전체", "total"), lang)
    _stat_card(t(lang, "내 기여 비율", "My Share"), f"{stats['user_contribution_pct']}%", t(lang, "학습 데이터 기여", "of training data"), lang)
    _stat_card(t(lang, "현재 글로벌 모델", "Current Global Model"), stats["current_model_version"], "", lang)
    st.markdown("</div>", unsafe_allow_html=True)

    if patient and visit:
        st.markdown("---")
        st.markdown(
            f"**{t(lang, '저장된 케이스', 'Saved Case')}:** "
            f"{patient['patient_id']} · {visit['visit_date']} · "
            f"{visit.get('culture_category','').capitalize()} · {visit.get('culture_species','')}"
        )

    st.markdown("<br>", unsafe_allow_html=True)
    col1, col2 = st.columns(2)
    with col1:
        if st.button(t(lang, "➕ 다음 케이스 입력", "➕ Enter Next Case"), use_container_width=True, type="primary"):
            _reset_wizard()
            st.session_state["page"] = "wizard"
            st.rerun()
    with col2:
        if st.button(t(lang, "📊 대시보드 보기", "📊 View Dashboard"), use_container_width=True):
            st.session_state["page"] = "dashboard"
            st.rerun()


def _stat_card(label: str, value: str, note: str, lang: str) -> None:
    st.markdown(
        f"<div class='kera-stat-card'>"
        f"<div class='kera-stat-label'>{label}</div>"
        f"<div class='kera-stat-value'>{value}</div>"
        f"<div class='kera-stat-note'>{note}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )


# ──────────────────────────────────────────────
# Dashboard
# ──────────────────────────────────────────────

def _validation_run_label(run: dict[str, Any]) -> str:
    model_name = run.get("model_version", "Unknown model")
    run_date = run.get("run_date", "Unknown date")
    case_count = run.get("n_cases") or run.get("n_images") or 0
    return f"{run_date} · {model_name} · {case_count} cases"


def _site_level_validation_runs(validation_runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        run for run in validation_runs
        if int(run.get("n_cases", 0) or 0) > 1 or run.get("AUROC") is not None
    ]


def _load_cross_validation_reports(site_store: SiteStore) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for report_path in sorted(
        site_store.validation_dir.glob("cv_*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    ):
        report = read_json(report_path, {})
        if isinstance(report, dict) and report.get("cross_validation_id"):
            reports.append(report)
    return reports


def _render_confusion_matrix_panel(summary: dict[str, Any], lang: str) -> None:
    confusion = summary.get("confusion_matrix") or {}
    matrix = confusion.get("matrix")
    labels = confusion.get("labels", ["bacterial", "fungal"])
    if not matrix:
        st.info(t(lang, "Confusion matrix 결과가 아직 없습니다.", "Confusion matrix is not available yet."))
        return
    confusion_df = pd.DataFrame(
        matrix,
        index=[f"True {label}" for label in labels],
        columns=[f"Pred {label}" for label in labels],
    )
    fig = px.imshow(
        confusion_df,
        color_continuous_scale=["#eef6f4", "#0d8f8a"],
        aspect="auto",
    )
    fig.update_traces(text=confusion_df.values, texttemplate="%{text}")
    fig.update_layout(
        margin=dict(t=20, b=0, l=0, r=0),
        coloraxis_showscale=False,
        title=t(lang, "Confusion Matrix", "Confusion Matrix"),
    )
    st.plotly_chart(fig, use_container_width=True)


def _render_roc_curve_panel(summary: dict[str, Any], lang: str) -> None:
    roc = summary.get("roc_curve")
    if not roc:
        st.info(t(lang, "ROC curve를 계산할 수 있는 run이 아닙니다.", "ROC curve is not available for this run."))
        return
    roc_df = pd.DataFrame({"fpr": roc["fpr"], "tpr": roc["tpr"]})
    fig = px.line(
        roc_df,
        x="fpr",
        y="tpr",
        markers=True,
        title=t(lang, "ROC Curve", "ROC Curve"),
    )
    fig.add_shape(
        type="line",
        x0=0,
        y0=0,
        x1=1,
        y1=1,
        line=dict(color="#b86d43", dash="dash"),
    )
    fig.update_layout(margin=dict(t=40, b=0, l=0, r=0))
    fig.update_xaxes(range=[0, 1], title=t(lang, "False Positive Rate", "False Positive Rate"))
    fig.update_yaxes(range=[0, 1], title=t(lang, "True Positive Rate", "True Positive Rate"))
    st.plotly_chart(fig, use_container_width=True)


def _render_dashboard(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    runtime_status: dict[str, Any],
    user: dict[str, Any],
    lang: str,
) -> None:
    site_id = st.session_state.get("wiz_site_id")
    site_store = _get_site_store(site_id)
    stats = cp.get_contribution_stats(user_id=user["user_id"])
    _render_page_header(
        eyebrow=t(lang, "Research Overview", "Research Overview"),
        title=t(lang, "연구 대시보드", "Research Dashboard"),
        subtitle=t(
            lang,
            "사이트별 validation 실행, 모델 비교, 오분류 검토를 한 화면에서 관리합니다.",
            "Run site validations, compare model versions, and review misclassifications in one workspace.",
        ),
        meta_items=[
            f"User {user.get('full_name', user['username'])}",
            f"Site {_site_display_name(cp, site_id)}",
            f"Model {stats['current_model_version']}",
        ],
    )

    st.markdown(f"### {t(lang, '연구 현황', 'Research Overview')}")
    c1, c2, c3, c4 = st.columns(4)
    with c1:
        st.metric(t(lang, "전체 기여 케이스", "Total Contributions"), stats["total_contributions"])
    with c2:
        st.metric(t(lang, "내 기여", "My Contributions"), stats["user_contributions"])
    with c3:
        pending_updates = len([u for u in cp.list_model_updates() if u.get("status") == "pending_upload"])
        st.metric(t(lang, "업로드 대기 업데이트", "Pending Uploads"), pending_updates)
    with c4:
        st.metric(t(lang, "현재 모델", "Current Model"), stats["current_model_version"])

    if not site_store:
        st.info(t(lang, "대시보드에 표시할 사이트를 먼저 선택하세요.", "Select a site first to open the dashboard."))
        return
    if not cp.user_can_access_site(user, site_id):
        st.error(t(lang, "현재 선택한 사이트에 접근할 수 없습니다.", "You do not have access to the selected site."))
        return

    patients = site_store.list_patients()
    visits = site_store.list_visits()
    manifest_df = site_store.load_manifest()
    split_record = site_store.load_patient_split()
    validation_runs = cp.list_validation_runs(site_id=site_id)
    site_validation_runs = _site_level_validation_runs(validation_runs)

    st.markdown(f"### {t(lang, '사이트 데이터 현황', 'Site Data')}")
    sc1, sc2, sc3, sc4 = st.columns(4)
    with sc1:
        st.metric(t(lang, "등록 환자", "Patients"), len(patients))
    with sc2:
        st.metric(t(lang, "총 방문", "Visits"), len(visits))
    with sc3:
        active = sum(
            1
            for v in visits
            if v.get("visit_status", "active" if v.get("active_stage") else "scar") == "active"
        )
        st.metric(t(lang, "활성기 방문", "Active Stage Visits"), active)
    with sc4:
        split_label = (
            f"{split_record.get('n_train_patients', 0)} / {split_record.get('n_val_patients', 0)} / {split_record.get('n_test_patients', 0)}"
            if split_record
            else t(lang, "미생성", "Not set")
        )
        st.metric(t(lang, "Fixed Patient Split", "Fixed Patient Split"), split_label)

    st.markdown(f"### {t(lang, '사이트 External Validation', 'Site External Validation')}")
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '기관 데이터 전체에 대해 현재 또는 선택한 글로벌 모델을 평가합니다.', 'Run external validation across the full site dataset with the selected global model.'))}</strong>
  <span>{escape(t(lang, '이 결과가 누적되면 모델 버전 비교, 기관 비교, 오분류 검토의 기준 데이터가 됩니다.', 'Accumulated runs become the basis for model comparison, site comparison, and misclassification review.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    if workflow is None or not runtime_status["ai_engine_ready"]:
        st.info(t(lang, "로컬 AI 엔진이 준비되면 site-level validation을 실행할 수 있습니다.", "Site-level validation becomes available once the local AI engine is ready."))
    elif manifest_df.empty:
        st.info(t(lang, "먼저 환자/방문/이미지를 입력해 데이터셋을 만드세요.", "Create a dataset first by adding patients, visits, and images."))
    else:
        models = [model for model in cp.list_model_versions() if model.get("ready", True)]
        if models:
            model_options = {model["version_id"]: f"{model['version_name']} ({model['architecture']})" for model in models}
            current_model = cp.current_global_model()
            default_model_id = current_model["version_id"] if current_model else models[0]["version_id"]
            current_index = next((index for index, model in enumerate(models) if model["version_id"] == default_model_id), 0)

            run_col, option_col = st.columns([1.2, 1], gap="large")
            with run_col:
                validation_model_id = st.selectbox(
                    t(lang, "Validation Model", "Validation Model"),
                    options=list(model_options.keys()),
                    format_func=lambda model_id: model_options[model_id],
                    index=current_index,
                    key="dashboard_validation_model_id",
                )
                selected_model = next(model for model in models if model["version_id"] == validation_model_id)
            with option_col:
                exec_mode = st.radio(
                    t(lang, "실행 모드", "Execution Mode"),
                    EXECUTION_MODES,
                    horizontal=True,
                    key="dashboard_validation_exec_mode",
                )
                generate_gradcam = st.checkbox(
                    t(lang, "대표 이미지 Grad-CAM 생성", "Generate Grad-CAM for representative images"),
                    value=True,
                    key="dashboard_validation_gradcam",
                )
                generate_medsam = st.checkbox(
                    t(lang, "MedSAM ROI 저장", "Persist MedSAM ROI artifacts"),
                    value=True,
                    key="dashboard_validation_medsam",
                )

            if st.button(
                t(lang, "사이트 Validation 실행", "Run Site Validation"),
                type="primary",
                key="btn_dashboard_run_validation",
                disabled=not _can_edit_cases(user),
            ):
                device = _get_execution_device(exec_mode)
                with st.spinner(t(lang, "사이트 전체 validation 실행 중...", "Running site-level validation...")):
                    summary, _, _ = workflow.run_external_validation(
                        project_id=_project_id_for_site(cp, site_store.site_id),
                        site_store=site_store,
                        model_version=selected_model,
                        execution_device=device,
                        generate_gradcam=generate_gradcam,
                        generate_medsam=generate_medsam,
                    )
                st.session_state["dashboard_latest_validation_id"] = summary["validation_id"]
                st.success(t(lang, "Validation 결과를 저장했습니다.", "Validation result saved."))
                st.rerun()
            if not _can_edit_cases(user):
                st.caption(t(lang, "viewer 계정은 validation 실행이 비활성화됩니다.", "Validation execution is disabled for viewer accounts."))

    latest_validation_id = st.session_state.get("dashboard_latest_validation_id")
    latest_site_run = None
    if latest_validation_id:
        latest_site_run = next((run for run in site_validation_runs if run["validation_id"] == latest_validation_id), None)
    if latest_site_run is None and site_validation_runs:
        latest_site_run = sorted(site_validation_runs, key=lambda run: run.get("run_date", ""))[-1]

    if latest_site_run:
        st.markdown(f"### {t(lang, '최신 Site Validation', 'Latest Site Validation')}")
        metric_cols = st.columns(6)
        metric_items = [
            (t(lang, "Model", "Model"), latest_site_run.get("model_version", "-")),
            (t(lang, "AUROC", "AUROC"), "-" if latest_site_run.get("AUROC") is None else f"{latest_site_run['AUROC']:.3f}"),
            (t(lang, "Accuracy", "Accuracy"), f"{latest_site_run.get('accuracy', 0.0):.3f}"),
            (t(lang, "Sensitivity", "Sensitivity"), f"{latest_site_run.get('sensitivity', 0.0):.3f}"),
            (t(lang, "Specificity", "Specificity"), f"{latest_site_run.get('specificity', 0.0):.3f}"),
            (t(lang, "F1", "F1"), f"{latest_site_run.get('F1', 0.0):.3f}"),
        ]
        for col, (label, value) in zip(metric_cols, metric_items):
            with col:
                st.metric(label, value)

        detail_cols = st.columns([1, 1], gap="large")
        with detail_cols[0]:
            _render_confusion_matrix_panel(latest_site_run, lang)
        with detail_cols[1]:
            _render_roc_curve_panel(latest_site_run, lang)

    if site_validation_runs:
        st.markdown(f"### {t(lang, '모델 버전 비교', 'Model Version Comparison')}")
        metrics_df = pd.DataFrame(site_validation_runs)
        comparison_df = (
            metrics_df.groupby("model_version", dropna=False)[["accuracy", "sensitivity", "specificity", "F1"]]
            .mean()
            .reset_index()
            .sort_values("accuracy", ascending=False)
        )
        if "AUROC" in metrics_df.columns:
            auroc_df = metrics_df.dropna(subset=["AUROC"])
            if not auroc_df.empty:
                auroc_summary = auroc_df.groupby("model_version", dropna=False)["AUROC"].mean().reset_index()
                comparison_df = comparison_df.merge(auroc_summary, on="model_version", how="left")
        st.dataframe(comparison_df, use_container_width=True, hide_index=True)

        if len(site_validation_runs) >= 2:
            st.markdown(f"### {t(lang, 'Validation Run 비교', 'Validation Run Comparison')}")
            run_options = {run["validation_id"]: _validation_run_label(run) for run in site_validation_runs}
            sorted_runs = sorted(site_validation_runs, key=lambda run: run.get("run_date", ""))
            baseline_id = st.selectbox(
                t(lang, "Baseline run", "Baseline run"),
                options=list(run_options.keys()),
                format_func=lambda run_id: run_options[run_id],
                index=max(0, len(sorted_runs) - 2),
                key="dashboard_compare_baseline",
            )
            compare_id = st.selectbox(
                t(lang, "Compare run", "Compare run"),
                options=list(run_options.keys()),
                format_func=lambda run_id: run_options[run_id],
                index=len(sorted_runs) - 1,
                key="dashboard_compare_target",
            )
            baseline_run = next(run for run in site_validation_runs if run["validation_id"] == baseline_id)
            compare_run = next(run for run in site_validation_runs if run["validation_id"] == compare_id)
            delta_cols = st.columns(4)
            for col, metric_name in zip(delta_cols, ["AUROC", "accuracy", "sensitivity", "F1"]):
                baseline_value = baseline_run.get(metric_name)
                compare_value = compare_run.get(metric_name)
                delta = None
                if baseline_value is not None and compare_value is not None:
                    delta = compare_value - baseline_value
                with col:
                    st.metric(
                        metric_name,
                        "-" if compare_value is None else f"{compare_value:.3f}",
                        None if delta is None else f"{delta:+.3f}",
                    )

        st.markdown(f"### {t(lang, 'Validation Run History', 'Validation Run History')}")
        history_cols = [
            "run_date",
            "model_version",
            "n_patients",
            "n_cases",
            "AUROC",
            "accuracy",
            "sensitivity",
            "specificity",
            "F1",
        ]
        history_df = pd.DataFrame(site_validation_runs).sort_values("run_date", ascending=False)
        existing_history_cols = [column for column in history_cols if column in history_df.columns]
        st.dataframe(history_df[existing_history_cols], use_container_width=True, hide_index=True)

        allowed_site_ids = {site["site_id"] for site in cp.accessible_sites_for_user(user)}
        all_site_runs = [
            run for run in _site_level_validation_runs(cp.list_validation_runs())
            if run.get("site_id") in allowed_site_ids
        ]
        if all_site_runs:
            st.markdown(f"### {t(lang, '기관별 성능 비교', 'Site Performance Comparison')}")
            site_perf_df = pd.DataFrame(all_site_runs)
            summary_df = (
                site_perf_df.groupby("site_id", dropna=False)[["accuracy", "sensitivity", "specificity", "F1"]]
                .mean()
                .reset_index()
                .sort_values("accuracy", ascending=False)
            )
            if "AUROC" in site_perf_df.columns:
                site_auroc_df = site_perf_df.dropna(subset=["AUROC"])
                if not site_auroc_df.empty:
                    summary_df = summary_df.merge(
                        site_auroc_df.groupby("site_id", dropna=False)["AUROC"].mean().reset_index(),
                        on="site_id",
                        how="left",
                    )
            st.dataframe(summary_df, use_container_width=True, hide_index=True)

        if latest_site_run:
            case_predictions = cp.load_case_predictions(latest_site_run["validation_id"])
            misclassified = [case for case in case_predictions if not case.get("is_correct")]
            if misclassified:
                st.markdown(f"### {t(lang, '대표 오분류 사례', 'Representative Misclassified Cases')}")
                for case in misclassified[:4]:
                    st.markdown(
                        f"<div class='kera-card'><strong>{escape(case['patient_id'])}</strong> · "
                        f"{escape(case['visit_date'])} · "
                        f"{escape(case.get('true_label', ''))} → {escape(case.get('predicted_label', ''))} "
                        f"({case.get('prediction_probability', 0.0):.3f})</div>",
                        unsafe_allow_html=True,
                    )
                    rep_images = site_store.list_images_for_visit(case["patient_id"], case["visit_date"])
                    original_path = next((img["image_path"] for img in rep_images if img.get("is_representative")), None)
                    if not original_path and rep_images:
                        original_path = rep_images[0]["image_path"]
                    img_cols = st.columns(3, gap="large")
                    with img_cols[0]:
                        st.caption(t(lang, "원본", "Original"))
                        if original_path and Path(original_path).exists():
                            st.image(original_path, use_container_width=True)
                    with img_cols[1]:
                        st.caption(t(lang, "ROI", "ROI"))
                        if case.get("roi_crop_path") and Path(case["roi_crop_path"]).exists():
                            st.image(case["roi_crop_path"], use_container_width=True)
                    with img_cols[2]:
                        st.caption("Grad-CAM")
                        if case.get("gradcam_path") and Path(case["gradcam_path"]).exists():
                            st.image(case["gradcam_path"], use_container_width=True)

    if visits:
        st.markdown(f"### {t(lang, '균종 분포', 'Culture Distribution')}")
        cat_counts = pd.Series([v.get("culture_category", "unknown") for v in visits]).value_counts()
        fig = px.pie(
            names=cat_counts.index,
            values=cat_counts.values,
            color_discrete_sequence=["#0d8f8a", "#d6b468"],
        )
        fig.update_layout(margin=dict(t=0, b=0, l=0, r=0))
        st.plotly_chart(fig, use_container_width=True)

    my_contribs = cp.list_contributions(user_id=user["user_id"])
    if my_contribs:
        st.markdown(f"### {t(lang, '내 기여 이력', 'My Contribution History')}")
        df_c = pd.DataFrame(my_contribs[-10:][::-1])
        st.dataframe(df_c[["created_at", "patient_id", "visit_date", "site_id"]], use_container_width=True, hide_index=True)


# ──────────────────────────────────────────────
# Admin panel
# ──────────────────────────────────────────────

def _render_admin_import(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    user: dict[str, Any],
    lang: str,
) -> None:
    """기존 원본 이미지 + CSV 메타데이터를 일괄 임포트합니다."""
    st.markdown(f"### {t(lang, '기존 데이터 일괄 임포트', 'Bulk Data Import')}")
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '과거 데이터를 한 번에 운영 시스템으로 옮기는 화면입니다.', 'Use this view to migrate legacy cases into the operational workflow.'))}</strong>
  <span>{escape(t(lang, 'CSV는 과거 데이터 이관용입니다. 일상적인 새 케이스 입력에는 더 이상 필요하지 않습니다.', 'CSV is only for backfilling legacy data. Daily case entry no longer needs manual CSV creation.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    sites = cp.accessible_sites_for_user(user)
    if not sites:
        st.warning(t(lang, "접근 가능한 사이트가 없습니다.", "No accessible sites are available."))
        return

    site_options = {s["site_id"]: f"{s['display_name']} ({s['site_id']})" for s in sites}
    import_site_id = st.selectbox(
        t(lang, "임포트할 사이트", "Target Site"),
        options=list(site_options.keys()),
        format_func=lambda x: site_options[x],
        key="import_site_select",
    )
    site_store = SiteStore(import_site_id)
    site_patients = site_store.list_patients()
    site_visits = site_store.list_visits()
    site_images = site_store.list_images()

    st.markdown(
        "<div class='kera-stat-grid'>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '대상 사이트', 'Target Site')}</div><div class='kera-stat-value'>{escape(_site_display_name(cp, import_site_id))}</div><div class='kera-stat-note'>{import_site_id}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '등록 환자', 'Patients')}</div><div class='kera-stat-value'>{len(site_patients)}</div><div class='kera-stat-note'>{t(lang, '현재 저장됨', 'currently stored')}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '총 방문', 'Visits')}</div><div class='kera-stat-value'>{len(site_visits)}</div><div class='kera-stat-note'>{t(lang, '누적 방문 수', 'recorded visits')}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '총 이미지', 'Images')}</div><div class='kera-stat-value'>{len(site_images)}</div><div class='kera-stat-note'>{t(lang, '업로드 완료', 'uploaded so far')}</div></div>"
        "</div>",
        unsafe_allow_html=True,
    )

    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '권장 순서', 'Recommended Flow'))}</strong>
  <span>{escape(t(lang, '1) CSV 템플릿 다운로드  2) 이미지 파일명과 CSV를 맞춤  3) CSV와 ZIP 업로드  4) 먼저 2~3명만 시험 임포트', '1) Download the CSV template  2) match image filenames  3) upload CSV and ZIP  4) test-import 2-3 patients first'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    # CSV 템플릿 다운로드
    import io
    template_rows = [
        "patient_id,chart_alias,local_case_code,sex,age,visit_date,culture_confirmed,culture_category,culture_species,"
        "contact_lens_use,predisposing_factor,visit_status,active_stage,smear_result,polymicrobial,other_history,image_filename,view,is_representative",
        "P001,JNUH-001,2026-BK-001,female,45,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
        "none,trauma,active,TRUE,positive,FALSE,,P001_2026-01-10_white.jpg,white,TRUE",
        "P001,JNUH-001,2026-BK-001,female,45,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
        "none,trauma,active,TRUE,positive,FALSE,,P001_2026-01-10_slit.jpg,slit,FALSE",
    ]
    template_csv = "\n".join(template_rows)
    st.download_button(
        label=t(lang, "📄 CSV 템플릿 다운로드", "📄 Download CSV Template"),
        data=template_csv.encode("utf-8-sig"),
        file_name="kera_import_template.csv",
        mime="text/csv",
    )

    st.divider()
    st.markdown(f"**{t(lang, 'CSV + 이미지 ZIP 업로드', 'Upload CSV + Image ZIP')}**")

    col_csv, col_zip = st.columns(2)
    with col_csv:
        csv_file = st.file_uploader(
            t(lang, "메타데이터 CSV", "Metadata CSV"),
            type=["csv"],
            key="import_csv",
        )
    with col_zip:
        zip_file = st.file_uploader(
            t(lang, "이미지 ZIP (또는 개별 이미지)", "Image ZIP (or individual images)"),
            type=["zip", "jpg", "jpeg", "png"],
            accept_multiple_files=True,
            key="import_zip",
        )

    if csv_file and zip_file:
        try:
            import zipfile
            import tempfile

            df = pd.read_csv(csv_file)
            required_cols = ["patient_id", "sex", "age", "visit_date", "culture_confirmed",
                             "culture_category", "culture_species", "image_filename", "view"]
            missing = [c for c in required_cols if c not in df.columns]
            if missing:
                st.error(f"{t(lang, '누락된 열:', 'Missing columns:')} {missing}")
            else:
                st.dataframe(df.head(5), use_container_width=True)
                st.caption(t(lang, f"총 {len(df)}행 미리보기 (처음 5행)", f"Preview of {len(df)} rows (first 5)"))

                if st.button(t(lang, "✅ 임포트 실행", "✅ Run Import"), type="primary", key="btn_run_import"):
                    # 이미지 파일 추출 (ZIP이면 압축 해제, 개별 파일이면 그대로)
                    image_bytes: dict[str, bytes] = {}
                    for uploaded in zip_file:
                        if uploaded.name.endswith(".zip"):
                            with zipfile.ZipFile(io.BytesIO(uploaded.read())) as zf:
                                for name in zf.namelist():
                                    if not name.endswith("/"):
                                        image_bytes[Path(name).name] = zf.read(name)
                        else:
                            image_bytes[uploaded.name] = uploaded.read()

                    ok, skip, errors = 0, 0, []
                    for _, row in df.iterrows():
                        try:
                            pid = str(row["patient_id"]).strip()
                            vdate = str(row["visit_date"]).strip()
                            fname = str(row["image_filename"]).strip()

                            # 환자 등록 (없으면 생성)
                            if not site_store.get_patient(pid):
                                site_store.create_patient(
                                    pid,
                                    str(row.get("sex", "unknown")),
                                    int(row.get("age", 0)),
                                    chart_alias=str(row.get("chart_alias", "")),
                                    local_case_code=str(row.get("local_case_code", "")),
                                )

                            # 방문 등록 (없으면 생성)
                            if not site_store.get_visit(pid, vdate):
                                factors = str(row.get("predisposing_factor", "")).split("|") if row.get("predisposing_factor") else []
                                site_store.create_visit(
                                    patient_id=pid,
                                    visit_date=vdate,
                                    culture_confirmed=str(row.get("culture_confirmed", "TRUE")).upper() == "TRUE",
                                    culture_category=str(row.get("culture_category", "bacterial")),
                                    culture_species=str(row.get("culture_species", "Other")),
                                    contact_lens_use=str(row.get("contact_lens_use", "unknown")),
                                    predisposing_factor=factors,
                                    other_history=str(row.get("other_history", "")),
                                    visit_status=str(row.get("visit_status", "")),
                                    active_stage=str(row.get("active_stage", "TRUE")).upper() == "TRUE",
                                    smear_result=str(row.get("smear_result", "")),
                                    polymicrobial=str(row.get("polymicrobial", "FALSE")).upper() == "TRUE",
                                )

                            # 이미지 등록
                            if fname in image_bytes:
                                site_store.add_image(
                                    patient_id=pid,
                                    visit_date=vdate,
                                    view=str(row.get("view", "white")),
                                    is_representative=str(row.get("is_representative", "FALSE")).upper() == "TRUE",
                                    file_name=fname,
                                    content=image_bytes[fname],
                                )
                                ok += 1
                            else:
                                skip += 1
                                errors.append(f"{fname}: {t(lang, 'ZIP에서 파일을 찾을 수 없음', 'file not found in ZIP')}")
                        except Exception as exc:
                            errors.append(f"Row {_}: {exc}")

                    st.success(t(lang, f"✅ {ok}개 이미지 임포트 완료 / {skip}개 건너뜀", f"✅ {ok} images imported / {skip} skipped"))
                    if errors:
                        with st.expander(t(lang, f"⚠️ 오류 {len(errors)}건", f"⚠️ {len(errors)} error(s)")):
                            for e in errors:
                                st.text(e)
        except Exception as exc:
            st.error(str(exc))


def _render_admin_initial_training(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    user: dict[str, Any],
    lang: str,
) -> None:
    """Run site-level DenseNet training with a fixed patient split."""
    st.markdown(f"### {t(lang, '초기 글로벌 학습', 'Initial Global Training')}")
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '첫 글로벌 모델을 만드는 관리자용 학습 화면입니다.', 'This screen is the admin training control room for the first global model.'))}</strong>
  <span>{escape(t(lang, '입력 데이터는 MedSAM ROI crop만 사용하고, 환자 단위 고정 split을 저장합니다.', 'Training uses MedSAM ROI crops only and stores a fixed patient-level split.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    if workflow is None:
        st.error(t(lang, "AI 모듈이 준비되지 않았습니다.", "AI module not ready."))
        return

    sites = cp.accessible_sites_for_user(user)
    if not sites:
        st.warning(t(lang, "접근 가능한 사이트가 없습니다.", "No accessible sites are available."))
        return

    site_options = {site["site_id"]: f"{site['display_name']} ({site['site_id']})" for site in sites}
    train_site_id = st.selectbox(
        t(lang, "학습 데이터 사이트", "Training Data Site"),
        options=list(site_options.keys()),
        format_func=lambda site_id: site_options[site_id],
        key="train_site_select",
    )
    site_store = SiteStore(train_site_id)
    manifest_df = site_store.load_manifest()
    n_total = len(manifest_df)
    n_patients = manifest_df["patient_id"].nunique() if not manifest_df.empty else 0
    if "visit_status" in manifest_df.columns:
        n_active = int((manifest_df["visit_status"].fillna("scar") == "active").sum())
    elif "active_stage" in manifest_df.columns:
        n_active = int(manifest_df["active_stage"].fillna(False).astype(bool).sum())
    else:
        n_active = 0
    culture_mix = (
        manifest_df["culture_category"].value_counts().to_dict()
        if "culture_category" in manifest_df.columns and not manifest_df.empty
        else {}
    )
    split_record = site_store.load_patient_split()
    split_value = (
        f"{split_record.get('n_train_patients', 0)} / {split_record.get('n_val_patients', 0)} / {split_record.get('n_test_patients', 0)}"
        if split_record
        else t(lang, "미설정", "Not set")
    )

    st.markdown(
        f"<div class='kera-stat-grid'>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '전체 이미지', 'Total Images')}</div>"
        f"<div class='kera-stat-value'>{n_total}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '환자 수', 'Patients')}</div>"
        f"<div class='kera-stat-value'>{n_patients}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '활성기 이미지', 'Active Stage Images')}</div>"
        f"<div class='kera-stat-value'>{n_active}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '균종 분포', 'Culture Mix')}</div>"
        f"<div class='kera-stat-value'>{culture_mix.get('bacterial', 0)} / {culture_mix.get('fungal', 0)}</div>"
        f"<div class='kera-stat-note'>BK / FK</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '고정 Split', 'Fixed Split')}</div>"
        f"<div class='kera-stat-value'>{split_value}</div>"
        f"<div class='kera-stat-note'>{t(lang, 'train / val / test 환자 수', 'train / val / test patients')}</div></div>"
        f"</div>",
        unsafe_allow_html=True,
    )

    if n_patients < 4:
        st.warning(t(lang, "학습에는 최소 4명의 환자가 필요합니다. 먼저 데이터를 입력하거나 임포트하세요.", "At least 4 patients are required. Import data first."))
        return

    st.divider()
    st.markdown(f"**{t(lang, '학습 설정', 'Training Configuration')}**")
    st.info(
        t(
            lang,
            "초기 글로벌 학습은 MedSAM ROI crop만 사용합니다. 원본 전체 이미지는 학습 입력으로 쓰지 않습니다.",
            "Initial global training uses MedSAM ROI crops only. Full raw images are not used as training inputs.",
        )
    )
    if split_record:
        st.caption(
            t(
                lang,
                f"저장된 split을 재사용합니다. split_id: {split_record.get('split_id', '-')}",
                f"Reusing the saved split. split_id: {split_record.get('split_id', '-')}",
            )
        )
    else:
        st.caption(
            t(
                lang,
                "첫 실행 시 환자 단위 고정 train / val / test split을 생성하고 저장합니다.",
                "The first run creates and stores a fixed patient-level train / val / test split.",
            )
        )

    from kera_research.config import MODEL_DIR
    from kera_research.domain import DENSENET_VARIANTS, make_id

    col1, col2 = st.columns(2)
    with col1:
        architecture = st.selectbox(
            t(lang, "모델 구조", "Architecture"),
            DENSENET_VARIANTS,
            index=0,
            help=t(lang, "확신이 없으면 121을 권장합니다. 161은 더 무겁지만 강력합니다.", "121 is the safe default. 161 is stronger but heavier."),
        )
        epochs = st.slider(t(lang, "에포크", "Epochs"), 5, 100, 30)
        val_split = st.slider(t(lang, "Validation 비율", "Validation Split"), 0.1, 0.4, 0.2, 0.05)
        test_split = st.slider(t(lang, "Test 비율", "Test Split"), 0.1, 0.4, 0.2, 0.05)
    with col2:
        use_pretrained = st.toggle(
            t(lang, "ImageNet 초기화 사용 (권장)", "Use ImageNet pretrained weights (recommended)"),
            value=True,
        )
        lr = st.select_slider(
            t(lang, "학습률", "Learning rate"),
            options=[1e-5, 5e-5, 1e-4, 5e-4, 1e-3],
            value=1e-4,
            format_func=lambda value: f"{value:.0e}",
        )
        batch_size = st.select_slider(
            t(lang, "배치 크기", "Batch Size"),
            options=[4, 8, 16, 32],
            value=16,
        )
        regenerate_split = st.toggle(
            t(lang, "저장된 split 다시 생성", "Regenerate saved split"),
            value=False,
            help=t(lang, "기존 train / val / test split을 버리고 새로 생성합니다.", "Discard the existing train / val / test split and create a new one."),
        )

    hw = detect_hardware()
    exec_mode = st.radio(t(lang, "실행 모드", "Execution Mode"), EXECUTION_MODES, horizontal=True)
    device = resolve_execution_mode(exec_mode, hw)

    if not hw["gpu_available"] and batch_size > 8:
        st.warning(t(lang, "CPU 환경에서는 배치 크기 8 이하를 권장합니다.", "Batch size 8 or smaller is recommended on CPU."))

    output_path = str(MODEL_DIR / f"global_{architecture}_{make_id('init')[:8]}.pth")

    if st.button(t(lang, "초기 학습 시작", "Start Initial Training"), type="primary", key="btn_initial_train"):
        progress_bar = st.progress(0)
        status_text = st.empty()
        chart_placeholder = st.empty()
        history_store: list[dict[str, Any]] = []

        def on_progress(epoch: int, total: int, train_loss: float, val_acc: float) -> None:
            progress_bar.progress(epoch / total)
            status_text.markdown(
                f"**Epoch {epoch}/{total}**  "
                f"train loss: `{train_loss:.4f}`  "
                f"val acc: `{val_acc * 100:.1f}%`"
            )
            history_store.append({"epoch": epoch, "train_loss": train_loss, "val_acc": val_acc})
            if len(history_store) > 1:
                fig = px.line(
                    pd.DataFrame(history_store),
                    x="epoch",
                    y=["train_loss", "val_acc"],
                    title=t(lang, "학습 곡선", "Training Curve"),
                )
                chart_placeholder.plotly_chart(fig, use_container_width=True)

        try:
            result = workflow.run_initial_training(
                site_store=site_store,
                architecture=architecture,
                output_model_path=output_path,
                execution_device=device,
                epochs=epochs,
                learning_rate=lr,
                batch_size=batch_size,
                val_split=val_split,
                test_split=test_split,
                use_pretrained=use_pretrained,
                use_medsam_crops=True,
                regenerate_split=regenerate_split,
                progress_callback=on_progress,
            )
            progress_bar.progress(1.0)
            test_metrics = result.get("test_metrics", {})
            st.success(
                t(
                    lang,
                    f"초기 학습이 완료되었습니다.\n\n"
                    f"- 모델: **{result['version_name']}**\n"
                    f"- Train: {result['n_train_patients']}명 / {result['n_train']}장\n"
                    f"- Val: {result['n_val_patients']}명 / {result['n_val']}장\n"
                    f"- Test: {result['n_test_patients']}명 / {result['n_test']}장\n"
                    f"- Best Val Accuracy: **{result['best_val_acc'] * 100:.1f}%**\n"
                    f"- Test Accuracy: **{test_metrics.get('accuracy', 0.0) * 100:.1f}%**\n"
                    f"- 저장 경로: `{result['output_model_path']}`",
                    f"Initial training completed.\n\n"
                    f"- Model: **{result['version_name']}**\n"
                    f"- Train: {result['n_train_patients']} patients / {result['n_train']} images\n"
                    f"- Val: {result['n_val_patients']} patients / {result['n_val']} images\n"
                    f"- Test: {result['n_test_patients']} patients / {result['n_test']} images\n"
                    f"- Best Val Accuracy: **{result['best_val_acc'] * 100:.1f}%**\n"
                    f"- Test Accuracy: **{test_metrics.get('accuracy', 0.0) * 100:.1f}%**\n"
                    f"- Saved to: `{result['output_model_path']}`",
                )
            )
        except Exception as exc:
            st.error(f"{t(lang, '학습 오류:', 'Training error:')} {exc}")


def _render_admin_cross_validation(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    user: dict[str, Any],
    lang: str,
) -> None:
    st.markdown(f"### {t(lang, '환자 단위 Cross-Validation', 'Patient-Level Cross-Validation')}")
    st.markdown(
        f"""
<div class="kera-panel-note">
  <strong>{escape(t(lang, '초기 모델의 일반화 성능을 patient-level fold 기준으로 확인합니다.', 'Evaluate early model generalization with patient-level folds.'))}</strong>
  <span>{escape(t(lang, '학습 입력은 MedSAM ROI crop만 사용하며, fold별 test metric을 평균과 표준편차로 요약합니다.', 'This uses MedSAM ROI crops only and summarizes fold test metrics with mean and standard deviation.'))}</span>
</div>
""",
        unsafe_allow_html=True,
    )

    if workflow is None:
        st.error(t(lang, "AI 모듈이 준비되지 않았습니다.", "AI module not ready."))
        return

    sites = cp.accessible_sites_for_user(user)
    if not sites:
        st.warning(t(lang, "접근 가능한 사이트가 없습니다.", "No accessible sites are available."))
        return

    site_options = {site["site_id"]: f"{site['display_name']} ({site['site_id']})" for site in sites}
    selected_site_id = st.selectbox(
        t(lang, "평가 사이트", "Evaluation Site"),
        options=list(site_options.keys()),
        format_func=lambda site_id: site_options[site_id],
        key="cv_site_select",
    )
    site_store = SiteStore(selected_site_id)
    manifest_df = site_store.load_manifest()
    n_patients = manifest_df["patient_id"].nunique() if not manifest_df.empty else 0
    n_images = len(manifest_df)

    stat_cols = st.columns(2)
    with stat_cols[0]:
        st.metric(t(lang, "환자 수", "Patients"), n_patients)
    with stat_cols[1]:
        st.metric(t(lang, "이미지 수", "Images"), n_images)

    if n_patients < 3:
        st.info(t(lang, "Cross-validation에는 최소 3명의 환자가 필요합니다.", "At least 3 patients are required for cross-validation."))
        return

    from kera_research.config import MODEL_DIR
    from kera_research.domain import DENSENET_VARIANTS, make_id

    col1, col2 = st.columns(2)
    with col1:
        architecture = st.selectbox(
            t(lang, "모델 구조", "Architecture"),
            DENSENET_VARIANTS,
            index=0,
            key="cv_architecture",
        )
        num_folds = st.slider(t(lang, "Fold 수", "Number of Folds"), 3, min(5, n_patients), min(5, n_patients), 1)
        epochs = st.slider(t(lang, "Epochs", "Epochs"), 3, 50, 10, 1, key="cv_epochs")
    with col2:
        val_split = st.slider(t(lang, "내부 Validation 비율", "Internal Validation Split"), 0.1, 0.4, 0.2, 0.05, key="cv_val_split")
        lr = st.select_slider(
            t(lang, "학습률", "Learning rate"),
            options=[1e-5, 5e-5, 1e-4, 5e-4, 1e-3],
            value=1e-4,
            format_func=lambda value: f"{value:.0e}",
            key="cv_lr",
        )
        batch_size = st.select_slider(
            t(lang, "배치 크기", "Batch Size"),
            options=[4, 8, 16, 32],
            value=16,
            key="cv_batch_size",
        )
        use_pretrained = st.toggle(
            t(lang, "ImageNet 초기화 사용", "Use ImageNet pretrained weights"),
            value=True,
            key="cv_pretrained",
        )

    hw = detect_hardware()
    exec_mode = st.radio(t(lang, "실행 모드", "Execution Mode"), EXECUTION_MODES, horizontal=True, key="cv_exec_mode")
    device = resolve_execution_mode(exec_mode, hw)

    if st.button(t(lang, "Cross-Validation 실행", "Run Cross-Validation"), type="primary", key="btn_run_cv"):
        output_dir = str(MODEL_DIR / f"cross_validation_{make_id('cvdir')[:8]}")
        with st.spinner(t(lang, "Cross-validation 실행 중...", "Running cross-validation...")):
            try:
                result = workflow.run_cross_validation(
                    site_store=site_store,
                    architecture=architecture,
                    output_dir=output_dir,
                    execution_device=device,
                    num_folds=num_folds,
                    epochs=epochs,
                    learning_rate=lr,
                    batch_size=batch_size,
                    val_split=val_split,
                    use_pretrained=use_pretrained,
                    use_medsam_crops=True,
                )
                st.session_state["latest_cv_result"] = result
                st.success(t(lang, "Cross-validation 결과를 저장했습니다.", "Cross-validation result saved."))
                st.rerun()
            except Exception as exc:
                st.error(f"{t(lang, 'Cross-validation 오류:', 'Cross-validation error:')} {exc}")

    reports = _load_cross_validation_reports(site_store)
    session_cv = st.session_state.get("latest_cv_result")
    if session_cv and session_cv.get("site_id") == selected_site_id:
        reports = [session_cv] + [
            report for report in reports
            if report.get("cross_validation_id") != session_cv.get("cross_validation_id")
        ]

    if reports:
        report_options = {
            report["cross_validation_id"]: (
                f"{report.get('created_at', '-')[:19]} · "
                f"{report.get('architecture', 'unknown')} · "
                f"{report.get('num_folds', '-')} folds"
            )
            for report in reports
        }
        default_report_id = reports[0]["cross_validation_id"]
        selected_report_id = st.selectbox(
            t(lang, "저장된 Cross-Validation 결과", "Saved Cross-Validation Results"),
            options=list(report_options.keys()),
            format_func=lambda report_id: report_options[report_id],
            index=0,
            key=f"cv_report_select_{selected_site_id}",
        )
        latest_cv = next(report for report in reports if report["cross_validation_id"] == selected_report_id)
        st.markdown(f"#### {t(lang, 'Cross-Validation 결과', 'Cross-Validation Result')}")
        aggregate = latest_cv.get("aggregate_metrics", {})
        metric_cols = st.columns(5)
        for col, metric_name in zip(metric_cols, ["AUROC", "accuracy", "sensitivity", "specificity", "F1"]):
            metric = aggregate.get(metric_name, {})
            value = metric.get("mean")
            delta = metric.get("std")
            with col:
                st.metric(
                    metric_name,
                    "-" if value is None else f"{value:.3f}",
                    None if delta is None else f"std {delta:.3f}",
                )
        fold_rows = []
        for fold in latest_cv.get("fold_results", []):
            fold_rows.append(
                {
                    "fold": fold["fold_index"],
                    "train_patients": fold["n_train_patients"],
                    "val_patients": fold["n_val_patients"],
                    "test_patients": fold["n_test_patients"],
                    "AUROC": fold["test_metrics"].get("AUROC"),
                    "accuracy": fold["test_metrics"].get("accuracy"),
                    "sensitivity": fold["test_metrics"].get("sensitivity"),
                    "specificity": fold["test_metrics"].get("specificity"),
                    "F1": fold["test_metrics"].get("F1"),
                }
            )
        if fold_rows:
            st.dataframe(pd.DataFrame(fold_rows), use_container_width=True, hide_index=True)
    else:
        st.info(t(lang, "아직 저장된 Cross-validation 결과가 없습니다.", "No saved cross-validation result yet."))


def _render_admin_users(cp: ControlPlaneStore, lang: str) -> None:
    st.markdown(f"#### {t(lang, '사용자 및 권한', 'Users and Access')}")
    users = cp.list_users()
    sites = cp.list_sites()
    site_options = {site["site_id"]: f"{site['display_name']} ({site['site_id']})" for site in sites}

    if users:
        user_df = pd.DataFrame(users)
        if "site_ids" in user_df.columns:
            user_df["site_ids"] = user_df["site_ids"].apply(
                lambda values: ", ".join(values) if isinstance(values, list) else ""
            )
        columns = [column for column in ["username", "full_name", "role", "site_ids"] if column in user_df.columns]
        st.dataframe(user_df[columns], use_container_width=True, hide_index=True)

    st.markdown(f"**{t(lang, '사용자 추가 / 수정', 'Create or Update User')}**")
    with st.form("admin_user_form"):
        username = st.text_input(t(lang, "사용자명 *", "Username *"))
        full_name = st.text_input(t(lang, "이름", "Full Name"))
        password = st.text_input(t(lang, "비밀번호 *", "Password *"), type="password")
        col_role, col_sites = st.columns([1, 1.5], gap="large")
        with col_role:
            role = st.selectbox(t(lang, "권한", "Role"), USER_ROLE_OPTIONS, index=2)
        with col_sites:
            selected_site_ids = st.multiselect(
                t(lang, "접근 가능한 사이트", "Accessible Sites"),
                options=list(site_options.keys()),
                format_func=lambda site_id: site_options[site_id],
            )
        submitted = st.form_submit_button(t(lang, "저장", "Save"), use_container_width=True, type="primary")

    if submitted:
        if not username.strip() or not password.strip():
            st.error(t(lang, "사용자명과 비밀번호는 필수입니다.", "Username and password are required."))
        elif role != "admin" and not selected_site_ids:
            st.error(t(lang, "admin을 제외한 계정은 최소 1개 사이트를 할당해야 합니다.", "Non-admin accounts must be assigned to at least one site."))
        else:
            from kera_research.domain import make_id

            existing = next((item for item in users if item["username"] == username.strip()), None)
            cp.upsert_user(
                {
                    "user_id": existing["user_id"] if existing else make_id("user"),
                    "username": username.strip(),
                    "password": password.strip(),
                    "role": role,
                    "full_name": full_name.strip() or username.strip(),
                    "site_ids": [] if role == "admin" else selected_site_ids,
                }
            )
            st.success(t(lang, "사용자 설정을 저장했습니다.", "User settings saved."))
            st.rerun()


def _render_admin(
    cp: ControlPlaneStore,
    workflow: ResearchWorkflowService | None,
    user: dict[str, Any],
    lang: str,
) -> None:
    role = _user_role(user)
    if role not in {"admin", "site_admin"}:
        st.error(t(lang, "이 계정은 관리자 화면에 접근할 수 없습니다.", "This account cannot access the admin workspace."))
        return

    accessible_sites = cp.accessible_sites_for_user(user)
    accessible_site_ids = {site["site_id"] for site in accessible_sites}
    visible_pending_updates = [
        update
        for update in cp.list_model_updates()
        if update.get("status") == "pending_upload"
        and (role == "admin" or update.get("site_id") in accessible_site_ids)
    ]

    _render_page_header(
        eyebrow=t(lang, "Control Plane", "Control Plane"),
        title=t(lang, "관리자 패널", "Admin Panel"),
        subtitle=t(
            lang,
            "데이터 임포트, 초기 학습, 모델 레지스트리, 기관 운영, federated aggregation을 관리합니다.",
            "Manage import, initial training, model registry, site operations, and federated aggregation.",
        ),
        meta_items=[
            f"Sites {len(cp.list_sites()) if role == 'admin' else len(accessible_sites)}",
            f"Models {len(cp.list_model_versions())}",
            f"Pending Updates {len(visible_pending_updates)}",
        ],
    )

    if role == "site_admin":
        st.info(
            t(
                lang,
                "site admin 계정은 할당된 사이트의 데이터 임포트, 초기 학습, cross-validation, 모델 확인만 수행할 수 있습니다.",
                "Site admin accounts can only import data, run initial training, run cross-validation, and review models for their assigned sites.",
            )
        )

    def render_model_tab() -> None:
        st.markdown(f"#### {t(lang, '등록된 모델 버전', 'Registered Model Versions')}")
        versions = cp.list_model_versions()
        if versions:
            df = pd.DataFrame(versions)
            cols = [c for c in ["version_name", "architecture", "stage", "ready", "created_at", "notes_ko"] if c in df.columns]
            st.dataframe(df[cols], use_container_width=True, hide_index=True)

        st.markdown(f"#### {t(lang, '대기 중 업데이트', 'Pending Updates')}")
        if visible_pending_updates:
            df_pending = pd.DataFrame(visible_pending_updates)
            st.dataframe(
                df_pending[["update_id", "site_id", "architecture", "created_at", "n_cases"]],
                use_container_width=True,
                hide_index=True,
            )
        else:
            st.info(t(lang, "대기 중인 업데이트가 없습니다.", "No pending updates."))

    def render_sites_tab() -> None:
        st.markdown(f"#### {t(lang, '등록된 사이트', 'Registered Sites')}")
        sites = cp.list_sites() if role == "admin" else accessible_sites
        if sites:
            st.dataframe(pd.DataFrame(sites), use_container_width=True, hide_index=True)
        else:
            st.info(t(lang, "표시할 사이트가 없습니다.", "No sites available to display."))

        if role != "admin":
            return

        st.markdown(f"#### {t(lang, '새 사이트 등록', 'Register New Site')}")
        projects = cp.list_projects()
        if not projects:
            st.warning(t(lang, "프로젝트를 먼저 생성하세요.", "Create a project first."))
        else:
            with st.form("site_form"):
                proj_id = st.selectbox(
                    t(lang, "프로젝트", "Project"),
                    [p["project_id"] for p in projects],
                    format_func=lambda x: next((p["name"] for p in projects if p["project_id"] == x), x),
                )
                col_a, col_b = st.columns(2)
                with col_a:
                    site_code = st.text_input(t(lang, "사이트 코드 (영문)", "Site Code"), placeholder="SNUH")
                with col_b:
                    display_name = st.text_input(t(lang, "표시 이름", "Display Name"), placeholder="서울대학교병원")
                hospital_name = st.text_input(t(lang, "병원명", "Hospital Name"))
                if st.form_submit_button(t(lang, "등록", "Register"), use_container_width=True):
                    try:
                        cp.create_site(proj_id, site_code, display_name, hospital_name)
                        st.success(t(lang, "사이트 등록 완료!", "Site registered!"))
                        st.rerun()
                    except ValueError as exc:
                        st.error(str(exc))

        st.markdown(f"#### {t(lang, '프로젝트 생성', 'Create Project')}")
        with st.form("project_form"):
            pname = st.text_input(t(lang, "프로젝트 이름", "Project Name"))
            pdesc = st.text_area(t(lang, "설명", "Description"), height=60)
            if st.form_submit_button(t(lang, "생성", "Create"), use_container_width=True):
                try:
                    cp.create_project(pname, pdesc, "user_admin")
                    st.success(t(lang, "프로젝트 생성 완료!", "Project created!"))
                    st.rerun()
                except ValueError as exc:
                    st.error(str(exc))

    if role == "admin":
        tab_import, tab_train, tab_cv, tab_model, tab_sites, tab_organisms, tab_users, tab_federated = st.tabs([
            t(lang, "📥 데이터 임포트", "📥 Import Data"),
            t(lang, "🧠 초기 학습", "🧠 Initial Training"),
            t(lang, "🧪 Cross-Validation", "🧪 Cross-Validation"),
            t(lang, "모델 관리", "Models"),
            t(lang, "사이트 관리", "Sites"),
            t(lang, "균종 관리", "Organisms"),
            t(lang, "사용자 권한", "Users"),
            t(lang, "Federated 집계", "Federated Aggregation"),
        ])
    else:
        tab_import, tab_train, tab_cv, tab_model, tab_sites = st.tabs([
            t(lang, "📥 데이터 임포트", "📥 Import Data"),
            t(lang, "🧠 초기 학습", "🧠 Initial Training"),
            t(lang, "🧪 Cross-Validation", "🧪 Cross-Validation"),
            t(lang, "모델 관리", "Models"),
            t(lang, "사이트 관리", "Sites"),
        ])

    with tab_import:
        _render_admin_import(cp, workflow, user, lang)

    with tab_train:
        _render_admin_initial_training(cp, workflow, user, lang)

    with tab_cv:
        _render_admin_cross_validation(cp, workflow, user, lang)

    with tab_model:
        render_model_tab()

    with tab_sites:
        render_sites_tab()

    if role == "admin":
        with tab_organisms:
            st.markdown(f"#### {t(lang, '균종 승인 대기', 'Pending Organism Requests')}")
            pending_orgs = cp.list_organism_requests(status="pending")
            if pending_orgs:
                for req in pending_orgs:
                    col1, col2 = st.columns([3, 1])
                    with col1:
                        st.markdown(f"**{req['culture_category']}** · {req['requested_species']} (by {req['requested_by']})")
                    with col2:
                        if st.button(t(lang, "승인", "Approve"), key=f"approve_{req['request_id']}"):
                            cp.approve_organism(req["request_id"], "user_admin")
                            st.rerun()
            else:
                st.info(t(lang, "대기 중인 요청 없음", "No pending requests"))

        with tab_users:
            _render_admin_users(cp, lang)

        with tab_federated:
            st.markdown(f"#### {t(lang, 'Federated Learning 집계', 'Federated Aggregation')}")
            st.info(
                t(
                    lang,
                    "각 병원의 weight delta를 수집해 weighted FedAvg로 글로벌 모델을 업데이트합니다.\n\n"
                    "현재: 각 병원에서 delta 파일을 업로드하면 여기서 집계 후 새 글로벌 모델을 등록합니다.",
                    "Collect weight deltas from each site and run weighted FedAvg to update the global model.\n\n"
                    "Currently: sites upload delta files, admin aggregates here and registers new global model.",
                )
            )
            all_updates = cp.list_model_updates()
            pending_deltas = [update for update in all_updates if update.get("status") == "pending_upload"]
            if pending_deltas:
                st.markdown(
                    f"**{t(lang, f'집계 가능 업데이트: {len(pending_deltas)}개', f'Aggregatable updates: {len(pending_deltas)}')}**"
                )
                df_deltas = pd.DataFrame(pending_deltas)
                st.dataframe(
                    df_deltas[["update_id", "site_id", "architecture", "n_cases", "created_at"]],
                    use_container_width=True,
                    hide_index=True,
                )
                if workflow and st.button(t(lang, "🔗 FedAvg 집계 실행", "🔗 Run FedAvg Aggregation"), type="primary"):
                    try:
                        delta_paths = [update["artifact_path"] for update in pending_deltas]
                        architecture = pending_deltas[0]["architecture"]
                        base_model = next(
                            (model for model in cp.list_model_versions() if model["version_id"] == pending_deltas[0]["base_model_version_id"]),
                            cp.current_global_model(),
                        )
                        from kera_research.config import MODEL_DIR
                        from kera_research.domain import make_id
                        out_path = MODEL_DIR / f"global_{architecture}_{make_id('agg')}.pth"
                        delta_weights = [update.get("n_cases", 1) for update in pending_deltas]
                        site_weights: dict[str, int] = {}
                        for update in pending_deltas:
                            site_weights[update["site_id"]] = site_weights.get(update["site_id"], 0) + int(update.get("n_cases", 1))
                        workflow.model_manager.aggregate_weight_deltas(
                            delta_paths,
                            out_path,
                            weights=delta_weights,
                            base_model_path=base_model["model_path"],
                        )
                        new_version_name = f"global-{architecture}-fedavg-{make_id('v')[:6]}"
                        cp.register_aggregation(
                            base_model_version_id=base_model["version_id"],
                            new_model_path=str(out_path),
                            new_version_name=new_version_name,
                            architecture=architecture,
                            site_weights=site_weights,
                            requires_medsam_crop=bool(base_model.get("requires_medsam_crop", False)),
                        )
                        cp.update_model_update_statuses(
                            [update["update_id"] for update in pending_deltas],
                            "aggregated",
                        )
                        st.success(
                            t(
                                lang,
                                f"✅ 집계 완료! 새 모델: {new_version_name}",
                                f"✅ Aggregation done! New model: {new_version_name}",
                            )
                        )
                        st.rerun()
                    except Exception as exc:
                        st.error(str(exc))
            else:
                st.info(t(lang, "집계할 업데이트가 없습니다.", "No updates available for aggregation."))

            st.markdown(f"#### {t(lang, '집계 이력', 'Aggregation History')}")
            aggs = cp.list_aggregations()
            if aggs:
                st.dataframe(pd.DataFrame(aggs), use_container_width=True, hide_index=True)


# ──────────────────────────────────────────────
# CSS
# ──────────────────────────────────────────────

def _inject_css(theme: str) -> None:
    if theme == "dark":
        theme_vars = """
        :root {
            --kera-ink: #eef5f7;
            --kera-muted: #b7cad4;
            --kera-accent: #62c8bc;
            --kera-accent-soft: rgba(98, 200, 188, 0.12);
            --kera-accent-strong: #d18a5c;
            --kera-card: rgba(18, 27, 36, 0.82);
            --kera-card-strong: rgba(12, 19, 27, 0.92);
            --kera-border: rgba(238, 245, 247, 0.08);
            --kera-bg-top: #0e151d;
            --kera-bg-bottom: #16212a;
            --kera-shadow: rgba(0, 0, 0, 0.30);
            --kera-input: rgba(11, 19, 28, 0.88);
            --kera-sidebar: rgba(8, 14, 20, 0.96);
            --kera-sidebar-ink: #f3f8fa;
            --kera-footer: rgba(10, 17, 24, 0.94);
            --kera-danger-bg: rgba(111, 33, 33, 0.24);
            --kera-danger-ink: #ffd4d4;
        }
        """
    else:
        theme_vars = """
        :root {
            --kera-ink: #1b2732;
            --kera-muted: #63717c;
            --kera-accent: #0b7a72;
            --kera-accent-soft: rgba(11, 122, 114, 0.12);
            --kera-accent-strong: #b86d43;
            --kera-card: rgba(255, 250, 244, 0.82);
            --kera-card-strong: rgba(255, 255, 255, 0.88);
            --kera-border: rgba(27, 39, 50, 0.08);
            --kera-bg-top: #f6efe5;
            --kera-bg-bottom: #edf3f0;
            --kera-shadow: rgba(27, 39, 50, 0.08);
            --kera-input: rgba(255, 255, 255, 0.84);
            --kera-sidebar: rgba(16, 31, 43, 0.97);
            --kera-sidebar-ink: #f3f8fb;
            --kera-footer: rgba(16, 31, 43, 0.88);
            --kera-danger-bg: #f8dfdc;
            --kera-danger-ink: #8a3932;
        }
        """

    css = (
        "<style>"
        + theme_vars
        + """
        html, body, [class*="css"]  {
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        .stApp {
            background:
                radial-gradient(circle at 12% 12%, rgba(184, 109, 67, 0.12), transparent 24%),
                radial-gradient(circle at 86% 9%, rgba(11, 122, 114, 0.16), transparent 26%),
                linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 45%, transparent 100%),
                linear-gradient(180deg, var(--kera-bg-top) 0%, var(--kera-bg-bottom) 100%);
            color: var(--kera-ink);
            font-family: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
        }
        .block-container {
            max-width: 1220px;
            padding-top: 1.4rem;
            padding-bottom: 3.5rem;
        }
        [data-testid="stSidebar"] {
            background:
                radial-gradient(circle at top, rgba(98, 200, 188, 0.10), transparent 28%),
                linear-gradient(180deg, var(--kera-sidebar), rgba(0,0,0,0.12));
            border-right: 1px solid rgba(255,255,255,0.07);
        }
        [data-testid="stSidebar"] * { color: var(--kera-sidebar-ink) !important; }
        .stApp h1,.stApp h2,.stApp h3,
        .kera-page-title,
        .kera-brand-title,
        .kera-result-value,
        .kera-closure-title {
            font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
            letter-spacing: -0.03em;
        }
        .stApp h4,.stApp h5,.stApp h6,
        .stApp p,.stApp label,.stApp span,
        .stApp div[data-testid="stMarkdownContainer"],
        .stApp div[data-testid="stMarkdownContainer"] p,
        .stApp div[data-testid="stMarkdownContainer"] li,
        .stApp div[data-testid="stWidgetLabel"],
        .stApp [data-testid="stAlertContainer"],
        .stApp [data-testid="stRadio"] p { color: var(--kera-ink) !important; }
        .stApp [data-testid="stCaptionContainer"] { color: var(--kera-muted) !important; }
        [data-testid="stImage"] img {
            border-radius: 22px;
            border: 1px solid var(--kera-border);
            box-shadow: 0 18px 40px var(--kera-shadow);
        }
        [data-testid="stMetric"] {
            background: linear-gradient(180deg, var(--kera-card-strong), var(--kera-card));
            border: 1px solid var(--kera-border);
            border-radius: 22px;
            padding: 1rem 1rem;
            box-shadow: 0 18px 36px var(--kera-shadow);
        }
        .stButton > button {
            min-height: 2.95rem;
            border-radius: 999px;
            border: 1px solid var(--kera-border);
            background: rgba(255,255,255,0.24);
            color: var(--kera-ink);
            font-weight: 700;
            box-shadow: 0 10px 20px rgba(0,0,0,0.04);
        }
        .stButton > button:hover {
            filter: brightness(1.02);
            border-color: rgba(11, 122, 114, 0.35);
            color: var(--kera-ink);
        }
        .stButton > button[kind="primary"],
        .stDownloadButton > button {
            background: linear-gradient(135deg, var(--kera-accent), #0f9a8e 56%, var(--kera-accent-strong));
            color: white !important;
            border-color: transparent;
            box-shadow: 0 16px 32px rgba(11, 122, 114, 0.20);
        }
        .stButton > button[kind="primary"]:hover,
        .stDownloadButton > button:hover {
            color: white !important;
            filter: brightness(1.05);
        }
        .stSelectbox > div > div,
        .stSelectbox div[data-baseweb="select"],
        .stTextInput > div > div > input,
        .stTextArea textarea,
        .stDateInput > div > div input,
        .stNumberInput input,
        .stMultiSelect > div > div {
            background: var(--kera-input);
            color: var(--kera-ink);
            border-radius: 16px !important;
            border: 1px solid var(--kera-border) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);
            backdrop-filter: blur(10px);
        }
        [data-baseweb="tab-list"] {
            gap: 0.45rem;
            background: transparent;
        }
        [data-baseweb="tab"] {
            height: 2.6rem;
            border-radius: 999px;
            padding: 0 1rem;
            background: rgba(255,255,255,0.3);
            border: 1px solid var(--kera-border);
        }
        [data-baseweb="tab"][aria-selected="true"] {
            background: linear-gradient(135deg, var(--kera-accent), rgba(11, 122, 114, 0.72));
            color: white !important;
            border-color: transparent;
        }
        [data-testid="stDataFrame"], .stPlotlyChart {
            border-radius: 22px;
            overflow: hidden;
            border: 1px solid var(--kera-border);
            box-shadow: 0 14px 30px var(--kera-shadow);
        }
        .kera-card {
            background: linear-gradient(180deg, var(--kera-card-strong), var(--kera-card));
            border: 1px solid var(--kera-border);
            border-radius: 22px;
            padding: 1rem 1.05rem;
            box-shadow: 0 18px 40px var(--kera-shadow);
            margin-bottom: 0.65rem;
            backdrop-filter: blur(14px);
        }
        .kera-stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 0.9rem;
            margin: 0.75rem 0 1.1rem 0;
        }
        .kera-stat-card {
            background: linear-gradient(180deg, var(--kera-card-strong), var(--kera-card));
            border: 1px solid var(--kera-border);
            border-radius: 22px;
            padding: 1rem 1.05rem;
            box-shadow: 0 18px 32px var(--kera-shadow);
            backdrop-filter: blur(14px);
        }
        .kera-stat-label {
            color: var(--kera-muted);
            font-size: 0.74rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }
        .kera-stat-value { color: var(--kera-ink); font-size: 1.6rem; font-weight: 800; margin-top: 0.28rem; }
        .kera-stat-note { color: var(--kera-muted); font-size: 0.84rem; margin-top: 0.25rem; line-height: 1.45; }
        .kera-chip-row { display: flex; flex-wrap: wrap; gap: 0.55rem; margin: 0.55rem 0 0.9rem 0; }
        .kera-chip {
            display: inline-flex; align-items: center; gap: 0.35rem;
            border-radius: 999px; padding: 0.45rem 0.82rem;
            background: rgba(255,255,255,0.55);
            border: 1px solid var(--kera-border);
            color: var(--kera-ink); font-size: 0.86rem; font-weight: 700;
        }
        .kera-chip.complete { background: rgba(13, 143, 138, 0.12); color: #0b6c68; }
        .kera-chip.pending { background: rgba(184, 109, 67, 0.14); color: #8c5731; }
        .kera-brand-block,
        .kera-sidebar-user {
            background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04));
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 22px;
            padding: 1rem 1.05rem;
            margin-bottom: 0.9rem;
            box-shadow: 0 20px 36px rgba(0,0,0,0.16);
        }
        .kera-brand-title {
            font-size: 1.48rem;
            font-weight: 800;
            color: var(--kera-sidebar-ink);
            margin-top: 0.2rem;
        }
        .kera-brand-copy {
            color: rgba(243, 248, 251, 0.74);
            font-size: 0.88rem;
            line-height: 1.55;
            margin: 0.55rem 0 0 0;
        }
        .kera-sidebar-user h4 { margin: 0.1rem 0 0.2rem 0; color: var(--kera-sidebar-ink); font-size: 1.02rem; }
        .kera-sidebar-user p { margin: 0; color: rgba(243, 248, 251, 0.72); font-size: 0.88rem; }
        .kera-sidebar-label {
            color: rgba(243, 248, 251, 0.58);
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.10em;
            font-weight: 800;
        }
        .kera-status-panel {
            background: linear-gradient(160deg, rgba(98, 200, 188, 0.16), rgba(255,255,255,0.06));
            border-radius: 22px;
            border: 1px solid rgba(255,255,255,0.10);
            padding: 1rem 1.05rem;
            box-shadow: 0 20px 36px rgba(0,0,0,0.18);
        }
        .kera-status-title { color: var(--kera-sidebar-ink); font-weight: 800; font-size: 1.05rem; margin-top: 0.35rem; }
        .kera-status-copy { color: rgba(243, 248, 251, 0.82); font-size: 0.86rem; margin-top: 0.25rem; }
        .kera-status-foot { color: rgba(243, 248, 251, 0.60); font-size: 0.78rem; margin-top: 0.55rem; }
        .kera-page-header {
            position: relative;
            overflow: hidden;
            padding: 1.35rem 1.35rem 1.1rem 1.35rem;
            margin-bottom: 1.1rem;
            border-radius: 28px;
            border: 1px solid var(--kera-border);
            background:
                radial-gradient(circle at top right, rgba(11, 122, 114, 0.13), transparent 28%),
                radial-gradient(circle at left center, rgba(184, 109, 67, 0.10), transparent 26%),
                linear-gradient(180deg, var(--kera-card-strong), var(--kera-card));
            box-shadow: 0 24px 44px var(--kera-shadow);
            backdrop-filter: blur(14px);
        }
        .kera-eyebrow {
            color: var(--kera-accent);
            text-transform: uppercase;
            letter-spacing: 0.13em;
            font-size: 0.72rem;
            font-weight: 800;
        }
        .kera-page-title {
            margin: 0.4rem 0 0 0;
            font-size: clamp(2rem, 4vw, 3rem);
            line-height: 0.98;
        }
        .kera-page-subtitle {
            max-width: 760px;
            margin: 0.7rem 0 0 0;
            color: var(--kera-muted);
            font-size: 0.98rem;
            line-height: 1.65;
        }
        .kera-meta-strip {
            display: flex;
            flex-wrap: wrap;
            gap: 0.55rem;
            margin-top: 0.95rem;
        }
        .kera-meta-chip {
            display: inline-flex;
            align-items: center;
            min-height: 2rem;
            padding: 0.32rem 0.78rem;
            border-radius: 999px;
            background: rgba(255,255,255,0.56);
            border: 1px solid var(--kera-border);
            font-size: 0.82rem;
            font-weight: 700;
            color: var(--kera-ink);
        }
        .kera-stepper {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
            gap: 0.7rem;
            margin: 0 0 1.25rem 0;
        }
        .kera-step {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            min-height: 4rem;
            padding: 0.8rem 0.95rem;
            border-radius: 22px;
            border: 1px solid var(--kera-border);
            background: rgba(255,255,255,0.38);
            color: var(--kera-muted);
            font-weight: 700;
            box-shadow: 0 12px 24px var(--kera-shadow);
        }
        .kera-step-index {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2rem;
            height: 2rem;
            border-radius: 999px;
            background: rgba(255,255,255,0.6);
            border: 1px solid var(--kera-border);
            font-size: 0.76rem;
            font-weight: 800;
            color: var(--kera-muted);
        }
        .kera-step.is-active {
            background: linear-gradient(135deg, rgba(11, 122, 114, 0.92), rgba(184, 109, 67, 0.85));
            color: white;
            border-color: transparent;
        }
        .kera-step.is-active .kera-step-index {
            background: rgba(255,255,255,0.18);
            border-color: rgba(255,255,255,0.18);
            color: white;
        }
        .kera-step.is-complete {
            color: var(--kera-ink);
            background: linear-gradient(180deg, rgba(255,255,255,0.66), rgba(255,255,255,0.38));
        }
        .kera-login-spacer { height: 0.6rem; }
        .kera-login-hero,
        .kera-login-panel,
        .kera-result-hero,
        .kera-panel-note,
        .kera-closure-card {
            border-radius: 28px;
            border: 1px solid var(--kera-border);
            background: linear-gradient(180deg, var(--kera-card-strong), var(--kera-card));
            box-shadow: 0 22px 46px var(--kera-shadow);
            backdrop-filter: blur(16px);
        }
        .kera-login-hero {
            padding: 1.6rem;
            min-height: 26rem;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
        }
        .kera-login-hero h1 {
            margin: 0.5rem 0 0 0;
            font-size: clamp(2.2rem, 5vw, 4rem);
            line-height: 0.94;
        }
        .kera-login-hero p {
            max-width: 620px;
            margin: 1rem 0 0 0;
            color: var(--kera-muted);
            font-size: 1rem;
            line-height: 1.72;
        }
        .kera-login-highlights {
            display: flex;
            flex-wrap: wrap;
            gap: 0.55rem;
            margin-top: 1.3rem;
        }
        .kera-login-highlights span {
            display: inline-flex;
            padding: 0.42rem 0.82rem;
            border-radius: 999px;
            background: rgba(255,255,255,0.45);
            border: 1px solid var(--kera-border);
            font-size: 0.82rem;
            font-weight: 700;
        }
        .kera-login-panel {
            padding: 1.35rem;
            margin-top: 3rem;
            margin-bottom: 0.9rem;
        }
        .kera-login-panel h3 {
            margin: 0.45rem 0 0 0;
            font-size: 1.48rem;
        }
        .kera-login-panel p {
            margin-top: 0.55rem;
            color: var(--kera-muted);
            line-height: 1.6;
        }
        .kera-result-hero {
            padding: 1.25rem 1.25rem 1.15rem 1.25rem;
            margin-bottom: 0.9rem;
        }
        .kera-result-topline {
            display: flex;
            justify-content: space-between;
            gap: 0.75rem;
            align-items: center;
        }
        .kera-result-kicker {
            font-size: 0.74rem;
            font-weight: 800;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: var(--kera-muted);
        }
        .kera-result-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.36rem 0.78rem;
            border-radius: 999px;
            font-size: 0.82rem;
            font-weight: 800;
        }
        .kera-result-badge.is-good {
            color: #0b6c68;
            background: rgba(11, 122, 114, 0.14);
        }
        .kera-result-badge.is-caution {
            color: #8f5d36;
            background: rgba(184, 109, 67, 0.14);
        }
        .kera-result-main {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            gap: 1rem;
            margin-top: 1rem;
        }
        .kera-result-label {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.09em;
            font-weight: 800;
            color: var(--kera-muted);
        }
        .kera-result-value {
            font-size: clamp(2rem, 4vw, 3rem);
            line-height: 0.95;
            margin-top: 0.35rem;
        }
        .kera-result-caption {
            margin-top: 0.45rem;
            color: var(--kera-muted);
        }
        .kera-result-number {
            text-align: right;
        }
        .kera-result-number span {
            display: block;
            font-size: 2.4rem;
            font-weight: 800;
            line-height: 0.95;
        }
        .kera-result-number small {
            color: var(--kera-muted);
            font-size: 0.8rem;
        }
        .kera-prob-track {
            width: 100%;
            height: 16px;
            border-radius: 999px;
            margin-top: 1rem;
            background: linear-gradient(90deg, rgba(11, 122, 114, 0.12), rgba(184, 109, 67, 0.14));
            overflow: hidden;
        }
        .kera-prob-fill {
            height: 100%;
            border-radius: 999px;
            background: linear-gradient(90deg, var(--kera-accent), #20a298);
        }
        .kera-prob-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 0.5rem;
            color: var(--kera-muted);
            font-size: 0.82rem;
            font-weight: 700;
        }
        .kera-panel-note {
            display: flex;
            flex-direction: column;
            gap: 0.28rem;
            padding: 1rem 1.05rem;
            margin-bottom: 1rem;
        }
        .kera-panel-note strong { font-size: 0.96rem; }
        .kera-panel-note span { color: var(--kera-muted); line-height: 1.55; }
        .kera-image-label {
            margin: 0 0 0.7rem 0;
            font-size: 0.78rem;
            letter-spacing: 0.09em;
            text-transform: uppercase;
            font-weight: 800;
            color: var(--kera-muted);
        }
        .kera-closure-card {
            padding: 1.35rem;
            text-align: center;
            margin-bottom: 1rem;
        }
        .kera-closure-card.is-positive {
            background:
                radial-gradient(circle at top center, rgba(11, 122, 114, 0.16), transparent 30%),
                linear-gradient(180deg, var(--kera-card-strong), var(--kera-card));
        }
        .kera-closure-title {
            margin-top: 0.45rem;
            font-size: clamp(1.7rem, 3vw, 2.4rem);
        }
        .kera-closure-copy {
            max-width: 680px;
            margin: 0.7rem auto 0 auto;
            color: var(--kera-muted);
            line-height: 1.65;
        }
        .stAlert { color: var(--kera-ink); border-radius: 18px; }
        @media (max-width: 640px) {
            .block-container { padding-top: 1rem; }
            .kera-page-header,
            .kera-login-hero,
            .kera-login-panel,
            .kera-result-hero,
            .kera-closure-card { padding: 1rem; }
            .kera-stepper { grid-template-columns: 1fr; }
            .kera-result-main { flex-direction: column; align-items: flex-start; }
            .kera-result-number { text-align: left; }
            .kera-stat-value { font-size: 1.24rem; }
        }
        </style>"""
    )
    st.markdown(css, unsafe_allow_html=True)
