// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference lib="dom" />

/**
 * New Agent wizard webview client (runs inside the iframe). It renders the
 * {@link WizardViewModel} the extension host posts and drives the onboarding
 * loop by posting typed requests back — it never touches the runtime itself
 * (the security boundary). Pure DOM; no `ws`, `vscode`, or node built-ins, and
 * only *type* imports from `@typeagent/core`, so it bundles for the browser.
 *
 * The panel is one revisitable surface for the seven onboarding phases: a start
 * screen collects a plain-English description; once a session is active the
 * developer walks a phase stepper, revisits an earlier phase (which surfaces a
 * reconciliation banner for the now-stale downstream phases — F1.5), and
 * installs the result into a sandbox once the packaging health gate is happy
 * (F1.3 / F1.4).
 */

import type { OnboardingPhaseName } from "@typeagent/core/onboardingBridge";
import type { UtteranceProofResult } from "@typeagent/core/runtime";
import type {
    HostToWizardMessage,
    WizardToHostMessage,
} from "../wizardProtocol.js";
import type { WizardViewModel, WizardPhaseView } from "../wizardViewModel.js";

interface VsCodeApi {
    postMessage(message: WizardToHostMessage): void;
    getState(): PersistedState | undefined;
    setState(state: PersistedState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Client-only state that should survive a full reload (host reload re-sends the
 *  model, but the selected tab and guided toggle are the webview's own). */
interface PersistedState {
    selectedPhase?: OnboardingPhaseName;
    guided?: boolean;
}

const root = document.getElementById("root") as HTMLElement;

let model: WizardViewModel | undefined;
let selectedPhase: OnboardingPhaseName | undefined;
let guided = true;
let statusText: string | undefined;
let errorText: string | undefined;
let reconciliation:
    | { restoredPhase: OnboardingPhaseName; stalePhases: OnboardingPhaseName[] }
    | undefined;
let utteranceProof: UtteranceProofResult | undefined;

restorePersisted();

// --- DOM helpers ---------------------------------------------------------

function el(tag: string, className?: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function clear(node: HTMLElement): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function button(
    label: string,
    onClick: () => void,
    opts: { variant?: "primary" | "secondary"; disabled?: boolean } = {},
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `wz-btn wz-btn-${opts.variant ?? "secondary"}`;
    btn.textContent = label;
    btn.disabled = opts.disabled ?? false;
    if (!btn.disabled) {
        btn.addEventListener("click", onClick);
    }
    return btn;
}

// --- Host messaging ------------------------------------------------------

function post(message: WizardToHostMessage): void {
    vscode.postMessage(message);
}

function restorePersisted(): void {
    const saved = vscode.getState();
    if (saved) {
        selectedPhase = saved.selectedPhase;
        guided = saved.guided ?? true;
    }
}

function persist(): void {
    vscode.setState({ selectedPhase, guided });
}

// --- State reconciliation on incoming model ------------------------------

function phaseByName(name: OnboardingPhaseName): WizardPhaseView | undefined {
    return model?.phases.find((p) => p.name === name);
}

/** Choose which phase tab to show after a fresh model arrives. In guided mode
 *  the selection follows the next runnable phase (or the cursor); otherwise it
 *  keeps the user's current tab when it is still valid. */
function reconcileSelection(): void {
    if (!model?.active) {
        selectedPhase = undefined;
        return;
    }
    const stillValid =
        selectedPhase !== undefined && phaseByName(selectedPhase) !== undefined;
    if (guided) {
        selectedPhase =
            model.nextRunnablePhase ??
            model.currentPhase ??
            model.phases[model.phases.length - 1]?.name;
        return;
    }
    if (!stillValid) {
        selectedPhase =
            model.currentPhase ??
            model.nextRunnablePhase ??
            model.phases[0]?.name;
    }
}

window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToWizardMessage;
    switch (msg.type) {
        case "state":
            model = msg.model;
            errorText = undefined;
            reconcileSelection();
            render();
            break;
        case "status":
            statusText = msg.text;
            errorText = undefined;
            render();
            break;
        case "error":
            errorText = msg.message;
            render();
            break;
        case "utteranceProof":
            utteranceProof = msg.result;
            statusText = undefined;
            errorText = undefined;
            render();
            break;
        case "reconciliation":
            reconciliation =
                msg.stalePhases.length > 0
                    ? {
                          restoredPhase: msg.restoredPhase,
                          stalePhases: msg.stalePhases,
                      }
                    : undefined;
            if (!reconciliation) {
                statusText = `Revisiting ${msg.restoredPhase}. Nothing downstream needed reconciliation.`;
            }
            render();
            break;
    }
});

// --- Rendering -----------------------------------------------------------

function render(): void {
    persist();
    clear(root);

    if (!model) {
        root.appendChild(el("div", "wz-center", "Loading…"));
        return;
    }

    if (errorText) {
        root.appendChild(banner("wz-banner-error", errorText));
    }

    if (!model.active) {
        root.appendChild(renderStartScreen());
        return;
    }

    root.appendChild(renderHeader(model));
    if (reconciliation) {
        root.appendChild(renderReconciliation(reconciliation));
    }
    if (statusText) {
        root.appendChild(banner("wz-banner-status", statusText));
    }

    const body = el("div", "wz-body");
    body.appendChild(renderStepper(model));
    body.appendChild(renderDetail(model));
    root.appendChild(body);

    root.appendChild(renderInstallBar(model));
}

function banner(className: string, text: string): HTMLElement {
    return el("div", `wz-banner ${className}`, text);
}

function renderStartScreen(): HTMLElement {
    const wrap = el("div", "wz-start");
    wrap.appendChild(el("h1", "wz-start-title", "Create a new agent"));
    wrap.appendChild(
        el(
            "p",
            "wz-start-lead",
            "Describe, in plain English, what the agent should do. Studio runs the seven onboarding phases to scaffold it, then installs it into a sandbox you can try.",
        ),
    );

    const descLabel = el("label", "wz-label", "What should the agent do?");
    const desc = document.createElement("textarea");
    desc.className = "wz-textarea";
    desc.rows = 6;
    desc.placeholder =
        "e.g. An agent that controls a smart-home thermostat: set, raise, and lower the temperature in named rooms.";
    descLabel.appendChild(desc);

    const nameLabel = el("label", "wz-label", "Agent name (optional)");
    const name = document.createElement("input");
    name.className = "wz-input";
    name.type = "text";
    name.placeholder = "thermostat";
    nameLabel.appendChild(name);

    const create = button(
        "Create agent",
        () => {
            const description = desc.value.trim();
            if (description.length === 0) {
                desc.focus();
                return;
            }
            statusText = undefined;
            reconciliation = undefined;
            post({
                type: "start",
                description,
                ...(name.value.trim() ? { agentName: name.value.trim() } : {}),
            });
        },
        { variant: "primary" },
    );

    wrap.appendChild(descLabel);
    wrap.appendChild(nameLabel);
    wrap.appendChild(el("div", "wz-start-actions")).appendChild(create);
    return wrap;
}

function renderHeader(m: WizardViewModel): HTMLElement {
    const header = el("div", "wz-header");

    const titleRow = el("div", "wz-title-row");
    titleRow.appendChild(el("h1", "wz-title", m.agentName ?? "New agent"));

    const guidedToggle = button(
        guided ? "Guided: on" : "Guided: off",
        () => {
            guided = !guided;
            reconcileSelection();
            render();
        },
        { variant: "secondary" },
    );
    guidedToggle.classList.add("wz-toggle");
    titleRow.appendChild(guidedToggle);

    titleRow.appendChild(
        button(
            "Start over",
            () => {
                statusText = undefined;
                reconciliation = undefined;
                post({ type: "clear" });
            },
            { variant: "secondary" },
        ),
    );
    header.appendChild(titleRow);

    const cursor = m.currentPhase ?? "—";
    const cursorPhase = m.currentPhase
        ? phaseByName(m.currentPhase)
        : undefined;
    const step = cursorPhase
        ? `Step ${cursorPhase.index} of ${m.totalCount}`
        : "";
    header.appendChild(
        el("div", "wz-subtitle", `${step}${step ? " · " : ""}${cursor}`),
    );

    // Progress bar.
    const track = el("div", "wz-progress-track");
    const fill = el("div", "wz-progress-fill");
    const pct = m.totalCount > 0 ? (m.completeCount / m.totalCount) * 100 : 0;
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    header.appendChild(track);
    header.appendChild(
        el(
            "div",
            "wz-progress-label",
            `${m.completeCount} of ${m.totalCount} phases complete`,
        ),
    );

    // Guided "run next" affordance.
    if (guided && m.nextRunnablePhase) {
        const next = m.nextRunnablePhase;
        const runNext = button(
            `Run next: ${next}`,
            () => post({ type: "runPhase", phase: next }),
            { variant: "primary" },
        );
        runNext.classList.add("wz-run-next");
        header.appendChild(runNext);
    }

    return header;
}

function renderReconciliation(rec: {
    restoredPhase: OnboardingPhaseName;
    stalePhases: OnboardingPhaseName[];
}): HTMLElement {
    const box = el("div", "wz-banner wz-banner-warn wz-reconcile");
    box.appendChild(
        el(
            "div",
            "wz-reconcile-text",
            `Revisiting ${rec.restoredPhase} left ${rec.stalePhases.join(", ")} out of date. Re-run them to reconcile, or keep the existing output.`,
        ),
    );
    const actions = el("div", "wz-reconcile-actions");
    actions.appendChild(
        button(
            "Re-run stale phases",
            () => {
                reconciliation = undefined;
                post({ type: "rerunStale" });
            },
            { variant: "primary" },
        ),
    );
    actions.appendChild(
        button(
            "Keep as-is",
            () => {
                reconciliation = undefined;
                render();
            },
            { variant: "secondary" },
        ),
    );
    box.appendChild(actions);
    return box;
}

function statusLabel(status: WizardPhaseView["status"]): string {
    switch (status) {
        case "complete":
            return "Complete";
        case "running":
            return "Running";
        case "stale":
            return "Stale";
        default:
            return "Pending";
    }
}

function renderStepper(m: WizardViewModel): HTMLElement {
    const list = el("div", "wz-stepper");
    for (const phase of m.phases) {
        const row = el("button", "wz-step");
        row.classList.add(`wz-step-${phase.status}`);
        if (phase.name === selectedPhase) {
            row.classList.add("wz-step-selected");
        }
        if (phase.isCurrent) {
            row.classList.add("wz-step-current");
        }
        (row as HTMLButtonElement).addEventListener("click", () => {
            selectedPhase = phase.name;
            render();
        });

        row.appendChild(el("span", "wz-step-index", String(phase.index)));
        row.appendChild(el("span", "wz-step-name", phase.name));
        const dot = el("span", `wz-dot wz-dot-${phase.status}`);
        dot.title = statusLabel(phase.status);
        row.appendChild(dot);
        list.appendChild(row);
    }
    return list;
}

function timing(phase: WizardPhaseView): string | undefined {
    if (phase.completedAt) {
        return `Completed ${new Date(phase.completedAt).toLocaleTimeString()}`;
    }
    if (phase.startedAt) {
        return `Started ${new Date(phase.startedAt).toLocaleTimeString()}`;
    }
    return undefined;
}

function jsonBlock(title: string, json: string): HTMLElement {
    const details = document.createElement("details");
    details.className = "wz-json";
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.appendChild(summary);
    const pre = el("pre", "wz-json-pre");
    pre.textContent = json;
    details.appendChild(pre);
    return details;
}

function renderDetail(m: WizardViewModel): HTMLElement {
    const pane = el("div", "wz-detail");
    const phase = selectedPhase ? phaseByName(selectedPhase) : undefined;
    if (!phase) {
        pane.appendChild(el("div", "wz-center", "Select a phase."));
        return pane;
    }

    const head = el("div", "wz-detail-head");
    head.appendChild(
        el("h2", "wz-detail-title", `${phase.index}. ${phase.name}`),
    );
    const badge = el(
        "span",
        `wz-badge wz-badge-${phase.status}`,
        statusLabel(phase.status),
    );
    head.appendChild(badge);
    pane.appendChild(head);

    const time = timing(phase);
    if (time) {
        pane.appendChild(el("div", "wz-detail-time", time));
    }

    // Primary action for this phase.
    const actions = el("div", "wz-detail-actions");
    if (phase.runnable) {
        const runLabel =
            phase.status === "stale"
                ? `Re-run ${phase.name}`
                : `Run ${phase.name}`;
        actions.appendChild(
            button(
                runLabel,
                () => post({ type: "runPhase", phase: phase.name }),
                {
                    variant: "primary",
                },
            ),
        );
    } else if (phase.status === "complete") {
        actions.appendChild(
            button(
                "Revisit (re-run from here)",
                () => {
                    reconciliation = undefined;
                    post({ type: "restorePhase", phase: phase.name });
                },
                { variant: "secondary" },
            ),
        );
    } else {
        actions.appendChild(
            el(
                "div",
                "wz-hint",
                "Complete the earlier phases before running this one.",
            ),
        );
    }
    pane.appendChild(actions);

    if (phase.outputsJson) {
        pane.appendChild(jsonBlock("Output", phase.outputsJson));
    }
    if (phase.inputsJson) {
        pane.appendChild(jsonBlock("Input", phase.inputsJson));
    }

    return pane;
}

function renderInstallBar(m: WizardViewModel): HTMLElement {
    const bar = el("div", "wz-install");

    if (m.health) {
        bar.appendChild(
            el(
                "div",
                `wz-health wz-health-${m.health.status}`,
                `Health gate: ${m.health.status} — ${m.health.summary}`,
            ),
        );
    }

    const actions = el("div", "wz-install-actions");

    const runRemaining = button(
        "Run remaining phases",
        () => {
            reconciliation = undefined;
            post({ type: "runRemaining" });
        },
        { variant: "secondary", disabled: m.nextRunnablePhase === undefined },
    );
    actions.appendChild(runRemaining);

    const packagingComplete =
        m.phases.find((p) => p.name === "Packaging")?.status === "complete";
    actions.appendChild(
        button("Check install health", () => post({ type: "checkHealth" }), {
            variant: "secondary",
            disabled: !packagingComplete,
        }),
    );

    const install = button(
        "Install into sandbox",
        () => post({ type: "install" }),
        { variant: "primary", disabled: !m.canInstall },
    );
    actions.appendChild(install);
    bar.appendChild(actions);

    if (!m.canInstall) {
        const reason = !packagingComplete
            ? "Complete the Packaging phase to enable install."
            : m.health?.status === "fail"
              ? "The health gate is failing — fix the flagged phase, or install anyway from the gate prompt."
              : "";
        if (reason) {
            bar.appendChild(el("div", "wz-hint", reason));
        }
    }

    if (m.installedSandboxIds.length > 0) {
        bar.appendChild(
            el(
                "div",
                "wz-installed",
                `Installed into: ${m.installedSandboxIds.join(", ")}`,
            ),
        );

        const tryActions = el("div", "wz-install-actions");
        tryActions.appendChild(
            button(
                "Try an example utterance",
                () => {
                    utteranceProof = undefined;
                    post({ type: "tryIt" });
                },
                { variant: "secondary" },
            ),
        );
        bar.appendChild(tryActions);
        bar.appendChild(
            el(
                "div",
                "wz-hint",
                "Translate a PhraseGen example through the installed agent to prove it resolves to an action.",
            ),
        );

        if (utteranceProof) {
            bar.appendChild(renderUtteranceProof(utteranceProof));
        }
    }

    return bar;
}

/** Render the t4 "Try it" verdict: which action a sample utterance resolved to
 *  (or why it did not answer). Translate-only, so nothing was executed. */
function renderUtteranceProof(proof: UtteranceProofResult): HTMLElement {
    const status = proof.answered ? "pass" : "fail";
    const banner = el("div", `wz-proof wz-proof-${status}`);

    const headline = proof.answered
        ? proof.matchedExpectedAction
            ? "✓ Answered (matched the expected action)"
            : "✓ Answered"
        : "✗ Did not answer";
    banner.appendChild(el("div", "wz-proof-headline", headline));

    banner.appendChild(
        el("div", "wz-proof-utterance", `Utterance: “${proof.utterance}”`),
    );

    if (proof.answered) {
        const target =
            proof.resolvedAction ?? proof.resolvedSchema ?? "(unnamed action)";
        banner.appendChild(
            el("div", "wz-proof-detail", `Resolved to: ${target}`),
        );
        if (
            proof.expectedAction &&
            proof.expectedAction !== proof.resolvedAction
        ) {
            banner.appendChild(
                el(
                    "div",
                    "wz-proof-detail",
                    `Expected: ${proof.expectedAction}`,
                ),
            );
        }
    } else if (proof.error) {
        banner.appendChild(el("div", "wz-proof-detail", proof.error));
    }

    return banner;
}

post({ type: "ready" });
