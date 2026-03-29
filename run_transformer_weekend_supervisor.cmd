@echo off
setlocal
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\run_transformer_weekend_supervisor.py" %*
) else (
  py -3 "%~dp0scripts\run_transformer_weekend_supervisor.py" %*
)
