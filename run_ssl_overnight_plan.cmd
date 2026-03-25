@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Missing virtual environment: .venv\Scripts\python.exe
  exit /b 1
)

".venv\Scripts\python.exe" "scripts\run_ssl_overnight_plan.py" ^
  --archive-base-dir "E:\전안부 사진" ^
  --device cuda ^
  --wait-existing-ssl-run "artifacts\ssl_runs\byol_convnext_tiny_imagenet_bg_20260325_133854" ^
  --existing-ssl-architecture convnext_tiny ^
  --ssl-architectures densenet121 swin vit dinov2 efficientnet_v2_s ^
  --benchmark-architectures densenet121 convnext_tiny vit swin efficientnet_v2_s dinov2 dinov2_mil dual_input_concat

exit /b %errorlevel%
