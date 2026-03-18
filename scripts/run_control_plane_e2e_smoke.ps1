param(
    [int]$ApiPort = 8010,
    [int]$WebPort = 3010,
    [string]$DevEmail = "smoke-admin@local.test",
    [string]$DevFullName = "Smoke Admin",
    [string]$SiteId = "smoke-site",
    [string]$DisplayName = "Smoke Site",
    [string]$HospitalName = "Smoke Hospital",
    [switch]$KeepProcesses
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $repoRoot ".smoke-logs"
$apiLog = Join-Path $logsDir "api.log"
$apiErr = Join-Path $logsDir "api.err.log"
$webLog = Join-Path $logsDir "web.log"
$webErr = Join-Path $logsDir "web.err.log"
$controlPlaneBaseUrl = "http://127.0.0.1:$WebPort/control-plane/api"
$apiBaseUrl = "http://127.0.0.1:$ApiPort"
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$versionId = "model_smoke_$timestamp"
$versionName = "smoke-model-$timestamp"
$deviceName = if ($env:COMPUTERNAME) { "$($env:COMPUTERNAME)-smoke" } else { "local-node-smoke" }
$osInfo = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription

function Invoke-KeraJson {
    param(
        [ValidateSet("GET", "POST")]
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        [hashtable]$Headers = @{}
    )

    $params = @{
        Method = $Method
        Uri = $Uri
        Headers = $Headers
    }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = $Body | ConvertTo-Json -Depth 12
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $statusCode = ""
        $detail = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $statusCode = [int]$_.Exception.Response.StatusCode
            } catch {
                $statusCode = ""
            }
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                if ($stream) {
                    $reader = New-Object System.IO.StreamReader($stream)
                    $content = $reader.ReadToEnd()
                    if ($content) {
                        try {
                            $payload = $content | ConvertFrom-Json
                            if ($payload.detail) {
                                $detail = $payload.detail
                            } else {
                                $detail = $content
                            }
                        } catch {
                            $detail = $content
                        }
                    }
                }
            } catch {
            }
        }
        if ($statusCode) {
            throw "HTTP ${statusCode}: $detail"
        }
        throw
    }
}

function Wait-HttpReady {
    param(
        [string]$Uri,
        [int]$TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -Method Get -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        } catch {
            Start-Sleep -Seconds 2
            continue
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for $Uri"
}

function Assert-PortAvailable {
    param(
        [int]$Port
    )

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
    } catch {
        throw "Port $Port is already in use."
    } finally {
        if ($listener) {
            $listener.Stop()
        }
    }
}

function Start-BackgroundProcess {
    param(
        [string]$ScriptPath,
        [string[]]$ArgumentList,
        [string]$StdOutPath,
        [string]$StdErrPath
    )

    $processArguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ScriptPath) + $ArgumentList
    return Start-Process `
        -FilePath "powershell" `
        -ArgumentList $processArguments `
        -WorkingDirectory $repoRoot `
        -PassThru `
        -RedirectStandardOutput $StdOutPath `
        -RedirectStandardError $StdErrPath
}

function Stop-ProcessTree {
    param(
        [System.Diagnostics.Process]$Process
    )

    if ($null -eq $Process) {
        return
    }
    try {
        cmd /c "taskkill /PID $($Process.Id) /T /F >nul 2>&1" | Out-Null
    } catch {
    }
}

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Remove-Item $apiLog, $apiErr, $webLog, $webErr -Force -ErrorAction SilentlyContinue

. (Join-Path $PSScriptRoot "load_dev_env.ps1")
Import-LocalEnv -Path (Join-Path $repoRoot ".env.local")
$env:KERA_CONTROL_PLANE_DEV_AUTH = "true"
$env:NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL = $apiBaseUrl

Assert-PortAvailable -Port $ApiPort
Assert-PortAvailable -Port $WebPort

$apiProcess = $null
$webProcess = $null

