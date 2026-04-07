fn visible_workspace_visit_condition(alias: &str) -> String {
    format!(
        "
        (
          {alias}.research_registry_source is null
          or {alias}.research_registry_source != 'raw_inventory_sync'
          or lower(
            trim(
              coalesce(
                {alias}.culture_status,
                case
                  when {alias}.culture_confirmed = 1
                    or trim(coalesce({alias}.culture_category, '')) != ''
                    or trim(coalesce({alias}.culture_species, '')) != ''
                  then 'positive'
                  else 'unknown'
                end
              )
            )
          ) = 'positive'
        )
        "
    )
}

fn query_visible_workspace_lookup_metrics(
    conn: &Connection,
    site_id: &str,
    patient_id: &str,
) -> Result<(i64, i64, Option<String>), String> {
    let visible_visit_condition = visible_workspace_visit_condition("v");
    let visit_count_sql = format!(
        "select count(*) from visits v where v.site_id = ? and v.patient_id = ? and {visible_visit_condition}"
    );
    let image_count_sql = format!(
        "
        select count(*)
        from images i
        join visits v on i.site_id = v.site_id and i.visit_id = v.visit_id
        where v.site_id = ? and v.patient_id = ? and {visible_visit_condition}
        "
    );
    let latest_visit_sql = format!(
        "
        select v.visit_date
        from visits v
        where v.site_id = ? and v.patient_id = ? and {visible_visit_condition}
        order by v.visit_index desc, v.visit_date desc
        limit 1
        "
    );
    let visit_count = conn
        .query_row(&visit_count_sql, params![site_id, patient_id], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    let image_count = conn
        .query_row(&image_count_sql, params![site_id, patient_id], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?;
    let latest_visit_date = conn
        .query_row(&latest_visit_sql, params![site_id, patient_id], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    Ok((visit_count, image_count, latest_visit_date))
}

fn query_visible_workspace_visits(
    conn: &Connection,
    site_id: &str,
    patient_id: Option<&str>,
) -> Result<Vec<VisitRecord>, String> {
    let visible_visit_condition = visible_workspace_visit_condition("v");
    let mut sql = format!(
        "
      select
        v.visit_id,
        v.patient_id,
        v.created_by_user_id,
        v.visit_date,
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
        v.created_at
      from visits v
      where v.site_id = ?
        and {visible_visit_condition}
    "
    );
    let mut params = vec![Value::Text(site_id.to_string())];
    if let Some(patient_id) = patient_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and v.patient_id = ?");
        params.push(Value::Text(normalize_patient_pseudonym(patient_id)?));
    }
    sql.push_str(" order by v.patient_id asc, v.visit_index asc, v.visit_date asc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), visit_record_from_row)
        .map_err(|error| error.to_string())?;
    let mut visits = Vec::new();
    for row in rows {
        visits.push(row.map_err(|error| error.to_string())?);
    }
    Ok(visits)
}

fn query_visible_workspace_patients(
    conn: &Connection,
    site_id: &str,
    created_by_user_id: Option<&str>,
) -> Result<Vec<PatientRecord>, String> {
    let visible_visit_condition = visible_workspace_visit_condition("v_visible");
    let mut sql = format!(
        "
      select p.patient_id, p.created_by_user_id, p.sex, p.age, p.chart_alias, p.local_case_code, p.created_at
      from patients p
      where p.site_id = ?
        and (
          not exists (
            select 1
            from visits v_any
            where v_any.site_id = p.site_id and v_any.patient_id = p.patient_id
          )
          or exists (
            select 1
            from visits v_visible
            where v_visible.site_id = p.site_id
              and v_visible.patient_id = p.patient_id
              and {visible_visit_condition}
          )
        )
    "
    );
    let mut params = vec![Value::Text(site_id.to_string())];
    if let Some(created_by_user_id) = created_by_user_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        sql.push_str(" and p.created_by_user_id = ?");
        params.push(Value::Text(created_by_user_id.to_string()));
    }
    sql.push_str(" order by p.created_at desc");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(params), patient_record_from_row)
        .map_err(|error| error.to_string())?;
    let mut patients = Vec::new();
    for row in rows {
        patients.push(row.map_err(|error| error.to_string())?);
    }
    Ok(patients)
}

#[tauri::command]
pub(super) fn list_patients(payload: ListPatientsRequest) -> Result<Vec<PatientRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    query_visible_workspace_patients(&conn, &site_id, payload.created_by_user_id.as_deref())
}

