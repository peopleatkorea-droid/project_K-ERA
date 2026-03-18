param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8000",
    [string]$ControlPlaneBaseUrl,
    [string]$ControlPlaneUserToken,
    [string]$DeviceName = $env:COMPUTERNAME,
    [string]$OsInfo = "",
    [string]$AppVersion = "0.2.0",
    [string]$SiteId = "",
    [string]$DisplayName = "",
    [string]$HospitalName = "",
    [string]$SourceInstitutionId = "",
    [switch]$Overwrite
)

$ErrorActionPreference = "Stop"

if (-not $ControlPlaneBaseUrl) {
    throw "ControlPlaneBaseUrl is required."
}
if (-not $ControlPlaneUserToken) {
    throw "ControlPlaneUserToken is required."
}

$body = @{
    control_plane_base_url = $ControlPlaneBaseUrl
    control_plane_user_token = $ControlPlaneUserToken
    device_name = if ($DeviceName) { $DeviceName } else { "local-node" }
    os_info = $OsInfo
    app_version = $AppVersion
    overwrite = [bool]$Overwrite
}

if ($SiteId) {
    $body.site_id = $SiteId
}
if ($DisplayName) {
    $body.display_name = $DisplayName
}
if ($HospitalName) {
    $body.hospital_name = $HospitalName
}
if ($SourceInstitutionId) {
    $body.source_institution_id = $SourceInstitutionId
}

$response = Invoke-RestMethod `
    -Method Post `
    -Uri "$($ApiBaseUrl.TrimEnd('/'))/api/control-plane/node/register" `
    -ContentType "application/json" `
    -Body ($body | ConvertTo-Json -Depth 8)

$response | ConvertTo-Json -Depth 10
