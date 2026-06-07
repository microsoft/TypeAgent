// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared queue-chip controller for chat-ui hosts (Electron Shell renderer,
 * VS Code shell webview, future chat-ui consumers).
 *
 * Owns the per-renderer `QueueStateMirror`, the deferred-chip stash, and
 * the four event-folding helpers (`onRequestQueued / onRequestStarted /
 * onRequestCancelled / onQueueStateChanged`) that stamp "queued" / "running"
 * pills on user bubbles via `chatPanel.setUserBubbleQueueStatus(...)`.
 *
 * Each host wires this once at startup, hands every queue `ClientIO` event
 * (or its wire equivalent) to the matching `on*` method, and supplies a
 * single `cancelById(serverId)` callback that the `×` button invokes when
 * a queued bubble is dismissed.
 *
 * The controller does NOT own:
 *  - Single/double-Escape key gestures — use `attachDoubleEscape()` (this
 *    module) for the standard wiring, or roll your own using the
 *    controller's `snapshot` getter.
 *  - Cancellation affordance rendering (e.g. the "⚠ Cancelled" agent
 *    bubble surfaced by the VS Code shell) — that lives in the host because
 *    different hosts make different rendering decisions there.
 */

import type { QueuedRequest, QueueSnapshot } from "@typeagent/dispatcher-types";
import { QueueStateMirror } from "@typeagent/dispatcher-types";
import type { ChatPanel } from "./chatPanel.js";

/**
 * Minimum surface area of {@link ChatPanel} required by the controller.
 * Kept as a structural interface so unit tests don't have to mock the
 * full ChatPanel.
 */
export interface QueueChipChatPanel {
    hasUserMessage(requestId: string): boolean;
    addRemoteUserMessage(text: string, requestId: string): void;
    setUserBubbleQueueStatus(
        requestId: string,
        status: "queued" | "running" | null,
        onCancel?: () => void,
    ): void;
}

export interface QueueChipControllerOptions {
    /** The chat-ui panel that owns the user bubbles being chipped. */
    chatPanel: QueueChipChatPanel;
    /**
     * Cancel-by-server-id callback invoked when the user clicks the
     * `×` button on a queued chip. Hosts forward this through whatever
     * cancellation transport they use (direct `dispatcher.cancelCommand`
     * for the Electron Shell, a `postMessage` to the extension host for
     * the VS Code shell). Promise rejections are caught by the
     * controller and swallowed — the `×` click is fire-and-forget from
     * the user's perspective.
     */
    cancelById: (serverId: string) => void | Promise<void>;
}

/**
 * Shared queue-chip controller. Hosts construct one per renderer (or
 * per chat session) and route the four queue `ClientIO` events through
 * its `on*` methods.
 */
export class QueueChipController {
    private readonly chatPanel: QueueChipChatPanel;
    private readonly cancelById: (serverId: string) => void | Promise<void>;

    private readonly mirror = new QueueStateMirror();

    /**
     * Chips deferred until their bubble materializes. Keyed by the
     * chat-ui bubble id (clientRequestId for local sends, server
     * requestId for peer-only). `serverId` is the canonical id passed
     * to `cancelById` when the user clicks the `×` button — needed
     * because the bubble key may BE the serverId for remote-only entries.
     */
    private readonly pending = new Map<
        string,
        { status: "queued" | "running"; serverId: string }
    >();

    constructor(options: QueueChipControllerOptions) {
        this.chatPanel = options.chatPanel;
        this.cancelById = options.cancelById;
    }

    /**
     * Current authoritative queue snapshot as last admitted by the mirror.
     * Hosts read this to drive double-Escape cancel-all and active-id
     * fallbacks on single-Esc.
     */
    get snapshot(): QueueSnapshot | undefined {
        return this.mirror.snapshot;
    }

