Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
shell.Run "cmd.exe /c " & Chr(34) & Chr(34) & folder & "\START-WHATSAPP.bat" & Chr(34) & Chr(34), 0, False
