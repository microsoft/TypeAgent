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
    toImpactMethodNote,
    toImpactErrorLine,
    toSideMethodLabel,
    buildImpactFilterChips,
    filterImpactRows,
    defaultImpactFilters,
    allStatusesActive,
    impactFilterNote,
    impactEmptyState,
    allRowsEqual,
    type ImpactRow,
    type ReplayRowStatus,
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
// The last result rendered, so the fidelity tooltip and per-side resolution
// reflect the current run; also gates the first-run empty state.
let lastRenderedResult: StudioReplayResult | undefined;
// Rows from the last rendered result and the run's true total, kept so the
// status filter can re-render the table without re-fetching.
let currentRows: ImpactRow[] = [];
let currentTotal = 0;
// Active status filter; defaults to differences-only so the report opens
// focused on regressions rather than a wall of unchanged rows.
const activeFilters = defaultImpactFilters();

const root = document.getElementById("root")!;

// --- Static shell ---------------------------------------------------------
const toolbar = el("div", "toolbar");
const statusEl = el("span", "status");
const agentSelect = document.createElement("select");
agentSelect.className = "agent-select";
agentSelect.setAttribute("aria-label", "Agent to replay");
agentSelect.title = "The agent whose corpus is replayed and compared.";
agentSelect.addEventListener("change", () => {
    persistState({ selectedAgent: agentSelect.value });
});
// Two version fields drive the A→B compare. Defaults express the "find a
// regression" journey: baseline HEAD vs the live working tree (your edits).
const versionAInput = versionField("Base (A)", "HEAD", "HEAD");
const versionBInput = versionField(
    "Compare (B)",
    "working tree",
    "working tree",
);
const runButton = iconButton("\u25b6", "Run replay", () => runReplay());
runButton.title =
    "Replay the corpus against both versions and compare actions.";
