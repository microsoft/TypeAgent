// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Typed message envelope for the New Agent wizard's host (extension) ↔ webview
 * (iframe) channel.
 *
 * Pure data + narrowing only — no `vscode` or DOM dependency, and only *type*
 * imports from `@typeagent/core` — so both the extension host bundle and the
 * browser client bundle import it, and it is unit testable. The host forwards
 * each webview request to the standalone Studio service (where onboarding runs)
 * and posts the resulting {@link WizardViewModel} back; the webview never
 * touches the runtime directly.
 */

import type { OnboardingPhaseName } from "@typeagent/core/onboardingBridge";
import type { UtteranceProofResult } from "@typeagent/core/runtime";
import type { WizardViewModel } from "./wizardViewModel.js";

/** Messages the extension host posts to the webview. */
export type HostToWizardMessage =
    /** The current wizard state — posted on load and after every action. */
    | { type: "state"; model: WizardViewModel }
    /** A transient status line (e.g. "Running SchemaGen…"). */
    | { type: "status"; text: string }
    /** A failure for a prior request (optionally scoped to a phase). */
    | { type: "error"; message: string; phase?: OnboardingPhaseName }
    /**
     * Result of proving the generated agent answers an utterance via
     * "Try it": the resolved action + answered/matched verdict.
     */
    | { type: "utteranceProof"; result: UtteranceProofResult }
    /**
     * Result of revisiting an earlier phase: the downstream phases whose
     * recorded ancestor outputs no longer match and are now stale. Empty
     * when nothing downstream needed reconciliation.
     */
    | {
          type: "reconciliation";
          restoredPhase: OnboardingPhaseName;
          stalePhases: OnboardingPhaseName[];
      };

/** Messages the webview posts to the extension host. */
export type WizardToHostMessage =
    /** The webview finished loading and is ready to receive `state`. */
    | { type: "ready" }
    /** Start a new onboarding session from a plain-English description. */
    | { type: "start"; description: string; agentName?: string }
    /** Run one phase (must be runnable — all earlier phases complete). */
    | { type: "runPhase"; phase: OnboardingPhaseName }
    /** Run every not-yet-complete phase in order. */
    | { type: "runRemaining" }
    /**
     * Revisit an earlier, already-complete phase: move the cursor back to it and
     * mark any now-inconsistent downstream phases stale. Does not re-run.
     */
    | { type: "restorePhase"; phase: OnboardingPhaseName }
    /** Re-run every phase currently marked stale, in order. */
    | { type: "rerunStale" }
    /** Install the active session's agent into a sandbox (gated by the health check). */
    | { type: "install" }
    /** Try a PhraseGen example utterance against the installed agent. */
    | { type: "tryIt" }
    /** Evaluate the packaging health gate and refresh the verdict. */
    | { type: "checkHealth" }
    /** Clear the active session and return to the start screen. */
    | { type: "clear" };

/** The phase names, needed to narrow untrusted webview messages without a
 *  runtime import from core (which would pull node built-ins into the client).
 *  {@link parseWizardMessage} narrows against this; a unit test pins it to the
 *  canonical `ONBOARDING_PHASE_ORDER`. */
export const PHASE_NAMES: readonly OnboardingPhaseName[] = [
    "Discovery",
    "PhraseGen",
    "SchemaGen",
    "GrammarGen",
    "Scaffolder",
    "Testing",
    "Packaging",
];

function isPhase(value: unknown): value is OnboardingPhaseName {
    return (
        typeof value === "string" &&
        (PHASE_NAMES as readonly string[]).includes(value)
    );
}

function trimmedString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/** Narrow an untrusted value into a {@link WizardToHostMessage}. */
export function parseWizardMessage(
    value: unknown,
): WizardToHostMessage | undefined {
    if (typeof value !== "object" || value === null) {
        return undefined;
    }
    const msg = value as { type?: unknown };
    switch (msg.type) {
        case "ready":
        case "runRemaining":
        case "rerunStale":
        case "install":
        case "tryIt":
        case "checkHealth":
        case "clear":
            return { type: msg.type };
        case "start": {
            const m = value as { description?: unknown; agentName?: unknown };
            const description = trimmedString(m.description);
            if (description === undefined) {
                return undefined;
            }
            const agentName = trimmedString(m.agentName);
            return {
                type: "start",
                description,
                ...(agentName ? { agentName } : {}),
            };
        }
        case "runPhase":
        case "restorePhase": {
            const phase = (value as { phase?: unknown }).phase;
            return isPhase(phase) ? { type: msg.type, phase } : undefined;
        }
        default:
            return undefined;
    }
}
