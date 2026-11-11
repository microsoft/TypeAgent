// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn, spawnSync } from "node:child_process";

export function workspaceTestTimeout(value) {
    if (value === undefined || value === "") return undefined;
    const milliseconds = Number(value);
    if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(milliseconds) ||
        milliseconds <= 0 ||
        milliseconds > 2 ** 31 - 1
    ) {
        throw new Error(
            "TYPEAGENT_TEST_WORKSPACE_TIMEOUT_MS must be a positive timer-safe integer.",
        );
    }
    return milliseconds;
}

export function runBoundedTestCommand(
    command,
    args,
    { timeoutMs, graceMs = 5000, ...options },
) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error("A positive test command deadline is required.");
    }
    return new Promise((resolve) => {
        const windows = process.platform === "win32";
        const started = Date.now();
        const child = spawn(command, args, {
            ...options,
            detached: !windows,
        });
        let stopping = false;
        let forceTimer;
        let cancellation;
        const listeners = new Map(
            ["SIGINT", "SIGTERM"].map((signal) => [signal, () => stop(signal)]),
        );
        const timer = setTimeout(() => stop(), timeoutMs);

        function finish(result) {
            clearTimeout(timer);
            clearTimeout(forceTimer);
            for (const [signal, listener] of listeners) {
                process.removeListener(signal, listener);
            }
            if (cancellation) {
                process.kill(process.pid, cancellation);
            } else {
                resolve(result);
            }
        }

        function terminate(signal) {
            if (!child.pid) return;
            if (windows) {
                const result = spawnSync(
                    "taskkill",
                    ["/PID", String(child.pid), "/T", "/F"],
                    { encoding: "utf8", timeout: 10000 },
                );
                if (result.error || result.status !== 0) {
                    console.error(
                        `Test process-tree cleanup for PID ${child.pid}: ${result.error?.message ?? result.stderr ?? result.stdout}`,
                    );
                }
            } else {
                try {
                    process.kill(-child.pid, signal);
                } catch (error) {
                    if (error.code !== "ESRCH") {
                        console.error(
                            `Unable to send ${signal} to test process group ${child.pid}: ${error.message}`,
                        );
                    }
                }
            }
        }

        function stop(signal) {
            if (stopping) return;
            stopping = true;
            cancellation = signal;
            console.error(
                `Workspace test command ${signal ? `cancelled by ${signal}` : `exceeded ${timeoutMs}ms deadline`} after ${Date.now() - started}ms; terminating owned process tree (PID ${child.pid}).`,
            );
            terminate("SIGTERM");
            forceTimer = setTimeout(() => {
                if (!windows) terminate("SIGKILL");
                finish({
                    status: null,
                    signal: null,
                    error: new Error(
                        `Workspace test deadline exceeded (${timeoutMs}ms); process-tree cleanup attempted. See preceding package output for original failures.`,
                    ),
                });
            }, graceMs);
        }

        for (const [signal, listener] of listeners) {
            process.on(signal, listener);
        }
        child.once("error", (error) =>
            finish({ error, signal: null, status: null }),
        );
        child.once("exit", (status, signal) => {
            if (!stopping) finish({ status, signal });
        });
    });
}
