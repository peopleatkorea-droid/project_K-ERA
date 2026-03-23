# Desktop Installed Smoke

Use this after creating a Windows installer and installing it on a target machine.

## Goal

Verify that the installed desktop app is behaving like a packaged runtime, not like a repo-backed dev shell.

## Quick Command

From [frontend/package.json](/c:/Users/USER/Downloads/project_K-ERA/frontend/package.json):

```powershell
npm run desktop:smoke-installed
```

To package, install, and run the installed smoke automatically:

```powershell
npm run desktop:smoke-installed:cpu
npm run desktop:smoke-installed:gpu
```

Optional launch smoke:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-installed-desktop-smoke.ps1 -LaunchSeconds 15
```

Optional explicit install directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-installed-desktop-smoke.ps1 -InstallDir "C:\Users\USER\AppData\Local\Programs\K-ERA Desktop"
```

The automatic wrapper script is [run-desktop-installer-smoke.ps1](/c:/Users/USER/Downloads/project_K-ERA/frontend/scripts/run-desktop-installer-smoke.ps1). It:

- runs `desktop:package:<profile>` unless `-SkipPackage` is passed
- for `cpu`, finds the newest installer artifact and installs it silently into a smoke-test directory
- for `gpu`, uses the portable package output under `frontend/desktop-package-variants/gpu/portable`
- calls `run-installed-desktop-smoke.ps1` against that installed or portable copy

## What It Checks

The script in [run-installed-desktop-smoke.ps1](/c:/Users/USER/Downloads/project_K-ERA/frontend/scripts/run-installed-desktop-smoke.ps1) verifies:

- installed desktop executable exists
- packaged runtime layout resolves correctly
- bundled backend entry exists
- bundled backend source tree exists
- bundled Python runtime exists
- optional launch smoke can confirm `%LOCALAPPDATA%\KERA` is created and runtime/config paths appear

Variant note:

- `desktop:smoke-installed:cpu` validates the real Windows installer path
- `desktop:smoke-installed:gpu` validates the portable GPU package path because the CUDA runtime is too large for the current Windows installer flow

## Manual Follow-up

After the script passes, verify these manually on a clean Windows machine:

1. Launch the installed app without a repo checkout present.
2. Confirm the desktop shell shows `Packaged` runtime mode.
3. Use the guided setup flow to choose storage, save node settings, and start the local runtime.
4. Confirm backend, worker, and ML sidecar all report healthy or expected status.
5. Sign in with an approved local workspace account and open a patient workspace.
