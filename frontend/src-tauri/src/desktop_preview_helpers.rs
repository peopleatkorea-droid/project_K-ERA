pub(super) fn preview_cache_path(
    site_id: &str,
    image_id: &str,
    max_side: u32,
) -> Result<PathBuf, String> {
    Ok(site_dir(site_id)?
        .join("artifacts")
        .join("image_previews")
        .join(max_side.to_string())
        .join(format!("{image_id}.jpg")))
}

#[derive(Debug, Clone)]
pub(super) struct WarmPreviewJob {
    pub(super) site_id: String,
    pub(super) image_id: String,
    pub(super) image_path: PathBuf,
    pub(super) max_side: u32,
}

fn preview_warm_state() -> &'static Mutex<HashSet<String>> {
    PREVIEW_WARM_STATE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn preview_warm_queue() -> &'static Mutex<std::collections::VecDeque<(String, WarmPreviewJob)>> {
    static PREVIEW_WARM_QUEUE: OnceLock<Mutex<std::collections::VecDeque<(String, WarmPreviewJob)>>> =
        OnceLock::new();
    PREVIEW_WARM_QUEUE.get_or_init(|| Mutex::new(std::collections::VecDeque::new()))
}

fn preview_warm_worker_active() -> &'static Mutex<bool> {
    static PREVIEW_WARM_WORKER_ACTIVE: OnceLock<Mutex<bool>> = OnceLock::new();
    PREVIEW_WARM_WORKER_ACTIVE.get_or_init(|| Mutex::new(false))
}

fn preview_job_key(site_id: &str, image_id: &str, max_side: u32) -> String {
    format!("{site_id}::{image_id}::{max_side}")
}

pub(super) fn ensure_preview(
    image_path: &Path,
    preview_path: &Path,
    max_side: u32,
) -> Result<(), String> {
    if preview_path.exists() {
        return Ok(());
    }
    if !image_path.exists() {
        return Err(format!(
            "Image file not found on disk: {}",
            image_path.display()
        ));
    }
    if let Some(parent) = preview_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let image = image::open(image_path).map_err(|error| error.to_string())?;
    let clamped_side = max_side.clamp(96, 1024);
    let thumbnail = image.thumbnail(clamped_side, clamped_side);
    thumbnail
        .save_with_format(preview_path, ImageFormat::Jpeg)
        .map_err(|error| error.to_string())
}

pub(super) fn existing_file_path_string(path: &Path) -> Option<String> {
    if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

pub(super) fn cached_preview_file_path(
    site_id: &str,
    image_id: &str,
    max_side: u32,
) -> Result<Option<String>, String> {
    let preview_path = preview_cache_path(site_id, image_id, max_side)?;
    Ok(existing_file_path_string(&preview_path))
}

pub(super) fn maybe_queue_preview_job(
    site_id: &str,
    image_id: &str,
    image_path: &Path,
    max_side: u32,
) -> Option<WarmPreviewJob> {
    let preview_path = preview_cache_path(site_id, image_id, max_side).ok()?;
    if preview_path.exists() || !image_path.exists() {
        return None;
    }
    Some(WarmPreviewJob {
        site_id: site_id.to_string(),
        image_id: image_id.to_string(),
        image_path: image_path.to_path_buf(),
        max_side,
    })
}

pub(super) fn queue_preview_generation_batch(jobs: Vec<WarmPreviewJob>) {
    if jobs.is_empty() {
        return;
    }
    let mut queued_jobs = Vec::new();
    {
        let mut queued = preview_warm_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for job in jobs {
            let job_key = preview_job_key(&job.site_id, &job.image_id, job.max_side);
            if queued.insert(job_key.clone()) {
                queued_jobs.push((job_key, job));
            }
        }
    }
    if queued_jobs.is_empty() {
        return;
    }

    {
        let mut queue = preview_warm_queue()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        queue.extend(queued_jobs);
    }

    let should_spawn_worker = {
        let mut worker_active = preview_warm_worker_active()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *worker_active {
            false
        } else {
            *worker_active = true;
            true
        }
    };
    if !should_spawn_worker {
        return;
    }

    std::thread::spawn(|| loop {
        let next_job = {
            let mut queue = preview_warm_queue()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            queue.pop_front()
        };

        let Some((job_key, job)) = next_job else {
            let queue_is_empty = {
                let queue = preview_warm_queue()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                queue.is_empty()
            };
            if queue_is_empty {
                let mut worker_active = preview_warm_worker_active()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                *worker_active = false;
                return;
            }
            std::thread::yield_now();
            continue;
        };

        if let Ok(preview_path) = preview_cache_path(&job.site_id, &job.image_id, job.max_side) {
            let _ = ensure_preview(&job.image_path, &preview_path, job.max_side);
        }
        let mut queued = preview_warm_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        queued.remove(&job_key);
        drop(queued);

        let has_more_work = {
            let queue = preview_warm_queue()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            !queue.is_empty()
        };
        if has_more_work {
            std::thread::sleep(Duration::from_millis(12));
        } else {
            std::thread::yield_now();
        }
    });
}
