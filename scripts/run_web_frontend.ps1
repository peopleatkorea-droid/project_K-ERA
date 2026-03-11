param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

. (Join-Path $PSScriptRoot "load_dev_env.ps1")
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

    $env:NEXT_PUBLIC_API_BASE_URL = $ApiBaseUrl
    & $nextCli dev --hostname 0.0.0.0 --port $Port
}
finally {
    Pop-Location
}
