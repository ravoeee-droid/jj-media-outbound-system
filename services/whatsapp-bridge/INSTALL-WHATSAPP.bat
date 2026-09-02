@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JJ-Media WhatsApp - Installation
color 0A

echo.
echo ============================================
echo   JJ-MEDIA WHATSAPP - EINMALIGE INSTALLATION
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 goto install_node
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 20 goto install_node
goto install_deps

:install_node
echo Node.js 20+ wird benoetigt. Installation wird versucht ...
where winget >nul 2>&1
if errorlevel 1 goto no_winget
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto node_failed
goto install_deps

:no_winget
echo.
echo Bitte zuerst Node.js LTS von nodejs.org installieren und diese Datei erneut starten.
pause
exit /b 1

:node_failed
echo.
echo Node.js wurde installiert, Windows kennt den neuen Pfad aber noch nicht.
echo Bitte dieses Fenster schliessen und INSTALL-WHATSAPP.bat erneut doppelklicken.
pause
exit /b 1

:install_deps
echo [1/3] Schlanken WhatsApp-Dienst installieren ...
call npm install --omit=dev
if errorlevel 1 goto failed

echo.
echo [2/3] Mit dem JJ-Media Outbound Tool verbinden ...
node setup.mjs
if errorlevel 1 goto failed

echo.
echo [3/3] Autostart in Windows einrichten ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
if errorlevel 1 goto failed

echo.
echo ============================================
echo   FERTIG - WHATSAPP WIRD JETZT GESTARTET
echo ============================================
echo.
echo Beim ersten Mal QR-Code mit WhatsApp scannen.
echo Danach startet der Dienst automatisch mit Windows.
echo.
start "JJ-Media WhatsApp" "%~dp0START-WHATSAPP.bat"
timeout /t 2 >nul
exit /b 0

:failed
echo.
echo Installation nicht abgeschlossen. Die Fehlermeldung steht direkt darueber.
pause
exit /b 1
