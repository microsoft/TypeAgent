// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Webview entry point — runs in the browser sandbox inside VS Code.
// Communicates with the extension host via postMessage.
// The extension host manages the actual RPC connection to the agent server.
//
// Renders the shared `chat-ui` ChatPanel plus the host-managed session bar.

import { ChatPanel, HistoryEntry } from "chat-ui";
import chatPanelStyles from "chat-ui/styles";
import completionUiStyles from "@typeagent/completion-ui/styles.css";
import vscodeThemeStyles from "./vscode-theme.css";
import { QueueStateMirror } from "@typeagent/dispatcher-types";
import type { QueuedRequest, QueueSnapshot } from "@typeagent/dispatcher-types";

// Inject the chat-ui base styles first, then the completion-ui dropdown
// styles, then the VS Code theme overlay so it can override defaults via
// --vscode-* CSS variables.
function injectStyles(css: string): void {
    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}
injectStyles(chatPanelStyles as unknown as string);
injectStyles(completionUiStyles as unknown as string);
injectStyles(vscodeThemeStyles as unknown as string);

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const sessionNameBtn = document.getElementById(
    "session-name-btn",
) as HTMLButtonElement;
const sessionRenameEditorEl = document.getElementById(
    "session-rename-editor",
) as HTMLDivElement;
const sessionRenameInputEl = document.getElementById(
    "session-rename-input",
) as HTMLInputElement;
const sessionRenameSaveBtn = document.getElementById(
    "session-rename-save-btn",
) as HTMLButtonElement;
const sessionRenameCancelBtn = document.getElementById(
    "session-rename-cancel-btn",
) as HTMLButtonElement;
const sessionRenameBtn = document.getElementById(
    "session-rename-btn",
) as HTMLButtonElement;
const sessionDeleteBtn = document.getElementById(
    "session-delete-btn",
) as HTMLButtonElement;
const sessionStatusSummaryEl = document.getElementById(
    "session-status-summary",
)!;
const sessionCreatePopoverEl = document.getElementById(
    "session-create-popover",
)!;
const sessionNewNameEl = document.getElementById(
    "session-new-name",
) as HTMLInputElement;
const sessionCreateBtn = document.getElementById(
    "session-create-btn",
) as HTMLButtonElement;
const sessionCreateHintEl = document.getElementById(
    "session-create-hint",
)!;
const sessionSearchPopoverEl = document.getElementById(
    "session-search-popover",
)!;
const sessionSearchInputEl = document.getElementById(
    "session-search-input",
) as HTMLInputElement;
const sessionSearchResultsEl = document.getElementById(
    "session-search-results",
)!;
const rootEl = document.getElementById("chat-root")!;

// Track the higher-level disabled reasons so we can reconcile them when
// any one of them flips. ChatPanel.setEnabled honors switching/history
// loading internally, but we additionally require the websocket to be
// connected before the input is enabled.
let isConnected = false;
let isSwitching = false;
let isRenaming = false;
let currentSessionId: string | undefined;
let currentSessionName = "";
let currentSessionClientCount: number | undefined;
let transitionStatusLabel: "Creating" | "Connecting" | undefined;
let transitionTargetName: string | undefined;
let knownSessions: SessionListEntry[] = [];
let searchRenameSessionId: string | undefined;
type SessionListEntry = {
    sessionId: string;
    name: string;
    clientCount: number;
};

const chatPanel = new ChatPanel(rootEl, {
    platformAdapter: {
        // Open links via the extension host — webviews can't call window.open
        // for arbitrary URLs in a useful way.
        handleLinkClick: (href: string, _target: string | null) => {
            vscode.postMessage({ type: "openExternal", href });
        },
    },
    onSend: (text: string, _attachments, requestId: string) => {
        vscode.postMessage({ type: "sendCommand", command: text, requestId });
    },
    onCancel: (requestId: string) => {
        vscode.postMessage({ type: "cancelCommand", requestId });
    },
});

// `onDemoAction` is exposed as a settable public property on ChatPanel
// (not part of ChatPanelOptions), so wire it after construction.
chatPanel.onDemoAction = (action: "continue" | "cancel") => {
    vscode.postMessage({ type: "demoCommand", action });
};

// Mount inline + dropdown command-completion driven by the host
// (CompletionController in AgentServerBridge). The chat-ui posts
// pcUpdate / pcAccept / pcDismiss / pcHide / pcDispose; the host
// answers with `pcState` (handled in the message switch below).
chatPanel.attachCompletion((msg) => vscode.postMessage(msg));

// Mirror of dispatcher's queue lifecycle (requestQueued / requestStarted
// / requestCancelled / queueStateChanged) so we can dedupe "⚠ Cancelled"
// across paths and support double-Esc cancel-all without round-tripping.
// Two sets, intentionally separate:
//   * `cancelledRequests` — flagged cancelled (drops late setDisplay
//     stragglers).
//   * `cancelledRendered` — affordance already painted (one-shot claim
//     to avoid double-stamping).
// Merging them would have `markCancelled` race ahead of
// `claimCancelledRender` and suppress the affordance. Both wiped on
// sessionChanged / clear.
const queueMirror = new QueueStateMirror();
const cancelledRequests = new Set<string>();
const cancelledRendered = new Set<string>();

// Chips deferred until their bubble materializes. Keyed by targetRid
// (clientRid for local, serverRid for remote-only). `serverId` is the
// canonical id sent on user × click; needed because targetRid may BE
// the serverId.
const pendingQueueStatus = new Map<
    string,
    { status: "queued" | "running"; serverId: string }
>();

/**
 * Resolve the chat-ui bubble key for a queue entry. Local entries use
 * clientRequestId; peer entries fall back to the canonical server UUID
 * (the key used by `addRemoteUserMessage`).
 */
function chipTargetRid(
    entry: QueuedRequest,
    msgClientRequestId: string | undefined,
): string {
    return entry.clientRequestId ?? msgClientRequestId ?? entry.requestId;
}

/**
 * Materialize a peer-originated user bubble so a chip has something
 * to attach to. No-op when the bubble already exists or `entry.text`
 * is missing.
 */
