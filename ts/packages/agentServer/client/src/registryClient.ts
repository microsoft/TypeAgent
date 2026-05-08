// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    globalRegistry,
    isRegistryEnabled,
    Namespaces,
} from "@typeagent/port-registry";
import { ensureAgentServer, isServerRunning } from "./agentServerClient.js";

const debug = registerDebug("typeagent:agent-server-client:registry");

/** Default port used when the registry is disabled (legacy behavior). */
export const DEFAULT_AGENT_SERVER_PORT = 8999;

// Single fixed registry key for the AgentServer slot. The registry layer
// supports keyed lookups (`(namespace, key) → slot`) as a generic
// primitive, but the agent server is currently a single-instance process
// (one global instanceDir, exclusive lock), so we always store it under a
// single shared key. Per-workspace agent servers are a future direction
// that will require per-workspace `instanceDir` support before the public
// API can grow a workspace parameter again.
const AGENT_SERVER_REGISTRY_KEY = "default";

export interface EnsureAgentServerOptions {
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
 * Registry-aware variant of `ensureAgentServer`.
 *
 * - When `TYPEAGENT_USE_PORT_REGISTRY` is **off**, behaves exactly like
 *   `ensureAgentServer(legacyPort)` and returns that port. This is the
 *   safe fallback path used by default.
 *
 * - When the flag is **on**, looks up the agent-server slot in the
 *   registry. If a live slot already exists, returns its port without
 *   spawning. Otherwise allocates a fresh port via the registry, spawns
 *   the server bound to that port, and waits for it to come up.
 */
export async function ensureAgentServerViaRegistry(
    options: EnsureAgentServerOptions = {},
): Promise<AgentServerHandle> {
    const hidden = options.hidden ?? false;
    const idleTimeout = options.idleTimeout ?? 0;
    const legacyPort = options.legacyPort ?? DEFAULT_AGENT_SERVER_PORT;

    if (!isRegistryEnabled()) {
        debug(`registry disabled — using port ${legacyPort}`);
        await ensureAgentServer(legacyPort, hidden, idleTimeout);
        return {
            port: legacyPort,
            url: `ws://localhost:${legacyPort}`,
        };
    }

    // This call site may spawn a local agent server, so it owns one
    // (transitively) — opt this process into being a registry host.
    // Idempotent; no-op once another registry call has already run.
    globalRegistry.enableServerMode();

    // Registry-enabled path.
    const existing = await globalRegistry.lookup(
        Namespaces.AgentServer,
        AGENT_SERVER_REGISTRY_KEY,
    );
    if (existing.ports !== null && existing.ports.length > 0) {
        const port = existing.ports[0]!;
        const url = `ws://localhost:${port}`;
        if (await isServerRunning(url)) {
            debug(`existing server on port ${port}`);
            return existing.slotId
                ? { port, url, slotId: existing.slotId }
                : { port, url };
        }
        // Stale registry entry — release and re-allocate.
        debug(`stale registry entry (slot=${existing.slotId}); releasing`);
        if (existing.slotId) {
            await globalRegistry.release(existing.slotId).catch(() => {});
        }
    }

    const allocated = await globalRegistry.allocate(Namespaces.AgentServer, {
        count: 1,
        key: AGENT_SERVER_REGISTRY_KEY,
    });
    const port = allocated.ports[0]!;
    debug(`allocated port ${port} slot=${allocated.slotId}`);

    await ensureAgentServer(port, hidden, idleTimeout);

    return {
        port,
        url: `ws://localhost:${port}`,
        slotId: allocated.slotId,
    };
}

/**
 * Resolve the URL of the registered agent server without spawning it.
 * Returns `undefined` if no server is registered (registry on) or
 * reachable on the legacy port (registry off).
 */
export async function lookupAgentServerViaRegistry(): Promise<
    AgentServerHandle | undefined
> {
    if (!isRegistryEnabled()) {
        const url = `ws://localhost:${DEFAULT_AGENT_SERVER_PORT}`;
        return (await isServerRunning(url))
            ? { port: DEFAULT_AGENT_SERVER_PORT, url }
            : undefined;
    }
    const result = await globalRegistry.lookup(
        Namespaces.AgentServer,
        AGENT_SERVER_REGISTRY_KEY,
    );
    if (result.ports === null || result.ports.length === 0) return undefined;
    const port = result.ports[0]!;
    return result.slotId
        ? { port, url: `ws://localhost:${port}`, slotId: result.slotId }
        : { port, url: `ws://localhost:${port}` };
}
