' Copyright (c) Microsoft Corporation.
' Licensed under the MIT License.

' Immediate UI custom actions for TypeAgentExitDlg.
'   CheckTypeAgentConfig - runs after ExecuteAction; flags a missing
'     config.local.yaml so the dialog only shows the retry command when
'     provisioning did not complete (deferred actions can't report back to UI).
'   CopySetupCommand - behind the Copy button. Windows Installer has no
'     clipboard control event, so copy the command from script.

Option Explicit

Function ResetTypeAgentPluginStatus()
    Dim fso, statusPath
    Session.Property("TYPEAGENTPLUGINSTATUSRESET") = ""
    On Error Resume Next
    Set fso = CreateObject("Scripting.FileSystemObject")
    statusPath = fso.BuildPath(Session.Property("LocalAppDataFolder"), _
        "TypeAgent\logs\msi-register-plugin.log.status")
    If fso.FileExists(statusPath) Then fso.DeleteFile statusPath, True
    If Err.Number = 0 Then Session.Property("TYPEAGENTPLUGINSTATUSRESET") = "1"
    Err.Clear
    ResetTypeAgentPluginStatus = 1
End Function

Function CheckTypeAgentPlugin()
    Dim fso, statusPath, statusFile, status
    ' Missing or unreadable status is not proof of successful registration.
    Session.Property("TYPEAGENTPLUGININCOMPLETE") = "1"
    If Session.Property("TYPEAGENTPLUGINSTATUSRESET") <> "1" Then
        CheckTypeAgentPlugin = 1
        Exit Function
    End If
    On Error Resume Next
    Set fso = CreateObject("Scripting.FileSystemObject")
    statusPath = fso.BuildPath(Session.Property("LocalAppDataFolder"), _
        "TypeAgent\logs\msi-register-plugin.log.status")
    Set statusFile = fso.OpenTextFile(statusPath, 1)
    status = Trim(statusFile.ReadLine)
    statusFile.Close
    If Err.Number = 0 And status = "complete" Then
        Session.Property("TYPEAGENTPLUGININCOMPLETE") = ""
    End If
    Err.Clear
    CheckTypeAgentPlugin = 1
End Function

Function CheckTypeAgentConfig()
    Dim fso, localAppData, configPath
    Session.Property("TYPEAGENTCONFIGMISSING") = ""
    On Error Resume Next
    Set fso = CreateObject("Scripting.FileSystemObject")
    ' Mirrors Resolve-TypeAgentUserDataDir: <profile>\.typeagent, where
    ' <profile> is two levels above LocalAppData (<profile>\AppData\Local).
    localAppData = Session.Property("LocalAppDataFolder")
    If Right(localAppData, 1) = "\" Then localAppData = Left(localAppData, Len(localAppData) - 1)
    configPath = fso.BuildPath(fso.GetParentFolderName(fso.GetParentFolderName(localAppData)), _
        ".typeagent\config.local.yaml")
    If Err.Number = 0 Then
        If Not fso.FileExists(configPath) Then
            Session.Property("TYPEAGENTCONFIGMISSING") = "1"
        End If
    End If
    Err.Clear
    CheckTypeAgentConfig = 1
End Function

Function SetClipboardText(text)
    Dim shell, exitCode
    SetClipboardText = False

    ' Pass the text through the environment so no quoting/escaping is needed,
    ' and run PowerShell hidden (window style 0) so no console flashes.
    On Error Resume Next
    Set shell = CreateObject("WScript.Shell")
    shell.Environment("Process")("TYPEAGENT_CLIPBOARD_TEXT") = text
    exitCode = shell.Run("""" & shell.ExpandEnvironmentStrings("%SystemRoot%") & _
        "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command " & _
        """Set-Clipboard -Value $env:TYPEAGENT_CLIPBOARD_TEXT; if (-not $?) { exit 1 }""", 0, True)
    SetClipboardText = (Err.Number = 0 And exitCode = 0)
    shell.Environment("Process").Remove "TYPEAGENT_CLIPBOARD_TEXT"
    Err.Clear
End Function

Function CopySetupCommand()
    Dim command
    command = Session.Property("TYPEAGENTAISYSTEMSCMD")

    If Len(command) > 0 And SetClipboardText(command) Then
        Session.Property("TYPEAGENTCMDCOPIED") = "1"
    Else
        Session.Property("TYPEAGENTCMDCOPIED") = ""
    End If
    CopySetupCommand = 1
End Function
