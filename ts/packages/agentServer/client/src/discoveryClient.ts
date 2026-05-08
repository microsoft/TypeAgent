// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    ensureAgentServer,
    isServerRunning,
    waitForDiscoveryFile,
} from "./agentServerClient.js";
import {
    isProcessAlive,
    readDiscoveryFile,
} from "./discovery.js";

const debug = registerDebug("typeagent:agent-server-client:discovery");

export interface EnsureAgentServerOptions {
    hidden?: boolean;
    idleTimeout?: number;
}

export interface AgentServerHandle {
    /** Port the server listens on. */
    port: number;
    /** WebSocket URL — `ws://localhost:${port}`. */
    url: string;
}

/**
 * Discovery-file-based variant of `ensureAgentServer`.
 *
 * Workflow:
 * 1. Read `~/.typeagent/agent-server.json`. If present, validate the
 *    pid is alive and the WebSocket port answers. If both, return its
 *    port without spawning.
 * 2. Otherwise spawn a new agent-server (which picks an ephemeral
 *    port and writes a fresh discovery file). The OS-level
 *    `lockInstanceDir` enforces single-instance, so concurrent
 *    callers either land on the same spawn or surface
 *    `ERR_INSTANCE_LOCKED`.
 * 3. Wait for the discovery file to appear with the spawned pid,
 *    then verify the WebSocket is reachable.
 */
export async function ensureAgentServerViaDiscovery(
    options: EnsureAgentServerOptions = {},
): Promise<AgentServerHandle> {
    const hidden = options.hidden ?? false;
    const idleTimeout = options.idleTimeout ?? 0;

    const existing = readDiscoveryFile();
    if (existing && isProcessAlive(existing.pid)) {
        const url = `ws://localhost:${existing.port}`;
        if (await isServerRunning(url)) {
            debug(
                `existing server discovered: pid=${existing.pid} port=${existing.port}`,
            );
            return { port: existing.port, url };
        }
        debug(
            `discovery file pid=${existing.pid} port=${existing.port} does not respond; respawning`,
        );
    }

    // Spawn without an explicit port — the agent-server will pick an
    // ephemeral port and publish it via the discovery file.
    await ensureAgentServer(undefined, hidden, idleTimeout);

    const record = await waitForDiscoveryFile(60000);
    const url = `ws://localhost:${record.port}`;
    return { port: record.port, url };
}

/**
 * Read-only discovery: return the running agent-server's URL if one
 * is reachable, `undefined` otherwise. Never spawns.
 */
export async function lookupAgentServerViaDiscovery(): Promise<
    AgentServerHandle | undefined
> {
    const existing = readDiscoveryFile();
    if (!existing || !isProcessAlive(existing.pid)) {
        return undefined;
    }
    const url = `ws://localhost:${existing.port}`;
    if (!(await isServerRunning(url))) {
        return undefined;
    }
    return { port: existing.port, url };
}
