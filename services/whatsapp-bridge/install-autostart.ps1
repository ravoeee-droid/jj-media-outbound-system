$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "JJ-Media WhatsApp.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot "START-WHATSAPP-SILENT.vbs") + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "JJ-Media WhatsApp automatisch starten"
$shortcut.Save()
Write-Host "Autostart eingerichtet:" $shortcutPath


# Custom browser protocol: jjmedia-whatsapp://start
# This lets the secured web app launch the local WhatsApp/Ollama helper after the
# user confirms the browser prompt. Installed per-user; no admin rights required.
$protocolRoot = "HKCU:\Software\Classes\jjmedia-whatsapp"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:JJ-Media WhatsApp Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
$iconPath = Join-Path $protocolRoot "DefaultIcon"
New-Item -Path $iconPath -Force | Out-Null
Set-Item -Path $iconPath -Value (Join-Path $env:WINDIR "System32\wscript.exe")
$commandPath = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandPath -Force | Out-Null
$vbs = Join-Path $PSScriptRoot "START-WHATSAPP-SILENT.vbs"
$command = '"' + (Join-Path $env:WINDIR "System32\wscript.exe") + '" "' + $vbs + '"'
Set-Item -Path $commandPath -Value $command
Write-Host "Browser-Start eingerichtet: jjmedia-whatsapp://start"
