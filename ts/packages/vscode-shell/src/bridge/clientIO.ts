// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type {
    IAgentMessage,
    PendingInteractionRequest,
    QueuedRequest,
    QueueCancelReason,
    QueueSnapshot,
    RequestId,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";
import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";

import type { BridgeToWebviewMessage } from "./messages.js";
import { clientIdOf } from "./requestIds.js";
import { gatherUserContext } from "./userContext.js";

/**
 * Narrow callback surface needed by the bridge ClientIO. Keeping this
 * explicit (rather than passing the whole AgentServerBridge) makes
 * cancellation mapping and shell-action routing visible at the call
 * site.
 */
export interface BridgeClientIOContext {
    /** Forward a webview-bound message via the bridge's broadcast path. */
    broadcast(msg: BridgeToWebviewMessage): void;
    /**
     * Record the client→server requestId mapping populated from
     * setUserRequest. The webview's stop button only knows the client id;
     * cancelCommand on the dispatcher needs the server id. Without this,
     * cancellation silently regresses.
     */
    rememberServerRequestId(clientId: string, serverId: string): void;
    /**
     * Reverse lookup populated alongside `rememberServerRequestId`. The
     * dispatcher's queue-lifecycle ClientIO events carry the canonical
     * server requestId, but chat-ui keys bubbles by clientRequestId — so
     * the bridge resolves server → client here before forwarding to the
     * webview. Returns undefined for peer-originated requests this bridge
     * never saw a setUserRequest for.
     */
    lookupClientRequestId(serverId: string): string | undefined;
    /**
     * Reverse of `lookupClientRequestId`. Used to attach the canonical
     * server UUID as a companion `aliasRequestId` on commandComplete
     * broadcasts so the webview can dedupe cancellation rendering even
     * when other paths (e.g. queueRequestCancelled) arrive keyed by the
     * server UUID instead of the client rid.
     */
    lookupServerRequestId?(clientId: string): string | undefined;
    /**
     * Remove the cross-ref entry for `serverId` (and its client alias)
     * from both maps. Called when a request reaches a terminal state
     * (cancelled / completed-and-no-longer-in-queue) so peer-originated
     * entries — which don't go through this bridge's own sendCommand
     * `finally` cleanup — don't leak forever as the seeding from
     * `requestQueued` / `requestStarted` / `queueStateChanged`
     * accumulates them.
     */
    forgetRequestId?(serverId: string): void;
    /**
     * Remove every cross-ref entry whose server id is NOT in
     * `liveServerIds`. Used after `queueStateChanged` to reclaim
     * entries for requests that quietly completed (no per-request
     * "done" event fires on this ClientIO, so the snapshot diff is
     * the only generic completion signal we have).
     */
    sweepRequestIds?(liveServerIds: Set<string>): void;
    /** Handle a "vscode-shell-action" routed from the code agent. */
    handleShellAction(requestId: RequestId, data: unknown): Promise<void>;
    /**
     * Handle a "manage-conversation" client action emitted by the system
     * agent (for both `@conversation` slash commands and natural-language
     * requests). Payload shape is the same as the Shell/CLI handlers.
     */
    handleManageConversation(
        requestId: RequestId,
        payload: unknown,
    ): Promise<void>;
}

/**
 * Create a ClientIO implementation that forwards calls to the webview.
 */
