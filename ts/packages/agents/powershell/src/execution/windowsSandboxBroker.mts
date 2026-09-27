// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScriptExecutionProvenance } from "../types/scriptRecipe.js";
import type { ScriptExecutionResult } from "./powershellRunner.mjs";

const MAX_BROKER_RESPONSE_SIZE = 2 * 1024 * 1024;
const BROKER_PROTOCOL_VERSION = 1;

export interface BrokeredScriptExecutionRequest {
    script: string;
    parameters: Record<string, unknown>;
    provenance: Exclude<ScriptExecutionProvenance, "reviewed-static">;
    allowedCommands: string[];
    maxExecutionTime: number;
    abortSignal?: AbortSignal | undefined;
}

function findPackageRoot(): string {
    let current = dirname(fileURLToPath(import.meta.url));
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

function resolveBrokerPath(): string | undefined {
    const configured = process.env.TYPEAGENT_POWERSHELL_BROKER;
    if (configured) {
        return resolve(configured);
    }
    const architecture =
        process.arch === "x64"
            ? "win-x64"
            : process.arch === "arm64"
              ? "win-arm64"
              : undefined;
    if (architecture === undefined) {
        return undefined;
    }
    const packageRoot = findPackageRoot();
    const repositoryRoot = resolve(packageRoot, "..", "..", "..", "..");
    const candidates = [
        join(
            packageRoot,
            "broker",
            architecture,
            "PowerShellSandboxBroker.exe",
        ),
        join(
            repositoryRoot,
            "dotnet",
            "powerShellSandboxBroker",
            "publish",
            architecture,
            "PowerShellSandboxBroker.exe",
        ),
        join(
            repositoryRoot,
            "dotnet",
            "powerShellSandboxBroker",
            "bin",
            "Release",
            "net8.0-windows10.0.19041.0",
            architecture,
            "PowerShellSandboxBroker.exe",
        ),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate));
}

function createFailure(
    stderr: string,
    duration: number = 0,
    cancelled: boolean = false,
    errorCode: string = "broker.unavailable",
): ScriptExecutionResult {
    return {
        success: false,
        stdout: "",
        stderr,
        exitCode: -1,
        duration,
        truncated: false,
        cancelled,
        errorCode,
    };
}

function isScriptExecutionResult(
    value: unknown,
): value is ScriptExecutionResult {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const result = value as Partial<ScriptExecutionResult>;
    return (
        typeof result.success === "boolean" &&
        typeof result.stdout === "string" &&
        typeof result.stderr === "string" &&
        typeof result.exitCode === "number" &&
        typeof result.duration === "number" &&
        typeof result.truncated === "boolean" &&
        typeof result.cancelled === "boolean" &&
        (result.errorCode === undefined || typeof result.errorCode === "string")
    );
}

export async function executeBrokeredPowerShell(
    request: BrokeredScriptExecutionRequest,
): Promise<ScriptExecutionResult> {
    request.abortSignal?.throwIfAborted();
    if (process.platform !== "win32") {
        return createFailure(
            "PowerShell policy denied dynamic execution because the Windows sandbox broker is unavailable on this platform.",
        );
    }
    const brokerPath = resolveBrokerPath();
    if (brokerPath === undefined) {
        return createFailure(
            "PowerShell policy denied dynamic execution because the sandbox broker is not installed.",
        );
    }

    const started = Date.now();
    return new Promise<ScriptExecutionResult>((resolveResult) => {
        const child = spawn(brokerPath, [], {
            windowsHide: true,
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let cancelled = false;

        const finish = (result: ScriptExecutionResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            request.abortSignal?.removeEventListener("abort", onAbort);
            resolveResult(result);
        };
        const appendBounded = (
            current: string,
            chunk: Buffer,
        ): string | undefined => {
            const next = current + chunk.toString();
            return Buffer.byteLength(next) <= MAX_BROKER_RESPONSE_SIZE
                ? next
                : undefined;
        };

        child.stdout.on("data", (chunk: Buffer) => {
            const next = appendBounded(stdout, chunk);
            if (next === undefined) {
                child.kill();
                finish(
                    createFailure(
                        "PowerShell broker returned an oversized response.",
                        Date.now() - started,
                        false,
                        "broker.invalidResponse",
                    ),
                );
                return;
            }
            stdout = next;
        });
        child.stderr.on("data", (chunk: Buffer) => {
            const next = appendBounded(stderr, chunk);
            if (next === undefined) {
                child.kill();
                finish(
                    createFailure(
                        "PowerShell broker returned oversized diagnostics.",
                        Date.now() - started,
                        false,
                        "broker.invalidResponse",
                    ),
                );
                return;
            }
            stderr = next;
        });

        const onAbort = () => {
            cancelled = true;
            child.kill();
        };
        request.abortSignal?.addEventListener("abort", onAbort, {
            once: true,
        });
        const timeout = setTimeout(
            () => {
                child.kill();
                finish(
                    createFailure(
                        `PowerShell broker timed out after ${request.maxExecutionTime} seconds.`,
                        Date.now() - started,
                        false,
                        "broker.timeout",
                    ),
                );
            },
            (request.maxExecutionTime + 10) * 1000,
        );

        child.on("error", () => {
            finish(
                createFailure(
                    "PowerShell broker failed to start.",
                    Date.now() - started,
                    false,
                    "broker.startFailed",
                ),
            );
        });
        child.on("close", () => {
            if (cancelled) {
                finish(
                    createFailure(
                        "PowerShell execution was cancelled.",
                        Date.now() - started,
                        true,
                        "broker.cancelled",
                    ),
                );
                return;
            }
            try {
                const parsed: unknown = JSON.parse(stdout);
                if (!isScriptExecutionResult(parsed)) {
                    throw new Error("invalid response shape");
                }
                finish(parsed);
            } catch {
                finish(
                    createFailure(
                        stderr.trim() ||
                            "PowerShell broker returned an invalid response.",
                        Date.now() - started,
                        false,
                        "broker.invalidResponse",
                    ),
                );
            }
        });

        child.stdin.end(
            JSON.stringify({
                protocolVersion: BROKER_PROTOCOL_VERSION,
                script: request.script,
                parameters: request.parameters,
                allowedCommands: request.allowedCommands,
                timeoutSeconds: request.maxExecutionTime,
                maxOutputBytes: 256 * 1024,
                provenance: request.provenance,
            }),
        );
    });
}
