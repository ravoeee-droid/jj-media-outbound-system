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
