fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn federation_salt_config_path() -> Option<PathBuf> {
    control_plane_dir()
        .ok()
        .map(|dir| dir.join("federation_salt.json"))
}

fn read_federation_salt_config_file() -> FederationSaltConfigFile {
    let Some(path) = federation_salt_config_path() else {
        return FederationSaltConfigFile::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return FederationSaltConfigFile::default();
    };
    serde_json::from_str::<FederationSaltConfigFile>(&raw).unwrap_or_default()
}

fn write_federation_salt_config_file(config: &FederationSaltConfigFile) -> Result<(), String> {
    let Some(path) = federation_salt_config_path() else {
        return Err("Federation salt config path is unavailable.".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())
}

fn resolve_federation_salt_config() -> FederationSaltConfigFile {
    let stored = read_federation_salt_config_file();
    let explicit_case = env_value("KERA_CASE_REFERENCE_SALT");
    let explicit_patient = env_value("KERA_PATIENT_REFERENCE_SALT");
    let explicit_public = env_value("KERA_PUBLIC_ALIAS_SALT");
    let legacy_secret = env_value("KERA_API_SECRET");

    let case_reference_salt = explicit_case
        .clone()
        .or_else(|| normalize_optional_text(stored.case_reference_salt.clone()))
        .or_else(|| legacy_secret.clone())
        .unwrap_or_else(|| DEFAULT_CASE_REFERENCE_SALT.to_string());
    let patient_reference_salt = explicit_patient
        .clone()
        .or_else(|| normalize_optional_text(stored.patient_reference_salt.clone()))
        .unwrap_or_else(|| case_reference_salt.clone());
    let public_alias_salt = explicit_public
        .clone()
        .or_else(|| normalize_optional_text(stored.public_alias_salt.clone()))
        .unwrap_or_else(|| case_reference_salt.clone());

    let source =
        if explicit_case.is_some() || explicit_patient.is_some() || explicit_public.is_some() {
            "explicit_env".to_string()
        } else if normalize_optional_text(stored.case_reference_salt.clone()).is_some() {
            normalize_optional_text(stored.source.clone()).unwrap_or_else(|| "stored".to_string())
        } else if legacy_secret.is_some() {
            "legacy_kera_api_secret".to_string()
        } else {
            "default".to_string()
        };

    let resolved = FederationSaltConfigFile {
        case_reference_salt: Some(case_reference_salt),
        patient_reference_salt: Some(patient_reference_salt),
        public_alias_salt: Some(public_alias_salt),
        source: Some(source),
    };

    if resolved != stored {
        let _ = write_federation_salt_config_file(&resolved);
    }

    resolved
}

fn patient_reference_salt() -> String {
    resolve_federation_salt_config()
        .patient_reference_salt
        .unwrap_or_else(|| DEFAULT_CASE_REFERENCE_SALT.to_string())
}

pub(super) fn make_id(prefix: &str) -> String {
    let identifier = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &identifier[..10])
}

pub(super) fn make_patient_reference_id(site_id: &str, patient_id: &str) -> String {
    let payload = format!(
        "{}::{}::{}",
        patient_reference_salt(),
        site_id.trim(),
        patient_id.trim()
    );
    let digest = Sha256::digest(payload.as_bytes());
    let hex = format!("{digest:x}");
    format!("ptref_{}", &hex[..20])
}

pub(super) fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
