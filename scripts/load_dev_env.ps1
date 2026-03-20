function Import-LocalEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    foreach ($rawLine in Get-Content -Path $Path -Encoding UTF8) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }

        $parts = $line -split "=", 2
        if ($parts.Length -ne 2) {
            continue
        }

        $name = $parts[0].Trim()
        if (-not $name) {
            continue
        }

        $value = $parts[1].Trim()
        if (
            ($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Resolve-PathValue {
    param(
        [string]$Value,
        [string]$BasePath = ""
    )

    $trimmed = if ($null -eq $Value) { "" } else { $Value.Trim() }
    if (-not $trimmed) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($trimmed)) {
        return [System.IO.Path]::GetFullPath($trimmed)
    }

    $anchor = if ($BasePath) { $BasePath } else { (Get-Location).Path }
    return [System.IO.Path]::GetFullPath((Join-Path $anchor $trimmed))
}

function Join-PathIfBase {
    param(
        [string]$BasePath,
        [string]$ChildPath
    )

    $resolvedBase = Resolve-PathValue -Value $BasePath
    if (-not $resolvedBase) {
        return $null
    }

    return [System.IO.Path]::GetFullPath((Join-Path $resolvedBase $ChildPath))
}

function Get-KeraStorageStatePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    if ($env:KERA_STORAGE_STATE_FILE) {
        return Resolve-PathValue -Value $env:KERA_STORAGE_STATE_FILE -BasePath $RepoRoot
    }

    $localAppData = $env:LOCALAPPDATA
    if (-not $localAppData) {
        try {
            $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        } catch {
            $localAppData = ""
        }
    }
    if ($localAppData) {
        return [System.IO.Path]::GetFullPath((Join-Path $localAppData "KERA\storage_dir.txt"))
    }

    $homeDir = $env:USERPROFILE
    if (-not $homeDir) {
        $homeDir = $HOME
    }
    if ($homeDir) {
        return [System.IO.Path]::GetFullPath((Join-Path $homeDir ".kera\storage_dir.txt"))
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".kera\storage_dir.txt"))
}

function Normalize-KeraStorageBundlePath {
    param(
        [string]$Path,
        [string]$BasePath = ""
    )

    $resolved = Resolve-PathValue -Value $Path -BasePath $BasePath
    if (-not $resolved) {
        return $null
    }

    if ((Split-Path -Leaf $resolved) -ieq "sites") {
        $parent = Split-Path -Parent $resolved
        if ($parent -and (
                (Split-Path -Leaf $parent) -ieq "KERA_DATA" -or
                (Test-Path (Join-Path $parent "control_plane")) -or
                (Test-Path (Join-Path $parent "models")) -or
                (Test-Path (Join-Path $parent "kera.db"))
            )) {
            return [System.IO.Path]::GetFullPath($parent)
        }
    }

    return $resolved
}

function Test-KeraStorageBundle {
    param(
        [string]$Path,
        [string]$BasePath = ""
    )

    $resolved = Normalize-KeraStorageBundlePath -Path $Path -BasePath $BasePath
    if (-not $resolved -or -not (Test-Path $resolved -PathType Container)) {
        return $false
    }

    foreach ($marker in @("sites", "control_plane", "models", "kera.db", "control_plane_cache.db", "kera_secret.key")) {
        if (Test-Path (Join-Path $resolved $marker)) {
            return $true
        }
    }

    return $false
}

function Read-KeraStorageState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    $statePath = Get-KeraStorageStatePath -RepoRoot $RepoRoot
    if (-not (Test-Path $statePath -PathType Leaf)) {
        return $null
    }

    $raw = (Get-Content -Path $statePath -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $raw) {
        return $null
    }

    return Normalize-KeraStorageBundlePath -Path $raw -BasePath $RepoRoot
}

