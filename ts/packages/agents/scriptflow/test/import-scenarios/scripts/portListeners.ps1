param(
    [string]$Ports = "80,443,3000,5000,8080"
)

$portList = $Ports -split "," | ForEach-Object { [int]$_.Trim() }

$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $portList -contains $_.LocalPort }

if ($listeners.Count -eq 0) {
    Write-Output "No listeners found on port(s): $Ports"
    return
}

$details = $listeners | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    [PSCustomObject]@{
        Port    = $_.LocalPort
        Address = $_.LocalAddress
        PID     = $_.OwningProcess
        Process = if ($proc) { $proc.ProcessName } else { "(unknown)" }
        Path    = if ($proc) { $proc.Path } else { "" }
    }
} | Sort-Object Port

$details | Format-Table -AutoSize
Write-Output "$($details.Count) listener(s) on $($portList.Count) checked port(s)"
