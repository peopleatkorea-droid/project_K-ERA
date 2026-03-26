@echo off
setlocal
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\run_transformer_weekend_plan.py" %*
) else (
  py -3 "%~dp0scripts\run_transformer_weekend_plan.py" %*
)