#[tauri::command]
pub(super) fn lookup_patient_id(payload: PatientLookupRequest) -> Result<PatientIdLookupResponse, String> {
    let site_id = payload.site_id.trim().to_string();
    let requested_patient_id = payload.patient_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let normalized_patient_id = normalize_patient_pseudonym(&requested_patient_id)?;
    let conn = open_data_plane_db()?;
    let patient = get_patient(&conn, &site_id, &normalized_patient_id)?;
    let (visit_count, image_count, latest_visit_date) =
        query_visible_workspace_lookup_metrics(&conn, &site_id, &normalized_patient_id)?;

    Ok(PatientIdLookupResponse {
        requested_patient_id,
        normalized_patient_id,
        exists: patient.is_some(),
        patient,
        visit_count,
        image_count,
        latest_visit_date,
    })
}

#[tauri::command]
pub(super) fn list_visits(payload: ListVisitsRequest) -> Result<Vec<VisitRecord>, String> {
    let site_id = payload.site_id.trim().to_string();
    if site_id.is_empty() {
        return Err("site_id is required.".to_string());
    }
    let conn = open_data_plane_db()?;
    query_visible_workspace_visits(&conn, &site_id, payload.patient_id.as_deref())
}

#[cfg(test)]
mod desktop_patient_visit_query_command_tests {
    use rusqlite::{params, Connection};

    use super::{
        query_visible_workspace_lookup_metrics, query_visible_workspace_patients,
        query_visible_workspace_visits,
    };

