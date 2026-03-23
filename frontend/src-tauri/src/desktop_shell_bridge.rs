use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct OpenDesktopPathRequest {
    pub(super) path: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct PickDesktopDirectoryRequest {
    pub(super) title: Option<String>,
    pub(super) default_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct GoogleOAuthServerResponse {
    pub(super) port: u16,
}

pub(super) fn open_path_in_shell(path: &Path) -> Result<(), String> {
    let resolved = if path.exists() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    };
    if !resolved.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        if path.exists() && path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(&resolved);
        }
        command.spawn().map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if path.exists() && path.is_file() {
            command.arg("-R").arg(path);
        } else {
            command.arg(&resolved);
        }
        command.spawn().map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&resolved)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("Opening desktop paths is not supported on this platform.".to_string())
}

pub(super) fn open_external_url_in_browser(url: &str) -> Result<(), String> {
    let parsed = HttpUrl::parse(url).map_err(|error| error.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http and https URLs are supported.".to_string()),
    }

    #[cfg(windows)]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", parsed.as_str()])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(parsed.as_str())
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("Opening external URLs is not supported on this platform.".to_string())
}

#[tauri::command]
pub(super) fn open_desktop_path(payload: OpenDesktopPathRequest) -> Result<(), String> {
    let normalized = payload.path.trim();
    if normalized.is_empty() {
        return Err("Path is required.".to_string());
    }
    open_path_in_shell(&PathBuf::from(normalized))
}

#[tauri::command]
pub(super) fn open_external_url(url: String) -> Result<(), String> {
    let normalized = url.trim();
    if normalized.is_empty() {
        return Err("URL is required.".to_string());
    }
    open_external_url_in_browser(normalized)
}

#[tauri::command]
pub(super) fn start_google_oauth_server(window: Window) -> Result<GoogleOAuthServerResponse, String> {
    let listener_window = window.clone();
    let port = start_oauth(move |url| {
        let _ = listener_window.emit(GOOGLE_OAUTH_REDIRECT_EVENT, url);
    })
    .map_err(|error| error.to_string())?;
    Ok(GoogleOAuthServerResponse { port })
}

#[tauri::command]
pub(super) fn cancel_google_oauth_server(port: u16) -> Result<(), String> {
    cancel_oauth(port).map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) fn pick_desktop_directory(
    payload: PickDesktopDirectoryRequest,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Select a directory");
    dialog = dialog.set_title(title);
    if let Some(default_path) = payload
        .default_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let candidate = PathBuf::from(default_path);
        let start_dir = if candidate.is_dir() {
            candidate
        } else {
            candidate
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or(candidate)
        };
        if start_dir.exists() {
            dialog = dialog.set_directory(start_dir);
        }
    }
    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}
