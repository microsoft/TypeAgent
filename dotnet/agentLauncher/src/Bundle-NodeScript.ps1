$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "TypeAgent Node.js Bundler" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Calculate relative paths from script location
$uriHandlerPath = Join-Path $scriptDir "..\..\..\ts\packages\uriHandler" | Resolve-Path
$bundleOutput = Join-Path $uriHandlerPath "bundle\agent-uri-handler.bundle.js"
$targetDir = Join-Path $scriptDir "Scripts"
$targetPath = Join-Path $targetDir "agent-uri-handler.bundle.js"

Write-Host "Paths:" -ForegroundColor Yellow
Write-Host "  URI Handler: $uriHandlerPath"
Write-Host "  Bundle Output: $bundleOutput"
Write-Host "  Target: $targetPath"
Write-Host ""

# Step 1: Build TypeScript
Write-Host "Step 1: Building TypeScript..." -ForegroundColor Yellow
Push-Location $uriHandlerPath
try {
    & pnpm run build:bundle
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE"
    }
    Write-Host "  Build complete" -ForegroundColor Green
} finally {
    Pop-Location
}
Write-Host ""

# Step 2: Verify bundle was created
Write-Host "Step 2: Verifying bundle..." -ForegroundColor Yellow
if (-not (Test-Path $bundleOutput)) {
    Write-Host "  ERROR: Bundle not found at: $bundleOutput" -ForegroundColor Red
    exit 1
}

$bundleSize = (Get-Item $bundleOutput).Length
$bundleSizeKB = [Math]::Round($bundleSize / 1KB, 2)
Write-Host "  Bundle found: $bundleSizeKB KB" -ForegroundColor Green
Write-Host ""

# Step 3: Copy bundle to AgentLauncher Scripts folder
Write-Host "Step 3: Copying bundle to AgentLauncher..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item $bundleOutput $targetPath -Force
Write-Host "  Bundle copied to: $targetPath" -ForegroundColor Green
Write-Host ""

# Step 4: Verify copy
if (Test-Path $targetPath) {
    $targetSize = (Get-Item $targetPath).Length
    if ($targetSize -eq $bundleSize) {
        Write-Host "Bundle integration complete!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "  1. Build the MSIX package: .\Build.ps1" -ForegroundColor Gray
        Write-Host "  2. Sign and install: .\Sign-Package.ps1 && .\Install.ps1" -ForegroundColor Gray
    } else {
        Write-Host "  WARNING: File sizes don't match" -ForegroundColor Yellow
        Write-Host "    Source: $bundleSize bytes" -ForegroundColor Gray
        Write-Host "    Target: $targetSize bytes" -ForegroundColor Gray
    }
} else {
    Write-Host "  ERROR: Failed to copy bundle" -ForegroundColor Red
    exit 1
}
