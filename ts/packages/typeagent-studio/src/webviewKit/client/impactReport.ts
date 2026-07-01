// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/// <reference lib="dom" />

/**
 * Impact Report webview client (runs inside the iframe). It renders the replay
 * results the extension host fetches over the `studio` service channel and asks
 * the host to run replays — it never opens a socket itself. Pure DOM; no `ws`,
 * `vscode`, or node built-ins (so it bundles for the browser).
 */

import type {
    StudioReplayResult,
    StudioReplayMode,
    StudioWildcardValidationInfo,
    WildcardValidationDiagnostic,
} from "@typeagent/core/runtime";
import type { ActionDelta } from "@typeagent/core/replay";
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
    ReplaySide,
    ConnectionState,
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
    formatVersionProvenance,
    toActionDiff,
    toFidelityMatrix,
    type ImpactRow,
    type ReplayRowStatus,
    type ResolvedVersion,
    type RunProvenance,
    type FidelityCell,
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
    /** Epoch ms the run completed, shown as the "Last run" timestamp. */
    runAt: number;
}
interface PanelState {
    selectedAgent?: string;
    versionA?: ResolvedVersion;
    versionB?: ResolvedVersion;
    mode?: StudioReplayMode;
    validateWildcards?: boolean;
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
// The utterance id of the visually selected row (turns blue). Tracked separately
// from openDetailId so equal rows — which have no A/B diff to show — can still
// read as "selected" while the detail pane stays closed.
let selectedId: string | undefined;
// Active status filter; defaults to all statuses (the "All" pill is lit), so a
// fresh report shows every row and the user narrows with the filter chips.
const activeFilters = defaultImpactFilters();
// The current selection driving a run. Versions are typed specs resolved by the
// host's git picker (or the defaults); the agent is fixed for the panel (set
// from the host `init`, shown read-only and in the tab title).
let currentAgent: string | undefined;
let versionA: ResolvedVersion = DEFAULT_VERSION_A;
let versionB: ResolvedVersion = DEFAULT_VERSION_B;
// Which deterministic dispatch path the next run models. `nfa-grammar` (default)
// matches both sides against the compiled grammar only — symmetric, no cache.
// `completionBased-cache` lets the working-tree side consult the live
// construction cache first (the default-dispatcher path). Persisted with the
// version selection so a reload keeps the chosen mode.
let mode: StudioReplayMode = "nfa-grammar";

// Opt-in wildcard validation. When lit, the run asks the host to additionally
// run the agent's real `validateWildcardMatch` over the working-tree side's
// wildcard matches. Off by default and only available when the agent actually
// has a validator to run (`agentCanValidate`); persisted with the rest of the
// selection so a reload keeps the choice. The host/runtime fail-open it when no
// validator runs and report that back via `wildcardValidation.diagnostics`,
// which `renderValidationNote` surfaces.
let validateWildcards = false;
// Whether wildcard validation can run for the scoped agent (it has a validator),
// from the host `init`. Enables the toggle; when false the toggle is disabled
// because there is nothing to run.
let agentCanValidate = false;

/** Concise hover copy for the Cache on/off toggle. */
const CACHE_TOOLTIP: Record<"on" | "off", string> = {
    on: "Cache on: the working-tree side consults the live construction cache before the grammar. Click to turn off.",
    off: "Cache off: both sides match grammar only and stay symmetric. Click to turn on.",
};
/** Concise hover copy for the Wildcard validation on/off toggle. */
const VALIDATE_TOOLTIP: Record<"on" | "off", string> = {
    on: "Wildcard validation on: the working-tree side runs the agent's real validator over wildcard matches. Click to turn off.",
    off: "Wildcard validation off: matches come from the grammar alone. Click to turn on.",
};
/** Hover copy when the toggle is disabled because the agent has no wildcard
 *  validator to run in replay. */
const VALIDATE_DISABLED_TOOLTIP =
    "Wildcard validation unavailable: this agent has no validateWildcardMatch to run in replay.";

const root = document.getElementById("root")!;

// --- Static shell ---------------------------------------------------------
// A native-feeling action bar: the agent this report is scoped to (read-only —
// the report is opened per agent from the Corpora view), the A ⇄ B version
// dropdowns, then the primary Run action and a connection indicator (the views
// auto-reconnect, so there is no manual reconnect button). Both versions
// are chosen through native VS Code QuickPicks the host opens (the webview can't
// shell out to git); each control shows the current selection and asks the host
// to open the relevant picker.
const actionBar = el("div", "action-bar");

// The agent is fixed for the panel's lifetime; show it (also in the tab title)
// so a report placed side-by-side with another stays self-identifying.
const agentNameEl = el("span", "agent-name");
const versionAButton = picker(
    "Choose the base (A) version to compare from.",
    () => vscode.postMessage({ type: "pickVersion", side: "a" }),
    "A",
);
const versionBButton = picker(
    "Choose the compare (B) version to compare to.",
    () => vscode.postMessage({ type: "pickVersion", side: "b" }),
    "B",
);
const swapButton = toolButton("arrow-swap", "Swap A and B", () =>
    swapVersions(),
);
swapButton.title = "Swap the base (A) and compare (B) versions.";

// Replay options (construction cache, wildcard validation) are advanced knobs
// that most runs leave at their defaults, so they live behind a gear popover
// rather than cluttering the toolbar. Each is a VS Code-themed on/off switch
// (see `.switch` in the stylesheet); the gear lights up while the popover open.
const cacheSwitch = settingsSwitch(
    "Cache",
    () => mode === "completionBased-cache",
    () => toggleCache(),
    (on) => CACHE_TOOLTIP[on ? "on" : "off"],
);
const validateSwitch = settingsSwitch(
    "Wildcard validation",
    () => validateWildcards,
    () => toggleValidateWildcards(),
    (on) =>
        agentCanValidate
            ? VALIDATE_TOOLTIP[on ? "on" : "off"]
            : VALIDATE_DISABLED_TOOLTIP,
);
const settingsPopover = el("div", "settings-popover");
settingsPopover.setAttribute("role", "group");
settingsPopover.setAttribute("aria-label", "Replay options");
settingsPopover.hidden = true;
// The validation switch carries a caption: a note when there's no validator to
// run, and a caution when validation is turned on (the real validator may have
// side effects or be non-deterministic, so replay results may not reproduce).
const validateNote = el("div", "switch-note");
const validateGroup = el("div", "switch-group");
validateGroup.append(validateSwitch.row, validateNote);
settingsPopover.append(cacheSwitch.row, validateGroup);
const settingsButton = toolButton("settings-gear", "Replay options", () =>
    toggleSettingsPopover(),
);
settingsButton.setAttribute("aria-haspopup", "true");
settingsButton.setAttribute("aria-expanded", "false");
const settingsGroup = el("div", "bar-group settings-group");
settingsGroup.append(settingsButton, settingsPopover);
const runButton = toolButton("play", "Run", () => runReplay(), {
    primary: true,
    text: "Run",
});
runButton.title =
    "Replay the corpus against both versions and compare actions.";

// A single connection indicator (no manual reconnect button): it mirrors the
// shared service connection and reflects auto-reconnect. Painted by
// `renderConnection` from the host's `connection` messages.
const connectionPill = el("div", "conn-pill");

actionBar.append(
    group(codicon("library"), agentNameEl),
    separator(),
    group(versionAButton.button, swapButton, versionBButton.button),
    separator(),
    settingsGroup,
    spacer(),
    runButton,
    connectionPill,
);

// A slim sub-bar under the toolbar carries the run provenance (the concrete
// commits each side ran against) and the live status text.
const subBar = el("div", "sub-bar");
const provenanceEl = el("span", "provenance");
const validationEl = el("span", "validation-note");
const statusEl = el("span", "status");
subBar.append(provenanceEl, validationEl, statusEl);

// The scrolling content region: an inline error notification, the per-side
// fidelity matrix, the status filter, first-run guidance, the results list, and
// the drill-in detail pane.
const contentEl = el("div", "content");
const notificationEl = el("div", "notification");
const fidelityEl = el("div", "fidelity-panel");
fidelityEl.hidden = true;
const filtersEl = el("div", "filters");
const emptyStateEl = el("div", "empty-state");
const tableWrap = el("div", "table-wrap");
const detailEl = el("div", "detail-pane");
detailEl.hidden = true;
contentEl.append(
    notificationEl,
    fidelityEl,
    filtersEl,
    emptyStateEl,
    tableWrap,
    detailEl,
);

root.append(actionBar, subBar, contentEl);

setControlsEnabled(false);
renderConnection("connecting");
restoreSelection();
renderVersionButtons();
cacheSwitch.render();
validateSwitch.render();
renderValidateNote();

// Dismiss the replay-options popover on an outside click or Escape, the way a
// native menu behaves. The gear's own click is inside `settingsGroup`, so it
// toggles without this handler immediately re-closing it.
document.addEventListener("click", (event) => {
    if (
        !settingsPopover.hidden &&
        !settingsGroup.contains(event.target as Node)
    ) {
        toggleSettingsPopover(false);
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsPopover.hidden) {
        toggleSettingsPopover(false);
        settingsButton.focus();
    }
});

// --- Messaging ------------------------------------------------------------
window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as HostToWebviewMessage;
    switch (msg.type) {
        case "init":
            currentAgent = msg.agent;
            renderAgentName();
            // Wildcard validation can only run when the agent has a validator;
            // otherwise force the request off and disable the toggle. When a
            // validator exists, keep the persisted choice (default off).
            agentCanValidate = msg.canValidateWildcards;
            if (!agentCanValidate) {
                validateWildcards = false;
            }
            validateSwitch.render();
            renderValidateNote();
            controlsAvailable = msg.connected && msg.available;
            setControlsEnabled(controlsAvailable);
            renderEmptyState();
            // The connection pill conveys reachability; keep the status line for
            // the agent-specific caveat (or clear it when all is well).
            setStatus(
                msg.connected
                    ? msg.available
                        ? ""
                        : `No corpus found for ${msg.agent}.`
                    : "Couldn't reach the Studio service.",
            );
            break;
        case "connection":
            renderConnection(msg.state);
            // While not connected, keep the controls off and drop any stale
            // status text; a reconnect re-pushes init, which re-enables them.
            if (msg.state !== "connected") {
                controlsAvailable = false;
                setControlsEnabled(false);
                setStatus("");
            }
            break;
        case "status":
            setStatus(msg.text);
            break;
        case "versionPicked":
            applyVersionPick(msg.side, msg.resolved);
            break;
        case "result":
            // Accept the matching run, or — when no run has been issued since
            // this load (id still 0) — a host recovery re-push of the last
            // result (the panel reloaded after the run finished, or a cached
            // prior run seeded from the durable store on open). Adopt its id so a
            // genuinely stale earlier result can't then overwrite it. An external
            // push (a Replay launched from the Corpora view) is accepted
            // regardless of this panel's own request-id sequence, without
            // adopting its id, so a later in-panel run still dedupes normally.
            if (
                msg.external ||
                latestRequestId === 0 ||
                msg.requestId === latestRequestId
            ) {
                if (!msg.external) {
                    latestRequestId = msg.requestId;
                }
                // Recover the launch controls to the run's versions. On a fresh
                // panel (reopened after close) the webview's own getState is empty,
                // so the host-carried selection is the only way to show which
                // versions the restored run compared. Harmless on a live run (the
                // echoed selection matches what's already shown).
                if (msg.versionA && msg.versionB) {
                    versionA = msg.versionA;
                    versionB = msg.versionB;
                    renderVersionButtons();
                    persistState({ versionA, versionB });
                }
                renderResult(msg.payload, msg.provenance, msg.runAt);
                persistResult(msg.payload, msg.provenance, msg.runAt);
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
    persistState({
        selectedAgent: agent,
        versionA,
        versionB,
        mode,
        validateWildcards,
    });
    setControlsEnabled(false);
    setStatus(`Replaying ${agent}…`);
    clearNotification();
    provenanceEl.textContent = "";
    validationEl.textContent = "";
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
        resolvedA: versionA,
        resolvedB: versionB,
        mode,
        validateWildcards,
    });
}

