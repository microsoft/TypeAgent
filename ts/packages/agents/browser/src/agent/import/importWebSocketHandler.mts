// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    importProgressEvents,
    ImportProgressEvent,
} from "./importProgressEvents.mjs";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../browserActions.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:import:progress");

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
            const agentServer = this.context.agentContext.agentWebSocketServer;
            if (agentServer) {
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

                const sent = agentServer.sendEventToActiveClient(
                    this.context.agentContext.sessionId,
                    "importProgress",
                    {
                        importId: progress.importId,
                        progress: websocketProgress,
                    },
                );
                debug(
                    "%s phase=%s progress=%d/%d sent=%s",
                    progress.importId,
                    progress.phase,
                    progress.current,
                    progress.total,
                    sent,
                );
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
