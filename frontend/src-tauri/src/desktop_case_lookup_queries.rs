pub(super) fn get_patient(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
) -> Result<Option<PatientRecord>, String> {
    let sql = "
      select patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at
      from patients
      where site_id = ? and patient_id = ?
    ";
    conn.query_row(sql, params![site_id, patient_id], patient_record_from_row)
        .optional()
        .map_err(|error| error.to_string())
}

pub(super) fn get_visit(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Option<VisitRecord>, String> {
    let sql = "
      select
        visit_id,
        patient_id,
        created_by_user_id,
        visit_date,
        actual_visit_date,
        culture_status,
        culture_confirmed,
        culture_category,
        culture_species,
        additional_organisms,
        contact_lens_use,
        predisposing_factor,
        other_history,
        visit_status,
        active_stage,
        is_initial_visit,
        smear_result,
        polymicrobial,
        created_at
      from visits
      where site_id = ? and patient_id = ? and visit_date = ?
    ";
    conn.query_row(
        sql,
        params![site_id, patient_id, visit_date],
        visit_record_from_row,
    )
    .optional()
    .map_err(|error| error.to_string())
}

pub(super) fn query_images(
    conn: &Connection,
    site_id: &str,
    patient_id: Option<&str>,
    visit_date: Option<&str>,
    preview_max_side: Option<u32>,
) -> Result<Vec<DesktopImageRecord>, String> {
    let mut sql = "
      select
        image_id,
        visit_id,
        patient_id,
        visit_date,
        view,
        image_path,
        is_representative,
        lesion_prompt_box,
        uploaded_at,
        quality_scores
      from images
      where site_id = ?
    "
    .to_string();
    let mut params = vec![Value::Text(site_id.to_string())];
    if let Some(value) = patient_id {
        sql.push_str(" and patient_id = ?");
        params.push(Value::Text(value.to_string()));
    }
    if let Some(value) = visit_date {
        sql.push_str(" and visit_date = ?");
        params.push(Value::Text(value.to_string()));
    }
    sql.push_str(" order by patient_id asc, visit_date asc, uploaded_at asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut images = Vec::new();
    let mut warm_preview_jobs = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let (image, warm_preview_job) =
            desktop_image_record_from_row(row, site_id, preview_max_side)?;
        if let Some(job) = warm_preview_job {
            warm_preview_jobs.push(job);
        }
        images.push(image);
    }
    queue_preview_generation_batch(warm_preview_jobs);
    Ok(images)
}

pub(super) fn list_images_for_visit(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
    visit_date: &str,
) -> Result<Vec<DesktopImageRecord>, String> {
    query_images(conn, site_id, Some(patient_id), Some(visit_date), Some(640))
}

pub(super) fn query_case_summaries(
    conn: &Connection,
    site_id: &str,
    created_by_user_id: Option<&str>,
    patient_id: Option<&str>,
) -> Result<Vec<CaseSummaryRecord>, String> {
    let visible_case_condition = "
      (
        v.research_registry_source is null
        or v.research_registry_source != 'raw_inventory_sync'
        or lower(
          trim(
            coalesce(
              v.culture_status,
              case
                when v.culture_confirmed = 1
                  or trim(coalesce(v.culture_category, '')) != ''
                  or trim(coalesce(v.culture_species, '')) != ''
                then 'positive'
                else 'unknown'
              end
            )
          )
        ) = 'positive'
      )
    ";
    let mut sql = "
      with image_stats as (
        select visit_id, count(image_id) as image_count, max(uploaded_at) as latest_image_uploaded_at
        from images
        where site_id = ?
        group by visit_id
      ),
      representative_images as (
        select visit_id, image_id as representative_image_id, view as representative_view
        from images
        where site_id = ? and is_representative = 1
      )
      select
        v.visit_id,
        v.patient_id,
        v.patient_reference_id,
        v.visit_date,
        v.visit_index,
        v.actual_visit_date,
        v.culture_status,
        v.culture_confirmed,
        v.culture_category,
        v.culture_species,
        v.additional_organisms,
        v.contact_lens_use,
        v.predisposing_factor,
        v.other_history,
        v.visit_status,
        v.active_stage,
        v.is_initial_visit,
        v.smear_result,
        v.polymicrobial,
        v.research_registry_status,
        v.research_registry_updated_at,
        v.research_registry_updated_by,
        v.research_registry_source,
        v.created_at,
        p.chart_alias,
        p.local_case_code,
        p.sex,
        p.age,
        p.created_by_user_id,
        coalesce(image_stats.image_count, 0) as image_count,
        image_stats.latest_image_uploaded_at,
        representative_images.representative_image_id,
        representative_images.representative_view
      from visits v
      join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
      left join image_stats on v.visit_id = image_stats.visit_id
      left join representative_images on v.visit_id = representative_images.visit_id
      where v.site_id = ?
    "
    .to_string();
    let mut params = vec![
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
    ];
    if let Some(user_id) = created_by_user_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and p.created_by_user_id = ?");
        params.push(Value::Text(user_id.to_string()));
    }
    if let Some(patient_id) = patient_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and v.patient_id = ?");
        params.push(Value::Text(patient_id.to_string()));
    }
    sql.push_str(" and ");
    sql.push_str(visible_case_condition);
    sql.push_str(" order by coalesce(v.visit_index, 0) desc, image_stats.latest_image_uploaded_at desc, v.created_at desc");

    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        items.push(case_summary_from_row(row).map_err(|error| error.to_string())?);
    }
    Ok(items)
}

