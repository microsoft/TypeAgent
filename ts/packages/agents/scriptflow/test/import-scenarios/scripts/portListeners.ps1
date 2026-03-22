param(
    [string]$Ports = "80,443,3000,5000,8080"
)

$portList = $Ports -split "," | ForEach-Object { $_.Trim() -as [int] }

$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $portList -contains $_.LocalPort }

if (-not $listeners -or $listeners.Count -eq 0) {
    Write-Output "No listeners found on port(s): $Ports"
    return
}

$count = 0
$listeners | Sort-Object LocalPort | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    $procName = if ($proc) { $proc.ProcessName } else { "(unknown)" }
    $procPath = if ($proc) { $proc.Path } else { "" }
    Write-Output "  Port $($_.LocalPort)  $($_.LocalAddress)  PID $($_.OwningProcess)  $procName  $procPath"
    $count++
}

Write-Output "`n$count listener(s) on $($portList.Count) checked port(s)"
