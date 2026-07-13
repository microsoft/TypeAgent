// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Trace Viewer webview client. Renders one row's side-by-side resolution
 * trace: a divergence conclusion callout, then a row-centric grid aligning the
 * four fidelity layers (construction cache → grammar → wildcard validation →
 * action) across the A and B versions. A "Replay" recompute contrasts the
 * recorded resolution with what the same pinned versions produce now, revealing
 * working-tree drift; a Recorded/Fresh toggle switches between the two.
 *
 * Everything divergence-related is derived by the shared, browser-neutral
 * {@link toTraceDivergenceViewModel}; this file only turns that view model into
 * DOM. No inline styles (the CSP forbids them) — every visual is a CSS class.
 */

import type {
    ReplayResolutionTrace,
    ReplayTraceNode,
} from "@typeagent/core/replay";
import {
    toTraceDivergenceViewModel,
    TRACE_LAYER_ORDER,
    TRACE_LAYER_NAME,
    type TraceDivergenceViewModel,
    type SideDivergenceView,
    type TraceNodeSummary,
} from "../traceDivergenceViewModel.js";
import { stableStringify } from "../replayViewModel.js";
import type {
    HostToTraceMessage,
    TraceToHostMessage,
    TraceProvenanceSummary,
    TraceVersionSummary,
    TraceConnectionState,
    TraceUnavailableState,
} from "../traceProtocol.js";

interface VsCodeApi {
    postMessage(message: TraceToHostMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Which trace the grid is showing. `fresh` is only selectable once a replay
 *  has produced one. */
type Variant = "recorded" | "fresh";

/** Whether a fresh replay reproduced the recorded resolution or drifted. */
type Drift = "matches" | "drifted";

// The recorded trace is the source of truth and is preserved across a replay so
// a failed or drifted recompute never erases it (R7).
let recorded: ReplayResolutionTrace | undefined;
let fresh: ReplayResolutionTrace | undefined;
let provenance: TraceProvenanceSummary | undefined;
let variant: Variant = "recorded";
let unavailable: TraceUnavailableState | undefined = "loading";
let connection: TraceConnectionState = "connecting";
let traceError: string | undefined;
let replayPending = false;
let replayNote: string | undefined;

// Monotonic replay id so a slow earlier recompute can't overwrite a newer one.
let replayRequestId = 0;
let latestReplayId = 0;

const root = document.getElementById("root") as HTMLElement;

window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToTraceMessage;
    switch (msg.type) {
        case "connection":
            connection = msg.state;
            render();
            break;
        case "trace":
            recorded = msg.recorded;
            provenance = msg.provenance;
            unavailable = undefined;
            traceError = undefined;
            render();
            break;
        case "trace-state":
            unavailable = msg.state;
            render();
            break;
        case "trace-error":
            traceError = msg.message;
            unavailable = undefined;
            render();
            break;
        case "replay-result":
            // Ignore a stale recompute superseded by a newer request.
            if (msg.requestId !== latestReplayId) {
                break;
            }
            replayPending = false;
            if (msg.status === "recomputed" && msg.fresh) {
                fresh = msg.fresh;
                variant = "fresh";
                replayNote = driftNote(recorded, fresh);
            } else {
                // Keep the recorded trace on screen; explain why no fresh one
                // could be produced.
                replayNote =
                    msg.message ??
                    (msg.status === "entry-missing"
                        ? "This utterance is no longer in the corpus, so it can't be replayed."
                        : "A fresh trace couldn't be produced from the recorded run.");
            }
            render();
            break;
        case "source-result":
            // Source navigation lands in a follow-up; surface the host's note.
            if (msg.status !== "opened" && msg.message !== undefined) {
                replayNote = msg.message;
                render();
            }
            break;
    }
});

vscode.postMessage({ type: "ready" });

// --- Rendering ------------------------------------------------------------

