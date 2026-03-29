#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Cursor, Seek, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{SecondsFormat, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat};
use reqwest::blocking::multipart::{Form as MultipartForm, Part as MultipartPart};
use reqwest::blocking::Client as HttpClient;
use reqwest::Method as HttpMethod;
use reqwest::Url as HttpUrl;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_oauth::cancel as cancel_oauth;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

mod desktop_diagnostics;
mod desktop_bundled_runtime;
mod desktop_analysis_commands;
mod desktop_artifact_helpers;
mod desktop_command_helpers;
mod desktop_config_store;
mod desktop_data_helpers;
mod desktop_case_artifacts;
mod desktop_case_mutations;
mod desktop_case_queries;
mod desktop_query_commands;
mod desktop_local_api_bridge;
mod desktop_image_quality;
mod desktop_job_streams;
mod desktop_local_runtime;
mod desktop_ml_sidecar;
mod desktop_runtime_commands;
mod desktop_runtime_env;
mod desktop_runtime_contract;
mod desktop_session_cache;
mod desktop_shell_bridge;
mod desktop_site_activity;

use desktop_diagnostics::*;
use desktop_bundled_runtime::*;
use desktop_analysis_commands::*;
use desktop_artifact_helpers::*;
use desktop_command_helpers::*;
use desktop_case_artifacts::*;
use desktop_config_store::*;
use desktop_case_mutations::*;
use desktop_case_queries::*;
use desktop_query_commands::*;
use desktop_data_helpers::*;
use desktop_image_quality::*;
use desktop_job_streams::*;
use desktop_local_api_bridge::*;
use desktop_local_runtime::*;
use desktop_ml_sidecar::*;
use desktop_runtime_commands::*;
use desktop_runtime_env::*;
use desktop_runtime_contract::*;
use desktop_session_cache::*;
use desktop_shell_bridge::*;
use desktop_site_activity::*;

static LOCAL_BACKEND_STATE: OnceLock<Mutex<LocalBackendRuntime>> = OnceLock::new();
static ML_SIDECAR_STATE: OnceLock<Mutex<MlSidecarRuntime>> = OnceLock::new();
static LOCAL_WORKER_STATE: OnceLock<Mutex<LocalWorkerRuntime>> = OnceLock::new();
static DESKTOP_RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static DESKTOP_RUNTIME_OWNER: OnceLock<String> = OnceLock::new();
static PREVIEW_WARM_STATE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SITE_JOB_UPDATE_EVENT: &str = "kera://site-job-update";
const LIVE_LESION_PREVIEW_UPDATE_EVENT: &str = "kera://live-lesion-preview-update";
const GOOGLE_OAUTH_REDIRECT_EVENT: &str = "kera://oauth-redirect";
const DEFAULT_CASE_REFERENCE_SALT: &str = "kera-case-reference-v1";

include!("desktop_case_request_types.rs");
include!("desktop_analysis_request_types.rs");
include!("desktop_mutation_types.rs");
include!("desktop_response_types.rs");
include!("desktop_config_types.rs");

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_oauth::init())
        .setup(|app| {
            initialize_desktop_runtime_owner();
            if let Ok(path) = app.path().resource_dir() {
                store_desktop_resource_dir(path);
            }
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.maximize();
            }
            ensure_bundled_python_runtime_ready()
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            // Ensure SQLite performance indexes exist (no-op if already present)
            ensure_data_plane_indexes();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_local_backend_status,
            get_local_worker_status,
            ensure_local_worker,
            ensure_local_backend,
            ensure_local_runtime,
            stop_local_backend,
            stop_local_worker,
            stop_local_runtime,
            get_ml_sidecar_status,
            ensure_ml_sidecar,
            stop_ml_sidecar,
            get_desktop_app_config,
            save_desktop_app_config,
            clear_desktop_app_config,
            open_desktop_path,
            open_external_url,
            export_desktop_diagnostics_bundle,
            start_google_oauth_server,
            cancel_google_oauth_server,
            pick_desktop_directory,
            request_local_json,
            request_local_binary,
            request_local_multipart,
            run_case_validation,
            run_case_validation_compare,
            run_case_ai_clinic,
            run_case_ai_clinic_similar_cases,
            run_case_contribution,
            fetch_site_job,
            list_site_jobs,
            start_site_job_event_stream,
            fetch_case_roi_preview,
            fetch_case_lesion_preview,
            start_live_lesion_preview,
            fetch_live_lesion_preview_job,
            start_live_lesion_preview_event_stream,
            fetch_image_semantic_prompt_scores,
            fetch_site_validations,
            fetch_validation_cases,
            fetch_site_model_versions,
            run_site_validation,
            run_initial_training,
            run_initial_training_benchmark,
            resume_initial_training_benchmark,
            cancel_site_job,
            clear_initial_training_benchmark_history,
            fetch_cross_validation_reports,
            run_cross_validation,
            run_ssl_pretraining,
            run_retrieval_baseline,
            fetch_ai_clinic_embedding_status,
            backfill_ai_clinic_embeddings,
            list_cases,
            get_site_activity,
            list_patients,
            lookup_patient_id,
            list_patient_board,
            list_visits,
            list_images,
            get_visit_images,
            ensure_image_previews,
            create_patient,
            update_patient,
            create_visit,
            update_visit,
            delete_visit,
            upload_image,
            delete_visit_images,
            set_representative_image,
            get_case_history,
            list_stored_case_lesion_previews,
            read_validation_artifact,
            resolve_validation_artifact_path,
            read_case_roi_preview_artifact,
            resolve_case_roi_preview_artifact_path,
            read_case_lesion_preview_artifact,
            resolve_case_lesion_preview_artifact_path,
            read_image_blob,
            load_session_cache,
            save_session_cache,
            clear_session_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running K-ERA desktop shell");
}




