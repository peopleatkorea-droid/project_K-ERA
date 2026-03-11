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
    & $venvPython -m uvicorn kera_research.api.app:app --host $HostAddress --port $Port --reload
} catch {
    Write-Host ""
    Write-Host "[ERROR] API server failed: $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
