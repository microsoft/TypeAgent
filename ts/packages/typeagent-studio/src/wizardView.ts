// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The New Agent wizard webview — the entry door for standing up a new
 * agent. It hosts the `onboarding` agent's seven phases (Discovery → PhraseGen
 * → SchemaGen → GrammarGen → Scaffolder → Testing → Packaging) as one revisitable
 * panel: the developer describes the agent in plain English, walks the phases,
 * revisits an earlier one (which marks downstream phases stale for
 * reconciliation), and installs the result into a sandbox once the packaging
 * health gate is satisfied.
 *
 * Onboarding runs in the standalone Studio service (where the real sandboxes
 * live, so installs no longer split-brain). This host calls the service over the
 * channel through an {@link OnboardingRuntime}; the webview only posts typed
 * requests and renders the {@link WizardViewModel} the host posts back. It never
 * touches the runtime.
 */

import * as vscode from "vscode";
import type { OnboardingState } from "@typeagent/core/onboardingBridge";
import type { OnboardingRuntime } from "./serviceRuntimeFacade.js";
import { WebviewKitPanel } from "./webviewKit/host.js";
import {
    parseWizardMessage,
    type HostToWizardMessage,
    type WizardToHostMessage,
} from "./webviewKit/wizardProtocol.js";
import {
    toWizardViewModel,
    type WizardHealthView,
} from "./webviewKit/wizardViewModel.js";

const VIEW_TYPE = "typeagentStudio.newAgentWizard";

type InstallHealthGatePolicy = "enforce" | "warn";

function getDefaultSandboxId(): string {
    const configured = vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<string>("defaultSandboxId", "studio-default")
        .trim();
    return configured.length > 0 ? configured : "studio-default";
}

function getInstallHealthGatePolicy(): InstallHealthGatePolicy {
    return vscode.workspace
        .getConfiguration("typeagentStudio.onboarding")
        .get<InstallHealthGatePolicy>("installHealthGatePolicy", "enforce");
}

/**
 * Open (or reveal) the singleton New Agent wizard panel. Driven entirely by the
 * service-backed {@link OnboardingRuntime}; the panel keeps its context while
 * hidden so navigating away and back doesn't drop the walked-phase state.
 */
