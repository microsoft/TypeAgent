#
# TypeAgent Agent Launcher - Installation Script
# This script handles automatic elevation and installs the AgentLauncher MSIX package
#

param(
    [Parameter(DontShow)]
    [switch]$ElevatedInstance  # Internal parameter marking this as the elevated fork
)

$ErrorActionPreference = "Stop"

#region Utility Functions

function Test-IsAdministrator {
    <#
    .SYNOPSIS
    Checks if the current session has administrator privileges.
    #>
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-ScriptElevated {
    <#
    .SYNOPSIS
    Restarts the script with administrator privileges.
    .DESCRIPTION
    Copies the script to TEMP to handle path issues, then launches elevated instance.
    #>

    Write-Host "`nThis script requires administrator privileges to install the MSIX package." -ForegroundColor Yellow
    Write-Host "You will be prompted to elevate..." -ForegroundColor Yellow
    Write-Host ""

    # Create temp directory with timestamp to avoid conflicts
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $tempScriptDir = Join-Path $env:TEMP "AgentLauncher_Install_$timestamp"

    try {
        # Copy script to temp
        Write-Host "Preparing elevated script..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $tempScriptDir -Force | Out-Null
        Copy-Item "$PSScriptRoot\Install.ps1" -Destination $tempScriptDir -Force

        $tempScriptPath = Join-Path $tempScriptDir "Install.ps1"

        # Detect which PowerShell version is running
        $powershellExecutable = if ($PSVersionTable.PSEdition -eq 'Core') {
            "pwsh.exe"
        } else {
            "powershell.exe"
        }

        Write-Host "Launching elevated instance using $powershellExecutable..." -ForegroundColor Cyan
        Write-Host ""

        # Start elevated process and wait for completion
        $process = Start-Process $powershellExecutable -ArgumentList "-ExecutionPolicy", "Bypass", "-File", "`"$tempScriptPath`"", "-ElevatedInstance" -Verb RunAs -Wait -PassThru

        # Check if user cancelled the UAC prompt
        if ($null -eq $process) {
            Write-Host "Elevation cancelled by user." -ForegroundColor Yellow

            # Clean up temp folder
            if (Test-Path $tempScriptDir) {
                Remove-Item $tempScriptDir -Recurse -Force -ErrorAction SilentlyContinue
            }

            return 1
        }

        if ($process.ExitCode -ne 0) {
            Write-Host "Elevated installation FAILED with exit code: $($process.ExitCode)" -ForegroundColor Red

            # Clean up temp folder on failure
            if (Test-Path $tempScriptDir) {
                Remove-Item $tempScriptDir -Recurse -Force -ErrorAction SilentlyContinue
            }

            return $process.ExitCode
        }

        Write-Host "Elevated installation completed successfully." -ForegroundColor Green

        # Clean up temp folder on success
        if (Test-Path $tempScriptDir) {
            Remove-Item $tempScriptDir -Recurse -Force -ErrorAction SilentlyContinue
        }

        return 0
    }
    catch {
        Write-Host "Failed to restart with elevation. Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please run PowerShell as Administrator manually and try again." -ForegroundColor Yellow

        # Clean up temp folder on error
        if (Test-Path $tempScriptDir) {
            Remove-Item $tempScriptDir -Recurse -Force -ErrorAction SilentlyContinue
        }

        return 1
    }
}

#endregion

#region Main Installation Logic

function Install-AgentLauncher {
    <#
    .SYNOPSIS
    Performs the actual installation of the AgentLauncher package.
    .DESCRIPTION
    This function contains all the operations that require elevation:
    - Installing the development certificate
    - Removing old package
    - Installing new package
    #>

    # Use PSScriptRoot if available, otherwise try to find it
    $scriptDir = $PSScriptRoot
    if ([string]::IsNullOrEmpty($scriptDir)) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }

    # If we're running from TEMP (elevated instance), navigate back to the actual install location
    if ($scriptDir -like "*\Temp\*") {
        # Assume the actual location is the standard path
        $scriptDir = "D:\repos\TypeAgent\dotnet\agentLauncher\src"
        if (-not (Test-Path $scriptDir)) {
            Write-Host "ERROR: Could not determine installation directory" -ForegroundColor Red
            Write-Host "Please run this script from the agentLauncher\src directory" -ForegroundColor Yellow
            return 1
        }
    }

    # Paths
    $pfxPath = Join-Path $scriptDir "TypeAgent_TemporaryKey.pfx"
    $packageDir = Join-Path $scriptDir "bin\x64\Debug\net8.0-windows10.0.26100.0\AppPackages\AgentLauncher_1.0.0.0_x64_Debug_Test"
    $msixPath = Join-Path $packageDir "AgentLauncher_1.0.0.0_x64_Debug.msix"

    Write-Host "TypeAgent Agent Launcher - Installation Script" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Installation directory: $scriptDir" -ForegroundColor Gray
    Write-Host ""

    # Step 1: Check if package exists
    if (-not (Test-Path $msixPath)) {
        Write-Host "ERROR: Package not found at: $msixPath" -ForegroundColor Red
        Write-Host "Please build the project first with: .\Build.ps1" -ForegroundColor Yellow
        return 1
    }

    Write-Host "Package found:" -ForegroundColor Green
    Write-Host "  $msixPath" -ForegroundColor Gray
    Write-Host ""

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
    $existingPackage = Get-AppxPackage -Name "TypeAgent.AgentLauncher" -ErrorAction SilentlyContinue
    if ($existingPackage) {
        Remove-AppxPackage -Package $existingPackage.PackageFullName
        Write-Host "  Removed existing package: $($existingPackage.Version)" -ForegroundColor Green
    } else {
        Write-Host "  No existing package found" -ForegroundColor Gray
    }

    # Step 4: Install new package
    Write-Host ""
    Write-Host "Step 3: Installing TypeAgent Agent Launcher..." -ForegroundColor Yellow
    try {
        Add-AppxPackage -Path $msixPath
        Write-Host "  Package installed successfully" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: Failed to install package" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        return 1
    }

    # Step 5: Verify installation
    Write-Host ""
    Write-Host "Verifying installation..." -ForegroundColor Yellow
    $installed = Get-AppxPackage -Name "TypeAgent.AgentLauncher"
    if ($installed) {
        Write-Host "  Installation verified!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Package Details:" -ForegroundColor Cyan
        Write-Host "  Name: $($installed.Name)" -ForegroundColor Gray
        Write-Host "  Version: $($installed.Version)" -ForegroundColor Gray
        Write-Host "  Install Location: $($installed.InstallLocation)" -ForegroundColor Gray
        Write-Host "  Package Family Name: $($installed.PackageFamilyName)" -ForegroundColor Gray
    } else {
        Write-Host "  ERROR: Package not found after installation" -ForegroundColor Red
        return 1
    }

    Write-Host ""
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Check ODR registration: odr app-agents list" -ForegroundColor Gray
    Write-Host "  2. Ensure TypeAgent's agent service is running" -ForegroundColor Gray
    Write-Host "  3. Run actions using the universal composer" -ForegroundColor Gray
    Write-Host ""

    return 0
}

#endregion

#region Main Entry Point

function Main {
    <#
    .SYNOPSIS
    Main entry point for the installation script.
    .DESCRIPTION
    Handles elevation logic:
    - If already admin: Install directly
    - If not admin: Launch elevated instance and wait
    - If elevated instance: Install and exit
    #>

    $isAdmin = Test-IsAdministrator

    if ($isAdmin) {
        # Already running as admin - proceed with installation
        if ($ElevatedInstance) {
            Write-Host "Running as Administrator (elevated instance)..." -ForegroundColor Green
        } else {
            Write-Host "Running as Administrator..." -ForegroundColor Green
        }
        Write-Host ""

        $exitCode = Install-AgentLauncher

        if ($ElevatedInstance) {
            # Pause so user can see results before window closes
            Write-Host ""
            Write-Host "Press any key to continue..." -ForegroundColor Gray
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }

        exit $exitCode
    } else {
        # Not admin - need to elevate
        $exitCode = Restart-ScriptElevated
        exit $exitCode
    }
}

# Execute main function
Main

#endregion
