// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference lib="dom" />

/**
 * Impact Report webview client (runs inside the iframe). It renders the replay
 * results the extension host fetches over the `studio` service channel and asks
 * the host to run replays — it never opens a socket itself. Pure DOM; no `ws`,
 * `vscode`, or node built-ins (so it bundles for the browser).
 */

import type { StudioReplayResult } from "@typeagent/core/runtime";
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from "../protocol.js";
import {
    toImpactRows,
    toImpactSummaryLine,
    toImpactMethodNote,
    toImpactErrorLine,
    toImpactComparisonLine,
    toImpactHeaderFields,
    toSideMethodLabel,
} from "../replayViewModel.js";

/** A completed result persisted so the report survives navigate-away/reload. */
interface PersistedResult {
    payload: StudioReplayResult;
    /** Epoch ms the run completed, for the "restored" hint. */
    runAt: number;
}
interface PanelState {
    selectedAgent?: string;
    versionA?: string;
    versionB?: string;
    repoName?: string;
    lastResult?: PersistedResult;
}
interface VsCodeApi {
    postMessage(message: WebviewToHostMessage): void;
    getState(): PanelState | undefined;
    setState(state: PanelState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// Cap rows kept in webview state so a large run can't blow the state budget;
// the host re-pushes the full result on `ready` (recovery), so this is only the
// instant-reload snapshot.
const MAX_PERSISTED_ROWS = 200;

// Monotonic id so a slow earlier replay can't overwrite a newer run's result.
let requestId = 0;
let latestRequestId = 0;
// Whether the service is connected with at least one corpus agent (last `init`).
// Run controls are re-enabled after a run only when this holds, so a result /
// error never re-enables Run while the service is unavailable.
let controlsAvailable = false;
// Repo name for the context header (from `init`, falls back to persisted state).
let repoName: string | undefined;
// The last result rendered, so the header reflects its method/policy.
let lastRenderedResult: StudioReplayResult | undefined;

const root = document.getElementById("root")!;

// --- Static shell ---------------------------------------------------------
const headerEl = el("div", "context-header");
const toolbar = el("div", "toolbar");
const statusEl = el("span", "status");
const agentSelect = document.createElement("select");
agentSelect.className = "agent-select";
agentSelect.setAttribute("aria-label", "Agent to replay");
agentSelect.title = "The agent whose corpus is replayed and compared.";
agentSelect.addEventListener("change", () => {
    persistState({ selectedAgent: agentSelect.value });
    renderHeader();
});
// Two version fields drive the A→B compare. Defaults express the "find a
// regression" journey: baseline HEAD vs the live working tree (your edits).
const versionAInput = versionField("Base (A)", "HEAD", "HEAD");
const versionBInput = versionField(
    "Compare (B)",
    "working tree",
    "working tree",
);
const runButton = button("Run replay", () => runReplay());
runButton.title =
    "Replay the corpus against both versions and compare actions.";
const reconnectButton = button("Reconnect", () => {
    vscode.postMessage({ type: "reconnect" });
});
reconnectButton.title = "Re-attempt the connection to the studio service.";
toolbar.append(
    agentSelect,
    versionAInput.wrap,
    versionBInput.wrap,
    runButton,
    reconnectButton,
    statusEl,
);

const summaryEl = el("div", "summary");
const comparisonEl = el("div", "comparison");
const bannerEl = el("div", "banner");
const tableWrap = el("div", "table-wrap");

root.append(headerEl, toolbar, bannerEl, summaryEl, comparisonEl, tableWrap);

setControlsEnabled(false);
restoreSelection();
renderHeader();

// --- Messaging ------------------------------------------------------------
window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToWebviewMessage;
    switch (msg.type) {
        case "init":
            if (msg.repoName !== undefined) {
                repoName = msg.repoName;
                persistState({ repoName });
            }
            populateAgents(msg.agents);
            controlsAvailable = msg.connected && msg.agents.length > 0;
            setControlsEnabled(controlsAvailable);
            renderHeader();
            setStatus(
                msg.connected
                    ? msg.agents.length > 0
                        ? "Connected."
                        : "Connected — no corpus agents found."
                    : "Studio service not found — start an agent-server with the studio agent enabled.",
            );
            break;
        case "status":
            setStatus(msg.text);
            break;
        case "result":
            // Accept the matching run, or — when no run has been issued since
            // this load (id still 0) — a host recovery re-push of the last
            // result (the panel reloaded after the run finished). Adopt its id
            // so a genuinely stale earlier result can't then overwrite it.
            if (latestRequestId === 0 || msg.requestId === latestRequestId) {
                latestRequestId = msg.requestId;
                renderResult(msg.payload);
                persistResult(msg.payload);
                setControlsEnabled(controlsAvailable);
            }
            break;
        case "error":
            if (
                msg.requestId === undefined ||
                msg.requestId === latestRequestId
            ) {
                setStatus(msg.message);
                setControlsEnabled(controlsAvailable);
            }
            break;
    }
});