    /**
     * Resolve the chat-ui bubble key for a queue entry. Local entries
     * use the client-assigned id (which equals the bubble key chat-ui
     * set on `addUserMessage`); peer entries fall back to the server
     * UUID (the key used by `addRemoteUserMessage`). `QueuedRequest`
     * types `clientRequestId` as `unknown`, so the helper narrows with
     * `typeof === "string"` before use.
     *
     * In our wire protocol the dispatcher echoes the client's submitted
     * `clientRequestId` back onto every `QueuedRequest`, so the entry's
     * own `clientRequestId` is authoritative — hosts that maintain an
     * out-of-band id form for the same bubble should remap upstream of
     * the controller rather than expecting the controller to bridge
     * the two. Single-key chip storage is the controller's invariant.
     */
    chipTargetRid(entry: QueuedRequest): string {
        if (typeof entry.clientRequestId === "string") {
            return entry.clientRequestId;
        }
        return entry.requestId;
    }

    /**
     * Materialize a peer-originated user bubble so a chip has something
     * to attach to. No-op when the bubble already exists or `entry.text`
     * is missing.
     */
    materializeQueueBubbleIfMissing(
        entry: QueuedRequest,
        targetRid: string,
    ): void {
        if (this.chatPanel.hasUserMessage(targetRid)) return;
        if (entry.text) {
            this.chatPanel.addRemoteUserMessage(entry.text, targetRid);
        }
    }

    /**
     * Stamp a chip on the bubble for `targetRid` if it exists; otherwise
     * stash for later application by a subsequent reconcile. The × button
     * cancels via the server UUID — `cancelById` accepts either id form
     * in most hosts, but the snapshot only carries the server id for
     * peer-origin entries so we always pass that.
     */
    applyQueueChip(
        targetRid: string,
        serverId: string,
        status: "queued" | "running",
    ): void {
        if (!this.chatPanel.hasUserMessage(targetRid)) {
            this.pending.set(targetRid, { status, serverId });
            return;
        }
        const onCancel =
            status === "queued" ? this.cancelClickHandler(serverId) : undefined;
        this.chatPanel.setUserBubbleQueueStatus(targetRid, status, onCancel);
        this.pending.delete(targetRid);
    }

    private cancelClickHandler(serverId: string): () => void {
        return () => {
            try {
                const r = this.cancelById(serverId);
                if (r && typeof (r as Promise<void>).catch === "function") {
                    (r as Promise<void>).catch(() => {
                        // Swallow — `×` clicks are fire-and-forget; the
                        // host's cancellation transport already logs
                        // failures (e.g. the bridge's
                        // `cancelByServerId`'s try/catch).
                    });
                }
            } catch {
                // Same rationale as the async catch above.
            }
        };
    }

    /** Clear chip and any pending stash for `targetRid`. */
    clearQueueChip(targetRid: string): void {
        this.pending.delete(targetRid);
        this.chatPanel.setUserBubbleQueueStatus(targetRid, null);
    }

    /**
     * Apply any chip that was deferred for `targetRid` because the
     * bubble didn't exist yet. Called by hosts immediately after they
     * materialize a bubble (e.g. on `setUserRequest`) so the chip
     * appears without waiting for the next `queueStateChanged`. No-op
     * when nothing is stashed.
     */
    flushPending(targetRid: string): void {
        const pending = this.pending.get(targetRid);
        if (!pending) return;
        // applyQueueChip will delete the entry once the bubble exists.
        this.applyQueueChip(targetRid, pending.serverId, pending.status);
    }

    /**
     * Reapply chip state to match an authoritative snapshot. Snapshots
     * are the source of truth; fine-grained queue events are incremental
     * hints between snapshots.
     */
    reconcileQueueChips(
        prev: QueueSnapshot | undefined,
        next: QueueSnapshot | undefined,
    ): void {
        const live = new Set<string>();
        if (next?.running) {
            const targetRid = this.chipTargetRid(next.running);
            this.materializeQueueBubbleIfMissing(next.running, targetRid);
            live.add(targetRid);
            this.applyQueueChip(targetRid, next.running.requestId, "running");
        }
        for (const entry of next?.queued ?? []) {
            const targetRid = this.chipTargetRid(entry);
            this.materializeQueueBubbleIfMissing(entry, targetRid);
            live.add(targetRid);
            this.applyQueueChip(targetRid, entry.requestId, "queued");
        }
        const prevIds = new Set<string>();
        if (prev?.running) prevIds.add(this.chipTargetRid(prev.running));
        for (const e of prev?.queued ?? []) prevIds.add(this.chipTargetRid(e));
        for (const id of prevIds) {
            if (live.has(id)) continue;
            this.clearQueueChip(id);
        }
        for (const id of Array.from(this.pending.keys())) {
            if (!live.has(id)) this.pending.delete(id);
        }
    }

