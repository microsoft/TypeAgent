' Copyright (c) Microsoft Corporation.
' Licensed under the MIT License.

Option Explicit

Const INSTALLMESSAGE_PROGRESS = &H0A000000

Function ResetProgress(totalTicks)
    Dim record
    Set record = Session.Installer.CreateRecord(4)
    record.IntegerData(1) = 0
    record.IntegerData(2) = totalTicks
    record.IntegerData(3) = 0
    record.IntegerData(4) = 0
    Session.Message INSTALLMESSAGE_PROGRESS, record

    Set record = Session.Installer.CreateRecord(3)
    record.IntegerData(1) = 1
    record.IntegerData(2) = 1
    record.IntegerData(3) = 0
    Session.Message INSTALLMESSAGE_PROGRESS, record

    ResetProgress = 1
End Function

Function ResetMainProgress()
    ResetMainProgress = ResetProgress(7)
End Function

Function ResetShellProgress()
    ResetShellProgress = ResetProgress(3)
End Function

Function AdvanceProgress()
    Dim record
    Set record = Session.Installer.CreateRecord(3)
    record.IntegerData(1) = 2
    record.IntegerData(2) = 1
    record.IntegerData(3) = 0
    Session.Message INSTALLMESSAGE_PROGRESS, record
    AdvanceProgress = 1
End Function
