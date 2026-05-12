// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import registerDebug from "debug";

const debug = registerDebug("typeagent:dispatcher:portRegistrar");
const debugWarn = registerDebug("typeagent:dispatcher:portRegistrar:warn");

/**
 * Opaque identifier returned from {@link PortRegistrar.register}. Pass it
 * back to {@link PortRegistrar.release} to remove a single allocation.
 */
export type RegistrationId = string;

/**
 * One port advertised by an agent. The triple (`agentName`, `role`,
 * `sessionContextId`) uniquely identifies an allocation; calling
 * {@link PortRegistrar.register} a second time with the same triple
 * updates the port in place and returns the same {@link RegistrationId}.
 */
export type Allocation = {
    readonly agentName: string;
    readonly role: string;
    readonly sessionContextId: string;
    port: number;
};

/**
 * Conventional role used by the back-compat
 * `sessionContext.setLocalHostPort` / `getSharedLocalHostPort` shims so
 * that the legacy "one port per agent" callers (`montage`, `markdown`,
 * `browser`) keep working through the new registrar without changes.
 */
export const DEFAULT_ROLE = "default";

/**
 * In-memory port registry. Agents bind on `port=0`, the OS picks a free
 * port, and the agent registers the resulting port here so other
 * components (and out-of-process clients via the agentServer discovery
 * channel) can look it up.
 *
 * Lifetime: one instance per dispatcher (i.e. per agentServer process,
 * per shell, etc.). Not persisted across restarts — agents re-bind and
 * re-register on each run.
 *
 * Thread-safety: Node single-threaded; the registrar is mutated only on
 * the event-loop thread. No locking required.
 */
export class PortRegistrar {
    /** All live allocations, keyed by their opaque registration id. */
    private readonly allocations = new Map<RegistrationId, Allocation>();

    /**
     * Index from `(agentName, role, sessionContextId)` triple to its
     * registration id, so re-registration is O(1) and idempotent.
     */
    private readonly tripleIndex = new Map<string, RegistrationId>();

    /**
     * Optional self-port used by the SDK guard to flag agents that
     * accidentally hard-coded the agentServer's own port. Set by the
     * agent-server entry point; absent in non-server hosts.
     */
    private agentServerPort: number | undefined;

    /** Register the agentServer's own listen port for the SDK guard. */
    public setAgentServerPort(port: number | undefined): void {
        this.agentServerPort = port;
    }

    public getAgentServerPort(): number | undefined {
        return this.agentServerPort;
    }

    /**
     * Record a port that an agent has just bound. Idempotent on the
     * `(agentName, role, sessionContextId)` triple: a second call with
     * the same triple updates the stored port and returns the original
     * {@link RegistrationId}.
     *
     * Validates the input but does not throw on suspicious values:
     * `port < 1024` and `port === agentServerPort` log a warning under
     * the `typeagent:dispatcher:portRegistrar:warn` debug namespace and
     * still register, on the assumption that the agent is already bound
     * and refusing to record the port would just hide the listener from
     * lookups.
     */
    public register(
        agentName: string,
        role: string,
        port: number,
        sessionContextId: string,
    ): RegistrationId {
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error(
                `Invalid port for ${agentName}/${role}: ${port} (must be an integer in [0, 65535])`,
            );
        }
        if (port === 0) {
            throw new Error(
                `Refusing to register port 0 for ${agentName}/${role} — pass the OS-assigned port returned by the bound listener, not the bind hint`,
            );
        }
        if (port < 1024) {
            debugWarn(
                `${agentName}/${role} registered well-known/privileged port ${port}; consider passing 0 to bind so the OS picks a free ephemeral port`,
            );
        }
        if (
            this.agentServerPort !== undefined &&
            port === this.agentServerPort
        ) {
            debugWarn(
                `${agentName}/${role} registered the agentServer's own port ${port}; this is almost certainly a hard-coded mistake — pass 0 to bind`,
            );
        }

