$thresholdGB = 10
$thresholdPct = 15

$drives = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" |
    Select-Object DeviceID,
        @{N="SizeGB";     E={[math]::Round($_.Size / 1GB, 2)}},
        @{N="FreeGB";     E={[math]::Round($_.FreeSpace / 1GB, 2)}},
        @{N="FreePct";    E={[math]::Round(($_.FreeSpace / $_.Size) * 100, 1)}},
        @{N="UsedGB";     E={[math]::Round(($_.Size - $_.FreeSpace) / 1GB, 2)}}

$alerts = @()
foreach ($d in $drives) {
    $status = if ($d.FreeGB -lt $thresholdGB -or $d.FreePct -lt $thresholdPct) {
        $alerts += $d
        "LOW"
    } else {
        "OK"
    }
    $d | Add-Member -NotePropertyName "Status" -NotePropertyValue $status
}

$drives | Sort-Object DeviceID | Format-Table DeviceID, SizeGB, FreeGB, FreePct, UsedGB, Status -AutoSize

if ($alerts.Count -gt 0) {
    Write-Output "`nWARNING: $($alerts.Count) drive(s) below threshold ($thresholdGB GB / $thresholdPct%):"
    foreach ($a in $alerts) {
        Write-Output "  $($a.DeviceID) — $($a.FreeGB) GB free ($($a.FreePct)%)"
    }
} else {
    Write-Output "`nAll drives OK (threshold: $thresholdGB GB / $thresholdPct%)"
}
