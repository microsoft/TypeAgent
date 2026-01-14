#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

Write-Host "TypeAgent Agent Launcher - Uninstallation Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Remove the package
Write-Host "Removing TypeAgent Agent Launcher package..." -ForegroundColor Yellow
$package = Get-AppxPackage -Name "TypeAgent.WindowlessAgentLauncher" -ErrorAction SilentlyContinue
if ($package) {
    Remove-AppxPackage -Package $package.PackageFullName
    Write-Host "  Package removed successfully" -ForegroundColor Green
} else {
    Write-Host "  Package not found (may already be uninstalled)" -ForegroundColor Gray
}

# Ask about certificate removal
Write-Host ""
Write-Host "Do you want to remove the development certificate from Trusted Root? (y/N)" -ForegroundColor Yellow
$response = Read-Host
if ($response -eq 'y' -or $response -eq 'Y') {
    Write-Host "Removing development certificate..." -ForegroundColor Yellow
    $cert = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -like "*TypeAgent*" }
    if ($cert) {
        Remove-Item $cert.PSPath
        Write-Host "  Certificate removed successfully" -ForegroundColor Green
    } else {
        Write-Host "  Certificate not found" -ForegroundColor Gray
    }
} else {
    Write-Host "  Certificate not removed (keeping for future installations)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Uninstallation complete!" -ForegroundColor Green
