# Desktop Installed Smoke

Use this after creating a Windows installer and installing it on a target machine.

## Goal

Verify that the installed desktop app is behaving like a packaged runtime, not like a repo-backed dev shell.

## Quick Command

From [frontend/package.json](/c:/Users/USER/Downloads/project_K-ERA/frontend/package.json):

```powershell
npm run desktop:smoke-installed
```

Optional launch smoke:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-installed-desktop-smoke.ps1 -LaunchSeconds 15
```

Optional explicit install directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-installed-desktop-smoke.ps1 -InstallDir "C:\Users\USER\AppData\Local\Programs\K-ERA Desktop"
```

## What It Checks

The script in [run-installed-desktop-smoke.ps1](/c:/Users/USER/Downloads/project_K-ERA/frontend/scripts/run-installed-desktop-smoke.ps1) verifies:

- installed desktop executable exists
- bundled `resources/` directory exists
- bundled backend entry exists
- bundled backend source tree exists
- bundled Python runtime exists
- optional launch smoke can confirm `%LOCALAPPDATA%\KERA` is created and runtime/config paths appear

## Manual Follow-up

After the script passes, verify these manually on a clean Windows machine:

1. Launch the installed app without a repo checkout present.
2. Confirm the desktop shell shows `Packaged` runtime mode.
3. Use the guided setup flow to choose storage, save node settings, and start the local runtime.
4. Confirm backend, worker, and ML sidecar all report healthy or expected status.
5. Sign in with an approved local workspace account and open a patient workspace.
