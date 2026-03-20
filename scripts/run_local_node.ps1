param(
    [int]$ApiPort = 8000,
    [int]$WebPort = 3000,
    [string]$SharedApiBaseUrl = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiScript = Join-Path $repoRoot "scripts\run_api_server.ps1"
$webScript = Join-Path $repoRoot "scripts\run_web_frontend.ps1"
$workerScript = Join-Path $repoRoot "scripts\run_job_worker.ps1"

. (Join-Path $PSScriptRoot "load_dev_env.ps1")
. (Join-Path $PSScriptRoot "dev_process_helpers.ps1")
Import-LocalEnv -Path (Join-Path $repoRoot ".env.local")
[void](Initialize-KeraStorageDir -RepoRoot $repoRoot)

$powershellExe = $null
foreach ($candidate in @("powershell", "pwsh")) {
    $found = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($found) { $powershellExe = $found.Source; break }
}
if (-not $powershellExe) { throw "PowerShell executable not found." }

function Test-PortAvailable {
    param([int]$CandidatePort)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $CandidatePort)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Resolve-Port {
    param([int]$PreferredPort, [string]$Label)
    for ($p = $PreferredPort; $p -lt ($PreferredPort + 20); $p++) {
        if (Test-PortAvailable -CandidatePort $p) { return $p }
    }
    throw "No available port found for ${Label} (tried ${PreferredPort} to $($PreferredPort+19))."
}

$effectiveSharedApiBaseUrl = $SharedApiBaseUrl.Trim()
if (-not $effectiveSharedApiBaseUrl) {
    if ($env:KERA_INTERNAL_API_BASE_URL) {
        $effectiveSharedApiBaseUrl = $env:KERA_INTERNAL_API_BASE_URL.Trim()
    } elseif ($env:NEXT_PUBLIC_API_BASE_URL) {
        $effectiveSharedApiBaseUrl = $env:NEXT_PUBLIC_API_BASE_URL.Trim()
    }
}

$useSharedApi = [bool]$effectiveSharedApiBaseUrl
[void](Stop-ManagedProcessOnPort -Port $WebPort -Label "frontend" -RepoRoot $repoRoot)
[void](Stop-ProcessesMatchingPatterns -Label "frontend launcher" -CommandPatterns @($webScript) -ProcessNames @("powershell.exe", "pwsh.exe"))
$resolvedWebPort = Resolve-Port -PreferredPort $WebPort -Label "frontend"

if ($resolvedWebPort -ne $WebPort) {
    Write-Host "[K-ERA] Port $WebPort in use. Starting frontend on port $resolvedWebPort." -ForegroundColor Yellow
}

if ($useSharedApi) {
    $resolvedApiUrl = $effectiveSharedApiBaseUrl.TrimEnd("/")
} else {
    [void](Stop-ProcessesMatchingPatterns -Label "job worker" -CommandPatterns @("kera_research.worker"))
    [void](Stop-ProcessesMatchingPatterns -Label "API launcher" -CommandPatterns @($apiScript) -ProcessNames @("powershell.exe", "pwsh.exe"))
    [void](Stop-ProcessesMatchingPatterns -Label "job worker launcher" -CommandPatterns @($workerScript) -ProcessNames @("powershell.exe", "pwsh.exe"))
    [void](Stop-ManagedProcessOnPort -Port $ApiPort -Label "API" -RepoRoot $repoRoot -CommandPatterns @("kera_research.api.app:app"))
    $resolvedApiPort = Resolve-Port -PreferredPort $ApiPort -Label "API"
    $resolvedApiUrl = "http://localhost:$resolvedApiPort"
    if ($resolvedApiPort -ne $ApiPort) {
        Write-Host "[K-ERA] Port $ApiPort in use. Starting API on port $resolvedApiPort." -ForegroundColor Yellow
    }
}

# Wrap script paths in quotes to handle spaces in directory names
$quotedApiScript = "`"$apiScript`""
$quotedWebScript = "`"$webScript`""
$quotedWorkerScript = "`"$workerScript`""

if ($useSharedApi) {
    Write-Host "[K-ERA] Shared API mode enabled. Frontend will use $resolvedApiUrl" -ForegroundColor Cyan
} else {
    Write-Host "[K-ERA] Starting API server..." -ForegroundColor Cyan
    Start-Process -FilePath $powershellExe -ArgumentList @(
        "-ExecutionPolicy", "Bypass", "-File", $quotedApiScript, "-Port", $resolvedApiPort
    )

    Write-Host "[K-ERA] Starting job worker..." -ForegroundColor Cyan
    Start-Process -FilePath $powershellExe -ArgumentList @(
        "-ExecutionPolicy", "Bypass", "-File", $quotedWorkerScript
    )
}

Write-Host "[K-ERA] Starting frontend..." -ForegroundColor Cyan
Start-Process -FilePath $powershellExe -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-File", $quotedWebScript,
    "-ApiBaseUrl", $resolvedApiUrl, "-Port", $resolvedWebPort
)

Write-Host "[K-ERA] Waiting 20 seconds for services to start..." -ForegroundColor Green
Start-Sleep -Seconds 20
Start-Process "http://localhost:$resolvedWebPort"
