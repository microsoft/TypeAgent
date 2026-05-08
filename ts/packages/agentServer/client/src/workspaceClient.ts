// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    globalRegistry,
    isRegistryEnabled,
    Namespaces,
} from "@typeagent/port-registry";
import { ensureAgentServer, isServerRunning } from "./agentServerClient.js";

const debug = registerDebug("typeagent:agent-server-client:workspace");

/** Default port used when the registry is disabled (legacy behavior). */
export const DEFAULT_AGENT_SERVER_PORT = 8999;

/** Default workspace key for clients that do not have a real workspace concept. */
export const DEFAULT_WORKSPACE_KEY = "default";

export interface EnsureAgentServerOptions {
    /**
     * Opaque key identifying the workspace (e.g. hashed VS Code workspace
     * path). Defaults to "default" — preserves today's single-server
     * behavior. Used for registry-based discovery only when the registry
     * is enabled (TYPEAGENT_USE_PORT_REGISTRY=1).
     */
    workspaceKey?: string;
    /**
     * Port to use when the registry is **disabled** (legacy fallback).
     * Defaults to {@link DEFAULT_AGENT_SERVER_PORT} (8999). Ignored when
     * the registry is enabled — the registry assigns the port instead.
     */
    legacyPort?: number;
    hidden?: boolean;
    idleTimeout?: number;
}

export interface AgentServerHandle {
    /** Port the server listens on. */
    port: number;
    /** WebSocket URL — `ws://localhost:${port}`. */
    url: string;
    /** Opaque slot id from the port registry, or undefined when registry disabled. */
    slotId?: string;
}

/**
 * Workspace-aware variant of `ensureAgentServer`.
 *
 * - When `TYPEAGENT_USE_PORT_REGISTRY` is **off**, behaves exactly like
 *   `ensureAgentServer(DEFAULT_AGENT_SERVER_PORT)` and returns the
 *   default port. The `workspaceKey` is ignored. This is the safe
 *   fallback path used by default.
 *
 * - When the flag is **on**, looks up `(agentServer, workspaceKey)` in
 *   the registry. If a live slot already exists, returns its port
 *   without spawning. Otherwise allocates a fresh port, spawns the
 *   server bound to that port (passing `--workspace <key>`), and waits
 *   for it to come up.
 */
export async function ensureAgentServerForWorkspace(
    options: EnsureAgentServerOptions = {},
): Promise<AgentServerHandle> {
    const hidden = options.hidden ?? false;
    const idleTimeout = options.idleTimeout ?? 0;
    const workspaceKey = options.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
    const legacyPort = options.legacyPort ?? DEFAULT_AGENT_SERVER_PORT;

    if (!isRegistryEnabled()) {
        debug(`registry disabled — using port ${legacyPort}`);
        await ensureAgentServer(legacyPort, hidden, idleTimeout);
        return {
            port: legacyPort,
            url: `ws://localhost:${legacyPort}`,
        };
    }

    // Registry-enabled path.
    const existing = await globalRegistry.lookup(
        Namespaces.AgentServer,
        workspaceKey,
    );
    if (existing.ports !== null && existing.ports.length > 0) {
        const port = existing.ports[0]!;
        const url = `ws://localhost:${port}`;
        if (await isServerRunning(url)) {
            debug(
                `existing server for workspace=${workspaceKey} on port ${port}`,
            );
            return existing.slotId
                ? { port, url, slotId: existing.slotId }
                : { port, url };
        }
        // Stale registry entry — release and re-allocate.
        debug(
            `stale registry entry for workspace=${workspaceKey} (slot=${existing.slotId}); releasing`,
        );
        if (existing.slotId) {
            await globalRegistry.release(existing.slotId).catch(() => {});
        }
    }

    const allocated = await globalRegistry.allocate(Namespaces.AgentServer, {
        count: 1,
        key: workspaceKey,
    });
    const port = allocated.ports[0]!;
    debug(
        `allocated port ${port} for workspace=${workspaceKey} slot=${allocated.slotId}`,
    );

    // Reuse the existing ensureAgentServer to spawn on the allocated port.
    // The spawned child inherits TYPEAGENT_USE_PORT_REGISTRY and the
    // workspace key via env so it can self-identify in logs.
    const prevWorkspace = process.env.TYPEAGENT_AGENT_SERVER_WORKSPACE;
    process.env.TYPEAGENT_AGENT_SERVER_WORKSPACE = workspaceKey;
    try {
        await ensureAgentServer(port, hidden, idleTimeout);
    } finally {
        if (prevWorkspace === undefined) {
            delete process.env.TYPEAGENT_AGENT_SERVER_WORKSPACE;
        } else {
            process.env.TYPEAGENT_AGENT_SERVER_WORKSPACE = prevWorkspace;
        }
    }

    return {
        port,
        url: `ws://localhost:${port}`,
        slotId: allocated.slotId,
    };
}

/**
 * Resolve the URL of the agent server for a given workspace without
 * spawning it. Returns `undefined` if no server is registered.
 */
export async function lookupAgentServerForWorkspace(
    workspaceKey: string = DEFAULT_WORKSPACE_KEY,
): Promise<AgentServerHandle | undefined> {
    if (!isRegistryEnabled()) {
        const url = `ws://localhost:${DEFAULT_AGENT_SERVER_PORT}`;
        return (await isServerRunning(url))
            ? { port: DEFAULT_AGENT_SERVER_PORT, url }
            : undefined;
    }
    const result = await globalRegistry.lookup(
        Namespaces.AgentServer,
        workspaceKey,
    );
    if (result.ports === null || result.ports.length === 0) return undefined;
    const port = result.ports[0]!;
    return result.slotId
        ? { port, url: `ws://localhost:${port}`, slotId: result.slotId }
        : { port, url: `ws://localhost:${port}` };
}
