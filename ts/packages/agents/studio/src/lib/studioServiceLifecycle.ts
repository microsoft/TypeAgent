// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionContext } from "@typeagent/agent-sdk";
import registerDebug from "debug";
import { StudioServiceServer } from "./studioServiceServer.js";
import { getStudioRuntime } from "./runtime.js";

const debug = registerDebug("typeagent:studio:lifecycle");

/**
 * Per-session agent context for the `studio` agent. The Studio service is a
 * single shared WebSocket server (module-scoped below); each session keeps its
 * own port registration so the port stays discoverable while ≥1 session has the
 * agent enabled — mirroring the `code` agent's lifecycle.
 */
export interface StudioActionContext {
    enabled: Set<string>;
    portRegistration?: { release(): void } | undefined;
}

// Shared, ref-counted WebSocket server (one per agent-server process). The
// server resolves the per-workspace runtime per request via getStudioRuntime,
// so a single shared server + port serves every repo (requests are repo-scoped).
let sharedServer: StudioServiceServer | undefined;
let sharedStarting: Promise<StudioServiceServer> | undefined;
let sharedClosing: Promise<void> | undefined;
let sharedRefCount = 0;

// Sessions that currently have the studio agent enabled and registered the
// shared port. Insertion order designates a "primary" session: because every
// session is registered to the SAME physical server, `@system ports` sums the
// per-session counts, so only the primary reports the real (global) client
// count and the rest report 0 to avoid double-counting (mirrors the `code`
// agent).
const sharedActiveSessions = new Set<SessionContext<StudioActionContext>>();

/** `STUDIO_WEBSOCKET_PORT` pins the port (debugging); otherwise OS-assigned. */
function getStudioBindPort(): number {
    const raw = process.env["STUDIO_WEBSOCKET_PORT"];
    if (raw === undefined) return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid STUDIO_WEBSOCKET_PORT: ${raw}`);
    }
    return n;
}

async function ensureSharedServer(): Promise<StudioServiceServer> {
    if (sharedClosing !== undefined) {
        await sharedClosing;
    }
    if (sharedServer !== undefined) {
        return sharedServer;
    }
    if (sharedStarting !== undefined) {
        return sharedStarting;
    }
    sharedStarting = (async () => {
        try {
            const server = await StudioServiceServer.start(
                (repoRoot) => getStudioRuntime(repoRoot),
                getStudioBindPort(),
            );
            // Fan out client-count updates to active sessions. Attribute the
            // global count to the primary session (first in insertion order)
            // and 0 to the rest so `@system ports` summing doesn't
            // double-count the shared physical server.
            server.onClientCountChanged = (count: number) => {
                const primary = sharedActiveSessions.values().next().value;
                for (const sc of sharedActiveSessions) {
                    void sc.notifyClientCountChanged(
                        "default",
                        sc === primary ? count : 0,
                    );
                }
            };
            sharedServer = server;
            return server;
        } finally {
            sharedStarting = undefined;
        }
    })();
    return sharedStarting;
}

/** The bound port of the shared Studio service server, if running. */
export function getSharedStudioPort(): number | undefined {
    return sharedServer?.port;
}

export async function initializeStudioContext(): Promise<StudioActionContext> {
    return { enabled: new Set() };
}

export async function updateStudioContext(
    enable: boolean,
    context: SessionContext<StudioActionContext>,
    schemaName: string,
): Promise<void> {
    const agentContext = context.agentContext;
    if (enable) {
        if (agentContext.enabled.has(schemaName)) {
            return;
        }
        const isFirstSchemaForSession = agentContext.enabled.size === 0;
        agentContext.enabled.add(schemaName);
        try {
            const server = await ensureSharedServer();
            if (isFirstSchemaForSession) {
                // Per-session registration: PortRegistrar allows multiple
                // entries for (studio, default) across sessions and lookup
                // returns the most recent, so each active session keeps the
                // shared port discoverable. closeStudioContext releases ours
                // if disable is skipped.
                agentContext.portRegistration = context.registerPort(
                    "default",
                    server.port,
                );
                sharedRefCount++;
                sharedActiveSessions.add(context);
                // Publish the current (global) count to the primary session
                // (first in insertion order) and 0 to others so `@system
                // ports` summing doesn't double-count. A newly-primary session
                // gets the real count; otherwise it reports 0 and future
                // onClientCountChanged fanouts keep it at 0.
                const primary = sharedActiveSessions.values().next().value;
                void context.notifyClientCountChanged(
                    "default",
                    context === primary ? server.getConnectedCount() : 0,
                );
                debug(
                    `studio service registered on port ${server.port} (refs=${sharedRefCount})`,
                );
            }
        } catch (e) {
            agentContext.enabled.delete(schemaName);
            throw e;
        }
    } else {
        if (!agentContext.enabled.has(schemaName)) {
            return;
        }
        agentContext.enabled.delete(schemaName);
        if (agentContext.enabled.size === 0) {
            await releaseSession(context);
        }
    }
}

export async function closeStudioContext(
    context: SessionContext<StudioActionContext>,
): Promise<void> {
    // Backstop: release this session's registration/ref even if the disable
    // path was skipped.
    const agentContext = context.agentContext;
    agentContext.enabled.clear();
    await releaseSession(context);
}

async function releaseSession(
    context: SessionContext<StudioActionContext>,
): Promise<void> {
    const agentContext = context.agentContext;
    if (agentContext.portRegistration === undefined) {
        return;
    }
    agentContext.portRegistration.release();
    agentContext.portRegistration = undefined;
    const wasPrimary = sharedActiveSessions.values().next().value === context;
    sharedActiveSessions.delete(context);
    sharedRefCount = Math.max(0, sharedRefCount - 1);
    if (sharedRefCount === 0 && sharedServer !== undefined) {
        const server = sharedServer;
        sharedServer = undefined;
        sharedClosing = server.close().finally(() => {
            sharedClosing = undefined;
        });
        await sharedClosing;
        debug("studio service stopped (no sessions remaining)");
    } else if (wasPrimary && sharedServer !== undefined) {
        // Primary session went away — transfer the (global) count to the new
        // primary so `@system ports` keeps reporting the real number, not 0.
        const newPrimary = sharedActiveSessions.values().next().value;
        if (newPrimary) {
            void newPrimary.notifyClientCountChanged(
                "default",
                sharedServer.getConnectedCount(),
            );
        }
    }
}