#[cfg(test)]
mod desktop_case_lookup_query_tests {
    use rusqlite::{params, Connection};

    use super::query_case_summaries;

    fn setup_case_query_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "
            create table patients (
              site_id text not null,
              patient_id text not null,
              created_by_user_id text,
              sex text,
              age integer,
              chart_alias text,
              local_case_code text,
              created_at text
            );
            create table visits (
              site_id text not null,
              visit_id text not null,
              patient_id text not null,
              patient_reference_id text,
              visit_date text not null,
              visit_index integer,
              actual_visit_date text,
              culture_status text,
              culture_confirmed integer,
              culture_category text,
              culture_species text,
              additional_organisms text,
              contact_lens_use text,
              predisposing_factor text,
              other_history text,
              visit_status text,
              active_stage integer,
              is_initial_visit integer,
              smear_result text,
              polymicrobial integer,
              research_registry_status text,
              research_registry_updated_at text,
              research_registry_updated_by text,
              research_registry_source text,
              created_at text
            );
            create table images (
              site_id text not null,
              visit_id text not null,
              image_id text not null,
              patient_id text not null,
              visit_date text not null,
              view text,
              image_path text,
              is_representative integer,
              uploaded_at text,
              lesion_prompt_box text,
              quality_scores text
            );
            ",
        )
        .expect("schema");
        conn.execute(
            "insert into patients (site_id, patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at)
             values (?, ?, ?, ?, ?, ?, ?, ?)",
            params!["site_a", "PAT-001", "user_a", "female", 63_i64, "A", "CASE-A", "2026-04-07T00:00:00+00:00"],
        )
        .expect("insert patient");
        conn
    }

    #[test]
    fn query_case_summaries_hides_raw_inventory_sync_non_positive_rows() {
        let conn = setup_case_query_test_db();
        let visits = [
            (
                "visit_hidden",
                "Placeholder",
                "unknown",
                0_i64,
                "",
                "",
                Some("raw_inventory_sync"),
                1_i64,
                "2026-04-07T00:00:00+00:00",
            ),
            (
                "visit_positive_raw",
                "PositiveRaw",
                "positive",
                1_i64,
                "bacterial",
                "Bacillus",
                Some("raw_inventory_sync"),
                2_i64,
                "2026-04-07T01:00:00+00:00",
            ),
            (
                "visit_manual",
                "ManualNegative",
                "negative",
                0_i64,
                "",
                "",
                None,
                3_i64,
                "2026-04-07T02:00:00+00:00",
            ),
        ];
        for (
            visit_id,
            visit_date,
            culture_status,
            culture_confirmed,
            culture_category,
            culture_species,
            research_registry_source,
            visit_index,
            created_at,
        ) in visits
        {
            conn.execute(
                "insert into visits (
                   site_id, visit_id, patient_id, patient_reference_id, visit_date, visit_index, actual_visit_date,
                   culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
                   contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
                   smear_result, polymicrobial, research_registry_status, research_registry_updated_at,
                   research_registry_updated_by, research_registry_source, created_at
                 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    visit_id,
                    "PAT-001",
                    Option::<&str>::None,
                    visit_date,
                    visit_index,
                    Option::<&str>::None,
                    culture_status,
                    culture_confirmed,
                    culture_category,
                    culture_species,
                    "[]",
                    "none",
                    "[]",
                    "",
                    "active",
                    1_i64,
                    0_i64,
                    "",
                    0_i64,
                    "analysis_only",
                    Option::<&str>::None,
                    Option::<&str>::None,
                    research_registry_source,
                    created_at,
                ],
            )
            .expect("insert visit");
        }

        let rows = query_case_summaries(&conn, "site_a", None, None).expect("query summaries");
        let visit_dates = rows
            .iter()
            .map(|item| item.visit_date.as_str())
            .collect::<Vec<_>>();

        assert!(visit_dates.contains(&"PositiveRaw"));
        assert!(visit_dates.contains(&"ManualNegative"));
        assert!(!visit_dates.contains(&"Placeholder"));
    }
}

pub(super) fn lookup_public_aliases(
    conn: &Connection,
    user_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let normalized = user_ids
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(normalized.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "select user_id, public_alias from users where user_id in ({placeholders}) and public_alias is not null"
    );
    let params = normalized
        .iter()
        .cloned()
        .map(Value::Text)
        .collect::<Vec<_>>();
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(params))
        .map_err(|error| error.to_string())?;
    let mut aliases = HashMap::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let user_id = row
            .get::<_, String>(0)
            .map_err(|error| error.to_string())?
            .trim()
            .to_string();
        let alias = row
            .get::<_, Option<String>>(1)
            .map_err(|error| error.to_string())?
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        if !user_id.is_empty() {
            if let Some(public_alias) = alias {
                aliases.insert(user_id, public_alias);
            }
        }
    }
    Ok(aliases)
}
