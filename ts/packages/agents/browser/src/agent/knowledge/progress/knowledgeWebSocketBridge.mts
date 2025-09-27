// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    knowledgeProgressEvents,
    KnowledgeExtractionProgressEvent,
} from "./knowledgeProgressEvents.mjs";
import { sendKnowledgeExtractionProgressViaWebSocket } from "./extractionProgressManager.mjs";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";

export class KnowledgeWebSocketBridge {
    private context: SessionContext<BrowserActionContext>;

    constructor(context: SessionContext<BrowserActionContext>) {
        this.context = context;
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Subscribe to all progress events and forward via WebSocket
        knowledgeProgressEvents.onProgress(
            (progress: KnowledgeExtractionProgressEvent) => {
                this.forwardProgressToWebSocket(progress);
            },
        );
    }

    private forwardProgressToWebSocket(
        progress: KnowledgeExtractionProgressEvent,
    ) {
        // Convert event format back to original WebSocket format
        const websocketProgress = {
            extractionId: progress.extractionId,
            phase: progress.phase,
            totalItems: progress.totalItems,
            processedItems: progress.processedItems,
            currentItem: progress.currentItem,
            errors: progress.errors,
            incrementalData: progress.incrementalData,
        };

        sendKnowledgeExtractionProgressViaWebSocket(
            this.context.agentContext.currentClient,
            progress.extractionId,
            websocketProgress,
        );
    }

    enableForExtraction(extractionId: string) {
        knowledgeProgressEvents.onProgressById(extractionId, (progress) => {
            this.forwardProgressToWebSocket(progress);
        });
    }

    enableForPhases(phases: string[]) {
        phases.forEach((phase) => {
            knowledgeProgressEvents.onPhase(phase as any, (progress) => {
                this.forwardProgressToWebSocket(progress);
            });
        });
    }
}

let webSocketBridge: KnowledgeWebSocketBridge | null = null;

export function initializeWebSocketBridge(
    context: SessionContext<BrowserActionContext>,
) {
    webSocketBridge = new KnowledgeWebSocketBridge(context);
    return webSocketBridge;
}

export function getWebSocketBridge(): KnowledgeWebSocketBridge | null {
    return webSocketBridge;
}
