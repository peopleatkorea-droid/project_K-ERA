use super::*;
use std::time::UNIX_EPOCH;
use zip::ZipArchive;

const BUNDLED_PYTHON_RUNTIME_ARCHIVE: &str = "python-runtime.zip";
const BUNDLED_PYTHON_RUNTIME_DIR_NAME: &str = "python";
const BUNDLED_PYTHON_RUNTIME_MARKER: &str = ".bundled-runtime-source";
pub(super) const LOW_SPACE_ERROR_PREFIX: &str = "Desktop first-launch runtime extraction requires more free space";
const ESTIMATED_CPU_INSTALL_FOOTPRINT_BYTES: u64 = 1_061_180_770;
const ESTIMATED_CPU_RUNTIME_EXTRACT_BYTES: u64 = 1_334_122_879;
const RUNTIME_FREE_SPACE_HEADROOM_BYTES: u64 = 536_870_912;

static BUNDLED_RUNTIME_PREP_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Debug, Serialize, Clone)]
pub(super) struct DesktopBundledRuntimeDiskNotice {
    pub(super) estimated_install_footprint_bytes: u64,
    pub(super) estimated_first_launch_runtime_bytes: u64,
    pub(super) estimated_total_after_first_launch_bytes: u64,
    pub(super) recommended_runtime_free_bytes: u64,
    pub(super) runtime_drive_free_bytes: Option<u64>,
    pub(super) runtime_probe_path: Option<String>,
    pub(super) first_launch_runtime_pending: bool,
    pub(super) runtime_space_ok: Option<bool>,
}

fn bundled_runtime_prep_error_state() -> &'static Mutex<Option<String>> {
    BUNDLED_RUNTIME_PREP_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_bundled_runtime_prep_error(message: Option<String>) {
    if let Ok(mut guard) = bundled_runtime_prep_error_state().lock() {
        *guard = message;
    }
}

