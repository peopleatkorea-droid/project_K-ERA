fn query_patient_board_page_ids(
    conn: &Connection,
    payload: &ListPatientBoardRequest,
    site_id: &str,
    page: u32,
    page_size: u32,
) -> Result<(Vec<String>, HashMap<String, i64>, u32, u32), String> {
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
    let mine_user_id = payload
        .created_by_user_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let mut ids_params = vec![
        Value::Text(site_id.to_string()),
        Value::Text(site_id.to_string()),
    ];
    let mine_clause = if let Some(created_by_user_id) = mine_user_id.as_ref() {
        ids_params.push(Value::Text(created_by_user_id.clone()));
        " and p.created_by_user_id = ? ".to_string()
    } else {
        String::new()
    };
    let search_clause = build_search_clause(site_id, &payload.search, &mut ids_params);
    ids_params.push(Value::Text(site_id.to_string()));
    let raw_offset = (page.saturating_sub(1) * page_size) as i64;
    ids_params.push(Value::Integer(page_size as i64));
    ids_params.push(Value::Integer(raw_offset));

    let ids_sql = format!(
        "
        with filtered_visits as (
          select v.visit_id, v.patient_id, v.created_at, v.visit_index
          from patients p
          join visits v on p.site_id = v.site_id and p.patient_id = v.patient_id
          where p.site_id = ? and v.site_id = ?
            and {visible_case_condition}
          {mine_clause}
          {search_clause}
        ),
        image_stats as (
          select visit_id, max(uploaded_at) as latest_image_uploaded_at
          from images
          where site_id = ? and visit_id in (select visit_id from filtered_visits)
          group by visit_id
        ),
        all_patients as (
          select
            fv.patient_id,
            count(fv.visit_id) as case_count,
            max(coalesce(image_stats.latest_image_uploaded_at, '')) as max_upload,
            max(coalesce(fv.created_at, '')) as max_created,
            max(coalesce(fv.visit_index, 0)) as max_visit_index
          from filtered_visits fv
          left join image_stats on fv.visit_id = image_stats.visit_id
          group by fv.patient_id
        )
        select
          patient_id,
          case_count,
          max_upload,
          max_created,
          max_visit_index,
          (select count(*) from all_patients) as total_count
        from all_patients
        order by max_upload desc, max_created desc, max_visit_index desc
        limit ? offset ?
        "
    );

    let mut patient_ids = Vec::new();
    let mut case_counts = HashMap::new();
    let mut total_count: u32 = 0;
    let mut stmt = conn.prepare(&ids_sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(ids_params), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (patient_id, case_count, row_total) = row.map_err(|error| error.to_string())?;
        if total_count == 0 {
            total_count = row_total.max(0) as u32;
        }
        case_counts.insert(patient_id.clone(), case_count);
        patient_ids.push(patient_id);
    }

    let total_pages = total_count.max(1).div_ceil(page_size);
    let safe_page = page.min(total_pages.max(1));
    Ok((patient_ids, case_counts, total_count, safe_page))
}

#[cfg(test)]
mod desktop_patient_board_page_query_tests {
    use std::collections::HashMap;

    use rusqlite::{params, Connection};

    use crate::ListPatientBoardRequest;

    use super::query_patient_board_page_ids;

    fn setup_patient_board_page_test_db() -> Connection {
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
        conn
    }

    #[test]
    fn query_patient_board_page_ids_excludes_patients_with_only_hidden_raw_inventory_cases() {
        let conn = setup_patient_board_page_test_db();
        let patients = [("PAT-HIDDEN", "2026-04-07T00:00:00+00:00"), ("PAT-VISIBLE", "2026-04-07T01:00:00+00:00")];
        for (patient_id, created_at) in patients {
            conn.execute(
                "insert into patients (site_id, patient_id, created_by_user_id, sex, age, chart_alias, local_case_code, created_at)
                 values (?, ?, ?, ?, ?, ?, ?, ?)",
                params!["site_a", patient_id, "user_a", "female", 63_i64, patient_id, patient_id, created_at],
            )
            .expect("insert patient");
        }
        let visits = [
            (
                "visit_hidden",
                "PAT-HIDDEN",
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
                "visit_visible",
                "PAT-VISIBLE",
                "AnalysisOnly",
                "unknown",
                0_i64,
                "",
                "",
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
                    patient_id,
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

        let payload = ListPatientBoardRequest {
            site_id: "site_a".to_string(),
            created_by_user_id: None,
            page: Some(1),
            page_size: Some(10),
            search: None,
        };
        let (patient_ids, case_counts, total_count, safe_page) =
            query_patient_board_page_ids(&conn, &payload, "site_a", 1, 10).expect("page ids");

        assert_eq!(patient_ids, vec!["PAT-VISIBLE".to_string()]);
        assert_eq!(case_counts, HashMap::from([(String::from("PAT-VISIBLE"), 1_i64)]));
        assert_eq!(total_count, 1);
        assert_eq!(safe_page, 1);
    }
}
