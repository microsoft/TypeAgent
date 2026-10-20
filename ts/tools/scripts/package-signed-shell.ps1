# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-package-trust.ps1")
$policy = Get-Content -LiteralPath (Join-Path $PSScriptRoot "windows-package-trust.json") -Raw | ConvertFrom-Json
$oldLink = $env:CSC_LINK
$oldPassword = $env:CSC_KEY_PASSWORD
$certificate = $null
try {
    if ($env:TYPEAGENT_SHELL_VALIDATION_ONLY -eq "1") {
        throw "Release signing must not use unsigned validation-only packaging."
    }
    & node (Join-Path $PSScriptRoot "getCert.mjs") pull
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve the development signing certificate." }
    $passwordOutput = & node (Join-Path $PSScriptRoot "getCert.mjs") get-password
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve the signing certificate password." }
    $passwordFile = @($passwordOutput | Where-Object { $_ -match '^[A-Za-z]:\\.+\.txt$' }) | Select-Object -Last 1
    if (-not $passwordFile) { throw "getCert did not return a password file." }
    try {
        $env:CSC_KEY_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
    } finally {
        Remove-Item -LiteralPath $passwordFile -Force
    }
    $env:CSC_LINK = Join-Path $HOME ".typeagent\TypeAgent-Development-Certificate.pfx"
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
        $env:CSC_LINK, $env:CSC_KEY_PASSWORD,
        [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
    if ($certificate.Subject -ne $policy.publisher -or $certificate.Thumbprint -notin $policy.thumbprints) {
        throw "Key Vault returned a signing certificate outside the reviewed publisher policy."
    }

    Push-Location (Join-Path $PSScriptRoot "..\..")
    try {
        Use-TypeAgentBuildTrust -Certificate $certificate -Action {
            & $env:ComSpec /d /c "pnpm run shell:package"
            if ($LASTEXITCODE -ne 0) { throw "Signed shell packaging failed." }
            $dist = Join-Path $PSScriptRoot "..\..\packages\shell\dist"
            & node (Join-Path $PSScriptRoot "verify-shell-artifacts.mjs") $dist
            if ($LASTEXITCODE -ne 0) { throw "Signed shell artifact verification failed." }
            [IO.File]::WriteAllBytes((Join-Path $dist "windows-package-trust.cer"),
                $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        }
    } finally {
        Pop-Location
    }
} catch {
    Write-Error "Shell signing failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
} finally {
    $env:CSC_LINK = $oldLink
    $env:CSC_KEY_PASSWORD = $oldPassword
    if ($null -ne $certificate) { $certificate.Dispose() }
}
