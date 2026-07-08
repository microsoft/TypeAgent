// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    IAgentMessage,
    PendingInteractionRequest,
    PendingInteractionResponse,
    QueuedRequest,
    QueueCancelReason,
    QueueSnapshot,
} from "@typeagent/dispatcher-types";
import type {
    CompletionDirection,
    DisplayAppendMode,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import type { CompletionState } from "agent-dispatcher/helpers/completion";
import type { ConnectionActionId } from "chat-ui";

/**
 * Messages from extension host → webview
 */
export type BridgeToWebviewMessage =
    | {
          type: "status";
          connected: boolean;
          sessionId?: string;
          sessionName?: string;
      }
    | { type: "sessionChanged"; sessionId: string; sessionName: string }
    | {
          type: "setDisplay";
          message: IAgentMessage;
          requestId?: string;
          seq?: number;
          timestamp?: number;
      }
    | {
          type: "appendDisplay";
          message: IAgentMessage;
          requestId?: string;
          mode: DisplayAppendMode;
          seq?: number;
          timestamp?: number;
      }
    | {
          type: "setDisplayInfo";
          requestId?: string;
          source: string;
          actionIndex?: number;
          action?: TypeAgentAction | string[];
          seq?: number;
      }
    | {
          type: "setUserRequest";
          requestId?: string;
          command: string;
          seq?: number;
          timestamp?: number;
      }
    | { type: "clear"; requestId?: string }
    | {
          type: "notify";
          event: string;
          data: any;
          source: string;
          seq?: number;
          requestId?: string;
          // See `commandComplete.aliasRequestId` — only populated when
          // `event === "commandComplete"` and a cross-ref is known.
          aliasRequestId?: string;
      }
    | { type: "commandResult"; requestId: string; result: any }
    | {
          type: "commandComplete";
          requestId: string;
          result: any;
          // Companion id form so the webview's cancellation dedupe set can
          // mark BOTH the client rid (what this `requestId` carries) and
          // the canonical server UUID. Without this, when queueRequestCancelled
          // arrives keyed by server UUID and commandComplete by client rid,
          // they each pass the per-id claim check and the bubble paints
          // "⚠ Cancelled" twice.
          aliasRequestId?: string;
      }
    | { type: "peerMetrics"; requestId: string; result: any }
    | { type: "pcState"; state?: CompletionState }
    | { type: "error"; message: string; requestId?: string }
    | {
          // Single in-place reconnect status shown in the connection
          // ribbon. `phase: "waiting"` means a backoff timer is running
          // and `secondsRemaining` is the live countdown. `connecting`
          // means an attempt is in progress. `stopped` means auto-reconnect
          // gave up and `actions` lists the manual-recovery links to offer.
          // `cleared` means we're back online and any reconnect UI should
          // disappear.
          type: "reconnectStatus";
          phase: "waiting" | "connecting" | "stopped" | "cleared";
          attempt?: number;
          secondsRemaining?: number;
          error?: string;
          actions?: ConnectionActionId[];
      }
    | {
          type: "switching";
          switching: boolean;
          targetName?: string;
          statusLabel?: "Creating" | "Connecting";
      }
    | { type: "activateNewSessionInput" }
    | { type: "userInfo"; name: string }
    | { type: "setActive"; active: boolean }
    // Per-conversation queue lifecycle. The bridge forwards the dispatcher's
    // ClientIO push events so the webview can mirror queue state and dedupe
    // cancellation rendering across the {commandComplete, requestCancelled}
    // paths. `entry.requestId` is the canonical server UUID; we additionally
    // surface `clientRequestId` (when known via setUserRequest reverse map)
    // so chat-ui — which keys bubbles by clientRequestId — can find them.
    | {
          type: "queueRequestQueued";
          entry: QueuedRequest;
          version: number;
          clientRequestId?: string;
      }
    | {
          type: "queueRequestStarted";
          entry: QueuedRequest;
          version: number;
          clientRequestId?: string;
      }
    | {
          type: "queueRequestCancelled";
          requestId: string;
          reason: QueueCancelReason;
          version: number;
          clientRequestId?: string;
      }
    | { type: "queueStateChanged"; snapshot: QueueSnapshot }
    | {
          type: "demoState";
          running: boolean;
          paused: boolean;
          message?: string;
      }
    | { type: "demoTypeAndSend"; command: string; requestId: string }
    | { type: "demoCancelTyping" }
    | { type: "historyLoading"; loading: boolean }
    | {
          // Conversation-management feedback (list / info / switch / new /
          // rename / delete / next / prev). Rendered as a fresh agent bubble
          // in whatever conversation is currently displayed — used because
          // the user request's own bubble belongs to the OLD conversation
          // for switching ops and is wiped by `chatPanel.clear()` on
          // sessionChanged before any post-switch result could land.
          type: "conversationNotification";
          // Already-escaped HTML body to display inline in the chat.
          content: string;
          kind?: "info" | "warning" | "error" | "success";
      }
    | {
          type: "historyReplay";
          entries: Array<{
              type: string;
              seq: number;
              timestamp?: number;
              // user-request
              command?: string;
              // set-display / append-display
              message?: IAgentMessage;
              mode?: DisplayAppendMode;
              // set-display-info
              source?: string;
              action?: TypeAgentAction | string[];
              actionIndex?: number;
              requestId?: string;
              // command-result
              metrics?: any;
              tokenUsage?: any;
              actionTokenUsage?: any;
          }>;
      }
    | {
          type: "sessionList";
          sessions: Array<{
              sessionId: string;
              name: string;
              clientCount: number;
              createdAt?: string; // ISO 8601
              source?: "copilot"; // origin: absent = native TypeAgent
          }>;
          currentSessionId?: string;
      }
    | { type: "developerMode"; enabled: boolean }
    | {
          // Server-driven interactive prompt: dev-mode action confirmation
          // (`@config dev on --confirm`) or an agent question. The webview
          // renders it (proposeActionEdit / choice prompt) and replies with
          // an `interactionResponse` message.
          type: "requestInteraction";
          interaction: PendingInteractionRequest;
      }
    // Another client answered / the server cancelled the interaction; the
    // webview should tear down its in-progress prompt (identified by id).
    | { type: "interactionResolved"; interactionId: string }
    | { type: "interactionCancelled"; interactionId: string }
    | {
          // Response to a webview-issued `bridgeRpcRequest` (template editor
          // schema / completion lookups routed through the host to the
          // dispatcher). Correlated by `id`.
          type: "bridgeRpcResponse";
          id: number;
          result?: unknown;
          error?: string;
      }
    | { type: "sessionError"; message: string };

/**
 * Messages from webview → extension host
 */
export type BridgeFromWebviewMessage =
    | { type: "sendCommand"; command: string; requestId?: string }
    | { type: "cancelCommand"; requestId: string }
    // Developer-mode per-message delete. `permanent` chooses hard delete
    // (non-recoverable) vs soft delete (recoverable "move to trash").
    | {
          type: "deleteMessage";
          requestId: string;
          target: "user" | "agent";
          permanent: boolean;
      }
    // Promote a queued request so it runs next ("jump the queue").
    | { type: "promoteCommand"; requestId: string }
    // Double-Esc gesture: cancel every queued + running entry on the session.
    | { type: "cancelAllQueuedAndRunning" }
    | { type: "openExternal"; href: string }
    | { type: "connect" }
    | { type: "disconnect" }
    | { type: "getStatus" }
    // Manual connection recovery from the "stopped" reconnect ribbon.
    | { type: "retryConnection" }
    | { type: "startServer" }
    | { type: "requestSessions" }
    | { type: "createSession"; name: string }
    | { type: "switchSession"; sessionId: string }
    | { type: "renameCurrentSession"; name: string }
    | { type: "deleteCurrentSession" }
    | { type: "renameSession"; sessionId: string; name: string }
    | { type: "deleteSession"; sessionId: string }
    | { type: "focus"; focused: boolean }
    | { type: "pcUpdate"; input: string; direction: CompletionDirection }
    | { type: "pcAccept" }
    | { type: "pcDismiss"; input: string; direction: CompletionDirection }
    | { type: "pcHide" }
    | { type: "pcDispose" }
    | { type: "demoCommand"; action: "continue" | "cancel" }
    | { type: "demoLineCancelled"; requestId: string }
    // Reply to a `requestInteraction` prompt. Forwarded to the dispatcher
    // via respondToInteraction.
    | { type: "interactionResponse"; response: PendingInteractionResponse }
    | {
          // Template-editor service call (getTemplateSchema /
          // getTemplateCompletion) routed through the host to the dispatcher.
          // Correlated by `id`; answered with a `bridgeRpcResponse`.
          type: "bridgeRpcRequest";
          id: number;
          method: "getTemplateSchema" | "getTemplateCompletion";
          args: unknown[];
      };
