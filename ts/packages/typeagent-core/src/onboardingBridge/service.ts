// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    ONBOARDING_PHASE_ORDER,
    OnboardingSessionNotFoundError,
    type OnboardingBridge,
    type OnboardingPhaseName,
    type OnboardingStartSeed,
    type OnboardingState,
    type PhaseSnapshot,
    type RestorePhaseResult,
} from "./types.js";

export interface InMemoryOnboardingBridgeOptions {
    now?: () => number;
    createSessionId?: () => string;
    phaseRunner?: (
        session: OnboardingState,
        phase: OnboardingPhaseName,
        inputs: unknown,
    ) => Promise<unknown>;
    onInstallToSandbox?: (
        session: OnboardingState,
        sandboxId: string,
    ) => Promise<void>;
}

/**
 * F1.1 backend scaffold with deterministic in-memory semantics.
 *
 * The extension host can persist snapshots externally; this core service keeps
 * policy and stale-detection behavior centralized.
 */
export class InMemoryOnboardingBridge implements OnboardingBridge {
    private readonly sessions = new Map<string, OnboardingState>();
    private readonly now: () => number;
    private readonly createSessionId: () => string;
    private readonly phaseRunner: (
        session: OnboardingState,
        phase: OnboardingPhaseName,
        inputs: unknown,
    ) => Promise<unknown>;
    private readonly onInstallToSandbox: ((
        session: OnboardingState,
        sandboxId: string,
    ) => Promise<void>) | undefined;

    constructor(opts: InMemoryOnboardingBridgeOptions = {}) {
        this.now = opts.now ?? Date.now;
        this.createSessionId =
            opts.createSessionId ??
            (() => `onb-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        this.phaseRunner =
            opts.phaseRunner ??
            (async (_session, phase, inputs) => ({
                phase,
                inputs,
                generatedAt: this.now(),
            }));
        this.onInstallToSandbox = opts.onInstallToSandbox;
    }

    async start(seed: OnboardingStartSeed): Promise<OnboardingState> {
        const sessionId = this.createSessionId();
        const agentName = seed.agentName ?? inferAgentName(seed.description);
        const currentPhase = ONBOARDING_PHASE_ORDER[0];
        const state: OnboardingState = {
            sessionId,
            agentName,
            description: seed.description,
            phases: {
                [currentPhase]: {
                    status: "pending",
                    inputs: { description: seed.description },
                    ancestorPhaseHashes: [],
                },
            },
            currentPhase,
            installedSandboxIds: [],
        };
        this.sessions.set(sessionId, state);
        return clone(state);
    }

    async runPhase(
        sessionId: string,
        phase: OnboardingPhaseName,
        inputs: unknown = {},
    ): Promise<PhaseSnapshot> {
        const state = this.requireSession(sessionId);
        const startedAt = this.now();
        const ancestorPhaseHashes = this.computeAncestorHashes(state, phase);

        state.phases[phase] = {
            status: "running",
            inputs,
            startedAt,
            ancestorPhaseHashes,
        };

        const outputs = await this.phaseRunner(clone(state), phase, inputs);
        const completedAt = this.now();

        state.phases[phase] = {
            status: "complete",
            inputs,
            outputs,
            startedAt,
            completedAt,
            ancestorPhaseHashes,
        };

        const next = nextPhase(phase);
        if (next) {
            state.currentPhase = next;
            if (!state.phases[next]) {
                state.phases[next] = {
                    status: "pending",
                    inputs: {},
                    ancestorPhaseHashes: this.computeAncestorHashes(state, next),
                };
            }
        }

        return clone(state.phases[phase]!);
    }

    async snapshot(sessionId: string): Promise<OnboardingState> {
        return clone(this.requireSession(sessionId));
    }

    async restorePhase(
        sessionId: string,
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult> {
        const state = this.requireSession(sessionId);
        state.currentPhase = phase;

        const affectedDownstream: OnboardingPhaseName[] = [];
        const downstream = this.downstreamOf(phase);
        for (const p of downstream) {
            const snap = state.phases[p];
            if (!snap || snap.status !== "complete") {
                continue;
            }
            const currentHashes = this.computeAncestorHashes(state, p);
            if (!equalStringArrays(snap.ancestorPhaseHashes, currentHashes)) {
                snap.status = "stale";
                affectedDownstream.push(p);
            }
        }

        return {
            state: clone(state),
            affectedDownstream,
            reconciliationRequired: affectedDownstream.length > 0,
        };
    }

    async installToSandbox(sessionId: string, sandboxId: string): Promise<void> {
        const state = this.requireSession(sessionId);
        if (!state.installedSandboxIds) {
            state.installedSandboxIds = [];
        }
        if (!state.installedSandboxIds.includes(sandboxId)) {
            state.installedSandboxIds.push(sandboxId);
        }
        if (this.onInstallToSandbox) {
            await this.onInstallToSandbox(clone(state), sandboxId);
        }
    }

    private requireSession(sessionId: string): OnboardingState {
        const state = this.sessions.get(sessionId);
        if (!state) {
            throw new OnboardingSessionNotFoundError(sessionId);
        }
        return state;
    }

    private computeAncestorHashes(
        state: OnboardingState,
        phase: OnboardingPhaseName,
    ): string[] {
        const idx = ONBOARDING_PHASE_ORDER.indexOf(phase);
        if (idx <= 0) {
            return [];
        }
        const hashes: string[] = [];
        for (let i = 0; i < idx; i++) {
            const p = ONBOARDING_PHASE_ORDER[i];
            const snap = state.phases[p];
            if (snap && snap.outputs !== undefined) {
                hashes.push(hashUnknown(snap.outputs));
            }
        }
        return hashes;
    }

    private downstreamOf(phase: OnboardingPhaseName): OnboardingPhaseName[] {
        const idx = ONBOARDING_PHASE_ORDER.indexOf(phase);
        return idx >= 0 ? ONBOARDING_PHASE_ORDER.slice(idx + 1) : [];
    }
}

function nextPhase(phase: OnboardingPhaseName): OnboardingPhaseName | undefined {
    const idx = ONBOARDING_PHASE_ORDER.indexOf(phase);
    if (idx < 0 || idx + 1 >= ONBOARDING_PHASE_ORDER.length) {
        return undefined;
    }
    return ONBOARDING_PHASE_ORDER[idx + 1];
}

function hashUnknown(value: unknown): string {
    const text = stableStringify(value);
    return createHash("sha256").update(text).digest("hex");
}

function stableStringify(value: unknown): string {
    return JSON.stringify(value, replacer);
}

function replacer(_key: string, val: unknown): unknown {
    if (val && typeof val === "object" && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(obj).sort()) {
            out[key] = obj[key];
        }
        return out;
    }
    return val;
}

function equalStringArrays(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function inferAgentName(description: string): string {
    const normalized = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized.length > 0 ? normalized.slice(0, 64) : "new-agent";
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
