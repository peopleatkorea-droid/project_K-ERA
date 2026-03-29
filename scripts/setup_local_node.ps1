param(
    [string]$PythonExe = "python",
    [ValidateSet("auto", "cpu", "gpu")]
    [string]$TorchProfile = "auto",
    [string]$TorchIndexUrl = "",
    [switch]$SkipTorchInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$uvManagedMarker = Join-Path $venvPath ".kera-uv-managed"
$pythonVersionFile = Join-Path $repoRoot ".python-version"
$cpuTorchVersion = "2.10.0"
$cpuTorchvisionVersion = "0.25.0"
$gpuTorchVersion = "2.10.0+cu128"
$gpuTorchvisionVersion = "0.25.0+cu128"

$requiredPythonVersion = if (Test-Path $pythonVersionFile) {
    ([string](Get-Content $pythonVersionFile -TotalCount 1)).Trim()
} else {
    "3.11"
}
$requiredVersionMatch = [regex]::Match($requiredPythonVersion, "^(?<major>\d+)\.(?<minor>\d+)")
if (-not $requiredVersionMatch.Success) {
    throw "Unsupported .python-version format: $requiredPythonVersion"
}
$requiredPythonMajor = [int]$requiredVersionMatch.Groups["major"].Value
$requiredPythonMinor = [int]$requiredVersionMatch.Groups["minor"].Value
$requiredPythonDisplay = "$requiredPythonMajor.$requiredPythonMinor"

function Invoke-CommandArray {
    param(
        [string[]]$Command,
        [string[]]$Arguments
    )

    $exe = $Command[0]
    $prefix = @()
    if ($Command.Length -gt 1) {
        $prefix = $Command[1..($Command.Length - 1)]
    }

    & $exe @prefix @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $($Command -join ' ') $($Arguments -join ' ')"
    }
}

function Test-PythonCommand {
    param(
        [string[]]$PythonCommand
    )

    try {
        $exe = $PythonCommand[0]
        $prefix = @()
        if ($PythonCommand.Length -gt 1) {
            $prefix = $PythonCommand[1..($PythonCommand.Length - 1)]
        }
        $probe = & $exe @prefix -c "import sys; major, minor = sys.version_info[:2]; print(f'{sys.executable}|{major}.{minor}'); raise SystemExit(0 if (major == $requiredPythonMajor and minor == $requiredPythonMinor) else 1)"
        $probeLine = @($probe | Where-Object { $_ } | Select-Object -First 1)
        $probeText = if ($probeLine.Count -gt 0) { [string]$probeLine[0] } else { "" }
        $probeParts = $probeText.Split("|", 2)
        $resolvedPath = if ($probeParts.Length -ge 1) { $probeParts[0].Trim() } else { "" }
        $resolvedVersion = if ($probeParts.Length -eq 2) { $probeParts[1].Trim() } else { "" }
        return [pscustomobject]@{
            Ok = ($LASTEXITCODE -eq 0)
            Probe = $probeText
            Path = $resolvedPath
            Version = $resolvedVersion
        }
    } catch {
        return [pscustomobject]@{
            Ok = $false
            Probe = ""
            Path = ""
            Version = ""
        }
    }
}

function Resolve-PythonCommand {
    param(
        [string]$RequestedPython
    )

    $requested = ([string]$RequestedPython).Trim()
    if ($requested -and $requested -ne "python") {
        $requestedResult = Test-PythonCommand @($requested)
        if ($requestedResult.Ok) {
            return [pscustomobject]@{
                Command = @($requested)
                Path = $requestedResult.Path
                Version = $requestedResult.Version
                Probe = $requestedResult.Probe
            }
        }
        throw "Requested Python executable is not usable. Expected Python ${requiredPythonDisplay}: $requested"
    }

    $candidateCommands = @()
    $candidateCommands += ,@("python")

    $pythonVersionCommand = Get-Command "python$requiredPythonDisplay" -ErrorAction SilentlyContinue
    if ($pythonVersionCommand) {
        $candidateCommands += ,@($pythonVersionCommand.Source)
    }

    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $candidateCommands += ,@($pyLauncher.Source, "-$requiredPythonDisplay")
    }

    foreach ($candidatePath in @(
        "C:\Users\USER\anaconda3\python.exe",
        "C:\Users\USER\AppData\Local\spyder-6\python.exe",
        "C:\ProgramData\spyder-6\python.exe",
        "C:\Users\USER\AppData\Local\Programs\Python\Python311\python.exe"
    )) {
        if (Test-Path $candidatePath) {
            $candidateCommands += ,@($candidatePath)
        }
    }

    foreach ($candidate in $candidateCommands) {
        $candidateResult = Test-PythonCommand $candidate
        if ($candidateResult.Ok) {
            return [pscustomobject]@{
                Command = @($candidate)
                Path = $candidateResult.Path
                Version = $candidateResult.Version
                Probe = $candidateResult.Probe
            }
        }
    }

    throw "No usable Python $requiredPythonDisplay executable was found. Set -PythonExe explicitly."
}

