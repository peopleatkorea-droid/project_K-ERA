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
$baseRequirementsPath = Join-Path $repoRoot "requirements.txt"
$cpuRequirementsPath = Join-Path $repoRoot "requirements-cpu.txt"
$gpuRequirementsPath = Join-Path $repoRoot "requirements-gpu-cu128.txt"
$defaultGpuIndexUrl = "https://download.pytorch.org/whl/cu128"
$cpuTorchVersion = "2.10.0"
$cpuTorchvisionVersion = "0.25.0"
$gpuTorchVersion = "2.10.0+cu128"
$gpuTorchvisionVersion = "0.25.0+cu128"

function Invoke-PythonCommand {
    param(
        [string[]]$PythonCommand,
        [string[]]$Arguments
    )

    $exe = $PythonCommand[0]
    $prefix = @()
    if ($PythonCommand.Length -gt 1) {
        $prefix = $PythonCommand[1..($PythonCommand.Length - 1)]
    }

    & $exe @prefix @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed: $($PythonCommand -join ' ') $($Arguments -join ' ')"
    }
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
        $probe = & $exe @prefix -c "import sys; major, minor = sys.version_info[:2]; print(f'{sys.executable}|{major}.{minor}'); raise SystemExit(0 if (major == 3 and minor in (10, 11, 12)) else 1)"
        return [pscustomobject]@{
            Ok = ($LASTEXITCODE -eq 0)
            Probe = @($probe | Where-Object { $_ })
        }
    } catch {
        return [pscustomobject]@{
            Ok = $false
            Probe = @()
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
                Probe = $requestedResult.Probe
            }
        }
        throw "Requested Python executable is not usable: $requested"
    }

    $candidateCommands = @()
    if ($requested -eq "python") {
        $candidateCommands += ,@("python")
    }

    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        foreach ($versionSwitch in @("-3.11", "-3.12", "-3.10")) {
            $candidateCommands += ,@($pyLauncher.Source, $versionSwitch)
        }
    }

    foreach ($candidatePath in @(
        "C:\Users\USER\anaconda3\python.exe",
        "C:\Users\USER\AppData\Local\spyder-6\python.exe",
        "C:\ProgramData\spyder-6\python.exe",
        "C:\Users\USER\AppData\Local\Python\bin\python.exe"
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
                Probe = $candidateResult.Probe
            }
        }
    }

    throw "No supported Python 3.10/3.11/3.12 executable was found. Set -PythonExe explicitly."
}

