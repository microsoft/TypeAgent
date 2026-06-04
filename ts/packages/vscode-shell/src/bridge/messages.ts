// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    IAgentMessage,
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
          // means an attempt is in progress. `cleared` means we're back
          // online and any reconnect UI should disappear.
          type: "reconnectStatus";
          phase: "waiting" | "connecting" | "cleared";
          attempt?: number;
          secondsRemaining?: number;
          error?: string;
      }
    | { type: "switching"; switching: boolean; targetName?: string }
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
      };

/**
 * Messages from webview → extension host
 */
export type BridgeFromWebviewMessage =
    | { type: "sendCommand"; command: string; requestId?: string }
    | { type: "cancelCommand"; requestId: string }
    // Double-Esc gesture: cancel every queued + running entry on the session.
    | { type: "cancelAllQueuedAndRunning" }
    | { type: "openExternal"; href: string }
    | { type: "connect" }
    | { type: "disconnect" }
    | { type: "getStatus" }
    | { type: "focus"; focused: boolean }
    | { type: "pcUpdate"; input: string; direction: CompletionDirection }
    | { type: "pcAccept" }
    | { type: "pcDismiss"; input: string; direction: CompletionDirection }
    | { type: "pcHide" }
    | { type: "pcDispose" }
    | { type: "demoCommand"; action: "continue" | "cancel" }
    | { type: "demoLineCancelled"; requestId: string };
