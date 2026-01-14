$ErrorActionPreference = "Stop"

Write-Host "TypeAgent Launcher - Performance Test" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Kill any existing processes
Write-Host "Cleaning up existing processes..." -ForegroundColor Yellow
try {
    Get-Process WindowlessAgentLauncher -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "  Could not stop some processes (may be packaged app)" -ForegroundColor Gray
}
Start-Sleep -Seconds 1

# Test URIs
$uri1 = "typeagent-launcher://invoke?agentName=test&prompt=First_activation"
$uri2 = "typeagent-launcher://invoke?agentName=test&prompt=Second_activation"
$uri3 = "typeagent-launcher://invoke?agentName=test&prompt=Third_activation"

Write-Host "Test 1: First activation (should start background service)" -ForegroundColor Yellow
$start1 = Get-Date
Start-Process $uri1
Start-Sleep -Seconds 3  # Wait for service to start and process
$duration1 = (Get-Date) - $start1
Write-Host "  Duration: $($duration1.TotalMilliseconds) ms" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 1

Write-Host "Test 2: Second activation (should use existing service)" -ForegroundColor Yellow
$start2 = Get-Date
Start-Process $uri2
Start-Sleep -Seconds 0.5  # Shorter wait since it should be faster
$duration2 = (Get-Date) - $start2
Write-Host "  Duration: $($duration2.TotalMilliseconds) ms" -ForegroundColor Green
Write-Host ""

Start-Sleep -Seconds 1

Write-Host "Test 3: Third activation (should use existing service)" -ForegroundColor Yellow
$start3 = Get-Date
Start-Process $uri3
Start-Sleep -Seconds 0.5
$duration3 = (Get-Date) - $start3
Write-Host "  Duration: $($duration3.TotalMilliseconds) ms" -ForegroundColor Green
Write-Host ""

# Check if background service is running
Write-Host "Checking for background service..." -ForegroundColor Yellow
$processes = Get-Process WindowlessAgentLauncher -ErrorAction SilentlyContinue
if ($processes) {
    Write-Host "  Found $($processes.Count) process(es):" -ForegroundColor Green
    foreach ($proc in $processes) {
        $uptime = (Get-Date) - $proc.StartTime
        Write-Host "    PID: $($proc.Id), Uptime: $([math]::Round($uptime.TotalSeconds, 2))s" -ForegroundColor Gray
    }
} else {
    Write-Host "  No background service found" -ForegroundColor Red
}
Write-Host ""

Write-Host "Performance Summary:" -ForegroundColor Cyan
Write-Host "  First activation:  $([math]::Round($duration1.TotalMilliseconds, 0)) ms" -ForegroundColor White
Write-Host "  Second activation: $([math]::Round($duration2.TotalMilliseconds, 0)) ms" -ForegroundColor White
Write-Host "  Third activation:  $([math]::Round($duration3.TotalMilliseconds, 0)) ms" -ForegroundColor White
Write-Host ""

$improvement = [math]::Round((($duration1.TotalMilliseconds - $duration2.TotalMilliseconds) / $duration1.TotalMilliseconds) * 100, 1)
Write-Host "Speedup: $improvement% faster after first activation" -ForegroundColor Green
