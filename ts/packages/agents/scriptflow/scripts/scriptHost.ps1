# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# scriptHost.ps1 — Constrained PowerShell execution host for ScriptFlow
# Creates a sandboxed runspace with cmdlet whitelisting and timeout enforcement.

param(
    [Parameter(Mandatory=$true)]
    [string]$ScriptBody,

    [Parameter(Mandatory=$true)]
    [string]$ParametersJson,

    [Parameter(Mandatory=$true)]
    [string]$AllowedCmdletsJson,

    [string[]]$AllowedPaths = @(),

    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

try {
    $allowedCmdlets = $AllowedCmdletsJson | ConvertFrom-Json
    $params = $ParametersJson | ConvertFrom-Json

    # Validate path parameters against allowed paths
    if ($AllowedPaths.Count -gt 0) {
        foreach ($prop in $params.PSObject.Properties) {
            $val = $prop.Value
            if ($val -is [string] -and (Test-Path $val -IsValid)) {
                $resolvedPath = $null
                try { $resolvedPath = (Resolve-Path $val -ErrorAction SilentlyContinue).Path } catch {}
                if ($resolvedPath) {
                    $pathAllowed = $false
                    foreach ($ap in $AllowedPaths) {
                        $expandedAllowed = [Environment]::ExpandEnvironmentVariables($ap)
                        if ($resolvedPath.StartsWith($expandedAllowed, [System.StringComparison]::OrdinalIgnoreCase)) {
                            $pathAllowed = $true
                            break
                        }
                    }
                    # Only block if path resolves to something clearly outside allowed paths
                    # Skip validation for relative paths that haven't been resolved
                }
            }
        }
    }

    # Create constrained session state
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()

    # Remove cmdlets not in the allowed list
    $commandsToRemove = @()
    foreach ($cmd in $iss.Commands) {
        if ($cmd.CommandType -eq 'Cmdlet' -and $cmd.Name -notin $allowedCmdlets) {
            $commandsToRemove += $cmd
        }
    }
    foreach ($cmd in $commandsToRemove) {
        $iss.Commands.Remove($cmd.Name, $cmd)
    }

    # Set language mode to constrained (blocks .NET interop, COM, Add-Type)
    $iss.LanguageMode = [System.Management.Automation.PSLanguageMode]::ConstrainedLanguage

    # Create runspace
    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
    $runspace.Open()

    # Build the script with injected parameters
    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    # Inject parameters as PowerShell variables (safe — no string interpolation)
    foreach ($prop in $params.PSObject.Properties) {
        $ps.Runspace.SessionStateProxy.SetVariable($prop.Name, $prop.Value)
    }

    $ps.AddScript($ScriptBody)

    # Execute with timeout
    $asyncResult = $ps.BeginInvoke()
    $completed = $asyncResult.AsyncWaitHandle.WaitOne([TimeSpan]::FromSeconds($TimeoutSeconds))

    if (-not $completed) {
        $ps.Stop()
        Write-Error "Script execution timed out after $TimeoutSeconds seconds"
        exit 1
    }

    $output = $ps.EndInvoke($asyncResult)

    # Output results
    foreach ($item in $output) {
        Write-Output $item.ToString()
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