function materializeQueueBubbleIfMissing(
    entry: QueuedRequest,
    targetRid: string,
): void {
    if (chatPanel.hasUserMessage(targetRid)) return;
    if (entry.text) {
        chatPanel.addRemoteUserMessage(entry.text, targetRid);
    }
}

/**
 * Stamp a chip on the bubble for `targetRid` if it exists; otherwise
 * stash for later application. The × button cancels via the canonical
 * server id (the bridge accepts this as serverId when no client→server
 * mapping matches).
 */
function applyQueueChip(
    targetRid: string,
    serverId: string,
    status: "queued" | "running",
): void {
    if (!chatPanel.hasUserMessage(targetRid)) {
        pendingQueueStatus.set(targetRid, { status, serverId });
        return;
    }
    const onCancel =
        status === "queued"
            ? () =>
                  vscode.postMessage({
                      type: "cancelCommand",
                      requestId: serverId,
                  })
            : undefined;
    const onPromote =
        status === "queued"
            ? () =>
                  vscode.postMessage({
                      type: "promoteCommand",
                      requestId: serverId,
                  })
            : undefined;
    chatPanel.setUserBubbleQueueStatus(targetRid, status, onCancel, onPromote);
    pendingQueueStatus.delete(targetRid);
}

/** Clear chip and any pending stash. */
function clearQueueChip(targetRid: string): void {
    pendingQueueStatus.delete(targetRid);
    chatPanel.setUserBubbleQueueStatus(targetRid, null);
}

/**
 * Reapply chip state to match an authoritative snapshot. Snapshots are
 * the source of truth; fine-grained queue events are incremental hints.
 */
function reconcileQueueChips(
    prev: QueueSnapshot | undefined,
    next: QueueSnapshot | undefined,
): void {
    const live = new Set<string>();
    if (next?.running) {
        const targetRid = chipTargetRid(next.running, undefined);
        materializeQueueBubbleIfMissing(next.running, targetRid);
        live.add(targetRid);
        applyQueueChip(targetRid, next.running.requestId, "running");
    }
    for (const entry of next?.queued ?? []) {
        const targetRid = chipTargetRid(entry, undefined);
        materializeQueueBubbleIfMissing(entry, targetRid);
        live.add(targetRid);
        applyQueueChip(targetRid, entry.requestId, "queued");
    }
    const prevIds = new Set<string>();
    if (prev?.running) prevIds.add(chipTargetRid(prev.running, undefined));
    for (const e of prev?.queued ?? [])
        prevIds.add(chipTargetRid(e, undefined));
    for (const id of prevIds) {
        if (live.has(id)) continue;
        clearQueueChip(id);
    }
    for (const id of Array.from(pendingQueueStatus.keys())) {
        if (!live.has(id)) pendingQueueStatus.delete(id);
    }
}

/** Window (ms) for the double-Escape "cancel everything" gesture. */
const DOUBLE_ESCAPE_WINDOW_MS = 1000;
let lastEscapeTime = 0;

/**
 * Flag a request as cancelled. Variadic because the bridge surfaces
 * both client rid and server UUID; downstream payloads may key by either.
 */
function markCancelled(...rids: Array<string | undefined>): void {
    for (const rid of rids) {
        if (rid) cancelledRequests.add(rid);
    }
}

/** True if this request has ever been flagged as cancelled. */
function isCancelledRequest(rid: string | undefined): boolean {
    return rid !== undefined && cancelledRequests.has(rid);
}

/**
 * Idempotently claim the "⚠ Cancelled" render slot for a request.
 * Variadic — all supplied id forms (client rid, server UUID, aliases)
 * are added to the dedupe set on every call so a later event that
 * knows only one form still hits the dedupe. Returns true on first
 * claim, false thereafter.
 */
function claimCancelledRender(...rids: Array<string | undefined>): boolean {
    // Two-pass: read membership before adding so a call like
    // claim("X", "X") doesn't have arg 1's add() trip arg 2's has().
    let alreadyClaimed = false;
    let anyValid = false;
    for (const rid of rids) {
        if (!rid) continue;
        anyValid = true;
        if (cancelledRendered.has(rid)) alreadyClaimed = true;
    }
    for (const rid of rids) {
        if (rid) cancelledRendered.add(rid);
    }
    return anyValid && !alreadyClaimed;
}

// Map dispatcher's CommandResult to chat-ui's completeRequest result shape.
// dispatcher: { metrics: { actions: PhaseTiming[], command, parse, duration },
//               tokenUsage, actionTokenUsage, ... }
// chat-ui:    { actionPhase?, totalDuration?, tokenUsage?, actionTokenUsage?,
//               parsePhase? }
// We pick the last action's phase (or the command phase) as actionPhase, the
// overall duration as totalDuration, the parse phase as parsePhase (drives
// the "Translation" tooltip on the user bubble), and pass both the
// translation tokenUsage (user bubble) and actionTokenUsage (agent bubble)
// through.
function mapResult(result: any):
    | {
          actionPhase?: any;
          totalDuration?: number;
          tokenUsage?: any;
          actionTokenUsage?: any;
          parsePhase?: any;
          cancelled?: boolean;
      }
    | undefined {
    if (!result) return undefined;
    const metrics = result.metrics;
    const actions: any[] | undefined = metrics?.actions;
    const lastAction =
        actions && actions.length > 0 ? actions[actions.length - 1] : undefined;
    return {
        actionPhase: lastAction ?? metrics?.command,
        totalDuration: metrics?.duration,
        tokenUsage: result.tokenUsage,
        actionTokenUsage: result.actionTokenUsage,
        parsePhase: metrics?.parse,
        cancelled: result.cancelled === true,
    };
}

// Helper: pull clientRequestId out of a RequestId object/string. Most fields
// arrive pre-normalized as plain strings from the bridge, but the
// historyReplay payload still carries server `IAgentMessage`s whose nested
// `requestId` can be either shape — so this is retained for that path only.
function clientIdOf(requestId: any): string | undefined {
    if (!requestId) return undefined;
    if (typeof requestId === "string") return requestId;
    return requestId.clientRequestId as string | undefined;
}

