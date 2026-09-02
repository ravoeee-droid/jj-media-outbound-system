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
  call npm install --omit=dev
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
