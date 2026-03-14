param(
    [string]$Queue = ""
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"

. (Join-Path $PSScriptRoot "load_dev_env.ps1")
Import-LocalEnv -Path (Join-Path $repoRoot ".env.local")

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

$arguments = @("-m", "kera_research.worker")
if ($Queue) {
    $arguments += @("--queue", $Queue)
}

Write-Host "[K-ERA] Starting job worker..." -ForegroundColor Cyan

try {
    & $venvPython @arguments
} catch {
    Write-Host ""
    Write-Host "[ERROR] Job worker failed: $_" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