// Translate the bridge's history-entry shape (which mirrors the dispatcher's
// internal recorded events) to chat-ui's HistoryEntry union.
function toChatPanelHistory(entries: any[]): HistoryEntry[] {
    // First pass: derive "First Message" timing per requestId — the elapsed
    // ms from the user's request to the first agent display message. The
    // dispatcher does not persist this directly; we reconstruct it from the
    // recorded user-request and set/append-display timestamps.
    const userRequestTs = new Map<string, number>();
    const firstAgentTs = new Map<string, number>();
    for (const e of entries) {
        const rid: string | undefined =
            e.requestId ?? clientIdOf(e.message?.requestId);
        if (!rid || typeof e.timestamp !== "number") continue;
        if (e.type === "user-request") {
            if (!userRequestTs.has(rid)) userRequestTs.set(rid, e.timestamp);
        } else if (e.type === "set-display" || e.type === "append-display") {
            // Skip ephemeral status lines — they don't represent the first
            // real agent response.
            if (e.type === "append-display" && e.mode === "temporary") continue;
            if (!firstAgentTs.has(rid)) firstAgentTs.set(rid, e.timestamp);
        }
    }
    const firstMessageMsByRequestId = new Map<string, number>();
    for (const [rid, start] of userRequestTs) {
        const first = firstAgentTs.get(rid);
        if (first !== undefined && first >= start) {
            firstMessageMsByRequestId.set(rid, first - start);
        }
    }

    const out: HistoryEntry[] = [];
    for (const e of entries) {
        switch (e.type) {
            case "user-request":
                out.push({
                    kind: "user",
                    text: e.command,
                    requestId: e.requestId,
                    timestamp: e.timestamp,
                });
                break;
            case "set-display":
                out.push({
                    kind: "agent-replace",
                    content: e.message?.message,
                    source: e.message?.source,
                    requestId: e.requestId ?? clientIdOf(e.message?.requestId),
                    timestamp: e.timestamp,
                });
                break;
            case "append-display":
                // Skip temporary status messages — they were ephemeral
                // status lines (e.g. "Translating...") that were already
                // replaced by real content during the original interaction.
                if (e.mode === "temporary") break;
                out.push({
                    kind: "agent-append",
                    content: e.message?.message,
                    source: e.message?.source,
                    mode: e.mode,
                    requestId: e.requestId ?? clientIdOf(e.message?.requestId),
                    timestamp: e.timestamp,
                });
                break;
            case "set-display-info":
                // Restores the action JSON popup + action-derived bubble
                // title on replayed history items.
                out.push({
                    kind: "display-info",
                    source: e.source ?? "",
                    action: e.action,
                    requestId: e.requestId ?? clientIdOf(e.message?.requestId),
                });
                break;
            case "command-result": {
                // Restores the metrics tooltip on replayed agent bubbles.
                const m = e.metrics;
                const actions: any[] | undefined = m?.actions;
                const lastAction =
                    actions && actions.length > 0
                        ? actions[actions.length - 1]
                        : undefined;
                out.push({
                    kind: "command-result",
                    requestId: e.requestId,
                    actionPhase: lastAction ?? m?.command,
                    totalDuration: m?.duration,
                    tokenUsage: e.tokenUsage,
                    actionTokenUsage: e.actionTokenUsage,
                    parsePhase: m?.parse,
                    firstMessageMs: e.requestId
                        ? firstMessageMsByRequestId.get(e.requestId)
                        : undefined,
                });
                break;
            }
        }
    }
    return out;
}

// Last-known connection state so demoPaused can re-render the status
// ribbon with a "[Demo paused]" suffix without re-issuing a status
// broadcast from the host.
let lastConnected = false;
let demoSuffix: string | undefined;
// Reconnect ribbon overlay shown while disconnected. Replaces the old
// per-attempt error spam in the chat area with a single in-place
// updating string (countdown + last error).
let reconnectText: string | undefined;

function renderStatus(): void {
    if (transitionStatusLabel) {
        sessionStatusSummaryEl.className = "session-status-summary switching";
        sessionStatusSummaryEl.textContent = transitionStatusLabel;
    } else if (lastConnected) {
        sessionStatusSummaryEl.className = "session-status-summary connected";
        const parts = ["Connected"];
        const clientCount = formatClientCount(currentSessionClientCount);
        if (clientCount) parts.push(clientCount);
        if (demoSuffix) parts.push(demoSuffix);
        sessionStatusSummaryEl.textContent = parts.join(" · ");
    } else {
        sessionStatusSummaryEl.className = "session-status-summary disconnected";
        sessionStatusSummaryEl.textContent = reconnectText ?? "Disconnected";
    }
}

function requestSessionList(): void {
    vscode.postMessage({ type: "requestSessions" });
}

function formatClientCount(count: number | undefined): string {
    if (count === undefined) return "";
    return count === 1 ? "1 client" : `${count} clients`;
}

function setPopoverVisible(popover: HTMLElement, visible: boolean): void {
    popover.classList.toggle("hidden", !visible);
}

function hideSessionPopovers(): void {
    setPopoverVisible(sessionCreatePopoverEl, false);
    setPopoverVisible(sessionSearchPopoverEl, false);
    searchRenameSessionId = undefined;
}

function isSessionPopoverVisible(): boolean {
    return (
        !sessionCreatePopoverEl.classList.contains("hidden") ||
        !sessionSearchPopoverEl.classList.contains("hidden")
    );
}

function hasRenameConflict(name: string): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return knownSessions.some(
        (s) => s.sessionId !== currentSessionId && s.name.toLowerCase() === lower,
    );
}

function hasCreateConflict(name: string): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return knownSessions.some((s) => s.name.toLowerCase() === lower);
}

function hasSessionRenameConflict(sessionId: string, name: string): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return knownSessions.some(
        (s) => s.sessionId !== sessionId && s.name.toLowerCase() === lower,
    );
}