    // ── Event folders ─────────────────────────────────────────────────
    // Each `on*` returns the pre-apply queue entry (when one existed),
    // so hosts can clear chips / paint cancellation affordances under
    // either id form (clientRequestId or server UUID).

    onRequestQueued(
        entry: QueuedRequest,
        version: number,
    ): { admitted: boolean } {
        const result = this.mirror.applyQueued(entry, version);
        if (!result.admitted) return { admitted: false };
        const targetRid = this.chipTargetRid(entry);
        this.materializeQueueBubbleIfMissing(entry, targetRid);
        this.applyQueueChip(targetRid, entry.requestId, "queued");
        return { admitted: true };
    }

    onRequestStarted(
        entry: QueuedRequest,
        version: number,
    ): { admitted: boolean; previousRunning?: QueuedRequest } {
        const result = this.mirror.applyStarted(entry, version);
        if (!result.admitted) {
            return { admitted: false, previousRunning: result.previousRunning };
        }
        if (result.previousRunning) {
            this.clearQueueChip(this.chipTargetRid(result.previousRunning));
        }
        const targetRid = this.chipTargetRid(entry);
        this.materializeQueueBubbleIfMissing(entry, targetRid);
        this.applyQueueChip(targetRid, entry.requestId, "running");
        return { admitted: true, previousRunning: result.previousRunning };
    }

    /**
     * Apply a `requestCancelled` queue event. The controller clears the
     * chip under both id forms it knows (the server UUID and any
     * pre-cancel snapshot entry's bubble key) so a stale form doesn't
     * leave a dangling pill. The "⚠ Cancelled" agent-bubble affordance,
     * if any, is the host's responsibility — the returned `matched`
     * carries the pre-apply queue entry (if any) so the host can map
     * server id ↔ chat-ui bubble key without re-reading the snapshot.
     */
    onRequestCancelled(
        requestId: string,
        version: number,
    ): {
        admitted: boolean;
        matched?: QueuedRequest;
    } {
        const snap = this.mirror.snapshot;
        const matched =
            snap?.running?.requestId === requestId
                ? snap.running
                : snap?.queued.find((e) => e.requestId === requestId);
        const result = this.mirror.applyCancelled(requestId, version);
        // Always clear chips — the user's authoritative intent is "this
        // is cancelled", and a leftover pill would be misleading even
        // if the mirror dropped the event as stale.
        if (matched) {
            this.clearQueueChip(this.chipTargetRid(matched));
        }
        // Belt-and-suspenders: also clear under the server id directly,
        // covering peer-origin races where the snapshot lost the entry
        // before this event was admitted.
        this.clearQueueChip(requestId);
        return { admitted: result.admitted, matched };
    }

    onQueueStateChanged(snapshot: QueueSnapshot): { admitted: boolean } {
        const result = this.mirror.applyQueueStateChanged(snapshot);
        if (!result.admitted) return { admitted: false };
        this.reconcileQueueChips(result.previous, snapshot);
        return { admitted: true };
    }

