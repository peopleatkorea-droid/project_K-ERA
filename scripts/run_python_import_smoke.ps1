param(
    [string[]]$Modules = @(
        "numpy",
        "PIL",
        "kera_research",
        "kera_research.api.app",
        "kera_research.services.modeling"
    )
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host ""
    Write-Host "[ERROR] Python virtual environment not found." -ForegroundColor Red
    Write-Host "        Please run: .\scripts\setup_local_node.ps1" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Set-Location $repoRoot
$env:PYTHONPATH = "src"

$pythonScript = @'
import importlib
import os
import sys

print(f"[K-ERA] Python: {sys.executable}")
print(f"[K-ERA] PYTHONPATH: {os.environ.get('PYTHONPATH', '')}")

modules = os.environ.get("KERA_SMOKE_MODULES", "").split("|")
modules = [name.strip() for name in modules if name.strip()]
if not modules:
    raise SystemExit("No modules were provided for smoke import.")

loaded = []
for name in modules:
    importlib.import_module(name)
    loaded.append(name)
    print(f"[K-ERA] Imported: {name}")

print(f"[K-ERA] Smoke import passed ({len(loaded)} modules).")
'@

$env:KERA_SMOKE_MODULES = ($Modules | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() }) -join "|"

try {
    & $venvPython -c $pythonScript
} catch {
    Write-Host ""
    Write-Host "[ERROR] Python import smoke failed: $_" -ForegroundColor Red
    Write-Host ""
    exit 1
} finally {
    [Environment]::SetEnvironmentVariable("KERA_SMOKE_MODULES", $null, "Process")
}