vscode.postMessage({ type: "ready" });

// --- Behavior -------------------------------------------------------------
function runReplay(): void {
    const agent = agentSelect.value;
    if (!agent) {
        return;
    }
    requestId += 1;
    latestRequestId = requestId;
    const versionA = versionAInput.input.value;
    const versionB = versionBInput.input.value;
    persistState({ selectedAgent: agent, versionA, versionB });
    setControlsEnabled(false);
    setStatus(`Replaying ${agent}…`);
    summaryEl.textContent = "";
    comparisonEl.textContent = "";
    bannerEl.textContent = "";
    bannerEl.className = "banner";
    tableWrap.textContent = "";
    vscode.postMessage({ type: "run", requestId, agent, versionA, versionB });
}

function renderResult(result: StudioReplayResult, restored = false): void {
    lastRenderedResult = result;
    renderHeader();
    // Reset every output region first so a render fully *replaces* the previous
    // one. `renderResult` runs more than once per result on navigate-away/back:
    // `restoreSelection` paints the persisted snapshot, then the host re-pushes
    // the full result on `ready` (recovery). The table is built with
    // `appendChild`, so without this clear the recovery render would append a
    // second table instead of upgrading the snapshot in place.
    bannerEl.className = "banner";
    bannerEl.textContent = "";
    summaryEl.textContent = "";
    comparisonEl.textContent = "";
    tableWrap.textContent = "";
    versionAInput.sub.textContent = "";
    versionBInput.sub.textContent = "";
    // A run-level error (a version that failed to build) aborts with an empty
    // summary — surface the failure instead of a misleading zero-row success.
    if (result.error) {
        bannerEl.className = "banner banner-error";
        bannerEl.textContent = toImpactErrorLine(result.error);
        summaryEl.textContent = "";
        comparisonEl.textContent = toImpactComparisonLine(result.summary);
        tableWrap.textContent = "";
        setStatus(restored ? "Restored — replay aborted." : "Replay aborted.");
        return;
    }

    const note = toImpactMethodNote(result.method);
    if (note) {
        bannerEl.className = "banner banner-note";
        bannerEl.textContent = note;
    } else {
        bannerEl.className = "banner";
        bannerEl.textContent = "";
    }

    // Per-side method under each version field: a git ref can never consult the
    // live construction cache, so this makes the A/B asymmetry explicit.
    versionAInput.sub.textContent = toSideMethodLabel(result.methodA);
    versionBInput.sub.textContent = toSideMethodLabel(result.methodB);

    summaryEl.textContent = toImpactSummaryLine(result.summary);
    comparisonEl.textContent = toImpactComparisonLine(result.summary);
    const rows = toImpactRows(result.rows, result.methodA, result.methodB);
    const shown = rows.length;
    const total = result.summary.rowCount;

    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const h of ["", "Utterance", "Detail"]) {
        const th = document.createElement("th");
        th.textContent = h;
        head.appendChild(th);
    }
    table.appendChild(head);

    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.appendChild(cell(row.statusLabel, `status-${row.status}`));
        tr.appendChild(cell(row.utterance));
        tr.appendChild(cell(row.detail, "detail"));
        table.appendChild(tr);
    }
    tableWrap.appendChild(table);

    if (shown < total) {
        const note = el("div", "truncation");
        note.textContent = `Showing first ${shown} of ${total} rows.`;
        tableWrap.appendChild(note);
    } else if (shown === 0) {
        const empty = el("div", "truncation");
        empty.textContent = "No corpus rows replayed.";
        tableWrap.appendChild(empty);
    }
    setStatus(
        restored
            ? `Restored from last run — Run for live results (${shown} row(s)).`
            : `Done — ${shown} row(s).`,
    );
}