function render(): void {
    clear(root);
    root.appendChild(connectionBar());

    if (unavailable === "loading") {
        root.appendChild(centeredState("Loading trace…", "loading"));
        return;
    }
    if (traceError !== undefined) {
        root.appendChild(centeredState(traceError, "error"));
        return;
    }
    if (unavailable === "evicted") {
        root.appendChild(
            centeredState(
                "This run's traces have been rotated out of the store. Re-run the report to capture them again.",
                "evicted",
            ),
        );
        return;
    }
    if (unavailable === "missing") {
        root.appendChild(
            centeredState("No trace was captured for this row.", "missing"),
        );
        return;
    }

    const active = variant === "fresh" && fresh ? fresh : recorded;
    if (!active) {
        root.appendChild(centeredState("No trace to show.", "missing"));
        return;
    }

    let vm: TraceDivergenceViewModel;
    try {
        vm = toTraceDivergenceViewModel(active);
    } catch {
        root.appendChild(
            centeredState(
                "The captured trace is malformed and can't be interpreted.",
                "error",
            ),
        );
        return;
    }

    root.appendChild(header(vm));
    root.appendChild(callout(vm));
    if (replayNote !== undefined) {
        root.appendChild(noteBanner(replayNote));
    }
    root.appendChild(grid(vm));
}

/** The connection indicator; only intrudes when the service isn't connected. */
function connectionBar(): HTMLElement {
    const bar = el("div", "conn-bar");
    if (connection === "connected") {
        bar.classList.add("is-connected");
        return bar;
    }
    const pill = el("span", "conn-pill");
    pill.classList.add(
        connection === "connecting" ? "is-connecting" : "is-disconnected",
    );
    pill.textContent =
        connection === "connecting"
            ? "Connecting to the studio service…"
            : "Studio service disconnected — replay is unavailable.";
    bar.appendChild(pill);
    return bar;
}

/** Utterance + A/B provenance line + the Replay control and variant toggle. */
function header(vm: TraceDivergenceViewModel): HTMLElement {
    const head = el("div", "trace-header");

    const top = el("div", "trace-header-top");
    const utter = el("div", "utterance");
    utter.textContent = vm.utterance;
    utter.title = vm.utterance;
    top.appendChild(utter);
    top.appendChild(replayControls());
    head.appendChild(top);

    if (provenance !== undefined) {
        head.appendChild(provenanceLine(provenance));
    }
    return head;
}

function provenanceLine(p: TraceProvenanceSummary): HTMLElement {
    const line = el("div", "provenance");
    const agent = el("span", "prov-agent");
    agent.textContent = p.agent;
    line.appendChild(agent);
    line.appendChild(sep());
    line.appendChild(versionChip("A", p.a));
    line.appendChild(arrow());
    line.appendChild(versionChip("B", p.b));
    return line;
}

function versionChip(side: "A" | "B", v: TraceVersionSummary): HTMLElement {
    const chip = el("span", "version-chip");
    chip.classList.add(side === "A" ? "side-a" : "side-b");
    const tag = el("span", "version-side");
    tag.textContent = side;
    chip.appendChild(tag);
    const label = el("span", "version-label");
    label.textContent = v.label;
    chip.appendChild(label);
    if (v.workingTree) {
        const badge = el("span", "version-badge working-tree");
        badge.textContent = "working tree";
        badge.title = "The live working tree, including uncommitted edits.";
        chip.appendChild(badge);
    } else if (v.sha !== undefined) {
        const badge = el("span", "version-badge sha");
        badge.textContent = v.sha.slice(0, 7);
        badge.title = v.sha;
        chip.appendChild(badge);
    }
    return chip;
}

function replayControls(): HTMLElement {
    const wrap = el("div", "replay-controls");

    if (fresh !== undefined) {
        wrap.appendChild(
            toggleButton("Recorded", variant === "recorded", () => {
                variant = "recorded";
                render();
            }),
        );
        wrap.appendChild(
            toggleButton("Fresh", variant === "fresh", () => {
                variant = "fresh";
                render();
            }),
        );
    }

    const replay = el("button", "replay-button") as HTMLButtonElement;
    replay.type = "button";
    const canReplay =
        connection === "connected" && !replayPending && !!recorded;
    replay.disabled = !canReplay;
    replay.textContent = replayPending ? "Replaying…" : "Replay";
    replay.title = replayPending
        ? "Recomputing a fresh trace from the pinned versions…"
        : "Recompute this row from the same pinned versions to reveal working-tree drift.";
    replay.addEventListener("click", () => {
        if (!canReplay) {
            return;
        }
        replayPending = true;
        replayNote = undefined;
        replayRequestId += 1;
        latestReplayId = replayRequestId;
        vscode.postMessage({ type: "replay", requestId: replayRequestId });
        render();
    });
    wrap.appendChild(replay);
    return wrap;
}

