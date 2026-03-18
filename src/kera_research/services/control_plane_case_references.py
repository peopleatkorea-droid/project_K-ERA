from __future__ import annotations

from typing import Any

from kera_research.config import CASE_REFERENCE_SALT, PATIENT_REFERENCE_SALT
from kera_research.domain import make_case_reference_id, make_patient_reference_id, visit_index_from_label


class ControlPlaneCaseReferenceFacade:
    def case_reference_id(self, site_id: str, patient_id: str, visit_date: str) -> str:
        return make_case_reference_id(site_id, patient_id, visit_date, CASE_REFERENCE_SALT)

    def patient_reference_id(self, site_id: str, patient_id: str) -> str:
        return make_patient_reference_id(site_id, patient_id, PATIENT_REFERENCE_SALT)

    def normalize_case_reference(self, record: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(record)
        site_id = str(normalized.get("site_id") or "").strip()
        patient_id = str(normalized.get("patient_id") or "").strip()
        visit_date = str(normalized.get("visit_date") or "").strip()
        patient_reference_id = str(normalized.get("patient_reference_id") or "").strip()
        visit_index = normalized.get("visit_index")
        case_reference_id = str(normalized.get("case_reference_id") or "").strip()

        if not patient_reference_id and site_id and patient_id:
            patient_reference_id = self.patient_reference_id(site_id, patient_id)
            normalized["patient_reference_id"] = patient_reference_id
        if visit_index is None and visit_date:
            normalized["visit_index"] = visit_index_from_label(visit_date)
        if not case_reference_id and site_id and patient_id and visit_date:
            case_reference_id = self.case_reference_id(site_id, patient_id, visit_date)
            normalized["case_reference_id"] = case_reference_id

        normalized.pop("patient_id", None)
        normalized.pop("visit_date", None)

        approval_report = normalized.get("approval_report")
        if isinstance(approval_report, dict):
            report = dict(approval_report)
            report_site_id = str(report.get("site_id") or site_id).strip()
            report_patient_id = str(report.get("patient_id") or patient_id).strip()
            report_visit_date = str(report.get("visit_date") or visit_date).strip()
            report_patient_reference_id = str(report.get("patient_reference_id") or patient_reference_id).strip()
            report_case_reference_id = str(report.get("case_reference_id") or case_reference_id).strip()
            report_visit_index = report.get("visit_index", normalized.get("visit_index"))
            if not report_patient_reference_id and report_site_id and report_patient_id:
                report_patient_reference_id = self.patient_reference_id(report_site_id, report_patient_id)
            if not report_case_reference_id and report_site_id and report_patient_id and report_visit_date:
                report_case_reference_id = self.case_reference_id(
                    report_site_id,
                    report_patient_id,
                    report_visit_date,
                )
            if report_visit_index is None and report_visit_date:
                report_visit_index = visit_index_from_label(report_visit_date)
            if report_patient_reference_id:
                report["patient_reference_id"] = report_patient_reference_id
            if report_case_reference_id:
                report["case_reference_id"] = report_case_reference_id
            if report_visit_index is not None:
                report["visit_index"] = int(report_visit_index)
            report.pop("patient_id", None)
            report.pop("visit_date", None)
            normalized["approval_report"] = report

        return normalized

    def normalize_validation_record(self, site_id: str, record: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(record)
        patient_id = str(normalized.get("patient_id") or "").strip()
        visit_date = str(normalized.get("visit_date") or "").strip()
        patient_reference_id = str(normalized.get("patient_reference_id") or "").strip()
        visit_index = normalized.get("visit_index")
        case_reference_id = str(normalized.get("case_reference_id") or "").strip()
        if not patient_reference_id and site_id and patient_id:
            normalized["patient_reference_id"] = self.patient_reference_id(site_id, patient_id)
        if visit_index is None and visit_date:
            normalized["visit_index"] = visit_index_from_label(visit_date)
        if not case_reference_id and site_id and patient_id and visit_date:
            normalized["case_reference_id"] = self.case_reference_id(site_id, patient_id, visit_date)
        normalized.pop("patient_id", None)
        normalized.pop("visit_date", None)
        return normalized
