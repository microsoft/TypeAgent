# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

function Assert-PackageFilePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.PSIsContainer) { throw "Expected a package file: $Path" }
    while ($null -ne $item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Package paths must not contain reparse points: $Path"
        }
        $item = if ($item -is [IO.FileInfo]) { $item.Directory } else { $item.Parent }
    }
}

function Assert-TypeAgentSignature {
    param([Parameter(Mandatory = $true)][string]$Path)

    $policy = Get-Content -LiteralPath (Join-Path $PSScriptRoot "windows-package-trust.json") -Raw | ConvertFrom-Json
    $signature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
    if ($signature.Status -ne "Valid" -or
        $signature.SignerCertificate.Subject -ne $policy.publisher -or
        $signature.SignerCertificate.Thumbprint -notin $policy.thumbprints) {
        throw "Untrusted TypeAgent package '$Path' (signature: $($signature.Status)). Install the independently verified public development certificate separately; never trust a certificate supplied by channel metadata."
    }
}

function Use-TypeAgentBuildTrust {
    param(
        [Parameter(Mandatory = $true)][Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    $policy = Get-Content -LiteralPath (Join-Path $PSScriptRoot "windows-package-trust.json") -Raw | ConvertFrom-Json
    if ($Certificate.Subject -ne $policy.publisher -or $Certificate.Thumbprint -notin $policy.thumbprints) {
        throw "Build certificate does not match the independently pinned signing identity."
    }
    $publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
        $Certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    # CurrentUser\Root can display a native confirmation dialog even in non-interactive PowerShell.
    $store = New-Object Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
    $added = $false
    try {
        Write-Host "Opening temporary build trust in LocalMachine\Root (requires administrator rights)."
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        if (-not @($store.Certificates | Where-Object { $_.Thumbprint -eq $publicCertificate.Thumbprint }).Count) {
            Write-Host "Adding pinned build certificate $($publicCertificate.Thumbprint) to LocalMachine\Root."
            $store.Add($publicCertificate)
            $added = $true
        }
        Write-Host "Build trust ready; running package action."
        & $Action
    } finally {
        try {
            if ($added) {
                Write-Host "Removing temporary build certificate $($publicCertificate.Thumbprint) from LocalMachine\Root."
                $store.Remove($publicCertificate)
            }
        } finally {
            $store.Close()
            $publicCertificate.Dispose()
        }
    }
}

function Open-TypeAgentPackage {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-PackageFilePath -Path $Path
    # Deny writes and deletion until execution completes, including during verification.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        Assert-TypeAgentSignature -Path $Path
        return $stream
    } catch {
        $stream.Dispose()
        throw
    }
}
