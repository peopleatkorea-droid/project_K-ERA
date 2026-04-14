from __future__ import annotations

import asyncio
import io
import unittest
import zipfile

from fastapi import HTTPException, UploadFile
from PIL import Image

from kera_research.api.site_import_validation import SiteImportValidator


def _jpeg_bytes(color: tuple[int, int, int] = (64, 96, 160)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), color=color).save(buffer, format="JPEG")
    return buffer.getvalue()


class SiteImportValidatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = SiteImportValidator()

    def test_parse_import_csv_rejects_missing_columns(self) -> None:
        csv_bytes = b"patient_id,visit_date\nP-001,Initial\n"
        with self.assertRaises(HTTPException) as ctx:
            self.validator.parse_import_csv(csv_bytes)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Missing columns", str(ctx.exception.detail))

    def test_parse_bundle_skips_invalid_zip_image_entries(self) -> None:
        csv_file = UploadFile(
            filename="bulk_import.csv",
            file=io.BytesIO(
                (
                    "patient_id,sex,age,visit_date,image_filename,view\n"
                    "P-001,female,50,Initial,image1.jpg,white\n"
                ).encode("utf-8")
            ),
        )
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("image1.jpg", b"not-an-image")
        files = [
            UploadFile(
                filename="bundle.zip",
                file=io.BytesIO(archive_buffer.getvalue()),
            )
        ]

        parsed = asyncio.run(self.validator.parse_bundle(csv_file=csv_file, files=files))

        self.assertEqual(int(len(parsed.dataframe.index)), 1)
        self.assertEqual(parsed.image_bytes, {})
        self.assertTrue(any("Invalid image file" in item for item in parsed.bundle_errors))

    def test_parse_bundle_collects_valid_images_from_zip(self) -> None:
        csv_file = UploadFile(
            filename="bulk_import.csv",
            file=io.BytesIO(
                (
                    "patient_id,sex,age,visit_date,image_filename,view\n"
                    "P-001,female,50,Initial,image1.jpg,white\n"
                ).encode("utf-8")
            ),
        )
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w") as archive:
            archive.writestr("nested/path/image1.jpg", _jpeg_bytes())
        files = [
            UploadFile(
                filename="bundle.zip",
                file=io.BytesIO(archive_buffer.getvalue()),
            )
        ]

        parsed = asyncio.run(self.validator.parse_bundle(csv_file=csv_file, files=files))

        self.assertIn("image1.jpg", parsed.image_bytes)
        self.assertEqual(parsed.image_sources["image1.jpg"], "bundle.zip")
        self.assertEqual(parsed.bundle_errors, [])


if __name__ == "__main__":
    unittest.main()

