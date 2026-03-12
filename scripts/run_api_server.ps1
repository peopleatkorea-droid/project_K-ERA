param(
    [string]$HostAddress = "localhost",
    [int]$Port = 8000
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"

. (Join-Path $PSScriptRoot "load_dev_env.ps1")
Import-LocalEnv -Path (Join-Path $repoRoot ".env.local")

if (-not $env:KERA_GOOGLE_CLIENT_ID -and $env:NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    $env:KERA_GOOGLE_CLIENT_ID = $env:NEXT_PUBLIC_GOOGLE_CLIENT_ID
}

# Force the API process back onto the original MedSAM path unless the code is
# changed again intentionally. This also clears stale Swin-LiteMedSAM overrides
# that may still be inherited from an older shell session.
$env:KERA_SEGMENTATION_BACKEND = "medsam"
$env:SEGMENTATION_BACKEND = "medsam"
foreach ($name in @(
    "KERA_SEGMENTATION_ROOT",
    "SEGMENTATION_ROOT",
    "KERA_SEGMENTATION_SCRIPT",
    "SEGMENTATION_SCRIPT",
    "KERA_SEGMENTATION_CHECKPOINT",
    "SEGMENTATION_CHECKPOINT",
    "MEDSAM_SCRIPT",
    "MEDSAM_CHECKPOINT"
)) {
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
}

if (-not (Test-Path $venvPython)) {
    Write-Host ""
    Write-Host "[ERROR] Python virtual environment not found." -ForegroundColor Red
    Write-Host "        Please run: .\scripts\setup_local_node.ps1" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Set-Location $repoRoot
$env:PYTHONPATH = "src"

Write-Host "[K-ERA] Starting API server on port $Port ..." -ForegroundColor Cyan

try {
    # Avoid uvicorn reload worker re-spawning under a different interpreter.
    & $venvPython -m uvicorn kera_research.api.app:app --host $HostAddress --port $Port
} catch {
    Write-Host ""
    Write-Host "[ERROR] API server failed: $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
