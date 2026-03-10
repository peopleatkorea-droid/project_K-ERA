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
from kera_research.i18n import t
from kera_research.services.control_plane import ControlPlaneStore
from kera_research.services.data_plane import SiteStore
from kera_research.services.hardware import detect_hardware, resolve_execution_mode
from kera_research.services.pipeline import ResearchWorkflowService
from kera_research.services.runtime import detect_local_node_status

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
    if page == "wizard":
        _render_wizard(cp, workflow, workflow_error, user, runtime_status, lang)
    elif page == "dashboard":
        _render_dashboard(cp, user, lang)
    elif page == "admin":
        _render_admin(cp, workflow, lang)


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
        # ── App name
        st.markdown(
            f"<div style='font-size:1.3rem;font-weight:800;color:var(--kera-accent);margin-bottom:0.2rem'>"
            f"🔬 {APP_NAME}</div>",
            unsafe_allow_html=True,
        )

        # ── Language toggle
        col_l, col_r = st.columns(2)
        with col_l:
            if st.button("🇰🇷 한국어", use_container_width=True, key="btn_ko"):
                st.session_state["lang"] = "ko"
                st.rerun()
        with col_r:
            if st.button("🇬🇧 English", use_container_width=True, key="btn_en"):
                st.session_state["lang"] = "en"
                st.rerun()

        st.divider()

        user = st.session_state.get("user")
        if not user:
            return None

        # ── User info
        st.markdown(
            f"<div class='kera-sidebar-user'>"
            f"<h4>{user.get('full_name', user['username'])}</h4>"
            f"<p>{user['role'].capitalize()} · {user['username']}</p>"
            f"</div>",
            unsafe_allow_html=True,
        )

        # ── Site selector
        sites = cp.list_sites()
        if sites:
            site_options = {s["site_id"]: f"{s['display_name']} ({s['site_id']})" for s in sites}
            current_site = st.session_state.get("wiz_site_id") or sites[0]["site_id"]
            if current_site not in site_options:
                current_site = sites[0]["site_id"]
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
            st.info(t(lang, "사이트를 먼저 등록하세요.", "Register a site first."))

        st.divider()

        # ── Navigation buttons
        if st.button(
            t(lang, "➕  새 케이스 입력", "➕  New Case"),
            use_container_width=True,
            key="btn_new_case",
        ):
            _reset_wizard()
            st.session_state["page"] = "wizard"
            st.rerun()

        if st.button(
            t(lang, "📊  대시보드", "📊  Dashboard"),
            use_container_width=True,
            key="btn_dashboard",
        ):
            st.session_state["page"] = "dashboard"
            st.rerun()

        if user.get("role") == "admin":
            if st.button(
                t(lang, "⚙️  관리자", "⚙️  Admin"),
                use_container_width=True,
                key="btn_admin",
            ):
                st.session_state["page"] = "admin"
                st.rerun()

        st.divider()

        # ── Hardware status
        hw = detect_hardware()
        hw_label = "GPU ✅" if hw["cuda_available"] else "CPU only"
        st.caption(f"🖥 {hw_label}  ·  AI: {'✅' if runtime_status['ai_engine_ready'] else '⚠️ 준비 필요'}")

        # ── Logout
        if st.button(t(lang, "로그아웃", "Log out"), use_container_width=True, key="btn_logout"):
            st.session_state["user"] = None
            st.rerun()

    return user


# ──────────────────────────────────────────────
# Login
# ──────────────────────────────────────────────

