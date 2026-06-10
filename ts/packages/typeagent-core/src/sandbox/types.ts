// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SandboxState } from "../events/types.js";

/**
 * F0.1 — Sandbox lifecycle type surface.
 *
 * See `docs/plans/vscode-devx/05-implementation-plan.md` §3.
 *
 * The MVP supports two execution modes:
 *  - `inmemory`: dispatcher runs in the extension host. Fast, no IPC. The
 *    initial Studio demo path.
 *  - `subprocess`: dispatcher runs in a child Node process; lands with the
 *    transport stub. Types are declared here so consumers can target both.
 */
export type SandboxMode = "subprocess" | "inmemory";

/**
 * Placeholder health type. F0.5 owns the authoritative shape; until it
 * lands, sandbox status reports a coarse literal so consumers can render
 * a badge without coupling to a not-yet-defined object.
 */
export type HealthStatus = "unknown" | "healthy" | "warning" | "error";

export interface SandboxConfig {
    /** Stable identifier per workspace. */
    id: string;
    mode: SandboxMode;
    /** Profile directory under `~/.typeagent/profiles/<studio-instance>/`. */
    profileDir: string;
    /** Initial agent set; can change at runtime via load/unloadAgent. */
    agents: string[];
    /** Environment variables (model keys etc.) injected at start. */
    env?: Record<string, string>;
    /** Sandbox-scoped telemetry opt-out; honored by F0.4. */
    telemetryOptOut?: boolean;
}

export interface SandboxAgentInfo {
    name: string;
    /** Hash of the agent's TypeScript action schema. */
    schemaHash: string;
    /** Hash of the agent's compiled grammar. */
    grammarHash: string;
    health: HealthStatus;
    /** Source path or module specifier used to load the agent. */
    sourcePath?: string;
    /** When the agent was loaded into this sandbox (epoch ms). */
    loadedAt?: number;
}

export interface SandboxStatus {
    id: string;
    mode: SandboxMode;
    state: SandboxState;
    agents: SandboxAgentInfo[];
    startedAt?: number;
    /** PID for subprocess mode; absent in inmemory mode. */
    pid?: number;
}

export interface SandboxHandle {
    readonly id: string;
    readonly mode: SandboxMode;
}

/**
 * Hook used by a sandbox manager to resolve an agent reference (file path
 * or module specifier) into the metadata it needs to track. Letting this be
 * pluggable means tests and the inmemory manager can avoid pulling in the
 * full dispatcher until later wiring chunks land.
 */
export type AgentLoader = (
    sandboxId: string,
    agentRef: string,
) => Promise<Omit<SandboxAgentInfo, "loadedAt">>;

export interface SandboxManager {
    start(cfg: SandboxConfig): Promise<SandboxHandle>;
    restart(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    loadAgent(id: string, agentRef: string): Promise<void>;
    unloadAgent(id: string, agentName: string): Promise<void>;
    status(id: string): Promise<SandboxStatus>;
    list(): Promise<SandboxStatus[]>;
}

/** Error thrown when an operation references an unknown sandbox id. */
export class UnknownSandboxError extends Error {
    constructor(public readonly sandboxId: string) {
        super(`Unknown sandbox: ${sandboxId}`);
        this.name = "UnknownSandboxError";
    }
}

/** Error thrown when start() is called twice for the same id without stop(). */
export class SandboxAlreadyExistsError extends Error {
    constructor(public readonly sandboxId: string) {
        super(`Sandbox already exists: ${sandboxId}`);
        this.name = "SandboxAlreadyExistsError";
    }
}

/** Error thrown when an unsupported mode is requested (e.g. subprocess pre-stub). */
export class UnsupportedSandboxModeError extends Error {
    constructor(public readonly mode: SandboxMode) {
        super(`Sandbox mode not yet supported: ${mode}`);
        this.name = "UnsupportedSandboxModeError";
    }
}