function toggleButton(
    label: string,
    active: boolean,
    onClick: () => void,
): HTMLButtonElement {
    const b = el("button", "variant-toggle") as HTMLButtonElement;
    b.type = "button";
    b.textContent = label;
    if (active) {
        b.classList.add("is-active");
        b.setAttribute("aria-pressed", "true");
    } else {
        b.setAttribute("aria-pressed", "false");
    }
    b.addEventListener("click", onClick);
    return b;
}

/** The divergence conclusion the viewer leads with. */
function callout(vm: TraceDivergenceViewModel): HTMLElement {
    const { conclusion } = vm;
    const box = el("div", "callout");
    box.classList.add(conclusion.parity === "match" ? "is-match" : "is-differ");
    if (conclusion.confidence === "low") {
        box.classList.add("is-low-confidence");
    }

    const headline = el("div", "callout-headline");
    headline.textContent = conclusion.headline;
    box.appendChild(headline);

    if (conclusion.cause !== undefined) {
        const detail = el("div", "callout-detail");
        detail.textContent = conclusion.cause.detail;
        box.appendChild(detail);
    }
    if (conclusion.pathNote !== undefined) {
        box.appendChild(subNote(conclusion.pathNote));
    }
    if (conclusion.confidenceNote !== undefined) {
        box.appendChild(subNote(conclusion.confidenceNote));
    }
    return box;
}

/** The aligned fidelity grid: one row per layer, A and B cells sharing height. */
function grid(vm: TraceDivergenceViewModel): HTMLElement {
    const table = el("div", "fidelity-grid");

    const headerRow = el("div", "grid-row is-head");
    headerRow.appendChild(el("div", "grid-gutter"));
    headerRow.appendChild(sideHead("A", vm.a));
    headerRow.appendChild(sideHead("B", vm.b));
    table.appendChild(headerRow);

    const aByKind = byKind(vm.a);
    const bByKind = byKind(vm.b);

    for (const kind of TRACE_LAYER_ORDER) {
        const row = el("div", "grid-row");
        if (vm.divergingLayer === kind) {
            row.classList.add("is-diverging");
        }

        const gutter = el("div", "grid-gutter");
        const name = el("span", "layer-name");
        name.textContent = TRACE_LAYER_NAME[kind];
        gutter.appendChild(name);
        if (vm.divergingLayer === kind) {
            const flag = el("span", "diverge-flag");
            flag.textContent = "divergence";
            flag.title = "The first layer that explains the different actions.";
            gutter.appendChild(flag);
        }
        row.appendChild(gutter);

        row.appendChild(nodeCell(aByKind.get(kind)));
        row.appendChild(nodeCell(bByKind.get(kind)));
        table.appendChild(row);
    }
    return table;
}

function sideHead(side: "A" | "B", view: SideDivergenceView): HTMLElement {
    const head = el("div", "grid-side-head");
    head.classList.add(side === "A" ? "side-a" : "side-b");
    const tag = el("span", "side-tag");
    tag.textContent = side;
    head.appendChild(tag);
    const realization = el("span", "realization");
    realization.textContent =
        view.realization === "source" ? "grammar source" : "built live";
    realization.title =
        view.realization === "source"
            ? "Resolved from grammar source only (a git-ref side): no construction cache or wildcard validation."
            : "Resolved through the full live path, including the construction cache.";
    head.appendChild(realization);
    return head;
}

function byKind(
    view: SideDivergenceView,
): Map<ReplayTraceNode["kind"], TraceNodeSummary> {
    return new Map(view.nodes.map((n) => [n.kind, n] as const));
}

/** One fidelity node, or a placeholder when the side never ran that layer. */
function nodeCell(node: TraceNodeSummary | undefined): HTMLElement {
    const cell = el("div", "grid-cell");
    if (node === undefined) {
        cell.classList.add("is-empty");
        const dash = el("span", "empty-mark");
        dash.textContent = "—";
        dash.title = "This layer didn't run on this side.";
        cell.appendChild(dash);
        return cell;
    }

    const pills = el("div", "node-pills");
    pills.appendChild(executionPill(node.executionLabel));
    if (node.outcomeLabel !== undefined) {
        pills.appendChild(outcomePill(node.outcomeLabel));
    }
    cell.appendChild(pills);

    if (node.detail !== undefined) {
        const detail = el("div", "node-detail");
        detail.textContent = node.detail;
        cell.appendChild(detail);
    }

    if (node.grammar !== undefined) {
        cell.appendChild(grammarExtra(node.grammar));
    }
    if (node.cache !== undefined) {
        cell.appendChild(cacheExtra(node.cache));
    }
    if (node.action !== undefined) {
        cell.appendChild(actionExtra(node.action));
    }
    return cell;
}