/** Flip the construction cache on/off and persist the choice. */
function toggleCache(): void {
    mode = mode === "nfa-grammar" ? "completionBased-cache" : "nfa-grammar";
    cacheSwitch.render();
    persistState({ mode });
}

/** Toggle opt-in wildcard validation and persist the choice. */
function toggleValidateWildcards(): void {
    validateWildcards = !validateWildcards;
    validateSwitch.render();
    renderValidateNote();
    persistState({ validateWildcards });
}

/** Caption the validation switch for the scoped agent. When there's no validator
 *  to run, show a neutral note explaining why the toggle is disabled. When
 *  validation is turned on, caution that the real validator may have side effects
 *  or be non-deterministic, so replay results may not reproduce. Otherwise hide
 *  the caption. */
function renderValidateNote(): void {
    validateNote.textContent = "";
    if (!agentCanValidate) {
        validateNote.hidden = false;
        validateNote.classList.remove("is-caution");
        validateNote.append(
            codicon("info"),
            text("No wildcard validator to run for this agent."),
        );
        return;
    }
    if (!validateWildcards) {
        validateNote.hidden = true;
        validateNote.classList.remove("is-caution");
        return;
    }
    validateNote.hidden = false;
    validateNote.classList.add("is-caution");
    validateNote.append(
        codicon("warning"),
        text(
            "May be unsafe: the validator can have side effects or be non-deterministic, so replay results may not reproduce.",
        ),
    );
}

