// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getPowerShellExecutionGates } from "../config/executionGates.mjs";
import type { ScriptExecutionProvenance } from "../types/scriptRecipe.js";
import { executeBrokeredPowerShell } from "./windowsSandboxBroker.mjs";
import { powerShellFingerprint } from "@typeagent/agent-flows/powershell/integrity";
import { approveInvocation } from "./invocationApproval.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findPackageRoot(): string {
    let current = __dirname;
    while (true) {
        const packageJson = join(current, "package.json");
        if (
            fs.existsSync(packageJson) &&
            JSON.parse(fs.readFileSync(packageJson, "utf8")).name ===
                "@typeagent/powershell-typeagent"
        ) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            throw new Error(
                "Unable to locate the @typeagent/powershell-typeagent package.",
            );
        }
        current = parent;
    }
}

const packageRoot = findPackageRoot();

const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

export type ScriptParameterRole = "path" | "executable";

interface ScriptExecutionProfiler {
    measure(
        name: string,
        start?: boolean,
        data?: unknown,
    ): { stop(data?: unknown): void };
}

export interface ScriptExecutionRequest {
    script: string;
    parameters: Record<string, unknown>;
    provenance?: ScriptExecutionProvenance | undefined;
    parameterRoles?: Partial<Record<string, ScriptParameterRole>>;
    sandbox: {
        allowedCmdlets: string[];
        allowedPaths: string[];
        allowedModules: string[];
        maxExecutionTime: number;
        networkAccess: boolean;
    };
    workingDirectory?: string;
    abortSignal?: AbortSignal | undefined;
    profiler?: ScriptExecutionProfiler | undefined;
    revisionHash?: string | undefined;
    requestApproval?: ((message: string) => Promise<number>) | undefined;
    assertCurrent?: (() => Promise<void>) | undefined;
}

export interface ScriptExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
    truncated: boolean;
    cancelled: boolean;
    errorCode?: string | undefined;
}

const knownDynamicProvenance = new Set<ScriptExecutionProvenance>([
    "generated",
    "manual",
    "seed",
    "imported",
    "edited",
]);

type DynamicScriptExecutionProvenance = Exclude<
    ScriptExecutionProvenance,
    "reviewed-static"
>;

function isDynamicProvenance(
    provenance: ScriptExecutionProvenance | undefined,
): provenance is DynamicScriptExecutionProvenance {
    return provenance !== undefined && knownDynamicProvenance.has(provenance);
}

export const DYNAMIC_POWERSHELL_COMMANDS = new Set([
    "ConvertFrom-Csv",
    "ConvertFrom-Json",
    "ConvertTo-Csv",
    "ConvertTo-Json",
    "ForEach-Object",
    "Format-List",
    "Format-Table",
    "Get-Date",
    "Group-Object",
    "Measure-Object",
    "Out-String",
    "Select-Object",
    "Sort-Object",
    "Start-Sleep",
    "Where-Object",
    "Write-Output",
]);

function createPolicyDeniedResult(message: string): ScriptExecutionResult {
    return {
        success: false,
        stdout: "",
        stderr: message,
        exitCode: -1,
        duration: 0,
        truncated: false,
        cancelled: false,
        errorCode: "powershell.policyDenied",
    };
}

export async function executeScript(
    request: ScriptExecutionRequest,
): Promise<ScriptExecutionResult> {
    request.abortSignal?.throwIfAborted();
    if (!isDynamicProvenance(request.provenance)) {
        return createPolicyDeniedResult(
            "PowerShell policy denied execution because script provenance is missing or unknown.",
        );
    }
    const gates = getPowerShellExecutionGates();
    if (!gates.dynamicExecution.enabled) {
        return createPolicyDeniedResult(
            "PowerShell policy denied dynamic script execution because it is disabled.",
        );
    }
    if (!gates.brokerExecution.enabled) {
        return createPolicyDeniedResult(
            "PowerShell policy denied dynamic script execution because broker execution is disabled.",
        );
    }
    if (request.sandbox.networkAccess) {
        return createPolicyDeniedResult(
            "PowerShell policy denied dynamic network access because the sandbox broker does not grant network capability.",
        );
    }
    if (request.sandbox.allowedModules.length > 0) {
        return createPolicyDeniedResult(
            "PowerShell policy denied dynamic module loading because the sandbox broker does not grant module capability.",
        );
    }
    if (request.sandbox.allowedPaths.length > 0) {
        return createPolicyDeniedResult(
            "PowerShell policy denied dynamic filesystem access because the sandbox broker does not grant external path capability.",
        );
    }
    const unsupportedCommands = request.sandbox.allowedCmdlets.filter(
        (command) => !DYNAMIC_POWERSHELL_COMMANDS.has(command),
    );
    if (unsupportedCommands.length > 0) {
        return createPolicyDeniedResult(
            "PowerShell policy denied an unsupported dynamic command.",
        );
    }
    if (
        !Number.isInteger(request.sandbox.maxExecutionTime) ||
        request.sandbox.maxExecutionTime < 1 ||
        request.sandbox.maxExecutionTime > 120 ||
        request.workingDirectory !== undefined
    ) {
        return createPolicyDeniedResult(
            "PowerShell policy requires a 1-120 second timeout and a private sandbox working directory.",
        );
    }

    const approval = await approveInvocation(request);
    if ("failure" in approval) return approval.failure;
    const snapshot = approval.snapshot;
    if (!isDynamicProvenance(snapshot.provenance)) {
        return createPolicyDeniedResult(
            "PowerShell invocation has no recognized dynamic provenance.",
        );
    }
    const currentGates = getPowerShellExecutionGates();
    if (
        !currentGates.dynamicExecution.enabled ||
        !currentGates.brokerExecution.enabled
    ) {
        return createPolicyDeniedResult(
            "PowerShell execution was disabled while approval was pending.",
        );
    }

    const profile = request.profiler?.measure(
        "powershellSandboxExecution",
        true,
        {
            provenance: snapshot.provenance,
            policyVersion: "appcontainer-v1",
            isolationMode: "appcontainer",
            languageMode: "ConstrainedLanguage",
            scriptHash: powerShellFingerprint(snapshot.script),
            invocationHash: approval.invocationHash,
        },
    );
    try {
        const result = await executeBrokeredPowerShell({
            script: snapshot.script,
            parameters: snapshot.parameters,
            provenance: snapshot.provenance,
            allowedCommands: snapshot.sandbox.allowedCmdlets,
            maxExecutionTime: snapshot.sandbox.maxExecutionTime,
            abortSignal: request.abortSignal,
        });
        profile?.stop({
            success: result.success,
            cancelled: result.cancelled,
            errorCode: result.errorCode,
            duration: result.duration,
        });
        return result;
    } catch (error) {
        profile?.stop({ success: false, outcome: "exception" });
        throw error;
    }
}

