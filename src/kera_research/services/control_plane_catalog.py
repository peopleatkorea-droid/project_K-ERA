from __future__ import annotations

import json
from typing import Any, Callable

from sqlalchemy import and_, case, func, or_, select, update

from kera_research.db import CONTROL_PLANE_ENGINE, institution_directory, organism_catalog, organism_requests
from kera_research.domain import make_id, utc_now
from kera_research.services.institution_directory import HiraInstitutionDirectoryClient


class ControlPlaneCatalogFacade:
    def __init__(
        self,
        store: Any,
        *,
        hira_api_key: str,
        institution_directory_last_sync_setting_key: str,
        expand_institution_search_terms: Callable[[str], list[list[str]]],
    ) -> None:
        self.store = store
        self.hira_api_key = hira_api_key
        self.institution_directory_last_sync_setting_key = institution_directory_last_sync_setting_key
        self.expand_institution_search_terms = expand_institution_search_terms

    def list_institutions(
        self,
        *,
        search: str = "",
        sido_code: str | None = None,
        sggu_code: str | None = None,
        open_only: bool = True,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        normalized_search = search.strip().lower()
        normalized_sido = str(sido_code or "").strip()
        normalized_sggu = str(sggu_code or "").strip()
        bounded_limit = max(1, min(limit, 50))

        query = select(institution_directory)
        ranking_expression = None
        if open_only:
            query = query.where(institution_directory.c.open_status == "active")
        if normalized_sido:
            query = query.where(institution_directory.c.sido_code == normalized_sido)
        if normalized_sggu:
            query = query.where(institution_directory.c.sggu_code == normalized_sggu)
        if normalized_search:
            name_column = func.lower(institution_directory.c.name)
            address_column = func.lower(institution_directory.c.address)
            institution_id_column = func.lower(institution_directory.c.institution_id)
            searchable_columns = [name_column, address_column, institution_id_column]
            grouped_terms = self.expand_institution_search_terms(search)
            if grouped_terms:
                token_clauses = []
                ranking_terms = [
                    case((name_column == normalized_search, 1000), else_=0),
                    case((name_column.like(f"{normalized_search}%"), 500), else_=0),
                    case((name_column.like(f"%{normalized_search}%"), 250), else_=0),
                    case((address_column.like(f"{normalized_search}%"), 120), else_=0),
                    case((address_column.like(f"%{normalized_search}%"), 60), else_=0),
                    case((institution_id_column.like(f"%{normalized_search}%"), 20), else_=0),
                ]
                for aliases in grouped_terms:
                    alias_clauses = []
                    name_alias_clauses = []
                    address_alias_clauses = []
                    institution_id_alias_clauses = []
                    for alias in aliases:
                        alias_pattern = f"%{alias.lower()}%"
                        alias_clauses.extend(column.like(alias_pattern) for column in searchable_columns)
                        name_alias_clauses.append(name_column.like(alias_pattern))
                        address_alias_clauses.append(address_column.like(alias_pattern))
                        institution_id_alias_clauses.append(institution_id_column.like(alias_pattern))
                    token_clauses.append(or_(*alias_clauses))
                    ranking_terms.extend(
                        [
                            case((or_(*name_alias_clauses), 50), else_=0),
                            case((or_(*address_alias_clauses), 10), else_=0),
                            case((or_(*institution_id_alias_clauses), 2), else_=0),
                        ]
                    )
                query = query.where(and_(*token_clauses))
                ranking_expression = ranking_terms[0]
                for ranking_term in ranking_terms[1:]:
                    ranking_expression = ranking_expression + ranking_term
            else:
                like_pattern = f"%{normalized_search}%"
                query = query.where(
                    or_(
                        name_column.like(like_pattern),
                        address_column.like(like_pattern),
                        institution_id_column.like(like_pattern),
                    )
                )
                ranking_expression = (
                    case((name_column == normalized_search, 1000), else_=0)
                    + case((name_column.like(f"{normalized_search}%"), 500), else_=0)
                    + case((name_column.like(like_pattern), 250), else_=0)
                    + case((address_column.like(f"{normalized_search}%"), 120), else_=0)
                    + case((address_column.like(like_pattern), 60), else_=0)
                    + case((institution_id_column.like(like_pattern), 20), else_=0)
                )
        if ranking_expression is not None:
            query = query.order_by(ranking_expression.desc(), institution_directory.c.name)
        else:
            query = query.order_by(institution_directory.c.name)
        query = query.limit(bounded_limit)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def get_institution(self, institution_id: str) -> dict[str, Any] | None:
        normalized_institution_id = institution_id.strip()
        if not normalized_institution_id:
            return None
        with CONTROL_PLANE_ENGINE.begin() as conn:
            row = conn.execute(
                select(institution_directory).where(institution_directory.c.institution_id == normalized_institution_id)
            ).mappings().first()
        return dict(row) if row else None

    def upsert_institutions(self, records: list[dict[str, Any]]) -> int:
        if not records:
            return 0
        upserted = 0
        with CONTROL_PLANE_ENGINE.begin() as conn:
            for raw_record in records:
                institution_id = str(raw_record.get("institution_id") or "").strip()
                if not institution_id:
                    continue
                record = {
                    "institution_id": institution_id,
                    "source": str(raw_record.get("source") or "hira").strip() or "hira",
                    "name": str(raw_record.get("name") or institution_id).strip() or institution_id,
                    "institution_type_code": str(raw_record.get("institution_type_code") or "").strip(),
                    "institution_type_name": str(raw_record.get("institution_type_name") or "").strip(),
                    "address": str(raw_record.get("address") or "").strip(),
                    "phone": str(raw_record.get("phone") or "").strip(),
                    "homepage": str(raw_record.get("homepage") or "").strip(),
                    "sido_code": str(raw_record.get("sido_code") or "").strip(),
                    "sggu_code": str(raw_record.get("sggu_code") or "").strip(),
                    "emdong_name": str(raw_record.get("emdong_name") or "").strip(),
                    "postal_code": str(raw_record.get("postal_code") or "").strip(),
                    "x_pos": str(raw_record.get("x_pos") or "").strip(),
                    "y_pos": str(raw_record.get("y_pos") or "").strip(),
                    "ophthalmology_available": bool(raw_record.get("ophthalmology_available", True)),
                    "open_status": str(raw_record.get("open_status") or "active").strip() or "active",
                    "source_payload": dict(raw_record.get("source_payload") or {}),
                    "synced_at": str(raw_record.get("synced_at") or utc_now()).strip() or utc_now(),
                }
                existing = conn.execute(
                    select(institution_directory.c.institution_id).where(
                        institution_directory.c.institution_id == institution_id
                    )
                ).first()
                if existing:
                    conn.execute(
                        update(institution_directory)
                        .where(institution_directory.c.institution_id == institution_id)
                        .values(**record)
                    )
                else:
                    conn.execute(institution_directory.insert().values(**record))
                upserted += 1
        return upserted

    def sync_hira_ophthalmology_directory(
        self,
        *,
        page_size: int = 100,
        max_pages: int | None = None,
        service_key: str | None = None,
    ) -> dict[str, Any]:
        client = HiraInstitutionDirectoryClient(service_key or self.hira_api_key)
        page_no = 1
        pages_synced = 0
        total_count = 0
        upserted = 0

        while True:
            page = client.fetch_ophthalmology_page(page_no=page_no, num_rows=page_size)
            total_count = max(total_count, page.total_count)
            if not page.items:
                break
            upserted += self.upsert_institutions(page.items)
            pages_synced += 1
            if max_pages is not None and pages_synced >= max_pages:
                break
            if page.total_count and page_no * page_size >= page.total_count:
                break
            page_no += 1

        result = {
            "source": "hira",
            "pages_synced": pages_synced,
            "total_count": total_count,
            "institutions_synced": upserted,
            "synced_at": utc_now(),
        }
        self.store.set_app_setting(
            self.institution_directory_last_sync_setting_key,
            json.dumps(result, ensure_ascii=False),
        )
        return result

    def list_organisms(self, category: str | None = None) -> list[str] | dict[str, list[str]]:
        query = select(organism_catalog).order_by(organism_catalog.c.culture_category, organism_catalog.c.species_name)
        if category:
            query = query.where(organism_catalog.c.culture_category == category)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        if category:
            return [row["species_name"] for row in rows]
        catalog: dict[str, list[str]] = {}
        for row in rows:
            catalog.setdefault(row["culture_category"], []).append(row["species_name"])
        return catalog

    def request_new_organism(
        self,
        culture_category: str,
        requested_species: str,
        requested_by: str,
    ) -> dict[str, Any]:
        request_record = {
            "request_id": make_id("organism"),
            "culture_category": culture_category,
            "requested_species": requested_species,
            "requested_by": requested_by,
            "status": "pending",
            "reviewed_by": None,
            "created_at": utc_now(),
            "reviewed_at": None,
        }
        with CONTROL_PLANE_ENGINE.begin() as conn:
            conn.execute(organism_requests.insert().values(**request_record))
        return request_record

    def list_organism_requests(self, status: str | None = None) -> list[dict[str, Any]]:
        query = select(organism_requests).order_by(organism_requests.c.created_at.desc())
        if status:
            query = query.where(organism_requests.c.status == status)
        with CONTROL_PLANE_ENGINE.begin() as conn:
            rows = conn.execute(query).mappings().all()
        return [dict(row) for row in rows]

    def approve_organism(self, request_id: str, approver_user_id: str) -> dict[str, Any]:
        with CONTROL_PLANE_ENGINE.begin() as conn:
            request_row = conn.execute(
                select(organism_requests).where(organism_requests.c.request_id == request_id)
            ).mappings().first()
            if request_row is None:
                raise ValueError(f"Unknown request_id: {request_id}")
            reviewed_at = utc_now()
            approved_request = {
                **dict(request_row),
                "status": "approved",
                "reviewed_by": approver_user_id,
                "reviewed_at": reviewed_at,
            }
            conn.execute(
                update(organism_requests)
                .where(organism_requests.c.request_id == request_id)
                .values(
                    status="approved",
                    reviewed_by=approver_user_id,
                    reviewed_at=reviewed_at,
                )
            )
            existing_species = conn.execute(
                select(organism_catalog.c.catalog_id).where(
                    and_(
                        organism_catalog.c.culture_category == request_row["culture_category"],
                        organism_catalog.c.species_name == request_row["requested_species"],
                    )
                )
            ).first()
            if existing_species is None:
                conn.execute(
                    organism_catalog.insert().values(
                        culture_category=request_row["culture_category"],
                        species_name=request_row["requested_species"],
                    )
                )
        return approved_request
