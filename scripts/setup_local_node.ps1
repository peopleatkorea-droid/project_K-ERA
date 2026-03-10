param(
    [string]$PythonExe = "python",
    [string]$TorchIndexUrl = "",
    [switch]$SkipTorchInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$requirementsPath = Join-Path $repoRoot "requirements.txt"

Write-Host "[K-ERA] Local node setup started" -ForegroundColor Cyan

if (-not (Test-Path $venvPython)) {
    Write-Host "[K-ERA] Creating virtual environment at $venvPath"
    & $PythonExe -m venv $venvPath
}

Write-Host "[K-ERA] Upgrading pip/setuptools/wheel"
& $venvPython -m pip install --upgrade pip setuptools wheel

if ($SkipTorchInstall) {
    $tempRequirements = Join-Path $env:TEMP "kera_requirements_no_torch.txt"
    Get-Content $requirementsPath | Where-Object { $_ -notmatch '^torch' } | Set-Content $tempRequirements
    Write-Host "[K-ERA] Installing application packages without torch"
    & $venvPython -m pip install -r $tempRequirements
} else {
    Write-Host "[K-ERA] Installing application packages"
    & $venvPython -m pip install -r $requirementsPath
}

if ($TorchIndexUrl) {
    Write-Host "[K-ERA] Reinstalling torch using custom index: $TorchIndexUrl"
    & $venvPython -m pip install --upgrade torch --index-url $TorchIndexUrl
}

Write-Host "[K-ERA] Running health check"
@'
import importlib
packages = ["streamlit", "pandas", "plotly", "matplotlib", "numpy", "PIL", "sklearn", "torch"]
missing = []
for name in packages:
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)

if missing:
    raise SystemExit(f"Missing packages after setup: {', '.join(missing)}")

import torch
print(f"torch={torch.__version__}")
print(f"cuda_available={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"gpu_name={torch.cuda.get_device_name(0)}")
'@ | & $venvPython -

Write-Host "[K-ERA] Local node setup completed" -ForegroundColor Green
Write-Host "[K-ERA] Start with: .\scripts\run_local_node.ps1"
