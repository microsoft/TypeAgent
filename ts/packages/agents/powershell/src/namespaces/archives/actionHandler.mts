// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PowerShellArchivesActions } from "./archivesActionsSchema.mjs";
import {
    createPowerShellNamespaceActionHandler,
    type NamespaceActionDefinitions,
} from "../namespaceActionHandler.mjs";

const allowedPaths = ["$env:USERPROFILE", "$PWD", "$env:TEMP"] as const;

const definitions = {
    compress: {
        script: `param([string]$SourcePath, [string]$DestinationPath)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not $DestinationPath) { $DestinationPath = "$SourcePath.zip" }
if ([System.IO.Directory]::Exists($SourcePath)) {
    [System.IO.Compression.ZipFile]::CreateFromDirectory($SourcePath, $DestinationPath)
} else {
    $archive = [System.IO.Compression.ZipFile]::Open(
        $DestinationPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive,
            $SourcePath,
            [System.IO.Path]::GetFileName($SourcePath)
        ) | Out-Null
    } finally {
        $archive.Dispose()
    }
}`,
        allowedCmdlets: ["Add-Type", "Out-Null"],
        allowedPaths,
        parameterRoles: {
            sourcePath: "path",
            destinationPath: "path",
        },
        confirmation: "Create the requested ZIP archive?",
    },
    expand: {
        script: `param([string]$ArchivePath, [string]$DestinationPath)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not $DestinationPath) { $DestinationPath = "." }
[System.IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $DestinationPath)`,
        allowedCmdlets: ["Add-Type"],
        allowedPaths,
        parameterRoles: {
            archivePath: "path",
            destinationPath: "path",
        },
        confirmation: "Extract the requested archive?",
    },
} satisfies NamespaceActionDefinitions<PowerShellArchivesActions>;

export const archivesActionHandler =
    createPowerShellNamespaceActionHandler<PowerShellArchivesActions>(
        "powershell.powershell-archives",
        definitions,
    );
