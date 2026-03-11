param(
    [string]$PythonExe = "python",
    [string]$TorchIndexUrl = "",
    [switch]$SkipTorchInstall
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$requirementsPath = Join-Path $repoRoot "requirements.txt"

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

    $requested = ($RequestedPython ?? "").Trim()
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
& $venvPython -m pip install --upgrade pip setuptools wheel

if ($SkipTorchInstall) {
    $tempRequirements = Join-Path $env:TEMP "kera_requirements_no_torch.txt"
    Get-Content $requirementsPath | Where-Object { $_ -notmatch '^torch' } | Set-Content $tempRequirements
    Write-Host "[K-ERA] Installing application packages without torch"
    & $venvPython -m pip install -r $tempRequirements
} else {
    Write-Host "[K-ERA] Installing application packages"
    & $venvPython -m pip install -r $requirementsPath
}

if ($TorchIndexUrl) {
    Write-Host "[K-ERA] Reinstalling torch using custom index: $TorchIndexUrl"
    & $venvPython -m pip install --upgrade torch --index-url $TorchIndexUrl
}

Write-Host "[K-ERA] Running health check"
@'
import importlib
packages = ["fastapi", "uvicorn", "pandas", "plotly", "matplotlib", "numpy", "PIL", "sklearn", "torch"]
missing = []
for name in packages:
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)

if missing:
    raise SystemExit(f"Missing packages after setup: {', '.join(missing)}")

import torch
print(f"torch={torch.__version__}")
print(f"cuda_available={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"gpu_name={torch.cuda.get_device_name(0)}")
'@ | & $venvPython -

Write-Host "[K-ERA] Local node setup completed" -ForegroundColor Green
Write-Host "[K-ERA] Start with: .\scripts\run_local_node.ps1"