try {
    $apiProcess = Start-BackgroundProcess `
        -ScriptPath (Join-Path $PSScriptRoot "run_api_server.ps1") `
        -ArgumentList @("-HostAddress", "127.0.0.1", "-Port", "$ApiPort") `
        -StdOutPath $apiLog `
        -StdErrPath $apiErr
    $webProcess = Start-BackgroundProcess `
        -ScriptPath (Join-Path $PSScriptRoot "run_web_frontend.ps1") `
        -ArgumentList @("-ApiBaseUrl", $apiBaseUrl, "-Port", "$WebPort") `
        -StdOutPath $webLog `
        -StdErrPath $webErr

    Wait-HttpReady -Uri "$apiBaseUrl/api/health"
    Wait-HttpReady -Uri "$controlPlaneBaseUrl/health"

    $session = Invoke-KeraJson `
        -Method POST `
        -Uri "$controlPlaneBaseUrl/auth/dev-login" `
        -Body @{
            email = $DevEmail
            full_name = $DevFullName
            make_admin = $true
        }
    $userToken = [string]$session.access_token
    if (-not $userToken) {
        throw "Control plane dev login did not return an access token."
    }

    $adminHeaders = @{ Authorization = "Bearer $userToken" }
    $published = Invoke-KeraJson `
        -Method POST `
        -Uri "$controlPlaneBaseUrl/admin/model-versions" `
        -Headers $adminHeaders `
        -Body @{
            version_id = $versionId
            version_name = $versionName
            architecture = "convnext_tiny"
            source_provider = "smoke_test"
            download_url = "https://example.invalid/models/$versionId.pt"
            sha256 = ""
            size_bytes = 0
            ready = $true
            is_current = $true
            metadata_json = @{
                requires_medsam_crop = $false
                model_name = "keratitis_cls"
                smoke_test = $true
            }
        }
    if ([string]$published.version_id -ne $versionId) {
        throw "Published model version did not match the requested smoke-test version."
    }

    $registration = Invoke-KeraJson `
        -Method POST `
        -Uri "$apiBaseUrl/api/control-plane/node/register" `
        -Body @{
            control_plane_base_url = $controlPlaneBaseUrl
            control_plane_user_token = $userToken
            device_name = $deviceName
            os_info = $osInfo
            app_version = "0.2.0-smoke"
            site_id = $SiteId
            display_name = $DisplayName
            hospital_name = $HospitalName
            overwrite = $true
        }

    $nodeId = [string]$registration.node_id
    $nodeToken = [string]$registration.node_token
    if (-not $nodeId -or -not $nodeToken) {
        throw "Local node registration did not return node credentials."
    }
    $nodeHeaders = @{
        "x-kera-node-id" = $nodeId
        "x-kera-node-token" = $nodeToken
    }

    $bootstrap = Invoke-KeraJson -Method GET -Uri "$controlPlaneBaseUrl/nodes/bootstrap" -Headers $nodeHeaders
    $currentRelease = Invoke-KeraJson -Method GET -Uri "$controlPlaneBaseUrl/nodes/current-release" -Headers $nodeHeaders
    if ([string]$currentRelease.version_id -ne $versionId) {
        throw "current-release did not return the smoke-test model version."
    }

    $smoke = Invoke-KeraJson `
        -Method POST `
        -Uri "$apiBaseUrl/api/dev/control-plane/smoke" `
        -Body @{
            update_suffix = $timestamp
        }
    if ([string]$smoke.status -ne "ok") {
        throw "Local smoke endpoint did not report success."
    }

    $remoteUpdates = Invoke-KeraJson -Method GET -Uri "$controlPlaneBaseUrl/admin/model-updates" -Headers $adminHeaders
    $remoteValidations = Invoke-KeraJson -Method GET -Uri "$controlPlaneBaseUrl/admin/validation-runs" -Headers $adminHeaders

    $updateId = [string]$smoke.model_update.update_id
    $validationId = [string]$smoke.validation_summary.validation_id
    $matchingUpdate = $remoteUpdates | Where-Object { [string]$_.update_id -eq $updateId } | Select-Object -First 1
    $matchingValidation = $remoteValidations | Where-Object { [string]$_.validation_id -eq $validationId } | Select-Object -First 1
    if (-not $matchingUpdate) {
        throw "Smoke-test model update was not visible in the remote control plane."
    }
    if (-not $matchingValidation) {
        throw "Smoke-test validation summary was not visible in the remote control plane."
    }

    $result = [ordered]@{
        status = "ok"
        control_plane_base_url = $controlPlaneBaseUrl
        local_api_base_url = $apiBaseUrl
        user_email = $DevEmail
        site_id = [string]$bootstrap.site.site_id
        node_id = $nodeId
        current_release_version_id = [string]$currentRelease.version_id
        uploaded_update_id = $updateId
        uploaded_validation_id = $validationId
        logs = @{
            api_stdout = $apiLog
            api_stderr = $apiErr
            web_stdout = $webLog
            web_stderr = $webErr
        }
    }
    $result | ConvertTo-Json -Depth 8
}
catch {
    Write-Error $_
    Write-Host ""
    Write-Host "Smoke test logs:" -ForegroundColor Yellow
    Write-Host "  API stdout : $apiLog"
    Write-Host "  API stderr : $apiErr"
    Write-Host "  WEB stdout : $webLog"
    Write-Host "  WEB stderr : $webErr"
    throw
}
finally {
    if (-not $KeepProcesses) {
        foreach ($process in @($apiProcess, $webProcess)) {
            Stop-ProcessTree -Process $process
        }
    }
}