function setRenameMode(renaming: boolean): void {
    isRenaming = renaming;
    sessionNameBtn.classList.toggle("hidden", renaming);
    sessionRenameEditorEl.classList.toggle("hidden", !renaming);
    if (!renaming) {
        sessionRenameInputEl.classList.remove("conflict");
        sessionRenameInputEl.removeAttribute("aria-invalid");
    }
}

function beginRenameCurrentSession(): void {
    if (!isConnected || isSwitching || !currentSessionId) return;
    hideSessionPopovers();
    sessionRenameInputEl.value =
        currentSessionName || currentSessionId.substring(0, 8);
    setRenameMode(true);
    updateSessionControlsEnabled();
    sessionRenameInputEl.focus();
    sessionRenameInputEl.select();
}

function cancelRenameCurrentSession(): void {
    setRenameMode(false);
    updateSessionControlsEnabled();
}

function submitRenameCurrentSession(): void {
    if (!isConnected || isSwitching || !currentSessionId || !isRenaming) return;
    const name = sessionRenameInputEl.value.trim();
    const conflict = hasRenameConflict(name);
    const unchanged =
        name !== "" &&
        currentSessionName.trim().toLowerCase() === name.toLowerCase();
    if (!name || conflict || unchanged) return;

    currentSessionName = name;
    updateSessionSummary();
    setRenameMode(false);
    updateSessionControlsEnabled();
    vscode.postMessage({ type: "renameCurrentSession", name });
}

function updateSessionSummary(): void {
    const displayName =
        transitionTargetName ||
        currentSessionName || currentSessionId?.substring(0, 8) || "Conversation";
    sessionNameBtn.textContent = displayName;
    renderStatus();
}

function updateSessionControlsEnabled(): void {
    const enabled = isConnected && !isSwitching;
    const hasCurrentSession = currentSessionId !== undefined;
    const inputValue = sessionNewNameEl.value.trim();
    const renameValue = sessionRenameInputEl.value.trim();
    const createConflict = hasCreateConflict(inputValue);
    const renameConflict = hasRenameConflict(renameValue);
    const renameUnchanged =
        renameValue !== "" &&
        currentSessionName.trim().toLowerCase() === renameValue.toLowerCase();

    sessionNameBtn.disabled = !enabled;
    sessionRenameBtn.disabled = !enabled || !hasCurrentSession || isRenaming;
    sessionDeleteBtn.disabled = !enabled || !hasCurrentSession;
    sessionNewNameEl.disabled = !enabled;
    sessionCreateBtn.disabled = !enabled || inputValue === "" || createConflict;
    sessionRenameInputEl.disabled = !enabled || !isRenaming;
    sessionRenameSaveBtn.disabled =
        !enabled ||
        !isRenaming ||
        renameValue === "" ||
        renameConflict ||
        renameUnchanged;
    sessionRenameCancelBtn.disabled = !enabled || !isRenaming;
    sessionRenameInputEl.classList.toggle("conflict", renameConflict);
    if (renameConflict) {
        sessionRenameInputEl.setAttribute("aria-invalid", "true");
        sessionRenameInputEl.title =
            "A conversation with this name already exists.";
    } else {
        sessionRenameInputEl.removeAttribute("aria-invalid");
        sessionRenameInputEl.title = "Rename conversation";
    }
    sessionNewNameEl.classList.toggle("conflict", createConflict);
    if (createConflict) {
        sessionNewNameEl.setAttribute("aria-invalid", "true");
        sessionNewNameEl.title = "A conversation with this name already exists.";
    } else {
        sessionNewNameEl.removeAttribute("aria-invalid");
        sessionNewNameEl.title = "New conversation name";
    }

    // Show/hide hint based on whether session exists
    if (createConflict) {
        sessionCreateHintEl.classList.remove("hidden");
    } else {
        sessionCreateHintEl.classList.add("hidden");
    }

    sessionSearchInputEl.disabled = !enabled;
}

function renderSessionList(
    sessions: SessionListEntry[],
    selectedSessionId?: string,
): void {
    const selectedId = selectedSessionId ?? currentSessionId;
    knownSessions = sessions;
    const selected = sessions.find((session) => session.sessionId === selectedId);
    if (selected) {
        currentSessionId = selected.sessionId;
        currentSessionName = selected.name;
        currentSessionClientCount = selected.clientCount;
    }
    updateSessionSummary();
    renderSessionSearchResults();
}

