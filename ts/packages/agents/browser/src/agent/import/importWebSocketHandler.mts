// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    importProgressEvents,
    ImportProgressEvent,
} from "./importProgressEvents.mjs";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../browserActions.mjs";
import { WebSocket } from "ws";

export class ImportWebSocketHandler {
    private context: SessionContext<BrowserActionContext>;

    constructor(context: SessionContext<BrowserActionContext>) {
        this.context = context;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        importProgressEvents.onProgress((progress: ImportProgressEvent) => {
            this.forwardProgressToWebSocket(progress);
        });
    }

    private forwardProgressToWebSocket(progress: ImportProgressEvent) {
        try {
            // Get client from agentWebSocketServer instead of currentClient
            const agentServer = this.context.agentContext.agentWebSocketServer;
            const client = agentServer?.getActiveClient();

            if (client && client.socket.readyState === WebSocket.OPEN) {
                const websocketProgress = {
                    type: "importProgress",
                    totalItems: progress.total,
                    processedItems: progress.current,
                    currentItem: progress.description,
                    phase: progress.phase,
                    timestamp: progress.timestamp,
                    importId: progress.importId,
                    errors: progress.errors || [],
                    ...(progress.summary && {
                        summary: {
                            totalProcessed: progress.summary.totalProcessed,
                            successfullyImported:
                                progress.summary.successfullyImported,
                            entitiesFound: progress.summary.entitiesFound,
                            topicsIdentified: progress.summary.topicsIdentified,
                            actionsDetected: progress.summary.actionsDetected,
                        },
                    }),
                    ...(progress.itemDetails && {
                        itemDetails: progress.itemDetails,
                    }),
                };

                const progressMessage = {
                    method: "importProgress",
                    params: {
                        importId: progress.importId,
                        progress: websocketProgress,
                    },
                    source: "browserAgent",
                };

                client.socket.send(JSON.stringify(progressMessage));
            }
        } catch (error) {
            console.error(
                "Failed to forward import progress to WebSocket:",
                error,
            );
        }
    }
}

let importWebSocketHandler: ImportWebSocketHandler | null = null;

export function initializeImportWebSocketHandler(
    context: SessionContext<BrowserActionContext>,
) {
    importWebSocketHandler = new ImportWebSocketHandler(context);
    return importWebSocketHandler;
}
