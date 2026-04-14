from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.institution_directory import HiraApiError, HiraInstitutionDirectoryClient


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        text: str = "",
        json_payload: dict | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self.text = text
        self._json_payload = json_payload

    def json(self) -> dict:
        if self._json_payload is None:
            raise ValueError("No JSON payload configured.")
        return self._json_payload


class FakeSession:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.calls: list[dict[str, object]] = []

    def get(self, url: str, *, params: dict[str, str], timeout: float) -> FakeResponse:
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        return self.response


class InstitutionDirectoryClientTests(unittest.TestCase):
    def test_fetch_json_page_normalizes_hira_records(self) -> None:
        payload = {
            "response": {
                "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
                "body": {
                    "totalCount": 1,
                    "items": {
                        "item": {
                            "ykiho": "A1234567",
                            "yadmNm": "Kim Eye Clinic",
                            "clCd": "31",
                            "clCdNm": "Clinic",
                            "addr": "Seoul",
                            "telno": "02-123-4567",
                            "sidoCd": "11",
                            "sgguCd": "680",
                            "emdongNm": "Gangnam",
                        }
                    },
                },
            }
        }
        session = FakeSession(
            FakeResponse(
                headers={"content-type": "application/json"},
                text="{}",
                json_payload=payload,
            )
        )
        client = HiraInstitutionDirectoryClient("test-key", session=session)

        page = client.fetch_ophthalmology_page(page_no=1, num_rows=10)

        self.assertEqual(page.total_count, 1)
        self.assertEqual(len(page.items), 1)
        self.assertEqual(page.items[0]["institution_id"], "A1234567")
        self.assertEqual(page.items[0]["name"], "Kim Eye Clinic")
        self.assertEqual(page.items[0]["institution_type_name"], "Clinic")
        self.assertEqual(session.calls[0]["params"]["dgsbjtCd"], "12")

    def test_unauthorized_response_raises_clear_error(self) -> None:
        session = FakeSession(FakeResponse(status_code=401, text="Unauthorized"))
        client = HiraInstitutionDirectoryClient("test-key", session=session)

        with self.assertRaises(HiraApiError) as raised:
            client.fetch_ophthalmology_page()

        self.assertIn("401 Unauthorized", str(raised.exception))

    def test_search_by_name_uses_hira_name_parameter(self) -> None:
        payload = {
            "response": {
                "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
                "body": {
                    "totalCount": 1,
                    "items": {
                        "item": {
                            "ykiho": "39100103",
                            "yadmNm": "제주대학교병원",
                            "clCd": "11",
                            "clCdNm": "종합병원",
                            "addr": "제주특별자치도 제주시",
                            "sidoCd": "390000",
                            "sgguCd": "390200",
                        }
                    },
                },
            }
        }
        session = FakeSession(
            FakeResponse(
                headers={"content-type": "application/json"},
                text="{}",
                json_payload=payload,
            )
        )
        client = HiraInstitutionDirectoryClient("test-key", session=session)

        page = client.search_ophthalmology_institutions("제주대", num_rows=8)

        self.assertEqual(page.total_count, 1)
        self.assertEqual(len(page.items), 1)
        self.assertEqual(page.items[0]["name"], "제주대학교병원")
        self.assertEqual(session.calls[0]["params"]["yadmNm"], "제주대")
        self.assertEqual(session.calls[0]["params"]["dgsbjtCd"], "12")


if __name__ == "__main__":
    unittest.main()
