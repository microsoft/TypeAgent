// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import type {
    ProcessResult,
    ProcessRunner,
    ProcessRunOptions,
} from "./acquisitionTypes.js";

export class BoundedProcessRunner implements ProcessRunner {
    public run(
        command: string,
        args: readonly string[],
        options: ProcessRunOptions,
    ): Promise<ProcessResult> {
        if (
            !Number.isSafeInteger(options.timeoutMs) ||
            options.timeoutMs <= 0 ||
            !Number.isSafeInteger(options.maxOutputBytes) ||
            options.maxOutputBytes <= 0
        ) {
            return Promise.reject(
                new Error("Process bounds must be positive integers."),
            );
        }
        return new Promise((resolve, reject) => {
            const child = spawn(command, [...args], {
                cwd: options.cwd,
                shell: false,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            });
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let outputBytes = 0;
            let settled = false;
            let pendingError: Error | undefined;

            const fail = (error: Error) => {
                if (settled || pendingError !== undefined) {
                    return;
                }
                pendingError = error;
                if (child.exitCode === null) {
                    child.kill();
                }
            };
            const capture = (target: Buffer[]) => (chunk: Buffer) => {
                outputBytes += chunk.byteLength;
                if (outputBytes > options.maxOutputBytes) {
                    fail(
                        new Error(
                            `Process output exceeded ${options.maxOutputBytes} bytes.`,
                        ),
                    );
                    return;
                }
                target.push(chunk);
            };
            child.stdout.on("data", capture(stdout));
            child.stderr.on("data", capture(stderr));
            child.on("error", (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(error);
            });
            child.on("close", (code, signal) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                const result = {
                    stdout: Buffer.concat(stdout),
                    stderr: Buffer.concat(stderr),
                };
                if (pendingError !== undefined) {
                    reject(pendingError);
                    return;
                }
                if (code !== 0) {
                    reject(
                        new Error(
                            `${command} exited with ${code ?? signal}: ${new TextDecoder().decode(result.stderr)}`,
                        ),
                    );
                    return;
                }
                resolve(result);
            });
            const timer = setTimeout(
                () =>
                    fail(
                        new Error(
                            `${command} exceeded ${options.timeoutMs}ms timeout.`,
                        ),
                    ),
                options.timeoutMs,
            );
        });
    }
}

export function decodeOutput(output: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
}
