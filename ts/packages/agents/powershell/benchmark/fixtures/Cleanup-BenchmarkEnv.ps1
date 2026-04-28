param(
    [string]$TestRoot = "$env:TEMP\powershell-benchmark"
)

if (-not (Test-Path $TestRoot)) {
    Write-Output "No benchmark environment found at $TestRoot"
    return
}

Remove-Item -Path $TestRoot -Recurse -Force
Write-Output "Cleaned up benchmark environment at $TestRoot"
