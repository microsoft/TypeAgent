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
import type { ActionDelta } from "@typeagent/core/replay";
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
    ReplaySide,
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
    formatProvenanceLine,
    toActionDiff,
    type ImpactRow,
    type ReplayRowStatus,
    type ResolvedVersion,
    type RunProvenance,
} from "../replayViewModel.js";

/** Default base (A): the last commit — the baseline of the regression journey. */
const DEFAULT_VERSION_A: ResolvedVersion = {
    spec: { kind: "git", ref: "HEAD" },
    label: "HEAD",
    tooltip: "Last commit (HEAD).",
};
/** Default compare (B): the live working tree (your uncommitted edits). */
const DEFAULT_VERSION_B: ResolvedVersion = {
    spec: { kind: "workingTree" },
    label: "working tree",
    tooltip: "Your uncommitted edits in the working tree.",
};

/** A completed result persisted so the report survives navigate-away/reload. */
interface PersistedResult {
    payload: StudioReplayResult;
    /** Resolved identity of both sides, captured at run time. */
    provenance?: RunProvenance;
    /** Epoch ms the run completed, for the "restored" hint. */
    runAt: number;
}
interface PanelState {
    selectedAgent?: string;
    versionA?: ResolvedVersion;
    versionB?: ResolvedVersion;
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
// Raw deltas of the current result keyed by utterance id, so a row drill-in can
// build the action A/B diff without the host re-sending the payload.
let currentRawById = new Map<string, ActionDelta>();
// The utterance id whose drill-in detail is open, or undefined when closed; kept
// so a filter re-render can re-assert (or drop) the open detail.
let openDetailId: string | undefined;
// Active status filter; defaults to differences-only so the report opens
// focused on regressions rather than a wall of unchanged rows.
const activeFilters = defaultImpactFilters();
// The current selection driving a run. Versions are typed specs resolved by the
// host's git picker (or the defaults); the agent comes from the agent picker.
let currentAgent: string | undefined;
let versionA: ResolvedVersion = DEFAULT_VERSION_A;
let versionB: ResolvedVersion = DEFAULT_VERSION_B;

const root = document.getElementById("root")!;

// --- Static shell ---------------------------------------------------------
const toolbar = el("div", "toolbar");
const statusEl = el("span", "status");
// The agent and both versions are chosen through native VS Code QuickPicks the
// host opens (the webview can't shell out to git); each control is a button that
// shows the current selection and asks the host to open the relevant picker.
const agentButton = pickerButton(
    "agent",
    "The agent whose corpus is replayed and compared.",
    () => vscode.postMessage({ type: "pickAgent" }),
);
const versionAButton = pickerButton(
    "Base (A)",
    "Choose the base (A) version to compare from.",
    () => vscode.postMessage({ type: "pickVersion", side: "a" }),
);
const versionBButton = pickerButton(
    "Compare (B)",
    "Choose the compare (B) version to compare to.",
    () => vscode.postMessage({ type: "pickVersion", side: "b" }),
);
const swapButton = iconButton("\u21c4", "Swap A and B", () => swapVersions());
swapButton.title = "Swap the base (A) and compare (B) versions.";
const runButton = iconButton("\u25b6", "Run replay", () => runReplay());
runButton.title =
    "Replay the corpus against both versions and compare actions.";
const reconnectButton = iconButton("\u21bb", "Reconnect", () => {
    vscode.postMessage({ type: "reconnect" });
});
reconnectButton.title = "Re-attempt the connection to the studio service.";
toolbar.append(
    agentButton.wrap,
    versionAButton.wrap,
    swapButton,
    versionBButton.wrap,
    runButton,
    reconnectButton,
    statusEl,
);

const bannerEl = el("div", "banner");
const filtersEl = el("div", "filters");
const emptyStateEl = el("div", "empty-state");
const tableWrap = el("div", "table-wrap");
const detailEl = el("div", "detail-pane");
detailEl.hidden = true;

root.append(toolbar, bannerEl, filtersEl, emptyStateEl, tableWrap, detailEl);

setControlsEnabled(false);
restoreSelection();
renderVersionButtons();

// --- Messaging ------------------------------------------------------------
window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToWebviewMessage;
    switch (msg.type) {
        case "init":
            adoptAgents(msg.agents);
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
        case "versionPicked":
            applyVersionPick(msg.side, msg.resolved);
            break;
        case "agentPicked":
            currentAgent = msg.agent;
            renderAgentButton();
            persistState({ selectedAgent: msg.agent });
            renderEmptyState();
            break;
        case "result":
            // Accept the matching run, or — when no run has been issued since
            // this load (id still 0) — a host recovery re-push of the last
            // result (the panel reloaded after the run finished). Adopt its id
            // so a genuinely stale earlier result can't then overwrite it.
            if (latestRequestId === 0 || msg.requestId === latestRequestId) {
                latestRequestId = msg.requestId;
                renderResult(msg.payload, false, msg.provenance);
                persistResult(msg.payload, msg.provenance);
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
    const agent = currentAgent;
    if (!agent) {
        return;
    }
    requestId += 1;
    latestRequestId = requestId;
    persistState({ selectedAgent: agent, versionA, versionB });
    setControlsEnabled(false);
    setStatus(`Replaying ${agent}…`);
    bannerEl.textContent = "";
    bannerEl.className = "banner";
    filtersEl.textContent = "";
    filtersEl.hidden = true;
    emptyStateEl.hidden = true;
    currentRows = [];
    currentRawById = new Map();
    closeDetail();
    tableWrap.textContent = "";
    vscode.postMessage({
        type: "run",
        requestId,
        agent,
        versionA: versionA.spec,
        versionB: versionB.spec,
    });
}

/** Apply a version selection from the host picker to one side. */
function applyVersionPick(side: ReplaySide, resolved: ResolvedVersion): void {
    if (side === "a") {
        versionA = resolved;
    } else {
        versionB = resolved;
    }
    renderVersionButtons();
    persistState({ versionA, versionB });
}

/** Swap the base (A) and compare (B) versions. */
function swapVersions(): void {
    const tmp = versionA;
    versionA = versionB;
    versionB = tmp;
    renderVersionButtons();
    persistState({ versionA, versionB });
}

function renderResult(
    result: StudioReplayResult,
    restored = false,
    provenance?: RunProvenance,
): void {
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
    currentRawById = new Map(result.rows.map((r) => [r.utteranceId, r]));
    closeDetail();
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
    versionAButton.button.title = `${versionA.tooltip}\nResolved via ${toSideMethodLabel(
        result.methodA,
    )}`;
    versionBButton.button.title = `${versionB.tooltip}\nResolved via ${toSideMethodLabel(
        result.methodB,
    )}`;

    // The provenance line pins the report to the concrete commits it ran
    // against, so a later branch move doesn't make a bare HEAD label lie.
    if (provenance) {
        bannerEl.className = "banner banner-provenance";
        bannerEl.textContent = formatProvenanceLine(provenance);
    }

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
        // Difference rows drill into an action A/B diff; equal rows have nothing
        // to compare, so they stay inert.
        if (row.status !== "equal" && currentRawById.has(row.utteranceId)) {
            tr.classList.add("row-clickable");
            if (row.utteranceId === openDetailId) {
                tr.classList.add("row-open");
            }
            tr.tabIndex = 0;
            tr.setAttribute("role", "button");
            tr.title = "Show the action A/B diff for this utterance.";
            tr.addEventListener("click", () => openDetail(row.utteranceId));
            tr.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDetail(row.utteranceId);
                }
            });
        }
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

