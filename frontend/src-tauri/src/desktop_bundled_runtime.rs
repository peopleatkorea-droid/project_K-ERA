use super::*;
use std::time::UNIX_EPOCH;
use zip::ZipArchive;

const BUNDLED_PYTHON_RUNTIME_ARCHIVE: &str = "python-runtime.zip";
const BUNDLED_PYTHON_RUNTIME_DIR_NAME: &str = "python";
const BUNDLED_PYTHON_RUNTIME_MARKER: &str = ".bundled-runtime-source";

fn bundled_python_runtime_archive_path() -> Option<PathBuf> {
    for resource_dir in desktop_resource_dir_candidates() {
        let candidate = resource_dir.join(BUNDLED_PYTHON_RUNTIME_ARCHIVE);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn bundled_runtime_source_stamp(archive_path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(archive_path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(format!("{}:{modified}", metadata.len()))
}

fn extracted_python_runtime_dir() -> Result<PathBuf, String> {
    Ok(desktop_runtime_dir()?.join(BUNDLED_PYTHON_RUNTIME_DIR_NAME))
}

fn extracted_runtime_marker_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(BUNDLED_PYTHON_RUNTIME_MARKER)
}

#[cfg(windows)]
fn extracted_python_runtime_entrypoint(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join("python.exe")
}

#[cfg(not(windows))]
fn extracted_python_runtime_entrypoint(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join("bin").join("python")
}

fn extracted_runtime_matches(runtime_dir: &Path, source_stamp: &str) -> bool {
    let entrypoint = extracted_python_runtime_entrypoint(runtime_dir);
    if !entrypoint.exists() {
        return false;
    }
    fs::read_to_string(extracted_runtime_marker_path(runtime_dir))
        .map(|value| value.trim() == source_stamp)
        .unwrap_or(false)
}

fn extract_archive_to_directory(archive_path: &Path, target_dir: &Path) -> Result<(), String> {
    let archive_file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(archive_file).map_err(|error| error.to_string())?;
    fs::create_dir_all(target_dir).map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let enclosed = entry
            .enclosed_name()
            .map(PathBuf::from)
            .ok_or_else(|| format!("Invalid bundled runtime entry: {}", entry.name()))?;
        let output_path = target_dir.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output_file = File::create(&output_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output_file).map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub(super) fn ensure_bundled_python_runtime_ready() -> Result<(), String> {
    if !desktop_packaged_mode() {
        return Ok(());
    }

    let Some(archive_path) = bundled_python_runtime_archive_path() else {
        return Ok(());
    };

    let source_stamp = bundled_runtime_source_stamp(&archive_path)?;
    let runtime_root = desktop_runtime_dir()?;
    let target_dir = extracted_python_runtime_dir()?;
    if extracted_runtime_matches(&target_dir, &source_stamp) {
        return Ok(());
    }

    let temp_dir = runtime_root.join(format!(
        "{}.extract.{}",
        BUNDLED_PYTHON_RUNTIME_DIR_NAME,
        Uuid::new_v4()
    ));
    let backup_dir = runtime_root.join(format!("{BUNDLED_PYTHON_RUNTIME_DIR_NAME}.previous"));

    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    }
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir).map_err(|error| error.to_string())?;
    }

    extract_archive_to_directory(&archive_path, &temp_dir)?;
    fs::write(extracted_runtime_marker_path(&temp_dir), format!("{source_stamp}\n"))
        .map_err(|error| error.to_string())?;

    if target_dir.exists() {
        fs::rename(&target_dir, &backup_dir).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_dir, &target_dir).map_err(|error| error.to_string())?;
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    }

    Ok(())
}
