// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, spawn } from "child_process";
import { randomUUID } from "crypto";

export const MAX_COMMAND_BYTES = 16 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
export const MAX_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PENDING_CANCELLATIONS = 64;
const STOP_FALLBACK_MS = 5_000;

export type WorkspaceCommandOutput = {
    text: string;
    truncated: boolean;
    totalBytes: number;
};

export type WorkspaceCommandResult = {
    success: boolean;
    exitCode: number | null;
    durationMs: number;
    command: string;
    cwd: string;
    stdout: WorkspaceCommandOutput;
    stderr: WorkspaceCommandOutput;
    timedOut: boolean;
    cancelled: boolean;
    executionId: string;
};

export type WorkspaceCommandRunOptions = {
    command: string;
    cwd: string;
    timeoutMs?: number;
    executionId?: string;
};

export type WorkspaceCommandCancellation = "cancelled" | "pending" | "notFound";

type CapturedOutput = {
    chunks: Buffer[];
    capturedBytes: number;
    totalBytes: number;
};

function captureOutput(captured: CapturedOutput, chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    captured.totalBytes += bytes.length;
    const remaining = MAX_OUTPUT_BYTES - captured.capturedBytes;
    if (remaining <= 0) {
        return;
    }
    const accepted = bytes.subarray(0, remaining);
    captured.chunks.push(accepted);
    captured.capturedBytes += accepted.length;
}

function output(captured: CapturedOutput): WorkspaceCommandOutput {
    return {
        text: Buffer.concat(captured.chunks).toString("utf8"),
        truncated: captured.totalBytes > captured.capturedBytes,
        totalBytes: captured.totalBytes,
    };
}

function validateCommand(command: string): string | undefined {
    if (command.trim().length === 0) {
        return "A non-empty command is required.";
    }
    if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) {
        return `Command exceeds the ${MAX_COMMAND_BYTES}-byte limit.`;
    }
    return undefined;
}

function validateTimeout(timeoutMs: number | undefined): number | string {
    if (timeoutMs === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }
    if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > MAX_TIMEOUT_MS
    ) {
        return `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`;
    }
    return timeoutMs;
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
    if (child.pid === undefined) {
        child.kill();
        return;
    }
    if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
            const killer = spawn(
                "taskkill",
                ["/PID", String(child.pid), "/T", "/F"],
                {
                    stdio: "ignore",
                    windowsHide: true,
                },
            );
            killer.once("error", () => {
                child.kill();
                resolve();
            });
            killer.once("close", () => resolve());
        });
        return;
    }
    try {
        process.kill(-child.pid, "SIGTERM");
    } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== "Error") {
            throw error;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") {
            throw error;
        }
    }
    setTimeout(() => {
        try {
            process.kill(-child.pid!, "SIGKILL");
        } catch {
            // The process group exited during the grace period.
        }
    }, 1_000).unref();
}

export class WorkspaceCommandRunner {
    private readonly activeCommands = new Map<
        string,
        { child: ChildProcess; cancel: () => void }
    >();
    private readonly pendingCancellations = new Set<string>();

