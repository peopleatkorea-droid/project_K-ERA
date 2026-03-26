#[cfg(windows)]
#[derive(Deserialize)]
struct WindowsProcessSnapshot {
    #[serde(rename = "ProcessId")]
    process_id: u32,
    #[serde(rename = "CommandLine")]
    command_line: String,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(untagged)]
enum WindowsProcessSnapshotResponse {
    One(WindowsProcessSnapshot),
    Many(Vec<WindowsProcessSnapshot>),
}

fn normalized_fragments(fragments: &[String]) -> Vec<String> {
    fragments
        .iter()
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
}

fn command_line_matches_all_fragments(command_line: &str, fragments: &[String]) -> bool {
    if fragments.is_empty() {
        return false;
    }
    let normalized_command_line = command_line.to_ascii_lowercase();
    fragments
        .iter()
        .all(|fragment| normalized_command_line.contains(fragment))
}

#[cfg(windows)]
fn list_windows_process_snapshots() -> Result<Vec<WindowsProcessSnapshot>, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
        ])
        .output()
        .map_err(|error| format!("Failed to inspect Windows processes: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Failed to inspect Windows processes: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "null" {
        return Ok(Vec::new());
    }
    let parsed: WindowsProcessSnapshotResponse =
        serde_json::from_str(&stdout).map_err(|error| format!("Failed to parse Windows process list: {error}"))?;
    Ok(match parsed {
        WindowsProcessSnapshotResponse::One(item) => vec![item],
        WindowsProcessSnapshotResponse::Many(items) => items,
    })
}