function Test-UvCommand {
    param(
        [string[]]$Command
    )

    try {
        $exe = $Command[0]
        $prefix = @()
        if ($Command.Length -gt 1) {
            $prefix = $Command[1..($Command.Length - 1)]
        }
        & $exe @prefix --version | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Resolve-UvCommand {
    param(
        [string]$PythonPath
    )

    $uvCommand = Get-Command uv -ErrorAction SilentlyContinue
    if ($uvCommand -and (Test-UvCommand @($uvCommand.Source))) {
        return @($uvCommand.Source)
    }

    $pythonModuleUv = @($PythonPath, "-m", "uv")
    if (Test-UvCommand $pythonModuleUv) {
        return $pythonModuleUv
    }

    throw "uv is required but was not found. Install uv first: https://docs.astral.sh/uv/"
}

function Get-NvidiaGpuInfo {
    $nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        $nvidiaSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    }
    if ($nvidiaSmi) {
        try {
            $gpuName = & $nvidiaSmi.Source --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gpuName)) {
                return [pscustomobject]@{
                    Available = $true
                    Name = ([string]$gpuName).Trim()
                }
            }
        } catch {
            # Fall through to the WMI fallback below.
        }
    }

    try {
        $controller = Get-CimInstance Win32_VideoController -ErrorAction Stop |
            Where-Object {
                $name = [string]$_.Name
                $name.IndexOf("NVIDIA", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
            } |
            Select-Object -First 1
        if ($controller -and -not [string]::IsNullOrWhiteSpace($controller.Name)) {
            return [pscustomobject]@{
                Available = $true
                Name = ([string]$controller.Name).Trim()
            }
        }
    } catch {
        # Ignore WMI lookup failures and return no-GPU below.
    }

    return [pscustomobject]@{
        Available = $false
        Name = $null
    }
}

function Resolve-TorchInstallProfile {
    param(
        [string]$RequestedProfile,
        [pscustomobject]$GpuInfo
    )

    if ($RequestedProfile -eq "gpu") {
        return "gpu"
    }
    if ($RequestedProfile -eq "cpu") {
        return "cpu"
    }
    return $(if ($GpuInfo.Available) { "gpu" } else { "cpu" })
}

