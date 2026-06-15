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
import { toImpactRows, toImpactSummaryLine } from "../replayViewModel.js";

interface VsCodeApi {
    postMessage(message: WebviewToHostMessage): void;
    getState(): { selectedAgent?: string } | undefined;
    setState(state: { selectedAgent?: string }): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

// Monotonic id so a slow earlier replay can't overwrite a newer run's result.
let requestId = 0;
let latestRequestId = 0;

const root = document.getElementById("root")!;

// --- Static shell ---------------------------------------------------------
const toolbar = el("div", "toolbar");
const statusEl = el("span", "status");
const agentSelect = document.createElement("select");
agentSelect.className = "agent-select";
agentSelect.setAttribute("aria-label", "Agent to replay");
const runButton = button("Run replay", () => runReplay());
const reconnectButton = button("Reconnect", () => {
    vscode.postMessage({ type: "reconnect" });
});
toolbar.append(agentSelect, runButton, reconnectButton, statusEl);

const summaryEl = el("div", "summary");
const tableWrap = el("div", "table-wrap");

root.append(toolbar, summaryEl, tableWrap);

setControlsEnabled(false);
restoreSelection();

// --- Messaging ------------------------------------------------------------
window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToWebviewMessage;
    switch (msg.type) {
        case "init":
            populateAgents(msg.agents);
            setControlsEnabled(msg.connected && msg.agents.length > 0);
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
                setControlsEnabled(true);
            }
            break;
        case "error":
            if (
                msg.requestId === undefined ||
                msg.requestId === latestRequestId
            ) {
                setStatus(msg.message);
                setControlsEnabled(true);
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
    vscode.setState({ selectedAgent: agent });
    setControlsEnabled(false);
    setStatus(`Replaying ${agent}…`);
    summaryEl.textContent = "";
    tableWrap.textContent = "";
    vscode.postMessage({ type: "run", requestId, agent });
}

function renderResult(result: StudioReplayResult): void {
    summaryEl.textContent = toImpactSummaryLine(result.summary);
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
    const previous = vscode.getState()?.selectedAgent;
    if (previous) {
        const opt = document.createElement("option");
        opt.value = previous;
        opt.textContent = previous;
        agentSelect.appendChild(opt);
        agentSelect.value = previous;
    }
}

function setControlsEnabled(enabled: boolean): void {
    runButton.disabled = !enabled;
    agentSelect.disabled = !enabled;
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