def _render_login(cp: ControlPlaneStore, lang: str) -> None:
    col_a, col_b, col_c = st.columns([1, 1.6, 1])
    with col_b:
        st.markdown("<br><br>", unsafe_allow_html=True)
        st.markdown(
            f"<div style='text-align:center;font-size:2rem;font-weight:900;color:var(--kera-accent)'>"
            f"🔬 {APP_NAME}</div>",
            unsafe_allow_html=True,
        )
        st.markdown(
            f"<div style='text-align:center;color:var(--kera-muted);margin-bottom:2rem'>"
            f"{t(lang, '감염성 각막염 연구 플랫폼', 'Infectious Keratitis Research Platform')}</div>",
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
            parts.append(f"<span style='color:var(--kera-accent);font-weight:700'>✓ {label}</span>")
        elif i == current_idx:
            parts.append(
                f"<span style='background:var(--kera-accent);color:white;padding:0.2rem 0.6rem;"
                f"border-radius:999px;font-weight:700'>{label}</span>"
            )
        else:
            parts.append(f"<span style='color:var(--kera-muted)'>{label}</span>")
    st.markdown(
        "<div style='display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:1.2rem'>"
        + " <span style='color:var(--kera-muted)'>›</span> ".join(parts)
        + "</div>",
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

    if workflow_error and not runtime_status["ai_engine_ready"]:
        st.warning(
            t(
                lang,
                "⚠️ AI 모듈이 준비되지 않았습니다. 데이터 입력은 가능하나 검증·학습 기능은 로컬 노드 설치 후 사용하세요.",
                "⚠️ AI module not ready. Data entry is available, but validation/training requires local node setup.",
            )
        )

    step = st.session_state.get("wiz_step", "patient")
    _render_step_indicator(step, lang)

    if not site_store:
        st.warning(t(lang, "먼저 사이드바에서 병원 사이트를 선택하거나 관리자에게 사이트 등록을 요청하세요.", "Select a hospital site from the sidebar or ask an admin to register one."))
        return

    if step == "patient":
        _step_patient(site_store, lang)
    elif step == "visit":
        _step_visit(cp, site_store, lang)
    elif step == "images":
        _step_images(site_store, lang)
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
    st.subheader(t(lang, "👤 환자 선택 또는 신규 등록", "👤 Select or Register Patient"))

    patients = site_store.list_patients()

    # ── 기존 환자 검색
    if patients:
        st.markdown(f"**{t(lang, '기존 환자 검색', 'Search Existing Patient')}**")
        search = st.text_input(t(lang, "환자 ID 또는 이름 검색", "Search by Patient ID"), key="patient_search", placeholder="P001")
        filtered = [p for p in patients if search.lower() in p["patient_id"].lower()] if search else patients

        for p in filtered[:20]:
            visits = site_store.list_visits_for_patient(p["patient_id"])
            visit_summary = f"{len(visits)}{t(lang, '회 방문', ' visit(s)')}"
            last_visit = visits[-1]["visit_date"] if visits else t(lang, "없음", "None")
            col1, col2 = st.columns([3, 1])
            with col1:
                st.markdown(
                    f"<div class='kera-card' style='padding:0.7rem 1rem'>"
                    f"<strong>{p['patient_id']}</strong> · "
                    f"{p['sex']} · {p['age']}{t(lang, '세', 'y')} · "
                    f"{visit_summary} · {t(lang, '최근', 'Last')}: {last_visit}"
                    f"</div>",
                    unsafe_allow_html=True,
                )
            with col2:
                if st.button(t(lang, "선택", "Select"), key=f"sel_{p['patient_id']}"):
                    st.session_state["wiz_patient"] = p
                    st.session_state["wiz_step"] = "visit"
                    st.rerun()

        if filtered:
            st.divider()

    # ── 신규 환자 등록
    with st.expander(t(lang, "➕ 신규 환자 등록", "➕ Register New Patient"), expanded=not patients):
        with st.form("new_patient_form"):
            pid = st.text_input(t(lang, "환자 ID *", "Patient ID *"), placeholder="P001")
            col_s, col_a = st.columns(2)
            with col_s:
                sex = st.selectbox(t(lang, "성별 *", "Sex *"), SEX_OPTIONS)
            with col_a:
                age = st.number_input(t(lang, "나이 *", "Age *"), min_value=1, max_value=120, value=50)
            if st.form_submit_button(t(lang, "등록 후 다음 단계", "Register & Continue"), use_container_width=True):
                try:
                    patient = site_store.create_patient(pid.strip(), sex, int(age))
                    st.session_state["wiz_patient"] = patient
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

    st.subheader(t(lang, "📋 방문 정보 입력", "📋 Enter Visit Details"))
    st.markdown(
        f"<div class='kera-chip complete'>👤 {patient['patient_id']} · {patient['sex']} · {patient['age']}{t(lang, '세', 'y')}</div>",
        unsafe_allow_html=True,
    )

    # 이전 방문 타임라인
    prev_visits = site_store.list_visits_for_patient(patient["patient_id"])
    if prev_visits:
        st.markdown(f"**{t(lang, '이전 방문 이력', 'Previous Visits')}**")
        timeline_html = "<div class='kera-chip-row'>"
        for v in sorted(prev_visits, key=lambda x: x["visit_date"]):
            cat_label = "🦠 " + v.get("culture_category", "").capitalize()
            stage = "🔴 " + t(lang, "활성기", "Active") if v.get("active_stage") else "🟢 " + t(lang, "회복", "Resolved")
            timeline_html += f"<span class='kera-chip'>{v['visit_date']} {cat_label} {stage}</span>"
        timeline_html += "</div>"
        st.markdown(timeline_html, unsafe_allow_html=True)
        st.markdown("")

    organisms = cp.list_organisms()
    bacterial_list = organisms.get("bacterial", []) if isinstance(organisms, dict) else []
    fungal_list = organisms.get("fungal", []) if isinstance(organisms, dict) else []

    with st.form("visit_form"):
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
            culture_species = st.selectbox(t(lang, "균종 *", "Species *"), species_list or ["Other"])

        col_cl, col_pf = st.columns(2)
        with col_cl:
            contact_lens_use = st.selectbox(t(lang, "콘택트렌즈 사용", "Contact Lens Use"), CONTACT_LENS_OPTIONS)
        with col_pf:
            predisposing_factor = st.multiselect(t(lang, "위험인자", "Predisposing Factors"), PREDISPOSING_FACTORS)

        active_stage = st.toggle(
            t(lang, "🔴 현재 활성기 (Active stage)", "🔴 Currently active stage"),
            value=True,
            help=t(lang, "활성기 케이스는 모델 학습 기여 대상입니다.", "Active stage cases are eligible for model training contribution."),
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
                visit = site_store.create_visit(
                    patient_id=patient["patient_id"],
                    visit_date=str(visit_date),
                    culture_confirmed=culture_confirmed,
                    culture_category=culture_category,
                    culture_species=culture_species,
                    contact_lens_use=contact_lens_use,
                    predisposing_factor=predisposing_factor,
                    other_history=other_history,
                    active_stage=active_stage,
                )
                st.session_state["wiz_visit"] = visit
                st.session_state["wiz_step"] = "images"
                st.rerun()
            except ValueError as exc:
                st.error(str(exc))


# ──────────────────────────────────────────────
# Step 3: Images
# ──────────────────────────────────────────────

def _step_images(site_store: SiteStore, lang: str) -> None:
    patient = st.session_state.get("wiz_patient")
    visit = st.session_state.get("wiz_visit")
    if not patient or not visit:
        st.session_state["wiz_step"] = "patient"
        st.rerun()
        return

    st.subheader(t(lang, "🖼 슬릿램프 이미지 업로드", "🖼 Upload Slit-lamp Images"))
    st.markdown(
        f"<div class='kera-chip-row'>"
        f"<span class='kera-chip complete'>👤 {patient['patient_id']}</span>"
        f"<span class='kera-chip complete'>📅 {visit['visit_date']}</span>"
        f"<span class='kera-chip complete'>🦠 {visit['culture_category'].capitalize()} · {visit['culture_species']}</span>"
        f"</div>",
        unsafe_allow_html=True,
    )

    st.info(
        t(
            lang,
            "white / slit / fluorescein 각 뷰를 여러 장 올릴 수 있습니다. view를 지정한 뒤 '업로드' 버튼을 누르세요.",
            "You can upload multiple images per view (white, slit, fluorescein). Assign views and press Upload.",
        )
    )

    uploaded_files = st.file_uploader(
        t(lang, "이미지 선택 (여러 장 가능)", "Select images (multiple allowed)"),
        accept_multiple_files=True,
        type=["jpg", "jpeg", "png", "bmp", "tiff"],
        key="image_uploader",
    )

    saved_images = st.session_state.get("wiz_images", [])

    if uploaded_files:
        st.markdown(f"**{t(lang, 'View 지정', 'Assign View')}**")
        pending: list[dict[str, Any]] = []
        for i, f in enumerate(uploaded_files):
            col_img, col_view, col_rep = st.columns([2, 2, 1])
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
            st.success(t(lang, f"{len(pending)}장 업로드 완료!", f"{len(pending)} image(s) uploaded!"))
            st.rerun()

    # 업로드된 이미지 목록
    if saved_images:
        st.markdown(f"**{t(lang, f'업로드 완료: {len(saved_images)}장', f'Uploaded: {len(saved_images)} image(s)')}**")
        cols = st.columns(min(len(saved_images), 4))
        for i, img in enumerate(saved_images):
            with cols[i % 4]:
                try:
                    st.image(img["image_path"], use_container_width=True)
                    st.caption(f"{img['view']} {'⭐' if img['is_representative'] else ''}")
                except Exception:
                    st.caption(img["image_path"])

    col_back, col_next = st.columns(2)
    with col_back:
        if st.button(t(lang, "← 이전", "← Back"), use_container_width=True):
            st.session_state["wiz_step"] = "visit"
            st.rerun()
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
        st.error(t(lang, "등록된 글로벌 모델이 없습니다.", "No global model registered."))
        return

    model_options = {m["version_id"]: f"{m['version_name']} ({m['architecture']})" for m in models}
    selected_model_id = st.selectbox(
        t(lang, "글로벌 모델 선택", "Select Global Model"),
        options=list(model_options.keys()),
        format_func=lambda x: model_options[x],
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
                project_id = cp.list_projects()[0]["project_id"] if cp.list_projects() else "default"
                summary, case_preds = workflow.run_case_validation(
                    project_id=project_id,
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

    col1, col2, col3 = st.columns(3)
    with col1:
        label_ko = "세균성" if pred_label == "bacterial" else "진균성"
        label_en = pred_label.capitalize()
        st.metric(
            t(lang, "AI 예측", "AI Prediction"),
            t(lang, label_ko, label_en),
        )
    with col2:
        st.metric(t(lang, "신뢰도", "Confidence"), f"{prob * 100:.1f}%")
    with col3:
        result_ko = "✅ 일치" if is_correct else "❌ 불일치"
        result_en = "✅ Correct" if is_correct else "❌ Incorrect"
        st.metric(t(lang, "Culture 결과와", "vs Culture"), t(lang, result_ko, result_en))

    # 확률 바
    bar_color = "#0d8f8a" if pred_label == "bacterial" else "#d6b468"
    st.markdown(
        f"<div style='background:#e8f6f5;border-radius:999px;height:12px;margin:0.5rem 0'>"
        f"<div style='background:{bar_color};width:{prob*100:.1f}%;height:100%;border-radius:999px'></div>"
        f"</div>"
        f"<div style='display:flex;justify-content:space-between;font-size:0.8rem;color:var(--kera-muted)'>"
        f"<span>Bacterial</span><span>Fungal</span></div>",
        unsafe_allow_html=True,
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

    st.subheader(t(lang, "🧠 시각화 결과", "🧠 Visualization"))

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

    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown(f"**{t(lang, '원본 대표 이미지', 'Original (Representative)')}**")
        if rep_path and Path(rep_path).exists():
            st.image(rep_path, use_container_width=True)
        else:
            st.info(t(lang, "이미지를 불러올 수 없습니다.", "Image not available."))

    with col2:
        st.markdown(f"**{t(lang, 'MedSAM ROI Crop', 'MedSAM ROI Crop')}**")
        if roi_crop_path and Path(roi_crop_path).exists():
            st.image(roi_crop_path, use_container_width=True)
            st.caption(t(lang, "각막 ROI 자동 크롭", "Auto-cropped corneal ROI"))
        else:
            st.info(t(lang, "ROI 크롭 결과 없음", "No ROI crop available"))

    with col3:
        st.markdown(f"**{t(lang, 'Grad-CAM 히트맵', 'Grad-CAM Heatmap')}**")
        if gradcam_path and Path(gradcam_path).exists():
            st.image(gradcam_path, use_container_width=True)
            st.caption(t(lang, "모델이 주목한 영역 (빨강 = 고영향)", "Model attention (red = high impact)"))
        else:
            st.info(t(lang, "Grad-CAM 결과 없음", "No Grad-CAM available"))

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

    is_active = visit.get("active_stage", False) if visit else False
    if is_active:
        st.success(
            t(
                lang,
                "🔴 이 케이스는 **활성기(active stage)**로 표시되어 있습니다. 학습 기여 시 모델 개선에 직접 반영됩니다.",
                "🔴 This case is marked as **active stage**. Your contribution will directly improve the model.",
            )
        )
    else:
        st.info(
            t(
                lang,
                "이 케이스는 회복기로 표시되어 있습니다. 학습에 기여하셔도 좋습니다.",
                "This case is marked as resolved. You can still contribute it to training.",
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
        )
    with col_no:
        skip_btn = st.button(
            t(lang, "➡ 기여 없이 저장", "➡ Save without Contributing"),
            use_container_width=True,
            key="btn_contribute_no",
        )

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
<div style='text-align:center;padding:2rem 0'>
  <div style='font-size:3rem'>🎉</div>
  <div style='font-size:1.6rem;font-weight:900;color:var(--kera-accent);margin:0.5rem 0'>
    {t(lang, f'감사합니다, {name} 선생님!', f'Thank you, Dr. {name}!')}
  </div>
  <div style='color:var(--kera-muted);font-size:1rem'>
    {t(lang, '이 케이스가 글로벌 모델 개선에 기여됩니다.', 'This case will contribute to improving the global model.')}
  </div>
</div>
""",
            unsafe_allow_html=True,
        )
    else:
        st.markdown(
            f"""
<div style='text-align:center;padding:2rem 0'>
  <div style='font-size:3rem'>✅</div>
  <div style='font-size:1.6rem;font-weight:900;color:var(--kera-ink);margin:0.5rem 0'>
    {t(lang, '케이스가 저장되었습니다', 'Case Saved')}
  </div>
</div>
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

def _render_dashboard(cp: ControlPlaneStore, user: dict[str, Any], lang: str) -> None:
    st.title(t(lang, "📊 대시보드", "📊 Dashboard"))

    site_id = st.session_state.get("wiz_site_id")
    site_store = _get_site_store(site_id)

    stats = cp.get_contribution_stats(user_id=user["user_id"])

    # 전체 통계
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

    if site_store:
        patients = site_store.list_patients()
        visits = site_store.list_visits()

        st.markdown(f"### {t(lang, '사이트 데이터 현황', 'Site Data')}")
        sc1, sc2, sc3 = st.columns(3)
        with sc1:
            st.metric(t(lang, "등록 환자", "Patients"), len(patients))
        with sc2:
            st.metric(t(lang, "총 방문", "Visits"), len(visits))
        with sc3:
            active = sum(1 for v in visits if v.get("active_stage"))
            st.metric(t(lang, "활성기 방문", "Active Stage Visits"), active)

        # 최근 검증 이력
        validation_runs = cp.list_validation_runs(site_id=site_id)
        if validation_runs:
            st.markdown(f"### {t(lang, '최근 검증 이력', 'Recent Validations')}")
            df = pd.DataFrame(validation_runs[-20:][::-1])
            display_cols = ["run_date", "patient_id", "visit_date", "predicted_label", "true_label", "is_correct", "model_version"]
            existing_cols = [c for c in display_cols if c in df.columns]
            st.dataframe(df[existing_cols], use_container_width=True, hide_index=True)

        # Culture 분포
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

    # 내 기여 이력
    my_contribs = cp.list_contributions(user_id=user["user_id"])
    if my_contribs:
        st.markdown(f"### {t(lang, '내 기여 이력', 'My Contribution History')}")
        df_c = pd.DataFrame(my_contribs[-10:][::-1])
        st.dataframe(df_c[["created_at", "patient_id", "visit_date", "site_id"]], use_container_width=True, hide_index=True)


# ──────────────────────────────────────────────
# Admin panel
# ──────────────────────────────────────────────

def _render_admin_import(cp: ControlPlaneStore, workflow: ResearchWorkflowService | None, lang: str) -> None:
    """기존 원본 이미지 + CSV 메타데이터를 일괄 임포트합니다."""
    st.markdown(f"### {t(lang, '기존 데이터 일괄 임포트', 'Bulk Data Import')}")
    st.info(
        t(
            lang,
            "원본 이미지와 CSV 메타데이터를 함께 업로드하면 환자/방문/이미지를 자동 등록합니다.\n\n"
            "① CSV 템플릿 다운로드 → ② Excel에서 메타데이터 입력 → ③ CSV + 이미지 ZIP 업로드",
            "Upload raw images with a CSV metadata file to auto-register patients, visits, and images.\n\n"
            "① Download CSV template → ② Fill in metadata in Excel → ③ Upload CSV + image ZIP",
        )
    )

    sites = cp.list_sites()
    if not sites:
        st.warning(t(lang, "먼저 사이트를 등록하세요.", "Register a site first."))
        return

    site_options = {s["site_id"]: f"{s['display_name']} ({s['site_id']})" for s in sites}
    import_site_id = st.selectbox(
        t(lang, "임포트할 사이트", "Target Site"),
        options=list(site_options.keys()),
        format_func=lambda x: site_options[x],
        key="import_site_select",
    )

    # CSV 템플릿 다운로드
    import io
    template_rows = [
        "patient_id,sex,age,visit_date,culture_confirmed,culture_category,culture_species,"
        "contact_lens_use,predisposing_factor,active_stage,other_history,image_filename,view,is_representative",
        "P001,female,45,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
        "none,trauma,TRUE,,P001_2026-01-10_white.jpg,white,TRUE",
        "P001,female,45,2026-01-10,TRUE,bacterial,Pseudomonas aeruginosa,"
        "none,trauma,TRUE,,P001_2026-01-10_slit.jpg,slit,FALSE",
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
                    site_store = SiteStore(import_site_id)

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
                                    active_stage=str(row.get("active_stage", "TRUE")).upper() == "TRUE",
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
    cp: ControlPlaneStore, workflow: ResearchWorkflowService | None, lang: str
) -> None:
    """사이트 전체 데이터로 DenseNet 초기 학습을 수행합니다."""
    st.markdown(f"### {t(lang, '초기 학습 (Train from Scratch)', 'Initial Training (from Scratch)')}")

    if workflow is None:
        st.error(t(lang, "AI 모듈이 준비되지 않았습니다.", "AI module not ready."))
        return

    sites = cp.list_sites()
    if not sites:
        st.warning(t(lang, "사이트를 먼저 등록하세요.", "Register a site first."))
        return

    site_options = {s["site_id"]: f"{s['display_name']} ({s['site_id']})" for s in sites}
    train_site_id = st.selectbox(
        t(lang, "학습 데이터 사이트", "Training Data Site"),
        options=list(site_options.keys()),
        format_func=lambda x: site_options[x],
        key="train_site_select",
    )
    site_store = SiteStore(train_site_id)
    manifest_df = site_store.load_manifest()
    n_total = len(manifest_df)
    n_patients = manifest_df["patient_id"].nunique() if not manifest_df.empty else 0

    st.markdown(
        f"<div class='kera-stat-grid'>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '전체 이미지', 'Total Images')}</div>"
        f"<div class='kera-stat-value'>{n_total}</div></div>"
        f"<div class='kera-stat-card'><div class='kera-stat-label'>{t(lang, '환자 수', 'Patients')}</div>"
        f"<div class='kera-stat-value'>{n_patients}</div></div>"
        f"</div>",
        unsafe_allow_html=True,
    )

    if n_total < 4:
        st.warning(t(lang, "학습에 최소 4개 이미지가 필요합니다. 먼저 데이터를 임포트하세요.", "At least 4 images required. Import data first."))
        return

    st.divider()
    st.markdown(f"**{t(lang, '학습 설정', 'Training Configuration')}**")

    from kera_research.domain import DENSENET_VARIANTS
    col1, col2 = st.columns(2)
    with col1:
        architecture = st.selectbox(
            t(lang, "모델 구조", "Architecture"),
            DENSENET_VARIANTS,
            index=0,
            help=t(lang, "모델 파일이 없으면 121을 권장합니다. 161이면 성능이 좋지만 느립니다.", "121 recommended if unsure. 161 is stronger but slower."),
        )
        epochs = st.slider(t(lang, "에포크", "Epochs"), 5, 100, 30)
        val_split = st.slider(t(lang, "Validation 비율", "Validation Split"), 0.1, 0.4, 0.2, 0.05)
    with col2:
        use_pretrained = st.toggle(
            t(lang, "ImageNet 초기화 사용 (권장)", "Use ImageNet pretrained weights (recommended)"),
            value=True,
        )
        use_medsam = st.toggle(
            t(lang, "MedSAM crop 이미지로 학습", "Train on MedSAM crop images"),
            value=True,
            help=t(lang, "추론 시와 동일한 전처리 사용 (권장)", "Use same preprocessing as inference (recommended)"),
        )
        lr = st.select_slider(
            t(lang, "학습률", "Learning Rate"),
            options=[1e-5, 5e-5, 1e-4, 5e-4, 1e-3],
            value=1e-4,
            format_func=lambda x: f"{x:.0e}",
        )
        batch_size = st.select_slider(t(lang, "배치 크기", "Batch Size"), options=[4, 8, 16, 32], value=16)

    hw = detect_hardware()
    exec_mode = st.radio(t(lang, "실행 모드", "Execution Mode"), EXECUTION_MODES, horizontal=True)
    device = resolve_execution_mode(exec_mode, hw)

    if not hw["cuda_available"] and batch_size > 8:
        st.warning(t(lang, "CPU 환경에서는 배치 크기 8 이하를 권장합니다.", "Batch size ≤ 8 recommended on CPU."))

    from kera_research.config import MODEL_DIR
    from kera_research.domain import make_id
    output_path = str(MODEL_DIR / f"global_{architecture}_{make_id('init')[:8]}.pth")

    if st.button(t(lang, "🚀 초기 학습 시작", "🚀 Start Initial Training"), type="primary", key="btn_initial_train"):
        progress_bar = st.progress(0)
        status_text = st.empty()
        chart_placeholder = st.empty()
        history_store: list[dict[str, Any]] = []

        def on_progress(epoch: int, total: int, train_loss: float, val_acc: float) -> None:
            pct = epoch / total
            progress_bar.progress(pct)
            status_text.markdown(
                f"**Epoch {epoch}/{total}** — "
                f"train loss: `{train_loss:.4f}` — "
                f"val acc: `{val_acc*100:.1f}%`"
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
                use_pretrained=use_pretrained,
                use_medsam_crops=use_medsam,
                progress_callback=on_progress,
            )
            progress_bar.progress(1.0)
            st.success(
                t(
                    lang,
                    f"✅ 학습 완료!\n\n"
                    f"- 모델명: **{result['version_name']}**\n"
                    f"- Train: {result['n_train']}건 / Val: {result['n_val']}건\n"
                    f"- 최고 Val Accuracy: **{result['best_val_acc']*100:.1f}%**\n"
                    f"- 저장 경로: `{result['output_model_path']}`",
                    f"✅ Training complete!\n\n"
                    f"- Model: **{result['version_name']}**\n"
                    f"- Train: {result['n_train']} / Val: {result['n_val']}\n"
                    f"- Best Val Accuracy: **{result['best_val_acc']*100:.1f}%**\n"
                    f"- Saved to: `{result['output_model_path']}`",
                )
            )
        except Exception as exc:
            st.error(f"{t(lang, '학습 오류:', 'Training error:')} {exc}")


def _render_admin(cp: ControlPlaneStore, workflow: ResearchWorkflowService | None, lang: str) -> None:
    st.title(t(lang, "⚙️ 관리자 패널", "⚙️ Admin Panel"))

    tab_import, tab_train, tab_model, tab_sites, tab_organisms, tab_federated = st.tabs([
        t(lang, "📥 데이터 임포트", "📥 Import Data"),
        t(lang, "🧠 초기 학습", "🧠 Initial Training"),
        t(lang, "모델 관리", "Models"),
        t(lang, "사이트 관리", "Sites"),
        t(lang, "균종 관리", "Organisms"),
        t(lang, "Federated 집계", "Federated Aggregation"),
    ])

    with tab_import:
        _render_admin_import(cp, workflow, lang)

    with tab_train:
        _render_admin_initial_training(cp, workflow, lang)

    with tab_model:
        st.markdown(f"#### {t(lang, '등록된 모델 버전', 'Registered Model Versions')}")
        versions = cp.list_model_versions()
        if versions:
            df = pd.DataFrame(versions)
            cols = [c for c in ["version_name", "architecture", "stage", "ready", "created_at", "notes_ko"] if c in df.columns]
            st.dataframe(df[cols], use_container_width=True, hide_index=True)

        st.markdown(f"#### {t(lang, '대기 중 업데이트', 'Pending Updates')}")
        pending = [u for u in cp.list_model_updates() if u.get("status") == "pending_upload"]
        if pending:
            df_p = pd.DataFrame(pending)
            st.dataframe(df_p[["update_id", "site_id", "architecture", "created_at", "n_cases"]], use_container_width=True, hide_index=True)
        else:
            st.info(t(lang, "대기 중인 업데이트가 없습니다.", "No pending updates."))

    with tab_sites:
        st.markdown(f"#### {t(lang, '등록된 사이트', 'Registered Sites')}")
        sites = cp.list_sites()
        if sites:
            st.dataframe(pd.DataFrame(sites), use_container_width=True, hide_index=True)

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
        pending_deltas = [u for u in all_updates if u.get("status") == "pending_upload"]
        if pending_deltas:
            st.markdown(f"**{t(lang, f'집계 가능 업데이트: {len(pending_deltas)}개', f'Aggregatable updates: {len(pending_deltas)}')}**")
            df_d = pd.DataFrame(pending_deltas)
            st.dataframe(df_d[["update_id", "site_id", "architecture", "n_cases", "created_at"]], use_container_width=True, hide_index=True)
            if workflow and st.button(t(lang, "🔗 FedAvg 집계 실행", "🔗 Run FedAvg Aggregation"), type="primary"):
                try:
                    delta_paths = [u["artifact_path"] for u in pending_deltas]
                    arch = pending_deltas[0]["architecture"]
                    base_model = next(
                        (m for m in cp.list_model_versions() if m["version_id"] == pending_deltas[0]["base_model_version_id"]),
                        cp.current_global_model(),
                    )
                    from kera_research.config import MODEL_DIR
                    from kera_research.domain import make_id
                    out_path = MODEL_DIR / f"global_{arch}_{make_id('agg')}.pth"
                    workflow.model_manager.aggregate_weight_deltas(delta_paths, out_path)
                    site_weights = {u["site_id"]: u.get("n_cases", 1) for u in pending_deltas}
                    new_version_name = f"global-{arch}-fedavg-{make_id('v')[:6]}"
                    cp.register_aggregation(
                        base_model_version_id=base_model["version_id"],
                        new_model_path=str(out_path),
                        new_version_name=new_version_name,
                        architecture=arch,
                        site_weights=site_weights,
                    )
                    # 집계된 업데이트 상태 변경
                    for u in pending_deltas:
                        u["status"] = "aggregated"
                    import json
                    (cp.root / "model_updates.json").write_text(
                        json.dumps(all_updates, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    st.success(t(lang, f"✅ 집계 완료! 새 모델: {new_version_name}", f"✅ Aggregation done! New model: {new_version_name}"))
                    st.rerun()
                except Exception as exc:
                    st.error(str(exc))
        else:
            st.info(t(lang, "집계할 업데이트가 없습니다.", "No updates available for aggregation."))

        st.markdown(f"#### {t(lang, '집계 이력', 'Aggregation History')}")
        from kera_research.storage import read_json
        aggs = read_json(cp.aggregations_path, [])
        if aggs:
            st.dataframe(pd.DataFrame(aggs), use_container_width=True, hide_index=True)


# ──────────────────────────────────────────────
# CSS
# ──────────────────────────────────────────────

def _inject_css(theme: str) -> None:
    if theme == "dark":
        theme_vars = """
        :root {
            --kera-ink: #e8eff7;
            --kera-muted: #bfd0df;
            --kera-accent: #59d0c9;
            --kera-accent-soft: rgba(89, 208, 201, 0.12);
            --kera-warm: #1f2a35;
            --kera-card: rgba(19, 29, 40, 0.92);
            --kera-border: rgba(232, 239, 247, 0.10);
            --kera-bg-top: #121a23;
            --kera-bg-bottom: #0d131a;
            --kera-shadow: rgba(0, 0, 0, 0.28);
            --kera-input: rgba(18, 26, 35, 0.92);
            --kera-sidebar: rgba(11, 18, 26, 0.92);
            --kera-footer: rgba(14, 22, 32, 0.96);
            --kera-danger-bg: rgba(96, 28, 28, 0.18);
            --kera-danger-ink: #ffd3d3;
        }
        """
    else:
        theme_vars = """
        :root {
            --kera-ink: #17324d;
            --kera-muted: #4d6277;
            --kera-accent: #0d8f8a;
            --kera-accent-soft: #e8f6f5;
            --kera-warm: #f6f1e8;
            --kera-card: rgba(255, 255, 255, 0.90);
            --kera-border: rgba(23, 50, 77, 0.10);
            --kera-bg-top: #f4f7fb;
            --kera-bg-bottom: #eef4f2;
            --kera-shadow: rgba(23, 50, 77, 0.06);
            --kera-input: rgba(255, 255, 255, 0.95);
            --kera-sidebar: rgba(245, 249, 252, 0.94);
            --kera-footer: rgba(255, 255, 255, 0.96);
            --kera-danger-bg: #f7dede;
            --kera-danger-ink: #8a2f2f;
        }
        """

    css = (
        "<style>"
        + theme_vars
        + """
        .stApp {
            background:
                radial-gradient(circle at top right, rgba(13, 143, 138, 0.10), transparent 26%),
                radial-gradient(circle at top left, rgba(214, 180, 104, 0.12), transparent 24%),
                linear-gradient(180deg, var(--kera-bg-top) 0%, var(--kera-bg-bottom) 100%);
            color: var(--kera-ink);
            font-family: "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
        }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, var(--kera-sidebar), rgba(255,255,255,0.02));
            border-right: 1px solid var(--kera-border);
        }
        [data-testid="stSidebar"] * { color: var(--kera-ink) !important; }
        .stApp h1,.stApp h2,.stApp h3,.stApp h4,.stApp h5,.stApp h6,
        .stApp p,.stApp label,.stApp span,
        .stApp div[data-testid="stMarkdownContainer"],
        .stApp div[data-testid="stMarkdownContainer"] p,
        .stApp div[data-testid="stMarkdownContainer"] li,
        .stApp div[data-testid="stWidgetLabel"],
        .stApp [data-testid="stAlertContainer"],
        .stApp [data-testid="stRadio"] p { color: var(--kera-ink) !important; }
        .stApp [data-testid="stCaptionContainer"] { color: var(--kera-muted) !important; }
        [data-testid="stMetric"] {
            background: var(--kera-card);
            border: 1px solid var(--kera-border);
            border-radius: 18px;
            padding: 0.8rem 0.9rem;
            box-shadow: 0 10px 24px var(--kera-shadow);
        }
        .stButton > button {
            border-radius: 999px;
            border: 1px solid var(--kera-border);
            background: linear-gradient(135deg, var(--kera-accent), #2fa9a3);
            color: white;
            font-weight: 700;
        }
        .stButton > button:hover { filter: brightness(1.04); color: white; }
        .stSelectbox > div > div,
        .stTextInput > div > div > input,
        .stTextArea textarea,
        .stDateInput > div > div input,
        .stNumberInput input,
        .stMultiSelect > div > div {
            background: var(--kera-input);
            color: var(--kera-ink);
        }
        .kera-card {
            background: var(--kera-card);
            border: 1px solid var(--kera-border);
            border-radius: 18px;
            padding: 0.95rem 1rem;
            box-shadow: 0 10px 28px var(--kera-shadow);
            margin-bottom: 0.5rem;
        }
        .kera-stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 0.75rem;
            margin: 0.4rem 0 0.8rem 0;
        }
        .kera-stat-card {
            background: var(--kera-card);
            border: 1px solid var(--kera-border);
            border-radius: 18px;
            padding: 0.9rem 1rem;
            box-shadow: 0 10px 24px var(--kera-shadow);
        }
        .kera-stat-label { color: var(--kera-muted); font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
        .kera-stat-value { color: var(--kera-ink); font-size: 1.45rem; font-weight: 800; margin-top: 0.25rem; }
        .kera-stat-note { color: var(--kera-muted); font-size: 0.82rem; margin-top: 0.2rem; }
        .kera-chip-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.4rem 0 0.8rem 0; }
        .kera-chip {
            display: inline-flex; align-items: center; gap: 0.35rem;
            border-radius: 999px; padding: 0.35rem 0.7rem;
            background: rgba(255,255,255,0.72);
            border: 1px solid var(--kera-border);
            color: var(--kera-ink); font-size: 0.88rem; font-weight: 600;
        }
        .kera-chip.complete { background: rgba(13, 143, 138, 0.12); color: #0b6c68; }
        .kera-chip.pending { background: rgba(214, 180, 104, 0.16); color: #8a6531; }
        .kera-sidebar-user {
            background: var(--kera-footer); border: 1px solid var(--kera-border);
            border-radius: 16px; padding: 0.9rem 1rem; margin-bottom: 0.8rem;
            box-shadow: 0 10px 24px var(--kera-shadow);
        }
        .kera-sidebar-user h4 { margin: 0 0 0.2rem 0; color: var(--kera-ink); font-size: 0.98rem; }
        .kera-sidebar-user p { margin: 0; color: var(--kera-muted); font-size: 0.88rem; }
        .stAlert { color: var(--kera-ink); }
        @media (max-width: 640px) {
            .kera-stat-value { font-size: 1.25rem; }
        }
        </style>"""
    )
    st.markdown(css, unsafe_allow_html=True)
