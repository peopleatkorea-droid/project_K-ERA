param(
  [string]$InstallDir,
  [string]$AppDataDir = (Join-Path $env:LOCALAPPDATA "KERA"),
  [int]$LaunchSeconds = 0
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$Message) {
  Write-Host "OK   $Message"
}

function Write-WarnLine([string]$Message) {
  Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Resolve-ExistingPath([string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }
  return $null
}

function Wait-ForExistingPath {
  param(
    [string]$Path,
    [int]$TimeoutSeconds = 0
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $false
  }
  if (Test-Path $Path) {
    return $true
  }
  if ($TimeoutSeconds -le 0) {
    return $false
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $Path) {
      return $true
    }
  }
  return (Test-Path $Path)
}

$installCandidates = @()
if (-not [string]::IsNullOrWhiteSpace($InstallDir)) {
  $installCandidates += $InstallDir
}
if ($env:LOCALAPPDATA) {
  $installCandidates += (Join-Path $env:LOCALAPPDATA "Programs\\K-ERA Desktop")
}
if ($env:ProgramFiles) {
  $installCandidates += (Join-Path $env:ProgramFiles "K-ERA Desktop")
}
if ($env:ProgramFiles -and $env:ProgramFiles -ne ${env:ProgramFiles(x86)}) {
  $installCandidates += (Join-Path ${env:ProgramFiles(x86)} "K-ERA Desktop")
}

$resolvedInstallDir = Resolve-ExistingPath $installCandidates
if (-not $resolvedInstallDir) {
  throw "Could not find an installed K-ERA Desktop directory. Checked: $($installCandidates -join ', ')"
}
Write-Ok "install dir: $resolvedInstallDir"

$exeCandidates = @(
  (Join-Path $resolvedInstallDir "K-ERA Desktop.exe"),
  (Join-Path $resolvedInstallDir "kera-desktop-shell.exe")
)
$resolvedExe = Resolve-ExistingPath $exeCandidates
if (-not $resolvedExe) {
  throw "Could not find the installed desktop executable under $resolvedInstallDir."
}
Write-Ok "desktop executable: $resolvedExe"

$layoutCandidates = @(
  @{
    Name = "resources-extracted"
    ResourceDir = Join-Path $resolvedInstallDir "resources"
    BackendRoot = Join-Path $resolvedInstallDir "resources\\backend"
    PythonRuntimeDir = Join-Path $resolvedInstallDir "resources\\python-runtime"
    PythonRuntimeArchive = $null
  },
  @{
    Name = "install-root-archive"
    ResourceDir = $resolvedInstallDir
    BackendRoot = Join-Path $resolvedInstallDir "backend"
    PythonRuntimeDir = $null
    PythonRuntimeArchive = Join-Path $resolvedInstallDir "python-runtime.zip"
  },
  @{
    Name = "updater-bundle"
    ResourceDir = $null
    BackendRoot = Join-Path $resolvedInstallDir "backend"
    PythonRuntimeDir = Join-Path $resolvedInstallDir "_up_\\.desktop-runtime-bundle\\python-runtime"
    PythonRuntimeArchive = $null
  }
)

$resolvedLayout = $null
foreach ($layout in $layoutCandidates) {
  $pythonRuntimeReady = $false
  if (-not [string]::IsNullOrWhiteSpace($layout.PythonRuntimeDir) -and (Test-Path $layout.PythonRuntimeDir)) {
    $pythonRuntimeReady = $true
  }
  if (-not $pythonRuntimeReady -and -not [string]::IsNullOrWhiteSpace($layout.PythonRuntimeArchive) -and (Test-Path $layout.PythonRuntimeArchive)) {
    $pythonRuntimeReady = $true
  }
  $requiredPaths = @(
    (Join-Path $layout.BackendRoot "app.py"),
    (Join-Path $layout.BackendRoot "src")
  )
  $allPresent = $true
  foreach ($requiredPath in $requiredPaths) {
    if (-not (Test-Path $requiredPath)) {
      $allPresent = $false
      break
    }
  }
  if ($allPresent -and $pythonRuntimeReady) {
    $resolvedLayout = $layout
    break
  }
}

