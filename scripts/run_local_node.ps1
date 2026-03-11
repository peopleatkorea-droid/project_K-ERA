param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiScript = Join-Path $repoRoot "scripts\run_api_server.ps1"
$webScript = Join-Path $repoRoot "scripts\run_web_frontend.ps1"
$powershellExe = (Get-Command powershell).Source

Write-Host "[K-ERA] Starting API server window" -ForegroundColor Cyan
Start-Process -FilePath $powershellExe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $apiScript,
    "-Port", $ApiPort
)

Write-Host "[K-ERA] Starting web frontend window" -ForegroundColor Cyan
Start-Process -FilePath $powershellExe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-File", $webScript,
    "-ApiBaseUrl", $ApiBaseUrl,
    "-Port", $WebPort
)

Write-Host "[K-ERA] Opening browser at http://127.0.0.1:$WebPort" -ForegroundColor Green
Start-Process "http://127.0.0.1:$WebPort"