export function createBridgeClientIO(ctx: BridgeClientIOContext): ClientIO {
    return {
        question: async (
            _requestId: RequestId | undefined,
            message: string,
            choices: string[],
            _defaultId?: number,
            _source?: string,
        ): Promise<number> => {
            // Show VS Code quick pick for questions
            const items = choices.map((c, i) => ({
                label: c,
                index: i,
            }));
            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: message,
            });
            return pick?.index ?? 0;
        },
        proposeAction: async (
            _requestId: RequestId,
            _actionTemplates: TemplateEditConfig,
            _source: string,
        ): Promise<unknown> => {
            return undefined;
        },
        openLocalView: async () => {},
        closeLocalView: async () => {},
        getUserContext: async () => gatherUserContext(),

        // ClientIO call functions (fire-and-forget notifications)
        clear: (requestId: RequestId) => {
            ctx.broadcast({
                type: "clear",
                requestId: clientIdOf(requestId),
            });
        },
        exit: (_requestId: RequestId) => {
            // No-op in extension context
        },
        setUserRequest: (
            requestId: RequestId,
            command: string,
            seq?: number,
        ) => {
            // Record client→server requestId translation so the stop
            // button (which posts the client id) can be turned into
            // the dispatcher's server id for cancelCommand().
            const clientId = clientIdOf(requestId);
            if (
                typeof clientId === "string" &&
                typeof requestId?.requestId === "string"
            ) {
                ctx.rememberServerRequestId(clientId, requestId.requestId);
            }
            ctx.broadcast({
                type: "setUserRequest",
                requestId: clientId,
                command,
                seq,
            });
        },
        setDisplayInfo: (
            requestId: RequestId,
            source: string,
            actionIndex?: number,
            action?: TypeAgentAction | string[],
            seq?: number,
        ) => {
            ctx.broadcast({
                type: "setDisplayInfo",
                requestId: clientIdOf(requestId),
                source,
                actionIndex,
                action,
                seq,
            });
        },
        setDisplay: (message: IAgentMessage, seq?: number) => {
            ctx.broadcast({
                type: "setDisplay",
                message,
                requestId: clientIdOf(message.requestId),
                seq,
            });
        },
        appendDisplay: (
            message: IAgentMessage,
            mode: DisplayAppendMode,
            seq?: number,
        ) => {
            ctx.broadcast({
                type: "appendDisplay",
                message,
                requestId: clientIdOf(message.requestId),
                mode,
                seq,
            });
        },
        appendDiagnosticData: () => {},
        // Live-updating display (agent set ActionResult.dynamicDisplayId).
        // Forward to the webview, which registers a refresh timer via chat-ui's
        // ChatPanel.setDynamicDisplay and polls back for fresh content through
        // the `getDynamicDisplay` bridge RPC. Previously a no-op, so dynamic
        // displays (e.g. the player "now playing" status) never refreshed.
        setDynamicDisplay: (
            _requestId: RequestId,
            source: string,
            _actionIndex: number,
            displayId: string,
            nextRefreshMs: number,
        ) => {
            ctx.broadcast({
                type: "setDynamicDisplay",
                source,
                displayId,
                nextRefreshMs,
            });
        },
        notify: (
            notificationId: string | RequestId | undefined,
            event: string,
            data: any,
            source: string,
            seq?: number,
        ) => {
            // Developer-mode toggle: forward as a dedicated message so the
            // webview can flip dev-only UI affordances (per-message delete).
            if (event === "developerMode") {
                ctx.broadcast({
                    type: "developerMode",
                    enabled: data?.enabled === true,
                });
                return;
            }
            const clientId = clientIdOf(notificationId);
            // For commandComplete, also attach the canonical server UUID
            // (when known) so the webview's cancellation dedupe can mark
            // both id forms at once — avoids a double "⚠ Cancelled" when
            // queueRequestCancelled fires keyed by serverId and this
            // notify path fires keyed by clientId.
            let aliasRequestId: string | undefined;
            if (event === "commandComplete") {
                if (
                    typeof notificationId === "object" &&
                    notificationId !== null &&
                    typeof (notificationId as { requestId?: unknown })
                        .requestId === "string"
                ) {
                    const serverId = (notificationId as { requestId: string })
                        .requestId;
                    if (serverId !== clientId) aliasRequestId = serverId;
                } else if (clientId) {
                    aliasRequestId = ctx.lookupServerRequestId?.(clientId);
                }
            }
            ctx.broadcast({
                type: "notify",
                event,
                data,
                source,
                seq,
                requestId: clientId,
                aliasRequestId,
            });
        },
        // Non-blocking choice card (yes/no buttons, multi-select, or a
        // single-select pick + "remember" checkbox). The dispatcher already
        // rendered the prompt text as the action's displayContent
        // (appendDisplay above); we forward the choice so the webview can add
        // the interactive buttons to that same agent bubble and reply with a
        // `choiceResponse`. Previously a no-op, which is why yes/no cards
        // (e.g. github-cli install) never showed their buttons here.
        requestChoice: (
            requestId: RequestId,
            choiceId: string,
            type: "yesNo" | "multiChoice" | "pickRemember",
            message: string,
            choices: string[],
            source: string,
            checkboxLabel?: string,
        ) => {
            ctx.broadcast({
                type: "requestChoice",
                choiceId,
                choiceType: type,
                message,
                choices,
                source,
                checkboxLabel,
                requestId: clientIdOf(requestId),
            });
        },
        // Forward server-driven interactive prompts (dev-mode action
        // confirmation via `@config dev on --confirm`, or agent questions) to
        // the webview, which renders them and replies with an
        // `interactionResponse` (handled in agentServerBridge ->
        // dispatcher.respondToInteraction). Without this the request blocks on
        // the server until the 10-min proposeAction timeout.
        requestInteraction: (interaction: PendingInteractionRequest) => {
            ctx.broadcast({ type: "requestInteraction", interaction });
        },
        // Another connected client answered, or the server cancelled/timed
        // out the interaction — tell the webview to tear down its prompt.
        interactionResolved: (interactionId: string) => {
            ctx.broadcast({ type: "interactionResolved", interactionId });
        },
        interactionCancelled: (interactionId: string) => {
            ctx.broadcast({ type: "interactionCancelled", interactionId });
        },
        takeAction: (requestId, action, data) => {
            if (action === "vscode-shell-action") {
                ctx.handleShellAction(requestId, data).catch((e: any) => {
                    vscode.window.showErrorMessage(
                        `Shell action failed: ${e?.message ?? String(e)}`,
                    );
                });
            } else if (action === "manage-conversation") {
                ctx.handleManageConversation(requestId, data).catch(
                    (e: any) => {
                        vscode.window.showErrorMessage(
                            `Conversation action failed: ${e?.message ?? String(e)}`,
                        );
                    },
                );
            } else if (action === "open-folder") {
                // The dispatcher's @open command resolves a folder path and
                // asks the client to reveal it. Open the folder in the OS file
                // manager via the platform's default handler.
                const folder = typeof data === "string" ? data : "";
                if (folder) {
                    Promise.resolve(
                        vscode.env.openExternal(vscode.Uri.file(folder)),
                    ).then(undefined, (e: any) => {
                        vscode.window.showErrorMessage(
                            `Unable to open folder '${folder}': ${e?.message ?? String(e)}`,
                        );
                    });
                }
            }
        },
        shutdown: () => {},

        // User feedback (thumbs up/down) recorded by any client is fanned out
        // here so every connected client's bubble stays in sync. Forward to the
        // webview, which applies it via chat-ui's ChatPanel.applyFeedback. The
        // entry is keyed by the client request id the originating client
        // submitted (see recordUserFeedback in agentServerBridge), which
        // matches the webview's bubble threadId.
        onUserFeedback: (entry) => {
            ctx.broadcast({ type: "userFeedback", entry });
        },

        // Queue lifecycle push events. Forwarded straight to the webview
        // so the chat-ui can mirror state and dedupe the cancellation
        // affordance between `commandComplete` (local awaitCommand path)
        // and `requestCancelled` (server broadcast / peer cancel path).
        //
        // QueuedRequest entries carry BOTH the server requestId and the
        // (best-effort) clientRequestId — use them to seed the bridge's
        // cross-ref maps so cancellation that lands before setUserRequest
        // has fired (e.g. a queued-never-started item) can still resolve
        // the client↔server id pairing. Without this seed, queueRequest-
        // Cancelled broadcasts arrive with no clientRequestId alias, the
        // webview's dedupe key mismatches commandComplete's, and the
        // bubble paints "⚠ Cancelled" twice.
        requestQueued: (entry: QueuedRequest, version: number) => {
            const clientRequestId =
                typeof entry.clientRequestId === "string"
                    ? entry.clientRequestId
                    : ctx.lookupClientRequestId(entry.requestId);
            if (clientRequestId) {
                ctx.rememberServerRequestId(clientRequestId, entry.requestId);
            }
            ctx.broadcast({
                type: "queueRequestQueued",
                entry,
                version,
                clientRequestId,
            });
        },
        requestStarted: (entry: QueuedRequest, version: number) => {
            const clientRequestId =
                typeof entry.clientRequestId === "string"
                    ? entry.clientRequestId
                    : ctx.lookupClientRequestId(entry.requestId);
            if (clientRequestId) {
                ctx.rememberServerRequestId(clientRequestId, entry.requestId);
            }
            ctx.broadcast({
                type: "queueRequestStarted",
                entry,
                version,
                clientRequestId,
            });
        },
        requestCancelled: (
            requestId: string,
            reason: QueueCancelReason,
            version: number,
        ) => {
            const clientRequestId = ctx.lookupClientRequestId(requestId);
            ctx.broadcast({
                type: "queueRequestCancelled",
                requestId,
                reason,
                version,
                clientRequestId,
            });
            // Reclaim the cross-ref entry — the request is terminal. For
            // peer-originated requests this is the only cleanup path
            // (their sendCommand ran in a different bridge process).
            ctx.forgetRequestId?.(requestId);
        },
        queueStateChanged: (snapshot: QueueSnapshot) => {
            const live = new Set<string>();
            if (snapshot.running) live.add(snapshot.running.requestId);
            for (const entry of snapshot.queued) live.add(entry.requestId);
            // Seed the cross-ref from every entry the snapshot carries so
            // a cancellation arriving for any of them resolves to its
            // client rid (and the webview dedupes correctly). Same
            // rationale as requestQueued / requestStarted.
            const seedEntry = (entry: QueuedRequest | null) => {
                if (!entry) return;
                const cid =
                    typeof entry.clientRequestId === "string"
                        ? entry.clientRequestId
                        : undefined;
                if (cid) ctx.rememberServerRequestId(cid, entry.requestId);
            };
            seedEntry(snapshot.running);
            for (const entry of snapshot.queued) seedEntry(entry);
            // Sweep entries for requests that quietly completed (no per-
            // request "done" event fires on this ClientIO surface). The
            // queue snapshot is authoritative; anything not in it is
            // either terminal or never existed on this dispatcher.
            ctx.sweepRequestIds?.(live);
            ctx.broadcast({
                type: "queueStateChanged",
                snapshot,
            });
        },
    };
}
