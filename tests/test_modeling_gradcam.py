import numpy as np
import torch

from kera_research.services.modeling_gradcam import (
    cam_array_from_tensors,
    normalize_cam_feature_map,
    overlay_heatmap,
)


def test_normalize_cam_feature_map_keeps_channel_first_tensor_shape():
    tensor = torch.zeros((96, 7, 7), dtype=torch.float32)

    normalized = normalize_cam_feature_map(tensor)

    assert tuple(normalized.shape) == (96, 7, 7)


def test_normalize_cam_feature_map_moves_channel_last_tensor_to_channel_first():
    tensor = torch.zeros((7, 7, 96), dtype=torch.float32)

    normalized = normalize_cam_feature_map(tensor)

    assert tuple(normalized.shape) == (96, 7, 7)


def test_normalize_cam_feature_map_moves_middle_channel_axis_to_front():
    tensor = torch.zeros((7, 96, 7), dtype=torch.float32)

    normalized = normalize_cam_feature_map(tensor)

    assert tuple(normalized.shape) == (96, 7, 7)


def test_cam_array_from_tensors_produces_square_spatial_map_for_convnext_layout():
    activation = torch.zeros((1, 7, 7, 768), dtype=torch.float32)
    gradient = torch.zeros((1, 7, 7, 768), dtype=torch.float32)
    activation[0, 3, 4, 10] = 2.0
    gradient[0, 3, 4, 10] = 1.0

    cam = cam_array_from_tensors(None, activation, gradient)

    assert cam.shape == (7, 7)
    assert cam[3, 4] == cam.max()
    assert cam[3, 4] > 0.0


def test_overlay_heatmap_emphasizes_hotspot_over_low_activation_bands():
    original = np.full((128, 128, 3), 120, dtype=np.uint8)
    heatmap = np.zeros((8, 8), dtype=np.float32)
    heatmap[1, :] = 0.45
    heatmap[4, 4] = 1.0

    overlay = overlay_heatmap(None, original, heatmap)

    hotspot_pixel = overlay[72, 72].astype(np.int16)
    low_band_pixel = overlay[20, 72].astype(np.int16)
    original_pixel = original[72, 72].astype(np.int16)

    hotspot_delta = int(hotspot_pixel[0] - original_pixel[0]) + int(
        hotspot_pixel[1] - original_pixel[1]
    )
    band_delta = int(low_band_pixel[0] - original_pixel[0]) + int(
        low_band_pixel[1] - original_pixel[1]
    )

    assert hotspot_delta > band_delta
