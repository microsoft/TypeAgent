# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Directory)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-package-trust.ps1")
$certificate = $null
try {
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2(
        (Join-Path $Directory "windows-package-trust.cer"))
    Use-TypeAgentBuildTrust -Certificate $certificate -Action {
        & node (Join-Path $PSScriptRoot "verify-shell-artifacts.mjs") $Directory
        if ($LASTEXITCODE -ne 0) { throw "Shell publication verification failed." }
    }
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
} finally {
    if ($null -ne $certificate) { $certificate.Dispose() }
}