const reconnectButton = iconButton("\u21bb", "Reconnect", () => {
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

const bannerEl = el("div", "banner");
const filtersEl = el("div", "filters");
const emptyStateEl = el("div", "empty-state");
const tableWrap = el("div", "table-wrap");

root.append(toolbar, bannerEl, filtersEl, emptyStateEl, tableWrap);

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
            renderEmptyState();
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
    bannerEl.textContent = "";
    bannerEl.className = "banner";
    filtersEl.textContent = "";
    filtersEl.hidden = true;
    emptyStateEl.hidden = true;
    currentRows = [];
    tableWrap.textContent = "";
    vscode.postMessage({ type: "run", requestId, agent, versionA, versionB });
}

function renderResult(result: StudioReplayResult, restored = false): void {
    lastRenderedResult = result;
    // Reset every output region first so a render fully *replaces* the previous
    // one. `renderResult` runs more than once per result on navigate-away/back:
    // `restoreSelection` paints the persisted snapshot, then the host re-pushes
    // the full result on `ready` (recovery). The table is built with
    // `appendChild`, so without this clear the recovery render would append a
    // second table instead of upgrading the snapshot in place.
    bannerEl.className = "banner";
    bannerEl.textContent = "";
    filtersEl.textContent = "";
    filtersEl.hidden = true;
    emptyStateEl.hidden = true;
    tableWrap.textContent = "";
    statusEl.title = "";
    currentRows = [];
    // A run-level error (a version that failed to build) aborts with an empty
    // summary — surface the failure instead of a misleading zero-row success.
    if (result.error) {
        bannerEl.className = "banner banner-error";
        bannerEl.textContent = toImpactErrorLine(result.error);
        setStatus(restored ? "Restored — replay aborted." : "Replay aborted.");
        return;
    }

    // The fidelity caveat (e.g. "indicative, not authoritative") and how each
    // side resolved are kept as hover detail rather than visible banners so the
    // report stays compact without losing the warning.
    statusEl.title = toImpactMethodNote(result.method) ?? "";
    versionAInput.input.title = `Base (A) resolved via ${toSideMethodLabel(
        result.methodA,
    )}`;
    versionBInput.input.title = `Compare (B) resolved via ${toSideMethodLabel(
        result.methodB,
    )}`;

    currentRows = toImpactRows(result.rows, result.methodA, result.methodB);
    currentTotal = result.summary.rowCount;

    renderFilters();
    renderTable();

    const shown = currentRows.length;
    const ms = result.summary.duration;
    setStatus(
        restored
            ? `Restored from last run — Run for live results (${shown} row(s)).`
            : `Done — ${shown} row(s) \u00b7 ${ms}ms.`,
    );
}

/** Paint the status filter chips for the rows of the current result. */
function renderFilters(): void {
    filtersEl.textContent = "";
    const chips = buildImpactFilterChips(currentRows);
    // Nothing to filter (no rows, or an error/empty run) — keep the bar hidden.
    if (currentRows.length === 0) {
        filtersEl.hidden = true;
        return;
    }
    filtersEl.hidden = false;

    // The "All" pill resets the view to every row; it reads as active whenever
    // nothing with rows is hidden.
    filtersEl.appendChild(
        chipButton(
            "All",
            currentRows.length,
            allStatusesActive(chips, activeFilters),
            false,
            selectAllFilters,
        ),
    );

    for (const chip of chips) {
        const isActive = activeFilters.has(chip.status);
        const isEmpty = chip.count === 0;
        // A status with no rows is nothing to filter on — show it for context
        // (a count of 0 is informative) but make it inert.
        filtersEl.appendChild(
            chipButton(chip.label, chip.count, isActive, isEmpty, () =>
                toggleFilter(chip.status),
            ),
        );
    }
}

/** Build one filter pill button. Empty (zero-count) chips render inert. */
function chipButton(
    label: string,
    count: number,
    isActive: boolean,
    isEmpty: boolean,
    onClick: () => void,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    const classes = ["filter-chip"];
    if (isActive) classes.push("is-active");
    if (isEmpty) classes.push("is-empty");
    button.className = classes.join(" ");
    button.setAttribute("aria-pressed", String(isActive));
    button.textContent = `${label} ${count}`;
    if (isEmpty) {
        button.disabled = true;
    } else {
        button.addEventListener("click", onClick);
    }
    return button;
}

/** Reset the active filter to every status (the "All" view). */
function selectAllFilters(): void {
    for (const status of defaultImpactFilters()) {
        activeFilters.add(status);
    }
    renderFilters();
    renderTable();
}

/** Toggle one status in the active filter and re-render the table in place. */
function toggleFilter(status: ReplayRowStatus): void {
    if (activeFilters.has(status)) {
        activeFilters.delete(status);
    } else {
        activeFilters.add(status);
    }
    renderFilters();
    renderTable();
}

/** Build the rows table from `currentRows`, honouring the active filter. */
function renderTable(): void {
    tableWrap.textContent = "";
    const rows = filterImpactRows(currentRows, activeFilters);

    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const h of [
        "Utterance",
        "Status",
        "Base (A)",
        "Compare (B)",
        "Latency",
    ]) {
        const th = document.createElement("th");
        th.textContent = h;
        head.appendChild(th);
    }
    table.appendChild(head);

    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.appendChild(cell(row.utterance));
        tr.appendChild(cell(row.statusLabel, `status-${row.status}`));
        tr.appendChild(cell(row.resolutionA, "resolution"));
        tr.appendChild(cell(row.resolutionB, "resolution"));
        tr.appendChild(cell(row.latency, "latency"));
        table.appendChild(tr);
    }
    tableWrap.appendChild(table);

    const chips = buildImpactFilterChips(currentRows);
    if (rows.length === 0) {
        // Distinguish "filtered everything out" from a genuinely all-equal run
        // (the happy path of the regression journey: nothing changed).
        const empty = el("div", "truncation");
        empty.textContent = allRowsEqual(currentRows)
            ? `No differences — all ${currentRows.length} row(s) are equal between A and B.`
            : "No rows match the active filter.";
        tableWrap.appendChild(empty);
    } else {
        const hiddenNote = impactFilterNote(chips, activeFilters);
        if (hiddenNote) {
            const note = el("div", "truncation");
            note.textContent = hiddenNote;
            tableWrap.appendChild(note);
        }
    }

    // The host may cap the rows it sends; chips count the received rows, so a
    // separate note reports the run's true total when it was truncated.
    if (currentRows.length < currentTotal) {
        const note = el("div", "truncation");
        note.textContent = `Showing first ${currentRows.length} of ${currentTotal} rows.`;
        tableWrap.appendChild(note);
    }
}

/**
 * First-run guidance: shown only before any replay has run and once the
 * controls are usable, so a newcomer knows what the report does and how to
 * start. Hidden the moment a run starts or a result/error arrives.
 */
function renderEmptyState(): void {
    if (lastRenderedResult || !controlsAvailable) {
        emptyStateEl.hidden = true;
        return;
    }
    emptyStateEl.textContent = "";
    const state = impactEmptyState();
    const title = el("div", "empty-state-title");
    title.textContent = state.title;
    const hint = el("div", "empty-state-hint");
    hint.textContent = state.hint;
    emptyStateEl.append(title, hint);
    emptyStateEl.hidden = false;
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

/** A compact icon button (e.g. ▶ run, ↻ reconnect). `glyph` is the visible
 *  symbol; `label` is the accessible name and hover title. */
function iconButton(
    glyph: string,
    label: string,
    onClick: () => void,
): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "icon-button";
    b.textContent = glyph;
    b.setAttribute("aria-label", label);
    b.title = label;
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
