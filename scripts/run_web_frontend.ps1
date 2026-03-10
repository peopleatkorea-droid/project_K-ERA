param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$frontendDir = Join-Path $PSScriptRoot "..\frontend"
Push-Location $frontendDir

try {
    if (-not (Test-Path "node_modules")) {
        npm install
    }

    $env:NEXT_PUBLIC_API_BASE_URL = $ApiBaseUrl
    npm run dev -- --port $Port
}
finally {
    Pop-Location
}