function grammarExtra(
    grammar: NonNullable<TraceNodeSummary["grammar"]>,
): HTMLElement {
    const box = el("div", "node-extra grammar-extra");
    if (grammar.chosenRule !== undefined) {
        const rule = el("code", "mono rule");
        rule.textContent = grammar.chosenRule;
        rule.title = `Matched rule: ${grammar.chosenRule}`;
        box.appendChild(rule);
    }
    const parity = el("span", "parity-chip");
    parity.classList.add(`parity-${grammar.rankingParity}`);
    parity.textContent = grammar.rankingParityLabel;
    if (grammar.diagnosticOnly) {
        parity.title =
            "The captured parse diverges from the resolver's ranked pick, so it's diagnostic only.";
    }
    box.appendChild(parity);
    return box;
}

function cacheExtra(
    cache: NonNullable<TraceNodeSummary["cache"]>,
): HTMLElement {
    const box = el("div", "node-extra cache-extra");
    if (cache.constructionId !== undefined) {
        const id = el("code", "mono");
        id.textContent = `#${cache.constructionId}`;
        box.appendChild(id);
    }
    if (cache.namespace !== undefined) {
        const ns = el("span", "cache-ns");
        ns.textContent = cache.namespace;
        ns.title = `Namespace: ${cache.namespace}`;
        box.appendChild(ns);
    }
    return box;
}

function actionExtra(
    action: NonNullable<TraceNodeSummary["action"]>,
): HTMLElement {
    const box = el("div", "node-extra action-extra");
    if (action.actionName !== undefined) {
        const name = el("code", "mono action-name");
        name.textContent = action.actionName;
        box.appendChild(name);
    } else {
        const none = el("span", "action-none");
        none.textContent = "no action";
        box.appendChild(none);
    }
    return box;
}

function executionPill(label: string): HTMLElement {
    const pill = el("span", "pill exec-pill");
    pill.classList.add(`exec-${slug(label)}`);
    pill.textContent = label;
    return pill;
}

function outcomePill(label: string): HTMLElement {
    const pill = el("span", "pill outcome-pill");
    pill.classList.add(`outcome-${slug(label)}`);
    pill.textContent = label;
    return pill;
}

// --- State screens & bits -------------------------------------------------

function centeredState(message: string, kind: string): HTMLElement {
    const box = el("div", "state-screen");
    box.classList.add(`state-${kind}`);
    const inner = el("div", "state-inner");
    if (kind === "loading") {
        inner.appendChild(el("div", "spinner"));
    }
    const text = el("div", "state-text");
    text.textContent = message;
    inner.appendChild(text);
    box.appendChild(inner);
    return box;
}

function noteBanner(message: string): HTMLElement {
    const banner = el("div", "note-banner");
    banner.textContent = message;
    return banner;
}

function subNote(message: string): HTMLElement {
    const note = el("div", "callout-subnote");
    note.textContent = message;
    return note;
}

function sep(): HTMLElement {
    const s = el("span", "sep");
    s.textContent = "·";
    return s;
}

function arrow(): HTMLElement {
    const a = el("span", "arrow");
    a.textContent = "→";
    return a;
}

/** Whether a fresh recompute reproduced the recorded resolution. Compares both
 *  sides' final actions; any difference is drift. */
function driftNote(
    rec: ReplayResolutionTrace | undefined,
    fr: ReplayResolutionTrace | undefined,
): string {
    if (rec === undefined || fr === undefined) {
        return "Fresh replay captured.";
    }
    const drift: Drift =
        stableStringify(rec.a.finalAction) ===
            stableStringify(fr.a.finalAction) &&
        stableStringify(rec.b.finalAction) === stableStringify(fr.b.finalAction)
            ? "matches"
            : "drifted";
    return drift === "matches"
        ? "Fresh replay reproduced the recorded resolution."
        : "Fresh replay drifted from the recorded run — the working tree has changed since it was captured.";
}

// --- DOM helpers ----------------------------------------------------------

function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

function clear(node: HTMLElement): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function slug(value: string): string {
    return value.replace(/\s+/g, "-").toLowerCase();
}
