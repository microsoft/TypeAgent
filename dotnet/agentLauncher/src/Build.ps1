$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "TypeAgent Agent Launcher - Build Script" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$projectFile = Join-Path $scriptDir "WindowlessAgentLauncher.csproj"
$configuration = "Debug"
$platform = "x64"

# Find MSBuild
$msbuildPath = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe"
if (-not (Test-Path $msbuildPath)) {
    Write-Host "ERROR: MSBuild not found at: $msbuildPath" -ForegroundColor Red
    Write-Host "Please update the path in this script or ensure Visual Studio 2022 is installed." -ForegroundColor Yellow
    exit 1
}

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Project: $projectFile"
Write-Host "  Configuration: $configuration"
Write-Host "  Platform: $platform"
Write-Host ""

# Clean previous build
Write-Host "Step 1: Cleaning previous build..." -ForegroundColor Yellow
Remove-Item -Recurse -Force obj,bin -ErrorAction SilentlyContinue
Write-Host "  Clean complete" -ForegroundColor Green
Write-Host ""

# Build
Write-Host "Step 2: Building project..." -ForegroundColor Yellow
$buildArgs = @(
    $projectFile,
    "-t:Restore,Build",
    "-p:Configuration=$configuration",
    "-p:Platform=$platform",
    "-verbosity:minimal"
)

& $msbuildPath $buildArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "  Build complete" -ForegroundColor Green
Write-Host ""

# Package
Write-Host "Step 3: Creating MSIX package..." -ForegroundColor Yellow
$packageArgs = @(
    $projectFile,
    "-t:_GenerateAppxPackage",
    "-p:Configuration=$configuration",
    "-p:Platform=$platform",
    "-p:AppxPackageSigningEnabled=false",
    "-verbosity:minimal"
)

& $msbuildPath $packageArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Packaging failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "  Build complete" -ForegroundColor Green
Write-Host ""

# Verify package was created
$packagePath = "bin\$platform\$configuration\net8.0-windows10.0.26100.0\AppPackages\WindowlessAgentLauncher_1.0.0.0_x64_Debug_Test\WindowlessAgentLauncher_1.0.0.0_x64_Debug.msix"
if (Test-Path $packagePath) {
    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Package location:" -ForegroundColor Cyan
    Write-Host "  $packagePath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Sign the package: .\Sign-Package.ps1" -ForegroundColor Gray
    Write-Host "  2. Install: .\Install.ps1 (requires Administrator)" -ForegroundColor Gray
} else {
    Write-Host "WARNING: Build succeeded but package not found at expected location:" -ForegroundColor Yellow
    Write-Host "  $packagePath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Searching for MSIX packages..." -ForegroundColor Yellow
    $msixFiles = Get-ChildItem -Path "bin" -Recurse -Filter "*.msix" -ErrorAction SilentlyContinue
    if ($msixFiles) {
        Write-Host "Found MSIX package(s):" -ForegroundColor Green
        foreach ($file in $msixFiles) {
            Write-Host "  $($file.FullName)" -ForegroundColor Gray
        }
    } else {
        Write-Host "No MSIX packages found." -ForegroundColor Red
        exit 1
    }
}
