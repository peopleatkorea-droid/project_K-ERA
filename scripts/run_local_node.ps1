param(
    [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$streamlitExe = Join-Path $repoRoot ".venv\Scripts\streamlit.exe"
$appPath = Join-Path $repoRoot "app.py"
$setupScript = Join-Path $repoRoot "scripts\setup_local_node.ps1"

if (-not (Test-Path $streamlitExe)) {
    Write-Host "[K-ERA] Local node is not initialized. Running setup first." -ForegroundColor Yellow
    & $setupScript -PythonExe $PythonExe
}

Write-Host "[K-ERA] Starting local node" -ForegroundColor Cyan
Push-Location $repoRoot
try {
    & $streamlitExe run $appPath
}
finally {
    Pop-Location
}
