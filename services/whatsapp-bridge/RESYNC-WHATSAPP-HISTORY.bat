@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JJ-Media WhatsApp Historie neu synchronisieren
color 0E

echo.
echo ==============================================
echo JJ-MEDIA WHATSAPP - HISTORIE NEU EINLESEN
echo ==============================================
echo.
echo Dadurch wird nur die lokale WhatsApp-Geraetekopplung zurueckgesetzt.
echo Deine JJ-Media-Konfiguration und Ollama bleiben erhalten.
echo Danach musst du den neuen QR-Code einmal mit WhatsApp scannen.
echo.
choice /C JN /N /M "Historie jetzt neu synchronisieren? [J/N]: "
if errorlevel 2 exit /b 0

if exist "data\worker.pid" (
  set /p PID=<"data\worker.pid"
  taskkill /PID %PID% /T >nul 2>&1
  del /q "data\worker.pid" >nul 2>&1
  timeout /t 2 >nul
)

if exist "data\auth" rmdir /s /q "data\auth"
mkdir "data\auth" >nul 2>&1

echo.
echo Lokale Kopplung wurde zurueckgesetzt.
echo Jetzt startet WhatsApp im Desktop-History-Modus.
echo Bitte den QR-Code mit WhatsApp - Einstellungen - Verknuepfte Geraete scannen.
echo.
call START-WHATSAPP.bat