    public async run(
        options: WorkspaceCommandRunOptions,
    ): Promise<WorkspaceCommandResult | { error: string }> {
        const executionId = options.executionId ?? randomUUID();
        if (this.consumePendingCancellation(executionId)) {
            return {
                success: false,
                exitCode: null,
                durationMs: 0,
                command: options.command,
                cwd: options.cwd,
                stdout: { text: "", truncated: false, totalBytes: 0 },
                stderr: { text: "", truncated: false, totalBytes: 0 },
                timedOut: false,
                cancelled: true,
                executionId,
            };
        }
        const commandError = validateCommand(options.command);
        if (commandError !== undefined) {
            return { error: commandError };
        }
        const timeout = validateTimeout(options.timeoutMs);
        if (typeof timeout === "string") {
            return { error: timeout };
        }
        if (this.activeCommands.has(executionId)) {
            return {
                error: `A command with executionId '${executionId}' is already running.`,
            };
        }

        const startedAt = Date.now();
        const stdout: CapturedOutput = {
            chunks: [],
            capturedBytes: 0,
            totalBytes: 0,
        };
        const stderr: CapturedOutput = {
            chunks: [],
            capturedBytes: 0,
            totalBytes: 0,
        };
        let timedOut = false;
        let cancelled = false;
        let stopping = false;
        const isWindows = process.platform === "win32";
        const shell = isWindows ? process.env.ComSpec || "cmd.exe" : "/bin/sh";
        const shellArgs = isWindows
            ? ["/d", "/s", "/c", `"${options.command}"`]
            : ["-c", options.command];

        return new Promise((resolve) => {
            let settled = false;
            let stopFallbackHandle: NodeJS.Timeout | undefined;
            let timeoutHandle: NodeJS.Timeout;
            let child: ChildProcess;
            try {
                child = spawn(shell, shellArgs, {
                    cwd: options.cwd,
                    detached: !isWindows,
                    shell: false,
                    stdio: ["ignore", "pipe", "pipe"],
                    // cmd.exe parses its command after /c. Node's normal
                    // Windows argument escaping changes embedded quotes.
                    windowsVerbatimArguments: isWindows,
                    windowsHide: true,
                });
            } catch (error) {
                resolve({
                    error:
                        error instanceof Error ? error.message : String(error),
                });
                return;
            }

            const finish = (exitCode: number | null) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutHandle);
                if (stopFallbackHandle !== undefined) {
                    clearTimeout(stopFallbackHandle);
                }
                this.activeCommands.delete(executionId);
                resolve({
                    success: exitCode === 0 && !timedOut && !cancelled,
                    exitCode,
                    durationMs: Date.now() - startedAt,
                    command: options.command,
                    cwd: options.cwd,
                    stdout: output(stdout),
                    stderr: output(stderr),
                    timedOut,
                    cancelled,
                    executionId,
                });
            };
            const stop = (reason: "timeout" | "cancel") => {
                if (stopping) {
                    return;
                }
                stopping = true;
                if (reason === "timeout") {
                    timedOut = true;
                } else {
                    cancelled = true;
                }
                void terminateProcessTree(child).catch((error: unknown) => {
                    captureOutput(
                        stderr,
                        `Failed to terminate command: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`,
                    );
                });
                stopFallbackHandle = setTimeout(() => {
                    child.stdout?.destroy();
                    child.stderr?.destroy();
                    finish(child.exitCode);
                }, STOP_FALLBACK_MS);
                stopFallbackHandle.unref();
            };
            timeoutHandle = setTimeout(() => stop("timeout"), timeout);

            this.activeCommands.set(executionId, {
                child,
                cancel: () => stop("cancel"),
            });
            child.stdout?.on("data", (chunk: Buffer | string) =>
                captureOutput(stdout, chunk),
            );
            child.stderr?.on("data", (chunk: Buffer | string) =>
                captureOutput(stderr, chunk),
            );
            child.once("error", (error) => {
                captureOutput(stderr, error.message);
            });
            child.once("close", (exitCode) => finish(exitCode));
            child.once("spawn", () => {
                if (cancelled) {
                    stop("cancel");
                }
            });
        });
    }

    public cancel(
        executionId: string,
        allowPendingCancellation = false,
    ): WorkspaceCommandCancellation {
        const command = this.activeCommands.get(executionId);
        if (command === undefined) {
            if (this.pendingCancellations.has(executionId)) {
                return "pending";
            }
            if (!allowPendingCancellation) {
                return "notFound";
            }
            if (this.pendingCancellations.size >= MAX_PENDING_CANCELLATIONS) {
                const oldest = this.pendingCancellations.values().next().value;
                if (oldest !== undefined) {
                    this.pendingCancellations.delete(oldest);
                }
            }
            this.pendingCancellations.add(executionId);
            return "pending";
        }
        command.cancel();
        return "cancelled";
    }

    public consumePendingCancellation(executionId: string): boolean {
        return this.pendingCancellations.delete(executionId);
    }

    public cancelAll(): void {
        for (const command of this.activeCommands.values()) {
            command.cancel();
        }
        this.pendingCancellations.clear();
    }
}
