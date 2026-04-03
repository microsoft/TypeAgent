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

$levelCounts = @{}
$fileCounts = @{}

foreach ($m in $matches) {
    $level = if ($m.Line -match "FATAL") { "FATAL" }
             elseif ($m.Line -match "ERROR") { "ERROR" }
             elseif ($m.Line -match "WARN")  { "WARN" }
             elseif ($m.Line -match "Exception") { "EXCEPTION" }
             else { "OTHER" }
    $levelCounts[$level] = ($levelCounts[$level] -as [int]) + 1
    $fileCounts[$m.Filename] = ($fileCounts[$m.Filename] -as [int]) + 1
}

Write-Output "=== Summary by Severity ==="
foreach ($level in @("FATAL","ERROR","WARN","EXCEPTION","OTHER")) {
    if ($levelCounts[$level]) {
        Write-Output "  ${level}: $($levelCounts[$level]) occurrence(s)"
    }
}

Write-Output "`n=== Top Files by Error Count ==="
$sortedFiles = $fileCounts.Keys | Sort-Object { $fileCounts[$_] } -Descending | Select-Object -First 5
foreach ($file in $sortedFiles) {
    Write-Output "  $($fileCounts[$file]) hits - $file"
}

Write-Output "`nTotal: $($matches.Count) match(es) across $($logFiles.Count) file(s)"
