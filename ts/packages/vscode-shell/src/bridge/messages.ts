// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { IAgentMessage } from "@typeagent/dispatcher-types";
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
      }
    | { type: "commandResult"; requestId: string; result: any }
    | { type: "commandComplete"; requestId: string; result: any }
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
          }>;
      };

/**
 * Messages from webview → extension host
 */
export type BridgeFromWebviewMessage =
    | { type: "sendCommand"; command: string; requestId?: string }
    | { type: "cancelCommand"; requestId: string }
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
