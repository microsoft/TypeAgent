// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionContext } from "@typeagent/agent-sdk";
import registerDebug from "debug";
import {
    resolveRepoRoot,
    studioWorkspaceKey,
    STUDIO_REGISTRY_ROLE,
    type StudioServiceEntry,
} from "@typeagent/core/runtime";
import {
    StudioRegistryServer,
    resolveStudioRepoRootCandidates,
} from "studio-service";

const debug = registerDebug("typeagent:studio:lifecycle");

/**
 * Per-session agent context for the `studio` agent. The agent no longer hosts
 * the Studio runtime — it hosts a tiny shared **registry** (module-scoped
 * below) through which the standalone, per-workspace Studio service (launched by
 * the extension / `typeagent-studio serve`) announces itself, and the agent's
 * read-only actions proxy to it. Each session keeps its own port registration
 * so the registry stays discoverable while ≥1 session has the agent enabled —
 * mirroring the `code` agent's lifecycle.
 */
export interface StudioActionContext {
    enabled: Set<string>;
    portRegistration?: { release(): void } | undefined;
}

// Shared, ref-counted registry server (one per agent-server process), registered
// under the `registry` role so a service/extension can discover it.
let sharedRegistry: StudioRegistryServer | undefined;
let sharedStarting: Promise<StudioRegistryServer> | undefined;
let sharedClosing: Promise<void> | undefined;
let sharedRefCount = 0;

// Sessions that currently have the studio agent enabled and registered the
// shared registry port. Insertion order designates a "primary" session: because
// every session is registered to the SAME physical server, `@system ports` sums
// the per-session counts, so only the primary reports the real (global) count
// and the rest report 0 to avoid double-counting (mirrors the `code` agent).
const sharedActiveSessions = new Set<SessionContext<StudioActionContext>>();

/** `STUDIO_REGISTRY_PORT` pins the port (debugging); otherwise OS-assigned. */
function getRegistryBindPort(): number {
    const raw = process.env["STUDIO_REGISTRY_PORT"];
    if (raw === undefined) return 0;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`Invalid STUDIO_REGISTRY_PORT: ${raw}`);
    }
    return n;
}

async function ensureSharedRegistry(): Promise<StudioRegistryServer> {
    if (sharedClosing !== undefined) {
        await sharedClosing;
    }
    if (sharedRegistry !== undefined) {
        return sharedRegistry;
    }
    if (sharedStarting !== undefined) {
        return sharedStarting;
    }
    sharedStarting = (async () => {
        try {
            const server = await StudioRegistryServer.start(
                getRegistryBindPort(),
            );
            // Fan out connection-count updates to active sessions. Attribute the
            // global count to the primary session (first in insertion order) and
            // 0 to the rest so `@system ports` summing doesn't double-count the
            // shared physical server.
            server.onClientCountChanged = (count: number) => {
                const primary = sharedActiveSessions.values().next().value;
                for (const sc of sharedActiveSessions) {
                    void sc.notifyClientCountChanged(
                        "default",
                        sc === primary ? count : 0,
                    );
                }
            };
            sharedRegistry = server;
            return server;
        } finally {
            sharedStarting = undefined;
        }
    })();
    return sharedStarting;
}

/** The bound port of the shared registry server, if running. */
export function getSharedStudioPort(): number | undefined {
    return sharedRegistry?.port;
}

/**
 * Resolve the live standalone Studio service for `repoRoot` (or the agent's
 * default workspace) via the in-process registry. Returns `undefined` when no
 * service has announced itself — the action surface then reports an honest
 * "not running" rather than guessing. Falls back to the sole live service when
 * exactly one is announced (the common single-workspace case where the agent's
 * resolved root may not match the service's byte-for-byte).
 */
export function lookupStudioServiceEntry(
    repoRoot?: string,
): StudioServiceEntry | undefined {
    if (sharedRegistry === undefined) {
        return undefined;
    }
    const root =
        repoRoot !== undefined && repoRoot.trim().length > 0
            ? repoRoot
            : resolveRepoRoot(resolveStudioRepoRootCandidates(), process.cwd())
                  .repoRoot;
    const exact = sharedRegistry.lookup(studioWorkspaceKey(root));
    if (exact !== undefined) {
        return exact;
    }
    const all = sharedRegistry.list();
    return all.length === 1 ? all[0] : undefined;
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
            const server = await ensureSharedRegistry();
            if (isFirstSchemaForSession) {
                // Per-session registration under the `registry` role: the
                // PortRegistrar allows multiple entries across sessions and
                // lookup returns the most recent, so each active session keeps
                // the shared registry discoverable. closeStudioContext releases
                // ours if disable is skipped.
                agentContext.portRegistration = context.registerPort(
                    STUDIO_REGISTRY_ROLE,
                    server.port,
                );
                sharedRefCount++;
                sharedActiveSessions.add(context);
                // Publish the current (global) count to the primary session and
                // 0 to others so `@system ports` summing doesn't double-count.
                const primary = sharedActiveSessions.values().next().value;
                void context.notifyClientCountChanged(
                    "default",
                    context === primary ? server.getConnectedCount() : 0,
                );
                debug(
                    `studio registry registered on port ${server.port} (refs=${sharedRefCount})`,
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
    if (sharedRefCount === 0 && sharedRegistry !== undefined) {
        const server = sharedRegistry;
        sharedRegistry = undefined;
        sharedClosing = server.close().finally(() => {
            sharedClosing = undefined;
        });
        await sharedClosing;
        debug("studio registry stopped (no sessions remaining)");
    } else if (wasPrimary && sharedRegistry !== undefined) {
        // Primary session went away — transfer the (global) count to the new
        // primary so `@system ports` keeps reporting the real number, not 0.
        const newPrimary = sharedActiveSessions.values().next().value;
        if (newPrimary) {
            void newPrimary.notifyClientCountChanged(
                "default",
                sharedRegistry.getConnectedCount(),
            );
        }
    }
}
