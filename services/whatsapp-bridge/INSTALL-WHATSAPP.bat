@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title JJ-Media WhatsApp + lokale KI - Installation
color 0A

set "OLLAMA_MODEL=qwen3:4b"
set "OLLAMA_EXE="

echo.
echo ==================================================
echo   JJ-MEDIA WHATSAPP + LOKALE KI - INSTALLATION
echo ==================================================
echo.
echo Dieser Installer richtet WhatsApp, Ollama und die lokale

echo JJ-Media KI ein. Kein Dify- oder OpenAI-API-Abo erforderlich.
echo.

where node >nul 2>&1
if errorlevel 1 goto install_node
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 20 goto install_node
goto check_git

:install_node
echo [1/6] Node.js 20+ wird installiert ...
where winget >nul 2>&1
if errorlevel 1 goto no_winget
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto restart_after_node
goto check_git

:restart_after_node
echo.
echo Node.js wurde installiert. Bitte dieses Fenster schliessen und

echo INSTALL-WHATSAPP.bat danach erneut doppelklicken.
pause
exit /b 1

:no_winget
echo.
echo Windows Package Manager fehlt. Bitte Node.js LTS, Git und Ollama

echo einmal manuell installieren und diese Datei erneut starten.
echo Node.js: https://nodejs.org/
echo Git:     https://git-scm.com/download/win
echo Ollama:  https://ollama.com/download/windows
pause
exit /b 1

:check_git
where git >nul 2>&1
if not errorlevel 1 goto check_ollama
echo [2/6] Git fuer Windows wird installiert ...
where winget >nul 2>&1
if errorlevel 1 goto no_winget
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 goto restart_after_git
goto check_ollama

:restart_after_git
echo.
echo Git wurde installiert. Bitte dieses Fenster schliessen und

echo INSTALL-WHATSAPP.bat danach erneut doppelklicken.
pause
exit /b 1

:check_ollama
echo [3/6] Lokale KI pruefen ...
where ollama >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%I in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
)
if defined OLLAMA_EXE goto start_ollama
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if defined OLLAMA_EXE goto start_ollama

echo Ollama wird installiert ...
where winget >nul 2>&1
if errorlevel 1 goto no_winget
winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA_EXE (
  where ollama >nul 2>&1
  if not errorlevel 1 for /f "delims=" %%I in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
)
if not defined OLLAMA_EXE goto restart_after_ollama

:start_ollama
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto pull_model
start "JJ-Media Ollama" /min "%OLLAMA_EXE%" serve
echo Lokale KI wird gestartet ...
timeout /t 4 >nul

:pull_model
echo KI-Modell %OLLAMA_MODEL% wird geprueft bzw. einmalig geladen.
echo Beim ersten Mal werden etwa 2,5 GB heruntergeladen.
"%OLLAMA_EXE%" pull %OLLAMA_MODEL%
if errorlevel 1 goto ollama_failed

goto install_deps

:restart_after_ollama
echo.
echo Ollama wurde installiert. Bitte dieses Fenster schliessen und

echo INSTALL-WHATSAPP.bat danach erneut doppelklicken.
pause
exit /b 1

:ollama_failed
echo.
echo Das lokale KI-Modell konnte nicht geladen werden.
echo Internetverbindung pruefen und INSTALL-WHATSAPP.bat erneut starten.
pause
exit /b 1

:install_deps
echo.
echo [4/6] Schlanken WhatsApp-Dienst installieren ...
rem Baileys nutzt eine oeffentliche GitHub-Abhaengigkeit. Fuer diesen Installationsprozess
rem wird Git lokal auf HTTPS umgebogen, damit keinerlei GitHub-SSH-Key benoetigt wird.
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
if errorlevel 1 goto failed

echo.
echo [5/6] Mit dem JJ-Media Outbound Tool verbinden ...
node setup.mjs
if errorlevel 1 goto failed

echo.
echo [6/6] Autostart in Windows einrichten ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
if errorlevel 1 goto failed

echo.
echo ==================================================
echo   FERTIG - WHATSAPP + LOKALE KI WERDEN GESTARTET

echo ==================================================
echo.
echo KI: %OLLAMA_MODEL% lokal auf diesem Laptop.
echo Beim ersten WhatsApp-Start QR-Code scannen.
echo Danach startet der JJ-Media Dienst automatisch mit Windows.
echo Der bestehende data-Ordner und die WhatsApp-Kopplung bleiben erhalten.
echo.
start "JJ-Media WhatsApp" "%~dp0START-WHATSAPP.bat"
timeout /t 2 >nul
exit /b 0

:failed
echo.
echo Installation nicht abgeschlossen. Die Fehlermeldung steht direkt darueber.
pause
exit /b 1
