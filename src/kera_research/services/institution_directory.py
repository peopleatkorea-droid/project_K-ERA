from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

import requests

from kera_research.config import HIRA_API_KEY, HIRA_API_TIMEOUT_SECONDS, HIRA_HOSPITAL_INFO_URL
from kera_research.domain import utc_now

HIRA_OPHTHALMOLOGY_SPECIALTY_CODE = "12"


class HiraApiError(RuntimeError):
    pass


@dataclass(slots=True)
class HiraInstitutionPage:
    page_no: int
    num_rows: int
    total_count: int
    items: list[dict[str, Any]]


def _pick_text(mapping: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = mapping.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    lowered = {str(key).lower(): value for key, value in mapping.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _coerce_items(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _normalize_hira_institution(item: dict[str, Any]) -> dict[str, Any]:
    institution_id = _pick_text(item, "ykiho")
    if not institution_id:
        raise HiraApiError("HIRA response item is missing ykiho.")
    return {
        "institution_id": institution_id,
        "source": "hira",
        "name": _pick_text(item, "yadmNm"),
        "institution_type_code": _pick_text(item, "clCd"),
        "institution_type_name": _pick_text(item, "clCdNm"),
        "address": _pick_text(item, "addr"),
        "phone": _pick_text(item, "telno"),
        "homepage": _pick_text(item, "hospUrl"),
        "sido_code": _pick_text(item, "sidoCd"),
        "sggu_code": _pick_text(item, "sgguCd"),
        "emdong_name": _pick_text(item, "emdongNm"),
        "postal_code": _pick_text(item, "postNo"),
        "x_pos": _pick_text(item, "XPos", "xPos"),
        "y_pos": _pick_text(item, "YPos", "yPos"),
        "ophthalmology_available": True,
        "open_status": "active",
        "source_payload": dict(item),
        "synced_at": utc_now(),
    }


def _extract_xml_text(root: ET.Element, path: str) -> str:
    node = root.find(path)
    if node is None or node.text is None:
        return ""
    return node.text.strip()


class HiraInstitutionDirectoryClient:
    def __init__(
        self,
        service_key: str | None = None,
        *,
        session: requests.Session | None = None,
        base_url: str = HIRA_HOSPITAL_INFO_URL,
        timeout_seconds: float = HIRA_API_TIMEOUT_SECONDS,
    ) -> None:
        self.service_key = (service_key or HIRA_API_KEY).strip()
        self.session = session or requests.Session()
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds

    def fetch_by_ykiho(self, ykiho: str) -> dict[str, Any] | None:
        """Fetch a single institution by HIRA ykiho code. Returns None if not found or on error."""
        if not self.service_key:
            return None
        try:
            response = self.session.get(
                self.base_url,
                params={
                    "serviceKey": self.service_key,
                    "pageNo": "1",
                    "numOfRows": "1",
                    "ykiho": ykiho,
                    "_type": "json",
                },
                timeout=self.timeout_seconds,
            )
            if response.status_code >= 400:
                return None
            text = response.text.lstrip()
            if "json" in (response.headers.get("content-type") or "").lower() or text.startswith("{"):
                page = self._parse_json_page(response.json(), page_no=1, num_rows=1)
            elif text.startswith("<"):
                page = self._parse_xml_page(text, page_no=1, num_rows=1)
            else:
                return None
            return page.items[0] if page.items else None
        except Exception:
            return None

    def fetch_ophthalmology_page(
        self,
        *,
        page_no: int = 1,
        num_rows: int = 100,
    ) -> HiraInstitutionPage:
        if not self.service_key:
            raise HiraApiError("KERA_HIRA_API_KEY is not configured.")

        response = self.session.get(
            self.base_url,
            params={
                "serviceKey": self.service_key,
                "pageNo": str(page_no),
                "numOfRows": str(num_rows),
                "dgsbjtCd": HIRA_OPHTHALMOLOGY_SPECIALTY_CODE,
                "_type": "json",
            },
            timeout=self.timeout_seconds,
        )

        if response.status_code == 401:
            raise HiraApiError(
                "HIRA API returned 401 Unauthorized. In data.go.kr this usually means the Open API "
                "application has not been approved yet, approval has not propagated, or the key is not "
                "active for this service."
            )
        if response.status_code >= 400:
            snippet = response.text.strip().replace("\n", " ")[:240]
            raise HiraApiError(f"HIRA API request failed with HTTP {response.status_code}: {snippet}")

        text = response.text.lstrip()
        if "json" in (response.headers.get("content-type") or "").lower() or text.startswith("{"):
            payload = response.json()
            return self._parse_json_page(payload, page_no=page_no, num_rows=num_rows)
        if text.startswith("<"):
            return self._parse_xml_page(text, page_no=page_no, num_rows=num_rows)
        raise HiraApiError("Unexpected HIRA response format.")

    def iter_ophthalmology_records(
        self,
        *,
        num_rows: int = 100,
        max_pages: int | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, int]]:
        collected: list[dict[str, Any]] = []
        page_no = 1
        pages_synced = 0
        total_count = 0

        while True:
            page = self.fetch_ophthalmology_page(page_no=page_no, num_rows=num_rows)
            total_count = max(total_count, page.total_count)
            if not page.items:
                break
            collected.extend(page.items)
            pages_synced += 1
            if max_pages is not None and pages_synced >= max_pages:
                break
            if page.total_count and page_no * num_rows >= page.total_count:
                break
            page_no += 1

        return collected, {
            "pages_synced": pages_synced,
            "total_count": total_count,
        }

    def _parse_json_page(self, payload: dict[str, Any], *, page_no: int, num_rows: int) -> HiraInstitutionPage:
        response = payload.get("response")
        if not isinstance(response, dict):
            raise HiraApiError("HIRA JSON response is missing the top-level response object.")
        header = response.get("header") or {}
        result_code = _pick_text(header, "resultCode")
        result_message = _pick_text(header, "resultMsg")
        if result_code and result_code != "00":
            raise HiraApiError(f"HIRA API returned resultCode={result_code}: {result_message or 'Unknown error'}")
        body = response.get("body") or {}
        raw_items = body.get("items")
        if isinstance(raw_items, dict):
            raw_items = raw_items.get("item")
        items = [_normalize_hira_institution(item) for item in _coerce_items(raw_items)]
        total_count_text = _pick_text(body, "totalCount")
        try:
            total_count = int(total_count_text) if total_count_text else len(items)
        except ValueError:
            total_count = len(items)
        return HiraInstitutionPage(page_no=page_no, num_rows=num_rows, total_count=total_count, items=items)

    def _parse_xml_page(self, payload_text: str, *, page_no: int, num_rows: int) -> HiraInstitutionPage:
        try:
            root = ET.fromstring(payload_text)
        except ET.ParseError as exc:
            raise HiraApiError("Unable to parse HIRA XML response.") from exc

        result_code = _extract_xml_text(root, ".//header/resultCode")
        result_message = _extract_xml_text(root, ".//header/resultMsg")
        if result_code and result_code != "00":
            raise HiraApiError(f"HIRA API returned resultCode={result_code}: {result_message or 'Unknown error'}")

        items: list[dict[str, Any]] = []
        for item_node in root.findall(".//body/items/item"):
            item_payload = {child.tag: (child.text or "").strip() for child in item_node}
            items.append(_normalize_hira_institution(item_payload))

        total_count_text = _extract_xml_text(root, ".//body/totalCount")
        try:
            total_count = int(total_count_text) if total_count_text else len(items)
        except ValueError:
            total_count = len(items)
        return HiraInstitutionPage(page_no=page_no, num_rows=num_rows, total_count=total_count, items=items)
