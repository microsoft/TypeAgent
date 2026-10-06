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
import {
    authorizeLocalScript,
    consumeScriptApproval,
    type ScriptApprovalContext,
} from "./scriptApproval.mjs";

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
        allowedCmdlets?: string[];
        allowedPaths?: string[];
        allowedModules?: string[];
        maxExecutionTime: number;
        networkAccess?: boolean;
    };
    workingDirectory?: string;
    requiredModules?: string[] | undefined;
    revisionStatus?: "verified" | "unverified" | "changed" | undefined;
    onAuthorized?: (() => Promise<void>) | undefined;
    abortSignal?: AbortSignal | undefined;
    profiler?: ScriptExecutionProfiler | undefined;
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
    approval?: ScriptApprovalContext,
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
    if (!approval) {
        return createPolicyDeniedResult(
            "PowerShell requires an interactive authorization context.",
        );
    }
    if (
        typeof request.script !== "string" ||
        !request.script.trim() ||
        request.script.length > 512 * 1024 ||
        !Number.isInteger(request.sandbox.maxExecutionTime) ||
        request.sandbox.maxExecutionTime < 1 ||
        request.sandbox.maxExecutionTime > 120 ||
        !request.parameters ||
        typeof request.parameters !== "object" ||
        Array.isArray(request.parameters)
    ) {
        return createPolicyDeniedResult(
            "Invalid approved-local PowerShell execution request.",
        );
    }
    return executeApprovedLocalScript(request, approval, request.provenance);
}

async function executeApprovedLocalScript(
    request: ScriptExecutionRequest,
    approval: ScriptApprovalContext,
    provenance: DynamicScriptExecutionProvenance,
): Promise<ScriptExecutionResult> {
    let approved;
    try {
        approved = await authorizeLocalScript(
            {
                script: request.script,
                parameters: request.parameters,
                workingDirectory: request.workingDirectory,
                maxExecutionTime: request.sandbox.maxExecutionTime,
                provenance,
                requiredModules: request.requiredModules,
                revisionStatus: request.revisionStatus,
            },
            approval,
            request.abortSignal,
        );
    } catch (error) {
        request.abortSignal?.throwIfAborted();
        return createPolicyDeniedResult(
            `PowerShell authorization was unavailable or invalidated. No script was executed. ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (!approved) {
        return createPolicyDeniedResult(
            "PowerShell execution was not authorized. No script was executed.",
        );
    }
    const gates = getPowerShellExecutionGates();
    if (!gates.dynamicExecution.enabled || !gates.brokerExecution.enabled) {
        return createPolicyDeniedResult(
            "Approved-local PowerShell was disabled before execution.",
        );
    }
    request.abortSignal?.throwIfAborted();
    try {
        await request.onAuthorized?.();
    } catch (error) {
        return createPolicyDeniedResult(
            error instanceof Error ? error.message : String(error),
        );
    }
    request.abortSignal?.throwIfAborted();
    const launchGates = getPowerShellExecutionGates();
    if (
        !launchGates.dynamicExecution.enabled ||
        !launchGates.brokerExecution.enabled ||
        !consumeScriptApproval(approved, approval)
    ) {
        return createPolicyDeniedResult(
            "PowerShell authorization was revoked, execution was disabled, or its snapshot changed. No script was executed.",
        );
    }
    const profile = request.profiler?.measure(
        "powershellApprovedLocalExecution",
        true,
        {
            provenance,
            policyVersion: "approved-local-v1",
            isolationMode: "current-user",
            scriptHash: createHash("sha256")
                .update(approved.script)
                .digest("hex"),
        },
    );
    try {
        return await executeBrokeredPowerShell({
            script: approved.script,
            parameters: approved.parameters,
            provenance,
            allowedCommands: [],
            maxExecutionTime: approved.maxExecutionTime,
            abortSignal: request.abortSignal,
            approvedLocal: true,
            workingDirectory: approved.workingDirectory,
            requiredModules: approved.requiredModules,
        });
    } finally {
        profile?.stop();
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
        JSON.stringify(request.sandbox.allowedCmdlets ?? []),
        "-NetworkAccess",
        request.sandbox.networkAccess ? "true" : "false",
        "-TimeoutSeconds",
        String(request.sandbox.maxExecutionTime),
    ];

    if (request.sandbox.allowedPaths?.length) {
        args.push("-AllowedPathsJson");
        args.push(JSON.stringify(request.sandbox.allowedPaths));
    }

    if (request.sandbox.allowedModules?.length) {
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
