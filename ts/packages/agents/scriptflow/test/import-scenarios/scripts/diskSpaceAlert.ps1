param(
    [int]$ThresholdGB = 10,
    [int]$ThresholdPct = 15
)

$drives = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3"

$alertCount = 0
Write-Output "=== Disk Space Report ==="

foreach ($d in $drives) {
    $sizeGB = "{0:N2}" -f ($d.Size / 1GB)
    $freeGB = "{0:N2}" -f ($d.FreeSpace / 1GB)
    $usedGB = "{0:N2}" -f (($d.Size - $d.FreeSpace) / 1GB)
    $freePct = "{0:N1}" -f (($d.FreeSpace / $d.Size) * 100)
    $freeGBNum = $d.FreeSpace / 1GB
    $freePctNum = ($d.FreeSpace / $d.Size) * 100

    $status = if ($freeGBNum -lt $ThresholdGB -or $freePctNum -lt $ThresholdPct) {
        $alertCount++
        "LOW"
    } else {
        "OK"
    }

    Write-Output "  $($d.DeviceID)  Size: ${sizeGB}GB  Free: ${freeGB}GB (${freePct}%)  Used: ${usedGB}GB  [$status]"
}

Write-Output ""
if ($alertCount -gt 0) {
    Write-Output "WARNING: $alertCount drive(s) below threshold ($ThresholdGB GB / $ThresholdPct%)"
} else {
    Write-Output "All drives OK (threshold: $ThresholdGB GB / $ThresholdPct%)"
}