function Get-NvidiaGpuInfo {
    $nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if (-not $nvidiaSmi) {
        $nvidiaSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    }
    if (-not $nvidiaSmi) {
        return [pscustomobject]@{
            Available = $false
            Name = $null
        }
    }

    try {
        $gpuName = & $nvidiaSmi.Source --query-gpu=name --format=csv,noheader 2>$null | Select-Object -First 1
        return [pscustomobject]@{
            Available = ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gpuName))
            Name = ([string]$gpuName).Trim()
        }
    } catch {
        return [pscustomobject]@{
            Available = $false
            Name = $null
        }
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

Write-Host "[K-ERA] Local node setup started" -ForegroundColor Cyan

$pythonResolution = Resolve-PythonCommand -RequestedPython $PythonExe
$pythonCommand = @($pythonResolution.Command)
$pythonProbeValue = @($pythonResolution.Probe | Where-Object { $_ })[0]
if (-not $pythonProbeValue) {
    $pythonProbeValue = ($pythonCommand -join " ")
}
Write-Host "[K-ERA] Using Python: $pythonProbeValue"

if (-not (Test-Path $venvPython)) {
    Write-Host "[K-ERA] Creating virtual environment at $venvPath"
    Invoke-PythonCommand -PythonCommand $pythonCommand -Arguments @("-m", "venv", $venvPath)
}

Write-Host "[K-ERA] Upgrading pip/setuptools/wheel"
Invoke-CheckedCommand -Executable $venvPython -Arguments @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")

$gpuInfo = Get-NvidiaGpuInfo
if ($gpuInfo.Available) {
    Write-Host "[K-ERA] Detected NVIDIA GPU: $($gpuInfo.Name)"
} else {
    Write-Host "[K-ERA] No NVIDIA GPU detected. CPU profile will be used unless -TorchProfile gpu is specified."
}

$resolvedTorchProfile = if ($SkipTorchInstall) { "skipped" } else { Resolve-TorchInstallProfile -RequestedProfile $TorchProfile -GpuInfo $gpuInfo }
if (-not $SkipTorchInstall) {
    Write-Host "[K-ERA] Resolved torch profile: $resolvedTorchProfile"
    if ($resolvedTorchProfile -eq "gpu") {
        if ($TorchIndexUrl) {
            Write-Host "[K-ERA] Installing base requirements from $baseRequirementsPath"
            Invoke-CheckedCommand -Executable $venvPython -Arguments @("-m", "pip", "install", "-r", $baseRequirementsPath)
            Write-Host "[K-ERA] Installing GPU torch packages from custom index: $TorchIndexUrl"
            Invoke-CheckedCommand -Executable $venvPython -Arguments @(
                "-m", "pip", "install", "--upgrade",
                "torch==$gpuTorchVersion",
                "torchvision==$gpuTorchvisionVersion",
                "--index-url", $TorchIndexUrl
            )
        } else {
            Write-Host "[K-ERA] Installing GPU profile requirements from $gpuRequirementsPath"
            Write-Host "[K-ERA] Default GPU torch index: $defaultGpuIndexUrl"
            Invoke-CheckedCommand -Executable $venvPython -Arguments @("-m", "pip", "install", "-r", $gpuRequirementsPath)
        }
    } else {
        if ($TorchIndexUrl) {
            Write-Warning "Ignoring -TorchIndexUrl because CPU profile was selected."
        }
        Write-Host "[K-ERA] Installing CPU profile requirements from $cpuRequirementsPath"
        Invoke-CheckedCommand -Executable $venvPython -Arguments @("-m", "pip", "install", "-r", $cpuRequirementsPath)
    }
} else {
    Write-Host "[K-ERA] Installing application packages without torch from $baseRequirementsPath"
    Invoke-CheckedCommand -Executable $venvPython -Arguments @("-m", "pip", "install", "-r", $baseRequirementsPath)
}

$env:KERA_EXPECT_CUDA_MODE = if ($resolvedTorchProfile -eq "gpu") { "required" } else { "optional" }
$env:KERA_TORCH_PROFILE = $resolvedTorchProfile
$env:KERA_CPU_TORCH_VERSION = $cpuTorchVersion
$env:KERA_CPU_TORCHVISION_VERSION = $cpuTorchvisionVersion
$env:KERA_GPU_TORCH_VERSION = $gpuTorchVersion
$env:KERA_GPU_TORCHVISION_VERSION = $gpuTorchvisionVersion

Write-Host "[K-ERA] Running health check"
@'
import importlib
import os

packages = ["fastapi", "uvicorn", "pandas", "plotly", "matplotlib", "numpy", "PIL", "sklearn", "torch", "torchvision", "bcrypt", "faiss"]
missing = []
for name in packages:
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)

if missing:
    raise SystemExit(f"Missing packages after setup: {', '.join(missing)}")

import torch
import torchvision

expected_mode = os.getenv("KERA_EXPECT_CUDA_MODE", "optional")
torch_profile = os.getenv("KERA_TORCH_PROFILE", "unknown")

print(f"torch={torch.__version__}")
print(f"torchvision={torchvision.__version__}")
print(f"torch_profile={torch_profile}")
print(f"torch_cuda_version={torch.version.cuda}")
print(f"cuda_available={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"gpu_name={torch.cuda.get_device_name(0)}")

if expected_mode == "required" and not torch.cuda.is_available():
    cpu_torch = os.getenv("KERA_CPU_TORCH_VERSION", "")
    gpu_torch = os.getenv("KERA_GPU_TORCH_VERSION", "")
    gpu_vision = os.getenv("KERA_GPU_TORCHVISION_VERSION", "")
    raise SystemExit(
        "GPU profile was requested but CUDA is not available. "
        f"Installed torch={torch.__version__}. Expected a CUDA-enabled build such as "
        f"torch=={gpu_torch} / torchvision=={gpu_vision} instead of CPU torch {cpu_torch}."
    )
'@ | & $venvPython -
if ($LASTEXITCODE -ne 0) {
    throw "Health check failed."
}

Write-Host "[K-ERA] Local node setup completed" -ForegroundColor Green
Write-Host "[K-ERA] Start with: .\scripts\run_local_node.ps1"
