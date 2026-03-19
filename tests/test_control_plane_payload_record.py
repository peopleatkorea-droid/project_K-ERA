from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from kera_research.services.control_plane import _payload_record


class _FakeRow:
    def __init__(self, mapping):
        self._mapping = mapping


class ControlPlanePayloadRecordTests(unittest.TestCase):
    def test_payload_record_parses_stringified_json_objects(self) -> None:
        row = _FakeRow(
            {
                "payload_json": '{"version_id":"model_smoke_1","version_name":"smoke","ready":true}',
                "stage": "global",
                "is_current": True,
            }
        )

        payload = _payload_record(row, "payload_json", ["stage", "is_current"])

        self.assertEqual(payload["version_id"], "model_smoke_1")
        self.assertEqual(payload["version_name"], "smoke")
        self.assertTrue(payload["ready"])
        self.assertEqual(payload["stage"], "global")
        self.assertTrue(payload["is_current"])


if __name__ == "__main__":
    unittest.main()
