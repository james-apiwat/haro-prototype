@echo off
rem Opens the Haro Simulator in the browser. Needs any Python 3, nothing to install.
cd /d "%~dp0"
set PORT=8765
set PY=python
where py >NUL 2>&1 && set PY=py -3
if exist .venv\Scripts\python.exe set PY=.venv\Scripts\python.exe
echo Haro Simulator: http://localhost:%PORT%/sim/
echo Keep this window open while you play. Close it when you are done.
start "" "http://localhost:%PORT%/sim/"
%PY% -m http.server %PORT% --bind 127.0.0.1
pause
