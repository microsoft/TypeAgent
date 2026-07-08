// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wire types for the Studio service **registry** — the relay by which a
 * standalone, per-workspace Studio service is made discoverable.
 *
 * Discovery split: the
 * agent-server's port registrar is read-only (`discoverPort` looks up a port,
 * there is no external `registerPort`), and the extension/CLI — not the agent —
 * spawns the service, so the agent cannot learn the service's `{port, token}`
 * the montage/markdown way (where the agent spawns its own child). Instead the
 * `studio` agent hosts this tiny registry endpoint (registered under the
 * {@link STUDIO_REGISTRY_ROLE} role so the registrar makes it discoverable); a
 * service {@link StudioRegistryInvokeFunctions.announce}s itself on start, and
 * the agent proxy and any extra extension window
 * {@link StudioRegistryInvokeFunctions.lookup} it. The agent ties each
 * announced entry to its announcing socket and evicts it on disconnect, so
 * liveness is socket-based (no stale-file / PID-reuse guessing).
 *
 * These are **pure data / function-map types** with no transport dependency:
 * `@typeagent/core` must not depend on `agent-rpc`. The server and client pair
 * these with `createRpc` separately.
 */

/** Bumped on any incompatible change to {@link StudioServiceEntry} / the RPC. */
export const STUDIO_REGISTRY_PROTOCOL_VERSION = 1;

/**
 * The role under which the `studio` agent registers its registry endpoint with
 * the agent-server port registrar, so a service/extension can
 * `discoverPort("studio", STUDIO_REGISTRY_ROLE)` to find it. Distinct from the
 * agent's default role so it never collides with a (future) directly-discovered
 * service port.
 */
export const STUDIO_REGISTRY_ROLE = "registry";

/** A live standalone Studio service, as announced to / returned by the registry. */
export interface StudioServiceEntry {
    /** Canonical workspace key ({@link studioWorkspaceKey}) this service serves. */
    workspaceKey: string;
    /** The resolved repo root, for display / sanity checks. */
    repoRoot: string;
    /** The service's loopback WebSocket port. */
    port: number;
    /** Capability token a client must present (`Authorization: Bearer`). */
    token: string;
    /** OS pid of the service process (diagnostics; not used for liveness). */
    pid: number;
    /** Registry protocol version the service speaks. */
    protocolVersion: number;
    /** Epoch ms when the service started (newest-wins on a re-announce race). */
    startedAt: number;
}

/**
 * Registry RPC (client → the agent-hosted registry server).
 *
 * - A **service** calls {@link announce} once it has bound its port; the entry
 *   lives only as long as the announcing socket stays open.
 * - The **agent proxy** and **extra extension windows** call {@link lookup} to
 *   resolve the service for a workspace (returns `null` when none is live).
 */
export type StudioRegistryInvokeFunctions = {
    /** Register (or replace) the live service for `entry.workspaceKey`. */
    announce(entry: StudioServiceEntry): Promise<void>;
    /** The live service for `workspaceKey`, or `null` when none is announced. */
    lookup(workspaceKey: string): Promise<StudioServiceEntry | null>;
};