    /**
     * Reset all mirrored state and clear any chip the controller knew
     * about. Hosts typically call this on session change / clear so a
     * switch doesn't carry chips from the previous conversation.
     *
     * Clears chips on BOTH (a) bubbles still in the `pending` stash
     * (chip never made it onto a bubble) and (b) bubbles named in the
     * outgoing snapshot (chip is painted on a still-living DOM node).
     * The complementary `chatPanel.clear()` is the caller's job; this
     * method assumes the caller may keep the DOM intact (e.g. they're
     * about to repaint via `replayDisplayHistory`).
     *
     * When `snapshot` is provided, the mirror is bootstrapped from it
     * — use this on `conversationChanged(..., queueSnapshot)` so the
     * mirror's version watermark starts from the new conversation's
     * baseline instead of inheriting the old one (which would silently
     * reject the new conversation's early lifecycle events).
     */
    reset(snapshot?: QueueSnapshot): void {
        const outgoing = this.mirror.snapshot;
        if (outgoing?.running) {
            this.chatPanel.setUserBubbleQueueStatus(
                this.chipTargetRid(outgoing.running),
                null,
            );
        }
        for (const entry of outgoing?.queued ?? []) {
            this.chatPanel.setUserBubbleQueueStatus(
                this.chipTargetRid(entry),
                null,
            );
        }
        for (const id of Array.from(this.pending.keys())) {
            this.chatPanel.setUserBubbleQueueStatus(id, null);
        }
        this.pending.clear();
        this.mirror.reset(snapshot);
        // Bootstrap chips for the new snapshot so peer entries that
        // arrived before the renderer attached are visible immediately.
        if (snapshot) this.reconcileQueueChips(undefined, snapshot);
    }
}

// ── Double-Escape gesture helper ─────────────────────────────────────────

export interface DoubleEscapeOptions {
    /**
     * Called on a single Escape press when there's an active in-flight
     * request to cancel. Hosts forward `clientRequestId` (preferred —
     * matches the chat-ui stop-button binding) to their cancellation
     * transport.
     */
    onCancelActive: (activeId: string) => void;
    /**
     * Called when two Escape presses arrive within the gesture window.
     * Hosts should cancel every queued + running entry on the current
     * session.
     */
    onCancelAll: () => void;
    /**
     * Resolves the currently-active request id for single-Esc. Defaults
     * to the union of `chatPanel.getActiveRequestId()` (the id chat-ui
     * binds to its send/stop toggle) and the supplied controller's
     * snapshot (covers the brief window between commandComplete and
     * the next requestStarted, plus peer-origin requests we never
     * tracked locally).
     */
    getActiveRequestId?: () => string | undefined;
    /** Gesture window in milliseconds. Defaults to 1000ms. */
    windowMs?: number;
    /**
     * Document to attach the listener to. Defaults to `globalThis.document`
     * so the helper can be imported in non-DOM bundles (tests) without
     * blowing up; callers pass an explicit document to avoid surprises
     * with multi-frame hosts.
     */
    target?: Document;
}

/**
 * Wire the document-level single-Esc + double-Esc gesture. Returns a
 * teardown function that removes the listener.
 *
 * Honors `e.defaultPrevented` so chat-ui's own input-level Escape
 * handler (which cancels the running request and calls preventDefault
 * when focused) stays primary — the gesture only updates the
 * double-Esc clock in that case, so a paired second press still fires
 * `onCancelAll`.
 */
export function attachDoubleEscape(
    chatPanel: { getActiveRequestId(): string | undefined },
    controller: QueueChipController,
    options: DoubleEscapeOptions,
): () => void {
    const windowMs = options.windowMs ?? 1000;
    const target = options.target ?? globalThis.document;
    const getActiveRequestId =
        options.getActiveRequestId ??
        (() =>
            chatPanel.getActiveRequestId() ??
            controller.snapshot?.running?.requestId);
    let lastEscapeTime = 0;
    const handler = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        const now = Date.now();
        const isDouble = now - lastEscapeTime <= windowMs;
        lastEscapeTime = now;
        if (e.defaultPrevented) {
            if (isDouble) {
                lastEscapeTime = 0;
                options.onCancelAll();
            }
            return;
        }
        const activeId = getActiveRequestId();
        if (activeId !== undefined) {
            e.preventDefault();
            options.onCancelActive(activeId);
        }
        if (isDouble) {
            lastEscapeTime = 0;
            e.preventDefault();
            options.onCancelAll();
        }
    };
    target.addEventListener("keydown", handler);
    return () => target.removeEventListener("keydown", handler);
}
