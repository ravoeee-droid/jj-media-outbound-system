@echo off
setlocal
cd /d "%~dp0"
if not exist "data\worker.pid" (
  echo JJ-Media WhatsApp laeuft laut Status nicht.
  pause
  exit /b 0
)
set /p PID=<"data\worker.pid"
taskkill /PID %PID% /T >nul 2>&1
if errorlevel 1 (
  echo Prozess war bereits beendet.
) else (
  echo JJ-Media WhatsApp wurde gestoppt.
)
del /q "data\worker.pid" >nul 2>&1
pause
