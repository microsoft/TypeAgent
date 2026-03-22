param(
    # Comma-separated service names, or "default" for the standard set
    [string]$ServiceList = "default",
    [ValidateSet("table", "list", "summary")]
    [string]$OutputFormat = "table"
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

$results = @()
foreach ($name in $serviceNames) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($svc) {
        $results += [PSCustomObject]@{
            Name      = $svc.Name
            Display   = $svc.DisplayName
            Status    = $svc.Status.ToString()
            StartType = $svc.StartType.ToString()
        }
    } else {
        $results += [PSCustomObject]@{
            Name      = $name
            Display   = "(not found)"
            Status    = "MISSING"
            StartType = "N/A"
        }
    }
}

# Output based on format preference
switch ($OutputFormat) {
    "list"    { $results | Format-List }
    "summary" {
        $running = ($results | Where-Object { $_.Status -eq "Running" }).Count
        $stopped = ($results | Where-Object { $_.Status -eq "Stopped" }).Count
        $missing = ($results | Where-Object { $_.Status -eq "MISSING" }).Count
        Write-Output "Services: $($results.Count) checked | $running running | $stopped stopped | $missing missing"
        if ($stopped -gt 0 -or $missing -gt 0) {
            Write-Output "`nAttention needed:"
            $results | Where-Object { $_.Status -ne "Running" } |
                ForEach-Object { Write-Output "  [$($_.Status)] $($_.Name) - $($_.Display)" }
        }
    }
    default   { $results | Sort-Object Status | Format-Table -AutoSize }
}
