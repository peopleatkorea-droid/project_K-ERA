use super::*;

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn score_from_band(value: f64, low: f64, ideal_low: f64, ideal_high: f64, high: f64) -> f64 {
    if value <= low || value >= high {
        return 0.0;
    }
    if (ideal_low..=ideal_high).contains(&value) {
        return 1.0;
    }
    if value < ideal_low {
        return clamp01((value - low) / (ideal_low - low).max(1e-6));
    }
    clamp01((high - value) / (high - ideal_high).max(1e-6))
}

fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10f64.powi(digits);
    (value * factor).round() / factor
}

pub(super) fn score_slit_lamp_image(image_path: &Path, view: &str) -> Result<JsonValue, String> {
    let rgb = image::open(image_path)
        .map_err(|error| error.to_string())?
        .to_rgb8();
    let (width, height) = rgb.dimensions();
    let width_usize = width as usize;
    let height_usize = height as usize;
    let mut gray = vec![0.0_f64; width_usize * height_usize];
    let mut gray_sum = 0.0_f64;
    let mut red_sum = 0.0_f64;
    let mut green_sum = 0.0_f64;
    let mut blue_sum = 0.0_f64;
    let mut saturation_sum = 0.0_f64;

    for (index, pixel) in rgb.pixels().enumerate() {
        let [r, g, b] = pixel.0;
        let r_f = f64::from(r);
        let g_f = f64::from(g);
        let b_f = f64::from(b);
        let gray_value = 0.299 * r_f + 0.587 * g_f + 0.114 * b_f;
        gray[index] = gray_value;
        gray_sum += gray_value;
        red_sum += r_f;
        green_sum += g_f;
        blue_sum += b_f;
        let max_channel = r_f.max(g_f).max(b_f);
        let min_channel = r_f.min(g_f).min(b_f);
        saturation_sum += (max_channel - min_channel) / 255.0;
    }

    let pixel_count = (width_usize * height_usize).max(1) as f64;
    let brightness = gray_sum / pixel_count;
    let contrast = (gray
        .iter()
        .map(|value| {
            let delta = *value - brightness;
            delta * delta
        })
        .sum::<f64>()
        / pixel_count)
        .sqrt();

    let blur_variance = if width_usize >= 3 && height_usize >= 3 {
        let mut laplacians = Vec::with_capacity((width_usize - 2) * (height_usize - 2));
        for y in 1..(height_usize - 1) {
            for x in 1..(width_usize - 1) {
                let center = gray[y * width_usize + x] / 255.0;
                let up = gray[(y - 1) * width_usize + x] / 255.0;
                let down = gray[(y + 1) * width_usize + x] / 255.0;
                let left = gray[y * width_usize + (x - 1)] / 255.0;
                let right = gray[y * width_usize + (x + 1)] / 255.0;
                laplacians.push(-4.0 * center + up + down + left + right);
            }
        }
        let mean = laplacians.iter().sum::<f64>() / (laplacians.len().max(1) as f64);
        laplacians
            .iter()
            .map(|value| {
                let delta = *value - mean;
                delta * delta
            })
            .sum::<f64>()
            / (laplacians.len().max(1) as f64)
    } else {
        0.0
    };

    let min_side = f64::from(width.min(height));
    let blur_score = clamp01((1.0 + blur_variance * 10000.0).ln() / 4.5);
    let exposure_score = score_from_band(brightness, 20.0, 55.0, 190.0, 245.0);
    let contrast_score = score_from_band(contrast, 8.0, 24.0, 88.0, 120.0);
    let size_score = clamp01(min_side / 768.0);

    let red_mean = red_sum / pixel_count;
    let green_mean = green_sum / pixel_count;
    let blue_mean = blue_sum / pixel_count;
    let channel_total = (red_mean + green_mean + blue_mean).max(1e-6);
    let green_ratio = green_mean / channel_total;
    let saturation = saturation_sum / pixel_count;

    let normalized_view = view.trim().to_ascii_lowercase();
    let view_score = if normalized_view == "fluorescein" {
        let green_score = score_from_band(green_ratio, 0.22, 0.34, 0.48, 0.58);
        let saturation_score = score_from_band(saturation, 0.05, 0.18, 0.65, 0.9);
        0.6 * green_score + 0.4 * saturation_score
    } else {
        let green_penalty = clamp01((green_ratio - 0.333).abs() / 0.16);
        let saturation_score = score_from_band(saturation, 0.02, 0.08, 0.45, 0.85);
        0.55 * (1.0 - green_penalty) + 0.45 * saturation_score
    };

    let overall = 0.35 * blur_score
        + 0.25 * exposure_score
        + 0.20 * contrast_score
        + 0.10 * size_score
        + 0.10 * view_score;

    Ok(json!({
        "quality_score": round_to(overall * 100.0, 1),
        "view_score": round_to(view_score * 100.0, 1),
        "component_scores": {
            "blur": round_to(blur_score * 100.0, 1),
            "exposure": round_to(exposure_score * 100.0, 1),
            "contrast": round_to(contrast_score * 100.0, 1),
            "resolution": round_to(size_score * 100.0, 1),
            "view_consistency": round_to(view_score * 100.0, 1),
        },
        "image_stats": {
            "width": i64::from(width),
            "height": i64::from(height),
            "brightness_mean": round_to(brightness, 2),
            "contrast_std": round_to(contrast, 2),
            "blur_variance": round_to(blur_variance, 6),
            "green_ratio": round_to(green_ratio, 4),
            "saturation_mean": round_to(saturation, 4),
        }
    }))
}