function Save-KeraStorageState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [string]$StorageDir
    )

    $resolved = Normalize-KeraStorageBundlePath -Path $StorageDir -BasePath $RepoRoot
    if (-not $resolved) {
        return
    }

    $statePath = Get-KeraStorageStatePath -RepoRoot $RepoRoot
    $stateDir = Split-Path -Parent $statePath
    if (-not (Test-Path $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    Set-Content -Path $statePath -Value $resolved -Encoding UTF8
}

function Find-KeraStorageBundle {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [string]$ConfiguredStorageDir = ""
    )

    $checked = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    function Get-ValidStorageDir([string]$CandidatePath, [string]$CandidateBasePath) {
        $normalized = Normalize-KeraStorageBundlePath -Path $CandidatePath -BasePath $CandidateBasePath
        if (-not $normalized) {
            return $null
        }
        if (-not $checked.Add($normalized)) {
            return $null
        }
        if (Test-KeraStorageBundle -Path $normalized) {
            return $normalized
        }
        return $null
    }

    $configuredCandidate = Get-ValidStorageDir -CandidatePath $ConfiguredStorageDir -CandidateBasePath $RepoRoot
    if ($configuredCandidate) {
        return $configuredCandidate
    }

    $rememberedCandidate = Get-ValidStorageDir -CandidatePath (Read-KeraStorageState -RepoRoot $RepoRoot) -CandidateBasePath $RepoRoot
    if ($rememberedCandidate) {
        return $rememberedCandidate
    }

    $preferredCandidates = [System.Collections.Generic.List[string]]::new()
    foreach ($candidatePath in @(
            (Join-PathIfBase -BasePath $HOME -ChildPath "KERA_DATA"),
            (Join-PathIfBase -BasePath $HOME -ChildPath "OneDrive\KERA\KERA_DATA"),
            (Join-PathIfBase -BasePath $HOME -ChildPath "OneDrive\KERA_DATA"),
            (Join-PathIfBase -BasePath $env:OneDrive -ChildPath "KERA\KERA_DATA"),
            (Join-PathIfBase -BasePath $env:OneDrive -ChildPath "KERA_DATA"),
            (Join-PathIfBase -BasePath $env:OneDriveCommercial -ChildPath "KERA\KERA_DATA"),
            (Join-PathIfBase -BasePath $env:OneDriveCommercial -ChildPath "KERA_DATA"),
            (Join-PathIfBase -BasePath $env:OneDriveConsumer -ChildPath "KERA\KERA_DATA"),
            (Join-PathIfBase -BasePath $env:OneDriveConsumer -ChildPath "KERA_DATA")
        )) {
        if ($candidatePath) {
            $preferredCandidates.Add($candidatePath)
        }
    }
    if (-not $ConfiguredStorageDir) {
        $preferredCandidates.Insert(0, (Join-Path (Split-Path -Parent $RepoRoot) "KERA_DATA"))
    }

    foreach ($candidate in @(
            $(foreach ($candidatePath in $preferredCandidates) { Get-ValidStorageDir -CandidatePath $candidatePath -CandidateBasePath $RepoRoot })
        )) {
        if ($candidate) {
            return $candidate
        }
    }

    $searchRoots = [System.Collections.Generic.List[string]]::new()
    foreach ($root in @(
            $HOME,
            $env:USERPROFILE,
            $env:OneDrive,
            $env:OneDriveCommercial,
            $env:OneDriveConsumer,
            $(if (-not $ConfiguredStorageDir) { Split-Path -Parent $RepoRoot })
        )) {
        $resolvedRoot = Resolve-PathValue -Value $root -BasePath $RepoRoot
        if (-not $resolvedRoot -or -not (Test-Path $resolvedRoot -PathType Container)) {
            continue
        }
        if (-not $searchRoots.Contains($resolvedRoot)) {
            $searchRoots.Add($resolvedRoot)
        }
    }

    foreach ($root in $searchRoots) {
        foreach ($candidate in @(
                (Join-Path $root "KERA_DATA"),
                (Join-Path $root "KERA\KERA_DATA")
            )) {
            $resolvedCandidate = Get-ValidStorageDir -CandidatePath $candidate -CandidateBasePath $RepoRoot
            if ($resolvedCandidate) {
                return $resolvedCandidate
            }
        }

        foreach ($child in Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue) {
            $directCandidate = Get-ValidStorageDir -CandidatePath $child.FullName -CandidateBasePath $RepoRoot
            if ($directCandidate) {
                return $directCandidate
            }
            $nestedCandidate = Get-ValidStorageDir -CandidatePath (Join-Path $child.FullName "KERA_DATA") -CandidateBasePath $RepoRoot
            if ($nestedCandidate) {
                return $nestedCandidate
            }
        }
    }

    return $null
}

function Initialize-KeraStorageDir {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

    $configured = Normalize-KeraStorageBundlePath -Path $env:KERA_STORAGE_DIR -BasePath $RepoRoot
    $detected = Find-KeraStorageBundle -RepoRoot $RepoRoot -ConfiguredStorageDir $configured
    if ($detected) {
        [Environment]::SetEnvironmentVariable("KERA_STORAGE_DIR", $detected, "Process")
        Save-KeraStorageState -RepoRoot $RepoRoot -StorageDir $detected
        if ($configured -and $configured -ne $detected) {
            Write-Host "[K-ERA] Using detected storage bundle: $detected" -ForegroundColor Yellow
        }
        return $detected
    }

    if ($configured) {
        [Environment]::SetEnvironmentVariable("KERA_STORAGE_DIR", $configured, "Process")
        return $configured
    }

    return $null
}
