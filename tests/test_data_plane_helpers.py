from __future__ import annotations

from io import BytesIO
from pathlib import Path
import unittest

from PIL import Image

from kera_research.services.data_plane_helpers import (
    FileUploadValidator,
    InvalidImageUploadError,
    infer_raw_image_view,
    safe_path_component,
    sanitize_image_bytes,
    sqlite_patient_case_match_query,
)


class DataPlaneHelperTests(unittest.TestCase):
    def test_sqlite_patient_case_match_query_tokenizes_mixed_input(self) -> None:
        self.assertEqual(
            sqlite_patient_case_match_query("Patient-01 / Visit A"),
            "patient* 01* visit* a*",
        )

    def test_safe_path_component_normalizes_empty_and_symbols(self) -> None:
        self.assertEqual(safe_path_component("Patient 01/Visit#2"), "Patient_01_Visit_2")
        self.assertEqual(safe_path_component(""), "unknown")

    def test_sanitize_image_bytes_converts_rgba_to_png(self) -> None:
        image = Image.new("RGBA", (16, 16), (255, 0, 0, 128))
        buffer = BytesIO()
        image.save(buffer, format="PNG")

        content, suffix = sanitize_image_bytes(buffer.getvalue(), "sample.png")

        self.assertEqual(suffix, ".png")
        self.assertGreater(len(content), 0)

    def test_sanitize_image_bytes_rejects_invalid_payload(self) -> None:
        with self.assertRaises(InvalidImageUploadError):
            sanitize_image_bytes(b"not-an-image", "bad.bin")

    def test_sanitize_image_bytes_rejects_unsupported_magic_header(self) -> None:
        with self.assertRaises(InvalidImageUploadError):
            sanitize_image_bytes(b"GIF89a\x01\x00\x01\x00", "photo.png")

    def test_file_upload_validator_normalizes_filename_and_payload(self) -> None:
        image = Image.new("RGB", (8, 8), (0, 255, 0))
        buffer = BytesIO()
        image.save(buffer, format="JPEG")

        validated = FileUploadValidator(max_image_bytes=1024 * 1024).validate_image_upload(
            content=buffer.getvalue(),
            file_name="..\\unsafe/path/example.jpg",
        )

        self.assertEqual(validated.normalized_upload_name, "example.jpg")
        self.assertEqual(validated.normalized_suffix, ".jpg")
        self.assertGreater(len(validated.sanitized_content), 0)

    def test_file_upload_validator_rejects_large_content_length(self) -> None:
        validator = FileUploadValidator(max_image_bytes=10)
        with self.assertRaises(InvalidImageUploadError):
            validator.validate_content_length("11")

    def test_infer_raw_image_view_uses_filename_convention(self) -> None:
        self.assertEqual(infer_raw_image_view(Path("patient_fluorescein.jpg")), "fluorescein")
        self.assertEqual(infer_raw_image_view(Path("patient_slit_beam.jpg")), "slit")
        self.assertEqual(infer_raw_image_view(Path("patient_white.jpg")), "white")


if __name__ == "__main__":
    unittest.main()
