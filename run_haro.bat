@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Setting up Haro for the first time...
  py -3 -m venv .venv 2>NUL || python -m venv .venv
)
rem Install again whenever requirements.txt changes. pygame is removed first because
rem pygame-ce replaces it and the two cannot be installed together.
fc /b requirements.txt .venv\haro_ready.txt >NUL 2>&1 || (
  echo Installing libraries...
  .venv\Scripts\python -m pip uninstall -y -q pygame >NUL 2>&1
  .venv\Scripts\python -m pip install -r requirements.txt && copy /y requirements.txt .venv\haro_ready.txt >NUL
)
.venv\Scripts\python haro.py %*
pause
