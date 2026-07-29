// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared helpers for building a scaffolded agent package. Used by the
// Scaffolder phase (to produce a built agent that the Testing phase can load)
// and by the Packaging phase (as an idempotent rebuild before distribution).

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

export interface CommandOutcome {
    success: boolean;
    output: string;
}

/**
 * Walk up from `startDir` to the nearest `.npmrc` that pins a `registry=` (the
 * internal TypeAgent feed) and return that URL. An isolated
 * `pnpm install --ignore-workspace` treats the agent directory as the project
 * root and does NOT inherit the repo's `ts/.npmrc`, so without passing the feed
 * explicitly the install would fall back to the (unreachable) public registry.
 * Auth is unaffected: it lives in the user-level `~/.npmrc`, which pnpm always
 * reads. Returns `undefined` when no `.npmrc` with a registry is found (e.g. an
 * agent scaffolded outside the repo, where the caller relies on default config).
 */
function findFeedRegistry(startDir: string): string | undefined {
    let dir = path.resolve(startDir);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const npmrc = path.join(dir, ".npmrc");
        if (existsSync(npmrc)) {
            const match = readFileSync(npmrc, "utf-8").match(
                /^\s*registry\s*=\s*(\S+)/m,
            );
            if (match) return match[1];
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/**
 * Spawn a command in `cwd`, capturing merged stdout/stderr. Never rejects —
 * a non-zero exit (or spawn error) resolves with `success: false`.
 *
 * `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` is forced so a `pnpm` invocation through
 * a corepack shim never blocks the headless onboarding dispatcher on an
 * interactive "download pnpm?" prompt.
 *
 * Resolution keys off the process `"exit"` event (the child has terminated),
 * NOT `"close"` (all inherited stdio pipes have hit EOF). The generated build
 * script is `concurrently npm:tsc npm:asc npm:agc`, a parallel fan-out; on
 * Windows (`shell: true`) each tool runs through cmd/conhost and inherits the
 * spawned shell's stdout/stderr pipes. If any of those grandchildren leaks or
 * lingers on a pipe handle after the shell itself has exited, `"close"` never
 * fires — so a `"close"`-only wait hangs FOREVER even though the build already
 * finished and wrote `dist/`. We instead resolve on `"exit"`, giving `"close"`
 * a short grace window first so the normal (fast, clean) path still captures
 * fully-flushed output; a `windowsHide` flag avoids transient console windows.
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
            windowsHide: true,
            env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
        });

        let output = "";
        let settled = false;
        const finish = (result: CommandOutcome) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        proc.stdout?.on("data", (d: Buffer) => {
            output += d.toString();
        });
        proc.stderr?.on("data", (d: Buffer) => {
            output += d.toString();
        });

        // Fast path: everything flushed and pipes closed cleanly.
        proc.on("close", (code) => {
            finish({ success: code === 0, output });
        });

        // Safety net: the child has terminated. Allow a brief grace period for a
        // trailing `"close"` (to capture last flushed output); if a leaked
        // grandchild pipe keeps `"close"` from ever firing, resolve anyway so the
        // build step can never hang indefinitely.
        proc.on("exit", (code) => {
            setTimeout(() => {
                finish({ success: code === 0, output });
            }, 500);
        });

        proc.on("error", (err) => {
            finish({ success: false, output: err.message });
        });
    });
}

/**
 * Install the scaffolded agent's dependencies and compile it, leaving a `dist/`
 * that the Testing phase can load via `createNpmAppAgentProvider`.
 *
 * A freshly scaffolded agent lives under `packages/agents/*`, which the pnpm
 * workspace globs as a member. A plain `pnpm install` in its directory would
 * therefore re-resolve and RELINK the ENTIRE workspace — mutating the tracked
 * `pnpm-lock.yaml` and coupling the agent build to unrelated heavy packages
 * (e.g. the shell's electron / better-sqlite3 native deps). We instead run an
 * ISOLATED install with `--ignore-workspace`, so pnpm treats the agent directory
 * as a standalone project: it writes only the agent's own `node_modules` +
 * `pnpm-lock.yaml` and never touches the workspace lockfile. This requires the
 * agent's `@typeagent/*` deps to be `link:`/`file:` rather than `workspace:*`
 * (emitted by the scaffolder's getWorkspaceDepValue).
 *
 * `--ignore-scripts` skips native postinstalls the agent doesn't need;
 * `--prefer-offline` reuses the already-populated per-drive pnpm store. Because
 * `--ignore-workspace` skips the repo `.npmrc`, the feed registry is passed
 * explicitly when discoverable (public npm is unreachable in this environment).
 *
 * The build step ALSO passes `--ignore-workspace`: `pnpm run` performs a
 * deps-status check before executing a script, and without the flag that check
 * treats the agent as a workspace member — re-resolving the ENTIRE workspace
 * (the very whole-workspace install the isolated install was meant to avoid,
 * which hangs on the shell's unfetchable native deps).
 */
export async function buildScaffoldedAgent(
    agentDir: string,
): Promise<CommandOutcome> {
    const registry = findFeedRegistry(agentDir);
    const installArgs = [
        "install",
        "--ignore-workspace",
        "--ignore-scripts",
        "--prefer-offline",
    ];
    if (registry) installArgs.push("--registry", registry);

    const install = await runCommand("pnpm", installArgs, agentDir);
    if (!install.success) {
        return {
            success: false,
            output: `pnpm install failed:\n${install.output}`,
        };
    }

    const build = await runCommand(
        "pnpm",
        ["--ignore-workspace", "run", "build"],
        agentDir,
    );
    if (!build.success) {
        return { success: false, output: `Build failed:\n${build.output}` };
    }

    return { success: true, output: build.output };
}