function renderSessionSearchResults(): void {
    const query = sessionSearchInputEl.value.trim().toLowerCase();
    const matches = knownSessions.filter(
        (session) =>
            session.name.toLowerCase().includes(query) ||
            session.sessionId.toLowerCase().includes(query),
    );

    if (
        searchRenameSessionId &&
        !knownSessions.some((s) => s.sessionId === searchRenameSessionId)
    ) {
        searchRenameSessionId = undefined;
    }

    sessionSearchResultsEl.innerHTML = "";
    if (matches.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "session-search-empty";
        emptyEl.textContent = "No conversations found";
        sessionSearchResultsEl.appendChild(emptyEl);
        return;
    }

    for (const session of matches) {
        const rowEl = document.createElement("div");
        rowEl.className = "session-search-result-row";

        const resultBtn = document.createElement("button");
        resultBtn.type = "button";
        resultBtn.className = "session-search-result";
        resultBtn.setAttribute("role", "option");
        const isCurrent = session.sessionId === currentSessionId;
        resultBtn.setAttribute("aria-selected", String(isCurrent));
        if (isCurrent) resultBtn.classList.add("current");
        const isRenameRow = searchRenameSessionId === session.sessionId;
        if (isRenameRow) resultBtn.classList.add("hidden");

        const nameEl = document.createElement("span");
        nameEl.className = "session-search-result-name";
        nameEl.textContent = session.name;
        resultBtn.appendChild(nameEl);

        const countEl = document.createElement("span");
        countEl.className = "session-search-result-count";
        countEl.textContent = formatClientCount(session.clientCount);
        resultBtn.appendChild(countEl);

        resultBtn.addEventListener("click", () => {
            if (session.sessionId !== currentSessionId) {
                vscode.postMessage({
                    type: "switchSession",
                    sessionId: session.sessionId,
                });
            }
            hideSessionPopovers();
        });

        const actionsEl = document.createElement("div");
        actionsEl.className = "session-search-result-actions";
        if (isRenameRow) actionsEl.classList.add("hidden");

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "session-search-item-btn";
        editBtn.title = "Rename conversation";
        editBtn.setAttribute("aria-label", "Rename conversation");
        editBtn.innerHTML =
            '<span class="codicon codicon-edit session-action-icon" aria-hidden="true"></span>';
        editBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!isConnected || isSwitching) return;
            searchRenameSessionId = session.sessionId;
            renderSessionSearchResults();
            const input = sessionSearchResultsEl.querySelector(
                `input[data-session-id="${session.sessionId}"]`,
            ) as HTMLInputElement | null;
            input?.focus();
            input?.select();
        });
        actionsEl.appendChild(editBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "session-search-item-btn";
        deleteBtn.title = "Delete conversation";
        deleteBtn.setAttribute("aria-label", "Delete conversation");
        deleteBtn.innerHTML =
            '<span class="codicon codicon-trash session-action-icon" aria-hidden="true"></span>';
        deleteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!isConnected || isSwitching) return;
            vscode.postMessage({
                type: "deleteSession",
                sessionId: session.sessionId,
            });
        });
        actionsEl.appendChild(deleteBtn);

        const renameEditorEl = document.createElement("div");
        renameEditorEl.className = "session-search-inline-rename";
        if (!isRenameRow) renameEditorEl.classList.add("hidden");

        const renameInputEl = document.createElement("input");
        renameInputEl.type = "text";
        renameInputEl.value = session.name;
        renameInputEl.title = "Rename conversation";
        renameInputEl.setAttribute("aria-label", "Rename conversation");
        renameInputEl.setAttribute("data-session-id", session.sessionId);
        renameEditorEl.appendChild(renameInputEl);

        const renameSaveBtn = document.createElement("button");
        renameSaveBtn.type = "button";
        renameSaveBtn.className = "session-search-item-btn";
        renameSaveBtn.title = "Save conversation name";
        renameSaveBtn.setAttribute("aria-label", "Save conversation name");
        renameSaveBtn.innerHTML =
            '<span class="codicon codicon-check session-action-icon" aria-hidden="true"></span>';
        renameEditorEl.appendChild(renameSaveBtn);

        const renameCancelBtn = document.createElement("button");
        renameCancelBtn.type = "button";
        renameCancelBtn.className = "session-search-item-btn";
        renameCancelBtn.title = "Cancel rename";
        renameCancelBtn.setAttribute("aria-label", "Cancel rename");
        renameCancelBtn.innerHTML =
            '<span class="codicon codicon-close session-action-icon" aria-hidden="true"></span>';
        renameEditorEl.appendChild(renameCancelBtn);

        const syncRenameState = () => {
            const name = renameInputEl.value.trim();
            const conflict = hasSessionRenameConflict(session.sessionId, name);
            const unchanged = name.toLowerCase() === session.name.toLowerCase();
            renameSaveBtn.disabled =
                !isConnected || isSwitching || !name || conflict || unchanged;
            renameInputEl.classList.toggle("conflict", conflict);
            if (conflict) {
                renameInputEl.setAttribute("aria-invalid", "true");
                renameInputEl.title =
                    "A conversation with this name already exists.";
            } else {
                renameInputEl.removeAttribute("aria-invalid");
                renameInputEl.title = "Rename conversation";
            }
        };

        const cancelInlineRename = () => {
            searchRenameSessionId = undefined;
            renderSessionSearchResults();
        };

        const submitInlineRename = () => {
            if (!isConnected || isSwitching) return;
            const name = renameInputEl.value.trim();
            const conflict = hasSessionRenameConflict(session.sessionId, name);
            const unchanged = name.toLowerCase() === session.name.toLowerCase();
            if (!name || conflict || unchanged) return;
            searchRenameSessionId = undefined;
            vscode.postMessage({
                type: "renameSession",
                sessionId: session.sessionId,
                name,
            });
        };

        renameInputEl.addEventListener("input", syncRenameState);
        renameInputEl.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submitInlineRename();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                cancelInlineRename();
            }
        });
        renameSaveBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            submitInlineRename();
        });
        renameCancelBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            cancelInlineRename();
        });
        syncRenameState();

        rowEl.appendChild(resultBtn);
        rowEl.appendChild(actionsEl);
        rowEl.appendChild(renameEditorEl);
        sessionSearchResultsEl.appendChild(rowEl);
    }
}

function showSessionSearchPopover(): void {
    if (!isConnected || isSwitching) return;
    setPopoverVisible(sessionCreatePopoverEl, false);
    searchRenameSessionId = undefined;
    sessionSearchInputEl.value = "";
    renderSessionSearchResults();
    setPopoverVisible(sessionSearchPopoverEl, true);
    requestSessionList();
    sessionSearchInputEl.focus();
}

function createSessionFromInput(): void {
    const name = sessionNewNameEl.value.trim();
    if (!name || !isConnected || isSwitching || hasCreateConflict(name)) return;
    vscode.postMessage({ type: "createSession", name });
    sessionNewNameEl.value = "";
    hideSessionPopovers();
    updateSessionControlsEnabled();
}

function showCreateSessionPopover(): void {
    if (!isConnected || isSwitching) return;
    setPopoverVisible(sessionSearchPopoverEl, false);
    setPopoverVisible(sessionCreatePopoverEl, true);
    sessionNewNameEl.focus();
    sessionNewNameEl.select();
}

function setStatus(
    connected: boolean,
    sessionId?: string,
    sessionName?: string,
): void {
    isConnected = connected;
    lastConnected = connected;
    currentSessionId = sessionId ?? currentSessionId;
    if (sessionName) currentSessionName = sessionName;
    updateSessionSummary();
    chatPanel.setEnabled(connected);
    updateSessionControlsEnabled();
}

sessionNameBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isRenaming) return;
    const willShow = sessionSearchPopoverEl.classList.contains("hidden");
    if (willShow) {
        showSessionSearchPopover();
    } else {
        setPopoverVisible(sessionSearchPopoverEl, false);
    }
});

sessionRenameBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    beginRenameCurrentSession();
});

sessionDeleteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isConnected || isSwitching || !currentSessionId) return;
    hideSessionPopovers();
    vscode.postMessage({ type: "deleteCurrentSession" });
});

sessionSearchInputEl.addEventListener("input", () => {
    renderSessionSearchResults();
});

sessionNewNameEl.addEventListener("input", () => {
    updateSessionControlsEnabled();
});

sessionNewNameEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    createSessionFromInput();
});

sessionCreateBtn.addEventListener("click", () => {
    createSessionFromInput();
});

sessionRenameInputEl.addEventListener("input", () => {
    updateSessionControlsEnabled();
});

sessionRenameInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        submitRenameCurrentSession();
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        cancelRenameCurrentSession();
    }
});

sessionRenameSaveBtn.addEventListener("click", () => {
    submitRenameCurrentSession();
});

sessionRenameCancelBtn.addEventListener("click", () => {
    cancelRenameCurrentSession();
});

document.addEventListener("click", (event) => {
    const target = event.target as Node | null;
    if (!target) return;
    if (
        sessionCreatePopoverEl.contains(target) ||
        sessionSearchPopoverEl.contains(target) ||
        sessionRenameEditorEl.contains(target) ||
        sessionNameBtn.contains(target) ||
        sessionRenameBtn.contains(target) ||
        sessionDeleteBtn.contains(target)
    ) {
        return;
    }
    hideSessionPopovers();
});

document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (isRenaming) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelRenameCurrentSession();
        return;
    }
    if (!isSessionPopoverVisible()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    hideSessionPopovers();
});

