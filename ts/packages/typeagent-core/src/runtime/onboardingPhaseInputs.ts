// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    type OnboardingPhaseName,
    type OnboardingState,
} from "../onboardingBridge/index.js";

/**
 * Default inputs used when (re-)running an onboarding phase. Each phase seeds
 * itself from the prior phase's output (or, for Discovery, the session's
 * description/agent name). Consumed by the Studio runtime when a caller runs a
 * phase without supplying explicit inputs.
 */
export function getDefaultPhaseInputs(
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