/** Open/close the replay-options popover. Pass `force` to set a specific
 *  state; omit to flip the current one. */
function toggleSettingsPopover(force?: boolean): void {
    const open = force ?? settingsPopover.hidden;
    settingsPopover.hidden = !open;
    settingsButton.classList.toggle("is-active", open);
    settingsButton.setAttribute("aria-expanded", String(open));
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
    provenance?: RunProvenance,
    runAt?: number,
): void {
    lastRenderedResult = result;
    // Reset every output region first so a render fully *replaces* the previous
    // one. `renderResult` runs more than once per result on navigate-away/back:
    // `restoreSelection` paints the persisted snapshot, then the host re-pushes
    // the full result on `ready` (recovery). The table is built with
    // `appendChild`, so without this clear the recovery render would append a
    // second table instead of upgrading the snapshot in place.
    clearNotification();
    provenanceEl.textContent = "";
    validationEl.textContent = "";
    validationEl.classList.remove("is-degraded");
    fidelityEl.textContent = "";
    fidelityEl.hidden = true;
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
        showNotification(toImpactErrorLine(result.error));
        setStatus("Replay aborted.");
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
        renderProvenance(provenance);
    }

    // Surface the opt-in wildcard-validation outcome, including an honest
    // "unavailable" state when the validator couldn't load (e.g. packaged build).
    renderValidationNote(result.wildcardValidation);

    // The per-side fidelity matrix: which deterministic layers actually ran on
    // each version.
    renderFidelity(result.sideFidelity);

    currentRows = toImpactRows(result.rows, result.methodA, result.methodB);
    currentTotal = result.summary.rowCount;

    renderFilters();
    renderTable();

    const shown = currentRows.length;
    const ms = result.summary.duration;
    const lastRun =
        runAt !== undefined
            ? ` \u00b7 Last run: ${formatRunTimestamp(runAt)}`
            : "";
    setStatus(`Done — ${shown} row(s) \u00b7 ${ms}ms.${lastRun}`);
}

