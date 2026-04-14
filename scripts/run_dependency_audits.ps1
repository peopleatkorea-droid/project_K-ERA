param(
    [ValidateSet("cpu", "gpu", "none")]
    [string]$TorchProfile = "cpu",
    [switch]$IncludeDev,
    [switch]$SkipPython,
    [switch]$SkipNode,
    [switch]$ReportOnly
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$auditRoot = Join-Path $repoRoot "artifacts/dependency-audit"
$venvPath = Join-Path $repoRoot ".venv"
New-Item -ItemType Directory -Force -Path $auditRoot | Out-Null

$failed = $false

if (-not $SkipPython) {
    $requirementsPath = Join-Path $auditRoot "python-requirements-$TorchProfile.txt"
    $pythonReportPath = Join-Path $auditRoot "python-pip-audit-$TorchProfile.txt"

    Push-Location $repoRoot
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            if (Test-Path $venvPath) {
                $sitePackages = (& uv run python -c "import site; print(site.getsitepackages()[0])" | Select-Object -Last 1).Trim()
                cmd /c "uvx --from pip-audit pip-audit --path ""$sitePackages"" --format json -o ""$pythonReportPath"""
            } else {
                $exportArgs = @(
                    "export",
                    "--format", "requirements-txt",
                    "--no-hashes",
                    "--no-header",
                    "--no-annotate",
                    "--no-editable",
                    "--no-emit-project",
                    "--output-file", $requirementsPath
                )
                if ($TorchProfile -eq "cpu") {
                    $exportArgs += @("--extra", "cpu")
                } elseif ($TorchProfile -eq "gpu") {
                    $exportArgs += @("--extra", "gpu")
                }
                if ($IncludeDev) {
                    $exportArgs += @("--extra", "dev")
                }

                & uv @exportArgs
                if ($LASTEXITCODE -ne 0) {
                    throw "uv export failed."
                }
                cmd /c "uvx --from pip-audit pip-audit -r ""$requirementsPath"" --format json -o ""$pythonReportPath"""
            }
            $pythonExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        if ($pythonExitCode -ne 0) {
            $failed = $true
        }
    } finally {
        Pop-Location
    }
}

if (-not $SkipNode) {
    $frontendDir = Join-Path $repoRoot "frontend"
    $nodeReportPath = Join-Path $auditRoot "frontend-npm-audit.json"

    Push-Location $frontendDir
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            cmd /c "npm audit --omit=dev --audit-level=high --json" *> $nodeReportPath
            $nodeExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        if ($nodeExitCode -ne 0) {
            $failed = $true
        }
    } finally {
        Pop-Location
    }
}

if ($failed -and -not $ReportOnly) {
    throw "Dependency audit found one or more issues. See artifacts/dependency-audit for reports."
}

Write-Host "Dependency audit finished. Reports: $auditRoot"
