// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import {
    InMemoryOnboardingBridge,
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type PhaseStatus,
    type OnboardingState,
    type RestorePhaseResult,
    routeStudioConversation,
} from "@typeagent/core/onboardingBridge";
import { InProcessEventStream } from "@typeagent/core/events";
import {
    InMemorySandboxManager,
    type SandboxManager,
} from "@typeagent/core/sandbox";
import { getDefaultPhaseInputs } from "./onboardingPresentation.js";

const LAST_ONBOARDING_SESSION_KEY = "studio.lastOnboardingSessionId";
const DEFAULT_SANDBOX_ID = "studio-default";

export interface StudioRuntime {
    startOnboarding(seed: {
        description: string;
        agentName?: string;
    }): Promise<OnboardingState>;
    installLastSessionToSandbox(sandboxId?: string): Promise<string>;
    getActiveOnboardingSession(): Promise<OnboardingState>;
    runPhaseOnActiveSession(
        phase: OnboardingPhaseName,
        inputs?: unknown,
    ): Promise<OnboardingState>;
    getDefaultInputsForPhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<unknown>;
    getPhaseStatusOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<PhaseStatus>;
    runRemainingPhasesOnActiveSession(): Promise<{
        state: OnboardingState;
        completedPhases: OnboardingPhaseName[];
    }>;
    restorePhaseOnActiveSession(
        phase: OnboardingPhaseName,
    ): Promise<RestorePhaseResult>;
    listPhases(): readonly OnboardingPhaseName[];
    routeConversation(prompt: string): {
        target: "onboarding" | "schemaAuthor";
        reason: string;
    };
}

export interface StudioWorkspaceState {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Promise<void>;
}

export interface StudioRuntimeContext {
    workspaceState: StudioWorkspaceState;
    globalStorageFsPath: string;
}

export interface CreateStudioRuntimeOptions {
    onboarding?: InMemoryOnboardingBridge;
    sandbox?: SandboxManager;
}

export function createStudioRuntimeCore(
    context: StudioRuntimeContext,
    options: CreateStudioRuntimeOptions = {},
): StudioRuntime {
    const events = new InProcessEventStream();
    const sandbox =
        options.sandbox ?? new InMemorySandboxManager({ emitter: events });
    const onboarding = options.onboarding ?? new InMemoryOnboardingBridge();

    const profileDir = path.join(
        context.globalStorageFsPath,
        "profiles",
        DEFAULT_SANDBOX_ID,
    );

    return {
        async startOnboarding(seed) {
            const state = await onboarding.start(seed);
            await context.workspaceState.update(
                LAST_ONBOARDING_SESSION_KEY,
                state.sessionId,
            );
            return state;
        },
        async installLastSessionToSandbox(sandboxId = DEFAULT_SANDBOX_ID) {
            const sessionId = getRequiredSessionId(context);

            try {
                await sandbox.status(sandboxId);
            } catch {
                await sandbox.start({
                    id: sandboxId,
                    mode: "inmemory",
                    profileDir,
                    agents: [],
                });
            }

            await onboarding.installToSandbox(sessionId, sandboxId);
            return sessionId;
        },
        async getActiveOnboardingSession() {
            const sessionId = getRequiredSessionId(context);
            return onboarding.snapshot(sessionId);
        },
        async runPhaseOnActiveSession(phase, inputs = {}) {
            const sessionId = getRequiredSessionId(context);
            await onboarding.runPhase(sessionId, phase, inputs);
            return onboarding.snapshot(sessionId);
        },
        async getDefaultInputsForPhaseOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return getDefaultPhaseInputs(state, phase);
        },
        async getPhaseStatusOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            const state = await onboarding.snapshot(sessionId);
            return state.phases[phase]?.status ?? "pending";
        },
        async runRemainingPhasesOnActiveSession() {
            const sessionId = getRequiredSessionId(context);
            let state = await onboarding.snapshot(sessionId);
            const completedPhases: OnboardingPhaseName[] = [];

            for (const phase of ONBOARDING_PHASE_ORDER) {
                const existing = state.phases[phase];
                if (existing?.status === "complete") {
                    continue;
                }

                await onboarding.runPhase(
                    sessionId,
                    phase,
                    getDefaultPhaseInputs(state, phase),
                );
                completedPhases.push(phase);
                state = await onboarding.snapshot(sessionId);
            }

            return {
                state,
                completedPhases,
            };
        },
        async restorePhaseOnActiveSession(phase) {
            const sessionId = getRequiredSessionId(context);
            return onboarding.restorePhase(sessionId, phase);
        },
        listPhases() {
            return ONBOARDING_PHASE_ORDER;
        },
        routeConversation(prompt) {
            const routed = routeStudioConversation(prompt);
            return {
                target: routed.target,
                reason: routed.reason,
            };
        },
    };
}

function getRequiredSessionId(context: StudioRuntimeContext): string {
    const sessionId = context.workspaceState.get<string>(
        LAST_ONBOARDING_SESSION_KEY,
    );
    if (!sessionId) {
        throw new Error(
            "No onboarding session found. Start one first with 'TypeAgent Studio: Start onboarding session'.",
        );
    }
    return sessionId;
}
