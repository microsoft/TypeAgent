// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
    studioWorkspaceKey,
    readStudioServiceToken,
} from "@typeagent/core/runtime";
import { lookupStudioService } from "./studioRegistryLookup.js";

/** A resolved, reachable standalone Studio service for a workspace. */
export interface ServiceTarget {
    endpoint: string;
    token: string;
}

const STUDIO_DIR = path.join(os.homedir(), ".typeagent", "studio");

/** Per-workspace launch lock so two windows don't spawn duplicate services. */
function lockPath(workspaceKey: string): string {
    return path.join(STUDIO_DIR, `service-${workspaceKey}.lock`);
}

/** Stale launch locks (crash mid-launch) are reclaimed after this long. */
const LOCK_STALE_MS = 30_000;
/** How long to wait for a freshly-spawned/peer service to announce itself. */
const ANNOUNCE_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 400;

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Translate a live registry entry into a connection target. */
function toTarget(entry: { port: number; token: string }): ServiceTarget {
    return { endpoint: `ws://127.0.0.1:${entry.port}`, token: entry.token };
}

/** Poll the registry until a service for `workspaceKey` is live, or timeout. */
async function waitForService(
    workspaceKey: string,
    agentServerUrl: string | undefined,
    timeoutMs: number,
): Promise<ServiceTarget | undefined> {
    const deadline = Date.now() + timeoutMs;
    do {
        const entry = await lookupStudioService(
            workspaceKey,
            agentServerUrl !== undefined ? { agentServerUrl } : {},
        );
        if (entry !== null) {
            return toTarget(entry);
        }
        await delay(POLL_INTERVAL_MS);
    } while (Date.now() < deadline);
    return undefined;
}

/** Resolve the bundled Studio service entrypoint (shipped in the extension's
 * `dist/` next to this bundle — see esbuild.mjs). The extension bundle is
 * CommonJS, so `__dirname` is the `dist/` directory at runtime. */
function resolveServiceMain(): string {
    return path.join(__dirname, "studio-service.js");
}

/** Spawn a service for `repoRoot` and resolve its target from stdout + token file.
 *
 * The child prints `{"port":N}` on stdout once bound and writes its capability
 * token to the per-port file; reading both directly means the launching window
 * connects to its own service WITHOUT needing the agent-server (the registry is
 * only for the agent proxy and cross-window attach). The child is launched
 * non-detached and `unref`'d so it doesn't keep the extension host's event loop
 * alive; binding its lifetime strictly to the host (kill on deactivate / idle
 * shutdown) is a tracked follow-up.
 */
function spawnService(repoRoot: string): Promise<ServiceTarget | undefined> {
    const main = resolveServiceMain();
    return new Promise((resolve) => {
        let settled = false;
        const settle = (value: ServiceTarget | undefined) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(process.execPath, [main, "--workspace", repoRoot], {
                stdio: ["ignore", "pipe", "ignore"],
                windowsHide: true,
                // In the VS Code extension host, `process.execPath` is the
                // Electron/Code binary, not a standalone Node. `ELECTRON_RUN_AS_NODE`
                // makes it execute our script as plain Node; harmless when
                // execPath already is Node (e.g. the `typeagent-studio serve` CLI).
                env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            });
        } catch (err) {
            console.warn("[typeagent-studio] failed to spawn service:", err);
            settle(undefined);
            return;
        }
        child.unref();
        child.on("error", (err) => {
            console.warn("[typeagent-studio] service spawn error:", err);
            settle(undefined);
        });
        const timeout = setTimeout(
            () => settle(undefined),
            ANNOUNCE_TIMEOUT_MS,
        );
        timeout.unref?.();
        let buffer = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
            if (settled) {
                return;
            }
            buffer += chunk;
            // Scan each complete line; the service prints `{"port":N}` as its
            // only stdout output, but tolerate any preceding banner lines.
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf("\n");
                if (line.length === 0) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(line) as { port?: unknown };
                    if (typeof parsed.port === "number") {
                        const port = parsed.port;
                        void readStudioServiceToken(port).then((token) => {
                            clearTimeout(timeout);
                            settle(
                                token !== undefined
                                    ? {
                                          endpoint: `ws://127.0.0.1:${port}`,
                                          token,
                                      }
                                    : undefined,
                            );
                        });
                        return;
                    }
                } catch {
                    // Not the JSON port line — keep scanning.
                }
            }
        });
    });
}

/** Acquire the per-workspace launch lock, reclaiming a stale one. */
async function acquireLock(workspaceKey: string): Promise<boolean> {
    const file = lockPath(workspaceKey);
    await fs.mkdir(STUDIO_DIR, { recursive: true });
    try {
        const handle = await fs.open(file, "wx");
        await handle.writeFile(
            JSON.stringify({ pid: process.pid, at: Date.now() }),
        );
        await handle.close();
        return true;
    } catch {
        // Lock exists — reclaim it if stale (a crashed launcher).
        try {
            const stat = await fs.stat(file);
            if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                await fs.rm(file, { force: true });
                return acquireLock(workspaceKey);
            }
        } catch {
            // Raced away — treat as not acquired.
        }
        return false;
    }
}

async function releaseLock(workspaceKey: string): Promise<void> {
    try {
        await fs.rm(lockPath(workspaceKey), { force: true });
    } catch {
        // Non-fatal.
    }
}

/**
 * Ensure a single standalone Studio service is running for `repoRoot` and return
 * a target to connect to it (single-instance per canonical workspace):
 *
 * 1. **Attach** if one is already announced (this window, another window, or a
 *    `typeagent-studio serve` CLI).
 * 2. Otherwise take a per-workspace launch lock and **spawn** one, waiting for
 *    it to announce. A peer that lost the lock race instead waits for the
 *    winner's service.
 *
 * Returns `undefined` when no service could be reached (agent-server down, or
 * the spawn didn't announce in time) — the caller surfaces a retry/CLI hint.
 */
export async function ensureStudioService(
    repoRoot: string,
    options: { agentServerUrl?: string } = {},
): Promise<ServiceTarget | undefined> {
    const key = studioWorkspaceKey(repoRoot);
    const agentServerUrl = options.agentServerUrl;

    // 1. Attach to an already-running service.
    const existing = await lookupStudioService(
        key,
        agentServerUrl !== undefined ? { agentServerUrl } : {},
    );
    if (existing !== null) {
        return toTarget(existing);
    }

    // 2. Launch under a per-workspace lock (else wait for the winner).
    const owned = await acquireLock(key);
    if (!owned) {
        return waitForService(key, agentServerUrl, ANNOUNCE_TIMEOUT_MS);
    }
    try {
        const spawned = await spawnService(repoRoot);
        if (spawned !== undefined) {
            return spawned;
        }
        // Fallback: the child may still announce via the registry shortly.
        return await waitForService(key, agentServerUrl, ANNOUNCE_TIMEOUT_MS);
    } finally {
        await releaseLock(key);
    }
}
