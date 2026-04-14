from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from typing import Any

import pandas as pd
from fastapi import HTTPException, UploadFile, status

from kera_research.services.data_plane_helpers import FileUploadValidator, InvalidImageUploadError


@dataclass(frozen=True)
class ParsedImportBundle:
    dataframe: pd.DataFrame
    image_bytes: dict[str, bytes]
    image_sources: dict[str, str]
    bundle_errors: list[str]


class SiteImportValidator:
    REQUIRED_COLUMNS = (
        "patient_id",
        "sex",
        "age",
        "visit_date",
        "image_filename",
        "view",
    )

    def __init__(self, *, upload_validator: FileUploadValidator | None = None) -> None:
        self.upload_validator = upload_validator or FileUploadValidator()

    def validate_csv_filename(self, file_name: str | None) -> str:
        normalized_name = self.upload_validator.normalize_upload_name(file_name).lower()
        if not normalized_name.endswith(".csv"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bulk import requires a CSV metadata file.",
            )
        return normalized_name

    def parse_import_csv(self, csv_bytes: bytes) -> pd.DataFrame:
        try:
            dataframe = pd.read_csv(io.BytesIO(csv_bytes))
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unable to parse CSV: {exc}",
            ) from exc
        missing_columns = [column for column in self.REQUIRED_COLUMNS if column not in dataframe.columns]
        if missing_columns:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing columns: {', '.join(missing_columns)}",
            )
        return dataframe.where(pd.notnull(dataframe), None)

    async def collect_image_bundle(self, files: list[UploadFile]) -> tuple[dict[str, bytes], dict[str, str], list[str]]:
        image_bytes: dict[str, bytes] = {}
        image_sources: dict[str, str] = {}
        bundle_errors: list[str] = []
        for upload in files:
            upload_name = self.upload_validator.normalize_upload_name(upload.filename)
            if not upload_name:
                continue
            content = await upload.read()
            if upload_name.lower().endswith(".zip"):
                zip_image_bytes, zip_image_sources, zip_bundle_errors = self._extract_zip_bundle(
                    upload_name=upload_name,
                    content=content,
                )
                image_bytes.update(zip_image_bytes)
                image_sources.update(zip_image_sources)
                bundle_errors.extend(zip_bundle_errors)
                continue

            try:
                validated_upload = self.upload_validator.validate_image_upload(
                    content=content,
                    file_name=upload_name,
                )
            except InvalidImageUploadError as exc:
                bundle_errors.append(f"{upload_name}: {exc}")
                continue
            image_bytes[validated_upload.normalized_upload_name] = validated_upload.sanitized_content
            image_sources[validated_upload.normalized_upload_name] = upload_name
        return image_bytes, image_sources, bundle_errors

    def _extract_zip_bundle(self, *, upload_name: str, content: bytes) -> tuple[dict[str, bytes], dict[str, str], list[str]]:
        image_bytes: dict[str, bytes] = {}
        image_sources: dict[str, str] = {}
        bundle_errors: list[str] = []
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                for member in archive.namelist():
                    if member.endswith("/"):
                        continue
                    image_name = self.upload_validator.normalize_upload_name(member)
                    if not image_name or image_name.startswith(".") or ".." in member:
                        continue
                    member_bytes = archive.read(member)
                    try:
                        validated_upload = self.upload_validator.validate_image_upload(
                            content=member_bytes,
                            file_name=image_name,
                        )
                    except InvalidImageUploadError as exc:
                        bundle_errors.append(f"{upload_name}/{image_name}: {exc}")
                        continue
                    image_bytes[validated_upload.normalized_upload_name] = validated_upload.sanitized_content
                    image_sources[validated_upload.normalized_upload_name] = upload_name
        except zipfile.BadZipFile as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid ZIP archive: {upload_name}",
            ) from exc
        return image_bytes, image_sources, bundle_errors

    async def parse_bundle(self, *, csv_file: UploadFile, files: list[UploadFile]) -> ParsedImportBundle:
        self.validate_csv_filename(csv_file.filename)
        csv_bytes = await csv_file.read()
        dataframe = self.parse_import_csv(csv_bytes)
        image_bytes, image_sources, bundle_errors = await self.collect_image_bundle(files)
        return ParsedImportBundle(
            dataframe=dataframe,
            image_bytes=image_bytes,
            image_sources=image_sources,
            bundle_errors=bundle_errors,
        )

