// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as vscode from "vscode";
import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type {
    IAgentMessage,
    PendingInteractionRequest,
    RequestId,
    TemplateEditConfig,
} from "@typeagent/dispatcher-types";
import type { DisplayAppendMode, TypeAgentAction } from "@typeagent/agent-sdk";

import type { BridgeToWebviewMessage } from "./messages.js";
import { clientIdOf } from "./requestIds.js";

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
    /** Handle a "vscode-shell-action" routed from the code agent. */
    handleShellAction(requestId: RequestId, data: unknown): Promise<void>;
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
        setDynamicDisplay: () => {},
        notify: (
            notificationId: string | RequestId | undefined,
            event: string,
            data: any,
            source: string,
            seq?: number,
        ) => {
            ctx.broadcast({
                type: "notify",
                event,
                data,
                source,
                seq,
                requestId: clientIdOf(notificationId),
            });
        },
        requestChoice: () => {},
        requestInteraction: (_interaction: PendingInteractionRequest) => {},
        interactionResolved: () => {},
        interactionCancelled: () => {},
        takeAction: (requestId, action, data) => {
            if (action === "vscode-shell-action") {
                ctx.handleShellAction(requestId, data).catch((e: any) => {
                    vscode.window.showErrorMessage(
                        `Shell action failed: ${e?.message ?? String(e)}`,
                    );
                });
            }
        },
        shutdown: () => {},
    };
}
