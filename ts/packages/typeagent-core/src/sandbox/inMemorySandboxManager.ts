// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    EventEmitterLike,
} from "../events/eventStream.js";
import {
    EVENT_SCHEMA_VERSION,
    type SandboxLifecycleEvent,
    type SandboxState,
} from "../events/types.js";
import {
    SandboxAlreadyExistsError,
    UnknownSandboxError,
    UnsupportedSandboxModeError,
    type AgentLoader,
    type SandboxAgentInfo,
    type SandboxConfig,
    type SandboxHandle,
    type SandboxManager,
    type SandboxStatus,
} from "./types.js";

export interface InMemorySandboxManagerOptions {
    /** Event sink for sandbox lifecycle events. */
    emitter: EventEmitterLike;
    /** Resolve an agent reference to its metadata. Defaults to a stub loader. */
    agentLoader?: AgentLoader;
    /** Override clock; primarily for tests. */
    now?: () => number;
}

interface InternalSandbox {
    config: SandboxConfig;
    state: SandboxState;
    agents: Map<string, SandboxAgentInfo>;
    startedAt?: number;
}

/**
 * Default loader: derives a placeholder agent record from the reference
 * string. Real dispatcher integration replaces this in a later chunk.
 */
const defaultAgentLoader: AgentLoader = async (_sandboxId, agentRef) => {
    const name = deriveAgentName(agentRef);
    return {
        name,
        schemaHash: "stub",
        grammarHash: "stub",
        health: "unknown",
        sourcePath: agentRef,
    };
};

function deriveAgentName(agentRef: string): string {
    const normalized = agentRef.replace(/\\/g, "/");
    const tail = normalized.split("/").pop() ?? agentRef;
    return tail.replace(/\.[^.]+$/, "") || agentRef;
}

/**
 * In-memory implementation of `SandboxManager`.
 *
 * Manages sandbox bookkeeping and emits lifecycle events. Agent loading is
 * delegated to an `AgentLoader` so the dispatcher integration can land
 * independently. Subprocess mode is intentionally rejected until the
 * transport stub lands.
 */
export class InMemorySandboxManager implements SandboxManager {
    private readonly sandboxes = new Map<string, InternalSandbox>();
    private readonly emitter: EventEmitterLike;
    private readonly agentLoader: AgentLoader;
    private readonly now: () => number;

    constructor(opts: InMemorySandboxManagerOptions) {
        this.emitter = opts.emitter;
        this.agentLoader = opts.agentLoader ?? defaultAgentLoader;
        this.now = opts.now ?? Date.now;
    }

    async start(cfg: SandboxConfig): Promise<SandboxHandle> {
        if (cfg.mode !== "inmemory") {
            throw new UnsupportedSandboxModeError(cfg.mode);
        }
        if (this.sandboxes.has(cfg.id)) {
            throw new SandboxAlreadyExistsError(cfg.id);
        }

        const record: InternalSandbox = {
            config: cfg,
            state: "starting",
            agents: new Map(),
        };
        this.sandboxes.set(cfg.id, record);

        try {
            for (const ref of cfg.agents) {
                await this.loadAgentInto(record, ref, /*emit*/ false);
            }
        } catch (err) {
            this.sandboxes.delete(cfg.id);
            throw err;
        }

        record.state = "running";
        record.startedAt = this.now();

        // Emit agent.loaded events for the initial set, then the sandbox.start.
        // Ordering matches the conceptual "sandbox came up with agents X, Y".
        for (const agent of record.agents.values()) {
            this.emit(cfg.id, "sandbox.agent.loaded", {
                affectedAgent: agent.name,
            });
        }
        this.emit(cfg.id, "sandbox.start", { state: "running" });

        return { id: cfg.id, mode: cfg.mode };
    }

    async restart(id: string): Promise<void> {
        const record = this.require(id);
        const initialRefs = [...record.agents.values()].map(
            (a) => a.sourcePath ?? a.name,
        );

        record.state = "stopping";
        for (const agent of record.agents.values()) {
            this.emit(id, "sandbox.agent.unloaded", {
                affectedAgent: agent.name,
            });
        }
        record.agents.clear();

        record.state = "starting";
        try {
            for (const ref of initialRefs) {
                await this.loadAgentInto(record, ref, /*emit*/ false);
            }
        } catch (err) {
            record.state = "crashed";
            throw err;
        }
        record.state = "running";
        record.startedAt = this.now();

        for (const agent of record.agents.values()) {
            this.emit(id, "sandbox.agent.loaded", {
                affectedAgent: agent.name,
            });
        }
        this.emit(id, "sandbox.restart", { state: "running" });
    }

    async stop(id: string): Promise<void> {
        const record = this.require(id);
        record.state = "stopping";

        for (const agent of record.agents.values()) {
            this.emit(id, "sandbox.agent.unloaded", {
                affectedAgent: agent.name,
            });
        }
        record.agents.clear();
        record.state = "stopped";
        this.sandboxes.delete(id);
        this.emit(id, "sandbox.stop", { state: "stopped" });
    }

    async loadAgent(id: string, agentRef: string): Promise<void> {
        const record = this.require(id);
        await this.loadAgentInto(record, agentRef, /*emit*/ true);
    }

    async unloadAgent(id: string, agentName: string): Promise<void> {
        const record = this.require(id);
        if (!record.agents.has(agentName)) {
            // Unload of an unknown agent is a no-op for idempotency; the
            // alternative is throwing, which complicates UI flows that may
            // race a manual stop and an external unload signal.
            return;
        }
        record.agents.delete(agentName);
        this.emit(id, "sandbox.agent.unloaded", { affectedAgent: agentName });
    }

    async status(id: string): Promise<SandboxStatus> {
        const record = this.require(id);
        return this.toStatus(record);
    }

    async list(): Promise<SandboxStatus[]> {
        return [...this.sandboxes.values()].map((r) => this.toStatus(r));
    }

    /* ---------------------------------------------------------------- */
    /* internal                                                          */
    /* ---------------------------------------------------------------- */

    private require(id: string): InternalSandbox {
        const record = this.sandboxes.get(id);
        if (!record) {
            throw new UnknownSandboxError(id);
        }
        return record;
    }

    private async loadAgentInto(
        record: InternalSandbox,
        agentRef: string,
        emit: boolean,
    ): Promise<void> {
        const info = await this.agentLoader(record.config.id, agentRef);
        const full: SandboxAgentInfo = {
            ...info,
            loadedAt: this.now(),
        };
        record.agents.set(full.name, full);
        if (emit) {
            this.emit(record.config.id, "sandbox.agent.loaded", {
                affectedAgent: full.name,
            });
        }
    }

    private emit(
        sandboxId: string,
        type: SandboxLifecycleEvent["type"],
        extra: Partial<Pick<SandboxLifecycleEvent, "state" | "affectedAgent">>,
    ): void {
        const event: SandboxLifecycleEvent = {
            schemaVersion: EVENT_SCHEMA_VERSION,
            type,
            ts: this.now(),
            sandboxId,
            ...extra,
        };
        this.emitter.emit(event);
    }

    private toStatus(record: InternalSandbox): SandboxStatus {
        const status: SandboxStatus = {
            id: record.config.id,
            mode: record.config.mode,
            state: record.state,
            agents: [...record.agents.values()],
        };
        if (record.startedAt !== undefined) {
            status.startedAt = record.startedAt;
        }
        return status;
    }
}

export function createInMemorySandboxManager(
    opts: InMemorySandboxManagerOptions,
): InMemorySandboxManager {
    return new InMemorySandboxManager(opts);
}
