param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "Python virtual environment not found. Run .\scripts\setup_local_node.ps1 first."
}

$env:PYTHONPATH = "src"

& ".venv\Scripts\python.exe" -m uvicorn kera_research.api.app:app --host $HostAddress --port $Port --reload