        const tripleKey = this.makeTripleKey(
            agentName,
            role,
            sessionContextId,
        );
        const existing = this.tripleIndex.get(tripleKey);
        if (existing !== undefined) {
            const allocation = this.allocations.get(existing);
            if (allocation !== undefined) {
                debug(
                    `re-register ${agentName}/${role} session=${sessionContextId} port=${allocation.port}->${port} regId=${existing}`,
                );
                allocation.port = port;
                return existing;
            }
            // Index entry was stale; fall through to fresh insert.
            this.tripleIndex.delete(tripleKey);
        }

        const regId = randomUUID();
        this.allocations.set(regId, {
            agentName,
            role,
            sessionContextId,
            port,
        });
        this.tripleIndex.set(tripleKey, regId);
        debug(
            `register ${agentName}/${role} session=${sessionContextId} port=${port} regId=${regId}`,
        );
        return regId;
    }

    /**
     * Remove a single allocation by its registration id. Idempotent: a
     * release of an unknown id is a no-op.
     */
    public release(regId: RegistrationId): void {
        const allocation = this.allocations.get(regId);
        if (allocation === undefined) {
            return;
        }
        this.allocations.delete(regId);
        this.tripleIndex.delete(
            this.makeTripleKey(
                allocation.agentName,
                allocation.role,
                allocation.sessionContextId,
            ),
        );
        debug(
            `release ${allocation.agentName}/${allocation.role} session=${allocation.sessionContextId} port=${allocation.port} regId=${regId}`,
        );
    }

    /**
     * Backstop for forgotten releases: remove every allocation whose
     * `sessionContextId` matches. Called from the dispatcher's
     * `closeSessionContext` finally block.
     *
     * Returns the number of allocations released.
     */
    public releaseAllForSession(sessionContextId: string): number {
        const toRelease: RegistrationId[] = [];
        for (const [regId, allocation] of this.allocations) {
            if (allocation.sessionContextId === sessionContextId) {
                toRelease.push(regId);
            }
        }
        for (const regId of toRelease) {
            this.release(regId);
        }
        if (toRelease.length > 0) {
            debug(
                `releaseAllForSession session=${sessionContextId} released=${toRelease.length}`,
            );
        }
        return toRelease.length;
    }

    /**
     * Look up the most recently registered port for `(agentName, role)`
     * across all sessions, or `undefined` if no live allocation matches.
     *
     * Most-recent semantics: when several sessions have registered the
     * same `(agentName, role)` (e.g. multiple shells against the same
     * agentServer), the latest registration wins. This matches the
     * pre-existing `setLocalHostPort` "last writer wins" behavior for
     * the `default` role.
     *
     * No permission check here — callers that need one (e.g. the
     * cross-agent `getSharedLocalHostPort` shim, gated by
     * `manifest.sharedLocalView`) layer it on top.
     */
    public lookup(agentName: string, role: string): number | undefined {
        // Walk in insertion order; randomUUID-keyed Map iteration order in
        // V8 is insertion-order-stable, so the last matching entry is the
        // most recent registration.
        let port: number | undefined;
        for (const allocation of this.allocations.values()) {
            if (
                allocation.agentName === agentName &&
                allocation.role === role
            ) {
                port = allocation.port;
            }
        }
        return port;
    }

    /**
     * True if any allocation is currently live. Used by the agentServer
     * idle-shutdown timer so a server with active out-of-process clients
     * (Chrome ext, VS Code ext, etc.) doesn't shut down on the
     * "no-conversation-clients" timer alone.
     */
    public hasActiveAllocations(): boolean {
        return this.allocations.size > 0;
    }

    /**
     * Snapshot of all live allocations. Intended for diagnostics and
     * tests — not the discovery hot path.
     */
    public list(): readonly Allocation[] {
        return Array.from(this.allocations.values()).map((a) => ({ ...a }));
    }

    private makeTripleKey(
        agentName: string,
        role: string,
        sessionContextId: string,
    ): string {
        // Use a delimiter that can't appear in any of the three fields —
        // agent names and role names are TS identifiers / bare words, and
        // sessionContextId is a UUID, so `\u0000` is unambiguously safe.
        return `${agentName}\u0000${role}\u0000${sessionContextId}`;
    }
}