/** Format a run timestamp for the "Last run" status hint (local date + time). */
function formatRunTimestamp(runAt: number): string {
    try {
        return new Date(runAt).toLocaleString();
    } catch {
        return "";
    }
}

/** Paint the wildcard-validation outcome into the sub-bar, or clear it.
 *  Shown only when validation actually ran on a wildcard match; a clean pass is
 *  neutral, a degraded/unavailable pass warns so the report stays honest. */
function renderValidationNote(
    info: StudioWildcardValidationInfo | undefined,
): void {
    validationEl.textContent = "";
    validationEl.classList.remove("is-degraded");
    if (!info || !info.applied) {
        return;
    }
    const { icon, label, detail, degraded } = describeValidation(
        info.diagnostics,
    );
    validationEl.classList.toggle("is-degraded", degraded);
    validationEl.title = detail;
    validationEl.append(codicon(icon), text(label));
}

/** Map the validation diagnostics to a compact label + hover detail. An empty
 *  diagnostics list means the validator ran cleanly; otherwise we surface the
 *  most significant fail-open reason so the run never overclaims fidelity. */
function describeValidation(diagnostics: WildcardValidationDiagnostic[]): {
    icon: string;
    label: string;
    detail: string;
    degraded: boolean;
} {
    if (diagnostics.length === 0) {
        return {
            icon: "verified",
            label: "wildcard-validated",
            detail:
                "The working-tree side ran the agent's real validateWildcardMatch " +
                "over its wildcard matches; any match the agent rejected was dropped.",
            degraded: false,
        };
    }
    if (diagnostics.includes("load-failed")) {
        return {
            icon: "warning",
            label: "validation unavailable",
            detail:
                "Wildcard validation was requested but the agent module couldn't be " +
                "loaded (e.g. the packaged build ships no agent code), so matches " +
                "fell back to the grammar alone.",
            degraded: true,
        };
    }
    if (diagnostics.includes("no-validator")) {
        return {
            icon: "info",
            label: "no validator",
            detail:
                "This agent exposes no validateWildcardMatch, so validation made " +
                "no change to the grammar matches.",
            degraded: true,
        };
    }
    return {
        icon: "warning",
        label: "validation degraded",
        detail:
            "The agent's validator threw while checking a wildcard match; the match " +
            "was kept (fail-open) so the run stayed grammar-faithful.",
        degraded: true,
    };
}

