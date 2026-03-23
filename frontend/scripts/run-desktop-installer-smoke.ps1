param(
  [ValidateSet("cpu", "gpu")]
  [string]$Profile = "cpu",
  [switch]$SkipPackage,
  [int]$LaunchSeconds = 15,
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
  Write-Host "[desktop-installer-smoke] $Message"
}

function Invoke-CheckedCommand {
  param(
    [string]$Executable,
    [string[]]$Arguments
  )

  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Executable $($Arguments -join ' ')"
  }
}

function Get-NewestArtifact {
  param(
    [string]$Directory,
    [string[]]$Patterns
  )

  foreach ($pattern in $Patterns) {
    $match = Get-ChildItem $Directory -File -Filter $pattern -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($match) {
      return $match
    }
  }

  return $null
}

$frontendRoot = Split-Path -Parent $PSScriptRoot
$bundleNsisDir = Join-Path $frontendRoot "src-tauri\target\release\bundle\nsis"
$bundleMsiDir = Join-Path $frontendRoot "src-tauri\target\release\bundle\msi"
$variantRoot = Join-Path $frontendRoot "desktop-package-variants"
$packageScript = "desktop:package:$Profile"
$installRoot = Join-Path $frontendRoot "desktop-installed-smoke"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $installRoot (Join-Path $Profile "install")
}

Push-Location $frontendRoot
try {
  if (-not $SkipPackage) {
    Write-Info "Packaging desktop installer via npm run $packageScript"
    Invoke-CheckedCommand -Executable "npm.cmd" -Arguments @("run", $packageScript)
  }

  if ($Profile -eq "gpu") {
    $portableDir = Join-Path $variantRoot "gpu\portable"
    if (-not (Test-Path $portableDir)) {
      throw "Portable GPU package output was not found: $portableDir"
    }

    $smokeScriptPath = Join-Path $PSScriptRoot "run-installed-desktop-smoke.ps1"
    Write-Info "Running portable GPU smoke against $portableDir"
    Invoke-CheckedCommand -Executable "powershell.exe" -Arguments @(
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $smokeScriptPath,
      "-InstallDir",
      $portableDir,
      "-LaunchSeconds",
      [string]$LaunchSeconds
    )

    Write-Info "Portable GPU desktop smoke passed"
    return
  }

  $artifactPatterns = if ($Profile -eq "gpu") { @("*.msi", "*.exe") } else { @("*.exe", "*.msi") }
  $candidateDirs = if ($Profile -eq "gpu") { @($bundleMsiDir, $bundleNsisDir) } else { @($bundleNsisDir, $bundleMsiDir) }
  $installer = $null

  foreach ($candidateDir in $candidateDirs) {
    if (-not (Test-Path $candidateDir)) {
      continue
    }
    $installer = Get-NewestArtifact -Directory $candidateDir -Patterns $artifactPatterns
    if ($installer) {
      break
    }
  }

  if (-not $installer) {
    throw "No installer artifact was found under $bundleNsisDir or $bundleMsiDir"
  }

  if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
  }
  $installParent = Split-Path -Parent $InstallDir
  if ($installParent) {
    New-Item -ItemType Directory -Path $installParent -Force | Out-Null
  }

  Write-Info "Installing $($installer.Name) into $InstallDir"
  $installerProcess = $null
  if ($installer.Extension -ieq ".msi") {
    $installArgs = @(
      "/i",
      $installer.FullName,
      "/qn",
      "/norestart",
      "INSTALLDIR=$InstallDir"
    )
    $installerProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArgs -Wait -PassThru
  } else {
    $installArgs = @("/S", "/D=$InstallDir")
    $installerProcess = Start-Process -FilePath $installer.FullName -ArgumentList $installArgs -Wait -PassThru
  }
  if ($installerProcess.ExitCode -ne 0) {
    throw "Installer exited with code $($installerProcess.ExitCode)"
  }

  $smokeScriptPath = Join-Path $PSScriptRoot "run-installed-desktop-smoke.ps1"
  Write-Info "Running installed smoke against $InstallDir"
  Invoke-CheckedCommand -Executable "powershell.exe" -Arguments @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $smokeScriptPath,
    "-InstallDir",
    $InstallDir,
    "-LaunchSeconds",
    [string]$LaunchSeconds
  )

  Write-Info "Installed desktop smoke passed for profile=$Profile"
} finally {
  Pop-Location
}
