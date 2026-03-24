use std::env;
use std::path::{Path, PathBuf};

const SAFE_DESKTOP_EMBEDDED_ENV_KEYS: &[&str] = &[
    "KERA_CONTROL_PLANE_API_BASE_URL",
    "NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL",
    "KERA_LOCAL_API_JWT_PUBLIC_KEY_B64",
    "KERA_LOCAL_API_JWT_ISSUER",
    "KERA_LOCAL_API_JWT_AUDIENCE",
    "KERA_GOOGLE_DESKTOP_CLIENT_ID",
    "NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID",
    "KERA_GOOGLE_CLIENT_ID",
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
    "KERA_GOOGLE_CLIENT_IDS",
];

fn project_env_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(".env.local")
}

fn load_root_env_values(path: &Path) -> Vec<(String, String)> {
    let mut items = Vec::new();
    let Ok(entries) = dotenvy::from_path_iter(path) else {
        return items;
    };
    for entry in entries.flatten() {
        items.push(entry);
    }
    items
}

fn main() {
    let env_path = project_env_path();
    println!("cargo:rerun-if-changed={}", env_path.display());

    for key in SAFE_DESKTOP_EMBEDDED_ENV_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let root_env_values = load_root_env_values(&env_path);
    for key in SAFE_DESKTOP_EMBEDDED_ENV_KEYS {
        let value = env::var(key)
            .ok()
            .or_else(|| {
                root_env_values
                    .iter()
                    .find(|(candidate_key, _)| candidate_key == key)
                    .map(|(_, candidate_value)| candidate_value.clone())
            })
            .unwrap_or_default();
        if !value.trim().is_empty() {
            println!("cargo:rustc-env={key}={value}");
        }
    }

    tauri_build::build()
}