if (-not $resolvedLayout) {
  $checkedPaths = $layoutCandidates | ForEach-Object {
    @(
      (Join-Path $_.BackendRoot "app.py"),
      (Join-Path $_.BackendRoot "src"),
      $_.PythonRuntimeDir,
      $_.PythonRuntimeArchive
    ) -join ", "
  }
  throw "Could not resolve the installed runtime layout under $resolvedInstallDir. Checked: $($checkedPaths -join ' | ')"
}

Write-Ok "runtime layout: $($resolvedLayout.Name)"
if ($resolvedLayout.ResourceDir) {
  $resourceDir = Resolve-ExistingPath @($resolvedLayout.ResourceDir)
  if ($resourceDir) {
    Write-Ok "resources dir: $resourceDir"
  }
}

$requiredRuntimePaths = @(
  (Join-Path $resolvedLayout.BackendRoot "app.py"),
  (Join-Path $resolvedLayout.BackendRoot "src")
)

foreach ($requiredPath in $requiredRuntimePaths) {
  Write-Ok "runtime resource: $requiredPath"
}
if (-not [string]::IsNullOrWhiteSpace($resolvedLayout.PythonRuntimeDir) -and (Test-Path $resolvedLayout.PythonRuntimeDir)) {
  Write-Ok "runtime resource: $($resolvedLayout.PythonRuntimeDir)"
}
if (-not [string]::IsNullOrWhiteSpace($resolvedLayout.PythonRuntimeArchive) -and (Test-Path $resolvedLayout.PythonRuntimeArchive)) {
  Write-Ok "runtime archive: $($resolvedLayout.PythonRuntimeArchive)"
}

if (Test-Path $AppDataDir) {
  Write-Ok "app data dir: $AppDataDir"
} else {
  Write-WarnLine "app data dir does not exist yet: $AppDataDir"
}

$runtimeDir = Join-Path $AppDataDir "runtime"
$configPath = Join-Path $AppDataDir "desktop-config.json"
$storageStatePath = Join-Path $AppDataDir "storage_dir.txt"

if ($LaunchSeconds -gt 0) {
  Write-Host "Launching installed desktop runtime for $LaunchSeconds second(s)..."
  $process = Start-Process -FilePath $resolvedExe -PassThru
  try {
    $appDataReady = Wait-ForExistingPath -Path $AppDataDir -TimeoutSeconds $LaunchSeconds
    if (-not $appDataReady) {
      throw "app data dir was not created during launch smoke: $AppDataDir"
    } else {
      Write-Ok "app data dir after launch: $AppDataDir"
    }
    $runtimeReady = Wait-ForExistingPath -Path $runtimeDir -TimeoutSeconds $LaunchSeconds
    if ($runtimeReady) {
      Write-Ok "runtime dir after launch: $runtimeDir"
    } else {
      throw "runtime dir was not created during launch smoke: $runtimeDir"
    }
    if (-not [string]::IsNullOrWhiteSpace($resolvedLayout.PythonRuntimeArchive)) {
      $runtimePython = Join-Path $runtimeDir "python\\python.exe"
      if (Wait-ForExistingPath -Path $runtimePython -TimeoutSeconds $LaunchSeconds) {
        Write-Ok "runtime python after launch: $runtimePython"
      } else {
        throw "runtime python was not prepared during launch smoke: $runtimePython"
      }
    }
    if (Test-Path $configPath) {
      Write-Ok "desktop config file: $configPath"
    } else {
      Write-WarnLine "desktop config file not created yet: $configPath"
    }
    if (Test-Path $storageStatePath) {
      Write-Ok "storage state file: $storageStatePath"
    } else {
      Write-WarnLine "storage state file not created yet: $storageStatePath"
    }
  } finally {
    if ($process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      Write-Ok "stopped launch-smoke process: $($process.Id)"
    }
  }
}

Write-Host "installed desktop smoke completed"
