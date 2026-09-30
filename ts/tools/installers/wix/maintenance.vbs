' Copyright (c) Microsoft Corporation.
' Licensed under the MIT License.

Option Explicit

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function

Function PrepareMaintenance()
    Dim fso, folder, script, view, record, file, command, root, log
    Set fso = CreateObject("Scripting.FileSystemObject")
    folder = fso.BuildPath(Session.Property("LocalAppDataFolder"), "TypeAgent-msi-" & fso.GetTempName())
    fso.CreateFolder folder
    script = fso.BuildPath(folder, "maintain-server.ps1")
    Set view = Session.Database.OpenView("SELECT `Data` FROM `Binary` WHERE `Name`='MaintainServerPs1'")
    view.Execute
    Set record = view.Fetch
    Set file = fso.CreateTextFile(script, True, True)
    file.Write record.ReadStream(1, record.DataSize(1), 2)
    file.Close
    view.Close

    root = Session.Property("TYPEAGENTROOT") & "."
    log = Session.Property("LocalAppDataFolder") & "TypeAgent\logs\msi-maintenance.log"
    command = Quote(Session.Property("WindowsFolder") & "System32\WindowsPowerShell\v1.0\powershell.exe") & _
        " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(script) & _
        " -Root " & Quote(root) & " -TransactionDir " & Quote(folder) & " -LogPath " & Quote(log)
    Session.Property("BeginMaintenance") = command & " -Action Begin"
    Session.Property("RollbackMaintenance") = command & " -Action Rollback"
    Session.Property("CompleteMaintenance") = command & " -Action Complete"
    Session.Property("CommitMaintenance") = command & " -Action Commit"
    PrepareMaintenance = 1
End Function
