#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * `typeagent-studio serve` — launch a standalone, per-workspace Studio service.
 *
 * The workspace is taken from `--workspace <root>` (or `TYPEAGENT_STUDIO_REPO_ROOT`
 * / cwd); the bound port is printed as one JSON line on stdout so a launcher (the
 * extension) can capture it. The capability token is published to the per-port
 * token file under `~/.typeagent/studio/`.
 */

import { startStudioService } from "./studioService.js";
import { announceStudioService } from "./studioRegistry.js";
import { STUDIO_REGISTRY_PROTOCOL_VERSION } from "@typeagent/core/runtime";

function parseArgs(argv: string[]): { workspace?: string; port?: number } {
    const out: { workspace?: string; port?: number } = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--workspace" || arg === "-w") {
            out.workspace = argv[++i];
        } else if (arg === "--port" || arg === "-p") {
            const n = parseInt(argv[++i] ?? "", 10);
            if (Number.isFinite(n)) out.port = n;
        }
    }
    return out;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.workspace !== undefined && args.workspace.trim().length > 0) {
        // The runtime resolves the workspace from this env var (or cwd) when a
        // request omits an explicit repoRoot.
        process.env["TYPEAGENT_STUDIO_REPO_ROOT"] = args.workspace;
    }

    const handle = await startStudioService({
        ...(args.port !== undefined ? { port: args.port } : {}),
        ...(args.workspace !== undefined && args.workspace.trim().length > 0
            ? { repoRoot: args.workspace }
            : {}),
    });
    // One machine-readable line for the launcher; the token is in the token file.
    process.stdout.write(`${JSON.stringify({ port: handle.port })}\n`);

    // Announce ourselves to the `studio` agent's registry so the agent proxy
    // (and any extra extension window) can discover this workspace's service.
    // Best-effort + self-retrying: a not-yet-running agent doesn't block start.
    const announcement = await announceStudioService({
        workspaceKey: handle.workspaceKey,
        repoRoot: handle.repoRoot,
        port: handle.port,
        token: handle.token,
        pid: process.pid,
        protocolVersion: STUDIO_REGISTRY_PROTOCOL_VERSION,
        startedAt: Date.now(),
    });

    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        announcement.close();
        void handle.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