#[cfg(windows)]
fn terminate_windows_process(pid: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| format!("Failed to terminate process {pid}: {error}"))?;
    if !status.success() {
        return Err(format!("taskkill failed for process {pid} with status {status}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn terminate_windows_process(_pid: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn terminate_windows_processes_matching_all_fragments(fragments: &[String]) -> Result<Vec<u32>, String> {
    let normalized_fragments = normalized_fragments(fragments);
    if normalized_fragments.is_empty() {
        return Ok(Vec::new());
    }

    let mut terminated = Vec::new();
    for snapshot in list_windows_process_snapshots()? {
        if snapshot.process_id == std::process::id() {
            continue;
        }
        let normalized_command_line = snapshot.command_line.to_ascii_lowercase();
        if normalized_fragments
            .iter()
            .all(|fragment| normalized_command_line.contains(fragment))
        {
            terminate_windows_process(snapshot.process_id)?;
            terminated.push(snapshot.process_id);
        }
    }
    Ok(terminated)
}

#[cfg(not(windows))]
fn terminate_windows_processes_matching_all_fragments(_fragments: &[String]) -> Result<Vec<u32>, String> {
    Ok(Vec::new())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ManagedProcessRegistryEntry {
    role: String,
    pid: u32,
    owner: String,
    runtime_mode: String,
    backend_root: String,
    storage_dir: String,
    python_path: Option<String>,
    recorded_at: String,
}

pub(super) struct ReconnectedManagedProcess {
    pid: u32,
    python_path: Option<String>,
    recorded_at: Option<String>,
}

struct ManagedProcessCleanupContext {
    owner: String,
    runtime_mode: String,
    backend_root: String,
    storage_dir: String,
}

fn managed_process_registry_path() -> Result<PathBuf, String> {
    Ok(desktop_runtime_dir()?.join("managed-processes.json"))
}

fn load_managed_process_registry() -> Result<Vec<ManagedProcessRegistryEntry>, String> {
    let path = managed_process_registry_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let payload = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    if payload.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<ManagedProcessRegistryEntry>>(&payload)
        .map_err(|error| format!("Failed to parse managed process registry: {error}"))
}

fn save_managed_process_registry(entries: &[ManagedProcessRegistryEntry]) -> Result<(), String> {
    let path = managed_process_registry_path()?;
    let payload = serde_json::to_vec_pretty(entries)
        .map_err(|error| format!("Failed to serialize managed process registry: {error}"))?;
    fs::write(path, payload).map_err(|error| error.to_string())
}

fn current_managed_process_cleanup_context() -> Result<ManagedProcessCleanupContext, String> {
    let values = resolved_env_values();
    let backend = resolve_desktop_backend_target(&values)?;
    Ok(ManagedProcessCleanupContext {
        owner: desktop_runtime_owner(),
        runtime_mode: desktop_runtime_mode().as_str().to_string(),
        backend_root: backend.root.to_string_lossy().to_string(),
        storage_dir: resolve_storage_dir(&values).to_string_lossy().to_string(),
    })
}

fn same_path_marker(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn should_cleanup_registered_process(
    entry: &ManagedProcessRegistryEntry,
    role: &str,
    context: &ManagedProcessCleanupContext,
) -> bool {
    if !entry.role.eq_ignore_ascii_case(role) {
        return false;
    }
    if entry.owner.eq_ignore_ascii_case(&context.owner) {
        return true;
    }
    entry.runtime_mode.eq_ignore_ascii_case(&context.runtime_mode)
        && same_path_marker(&entry.backend_root, &context.backend_root)
        && same_path_marker(&entry.storage_dir, &context.storage_dir)
}

pub(super) fn register_managed_process(
    role: &str,
    pid: u32,
    python_path: Option<&str>,
) -> Result<(), String> {
    let context = current_managed_process_cleanup_context()?;
    let mut entries = load_managed_process_registry()?;
    entries.retain(|entry| entry.pid != pid);
    entries.push(ManagedProcessRegistryEntry {
        role: role.to_string(),
        pid,
        owner: context.owner,
        runtime_mode: context.runtime_mode,
        backend_root: context.backend_root,
        storage_dir: context.storage_dir,
        python_path: python_path.map(|value| value.to_string()),
        recorded_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    });
    save_managed_process_registry(&entries)
}

pub(super) fn unregister_managed_process(pid: Option<u32>) -> Result<(), String> {
    let Some(pid) = pid else {
        return Ok(());
    };
    let mut entries = load_managed_process_registry()?;
    let original_len = entries.len();
    entries.retain(|entry| entry.pid != pid);
    if entries.len() != original_len {
        save_managed_process_registry(&entries)?;
    }
    Ok(())
}

pub(super) fn cleanup_registered_managed_processes(role: &str) -> Result<Vec<u32>, String> {
    let context = current_managed_process_cleanup_context()?;
    let mut entries = load_managed_process_registry()?;
    let mut terminated = Vec::new();
    let mut retained = Vec::new();

    for entry in entries.drain(..) {
        if should_cleanup_registered_process(&entry, role, &context) {
            let _ = terminate_windows_process(entry.pid);
            terminated.push(entry.pid);
            continue;
        }
        retained.push(entry);
    }

    save_managed_process_registry(&retained)?;
    Ok(terminated)
}

#[cfg(windows)]
pub(super) fn reconnect_registered_managed_process(
    role: &str,
    fragments: &[String],
) -> Result<Option<ReconnectedManagedProcess>, String> {
    let context = current_managed_process_cleanup_context()?;
    let normalized_fragments = normalized_fragments(fragments);
    if normalized_fragments.is_empty() {
        return Ok(None);
    }

    let process_by_pid = list_windows_process_snapshots()?
        .into_iter()
        .map(|snapshot| (snapshot.process_id, snapshot))
        .collect::<HashMap<_, _>>();
    let mut entries = load_managed_process_registry()?;
    let mut retained = Vec::new();
    let mut adopted: Option<ReconnectedManagedProcess> = None;
    let mut changed = false;

    for entry in entries.drain(..) {
        if !should_cleanup_registered_process(&entry, role, &context) {
            retained.push(entry);
            continue;
        }
        let Some(snapshot) = process_by_pid.get(&entry.pid) else {
            changed = true;
            continue;
        };
        if command_line_matches_all_fragments(&snapshot.command_line, &normalized_fragments) {
            adopted = Some(ReconnectedManagedProcess {
                pid: entry.pid,
                python_path: entry.python_path.clone(),
                recorded_at: Some(entry.recorded_at.clone()),
            });
        }
        retained.push(entry);
    }

    if changed {
        save_managed_process_registry(&retained)?;
    }
    Ok(adopted)
}

#[cfg(not(windows))]
pub(super) fn reconnect_registered_managed_process(
    _role: &str,
    _fragments: &[String],
) -> Result<Option<ReconnectedManagedProcess>, String> {
    Ok(None)
}

#[cfg(windows)]
pub(super) fn find_running_process_pid_matching_all_fragments(
    fragments: &[String],
) -> Result<Option<u32>, String> {
    let normalized_fragments = normalized_fragments(fragments);
    if normalized_fragments.is_empty() {
        return Ok(None);
    }
    let mut matching = list_windows_process_snapshots()?
        .into_iter()
        .filter(|snapshot| command_line_matches_all_fragments(&snapshot.command_line, &normalized_fragments))
        .map(|snapshot| snapshot.process_id)
        .collect::<Vec<_>>();
    matching.sort_unstable();
    Ok(matching.pop())
}

#[cfg(not(windows))]
pub(super) fn find_running_process_pid_matching_all_fragments(
    _fragments: &[String],
) -> Result<Option<u32>, String> {
    Ok(None)
}

#[cfg(windows)]
pub(super) fn managed_process_pid_is_running(pid: u32) -> Result<bool, String> {
    Ok(list_windows_process_snapshots()?
        .into_iter()
        .any(|snapshot| snapshot.process_id == pid))
}

#[cfg(not(windows))]
pub(super) fn managed_process_pid_is_running(_pid: u32) -> Result<bool, String> {
    Ok(false)
}
