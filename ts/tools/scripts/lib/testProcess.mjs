// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function diagnosticText(value, env) {
    let text = String(value ?? "");
    const secrets = Object.entries(env)
        .filter(
            ([name, value]) =>
                /token|secret|password|credential|(?:api|subscription)[_-]?key|authorization/i.test(
                    name,
                ) &&
                typeof value === "string" &&
                value.length > 0,
        )
        .map(([, value]) => value)
        .sort((left, right) => right.length - left.length);
    for (const secret of secrets) {
        text = text.replaceAll(secret, "[redacted]");
    }
    text = text
        .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
        .replace(
            /(\b(?:[\w-]*(?:token|secret|password|api[_-]?key)|authorization|_auth)["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^\s"',;]+/gi,
            "$1[redacted]",
        );
    if (text.length > 4096) {
        return `${text.slice(0, 2048)}\n[truncated ${text.length - 4096} characters]\n${text.slice(-2048)}`;
    }
    return text || "<empty>";
}

export function formatTestCommandFailure(
    command,
    args,
    result,
    {
        stage = "test subprocess",
        cwd = process.cwd(),
        elapsedMs,
        expectedStatus = 0,
        env = process.env,
    } = {},
) {
    const error = result.error;
    const context = [
        `${stage} failed`,
        `command: ${JSON.stringify([command, ...args])}`,
        `cwd: ${cwd}`,
        `pid: ${result.pid ?? "<not started>"}`,
        `elapsed: ${elapsedMs ?? "<unknown>"}ms`,
        `status: ${result.status}; expected: ${expectedStatus}`,
        `signal: ${result.signal ?? "none"}`,
        `spawn error: ${error ? `${error.code ?? error.name}: ${error.message}` : "none"}`,
    ].map((line) => diagnosticText(line, env));
    return [
        ...context,
        `stdout:\n${diagnosticText(result.stdout, env)}`,
        `stderr:\n${diagnosticText(result.stderr, env)}`,
    ].join("\n");
}

export function runTestCommand(
    command,
    args,
    { stage, expectedStatus = 0, ...options } = {},
) {
    const started = Date.now();
    const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
    assert.ok(
        !result.error &&
            result.signal === null &&
            result.status === expectedStatus,
        formatTestCommandFailure(command, args, result, {
            ...options,
            stage,
            expectedStatus,
            elapsedMs: Date.now() - started,
        }),
    );
    return result;
}
