// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import * as vscode from "vscode";
import {
    InMemoryOnboardingBridge,
    ONBOARDING_PHASE_ORDER,
    type OnboardingPhaseName,
    type PhaseStatus,
    type OnboardingState,
    routeStudioConversation,
} from "@typeagent/core/onboardingBridge";
import { InProcessEventStream } from "@typeagent/core/events";
import { InMemorySandboxManager } from "@typeagent/core/sandbox";

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
    restorePhaseOnActiveSession(phase: OnboardingPhaseName): Promise<{
        state: OnboardingState;
        affectedDownstream: OnboardingPhaseName[];
        reconciliationRequired: boolean;
    }>;
    listPhases(): readonly OnboardingPhaseName[];
    routeConversation(prompt: string): {
        target: "onboarding" | "schemaAuthor";
        reason: string;
    };
}

export function createStudioRuntime(
    context: vscode.ExtensionContext,
): StudioRuntime {
    const events = new InProcessEventStream();
    const sandbox = new InMemorySandboxManager({ emitter: events });
    const onboarding = new InMemoryOnboardingBridge();

    const profileDir = path.join(
        context.globalStorageUri.fsPath,
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

function getDefaultPhaseInputs(
    state: OnboardingState,
    phase: OnboardingPhaseName,
): unknown {
    switch (phase) {
        case "Discovery":
            return {
                description: state.description,
                agentName: state.agentName,
            };
        case "PhraseGen":
            return {
                seed: "Generate representative utterances for the target workflow.",
                sourcePhase: "Discovery",
            };
        case "SchemaGen":
            return {
                seed: "Draft schema/action types from discovery and phrase coverage.",
                sourcePhase: "PhraseGen",
            };
        case "GrammarGen":
            return {
                seed: "Draft grammar variants from schema and phrase outputs.",
                sourcePhase: "SchemaGen",
            };
        case "Scaffolder":
            return {
                seed: "Create initial manifest/schema/handler scaffolding.",
                sourcePhase: "GrammarGen",
            };
        case "Testing":
            return {
                seed: "Run local validation and summarize failures.",
                sourcePhase: "Scaffolder",
            };
        case "Packaging":
            return {
                seed: "Prepare package artifacts and release checklist.",
                sourcePhase: "Testing",
            };
    }
}

function getRequiredSessionId(context: vscode.ExtensionContext): string {
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