const FIDELITY_STATUS_ICON: Record<FidelityCell["status"], string> = {
    ran: "pass-filled",
    skipped: "circle-slash",
    unavailable: "circle-large-outline",
};

/** Render the per-side fidelity matrix into a collapsible panel, or hide it.
 *  Surfaces which deterministic layers ran on each version (A/B) with a status
 *  icon + hover reason — so the report is honest about exactly what it
 *  exercised. */
function renderFidelity(
    sideFidelity: StudioReplayResult["sideFidelity"] | undefined,
): void {
    fidelityEl.textContent = "";
    fidelityEl.hidden = true;
    const view = toFidelityMatrix(sideFidelity);
    if (!view) {
        return;
    }

    const details = document.createElement("details");
    details.className = "fidelity-details";
    const summary = document.createElement("summary");
    summary.className = "fidelity-summary";
    summary.append(
        codicon("layers"),
        text(
            `Fidelity \u00b7 A: ${view.realizationA} \u00b7 B: ${view.realizationB}`,
        ),
    );
    details.append(summary);

    const grid = el("div", "fidelity-grid");
    grid.append(
        fidelityHeadCell("Layer"),
        fidelityHeadCell("A"),
        fidelityHeadCell("B"),
    );
    for (const row of view.rows) {
        grid.append(
            fidelityLayerCell(row.layer),
            fidelityStatusCell(row.a),
            fidelityStatusCell(row.b),
        );
    }
    details.append(grid);

    fidelityEl.append(details);
    fidelityEl.hidden = false;
}

function fidelityHeadCell(label: string): HTMLElement {
    const cell = el("span", "fidelity-head");
    cell.textContent = label;
    return cell;
}

function fidelityLayerCell(label: string): HTMLElement {
    const cell = el("span", "fidelity-layer");
    cell.textContent = label;
    return cell;
}

function fidelityStatusCell(cellInfo: FidelityCell): HTMLElement {
    const cell = el("span", `fidelity-cell is-${cellInfo.status}`);
    cell.title = cellInfo.reason;
    cell.append(
        codicon(FIDELITY_STATUS_ICON[cellInfo.status]),
        text(cellInfo.status),
    );
    return cell;
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

    const label = el("span", "filters-label");
    label.append(codicon("list-filter"), document.createTextNode("Filter"));
    filtersEl.appendChild(label);

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
            chipButton(
                chip.label,
                chip.count,
                isActive,
                isEmpty,
                () => toggleFilter(chip.status),
                chip.status,
            ),
        );
    }
}

/** Build one filter pill button. Empty (zero-count) chips render inert. A
 *  `status` adds a colour dot mirroring the row status colour. */
