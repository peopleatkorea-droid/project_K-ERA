function Get-ListeningProcessInfo {
    param(
        [int]$Port
    )

    $connections = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Sort-Object -Property OwningProcess -Unique
    )
    if (-not $connections -or $connections.Count -eq 0) {
        return $null
    }

    $processId = $connections[0].OwningProcess
    if (-not $processId) {
        return $null
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if ($process) {
        return [pscustomobject]@{
            ProcessId   = [int]$process.ProcessId
            Name        = [string]$process.Name
            CommandLine = [string]$process.CommandLine
        }
    }

    return [pscustomobject]@{
        ProcessId   = [int]$processId
        Name        = ""
        CommandLine = ""
    }
}

function Test-ProcessCommandLineMatchesAnyPattern {
    param(
        [psobject]$ProcessInfo,
        [string[]]$Patterns = @()
    )

    if (-not $ProcessInfo) {
        return $false
    }

    $commandLine = [string]$ProcessInfo.CommandLine
    if (-not $commandLine) {
        return $false
    }

    $normalizedCommandLine = $commandLine.ToLowerInvariant()
    foreach ($pattern in $Patterns) {
        if (-not $pattern) {
            continue
        }

        if ($normalizedCommandLine.Contains($pattern.ToLowerInvariant())) {
            return $true
        }
    }

    return $false
}

function Wait-PortReleased {
    param(
        [int]$Port,
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-ListeningProcessInfo -Port $Port)) {
            return $true
        }

        Start-Sleep -Milliseconds 250
    }

    return -not (Get-ListeningProcessInfo -Port $Port)
}

function Stop-ManagedProcessOnPort {
    param(
        [int]$Port,
        [string]$Label,
        [string]$RepoRoot = "",
        [string[]]$CommandPatterns = @(),
        [int]$TimeoutSeconds = 10
    )

    $processInfo = Get-ListeningProcessInfo -Port $Port
    if (-not $processInfo) {
        return $true
    }

    $commandLine = [string]$processInfo.CommandLine
    $matchesRepoRoot = $false
    if ($RepoRoot -and $commandLine) {
        $matchesRepoRoot = $commandLine.ToLowerInvariant().Contains($RepoRoot.ToLowerInvariant())
    }

    $matchesPattern = Test-ProcessCommandLineMatchesAnyPattern -ProcessInfo $processInfo -Patterns $CommandPatterns
    if (-not ($matchesRepoRoot -or $matchesPattern)) {
        return $false
    }

    Write-Host "[K-ERA] Port $Port is in use by an existing $Label process (PID $($processInfo.ProcessId)). Stopping it..." -ForegroundColor Yellow
    Stop-Process -Id $processInfo.ProcessId -Force -ErrorAction Stop

    if (-not (Wait-PortReleased -Port $Port -TimeoutSeconds $TimeoutSeconds)) {
        throw "Timed out waiting for port $Port to be released after stopping PID $($processInfo.ProcessId)."
    }

    return $true
}

function Stop-ProcessesMatchingPatterns {
    param(
        [string]$Label,
        [string[]]$CommandPatterns,
        [string[]]$ProcessNames = @("python.exe", "node.exe")
    )

    if (-not $CommandPatterns -or $CommandPatterns.Count -eq 0) {
        return 0
    }

    $filter = ($ProcessNames | ForEach-Object { "Name = '$_'" }) -join " OR "
    $candidates = @(Get-CimInstance Win32_Process -Filter $filter -ErrorAction SilentlyContinue)
    $stopped = 0

    foreach ($candidate in $candidates) {
        $processInfo = [pscustomobject]@{
            ProcessId   = [int]$candidate.ProcessId
            Name        = [string]$candidate.Name
            CommandLine = [string]$candidate.CommandLine
        }

        if (-not (Test-ProcessCommandLineMatchesAnyPattern -ProcessInfo $processInfo -Patterns $CommandPatterns)) {
            continue
        }

        Write-Host "[K-ERA] Found an existing $Label process (PID $($processInfo.ProcessId)). Stopping it..." -ForegroundColor Yellow
        Stop-Process -Id $processInfo.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped += 1
    }

    return $stopped
}
