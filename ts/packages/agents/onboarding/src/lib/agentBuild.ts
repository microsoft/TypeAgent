// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared helpers for building a scaffolded agent package. Used by the
// Scaffolder phase (to produce a built agent that the Testing phase can load)
// and by the Packaging phase (as an idempotent rebuild before distribution).

import { spawn } from "child_process";

export interface CommandOutcome {
    success: boolean;
    output: string;
}

/**
 * Spawn a command in `cwd`, capturing merged stdout/stderr. Never rejects —
 * a non-zero exit (or spawn error) resolves with `success: false`.
 *
 * `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` is forced so a `pnpm` invocation through
 * a corepack shim never blocks the headless onboarding dispatcher on an
 * interactive "download pnpm?" prompt.
 */
export async function runCommand(
    cmd: string,
    args: string[],
    cwd: string,
): Promise<CommandOutcome> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
            env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
        });

        let output = "";
        proc.stdout?.on("data", (d: Buffer) => {
            output += d.toString();
        });
        proc.stderr?.on("data", (d: Buffer) => {
            output += d.toString();
        });

        proc.on("close", (code) => {
            resolve({ success: code === 0, output });
        });

        proc.on("error", (err) => {
            resolve({ success: false, output: err.message });
        });
    });
}

/**
 * Install the scaffolded agent's dependencies and compile it, leaving a `dist/`
 * that the Testing phase can load via `createNpmAppAgentProvider`.
 *
 * `pnpm install` runs with `--ignore-scripts` so the workspace-wide install a
 * new in-repo package triggers does NOT run heavy native postinstalls (e.g. the
 * shell's better-sqlite3 / electron rebuild) that the agent does not need. The
 * agent's own build (`tsc` + `asc` + `agc`) relies only on linked workspace
 * dependencies, not lifecycle scripts.
 */
export async function buildScaffoldedAgent(
    agentDir: string,
): Promise<CommandOutcome> {
    const install = await runCommand(
        "pnpm",
        ["install", "--ignore-scripts"],
        agentDir,
    );
    if (!install.success) {
        return {
            success: false,
            output: `pnpm install failed:\n${install.output}`,
        };
    }

    const build = await runCommand("pnpm", ["run", "build"], agentDir);
    if (!build.success) {
        return { success: false, output: `Build failed:\n${build.output}` };
    }

    return { success: true, output: build.output };
}