export async function executeReviewedStaticScript(
    request: Omit<ScriptExecutionRequest, "provenance">,
): Promise<ScriptExecutionResult> {
    request.abortSignal?.throwIfAborted();
    const profile = request.profiler?.measure(
        "powershellReviewedExecution",
        true,
        {
            provenance: "reviewed-static",
            policyVersion: "reviewed-static-v1",
            isolationMode: "legacy-reviewed",
            languageMode: "FullLanguage",
            scriptHash: createHash("sha256")
                .update(request.script)
                .digest("hex"),
        },
    );
    try {
        const result = await executeLegacyScript(request);
        profile?.stop({
            success: result.success,
            cancelled: result.cancelled,
            duration: result.duration,
        });
        return result;
    } catch (error) {
        profile?.stop({ success: false, outcome: "exception" });
        throw error;
    }
}

async function executeLegacyScript(
    request: Omit<ScriptExecutionRequest, "provenance">,
): Promise<ScriptExecutionResult> {
    const scriptHostPath = join(packageRoot, "scripts", "scriptHost.ps1");

    const args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptHostPath,
        "-ScriptBody",
        request.script,
        "-ParametersJson",
        JSON.stringify(request.parameters),
        "-ParameterRolesJson",
        JSON.stringify(request.parameterRoles ?? {}),
        "-AllowedCmdletsJson",
        JSON.stringify(request.sandbox.allowedCmdlets),
        "-NetworkAccess",
        request.sandbox.networkAccess ? "true" : "false",
        "-TimeoutSeconds",
        String(request.sandbox.maxExecutionTime),
    ];

    if (request.sandbox.allowedPaths.length > 0) {
        args.push("-AllowedPathsJson");
        args.push(JSON.stringify(request.sandbox.allowedPaths));
    }

    if (request.sandbox.allowedModules.length > 0) {
        args.push("-AllowedModulesJson");
        args.push(JSON.stringify(request.sandbox.allowedModules));
    }

    const startTime = Date.now();

    return new Promise<ScriptExecutionResult>((resolve) => {
        let stdout = "";
        let stderr = "";
        let truncated = false;
        let resolved = false;
        let cancelled = false;

        const child = spawn("powershell", args, {
            cwd: request.workingDirectory,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });

        child.stdout.on("data", (data: Buffer) => {
            if (stdout.length < MAX_OUTPUT_SIZE) {
                stdout += data.toString();
            } else {
                truncated = true;
            }
        });

        child.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                child.kill("SIGTERM");
                request.abortSignal?.removeEventListener("abort", onAbort);
                resolve({
                    success: false,
                    stdout,
                    stderr: `Script execution timed out after ${request.sandbox.maxExecutionTime} seconds`,
                    exitCode: -1,
                    duration: Date.now() - startTime,
                    truncated,
                    cancelled: false,
                });
            }
        }, request.sandbox.maxExecutionTime * 1000);

        const onAbort = () => {
            if (resolved) {
                return;
            }
            cancelled = true;
            child.kill("SIGTERM");
        };
        request.abortSignal?.addEventListener("abort", onAbort, {
            once: true,
        });

        child.on("close", (code) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                request.abortSignal?.removeEventListener("abort", onAbort);
                resolve({
                    success: !cancelled && code === 0,
                    stdout,
                    stderr: cancelled
                        ? "PowerShell execution was cancelled."
                        : stderr,
                    exitCode: code ?? -1,
                    duration: Date.now() - startTime,
                    truncated,
                    cancelled,
                });
            }
        });

        child.on("error", (err) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                request.abortSignal?.removeEventListener("abort", onAbort);
                resolve({
                    success: false,
                    stdout,
                    stderr: err.message,
                    exitCode: -1,
                    duration: Date.now() - startTime,
                    truncated,
                    cancelled: false,
                });
            }
        });
    });
}
