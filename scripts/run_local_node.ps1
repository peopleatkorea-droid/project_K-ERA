param(
    [string]$ApiBaseUrl = "http://localhost:8000",
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiScript = Join-Path $repoRoot "scripts\run_api_server.ps1"
$webScript = Join-Path $repoRoot "scripts\run_web_frontend.ps1"
$powershellExe = (Get-Command powershell).Source

function Test-PortAvailable {
    param(
        [int]$CandidatePort
    )

    return -not (Get-NetTCPConnection -LocalPort $CandidatePort -State Listen -ErrorAction SilentlyContinue)
}

function Resolve-WebPort {
    param(
        [int]$PreferredPort
    )

    for ($candidate = $PreferredPort; $candidate -lt ($PreferredPort + 20); $candidate++) {
        if (Test-PortAvailable -CandidatePort $candidate) {
            return $candidate
        }
    }

    throw "No available frontend port found between $PreferredPort and $($PreferredPort + 19)."
}

$resolvedWebPort = Resolve-WebPort -PreferredPort $WebPort

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
    "-Port", $resolvedWebPort
)

if ($resolvedWebPort -ne $WebPort) {
    Write-Host "[K-ERA] Port $WebPort is already in use. Opening browser at http://localhost:$resolvedWebPort" -ForegroundColor Yellow
    Write-Host "[K-ERA] If Google Sign-In is enabled, add http://localhost:$resolvedWebPort to Authorized JavaScript origins." -ForegroundColor Yellow
}
else {
    Write-Host "[K-ERA] Opening browser at http://localhost:$resolvedWebPort" -ForegroundColor Green
}
Start-Process "http://localhost:$resolvedWebPort"
