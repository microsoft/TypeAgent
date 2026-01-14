#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Paths
$pfxPath = Join-Path $scriptDir "TypeAgent_TemporaryKey.pfx"
$packageDir = Join-Path $scriptDir "bin\x64\Debug\net8.0-windows10.0.26100.0\AppPackages\WindowlessAgentLauncher_1.0.0.0_x64_Debug_Test"
$msixPath = Join-Path $packageDir "WindowlessAgentLauncher_1.0.0.0_x64_Debug.msix"

Write-Host "TypeAgent Agent Launcher - Installation Script" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if package exists
if (-not (Test-Path $msixPath)) {
    Write-Host "ERROR: Package not found at: $msixPath" -ForegroundColor Red
    Write-Host "Please build the project first with: dotnet build" -ForegroundColor Yellow
    exit 1
}

# Step 2: Install certificate to Trusted Root
Write-Host "Step 1: Installing development certificate..." -ForegroundColor Yellow
try {
    $password = ConvertTo-SecureString -String "test123" -Force -AsPlainText
    Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation "Cert:\LocalMachine\Root" -Password $password -ErrorAction SilentlyContinue | Out-Null
    Write-Host "  Certificate installed successfully" -ForegroundColor Green
} catch {
    Write-Host "  Certificate may already be installed (this is OK)" -ForegroundColor Gray
}

# Step 3: Remove old package if exists
Write-Host ""
Write-Host "Step 2: Removing existing package (if any)..." -ForegroundColor Yellow
$existingPackage = Get-AppxPackage -Name "TypeAgent.WindowlessAgentLauncher" -ErrorAction SilentlyContinue
if ($existingPackage) {
    Remove-AppxPackage -Package $existingPackage.PackageFullName
    Write-Host "  Removed existing package" -ForegroundColor Green
} else {
    Write-Host "  No existing package found" -ForegroundColor Gray
}

# Step 4: Install new package
Write-Host ""
Write-Host "Step 3: Installing TypeAgent Agent Launcher..." -ForegroundColor Yellow
Add-AppxPackage -Path $msixPath
Write-Host "  Package installed successfully" -ForegroundColor Green

# Verify installation
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Yellow
$installed = Get-AppxPackage -Name "TypeAgent.WindowlessAgentLauncher"
if ($installed) {
    Write-Host "  Installation verified!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Package Details:" -ForegroundColor Cyan
    Write-Host "  Name: $($installed.Name)"
    Write-Host "  Version: $($installed.Version)"
    Write-Host "  Install Location: $($installed.InstallLocation)"
} else {
    Write-Host "  ERROR: Package not found after installation" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Configure the script path: WindowlessAgentLauncher.exe --settings set scriptpath <path>" -ForegroundColor Gray
Write-Host "  2. Test the launcher: WindowlessAgentLauncher.exe --test 'Hello from TypeAgent'" -ForegroundColor Gray
Write-Host "  3. Check ODR registration: odr app-agents list" -ForegroundColor Gray
