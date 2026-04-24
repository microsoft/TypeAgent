# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# scriptHost.ps1 — Sandboxed PowerShell execution host for PowerShell agent
# Creates a runspace with cmdlet whitelisting, module loading, and timeout enforcement.
# Security: Path restrictions, network controls, cmdlet whitelisting.
# Language: FullLanguage mode (allows [PSCustomObject], [math]::Round, etc.)

param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptBody,

    [Parameter(Mandatory=$true)]
    [string]$ParametersJson,

    [Parameter(Mandatory=$true)]
    [string]$AllowedCmdletsJson,

    [string]$AllowedPathsJson = '[]',

    [string]$AllowedModulesJson = '[]',

    [string]$NetworkAccess = "false",

    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

try {
    $allowedCmdlets = $AllowedCmdletsJson | ConvertFrom-Json
    $params = $ParametersJson | ConvertFrom-Json
    # Parse allowed paths - must handle array properly to avoid PowerShell array unwrapping issues
    $parsedPaths = $AllowedPathsJson | ConvertFrom-Json
    if ($parsedPaths -is [array]) {
        $AllowedPaths = $parsedPaths
    } else {
        $AllowedPaths = @($parsedPaths)
    }
    $parsedModules = $AllowedModulesJson | ConvertFrom-Json
    if ($parsedModules -is [array]) {
        $AllowedModules = $parsedModules
    } else {
        $AllowedModules = @($parsedModules)
    }

    # Expand environment variable references in allowed paths
    # (e.g. "$env:USERPROFILE" → "C:\Users\name")
    # Done outside constrained runspace where method invocation is allowed.
    $expandedAllowedPaths = @()
    foreach ($ap in $AllowedPaths) {
        try {
            $expandedAllowedPaths += $ExecutionContext.InvokeCommand.ExpandString($ap)
        } catch {
            $expandedAllowedPaths += $ap
        }
    }

    # Validate path parameters against allowed paths
    # NOTE: Only validate paths that look like absolute or relative file paths.
    # Skip short single-word strings (like "videos", "downloads") that might be
    # library names - let the script handle those with its own resolution logic.
    if ($expandedAllowedPaths.Count -gt 0) {
        foreach ($prop in $params.PSObject.Properties) {
            $val = $prop.Value
            if ($val -is [string]) {
                # Skip empty values
                if (-not $val -or $val -match '^\s*$') { continue }

                # Skip short single-word values that look like library names
                # (no slashes, no drive letter, not starting with dot)
                if ($val -notmatch '[/\\]' -and $val -notmatch '^[a-zA-Z]:' -and $val -notmatch '^\.' -and $val.Length -lt 50) {
                    continue
                }

                $isValidPath = $false
                try { $isValidPath = Test-Path $val -IsValid } catch { }
                if ($isValidPath) {
                    $resolvedPath = $null
                    try { $resolvedPath = (Resolve-Path $val -ErrorAction SilentlyContinue).Path } catch {}
                    if ($resolvedPath) {
                        $pathAllowed = $false
                        foreach ($ap in $expandedAllowedPaths) {
                            if ($resolvedPath -like "$ap*") {
                                $pathAllowed = $true
                                break
                            }
                        }
                        # ENFORCEMENT: Block execution if path not allowed
                        if (-not $pathAllowed) {
                            Write-Error "Path access denied: '$resolvedPath' is not in allowedPaths. Allowed paths: $($expandedAllowedPaths -join ', ')"
                            exit 1
                        }
                    }
                }
            }
        }
    }

    # Convert NetworkAccess string to boolean (handles "true"/"false"/"1"/"0"/"$true"/"$false")
    $networkAccessBool = $NetworkAccess -match '^(true|1|\$true)$'

    # Network access enforcement
    if (-not $networkAccessBool) {
        # Define network-capable cmdlets that require networkAccess=true
        $NetworkCmdlets = @(
            'Invoke-WebRequest',
            'Invoke-RestMethod',
            'Test-NetConnection',
            'Test-Connection',
            'Resolve-DnsName',
            'Send-MailMessage',
            'Start-BitsTransfer',
            'Get-NetAdapter',
            'Get-NetIPAddress',
            'Get-NetRoute',
            'New-NetFirewallRule',
            'Set-NetFirewallRule'
        )

        foreach ($networkCmdlet in $NetworkCmdlets) {
            if ($allowedCmdlets -contains $networkCmdlet) {
                Write-Error "Network cmdlet '$networkCmdlet' requires networkAccess=true in sandbox policy"
                exit 1
            }
        }
    }

    # Module enforcement - check for unauthorized Import-Module in script body
    if ($ScriptBody -match 'Import-Module\s+([^\s;]+)') {
        $requestedModule = $Matches[1] -replace '"','' -replace "'",''
        if ($AllowedModules.Count -gt 0 -and $requestedModule -notin $AllowedModules) {
            Write-Error "Module import denied: '$requestedModule' is not in allowedModules. Allowed modules: $($AllowedModules -join ', ')"
            exit 1
        }
    }

    # Create session state with default cmdlets
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()

    # Import allowed modules into the session state
    # This makes module cmdlets (like Get-NetTCPConnection from NetTCPIP) available
    if ($AllowedModules.Count -gt 0) {
        foreach ($moduleName in $AllowedModules) {
            try {
                $iss.ImportPSModule($moduleName)
            } catch {
                Write-Warning "Could not import module '$moduleName': $_"
            }
        }
    }

    # Remove cmdlets not in the allowed list (after module import so we can whitelist module cmdlets)
    $commandsToRemove = @()
    foreach ($cmd in $iss.Commands) {
        if ($cmd.CommandType -eq 'Cmdlet' -and $cmd.Name -notin $allowedCmdlets) {
            $commandsToRemove += $cmd
        }
    }
    foreach ($cmd in $commandsToRemove) {
        $iss.Commands.Remove($cmd.Name, $cmd)
    }

    # FullLanguage mode (default) - allows [PSCustomObject], [math]::Round(), etc.
    # Security is provided by: cmdlet whitelisting, path restrictions, network controls
    # Note: If stricter lockdown is needed, uncomment the line below:
    # $iss.LanguageMode = [System.Management.Automation.PSLanguageMode]::ConstrainedLanguage

    # Create runspace
    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
    $runspace.Open()

    # Build the script with injected parameters
    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    [void]$ps.AddScript($ScriptBody)

    # Pass parameters to the script's param() block
    foreach ($prop in $params.PSObject.Properties) {
        [void]$ps.AddParameter($prop.Name, $prop.Value)
    }

    # Execute with timeout
    $asyncResult = $ps.BeginInvoke()
    $completed = $asyncResult.AsyncWaitHandle.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))

    if (-not $completed) {
        $ps.Stop()
        Write-Error "Script execution timed out after $TimeoutSeconds seconds"
        exit 1
    }

    $output = $ps.EndInvoke($asyncResult)

    # Render output — Out-String handles both plain objects and Format-* objects
    if ($output.Count -gt 0) {
        $output | Out-String -Width 200 | Write-Output
    }

    # Report errors
    if ($ps.HadErrors) {
        foreach ($err in $ps.Streams.Error) {
            Write-Error $err
        }
        exit 1
    }

    $runspace.Close()
    $runspace.Dispose()
    $ps.Dispose()

} catch {
    Write-Error "ScriptHost error: $_"
    exit 1
}