    fn setup_patient_visit_query_test_db() -> Connection {
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
              created_by_user_id text,
              visit_date text not null,
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
              created_at text,
              patient_reference_id text,
              visit_index integer,
              research_registry_status text,
              research_registry_updated_at text,
              research_registry_updated_by text,
              research_registry_source text
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
    fn lookup_metrics_hide_raw_inventory_sync_placeholder_visits() {
        let conn = setup_patient_visit_query_test_db();
        let visits = [
            (
                "visit_hidden",
                "Initial",
                "unknown",
                0_i64,
                "",
                "",
                Some("raw_inventory_sync"),
                1_i64,
                "2026-04-07T00:00:00+00:00",
            ),
            (
                "visit_visible",
                "FU #1",
                "negative",
                0_i64,
                "",
                "",
                None,
                2_i64,
                "2026-04-07T01:00:00+00:00",
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
                   site_id, visit_id, patient_id, created_by_user_id, visit_date, actual_visit_date,
                   culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
                   contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
                   smear_result, polymicrobial, created_at, patient_reference_id, visit_index,
                   research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source
                 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    visit_id,
                    "PAT-001",
                    "user_a",
                    visit_date,
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
                    created_at,
                    Option::<&str>::None,
                    visit_index,
                    "analysis_only",
                    Option::<&str>::None,
                    Option::<&str>::None,
                    research_registry_source,
                ],
            )
            .expect("insert visit");
        }
        conn.execute(
            "insert into images (site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative, uploaded_at, lesion_prompt_box, quality_scores)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_hidden",
                "img_hidden",
                "PAT-001",
                "Initial",
                "slit",
                "hidden.png",
                1_i64,
                "2026-04-07T00:00:00+00:00",
                Option::<&str>::None,
                Option::<&str>::None,
            ],
        )
        .expect("insert hidden image");
        conn.execute(
            "insert into images (site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative, uploaded_at, lesion_prompt_box, quality_scores)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_visible",
                "img_visible",
                "PAT-001",
                "FU #1",
                "white",
                "visible.png",
                1_i64,
                "2026-04-07T01:00:00+00:00",
                Option::<&str>::None,
                Option::<&str>::None,
            ],
        )
        .expect("insert visible image");

        let (visit_count, image_count, latest_visit_date) =
            query_visible_workspace_lookup_metrics(&conn, "site_a", "PAT-001").expect("lookup metrics");

        assert_eq!(visit_count, 1);
        assert_eq!(image_count, 1);
        assert_eq!(latest_visit_date.as_deref(), Some("FU #1"));
    }

    #[test]
    fn visible_visit_query_hides_raw_inventory_sync_non_positive_rows() {
        let conn = setup_patient_visit_query_test_db();
        let visits = [
            (
                "visit_hidden",
                "Initial",
                "unknown",
                0_i64,
                "",
                "",
                Some("raw_inventory_sync"),
                1_i64,
                "2026-04-07T00:00:00+00:00",
            ),
            (
                "visit_visible",
                "FU #1",
                "negative",
                0_i64,
                "",
                "",
                None,
                2_i64,
                "2026-04-07T01:00:00+00:00",
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
                   site_id, visit_id, patient_id, created_by_user_id, visit_date, actual_visit_date,
                   culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
                   contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
                   smear_result, polymicrobial, created_at, patient_reference_id, visit_index,
                   research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source
                 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    visit_id,
                    "PAT-001",
                    "user_a",
                    visit_date,
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
                    created_at,
                    Option::<&str>::None,
                    visit_index,
                    "analysis_only",
                    Option::<&str>::None,
                    Option::<&str>::None,
                    research_registry_source,
                ],
            )
            .expect("insert visit");
        }

        let visits = query_visible_workspace_visits(&conn, "site_a", Some("PAT-001")).expect("visible visits");
        let visit_dates = visits
            .iter()
            .map(|visit| visit.visit_date.as_str())
            .collect::<Vec<_>>();

        assert_eq!(visit_dates, vec!["FU #1"]);
    }

    #[test]
    fn patient_list_hides_patients_with_only_hidden_raw_inventory_placeholder_visits() {
        let conn = setup_patient_visit_query_test_db();
        let patient_rows = [
            ("PAT-001", "user_a", "2026-04-07T00:00:00+00:00"),
            ("PAT-002", "user_b", "2026-04-07T01:00:00+00:00"),
            ("PAT-003", "user_c", "2026-04-07T02:00:00+00:00"),
        ];
        for (patient_id, created_by_user_id, created_at) in patient_rows {
            conn.execute(
                "insert into patients (site_id, patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at)
                 values (?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    patient_id,
                    created_by_user_id,
                    "female",
                    60_i64,
                    "",
                    "",
                    created_at,
                ],
            )
            .expect("insert patient");
        }
        let visits = [
            (
                "visit_hidden",
                "PAT-001",
                "Initial",
                "unknown",
                0_i64,
                Some("raw_inventory_sync"),
                1_i64,
                "2026-04-07T00:00:00+00:00",
            ),
            (
                "visit_visible",
                "PAT-002",
                "Initial",
                "negative",
                0_i64,
                None,
                1_i64,
                "2026-04-07T01:00:00+00:00",
            ),
        ];
        for (
            visit_id,
            patient_id,
            visit_date,
            culture_status,
            culture_confirmed,
            research_registry_source,
            visit_index,
            created_at,
        ) in visits
        {
            conn.execute(
                "insert into visits (
                   site_id, visit_id, patient_id, created_by_user_id, visit_date, actual_visit_date,
                   culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
                   contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
                   smear_result, polymicrobial, created_at, patient_reference_id, visit_index,
                   research_registry_status, research_registry_updated_at, research_registry_updated_by, research_registry_source
                 ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    "site_a",
                    visit_id,
                    patient_id,
                    "user_a",
                    visit_date,
                    Option::<&str>::None,
                    culture_status,
                    culture_confirmed,
                    "",
                    "",
                    "[]",
                    "none",
                    "[]",
                    "",
                    "active",
                    1_i64,
                    0_i64,
                    "",
                    0_i64,
                    created_at,
                    Option::<&str>::None,
                    visit_index,
                    "analysis_only",
                    Option::<&str>::None,
                    Option::<&str>::None,
                    research_registry_source,
                ],
            )
            .expect("insert visit");
        }

        let patients =
            query_visible_workspace_patients(&conn, "site_a", None).expect("visible workspace patients");
        let patient_ids = patients
            .iter()
            .map(|patient| patient.patient_id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(patient_ids, vec!["PAT-003", "PAT-002"]);
    }
}