window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
        case "status":
            setStatus(msg.connected, msg.sessionId, msg.sessionName);
            if (msg.connected && msg.sessionId) {
                currentSessionId = msg.sessionId;
                vscode.setState({
                    sessionId: msg.sessionId,
                    sessionName: msg.sessionName,
                });
                requestSessionList();
            }
            break;
        case "activateNewSessionInput":
            showCreateSessionPopover();
            break;
        case "reconnectStatus": {
            // Single in-place reconnect indicator. Phases:
            //   waiting     -> "Disconnected — retrying in Ns (attempt N)"
            //   connecting  -> "Disconnected — connecting..."
            //   cleared     -> hide overlay (back online or user disconnected)
            if (msg.phase === "cleared") {
                reconnectText = undefined;
            } else if (msg.phase === "connecting") {
                reconnectText = `Disconnected — connecting${msg.attempt ? ` (attempt ${msg.attempt})` : ""}…`;
            } else {
                const sec = msg.secondsRemaining ?? 0;
                const errSuffix = msg.error ? ` · ${msg.error}` : "";
                reconnectText = `Disconnected — retrying in ${sec}s (attempt ${msg.attempt ?? 1})${errSuffix}`;
            }
            renderStatus();
            break;
        }
        case "userInfo":
            chatPanel.setUserInfo(msg.name);
            break;
        case "sessionChanged":
            currentSessionId = msg.sessionId;
            currentSessionName = msg.sessionName || msg.sessionId.substring(0, 8);
            currentSessionClientCount = undefined;
            transitionStatusLabel = undefined;
            if (isRenaming) setRenameMode(false);
            updateSessionSummary();
            chatPanel.clear();
            cancelledRequests.clear();
            cancelledRendered.clear();
            pendingQueueStatus.clear();
            queueMirror.reset(undefined);
            requestSessionList();
            break;
        case "sessionList":
            renderSessionList(msg.sessions, msg.currentSessionId);
            break;
        case "setDisplay":
            // Drop display updates that arrive AFTER cancellation —
            // dispatcher status messages often race with the abort.
            if (isCancelledRequest(msg.requestId)) break;
            chatPanel.replaceAgentMessage(
                msg.message.message,
                msg.message.source,
                msg.message.sourceIcon,
                msg.requestId,
            );
            break;
        case "appendDisplay":
            if (isCancelledRequest(msg.requestId)) break;
            chatPanel.addAgentMessage(
                msg.message.message,
                msg.message.source,
                msg.message.sourceIcon,
                msg.mode,
                msg.requestId,
            );
            break;
        case "setUserRequest": {
            // Echo from server. If we already rendered locally, skip;
            // otherwise render as a peer bubble (don't hijack local
            // thread-routing state).
            const rid = msg.requestId;
            if (rid && !chatPanel.hasUserMessage(rid)) {
                chatPanel.addRemoteUserMessage(msg.command, rid);
                // Apply any chip status received before the bubble existed.
                const pending = pendingQueueStatus.get(rid);
                if (pending) {
                    applyQueueChip(rid, pending.serverId, pending.status);
                }
            }
            break;
        }
        case "setDisplayInfo":
            // Same rationale as the setDisplay guard above.
            if (isCancelledRequest(msg.requestId)) break;
            // chat-ui signature: (source, sourceIcon?, action?, requestId?)
            chatPanel.setDisplayInfo(
                msg.source,
                undefined,
                msg.action,
                msg.requestId,
            );
            break;
        case "clear":
            chatPanel.clear();
            cancelledRequests.clear();
            cancelledRendered.clear();
            pendingQueueStatus.clear();
            break;
        case "notify": {
            const rid = msg.requestId;
            if (msg.event === "explained" && rid) {
                chatPanel.notifyExplained(rid, msg.data);
            } else if (msg.event === "grammarRule" && rid) {
                chatPanel.updateGrammarResult(rid, msg.data);
            } else if (msg.event === "commandComplete" && rid) {
                // Strip cancelled flag if already claimed elsewhere to
                // avoid double-stamping the affordance.
                const result = mapResult(msg.data?.result);
                const cancelled =
                    result?.cancelled === true &&
                    claimCancelledRender(rid, msg.aliasRequestId);
                chatPanel.completeRequest(
                    rid,
                    result ? { ...result, cancelled } : undefined,
                );
                // Defensive chip clear (see direct `commandComplete` case).
                clearQueueChip(rid);
                if (msg.aliasRequestId) clearQueueChip(msg.aliasRequestId);
            } else {
                chatPanel.addSystemMessage(`[${msg.source}] ${msg.event}`);
            }
            break;
        }
        case "error":
            // Drop awaitCommand rejection-from-cancel stragglers; the
            // "⚠ Cancelled" affordance is already on screen.
            if (isCancelledRequest(msg.requestId)) break;
            chatPanel.addSystemMessage(`Error: ${msg.message}`);
            break;
        case "commandResult":
            // Legacy — no-op
            break;
        case "commandComplete": {
            const rid = msg.requestId;
            const result = mapResult(msg.result);
            if (rid) {
                const cancelled =
                    result?.cancelled === true &&
                    claimCancelledRender(rid, msg.aliasRequestId);
                chatPanel.completeRequest(
                    rid,
                    result ? { ...result, cancelled } : undefined,
                );
                // Defensive: clear any lingering "running"/"queued"
                // chip on the local bubble. `queueStateChanged` will
                // also reconcile this on the next snapshot, but
                // clearing here makes the running indicator disappear
                // immediately on completion (and covers the case
                // where no follow-up snapshot fires).
                clearQueueChip(rid);
                if (msg.aliasRequestId) clearQueueChip(msg.aliasRequestId);
            }
            // Restore the send button (was swapped for the stop button
            // by send()/setProcessing). Done unconditionally so a
            // missing/garbled requestId still gets the input back.
            chatPanel.setIdle();
            break;
        }
        case "peerMetrics": {
            // Forwarded from a peer tab on the same session — apply the
            // timing tooltip to our local bubble for that requestId.
            const rid = msg.requestId;
            if (rid) chatPanel.completeRequest(rid, mapResult(msg.result));
            break;
        }
        case "switching":
            isSwitching = msg.switching;
            if (msg.switching) {
                if (isRenaming) setRenameMode(false);
                transitionStatusLabel = msg.statusLabel ?? "Connecting";
                transitionTargetName = msg.targetName;
            } else {
                transitionStatusLabel = undefined;
                transitionTargetName = undefined;
            }
            updateSessionSummary();
            chatPanel.setSwitching(msg.switching, msg.targetName);
            // Re-apply connection-derived enable state when the switch ends.
            if (!msg.switching) chatPanel.setEnabled(isConnected);
            updateSessionControlsEnabled();
            break;
        case "historyReplay":
            chatPanel.replayHistory(toChatPanelHistory(msg.entries));
            break;
        case "setActive":
            document.body.classList.toggle("chat-inactive", !msg.active);
            break;
        case "historyLoading":
            chatPanel.setHistoryLoading(msg.loading);
            if (!msg.loading) chatPanel.setEnabled(isConnected);
            break;
        case "conversationNotification":
            // Conversation-management feedback. We add a fresh agent
            // bubble rather than reusing the user request's bubble
            // because for switch/new/prev/next the request belongs to
            // the OLD conversation and `chatPanel.clear()` ran on
            // sessionChanged before this message arrived.
            chatPanel.addAgentMessage(
                { type: "html", content: msg.content, kind: msg.kind },
                "conversation",
            );
            break;
        case "pcState":
            chatPanel.applyPcState(msg.state);
            break;
        case "demoState":
            // Reflect demo state in the connection ribbon. The chat-ui
            // chatPanel still installs its capture-phase keyhandler
            // when paused (Esc cancels, Alt+→ continues) and a
            // dedicated input-ghost hint shows the controls.
            if (!msg.running) {
                demoSuffix = undefined;
            } else if (msg.paused) {
                demoSuffix = `[Demo Mode (Paused)${msg.message ? ` — ${msg.message}` : ""}]`;
            } else {
                demoSuffix = `[Demo Mode (Running)]`;
            }
            renderStatus();
            chatPanel.setDemoPaused(msg.paused, msg.message);
            chatPanel.setDemoRunning(msg.running);
            chatPanel.setInputHint(
                msg.paused ? "Alt+→ continue · Esc cancel" : undefined,
            );
            break;
        case "demoTypeAndSend":
            // Animate typing into the chat input then submit, so demo
            // playback in the extension matches the Electron shell's
            // natural-keystroke effect. If cancelled mid-animation,
            // notify the host so it can release its waiter on this
            // requestId and let the demo loop see the cancel.
            void chatPanel
                .typeAndSend(msg.command, msg.requestId)
                .then((sent) => {
                    if (!sent) {
                        vscode.postMessage({
                            type: "demoLineCancelled",
                            requestId: msg.requestId,
                        });
                    }
                });
            break;
        case "demoCancelTyping":
            chatPanel.cancelTypingAnimation();
            break;
        // Per-conversation queue lifecycle events forwarded from the bridge.
        // The mirror keeps a local snapshot so the cancellation affordance
        // and the double-Esc gesture have authoritative state without
        // polling. Fine-grained events are admitted via QueueStateMirror's
        // version watermark so stragglers from before a newer snapshot
        // can't resurrect stale chips; `queueStateChanged` carries the
        // authoritative reconciliation.
        case "queueRequestQueued": {
            const result = queueMirror.applyQueued(msg.entry, msg.version);
            if (!result.admitted) break;
            const targetRid = chipTargetRid(msg.entry, msg.clientRequestId);
            materializeQueueBubbleIfMissing(msg.entry, targetRid);
            applyQueueChip(targetRid, msg.entry.requestId, "queued");
            break;
        }
        case "queueRequestStarted": {
            const result = queueMirror.applyStarted(msg.entry, msg.version);
            if (!result.admitted) break;
            if (result.previousRunning) {
                clearQueueChip(
                    chipTargetRid(result.previousRunning, undefined),
                );
            }
            const targetRid = chipTargetRid(msg.entry, msg.clientRequestId);
            materializeQueueBubbleIfMissing(msg.entry, targetRid);
            applyQueueChip(targetRid, msg.entry.requestId, "running");
            break;
        }
        case "queueRequestCancelled": {
            const mirrorResult = queueMirror.applyCancelled(
                msg.requestId,
                msg.version,
            );
            // Mark BOTH the server UUID and (if resolved) the
            // clientRequestId so subsequent display messages keyed by
            // either form are recognised as cancelled. The bridge
            // resolves the alias via `lookupClientRequestId`, but
            // belt-and-suspenders marking both protects against the
            // rare case where the lookup misses for a peer-originated
            // request that arrived before setUserRequest populated the
            // reverse map.
            markCancelled(msg.requestId, msg.clientRequestId);
            // Resolve which UI key to target. chat-ui keys bubbles by
            // clientRequestId (when known via the bridge's reverse map);
            // peer-originated requests fall back to the canonical server
            // id, which only has a matching bubble if a setUserRequest
            // already promoted it.
            const targetRid = msg.clientRequestId ?? msg.requestId;
            // Clear chip and any pending stash even if the version was
            // stale — the user's authoritative intent is "this is
            // cancelled", and a leftover chip would be misleading.
            clearQueueChip(targetRid);
            if (msg.clientRequestId !== msg.requestId) {
                clearQueueChip(msg.requestId);
            }
            // Stale events don't get to paint the cancellation
            // affordance — that would conflict with a newer snapshot.
            if (!mirrorResult.admitted) break;
            // Mirror the Electron shell guard
            // (chatView.ts:1089-1094: only notifyCancelled when
            // idToMessageGroup has the entry). For peer-originated
            // queued items that were cancelled BEFORE setUserRequest
            // ever fired in this tab — no user bubble was ever
            // rendered, so painting a stand-alone "⚠ Cancelled" agent
            // bubble would be a floating affordance with no anchor.
            // For our own requests, send() registers the user message
            // before any cancel can land, so this gate passes.
            if (!chatPanel.hasUserMessage(targetRid)) {
                if (chatPanel.getActiveRequestId() === targetRid) {
                    chatPanel.setIdle();
                }
                break;
            }
            // Dedupe against any prior commandComplete render. Pass BOTH
            // id forms so claim mirrors `markCancelled` — without this,
            // a later commandComplete keyed by the OTHER id form would
            // pass its own claim check and paint a second "⚠ Cancelled".
            if (claimCancelledRender(msg.requestId, msg.clientRequestId)) {
                chatPanel.completeRequest(targetRid, { cancelled: true });
            }
            // If the bubble that just cancelled is OUR active request,
            // pop the stop button back to the send button. setIdle()
            // is itself idempotent so it's safe to call regardless.
            if (chatPanel.getActiveRequestId() === targetRid) {
                chatPanel.setIdle();
            }
            break;
        }
        case "queueStateChanged": {
            const result = queueMirror.applyQueueStateChanged(msg.snapshot);
            if (!result.admitted) break;
            reconcileQueueChips(result.previous, msg.snapshot);
            break;
        }
    }
});

