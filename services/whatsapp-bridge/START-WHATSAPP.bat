@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JJ-Media WhatsApp + lokale KI
color 0A

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js fehlt. Bitte zuerst INSTALL-WHATSAPP.bat starten.
  pause
  exit /b 1
)

set "OLLAMA_EXE="
where ollama >nul 2>&1
if not errorlevel 1 for /f "delims=" %%I in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
if not defined OLLAMA_EXE if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if defined OLLAMA_EXE (
  powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
  if errorlevel 1 (
    start "JJ-Media Ollama" /min "%OLLAMA_EXE%" serve
    timeout /t 3 >nul
  )
) else (
  echo Hinweis: Ollama fehlt. WhatsApp startet, die lokale KI bleibt jedoch aus.
  echo Fuer die KI bitte INSTALL-WHATSAPP.bat erneut ausfuehren.
)

if not exist "node_modules\@whiskeysockets\baileys" (
  echo WhatsApp-Dienst wird vervollstaendigt ...
  where git >nul 2>&1
  if errorlevel 1 (
    echo Git fehlt. Bitte zuerst INSTALL-WHATSAPP.bat starten.
    pause
    exit /b 1
  )
  set "GIT_CONFIG_COUNT=2"
  set "GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf"
  set "GIT_CONFIG_VALUE_0=ssh://git@github.com/"
  set "GIT_CONFIG_KEY_1=url.https://github.com/.insteadOf"
  set "GIT_CONFIG_VALUE_1=git@github.com:"
  call npm install --omit=dev --no-package-lock
  set "GIT_CONFIG_COUNT="
  set "GIT_CONFIG_KEY_0="
  set "GIT_CONFIG_VALUE_0="
  set "GIT_CONFIG_KEY_1="
  set "GIT_CONFIG_VALUE_1="
  if errorlevel 1 (
    echo Installation der Abhaengigkeiten fehlgeschlagen.
    pause
    exit /b 1
  )
)
node server.mjs
if errorlevel 1 (
  echo.
  echo Der Dienst wurde mit einem Fehler beendet. Bitte die Meldung oben pruefen.
  pause
)
