fn query_patient_board_cases(
    conn: &Connection,
    site_id: &str,
    patient_ids: &[String],
) -> Result<HashMap<String, Vec<(CaseSummaryRecord, Option<String>)>>, String> {
    let visible_case_condition = "
      (
        v.soft_deleted_at is null
        and (
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
      )
    ";
    let placeholders = std::iter::repeat("?")
        .take(patient_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let mut case_params = vec![Value::Text(site_id.to_string())];
    for patient_id in patient_ids {
        case_params.push(Value::Text(patient_id.clone()));
    }
    case_params.push(Value::Text(site_id.to_string()));
    case_params.push(Value::Text(site_id.to_string()));
    case_params.push(Value::Text(site_id.to_string()));
    for patient_id in patient_ids {
        case_params.push(Value::Text(patient_id.clone()));
    }

    let case_sql = format!(
        "
        with paged_patient_visits as (
          select v.visit_id from visits v
          where v.site_id = ? and v.patient_id in ({placeholders}) and {visible_case_condition}
        ),
        image_stats as (
          select visit_id, count(image_id) as image_count, max(uploaded_at) as latest_image_uploaded_at
          from images
          where site_id = ? and soft_deleted_at is null and visit_id in (select visit_id from paged_patient_visits)
          group by visit_id
        ),
        representative_images as (
          select visit_id, image_id as representative_image_id, view as representative_view, image_path as representative_image_path
          from images
          where site_id = ? and is_representative = 1 and soft_deleted_at is null
            and visit_id in (select visit_id from paged_patient_visits)
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
          representative_images.representative_view,
          representative_images.representative_image_path
        from visits v
        join patients p on v.site_id = p.site_id and v.patient_id = p.patient_id
        left join image_stats on v.visit_id = image_stats.visit_id
        left join representative_images on v.visit_id = representative_images.visit_id
        where v.site_id = ? and v.patient_id in ({placeholders}) and {visible_case_condition}
        order by image_stats.latest_image_uploaded_at desc, v.created_at desc, v.visit_index desc
        "
    );

    let mut cases_by_patient: HashMap<String, Vec<(CaseSummaryRecord, Option<String>)>> =
        HashMap::new();
    let mut stmt = conn.prepare(&case_sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(case_params), |row| {
            let record = case_summary_from_row(row)?;
            let representative_image_path =
                row.get::<_, Option<String>>("representative_image_path")?;
            Ok((record, representative_image_path))
        })
        .map_err(|error| error.to_string())?;

    for row in rows {
        let (record, representative_image_path) = row.map_err(|error| error.to_string())?;
        cases_by_patient
            .entry(record.patient_id.clone())
            .or_default()
            .push((record, representative_image_path));
    }
    Ok(cases_by_patient)
}

#[cfg(test)]
mod desktop_patient_board_case_query_tests {
    use rusqlite::{params, Connection};

    use super::query_patient_board_cases;

    fn setup_patient_board_case_test_db() -> Connection {
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
              created_at text,
              soft_deleted_at text
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
              quality_scores text,
              soft_deleted_at text
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
    fn query_patient_board_cases_hides_raw_inventory_sync_non_positive_rows() {
        let conn = setup_patient_board_case_test_db();
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
                "visit_visible",
                "ManualCase",
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
        conn.execute(
            "insert into images (site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative, uploaded_at, lesion_prompt_box, quality_scores)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_visible",
                "img_visible",
                "PAT-001",
                "ManualCase",
                "white",
                "manual.png",
                1_i64,
                "2026-04-07T02:00:00+00:00",
                Option::<&str>::None,
                Option::<&str>::None,
            ],
        )
        .expect("insert image");

        let cases_by_patient =
            query_patient_board_cases(&conn, "site_a", &[String::from("PAT-001")]).expect("patient cases");
        let case_visit_dates = cases_by_patient
            .get("PAT-001")
            .expect("patient cases present")
            .iter()
            .map(|(record, _)| record.visit_date.as_str())
            .collect::<Vec<_>>();

        assert_eq!(case_visit_dates, vec!["ManualCase"]);
    }

    #[test]
    fn query_patient_board_cases_hides_soft_deleted_rows() {
        let conn = setup_patient_board_case_test_db();
        conn.execute(
            "insert into visits (
               site_id, visit_id, patient_id, patient_reference_id, visit_date, visit_index, actual_visit_date,
               culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
               contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
               smear_result, polymicrobial, research_registry_status, research_registry_updated_at,
               research_registry_updated_by, research_registry_source, created_at, soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_soft_deleted",
                "PAT-001",
                Option::<&str>::None,
                "SoftDeleted",
                1_i64,
                Option::<&str>::None,
                "positive",
                1_i64,
                "fungal",
                "Fusarium",
                "[]",
                "none",
                "[]",
                "",
                "active",
                1_i64,
                0_i64,
                "",
                0_i64,
                "included",
                Option::<&str>::None,
                Option::<&str>::None,
                Option::<&str>::None,
                "2026-04-07T00:00:00+00:00",
                "2026-04-08T00:00:00+00:00",
            ],
        )
        .expect("insert soft-deleted visit");
        conn.execute(
            "insert into images (
               site_id, visit_id, image_id, patient_id, visit_date, view, image_path, is_representative,
               uploaded_at, lesion_prompt_box, quality_scores, soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_soft_deleted",
                "img_soft_deleted",
                "PAT-001",
                "SoftDeleted",
                "white",
                "soft_deleted.png",
                1_i64,
                "2026-04-07T00:00:00+00:00",
                Option::<&str>::None,
                Option::<&str>::None,
                "2026-04-08T00:00:00+00:00",
            ],
        )
        .expect("insert soft-deleted image");
        conn.execute(
            "insert into visits (
               site_id, visit_id, patient_id, patient_reference_id, visit_date, visit_index, actual_visit_date,
               culture_status, culture_confirmed, culture_category, culture_species, additional_organisms,
               contact_lens_use, predisposing_factor, other_history, visit_status, active_stage, is_initial_visit,
               smear_result, polymicrobial, research_registry_status, research_registry_updated_at,
               research_registry_updated_by, research_registry_source, created_at, soft_deleted_at
             ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                "site_a",
                "visit_visible",
                "PAT-001",
                Option::<&str>::None,
                "Visible",
                2_i64,
                Option::<&str>::None,
                "negative",
                0_i64,
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
                "analysis_only",
                Option::<&str>::None,
                Option::<&str>::None,
                Option::<&str>::None,
                "2026-04-07T01:00:00+00:00",
                Option::<&str>::None,
            ],
        )
        .expect("insert visible visit");

        let cases_by_patient =
            query_patient_board_cases(&conn, "site_a", &[String::from("PAT-001")]).expect("patient cases");
        let case_visit_dates = cases_by_patient
            .get("PAT-001")
            .expect("patient cases present")
            .iter()
            .map(|(record, _)| record.visit_date.as_str())
            .collect::<Vec<_>>();

        assert_eq!(case_visit_dates, vec!["Visible"]);
    }
}