// Ask the extension host to connect
updateSessionControlsEnabled();
vscode.postMessage({ type: "connect" });

// Document-level Escape gesture — mirrors the Electron shell
// (`packages/shell/src/renderer/src/chat/chatView.ts:404-422`):
//   * Single Esc with an active request → cancel that request.
//   * Two Esc presses within DOUBLE_ESCAPE_WINDOW_MS → cancel ALL
//     queued + running entries on the session.
// Chat-ui's own input-level handler (chatPanel.ts:712) takes care of
// completion-popup dismissal and cancellation when the input is focused,
// and calls `e.preventDefault()` when it consumes the keystroke. We
// honor that flag here so the gesture isn't double-counted.
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (e.defaultPrevented) {
        // chat-ui (or another in-iframe handler) already consumed this
        // Escape — but we still update the double-Esc clock so a paired
        // second press within the window can fire cancelAllQueuedAndRunning.
        const now = Date.now();
        const isDouble = now - lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
        lastEscapeTime = now;
        if (isDouble) {
            lastEscapeTime = 0;
            vscode.postMessage({ type: "cancelAllQueuedAndRunning" });
        }
        return;
    }
    const now = Date.now();
    const isDouble = now - lastEscapeTime <= DOUBLE_ESCAPE_WINDOW_MS;
    lastEscapeTime = now;
    // Prefer chat-ui's notion of "active" (drives the send/stop button
    // toggle on this view). Fall back to the queue mirror's running
    // entry so an Esc landing in the brief gap between commandComplete
    // and the next requestStarted still cancels what's actually
    // executing on the dispatcher. Also covers peer-originated requests
    // we never tracked locally.
    const activeId =
        chatPanel.getActiveRequestId() ??
        queueMirror.snapshot?.running?.requestId;
    if (activeId) {
        // Cancel just the running request on first Esc — uses the same
        // path the chat-ui input handler would use when focused, so the
        // bridge sees a uniform cancelCommand message.
        e.preventDefault();
        vscode.postMessage({ type: "cancelCommand", requestId: activeId });
    }
    if (isDouble) {
        // Reset so a third press doesn't immediately re-trigger.
        lastEscapeTime = 0;
        e.preventDefault();
        vscode.postMessage({ type: "cancelAllQueuedAndRunning" });
    }
});

// Report focus changes so the extension can drive a context key for keybindings.
const reportFocus = (focused: boolean) => {
    vscode.postMessage({ type: "focus", focused });
};
window.addEventListener("focus", () => reportFocus(true));
window.addEventListener("blur", () => reportFocus(false));
document.addEventListener("focusin", () => reportFocus(true));
document.addEventListener("focusout", () => {
    // Only report blur if focus left the document entirely
    if (!document.hasFocus()) reportFocus(false);
});
if (document.hasFocus()) reportFocus(true);

// Tear down the panel's window-level listeners (demo key handler,
// completion controller) when the webview is being unloaded by VS
// Code. Window-scoped in a webview is per-iframe so the OS will
// reclaim the listeners regardless, but explicit dispose keeps the
// invariant clean for hosts that retain the panel across reloads.
window.addEventListener("pagehide", () => chatPanel.dispose());
