@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JJ-Media WhatsApp
color 0A
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js fehlt. Bitte zuerst INSTALL-WHATSAPP.bat starten.
  pause
  exit /b 1
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
