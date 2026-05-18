<#
.SYNOPSIS
    TypeAgent DevContainer Setup Script for Windows

.DESCRIPTION
    This script detects your environment, checks prerequisites, installs missing
    components, and guides you through setting up the DevContainer environment.

    The script handles automatic elevation when needed for certain operations
    (like checking Hyper-V status or installing WSL).

.PARAMETER InstallMissing
    Automatically install missing prerequisites (requires admin for some components)

.PARAMETER SkipDocker
    Skip Docker installation/check (useful if using remote Docker)

.PARAMETER Sandbox
    Also install Docker Sandbox (sbx) for MicroVM isolation

.EXAMPLE
    .\setup-devcontainer.ps1
    .\setup-devcontainer.ps1 -InstallMissing
    .\setup-devcontainer.ps1 -InstallMissing -Sandbox
#>

param(
    [switch]$InstallMissing,
    [switch]$SkipDocker,
    [switch]$Sandbox,
    [switch]$Help,
    [Parameter(DontShow)]
    [switch]$ElevatedInstance  # Internal parameter marking this as the elevated fork
)

$ErrorActionPreference = "Stop"

# ============================================================================
# Output Functions
# ============================================================================

function Write-Title($msg) { Write-Host "`n$msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-ScriptWarning($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }
function Write-ScriptError($msg) { Write-Host "  [X] $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor White }

# ============================================================================
# Elevation Functions (from agentLauncher pattern)
# ============================================================================

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
    Returns the exit code from the elevated process.
    #>
    param(
        [string]$Reason = "Some operations require administrator privileges."
    )

    Write-Host ""
    Write-Host $Reason -ForegroundColor Yellow
    Write-Host "You will be prompted to elevate..." -ForegroundColor Yellow
    Write-Host ""

    # Create temp directory with timestamp to avoid conflicts
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $tempScriptDir = Join-Path $env:TEMP "DevContainerSetup_$timestamp"

    try {
        # Copy script to temp
        Write-Host "Preparing elevated script..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $tempScriptDir -Force | Out-Null

        $scriptPath = $MyInvocation.PSCommandPath
        if ([string]::IsNullOrEmpty($scriptPath)) {
            $scriptPath = $PSCommandPath
        }
        Copy-Item $scriptPath -Destination $tempScriptDir -Force

        $tempScriptPath = Join-Path $tempScriptDir "setup-devcontainer.ps1"

        # Detect which PowerShell version is running
        $powershellExecutable = if ($PSVersionTable.PSEdition -eq 'Core') {
            "pwsh.exe"
        } else {
            "powershell.exe"
        }

        # Build argument list preserving original parameters
        $argList = @("-ExecutionPolicy", "Bypass", "-File", "`"$tempScriptPath`"", "-ElevatedInstance")
        if ($InstallMissing) { $argList += "-InstallMissing" }
        if ($SkipDocker) { $argList += "-SkipDocker" }
        if ($Sandbox) { $argList += "-Sandbox" }

        Write-Host "Launching elevated instance using $powershellExecutable..." -ForegroundColor Cyan
        Write-Host ""

        # Start elevated process and wait for completion
        $process = Start-Process $powershellExecutable -ArgumentList $argList -Verb RunAs -Wait -PassThru

        # Check if user cancelled the UAC prompt
        if ($null -eq $process) {
            Write-Host "Elevation cancelled by user." -ForegroundColor Yellow
            return 1
        }

        return $process.ExitCode
    }
    catch {
        Write-Host "Failed to restart with elevation. Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Please run PowerShell as Administrator manually and try again." -ForegroundColor Yellow
        return 1
    }
    finally {
        # Clean up temp folder
        if (Test-Path $tempScriptDir) {
            Remove-Item $tempScriptDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-ElevatedIfNeeded {
    <#
    .SYNOPSIS
    Checks if elevation is needed and prompts the user.
    Returns $true if script should continue, $false if it should exit.
    #>
    param(
        [string]$Reason,
        [switch]$Required
    )

    if (Test-IsAdministrator) {
        return $true
    }

    Write-Host ""
    Write-Host $Reason -ForegroundColor Yellow

    if ($Required) {
        Write-Host "This operation requires administrator privileges." -ForegroundColor Yellow
    } else {
        Write-Host "Some features work better with administrator privileges." -ForegroundColor Yellow
    }

    Write-Host ""
    $response = Read-Host "Would you like to restart with elevation? (Y/N)"

    if ($response.ToUpper() -eq "Y") {
        $exitCode = Restart-ScriptElevated -Reason $Reason
        exit $exitCode
    }

    return $false
}

# ============================================================================
# Environment Detection
# ============================================================================

function Get-HyperVStatusElevated {
    <#
    .SYNOPSIS
    Gets Hyper-V status by running an elevated command if needed.
    Returns $true if enabled, $false if disabled, $null if unable to determine.
    #>

    if (Test-IsAdministrator) {
        try {
            $hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -ErrorAction Stop
            return ($hyperv.State -eq "Enabled")
        } catch {
            return $null
        }
    }

    # Not admin - run elevated PowerShell to check
    Write-Host "  Checking Hyper-V status (requires elevation)..." -ForegroundColor Gray

    try {
        $powershellExecutable = if ($PSVersionTable.PSEdition -eq 'Core') { "pwsh.exe" } else { "powershell.exe" }

        # Run a quick elevated command to check Hyper-V
        $script = @'
try {
    $hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -ErrorAction Stop
    if ($hyperv.State -eq "Enabled") { exit 0 } else { exit 1 }
} catch { exit 2 }
'@
        $process = Start-Process $powershellExecutable -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $script -Verb RunAs -Wait -PassThru -WindowStyle Hidden

        if ($null -eq $process) {
            return $null  # User cancelled UAC
        }

        switch ($process.ExitCode) {
            0 { return $true }   # Enabled
            1 { return $false }  # Disabled
            default { return $null }  # Error
        }
    } catch {
        return $null
    }
}

function Get-Environment {
    $envInfo = @{
        Platform = "unknown"
        IsWSL = $false
        IsWSL2 = $false
        HasWSLg = $false
        IsAdmin = Test-IsAdministrator
        WindowsVersion = $null
        HasHyperV = $null  # null = unknown
    }

    # Check if running in WSL
    if ($env:WSL_DISTRO_NAME -or (Test-Path "/proc/version" -ErrorAction SilentlyContinue)) {
        $envInfo.IsWSL = $true
        $procVersion = Get-Content "/proc/version" -ErrorAction SilentlyContinue
        if ($procVersion -match "microsoft|WSL") {
            $envInfo.Platform = "wsl"
            # Check for WSL2
            if ($procVersion -match "WSL2|microsoft-standard") {
                $envInfo.IsWSL2 = $true
            }
            # Check for WSLg (Windows 11)
            if ($env:DISPLAY -or $env:WAYLAND_DISPLAY) {
                $envInfo.HasWSLg = $true
            }
        }
        return $envInfo
    }

    # Windows detection
    if ($env:OS -eq "Windows_NT") {
        $envInfo.Platform = "windows"

        # Get Windows version
        $os = Get-CimInstance Win32_OperatingSystem
        $envInfo.WindowsVersion = $os.Version
        $build = [int]($os.BuildNumber)

        # Windows 11 = build 22000+
        if ($build -ge 22000) {
            $envInfo.HasWSLg = $true  # WSLg available on Windows 11
        }

        # Check Hyper-V (auto-elevates if needed)
        $envInfo.HasHyperV = Get-HyperVStatusElevated

        # Check if WSL is available
        try {
            $wslStatus = wsl --status 2>&1
            if ($LASTEXITCODE -eq 0) {
                $envInfo.IsWSL2 = $true  # WSL2 is available
            }
        } catch {}
    }

    return $envInfo
}

# ============================================================================
# Prerequisite Checks
# ============================================================================

function Test-Prerequisites {
    param($Environment)

    $results = @{
        Docker = @{ Installed = $false; Running = $false; Version = $null }
        VSCode = @{ Installed = $false; Version = $null }
        DevContainersCLI = @{ Installed = $false; Version = $null }
        Git = @{ Installed = $false; Version = $null }
        Node = @{ Installed = $false; Version = $null }
        Pnpm = @{ Installed = $false; Version = $null }
        DockerSandbox = @{ Installed = $false; Version = $null }
        WSL = @{ Installed = $false; Version = $null }
    }

    # Docker
    if (-not $SkipDocker) {
        try {
            $dockerVersion = docker --version 2>&1
            if ($LASTEXITCODE -eq 0) {
                $results.Docker.Installed = $true
                $results.Docker.Version = $dockerVersion -replace "Docker version ", ""

                # Check if running
                $dockerInfo = docker info 2>&1
                $results.Docker.Running = ($LASTEXITCODE -eq 0)
            }
        } catch {}
    }

    # VS Code
    try {
        $codeVersion = code --version 2>&1 | Select-Object -First 1
        if ($LASTEXITCODE -eq 0) {
            $results.VSCode.Installed = $true
            $results.VSCode.Version = $codeVersion
        }
    } catch {}

    # Dev Containers CLI
    try {
        $devcontainerVersion = devcontainer --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $results.DevContainersCLI.Installed = $true
            $results.DevContainersCLI.Version = $devcontainerVersion
        }
    } catch {}

    # Git
    try {
        $gitVersion = git --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $results.Git.Installed = $true
            $results.Git.Version = $gitVersion -replace "git version ", ""
        }
    } catch {}

    # Node
    try {
        $nodeVersion = node --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $results.Node.Installed = $true
            $results.Node.Version = $nodeVersion
        }
    } catch {}

    # pnpm
    try {
        $pnpmVersion = pnpm --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $results.Pnpm.Installed = $true
            $results.Pnpm.Version = $pnpmVersion
        }
    } catch {}

    # Docker Sandbox (sbx)
    try {
        $sbxVersion = sbx --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $results.DockerSandbox.Installed = $true
            $results.DockerSandbox.Version = $sbxVersion
        }
    } catch {}

    # WSL (Windows only)
    if ($Environment.Platform -eq "windows") {
        try {
            $wslVersion = wsl --version 2>&1
            if ($LASTEXITCODE -eq 0) {
                $results.WSL.Installed = $true
                $results.WSL.Version = ($wslVersion | Select-Object -First 1) -replace "WSL version: ", ""
            }
        } catch {}
    }

    return $results
}

# ============================================================================
# Installation Functions
# ============================================================================

function Install-WithWinget {
    param($PackageId, $PackageName)

    Write-Info "Installing $PackageName via winget..."
    try {
        winget install --id $PackageId --accept-source-agreements --accept-package-agreements
        return $LASTEXITCODE -eq 0
    } catch {
        Write-ScriptError "Failed to install $PackageName"
        return $false
    }
}

function Install-DockerDesktop {
    Write-Info "Installing Docker Desktop..."
    return Install-WithWinget "Docker.DockerDesktop" "Docker Desktop"
}

function Install-VSCode {
    Write-Info "Installing VS Code..."
    return Install-WithWinget "Microsoft.VisualStudioCode" "VS Code"
}

function Install-Git {
    Write-Info "Installing Git..."
    return Install-WithWinget "Git.Git" "Git"
}

function Install-DevContainersCLI {
    Write-Info "Installing Dev Containers CLI..."
    try {
        npm install -g @devcontainers/cli
        return $LASTEXITCODE -eq 0
    } catch {
        Write-ScriptError "Failed to install Dev Containers CLI"
        return $false
    }
}

function Install-DockerSandbox {
    Write-Info "Installing Docker Sandbox (sbx)..."
    return Install-WithWinget "Docker.sbx" "Docker Sandbox"
}

function Install-WSL {
    Write-Info "Installing WSL..."

    # WSL installation requires elevation
    if (-not (Test-IsAdministrator)) {
        Write-ScriptWarning "WSL installation requires administrator privileges."
        $elevated = Invoke-ElevatedIfNeeded -Reason "WSL installation requires administrator privileges." -Required
        if (-not $elevated) {
            Write-ScriptWarning "Skipping WSL installation (requires elevation)"
            return $false
        }
    }

    try {
        wsl --install --no-distribution
        Write-ScriptWarning "WSL installed. Please restart your computer and run this script again."
        return $true
    } catch {
        Write-ScriptError "Failed to install WSL"
        return $false
    }
}

function Install-VSCodeExtension {
    param($ExtensionId, $ExtensionName)

    Write-Info "Installing VS Code extension: $ExtensionName..."
    try {
        code --install-extension $ExtensionId --force
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

# ============================================================================
# Main Setup Logic
# ============================================================================

function Show-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║          TypeAgent DevContainer Setup                        ║" -ForegroundColor Cyan
    Write-Host "║          AI Agent Sandboxing Environment                     ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Show-EnvironmentInfo {
    param($Environment)

    Write-Title "Environment Detection"

    switch ($Environment.Platform) {
        "windows" {
            Write-Success "Platform: Windows"
            Write-Info "  Windows Version: $($Environment.WindowsVersion)"
            if ($Environment.HasWSLg) {
                Write-Success "  WSLg Support: Available (Windows 11)"
            } else {
                Write-ScriptWarning "  WSLg Support: Not available (Windows 10)"
            }
            if ($Environment.IsWSL2) {
                Write-Success "  WSL2: Available"
            } else {
                Write-ScriptWarning "  WSL2: Not installed"
            }
            # Hyper-V status
            if ($null -eq $Environment.HasHyperV) {
                Write-ScriptWarning "  Hyper-V: Unable to determine (elevation may have been cancelled)"
            } elseif ($Environment.HasHyperV) {
                Write-Success "  Hyper-V: Enabled"
            } else {
                Write-ScriptWarning "  Hyper-V: Not enabled"
            }
            if ($Environment.IsAdmin) {
                Write-Info "  Running as: Administrator"
            } else {
                Write-Info "  Running as: Standard user"
            }
        }
        "wsl" {
            Write-Success "Platform: WSL"
            Write-Info "  Distribution: $env:WSL_DISTRO_NAME"
            if ($Environment.IsWSL2) {
                Write-Success "  WSL Version: WSL2"
            } else {
                Write-ScriptWarning "  WSL Version: WSL1 (WSL2 recommended)"
            }
            if ($Environment.HasWSLg) {
                Write-Success "  WSLg (GUI): Available"
            } else {
                Write-ScriptWarning "  WSLg (GUI): Not detected"
            }
        }
        default {
            Write-ScriptWarning "Platform: Unknown"
        }
    }
}

function Show-PrerequisiteStatus {
    param($Prerequisites)

    Write-Title "Prerequisite Check"

    # Docker
    if ($Prerequisites.Docker.Installed) {
        if ($Prerequisites.Docker.Running) {
            Write-Success "Docker: $($Prerequisites.Docker.Version) (running)"
        } else {
            Write-ScriptWarning "Docker: $($Prerequisites.Docker.Version) (not running)"
        }
    } else {
        Write-ScriptError "Docker: Not installed"
    }

    # VS Code
    if ($Prerequisites.VSCode.Installed) {
        Write-Success "VS Code: $($Prerequisites.VSCode.Version)"
    } else {
        Write-ScriptError "VS Code: Not installed"
    }

    # Dev Containers CLI
    if ($Prerequisites.DevContainersCLI.Installed) {
        Write-Success "Dev Containers CLI: $($Prerequisites.DevContainersCLI.Version)"
    } else {
        Write-ScriptWarning "Dev Containers CLI: Not installed (optional)"
    }

    # Git
    if ($Prerequisites.Git.Installed) {
        Write-Success "Git: $($Prerequisites.Git.Version)"
    } else {
        Write-ScriptError "Git: Not installed"
    }

    # Node
    if ($Prerequisites.Node.Installed) {
        Write-Success "Node.js: $($Prerequisites.Node.Version)"
    } else {
        Write-ScriptWarning "Node.js: Not installed (needed for host development)"
    }

    # pnpm
    if ($Prerequisites.Pnpm.Installed) {
        Write-Success "pnpm: $($Prerequisites.Pnpm.Version)"
    } else {
        Write-ScriptWarning "pnpm: Not installed (needed for host development)"
    }

    # Docker Sandbox
    if ($Prerequisites.DockerSandbox.Installed) {
        Write-Success "Docker Sandbox (sbx): $($Prerequisites.DockerSandbox.Version)"
    } else {
        Write-Info "Docker Sandbox (sbx): Not installed (optional, for MicroVM isolation)"
    }

    # WSL
    if ($Prerequisites.WSL.Installed) {
        Write-Success "WSL: $($Prerequisites.WSL.Version)"
    } elseif ($env:OS -eq "Windows_NT") {
        Write-ScriptWarning "WSL: Not installed (recommended for best performance)"
    }
}

function Install-MissingPrerequisites {
    param($Prerequisites, $Environment)

    Write-Title "Installing Missing Components"

    $needsRestart = $false

    # WSL (Windows only, install first - requires elevation)
    if ($Environment.Platform -eq "windows" -and -not $Prerequisites.WSL.Installed) {
        if (Install-WSL) {
            $needsRestart = $true
        }
    }

    # Git (winget doesn't require elevation)
    if (-not $Prerequisites.Git.Installed) {
        Install-Git | Out-Null
    }

    # Docker (winget doesn't require elevation, but Docker Desktop setup might)
    if (-not $SkipDocker -and -not $Prerequisites.Docker.Installed) {
        if (Install-DockerDesktop) {
            Write-ScriptWarning "Docker Desktop installed. Please start it and enable WSL2 backend."
            $needsRestart = $true
        }
    }

    # VS Code (winget doesn't require elevation)
    if (-not $Prerequisites.VSCode.Installed) {
        Install-VSCode | Out-Null
    }

    # VS Code Extensions
    if ($Prerequisites.VSCode.Installed -or (Get-Command code -ErrorAction SilentlyContinue)) {
        Install-VSCodeExtension "ms-vscode-remote.remote-containers" "Dev Containers" | Out-Null
        Install-VSCodeExtension "ms-vscode-remote.remote-wsl" "WSL" | Out-Null
    }

    # Docker Sandbox (if requested)
    if ($Sandbox -and -not $Prerequisites.DockerSandbox.Installed) {
        Install-DockerSandbox | Out-Null
    }

    if ($needsRestart) {
        Write-Host ""
        Write-ScriptWarning "Some components require a restart. Please restart and run this script again."
    }
}

function Show-NextSteps {
    param($Environment, $Prerequisites)

    Write-Title "Next Steps"

    $allGood = $Prerequisites.Docker.Running -and $Prerequisites.VSCode.Installed -and $Prerequisites.Git.Installed

    if ($allGood) {
        Write-Success "All prerequisites are ready!"
        Write-Host ""
        Write-Info "To start using DevContainers:"
        Write-Host ""
        Write-Host "  1. Open the TypeAgent repository in VS Code:" -ForegroundColor White
        Write-Host "     cd D:\repos\TypeAgent" -ForegroundColor Yellow
        Write-Host "     code ." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  2. When prompted, click 'Reopen in Container'" -ForegroundColor White
        Write-Host "     Or press F1 and select 'Dev Containers: Reopen in Container'" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  3. Wait for the container to build (~5 minutes first time)" -ForegroundColor White
        Write-Host ""
        Write-Host "  4. Start developing:" -ForegroundColor White
        Write-Host "     cd ts && pnpm install && pnpm run build" -ForegroundColor Yellow
        Write-Host ""

        if ($Environment.Platform -eq "windows" -and -not $Environment.HasWSLg) {
            Write-ScriptWarning "For Electron Shell development, use the hybrid approach:"
            Write-Host "  - Run agent server in container: pnpm run server" -ForegroundColor Gray
            Write-Host "  - Run shell on host: pnpm run shell" -ForegroundColor Gray
        }

        if ($Prerequisites.DockerSandbox.Installed) {
            Write-Host ""
            Write-Info "Docker Sandbox (sbx) is available for MicroVM isolation:"
            Write-Host "  sbx run --mount ./ts:/workspace claude" -ForegroundColor Yellow
        }
    } else {
        Write-ScriptWarning "Some prerequisites are missing or not running."
        Write-Host ""

        $missingItems = @()
        if (-not $Prerequisites.Docker.Installed) {
            $missingItems += "Docker Desktop"
            Write-Host "  - Docker Desktop: Not installed" -ForegroundColor Yellow
        } elseif (-not $Prerequisites.Docker.Running) {
            Write-Host "  - Docker Desktop: Installed but not running" -ForegroundColor Yellow
            Write-Host "    Start Docker Desktop from the Start menu" -ForegroundColor Gray
        }

        if (-not $Prerequisites.VSCode.Installed) {
            $missingItems += "VS Code"
            Write-Host "  - VS Code: Not installed" -ForegroundColor Yellow
        }

        if (-not $Prerequisites.Git.Installed) {
            $missingItems += "Git"
            Write-Host "  - Git: Not installed" -ForegroundColor Yellow
        }

        # Prompt to install if there are missing items
        if ($missingItems.Count -gt 0) {
            Write-Host ""
            $itemList = $missingItems -join ", "
            Write-Host "Would you like to install the missing components ($itemList)?" -ForegroundColor Cyan
            $response = Read-Host "Enter [Y]es to install, [N]o to skip, or [Q]uit (Y/N/Q)"

            switch ($response.ToUpper()) {
                "Y" {
                    Write-Host ""
                    Install-MissingPrerequisites -Prerequisites $Prerequisites -Environment $Environment
                    # Re-check and show updated status
                    $Prerequisites = Test-Prerequisites -Environment $Environment
                    Show-PrerequisiteStatus -Prerequisites $Prerequisites
                }
                "Q" {
                    Write-Host "Exiting..." -ForegroundColor Gray
                    exit 0
                }
                default {
                    Write-Host ""
                    Write-Info "You can install later with:"
                    Write-Host "  .\setup-devcontainer.ps1 -InstallMissing" -ForegroundColor Yellow
                }
            }
        }
    }
}

function Show-PlatformRecommendations {
    param($Environment)

    Write-Title "Platform-Specific Recommendations"

    switch ($Environment.Platform) {
        "windows" {
            if ($Environment.HasWSLg) {
                Write-Success "Windows 11 detected - Full GUI support available!"
                Write-Info "  - Electron shell can run inside container via WSLg"
                Write-Info "  - Best performance: Clone repo inside WSL2 filesystem"
                Write-Host ""
                Write-Host "  To clone in WSL2:" -ForegroundColor White
                Write-Host "    wsl" -ForegroundColor Yellow
                Write-Host "    cd ~" -ForegroundColor Yellow
                Write-Host "    git clone <repo-url> TypeAgent" -ForegroundColor Yellow
                Write-Host "    cd TypeAgent && code ." -ForegroundColor Yellow
            } else {
                Write-ScriptWarning "Windows 10 detected - Use hybrid approach for GUI"
                Write-Info "  - Build/test in container"
                Write-Info "  - Run Electron shell on Windows host"
                Write-Info "  - Consider upgrading to Windows 11 for WSLg support"
            }

            if (-not $Environment.IsWSL2) {
                Write-Host ""
                Write-ScriptWarning "WSL2 not detected - Strongly recommended for container performance"
                Write-Host "  Install with: wsl --install" -ForegroundColor Yellow
            }
        }
        "wsl" {
            Write-Success "Running in WSL - Optimal for container development!"

            # Check if repo is on Windows filesystem
            $currentPath = (Get-Location).Path
            if ($currentPath -match "^/mnt/[a-z]/") {
                Write-ScriptWarning "Repository is on Windows filesystem (/mnt/...)"
                Write-Info "  For best performance, move to WSL filesystem:"
                Write-Host "    cp -r . ~/TypeAgent" -ForegroundColor Yellow
                Write-Host "    cd ~/TypeAgent" -ForegroundColor Yellow
            } else {
                Write-Success "Repository is on WSL filesystem - Good!"
            }

            if ($Environment.HasWSLg) {
                Write-Success "WSLg detected - Electron shell will work in container"
            } else {
                Write-ScriptWarning "WSLg not detected - Use hybrid approach for Electron shell"
            }
        }
    }
}

# ============================================================================
# Main Entry Point
# ============================================================================

function Main {
    if ($Help) {
        Get-Help $MyInvocation.PSCommandPath -Detailed
        exit 0
    }

    # If this is an elevated instance, show a message
    if ($ElevatedInstance) {
        Write-Host "Running as Administrator (elevated instance)..." -ForegroundColor Green
        Write-Host ""
    }

    Show-Banner

    $environment = Get-Environment
    Show-EnvironmentInfo -Environment $environment

    $prerequisites = Test-Prerequisites -Environment $environment
    Show-PrerequisiteStatus -Prerequisites $prerequisites

    if ($InstallMissing) {
        Install-MissingPrerequisites -Prerequisites $prerequisites -Environment $environment
        # Re-check after installation
        $prerequisites = Test-Prerequisites -Environment $environment
    }

    Show-PlatformRecommendations -Environment $environment
    Show-NextSteps -Environment $environment -Prerequisites $prerequisites

    Write-Host ""
    Write-Host "For more information, see the DevContainer documentation:" -ForegroundColor Gray
    Write-Host "  D:\repos\codeDocs\TypeAgent\forUser\2026-05-12_devcontainer-agent-sandboxing-proposal.md" -ForegroundColor Gray
    Write-Host ""

    # If elevated instance, pause so user can see results
    if ($ElevatedInstance) {
        Write-Host "Press any key to continue..." -ForegroundColor Gray
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
}

# Execute main function
Main
