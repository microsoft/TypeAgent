# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-package-trust.ps1")
try {
    $stream = Open-TypeAgentPackage -Path $Path
    $stream.Dispose()
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