function chipButton(
    label: string,
    count: number,
    isActive: boolean,
    isEmpty: boolean,
    onClick: () => void,
    status?: ReplayRowStatus,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    const classes = ["filter-chip"];
    if (isActive) classes.push("is-active");
    if (isEmpty) classes.push("is-empty");
    button.className = classes.join(" ");
    button.setAttribute("aria-pressed", String(isActive));
    if (status) {
        const dot = el("span", `chip-dot status-${status}`);
        button.appendChild(dot);
    }
    const text = document.createElement("span");
    text.textContent = label;
    const countEl = el("span", "chip-count");
    countEl.textContent = String(count);
    button.append(text, countEl);
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
    const thead = document.createElement("thead");
    const head = document.createElement("tr");
    const headers: { label: string; title: string; ariaLabel?: string }[] = [
        {
            label: "Utterance",
            title: "The corpus utterance that was replayed.",
        },
        {
            label: "Status",
            title: "How Base (A) and Compare (B) compare for this utterance.",
        },
        {
            label: "Base (A)",
            title: "How Base (A) resolved the utterance (cache state).",
        },
        {
            label: "Compare (B)",
            title: "How Compare (B) resolved the utterance (cache state).",
        },
        { label: "", title: LATENCY_TOOLTIP, ariaLabel: "Latency" },
    ];
    for (const h of headers) {
        const th = document.createElement("th");
        th.textContent = h.label || "Latency";
        th.title = h.title;
        if (h.ariaLabel) th.setAttribute("aria-label", h.ariaLabel);
        head.appendChild(th);
    }
    thead.appendChild(head);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");

    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.appendChild(cell(row.utterance));
        tr.appendChild(statusCell(row.status, row.statusLabel));
        tr.appendChild(
            cell(
                row.resolutionA,
                "resolution",
                resolutionTooltip(row.resolutionA),
            ),
        );
        tr.appendChild(
            cell(
                row.resolutionB,
                "resolution",
                resolutionTooltip(row.resolutionB),
            ),
        );
        tr.appendChild(latencyCell(row));
        // Every row is clickable. Difference rows drill into an action A/B diff;
        // equal rows have nothing to compare, so a click just clears any open
        // detail pane.
        if (currentRawById.has(row.utteranceId)) {
            const isDiff = row.status !== "equal";
            tr.classList.add("row-clickable");
            if (row.utteranceId === selectedId) {
                tr.classList.add("row-open");
            }
            tr.tabIndex = 0;
            tr.setAttribute("role", "button");
            tr.title = isDiff
                ? "Show the action A/B diff for this utterance."
                : "Equal row — click to close the detail diff.";
            const activate = () =>
                isDiff
                    ? openDetail(row.utteranceId)
                    : selectEqualRow(row.utteranceId);
            tr.addEventListener("click", activate);
            tr.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate();
                }
            });
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
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
    selectedId = utteranceId;
    renderDetail(delta);
    // Re-render the table so the open row gets its highlight.
    renderTable();
    detailEl.scrollIntoView({ block: "nearest" });
}

/** Select an equal row: it has no A/B diff, so just highlight it and close any
 *  open detail pane. */
function selectEqualRow(utteranceId: string): void {
    selectedId = utteranceId;
    openDetailId = undefined;
    detailEl.hidden = true;
    detailEl.textContent = "";
    renderTable();
}

/** Hide the drill-in detail pane and clear the row selection. */
function closeDetail(): void {
    openDetailId = undefined;
    selectedId = undefined;
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
    if (diff.onlyB) {
        meta.append(codicon("diff-added"), text("new match (no action on A)"));
    } else if (diff.onlyA) {
        meta.append(
            codicon("diff-removed"),
            text("lost match (no action on B)"),
        );
    } else if (diff.identical) {
        meta.append(codicon("pass"), text("actions identical"));
    } else {
        const added = el("span", "added");
        added.textContent = `+${diff.addedCount}`;
        const removed = el("span", "removed");
        removed.textContent = `\u2212${diff.removedCount}`;
        meta.append(added, removed);
    }
    const close = toolButton("close", "Close detail", () => {
        closeDetail();
        renderTable();
    });
    close.classList.add("detail-close");
    header.append(title, meta, close);

    const legend = el("div", "detail-legend");
    legend.append(
        text("Base (A)"),
        codicon("arrow-right"),
        text("Compare (B)"),
    );

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
    const icon = codicon("git-compare");
    const title = el("div", "empty-state-title");
    title.textContent = state.title;
    const hint = el("div", "empty-state-hint");
    hint.textContent = state.hint;
    emptyStateEl.append(icon, title, hint);
    emptyStateEl.hidden = false;
}

