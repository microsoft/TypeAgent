// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host-neutral model describing the agent-server connection while it is not
 * healthy. Shared by every chat host (VS Code webview, Electron renderer) so
 * the reconnect / give-up / manual-recovery UX renders identically everywhere.
 *
 * The model is a plain serializable object (no callbacks) so it can cross a
 * postMessage / IPC boundary unchanged; user clicks on the recovery links are
 * delivered back to the host through a separate {@link ConnectionActionHandler}.
 */

/** Manual recovery actions a host may offer once auto-reconnect has stopped. */
export type ConnectionActionId = "retry" | "start";

export interface ConnectionStatus {
    /**
     * - `connecting` — an attempt is currently in flight.
     * - `waiting` — a backoff timer is running; {@link secondsRemaining} counts down.
     * - `stopped` — auto-reconnect gave up; offer {@link actions} for manual recovery.
     */
    phase: "connecting" | "waiting" | "stopped";
    /** 1-based attempt counter, surfaced for context. */
    attempt?: number;
    /** Seconds left on the backoff timer — only meaningful while `waiting`. */
    secondsRemaining?: number;
    /** Last connection error, surfaced as context when known. */
    error?: string;
    /** Manual actions to offer — only rendered while `stopped`. */
    actions?: ConnectionActionId[];
}

export type ConnectionActionHandler = (action: ConnectionActionId) => void;

export const DEFAULT_ACTION_LABELS: Record<ConnectionActionId, string> = {
    retry: "Retry",
    start: "Start server",
};

/**
 * Human-readable status line (without any action links).
 *
 * Pass `omitCountdown` for the `waiting` phase to drop the volatile "in Ns"
 * countdown, yielding a stable string suitable for a hover tooltip / accessible
 * label that would otherwise flicker (native tooltips dismiss themselves when
 * their text changes) on every one-second tick.
 */
export function formatConnectionStatusText(
    status: ConnectionStatus,
    options?: { omitCountdown?: boolean },
): string {
    const attemptSuffix =
        status.attempt && status.attempt > 0
            ? ` (attempt ${status.attempt})`
            : "";
    const errorSuffix = status.error ? ` · ${status.error}` : "";
    switch (status.phase) {
        case "connecting":
            return `Disconnected — connecting${attemptSuffix}…`;
        case "waiting": {
            if (options?.omitCountdown) {
                return `Disconnected — retrying${attemptSuffix}${errorSuffix}…`;
            }
            const sec = status.secondsRemaining ?? 0;
            return `Disconnected — retrying in ${sec}s${attemptSuffix}${errorSuffix}`;
        }
        case "stopped":
            return `Disconnected — stopped${attemptSuffix}${errorSuffix}`;
    }
}

/**
 * Render `status` into `container`, replacing its contents with a status label
 * plus a clickable link for each manual action (only while `stopped`). Clicks
 * invoke `onAction`, which the host wires to its own retry / start plumbing.
 */
export function renderConnectionStatus(
    container: HTMLElement,
    status: ConnectionStatus,
    onAction?: ConnectionActionHandler,
    labels: Partial<Record<ConnectionActionId, string>> = {},
): void {
    container.replaceChildren();

    const text = document.createElement("span");
    text.className = "connection-status-text";
    text.textContent = formatConnectionStatusText(status);
    container.appendChild(text);

    const actions = status.phase === "stopped" ? (status.actions ?? []) : [];
    for (const id of actions) {
        const action = document.createElement("button");
        action.type = "button";
        action.className = `connection-status-action connection-status-action-${id}`;
        action.textContent = labels[id] ?? DEFAULT_ACTION_LABELS[id];
        action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onAction?.(id);
        });
        container.appendChild(action);
    }
}
