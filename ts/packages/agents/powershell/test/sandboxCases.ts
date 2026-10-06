// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ScriptExecutionRequest,
    ScriptExecutionResult,
} from "../src/execution/powershellRunner.mjs";
import { executeBrokeredPowerShell } from "../src/execution/windowsSandboxBroker.mjs";

export async function copyBrokerWithTestHost(
    directory: string,
    hostScript: string,
): Promise<string> {
    const architecture = process.arch === "arm64" ? "win-arm64" : "win-x64";
    const brokerName = "PowerShellSandboxBroker.exe";
    const broker = join(directory, brokerName);
    await copyFile(
        fileURLToPath(
            new URL(
                `../../broker/${architecture}/${brokerName}`,
                import.meta.url,
            ),
        ),
        broker,
    );
    await writeFile(join(directory, "scriptHost.ps1"), hostScript);
    return broker;
}

export function executeRestrictedScript(
    request: ScriptExecutionRequest,
): Promise<ScriptExecutionResult> {
    if (
        request.provenance === undefined ||
        request.provenance === "reviewed-static"
    ) {
        throw new Error(
            "Expected dynamic provenance in a legacy protocol test.",
        );
    }
    return executeBrokeredPowerShell({
        script: request.script,
        parameters: request.parameters,
        provenance: request.provenance,
        allowedCommands: request.sandbox.allowedCmdlets ?? [],
        maxExecutionTime: request.sandbox.maxExecutionTime,
        abortSignal: request.abortSignal,
    });
}

export async function runDeniedFileReadCase(): Promise<ScriptExecutionResult> {
    const directory = await mkdtemp(
        join(tmpdir(), "typeagent-powershell-dotnet-path-policy-"),
    );
    const allowedDirectory = join(directory, "allowed");
    const deniedDirectory = join(directory, "denied");
    const deniedPath = join(deniedDirectory, "marker.txt");
    try {
        await mkdir(allowedDirectory);
        await mkdir(deniedDirectory);
        await writeFile(deniedPath, "outside-marker");

        return await executeRestrictedScript({
            script: String.raw`param([string]$AllowedRoot)
$deniedPath = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine($AllowedRoot, "..\denied\marker.txt")
)
[System.IO.File]::ReadAllText($deniedPath)`,
            parameters: { AllowedRoot: allowedDirectory },
            provenance: "generated",
            parameterRoles: { AllowedRoot: "path" },
            sandbox: {
                allowedCmdlets: [],
                allowedPaths: [allowedDirectory],
                allowedModules: [],
                maxExecutionTime: 10,
                networkAccess: false,
            },
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