/** Open the row drill-in for `utteranceId`, rendering the action A/B diff. The
 *  raw delta is looked up from the current result; a missing id closes the pane
 *  (e.g. the row was filtered out by a status change). */
function openDetail(utteranceId: string): void {
    const delta = currentRawById.get(utteranceId);
    if (!delta) {
        closeDetail();
        return;
    }
    openDetailId = utteranceId;
    renderDetail(delta);
    // Re-render the table so the open row gets its highlight.
    renderTable();
    detailEl.scrollIntoView({ block: "nearest" });
}

/** Hide and clear the drill-in detail pane. */
function closeDetail(): void {
    openDetailId = undefined;
    detailEl.hidden = true;
    detailEl.textContent = "";
}

/** Paint the detail pane: a header (utterance + close) and the unified A/B diff
 *  of the two resolved actions. */
function renderDetail(delta: ActionDelta): void {
    detailEl.textContent = "";
    const diff = toActionDiff(delta);

    const header = el("div", "detail-header");
    const title = el("span", "detail-title");
    title.textContent = collapseWhitespace(delta.utterance);
    title.title = delta.utterance;
    const meta = el("span", "detail-meta");
    meta.textContent = diff.onlyB
        ? "new match (no action on A)"
        : diff.onlyA
          ? "lost match (no action on B)"
          : diff.identical
            ? "actions identical"
            : `+${diff.addedCount} \u2212${diff.removedCount}`;
    const close = iconButton("\u2715", "Close detail", () => closeDetail());
    close.classList.add("detail-close");
    header.append(title, meta, close);

    const legend = el("div", "detail-legend");
    legend.textContent = "Base (A) \u2192 Compare (B)";

    const body = el("pre", "detail-diff");
    for (const line of diff.lines) {
        const span = document.createElement("span");
        span.className = `diff-line diff-${line.kind}`;
        const sign =
            line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
        span.textContent = `${sign} ${line.text}\n`;
        body.appendChild(span);
    }

    detailEl.append(header, legend, body);
    detailEl.hidden = false;
}