function restoreSelection(): void {
    const state = vscode.getState();
    if (state?.versionA) {
        versionA = state.versionA;
    }
    if (state?.versionB) {
        versionB = state.versionB;
    }
    if (state?.mode) {
        mode = state.mode;
    }
    if (state?.validateWildcards !== undefined) {
        validateWildcards = state.validateWildcards === true;
    }
    // The agent is authoritative from the host `init`; until it arrives, show a
    // neutral placeholder rather than a stale persisted value.
    renderAgentName();
    // Re-render the last result immediately so navigating away and back doesn't
    // blank the report. The host also re-pushes the full result on `ready`
    // (recovery), which upgrades this possibly-truncated snapshot.
    if (state?.lastResult) {
        renderResult(
            state.lastResult.payload,
            state.lastResult.provenance,
            state.lastResult.runAt,
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

/** Persist a completed result (row-capped) so a reload re-renders it. When
 *  re-persisting a restored run, keep its original `runAt` rather than stamping
 *  "now" so the timestamp shown stays truthful. */
function persistResult(
    payload: StudioReplayResult,
    provenance?: RunProvenance,
    runAt?: number,
): void {
    const bounded =
        payload.rows.length > MAX_PERSISTED_ROWS
            ? { ...payload, rows: payload.rows.slice(0, MAX_PERSISTED_ROWS) }
            : payload;
    persistState({
        lastResult: {
            payload: bounded,
            runAt: runAt ?? Date.now(),
            ...(provenance ? { provenance } : {}),
        },
    });
}

function setControlsEnabled(enabled: boolean): void {
    runButton.disabled = !enabled;
    swapButton.disabled = !enabled;
    versionAButton.button.disabled = !enabled;
    versionBButton.button.disabled = !enabled;
    settingsButton.disabled = !enabled;
    cacheSwitch.button.disabled = !enabled;
    // The validation toggle additionally requires the agent to have a validator
    // to run; otherwise it stays disabled so the operator isn't offered a no-op.
    validateSwitch.button.disabled = !enabled || !agentCanValidate;
    // A run shouldn't leave the options popover hanging open.
    if (!enabled) {
        toggleSettingsPopover(false);
    }
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

function text(value: string): Text {
    return document.createTextNode(value);
}

/** A codicon glyph element (VS Code's icon font). `name` matches a
 *  `.codicon-<name>` rule in the stylesheet. */
function codicon(name: string): HTMLElement {
    return el("span", `codicon codicon-${name}`);
}

function cell(
    value: string,
    className?: string,
    title?: string,
): HTMLTableCellElement {
    const td = document.createElement("td");
    td.textContent = value;
    if (className) {
        td.className = className;
    }
    if (title) {
        td.title = title;
    }
    return td;
}

const STATUS_TOOLTIP: Record<ReplayRowStatus, string> = {
    equal: "Equal — Base (A) and Compare (B) resolved to the same action; nothing changed.",
    changed:
        "Changed — both sides resolved an action, but the two actions differ.",
    "new-match":
        "New match — Compare (B) resolved an action where Base (A) did not.",
    "lost-match":
        "Lost match — Base (A) resolved an action but Compare (B) no longer does.",
};

const LATENCY_TOOLTIP =
    "Resolution latency in milliseconds — Base (A) / Compare (B).";

/** Human description of a per-side resolution token (see `sideToken` in the
 *  replay view model for how a raw cache state becomes one of these). */
function resolutionTooltip(token: string): string {
    switch (token) {
        case "hit":
        case "hit\u00b7cache":
            return "Hit — the action was served from the construction cache.";
        case "miss":
            return "Miss — no construction matched this utterance.";
        case "miss\u00b7grammar":
            return "Miss — no cached construction matched; this side fell through to the grammar.";
        case "needs-explanation":
            return "Needs explanation — no cached construction matched and the miss policy skipped the LLM, so the utterance needs an explanation (LLM) to resolve.";
        case "llm-resolved":
            return "LLM resolved — the action was produced by calling the live language model.";
        case "skipped":
            return "Skipped — this utterance was not evaluated on this side.";
        default:
            return token;
    }
}

/** Map a row status to its codicon glyph (diff add/modify/remove, or pass). */
function statusIcon(status: ReplayRowStatus): string {
    switch (status) {
        case "changed":
            return "diff-modified";
        case "new-match":
            return "diff-added";
        case "lost-match":
            return "diff-removed";
        default:
            return "pass";
    }
}

/** The status cell: a coloured codicon + label, like VS Code's diff decorations. */
function statusCell(
    status: ReplayRowStatus,
    label: string,
): HTMLTableCellElement {
    const td = document.createElement("td");
    td.className = "col-status";
    td.title = STATUS_TOOLTIP[status];
    const wrap = el("span", `status-cell status-${status}`);
    wrap.append(codicon(statusIcon(status)), text(label));
    td.appendChild(wrap);
    return td;
}

/** The latency cell, with a faint expand chevron revealed on hover for rows that
 *  drill into a detail diff. */
function latencyCell(row: ImpactRow): HTMLTableCellElement {
    const td = document.createElement("td");
    td.className = "latency";
    td.title = LATENCY_TOOLTIP;
    const value = el("span", "latency-value");
    value.textContent = row.latency;
    td.appendChild(value);
    return td;
}

interface ToolButtonOptions {
    /** Render with the primary button fill (used for the one Run action). */
    primary?: boolean;
    /** Optional visible label next to the icon. */
    text?: string;
}

/** A toolbar button carrying a codicon (and optional label). `icon` matches a
 *  `.codicon-<icon>` rule; `label` is the accessible name and hover title. */
function toolButton(
    icon: string,
    label: string,
    onClick: () => void,
    opts: ToolButtonOptions = {},
): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = opts.primary ? "tool-button is-primary" : "tool-button";
    b.append(codicon(icon));
    if (opts.text) {
        b.append(text(opts.text));
    }
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", onClick);
    return b;
}

/** A labelled VS Code-themed on/off switch for the replay-options popover.
 *  `getState`/`onToggle` bind it to a boolean; `tooltipFor` supplies concise
 *  hover copy per state. Returns the row, the switch button (so callers can
 *  disable it), and a `render` that repaints from the current state. */
function settingsSwitch(
    label: string,
    getState: () => boolean,
    onToggle: () => void,
    tooltipFor: (on: boolean) => string,
): { row: HTMLElement; button: HTMLButtonElement; render: () => void } {
    const row = el("div", "switch-row");
    const labelEl = el("span", "switch-label");
    labelEl.textContent = label;
    labelEl.id = `switch-${label.replace(/\s+/g, "-").toLowerCase()}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "switch";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-labelledby", labelEl.id);
    const offText = el("span", "switch-text switch-off");
    offText.textContent = "OFF";
    const onText = el("span", "switch-text switch-on");
    onText.textContent = "ON";
    button.append(offText, onText, el("span", "switch-knob"));
    button.addEventListener("click", () => onToggle());
    row.append(labelEl, button);
    const render = () => {
        const on = getState();
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-checked", String(on));
        const tip = tooltipFor(on);
        button.title = tip;
        row.title = tip;
    };
    return { row, button, render };
}

function picker(
    description: string,
    onClick: () => void,
    sideTag?: string,
): { button: HTMLButtonElement; value: HTMLElement } {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker";
    button.title = description;
    button.setAttribute("aria-label", description);
    if (sideTag) {
        const tag = el("span", "picker-side");
        tag.textContent = sideTag;
        button.appendChild(tag);
    }
    const value = el("span", "picker-value");
    button.append(value, codicon("chevron-down"));
    button.addEventListener("click", onClick);
    return { button, value };
}

/** A grouped cluster of action-bar controls. */
function group(...children: Node[]): HTMLElement {
    const g = el("div", "bar-group");
    g.append(...children);
    return g;
}

/** A thin vertical separator between action-bar groups. */
function separator(): HTMLElement {
    return el("div", "bar-sep");
}

/** A flexible spacer that pushes trailing controls to the right edge. */
function spacer(): HTMLElement {
    return el("div", "bar-spacer");
}

/** Show an inline error notification in the content area. */
function showNotification(message: string): void {
    notificationEl.textContent = "";
    notificationEl.append(codicon("error"), text(message));
}

/** Clear the inline error notification. */
function clearNotification(): void {
    notificationEl.textContent = "";
}

/** Paint the provenance strip: the concrete identity each side ran against. */
function renderProvenance(provenance: RunProvenance): void {
    provenanceEl.textContent = "";
    provenanceEl.title = formatProvenanceLine(provenance);
    provenanceEl.append(
        text(formatVersionProvenance(provenance.a)),
        codicon("arrow-right"),
        text(formatVersionProvenance(provenance.b)),
    );
}

/** Paint both version pickers with their current labels and tooltips. */
function renderVersionButtons(): void {
    versionAButton.value.textContent = versionA.label;
    versionAButton.button.title = versionA.tooltip;
    versionBButton.value.textContent = versionB.label;
    versionBButton.button.title = versionB.tooltip;
}

/** Paint the read-only agent label with the current (host-fixed) selection. */
function renderAgentName(): void {
    agentNameEl.textContent = currentAgent ?? "—";
    agentNameEl.title = currentAgent
        ? `This report compares the "${currentAgent}" agent's corpus across two versions.`
        : "";
}

/** Paint the single connection indicator from the shared connection state.
 *  Disconnected is shown as "reconnecting" because the host auto-retries. */
function renderConnection(state: ConnectionState): void {
    connectionPill.className = `conn-pill conn-${state}`;
    connectionPill.textContent = "";
    if (state === "connected") {
        connectionPill.append(codicon("circle-filled"), text("Connected"));
        connectionPill.title = "Connected to the Studio service.";
    } else if (state === "connecting") {
        connectionPill.append(codicon("sync"), text("Connecting…"));
        connectionPill.title = "Connecting to the Studio service…";
    } else {
        connectionPill.append(codicon("sync"), text("Reconnecting…"));
        connectionPill.title =
            "Studio service unavailable — reconnecting automatically.";
    }
}
