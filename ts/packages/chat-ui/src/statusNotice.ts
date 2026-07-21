// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Host-neutral model for a persistent, dismissible status notice.
 *
 * Rendered by {@link ChatPanel.showStatusNotice} as a corner toast that the
 * user can collapse into a bell (and re-expand) - it stays until dismissed
 * rather than auto-hiding like {@link ChatPanel.showToast}. Used for
 * durable, state-y conditions such as "the agent server is running
 * out-of-date code" (pushed by the server on connect). Shared by every chat
 * host (Electron shell, VS Code webview) so the UX is identical.
 *
 * Delivered over `ClientIO.notify` as `event === STATUS_NOTICE_EVENT` with a
 * {@link StatusNotice} as `data`. Kept a plain serializable object so it
 * crosses the IPC / postMessage boundary unchanged; the action button runs
 * {@link StatusNotice.actionCommand} back through the chat input, so no
 * host-specific callback wiring is needed.
 */

/**
 * `ClientIO.notify` event name that carries a {@link StatusNotice}. The event
 * string is the wire contract with emitters (e.g. the agent-server), which
 * send the same literal.
 */
export const STATUS_NOTICE_EVENT = "statusNotice";

export type StatusNoticeLevel = "info" | "warning" | "error";

export interface StatusNotice {
    /**
     * Stable identity for this notice. Re-showing the same `id` replaces the
     * existing one (so a reconnect that re-sends it doesn't stack duplicates).
     */
    id: string;
    /** Severity accent; defaults to `info`. */
    level?: StatusNoticeLevel;
    title: string;
    message?: string;
    /** Label for an optional action button. Requires {@link actionCommand}. */
    actionLabel?: string;
    /** Command run (via the chat input) when the action button is clicked. */
    actionCommand?: string;
    /**
     * When set, the action button is relabeled to this after it is clicked. The
     * button is always disabled on click to block a second trigger; supplying
     * this gives that disabled state a "working" label (e.g. "Restarting...").
     */
    actionBusyLabel?: string;
    /**
     * When set, the notice body text is replaced with this after the action
     * button is clicked - e.g. to explain that the notice clears itself once
     * the action completes. Only applies when the notice has a {@link message}.
     */
    actionBusyMessage?: string;
    /**
     * When true this is a *retract* request rather than a notice to show: the
     * host removes any existing notice with {@link id} and renders nothing.
     * Lets an emitter take back a notice it previously pushed (e.g. the
     * agent-server dropping the stale-build warning once a fresh build
     * reconnects). Only {@link id} is required; other fields are ignored.
     */
    dismiss?: boolean;
}

/**
 * Narrow untrusted `notify` `data` into a {@link StatusNotice}. Returns
 * `undefined` when the payload isn't a well-formed notice, so hosts can guard
 * at the RPC boundary. Only `id` and `title` are required.
 */
export function parseStatusNotice(data: unknown): StatusNotice | undefined {
    if (typeof data !== "object" || data === null) {
        return undefined;
    }
    const d = data as Record<string, unknown>;
    if (typeof d.id !== "string") {
        return undefined;
    }
    // A retract only needs an id; there is nothing to render.
    if (d.dismiss === true) {
        return { id: d.id, title: "", dismiss: true };
    }
    if (typeof d.title !== "string") {
        return undefined;
    }
    const notice: StatusNotice = { id: d.id, title: d.title };
    if (d.level === "info" || d.level === "warning" || d.level === "error") {
        notice.level = d.level;
    }
    if (typeof d.message === "string") {
        notice.message = d.message;
    }
    if (typeof d.actionLabel === "string") {
        notice.actionLabel = d.actionLabel;
    }
    if (typeof d.actionCommand === "string") {
        notice.actionCommand = d.actionCommand;
    }
    if (typeof d.actionBusyLabel === "string") {
        notice.actionBusyLabel = d.actionBusyLabel;
    }
    if (typeof d.actionBusyMessage === "string") {
        notice.actionBusyMessage = d.actionBusyMessage;
    }
    return notice;
}
