// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

export interface ScriptExecutionRequest {
    script: string;
    parameters: Record<string, unknown>;
    sandbox: {
        allowedCmdlets: string[];
        allowedPaths: string[];
        allowedModules: string[];
        maxExecutionTime: number;
        networkAccess: boolean;
    };
    workingDirectory?: string;
}

export interface ScriptExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
    truncated: boolean;
}

export async function executeScript(
    request: ScriptExecutionRequest,
): Promise<ScriptExecutionResult> {
    const scriptHostPath = join(
        __dirname,
        "..",
        "..",
        "scripts",
        "scriptHost.ps1",
    );

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
                resolve({
                    success: false,
                    stdout,
                    stderr: `Script execution timed out after ${request.sandbox.maxExecutionTime} seconds`,
                    exitCode: -1,
                    duration: Date.now() - startTime,
                    truncated,
                });
            }
        }, request.sandbox.maxExecutionTime * 1000);

        child.on("close", (code) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({
                    success: code === 0,
                    stdout,
                    stderr,
                    exitCode: code ?? -1,
                    duration: Date.now() - startTime,
                    truncated,
                });
            }
        });

        child.on("error", (err) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({
                    success: false,
                    stdout,
                    stderr: err.message,
                    exitCode: -1,
                    duration: Date.now() - startTime,
                    truncated,
                });
            }
        });
    });
}