function Remove-RepoVirtualEnvironment {
    param(
        [string]$TargetPath
    )

    $resolvedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
    $resolvedTargetPath = [System.IO.Path]::GetFullPath($TargetPath)
    if (-not $resolvedTargetPath.StartsWith($resolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a virtual environment outside the repository root: $resolvedTargetPath"
    }
    if (Test-Path $resolvedTargetPath) {
        Remove-Item -LiteralPath $resolvedTargetPath -Recurse -Force
    }
}

function Stop-ProcessesUsingRepoVenv {
    param(
        [string]$TargetRoot
    )

    $resolvedTargetRoot = [System.IO.Path]::GetFullPath($TargetRoot)
    try {
        $processes = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
            $processPath = [string]$_.ExecutablePath
            $processPath -and
            $processPath.StartsWith($resolvedTargetRoot, [System.StringComparison]::OrdinalIgnoreCase)
        }
    } catch {
        return
    }

    foreach ($process in $processes) {
        if ($process.ProcessId -eq $PID) {
            continue
        }
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "[K-ERA] Local node setup started" -ForegroundColor Cyan
Write-Host "[K-ERA] Python target: $requiredPythonDisplay" -ForegroundColor Cyan

$pythonResolution = Resolve-PythonCommand -RequestedPython $PythonExe
$pythonPath = $pythonResolution.Path
$pythonProbeValue = if ($pythonResolution.Probe) { $pythonResolution.Probe } else { $pythonPath }
Write-Host "[K-ERA] Using Python: $pythonProbeValue"

$uvCommand = Resolve-UvCommand -PythonPath $pythonPath
Write-Host "[K-ERA] Using uv: $($uvCommand -join ' ')"

if (Test-Path $venvPython) {
    if (-not (Test-Path $uvManagedMarker)) {
        Write-Warning "Existing .venv was not created by the uv-managed K-ERA setup. Recreating it to avoid legacy pip drift."
        try {
            Stop-ProcessesUsingRepoVenv -TargetRoot $venvPath
            Remove-RepoVirtualEnvironment -TargetPath $venvPath
        } catch {
            Write-Warning "Failed to fully recreate the legacy .venv. Falling back to in-place uv sync: $_"
        }
    }

    $existingVenv = Test-PythonCommand @($venvPython)
    if (-not $existingVenv.Ok) {
        Write-Warning "Existing .venv does not match Python $requiredPythonDisplay. Recreating it."
        Stop-ProcessesUsingRepoVenv -TargetRoot $venvPath
        Remove-RepoVirtualEnvironment -TargetPath $venvPath
    }
}

if (-not (Test-Path $venvPython)) {
    Write-Host "[K-ERA] Creating uv-managed virtual environment at $venvPath"
    Invoke-CommandArray -Command $uvCommand -Arguments @("venv", $venvPath, "--python", $pythonPath)
}

if (-not (Test-Path $venvPython)) {
    throw "Failed to create the repository virtual environment: $venvPython"
}

$gpuInfo = Get-NvidiaGpuInfo
if ($gpuInfo.Available) {
    Write-Host "[K-ERA] Detected NVIDIA GPU: $($gpuInfo.Name)"
} else {
    Write-Host "[K-ERA] No NVIDIA GPU detected. CPU profile will be used unless -TorchProfile gpu is specified."
}

$resolvedTorchProfile = if ($SkipTorchInstall) { "skipped" } else { Resolve-TorchInstallProfile -RequestedProfile $TorchProfile -GpuInfo $gpuInfo }
$syncArguments = @("sync", "--frozen", "--python", $venvPython, "--extra", "dev")
if (-not $SkipTorchInstall) {
    Write-Host "[K-ERA] Resolved torch profile: $resolvedTorchProfile"
    if ($resolvedTorchProfile -eq "gpu") {
        $syncArguments += @("--extra", "gpu")
    } else {
        if ($TorchIndexUrl) {
            Write-Warning "Ignoring -TorchIndexUrl because CPU profile was selected."
        }
        $syncArguments += @("--extra", "cpu")
    }
} elseif ($TorchIndexUrl) {
    Write-Warning "Ignoring -TorchIndexUrl because -SkipTorchInstall was requested."
}

Push-Location $repoRoot
try {
    Stop-ProcessesUsingRepoVenv -TargetRoot $venvPath
    Write-Host "[K-ERA] Syncing project environment via uv lockfile"
    Invoke-CommandArray -Command $uvCommand -Arguments $syncArguments

    if (-not $SkipTorchInstall -and $resolvedTorchProfile -eq "gpu" -and $TorchIndexUrl) {
        Stop-ProcessesUsingRepoVenv -TargetRoot $venvPath
        Write-Host "[K-ERA] Reinstalling GPU torch packages from custom index: $TorchIndexUrl"
        Invoke-CommandArray -Command $uvCommand -Arguments @(
            "pip",
            "install",
            "--python",
            $venvPython,
            "--reinstall",
            "--no-deps",
            "--default-index",
            $TorchIndexUrl,
            "torch==$gpuTorchVersion",
            "torchvision==$gpuTorchvisionVersion"
        )
    } elseif (-not $SkipTorchInstall -and $resolvedTorchProfile -eq "gpu") {
        Stop-ProcessesUsingRepoVenv -TargetRoot $venvPath
        Write-Host "[K-ERA] Enforcing CUDA torch packages for the GPU profile"
        Invoke-CommandArray -Command $uvCommand -Arguments @(
            "pip",
            "install",
            "--python",
            $venvPython,
            "--reinstall",
            "--no-deps",
            "--torch-backend",
            "cu128",
            "torch==$gpuTorchVersion",
            "torchvision==$gpuTorchvisionVersion"
        )
    } elseif (-not $SkipTorchInstall) {
        Stop-ProcessesUsingRepoVenv -TargetRoot $venvPath
        Write-Host "[K-ERA] Enforcing CPU torch packages for the CPU profile"
        Invoke-CommandArray -Command $uvCommand -Arguments @(
            "pip",
            "install",
            "--python",
            $venvPython,
            "--reinstall",
            "--no-deps",
            "--torch-backend",
            "cpu",
            "torch==$cpuTorchVersion",
            "torchvision==$cpuTorchvisionVersion"
        )
    }
} finally {
    Pop-Location
}

$env:KERA_EXPECT_CUDA_MODE = if ($resolvedTorchProfile -eq "gpu") { "required" } else { "optional" }
$env:KERA_TORCH_PROFILE = $resolvedTorchProfile
$env:KERA_CPU_TORCH_VERSION = $cpuTorchVersion
$env:KERA_CPU_TORCHVISION_VERSION = $cpuTorchvisionVersion
$env:KERA_GPU_TORCH_VERSION = $gpuTorchVersion
$env:KERA_GPU_TORCHVISION_VERSION = $gpuTorchvisionVersion

$packageChecks = @(
    "'fastapi'",
    "'uvicorn'",
    "'pandas'",
    "'plotly'",
    "'matplotlib'",
    "'numpy'",
    "'PIL'",
    "'sklearn'",
    "'transformers'",
    "'open_clip'",
    "'bcrypt'",
    "'faiss'"
)
if (-not $SkipTorchInstall) {
    $packageChecks += @("'torch'", "'torchvision'")
}
$packageLiteral = $packageChecks -join ", "

Write-Host "[K-ERA] Running health check"
@"
import importlib
import os

packages = [$packageLiteral]
missing = []
for name in packages:
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)

if missing:
    raise SystemExit(f"Missing packages after setup: {', '.join(missing)}")

torch_profile = os.getenv("KERA_TORCH_PROFILE", "unknown")
print(f"torch_profile={torch_profile}")

if "torch" in packages:
    import torch
    import torchvision

    expected_mode = os.getenv("KERA_EXPECT_CUDA_MODE", "optional")
    print(f"torch={torch.__version__}")
    print(f"torchvision={torchvision.__version__}")
    print(f"torch_cuda_version={torch.version.cuda}")
    print(f"cuda_available={torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"gpu_name={torch.cuda.get_device_name(0)}")

    if torch_profile == "cpu" and ("+cu" in torch.__version__ or torch.version.cuda):
        cpu_torch = os.getenv("KERA_CPU_TORCH_VERSION", "")
        cpu_vision = os.getenv("KERA_CPU_TORCHVISION_VERSION", "")
        raise SystemExit(
            "CPU profile was requested but a CUDA-enabled torch build is still installed. "
            f"Expected torch=={cpu_torch} / torchvision=={cpu_vision}, got torch={torch.__version__}."
        )

    if expected_mode == "required" and not torch.cuda.is_available():
        gpu_torch = os.getenv("KERA_GPU_TORCH_VERSION", "")
        gpu_vision = os.getenv("KERA_GPU_TORCHVISION_VERSION", "")
        raise SystemExit(
            "GPU profile was requested but CUDA is not available. "
            f"Installed torch={torch.__version__}. Expected a CUDA-enabled build such as "
            f"torch=={gpu_torch} / torchvision=={gpu_vision}."
        )
"@ | & $venvPython -
if ($LASTEXITCODE -ne 0) {
    throw "Health check failed."
}

Set-Content -LiteralPath $uvManagedMarker -Value "uv-managed:$requiredPythonDisplay" -Encoding ASCII

Write-Host "[K-ERA] Local node setup completed" -ForegroundColor Green
Write-Host "[K-ERA] Start with: .\scripts\run_local_node.ps1"