/** Render the provenance band (`repo · agent · method · …`) from what we know. */
function renderHeader(): void {
    const agent = agentSelect.value || vscode.getState()?.selectedAgent;
    const fields = toImpactHeaderFields({
        ...(repoName !== undefined ? { repo: repoName } : {}),
        ...(agent ? { agent } : {}),
        ...(lastRenderedResult
            ? {
                  method: lastRenderedResult.method,
                  missPolicy: lastRenderedResult.summary.missPolicy,
              }
            : {}),
    });
    headerEl.textContent = "";
    fields.forEach((f, i) => {
        if (i > 0) {
            const sep = el("span", "context-sep");
            sep.textContent = "·";
            headerEl.appendChild(sep);
        }
        const item = el("span", "context-item");
        item.title = f.tooltip;
        const label = el("span", "context-label");
        label.textContent = `${f.label}:`;
        const value = el("span", "context-value");
        value.textContent = f.value;
        item.append(label, value);
        headerEl.appendChild(item);
    });
}

function populateAgents(agents: string[]): void {
    const previous = vscode.getState()?.selectedAgent;
    agentSelect.textContent = "";
    for (const a of agents) {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        agentSelect.appendChild(opt);
    }
    if (previous && agents.includes(previous)) {
        agentSelect.value = previous;
    }
}

function restoreSelection(): void {
    const state = vscode.getState();
    repoName = state?.repoName;
    const previous = state?.selectedAgent;
    if (previous) {
        const opt = document.createElement("option");
        opt.value = previous;
        opt.textContent = previous;
        agentSelect.appendChild(opt);
        agentSelect.value = previous;
    }
    if (state?.versionA !== undefined) {
        versionAInput.input.value = state.versionA;
    }
    if (state?.versionB !== undefined) {
        versionBInput.input.value = state.versionB;
    }
    // Re-render the last result immediately so navigating away and back doesn't
    // blank the report. The host also re-pushes the full result on `ready`
    // (recovery), which upgrades this possibly-truncated snapshot.
    if (state?.lastResult) {
        renderResult(state.lastResult.payload, true);
    }
}

/** Merge `extra` into the persisted panel state (setState replaces wholesale). */
function persistState(extra: Partial<PanelState>): void {
    const prev = vscode.getState() ?? {};
    try {
        vscode.setState({ ...prev, ...extra });
    } catch {
        // State quota exceeded — drop the snapshot but keep the inputs.
        const { lastResult: _drop, ...rest } = { ...prev, ...extra };
        try {
            vscode.setState(rest);
        } catch {
            // Give up on persistence; the live session is unaffected.
        }
    }
}

/** Persist a completed result (row-capped) so a reload re-renders it. */
function persistResult(payload: StudioReplayResult): void {
    const bounded =
        payload.rows.length > MAX_PERSISTED_ROWS
            ? { ...payload, rows: payload.rows.slice(0, MAX_PERSISTED_ROWS) }
            : payload;
    persistState({ lastResult: { payload: bounded, runAt: Date.now() } });
}

function setControlsEnabled(enabled: boolean): void {
    runButton.disabled = !enabled;
    agentSelect.disabled = !enabled;
    versionAInput.input.disabled = !enabled;
    versionBInput.input.disabled = !enabled;
}

function setStatus(text: string): void {
    statusEl.textContent = text;
}

// --- DOM helpers ----------------------------------------------------------
function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

function cell(text: string, className?: string): HTMLTableCellElement {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) {
        td.className = className;
    }
    return td;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}

/** A labelled version text field (e.g. "Base (A)"): label + input wrapped for
 *  the toolbar. `value` seeds the default; `placeholder` hints the keyword. */
function versionField(
    label: string,
    value: string,
    placeholder: string,
): { wrap: HTMLElement; input: HTMLInputElement; sub: HTMLElement } {
    const wrap = el("label", "version-field");
    const text = document.createElement("span");
    text.className = "version-label";
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "version-input";
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute(
        "aria-label",
        `${label} version (git ref or working tree)`,
    );
    input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" && !runButton.disabled) {
            runReplay();
        }
    });
    // Filled in after a run with how this side actually resolved (e.g.
    // "construction cache" vs "schema-enriched grammar"), so the per-side
    // method is visible right under the field rather than collapsed into the
    // single run-level chip.
    const sub = el("span", "version-method");
    sub.textContent = "";
    wrap.append(text, input, sub);
    return { wrap, input, sub };
}