export function openNewAgentWizard(
    context: vscode.ExtensionContext,
    runtime: OnboardingRuntime,
): void {
    // The latest packaging-gate verdict, recomputed when the user asks (or after
    // an install attempt) and echoed into every state post so the install
    // control reflects it.
    let lastHealth: WizardHealthView | undefined;

    const panel = WebviewKitPanel.createOrReveal(context, {
        viewType: VIEW_TYPE,
        title: "New Agent",
        scriptPath: ["dist", "webview", "wizard.js"],
        stylePath: ["media", "wizard.css"],
        retainContextWhenHidden: true,
        onMessage: (raw) => void handleMessage(raw),
    });

    function post(message: HostToWizardMessage): void {
        panel.post(message);
    }

    /** Snapshot the active session, or `undefined` when none is active. */
    async function safeSnapshot(): Promise<OnboardingState | undefined> {
        try {
            return await runtime.getActiveOnboardingSession();
        } catch {
            return undefined;
        }
    }

    /**
     * Recompute the packaging health verdict, but only once the terminal phase
     * has completed (before that there is no artifact to gate). Failures to
     * resolve an artifact surface as an honest "unavailable" rather than an
     * error — faithful to the current stub backend, which produces no real
     * package yet.
     */
    async function refreshHealth(
        state: OnboardingState | undefined,
    ): Promise<void> {
        if (state?.phases["Packaging"]?.status !== "complete") {
            lastHealth = undefined;
            return;
        }
        try {
            const gate =
                await runtime.evaluatePackagingHealthGateForActiveSession();
            lastHealth = { status: gate.status, summary: gate.summary };
        } catch (error) {
            lastHealth = {
                status: "unavailable",
                summary:
                    error instanceof Error
                        ? error.message
                        : "Health gate could not be evaluated.",
            };
        }
    }

    /** Recompute and post the full wizard state. */
    async function postState(): Promise<void> {
        const state = await safeSnapshot();
        await refreshHealth(state);
        const phases = await runtime.listPhases();
        post({
            type: "state",
            model: toWizardViewModel(state, phases, {
                ...(lastHealth ? { health: lastHealth } : {}),
            }),
        });
    }

    function postError(message: string): void {
        post({ type: "error", message });
    }

    async function handleMessage(raw: unknown): Promise<void> {
        const message = parseWizardMessage(raw);
        if (!message) {
            return;
        }
        try {
            await dispatch(message);
        } catch (error) {
            postError(
                error instanceof Error ? error.message : "Unknown error.",
            );
            // Still refresh so the panel reflects whatever state survived.
            await postState();
        }
    }

    async function dispatch(message: WizardToHostMessage): Promise<void> {
        switch (message.type) {
            case "ready":
                await postState();
                return;

            case "start": {
                lastHealth = undefined;
                const state = await runtime.startOnboarding({
                    description: message.description,
                    ...(message.agentName
                        ? { agentName: message.agentName }
                        : {}),
                });
                post({
                    type: "status",
                    text: `Started onboarding for ${state.agentName}.`,
                });
                await postState();
                return;
            }

            case "runPhase": {
                post({ type: "status", text: `Running ${message.phase}…` });
                await runtime.runPhaseOnActiveSession(message.phase);
                post({ type: "status", text: `Ran ${message.phase}.` });
                await postState();
                return;
            }

            case "runRemaining": {
                post({ type: "status", text: "Running remaining phases…" });
                const { completedPhases } =
                    await runtime.runRemainingPhasesOnActiveSession();
                post({
                    type: "status",
                    text:
                        completedPhases.length > 0
                            ? `Completed ${completedPhases.join(", ")}.`
                            : "All phases were already complete.",
                });
                await postState();
                return;
            }

            case "restorePhase": {
                const result = await runtime.restorePhaseOnActiveSession(
                    message.phase,
                );
                post({
                    type: "reconciliation",
                    restoredPhase: message.phase,
                    stalePhases: result.affectedDownstream,
                });
                await postState();
                return;
            }

            case "rerunStale": {
                const stale = await runtime.listStalePhasesOnActiveSession();
                if (stale.length === 0) {
                    post({
                        type: "status",
                        text: "No stale phases to re-run.",
                    });
                    await postState();
                    return;
                }
                post({
                    type: "status",
                    text: `Re-running ${stale.join(", ")}…`,
                });
                await runtime.rerunPhasesOnActiveSession(stale);
                post({
                    type: "status",
                    text: `Re-ran ${stale.join(", ")}.`,
                });
                await postState();
                return;
            }

            case "install":
                await handleInstall();
                return;

            case "tryIt":
                await handleTryIt();
                return;

            case "checkHealth": {
                const state = await safeSnapshot();
                await refreshHealth(state);
                if (state?.phases["Packaging"]?.status !== "complete") {
                    post({
                        type: "status",
                        text: "Complete the Packaging phase before checking install health.",
                    });
                }
                await postState();
                return;
            }

            case "clear": {
                const active = await safeSnapshot();
                if (active) {
                    const discard = "Start over";
                    const choice = await vscode.window.showWarningMessage(
                        "Clear this onboarding session and start a new agent? The walked phases will be discarded.",
                        { modal: true },
                        discard,
                    );
                    if (choice !== discard) {
                        post({ type: "status", text: "Kept current session." });
                        await postState();
                        return;
                    }
                }
                lastHealth = undefined;
                await runtime.clearActiveOnboardingSession();
                await postState();
                return;
            }
        }
    }

    /**
     * Install the active session into the default sandbox, honoring the
     * packaging health gate. On a gate failure under the "enforce"
     * policy, offer an explicit modal bypass rather than silently proceeding.
     */
    async function handleInstall(): Promise<void> {
        const sandboxId = getDefaultSandboxId();
        const policy = getInstallHealthGatePolicy();
        post({ type: "status", text: `Installing into ${sandboxId}…` });

        try {
            const installed = await runtime.installLastSessionToSandbox(
                sandboxId,
                { skipHealthGate: policy === "warn" },
            );
            void vscode.window.showInformationMessage(
                `Installed ${installed.sessionId} into sandbox ${sandboxId}.`,
            );
        } catch (error) {
            const text = error instanceof Error ? error.message : "";
            if (text.startsWith("Health gate failed:")) {
                const proceed = await confirmHealthGateBypass(text);
                if (!proceed) {
                    post({ type: "status", text: "Install cancelled." });
                    await postState();
                    return;
                }
                const installed = await runtime.installLastSessionToSandbox(
                    sandboxId,
                    { skipHealthGate: true },
                );
                void vscode.window.showInformationMessage(
                    `Installed ${installed.sessionId} into sandbox ${sandboxId} (health gate bypassed).`,
                );
            } else {
                throw error;
            }
        }
        post({ type: "status", text: `Installed into ${sandboxId}.` });
        await postState();
    }

    /**
     * Prove the installed agent answers a PhraseGen example utterance
     * ("Try it"): translate one example through a dispatcher loaded with just the
     * generated agent and report the resolved action. Translate-only, so nothing
     * is executed. Surfaces the verdict to the webview and a toast.
     */
    async function handleTryIt(): Promise<void> {
        post({ type: "status", text: "Trying an example utterance…" });
        try {
            const result = await runtime.proveActiveSessionUtterance();
            post({ type: "utteranceProof", result });
            if (result.answered) {
                const target =
                    result.resolvedAction ??
                    result.resolvedSchema ??
                    "an action";
                void vscode.window.showInformationMessage(
                    `"${result.utterance}" → ${target}` +
                        (result.matchedExpectedAction
                            ? " (matched the expected action)."
                            : "."),
                );
            } else {
                void vscode.window.showWarningMessage(
                    `The agent did not resolve "${result.utterance}"` +
                        (result.error ? `: ${result.error}` : "."),
                );
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            post({ type: "error", message });
        }
        await postState();
    }

    // Kick off an initial render for the reveal case (an already-open panel that
    // is re-revealed keeps its retained context and re-`ready`s itself). Guard
    // the rejection: `listPhases()` rejects with NOT_CONNECTED during the brief
    // window before the service socket is up, and an unguarded `void` would
    // surface as an unhandled rejection.
    postState().catch((error) => {
        postError(error instanceof Error ? error.message : String(error));
    });
}

async function confirmHealthGateBypass(message: string): Promise<boolean> {
    const bypass = "Install anyway";
    const choice = await vscode.window.showWarningMessage(
        `${message}\n\nInstall anyway?`,
        { modal: true },
        bypass,
    );
    return choice === bypass;
}