pub(super) fn last_bundled_runtime_prep_error() -> Option<String> {
    bundled_runtime_prep_error_state()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn format_approx_gib(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
}

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

fn bundled_runtime_archive_uncompressed_bytes(archive_path: &Path) -> Result<u64, String> {
    let archive_file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(archive_file).map_err(|error| error.to_string())?;
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        total = total.saturating_add(entry.size());
    }
    Ok(total)
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

fn bundled_runtime_space_probe() -> Option<DesktopBundledRuntimeDiskNotice> {
    if !desktop_packaged_mode() {
        return None;
    }
    let Some(archive_path) = bundled_python_runtime_archive_path() else {
        return None;
    };
    let source_stamp = bundled_runtime_source_stamp(&archive_path).ok()?;
    let target_dir = extracted_python_runtime_dir().ok()?;
    let runtime_root = desktop_runtime_dir().ok()?;
    let estimated_first_launch_runtime_bytes =
        bundled_runtime_archive_uncompressed_bytes(&archive_path).unwrap_or(ESTIMATED_CPU_RUNTIME_EXTRACT_BYTES);
    let first_launch_runtime_pending = !extracted_runtime_matches(&target_dir, &source_stamp);
    let runtime_drive_free_bytes = fs4::available_space(&runtime_root).ok();
    let recommended_runtime_free_bytes =
        estimated_first_launch_runtime_bytes.saturating_add(RUNTIME_FREE_SPACE_HEADROOM_BYTES);
    let runtime_space_ok = runtime_drive_free_bytes.map(|free| {
        !first_launch_runtime_pending || free >= recommended_runtime_free_bytes
    });

    Some(DesktopBundledRuntimeDiskNotice {
        estimated_install_footprint_bytes: ESTIMATED_CPU_INSTALL_FOOTPRINT_BYTES,
        estimated_first_launch_runtime_bytes,
        estimated_total_after_first_launch_bytes: ESTIMATED_CPU_INSTALL_FOOTPRINT_BYTES
            .saturating_add(estimated_first_launch_runtime_bytes),
        recommended_runtime_free_bytes,
        runtime_drive_free_bytes,
        runtime_probe_path: Some(runtime_root.to_string_lossy().to_string()),
        first_launch_runtime_pending,
        runtime_space_ok,
    })
}

pub(super) fn bundled_runtime_disk_notice() -> Option<DesktopBundledRuntimeDiskNotice> {
    bundled_runtime_space_probe()
}

fn bundled_runtime_low_space_error(notice: &DesktopBundledRuntimeDiskNotice) -> Option<String> {
    if !notice.first_launch_runtime_pending {
        return None;
    }
    if notice.runtime_space_ok != Some(false) {
        return None;
    }
    let free = notice.runtime_drive_free_bytes?;
    let probe_path = notice.runtime_probe_path.as_deref().unwrap_or("the desktop runtime drive");
    Some(format!(
        "{LOW_SPACE_ERROR_PREFIX}. First launch needs about {} free under {} to unpack the bundled Python runtime ({} free detected). The CPU desktop build uses about {} total after first launch.",
        format_approx_gib(notice.recommended_runtime_free_bytes),
        probe_path,
        format_approx_gib(free),
        format_approx_gib(notice.estimated_total_after_first_launch_bytes),
    ))
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
        set_bundled_runtime_prep_error(None);
        return Ok(());
    }

    let Some(archive_path) = bundled_python_runtime_archive_path() else {
        set_bundled_runtime_prep_error(None);
        return Ok(());
    };

    if let Some(notice) = bundled_runtime_space_probe() {
        if let Some(message) = bundled_runtime_low_space_error(&notice) {
            set_bundled_runtime_prep_error(Some(message.clone()));
            return Err(message);
        }
    }

    let source_stamp = bundled_runtime_source_stamp(&archive_path)?;
    let runtime_root = desktop_runtime_dir()?;
    let target_dir = extracted_python_runtime_dir()?;
    if extracted_runtime_matches(&target_dir, &source_stamp) {
        set_bundled_runtime_prep_error(None);
        return Ok(());
    }

    let temp_dir = runtime_root.join(format!(
        "{}.extract.{}",
        BUNDLED_PYTHON_RUNTIME_DIR_NAME,
        Uuid::new_v4()
    ));
    let backup_dir = runtime_root.join(format!("{BUNDLED_PYTHON_RUNTIME_DIR_NAME}.previous"));

    if backup_dir.exists() {
        if let Err(error) = fs::remove_dir_all(&backup_dir) {
            let message = error.to_string();
            set_bundled_runtime_prep_error(Some(message.clone()));
            return Err(message);
        }
    }
    if temp_dir.exists() {
        if let Err(error) = fs::remove_dir_all(&temp_dir) {
            let message = error.to_string();
            set_bundled_runtime_prep_error(Some(message.clone()));
            return Err(message);
        }
    }

    if let Err(error) = extract_archive_to_directory(&archive_path, &temp_dir) {
        set_bundled_runtime_prep_error(Some(error.clone()));
        return Err(error);
    }
    if let Err(error) = fs::write(extracted_runtime_marker_path(&temp_dir), format!("{source_stamp}\n")) {
        let message = error.to_string();
        set_bundled_runtime_prep_error(Some(message.clone()));
        return Err(message);
    }

    if target_dir.exists() {
        if let Err(error) = fs::rename(&target_dir, &backup_dir) {
            let message = error.to_string();
            set_bundled_runtime_prep_error(Some(message.clone()));
            return Err(message);
        }
    }
    if let Err(error) = fs::rename(&temp_dir, &target_dir) {
        let message = error.to_string();
        set_bundled_runtime_prep_error(Some(message.clone()));
        return Err(message);
    }
    if backup_dir.exists() {
        if let Err(error) = fs::remove_dir_all(&backup_dir) {
            let message = error.to_string();
            set_bundled_runtime_prep_error(Some(message.clone()));
            return Err(message);
        }
    }

    set_bundled_runtime_prep_error(None);
    Ok(())
}
