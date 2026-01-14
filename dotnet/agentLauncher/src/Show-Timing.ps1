$ErrorActionPreference = "Stop"

$logPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AgentLauncher\agent.log'

if (-not (Test-Path $logPath)) {
    Write-Host "Log file not found at: $logPath" -ForegroundColor Red
    exit 1
}

Write-Host "`nTiming Analysis - Latest Activation" -ForegroundColor Cyan
Write-Host "====================================`n" -ForegroundColor Cyan

# Get timing lines from the latest activation
$timingLines = Get-Content $logPath | Where-Object { $_ -match 'TIMING' } | Select-Object -Last 20

if ($timingLines.Count -eq 0) {
    Write-Host "No timing data found in log" -ForegroundColor Yellow
    exit 0
}

Write-Host "Detailed Timing Breakdown:" -ForegroundColor Green
Write-Host ""

$previousMs = 0
foreach ($line in $timingLines) {
    if ($line -match '\[TIMING \[([^\]]+)\]\] \+(\d+)ms - (.+)') {
        $marker = $matches[1]
        $totalMs = [int]$matches[2]
        $description = $matches[3]
        $delta = $totalMs - $previousMs

        $color = "White"
        if ($delta -gt 1000) { $color = "Red" }
        elseif ($delta -gt 500) { $color = "Yellow" }
        elseif ($delta -gt 100) { $color = "Cyan" }

        Write-Host ("  {0,-30} {1,6}ms (Δ{2,6}ms)  {3}" -f $marker, $totalMs, $delta, $description) -ForegroundColor $color
        $previousMs = $totalMs
    }
}

Write-Host "`n" -ForegroundColor Cyan
Write-Host "Total Time: ${previousMs}ms" -ForegroundColor Green
Write-Host "`nColor Legend:" -ForegroundColor Gray
Write-Host "  Red    = >1000ms (1+ seconds)" -ForegroundColor Red
Write-Host "  Yellow = >500ms" -ForegroundColor Yellow
Write-Host "  Cyan   = >100ms" -ForegroundColor Cyan
Write-Host "  White  = <100ms" -ForegroundColor White