/** Collapse runs of whitespace to single spaces for a compact one-line header. */
function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
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

function adoptAgents(agents: string[]): void {
    // Keep the persisted/selected agent if still available; otherwise default to
    // the first agent so a newcomer can run without opening the picker first.
    if (currentAgent && agents.includes(currentAgent)) {
        // keep it
    } else if (agents.length > 0) {
        currentAgent = agents[0];
        persistState({ selectedAgent: currentAgent });
    }
    renderAgentButton();
}

function restoreSelection(): void {
    const state = vscode.getState();
    if (state?.selectedAgent) {
        currentAgent = state.selectedAgent;
    }
    if (state?.versionA) {
        versionA = state.versionA;
    }
    if (state?.versionB) {
        versionB = state.versionB;
    }
    renderAgentButton();
    // Re-render the last result immediately so navigating away and back doesn't
    // blank the report. The host also re-pushes the full result on `ready`
    // (recovery), which upgrades this possibly-truncated snapshot.
    if (state?.lastResult) {
        renderResult(
            state.lastResult.payload,
            true,
            state.lastResult.provenance,
        );
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
function persistResult(
    payload: StudioReplayResult,
    provenance?: RunProvenance,
): void {
    const bounded =
        payload.rows.length > MAX_PERSISTED_ROWS
            ? { ...payload, rows: payload.rows.slice(0, MAX_PERSISTED_ROWS) }
            : payload;
    persistState({
        lastResult: {
            payload: bounded,
            runAt: Date.now(),
            ...(provenance ? { provenance } : {}),
        },
    });
}

function setControlsEnabled(enabled: boolean): void {
    runButton.disabled = !enabled;
    swapButton.disabled = !enabled;
    agentButton.button.disabled = !enabled;
    versionAButton.button.disabled = !enabled;
    versionBButton.button.disabled = !enabled;
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

/** A labelled picker button (e.g. "Base (A)") that shows the current selection
 *  and asks the host to open the relevant native QuickPick on click. */
function pickerButton(
    label: string,
    description: string,
    onClick: () => void,
): { wrap: HTMLElement; button: HTMLButtonElement; value: HTMLElement } {
    const wrap = el("label", "picker-field");
    const text = document.createElement("span");
    text.className = "picker-label";
    text.textContent = label;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-button";
    button.title = description;
    button.setAttribute("aria-label", `${label}: choose`);
    const value = document.createElement("span");
    value.className = "picker-value";
    button.appendChild(value);
    button.addEventListener("click", onClick);
    wrap.append(text, button);
    return { wrap, button, value };
}

/** Paint both version buttons with their current labels and tooltips. */
function renderVersionButtons(): void {
    versionAButton.value.textContent = versionA.label;
    versionAButton.button.title = versionA.tooltip;
    versionBButton.value.textContent = versionB.label;
    versionBButton.button.title = versionB.tooltip;
}

/** Paint the agent button with the current selection (or a prompt). */
function renderAgentButton(): void {
    agentButton.value.textContent = currentAgent ?? "Select agent";
}
