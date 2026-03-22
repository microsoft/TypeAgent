$logDir = "C:\Logs\AppServer"
$today = Get-Date -Format "yyyy-MM-dd"
$pattern = "(ERROR|WARN|FATAL|Exception|StackTrace)"

$logFiles = Get-ChildItem -Path $logDir -Filter "*$today*.log" -ErrorAction SilentlyContinue
if (-not $logFiles) {
    Write-Output "No log files found for $today in $logDir"
    return
}

Write-Output "Scanning $($logFiles.Count) log file(s) for $today...`n"

$matches = $logFiles | ForEach-Object {
    Select-String -Path $_.FullName -Pattern $pattern -AllMatches
}

if ($matches.Count -eq 0) {
    Write-Output "No errors or warnings found. Clean day!"
    return
}

$summary = $matches | ForEach-Object {
    $level = if ($_.Line -match "FATAL") { "FATAL" }
             elseif ($_.Line -match "ERROR") { "ERROR" }
             elseif ($_.Line -match "WARN")  { "WARN" }
             elseif ($_.Line -match "Exception") { "EXCEPTION" }
             else { "OTHER" }
    [PSCustomObject]@{ Level = $level; File = $_.Filename; Line = $_.LineNumber }
}

Write-Output "=== Summary by Severity ==="
$summary | Group-Object Level | Sort-Object Count -Descending |
    ForEach-Object { Write-Output "  $($_.Name): $($_.Count) occurrence(s)" }

Write-Output "`n=== Top Files by Error Count ==="
$summary | Group-Object File | Sort-Object Count -Descending | Select-Object -First 5 |
    ForEach-Object { Write-Output "  $($_.Count) hits - $($_.Name)" }

Write-Output "`nTotal: $($matches.Count) match(es) across $($logFiles.Count) file(s)"
