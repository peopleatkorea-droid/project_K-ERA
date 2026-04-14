param(
  [ValidateSet("cpu", "gpu")]
  [string]$Profile = "cpu",
  [ValidateSet("auto", "msi", "nsis")]
  [string]$InstallerType = "auto",
  [switch]$SkipPackage,
  [int]$LaunchSeconds = 35,
  [int]$InstallTimeoutSeconds = 600,
  [string]$InstallDir
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
  Write-Host "[desktop-installer-smoke] $Message"
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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

function Invoke-InstallerAndWait {
  param(
    [System.IO.FileInfo]$Installer,
    [string]$TargetInstallDir,
    [int]$TimeoutSeconds,
    [string]$LogRoot
  )

  if (Test-Path $TargetInstallDir) {
    Remove-Item $TargetInstallDir -Recurse -Force
  }
  $installParent = Split-Path -Parent $TargetInstallDir
  if ($installParent) {
    New-Item -ItemType Directory -Path $installParent -Force | Out-Null
  }

  Write-Info "Installing $($Installer.Name) into $TargetInstallDir"
  $attemptStamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $attemptLogDir = Join-Path $LogRoot "$($Installer.BaseName)-$attemptStamp"
  New-Item -ItemType Directory -Path $attemptLogDir -Force | Out-Null
  $metadataPath = Join-Path $attemptLogDir "attempt.txt"
  @(
    "installer=$($Installer.FullName)"
    "target_install_dir=$TargetInstallDir"
    "timeout_seconds=$TimeoutSeconds"
    "started_at_utc=$([DateTime]::UtcNow.ToString('o'))"
  ) | Set-Content -Path $metadataPath -Encoding UTF8

  $installerProcess = $null
  if ($Installer.Extension -ieq ".msi") {
    $msiLogPath = Join-Path $attemptLogDir "msiexec.log"
    $quotedInstallerPath = '"' + $Installer.FullName + '"'
    $quotedMsiLogPath = '"' + $msiLogPath + '"'
    $installArgs = @(
      "/i",
      $quotedInstallerPath,
      "/qn",
      "/norestart",
      "INSTALLDIR=$TargetInstallDir",
      "/l*v",
      $quotedMsiLogPath
    )
    $installerProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArgs -PassThru
  } else {
    $installArgs = @("/S", "/D=$TargetInstallDir")
    $installerProcess = Start-Process -FilePath $Installer.FullName -ArgumentList $installArgs -PassThru
  }

  $finished = $installerProcess.WaitForExit($TimeoutSeconds * 1000)
  if (-not $finished) {
    try {
      Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
    } catch {
    }
    Add-Content -Path $metadataPath -Value "result=timeout"
    Add-Content -Path $metadataPath -Value "finished_at_utc=$([DateTime]::UtcNow.ToString('o'))"
    Add-Content -Path $metadataPath -Value "log_dir=$attemptLogDir"
    throw "Installer timed out after $TimeoutSeconds second(s): $($Installer.FullName) (logs: $attemptLogDir)"
  }
  if ($installerProcess.ExitCode -ne 0) {
    Add-Content -Path $metadataPath -Value "result=exit_code_$($installerProcess.ExitCode)"
    Add-Content -Path $metadataPath -Value "finished_at_utc=$([DateTime]::UtcNow.ToString('o'))"
    Add-Content -Path $metadataPath -Value "log_dir=$attemptLogDir"
    throw "Installer exited with code $($installerProcess.ExitCode): $($Installer.FullName) (logs: $attemptLogDir)"
  }
  Add-Content -Path $metadataPath -Value "result=success"
  Add-Content -Path $metadataPath -Value "finished_at_utc=$([DateTime]::UtcNow.ToString('o'))"
  Add-Content -Path $metadataPath -Value "log_dir=$attemptLogDir"
  Write-Info "Installer completed: $($Installer.Name) (logs: $attemptLogDir)"
}

$frontendRoot = Split-Path -Parent $PSScriptRoot
$bundleNsisDir = Join-Path $frontendRoot "src-tauri\target\release\bundle\nsis"
$bundleMsiDir = Join-Path $frontendRoot "src-tauri\target\release\bundle\msi"
$variantRoot = Join-Path $frontendRoot "desktop-package-variants"
$installRoot = Join-Path $frontendRoot "desktop-installed-smoke"
$logRoot = Join-Path $installRoot (Join-Path $Profile "logs")
$isAdmin = if ($IsWindows) { Test-IsAdministrator } else { $false }

$preferNsisCurrentUser = ($Profile -eq "cpu") -and (($InstallerType -eq "nsis") -or ($InstallerType -eq "auto" -and -not $isAdmin))
$packageScript =
  if ($Profile -eq "gpu") {
    "desktop:package:gpu"
  } elseif ($InstallerType -eq "msi") {
    "desktop:package:cpu:msi"
  } elseif ($preferNsisCurrentUser) {
    "desktop:package:cpu:nsis"
  } else {
    "desktop:package:cpu"
  }

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

  $artifactPatterns =
    if ($InstallerType -eq "msi") {
      @("*.msi")
    } elseif ($InstallerType -eq "nsis") {
      @("*.exe")
    } elseif (-not $isAdmin -and $Profile -eq "cpu") {
      @("*.exe")
    } else {
      @("*.msi", "*.exe")
    }
  $candidateDirs =
    if ($InstallerType -eq "msi") {
      @($bundleMsiDir)
    } elseif ($InstallerType -eq "nsis") {
      @($bundleNsisDir)
    } elseif (-not $isAdmin -and $Profile -eq "cpu") {
      @($bundleNsisDir)
    } else {
      @($bundleMsiDir, $bundleNsisDir)
    }

  if ($preferNsisCurrentUser -and $InstallerType -eq "auto") {
    Write-Info "Non-admin session detected; preferring current-user NSIS installer and skipping MSI."
  }
  $installCandidates = @()

  foreach ($candidateDir in $candidateDirs) {
    if (-not (Test-Path $candidateDir)) {
      continue
    }
    foreach ($pattern in $artifactPatterns) {
      $match = Get-ChildItem $candidateDir -File -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if ($match) {
        $installCandidates += $match
      }
    }
  }

  $installCandidates = $installCandidates |
    Sort-Object @{ Expression = { if ($_.Extension -ieq ".msi") { 0 } else { 1 } } }, @{ Expression = { -$_.LastWriteTime.ToFileTimeUtc() } } |
    Select-Object -Unique

  if (-not $installCandidates) {
    throw "No installer artifact was found under $bundleNsisDir or $bundleMsiDir"
  }

  $lastInstallError = $null
  foreach ($installer in $installCandidates) {
    try {
      Invoke-InstallerAndWait -Installer $installer -TargetInstallDir $InstallDir -TimeoutSeconds $InstallTimeoutSeconds -LogRoot $logRoot
      $lastInstallError = $null
      break
    } catch {
      $lastInstallError = $_
      Write-Info "Installer attempt failed for $($installer.Name): $($_.Exception.Message)"
    }
  }
  if ($lastInstallError) {
    throw $lastInstallError
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
