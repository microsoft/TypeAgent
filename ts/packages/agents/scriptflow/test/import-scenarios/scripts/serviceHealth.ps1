param(
    # Comma-separated service names, or "default" for the standard set
    [string]$ServiceList = "default"
)

# Standard services to monitor
$defaultServices = @(
    "W32Time", "WinRM", "Spooler", "BITS",
    "wuauserv", "EventLog", "Schedule", "Winmgmt"
)

$serviceNames = if ($ServiceList -eq "default") {
    $defaultServices
} else {
    $ServiceList -split "," | ForEach-Object { $_.Trim() }
}

$running = 0
$stopped = 0
$missing = 0
$output = @()

foreach ($name in $serviceNames) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc) {
        $status = "$($svc.Status)"
        $output += "  $status  $($svc.Name) - $($svc.DisplayName)"
        if ($status -eq "Running") { $running++ } else { $stopped++ }
    } else {
        $output += "  MISSING  $name - (not found)"
        $missing++
    }
}

Write-Output "=== Service Health ==="
Write-Output ($output -join "`n")
Write-Output ""
Write-Output "Summary: $($serviceNames.Count) checked | $running running | $stopped stopped | $missing missing"

if ($stopped -gt 0 -or $missing -gt 0) {
    Write-Output "`nAttention needed:"
    foreach ($line in $output) {
        if ($line -notmatch "Running") {
            Write-Output $line
        }
    }
}
