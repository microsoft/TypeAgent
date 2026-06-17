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
} from "../replayViewModel.js";

interface PanelState {
    selectedAgent?: string;
    versionA?: string;
    versionB?: string;
}
interface VsCodeApi {
    postMessage(message: WebviewToHostMessage): void;
    getState(): PanelState | undefined;
    setState(state: PanelState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// Monotonic id so a slow earlier replay can't overwrite a newer run's result.
let requestId = 0;
let latestRequestId = 0;
// Whether the service is connected with at least one corpus agent (last `init`).
// Run controls are re-enabled after a run only when this holds, so a result /
// error never re-enables Run while the service is unavailable.
let controlsAvailable = false;

const root = document.getElementById("root")!;

// --- Static shell ---------------------------------------------------------
const toolbar = el("div", "toolbar");
const statusEl = el("span", "status");
const agentSelect = document.createElement("select");
agentSelect.className = "agent-select";
agentSelect.setAttribute("aria-label", "Agent to replay");
// Two version fields drive the A→B compare. Defaults express the "find a
// regression" journey: baseline HEAD vs the live working tree (your edits).
const versionAInput = versionField("Base (A)", "HEAD", "HEAD");
const versionBInput = versionField(
    "Compare (B)",
    "working tree",
    "working tree",
);
const runButton = button("Run replay", () => runReplay());
const reconnectButton = button("Reconnect", () => {
    vscode.postMessage({ type: "reconnect" });
});
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

root.append(toolbar, bannerEl, summaryEl, comparisonEl, tableWrap);

setControlsEnabled(false);
restoreSelection();

// --- Messaging ------------------------------------------------------------
window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToWebviewMessage;
    switch (msg.type) {
        case "init":
            populateAgents(msg.agents);
            controlsAvailable = msg.connected && msg.agents.length > 0;
            setControlsEnabled(controlsAvailable);
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
            if (msg.requestId === latestRequestId) {
                renderResult(msg.payload);
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
    vscode.setState({ selectedAgent: agent, versionA, versionB });
    setControlsEnabled(false);
    setStatus(`Replaying ${agent}…`);
    summaryEl.textContent = "";
    comparisonEl.textContent = "";
    bannerEl.textContent = "";
    bannerEl.className = "banner";
    tableWrap.textContent = "";
    vscode.postMessage({ type: "run", requestId, agent, versionA, versionB });
}

function renderResult(result: StudioReplayResult): void {
    // A run-level error (a version that failed to build) aborts with an empty
    // summary — surface the failure instead of a misleading zero-row success.
    if (result.error) {
        bannerEl.className = "banner banner-error";
        bannerEl.textContent = toImpactErrorLine(result.error);
        summaryEl.textContent = "";
        comparisonEl.textContent = toImpactComparisonLine(result.summary);
        tableWrap.textContent = "";
        setStatus("Replay aborted.");
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

    summaryEl.textContent = toImpactSummaryLine(result.summary);
    comparisonEl.textContent = toImpactComparisonLine(result.summary);
    const rows = toImpactRows(result.rows);
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
    setStatus(`Done — ${shown} row(s).`);
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
): { wrap: HTMLElement; input: HTMLInputElement } {
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
    wrap.append(text, input);
    return { wrap, input };
}
