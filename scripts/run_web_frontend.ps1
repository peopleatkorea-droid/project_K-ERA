param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Test-PortAvailable {
    param(
        [int]$CandidatePort
    )

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $CandidatePort)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) {
            $listener.Stop()
        }
    }
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

. (Join-Path $PSScriptRoot "load_dev_env.ps1")
. (Join-Path $PSScriptRoot "dev_process_helpers.ps1")
Import-LocalEnv -Path (Join-Path $repoRoot ".env.local")

if (-not $env:NEXT_PUBLIC_GOOGLE_CLIENT_ID -and $env:KERA_GOOGLE_CLIENT_ID) {
    $env:NEXT_PUBLIC_GOOGLE_CLIENT_ID = $env:KERA_GOOGLE_CLIENT_ID
}

$frontendDir = Join-Path $PSScriptRoot "..\frontend"
Push-Location $frontendDir

try {
    if (-not (Test-Path "node_modules")) {
        npm install
    }

    $nextCli = Join-Path $PWD "node_modules\.bin\next.cmd"
    if (-not (Test-Path $nextCli)) {
        throw "Next.js CLI not found. Run npm install in the frontend directory first."
    }

    [void](Stop-ManagedProcessOnPort -Port $Port -Label "frontend" -RepoRoot $repoRoot)
    $resolvedPort = Resolve-WebPort -PreferredPort $Port
    if ($resolvedPort -ne $Port) {
        Write-Host "[K-ERA] Port $Port is already in use. Starting frontend on $resolvedPort instead." -ForegroundColor Yellow
        if ($env:NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
            Write-Host "[K-ERA] Google Sign-In requires the exact frontend origin to be registered in Google Cloud Console: http://localhost:$resolvedPort" -ForegroundColor Yellow
        }
    }

    try {
        if ($ApiBaseUrl) {
            $env:KERA_INTERNAL_API_BASE_URL = $ApiBaseUrl
        }
        if (-not $env:NEXT_PUBLIC_API_BASE_URL) {
            Remove-Item Env:NEXT_PUBLIC_API_BASE_URL -ErrorAction SilentlyContinue
        }
        & $nextCli dev --hostname 0.0.0.0 --port $resolvedPort
    } catch {
        Write-Host ""
        Write-Host "[ERROR] Frontend server failed: $_" -ForegroundColor Red
        Write-Host ""
        Read-Host "Press Enter to close"
        exit 1
    }
}
finally {
    Pop-Location
}
