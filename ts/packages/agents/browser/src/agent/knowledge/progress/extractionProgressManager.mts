// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebSocket } from "ws";
import { BrowserClient } from "../../agentWebSocketServer.mjs";
import { SessionContext } from "@typeagent/agent-sdk";
import {
    getActiveKnowledgeExtraction,
    deleteActiveKnowledgeExtraction,
} from "../actions/extractionActions.mjs";
import {
    updateExtractionProgressState,
    ActiveKnowledgeExtraction,
} from "../ui/knowledgeCardRenderer.mjs";
import { BrowserActionContext } from "../../browserActions.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:knowledge");

interface KnowledgeExtractionProgress {
    extractionId: string;
    phase:
        | "content"
        | "basic"
        | "summary"
        | "analyzing"
        | "extracting"
        | "complete"
        | "error";
    totalItems: number;
    processedItems: number;
    currentItem: string | undefined;
    errors: Array<{ message: string; timestamp: number }>;
    incrementalData: any | undefined;
}

export function sendKnowledgeExtractionProgressViaWebSocket(
    client: BrowserClient | undefined,
    extractionId: string,
    progress: KnowledgeExtractionProgress,
) {
    try {
        if (client && client.socket.readyState === WebSocket.OPEN) {
            // Send progress update message via WebSocket
            const progressMessage = {
                method: "knowledgeExtractionProgress",
                params: {
                    extractionId: extractionId,
                    progress: progress,
                },
                source: "browserAgent",
            };

            client.socket.send(JSON.stringify(progressMessage));
            debug(
                `Knowledge Extraction Progress [${extractionId}] sent to client ${client.id}:`,
                progress,
            );
        } else {
            debug(
                `Knowledge Extraction Progress [${extractionId}] (WebSocket not available):`,
                progress,
            );
        }
    } catch (error) {
        console.error(
            `Failed to send knowledge extraction progress [${extractionId}]:`,
            error,
        );
    }
}

export async function handleKnowledgeExtractionProgress(
    params: { extractionId: string; progress: any },
    context: SessionContext<BrowserActionContext>,
) {
    const { extractionId, progress } = params;

    debug(`Knowledge Extraction 2 Progress [${extractionId}]:`, progress);

    // Get active extraction tracking (it should already exist)
    let activeExtraction: ActiveKnowledgeExtraction | undefined =
        getActiveKnowledgeExtraction(extractionId);
    if (!activeExtraction) {
        console.warn(
            `No active extraction found for ${extractionId}, progress will be logged but not displayed`,
        );
        return;
    }

    // Replace aggregated knowledge with the latest results
    // Messages now contain fully aggregated results, not incremental updates
    if (progress.incrementalData) {
        const data = progress.incrementalData;

        // Replace entities entirely with latest aggregated results
        if (data.entities && Array.isArray(data.entities)) {
            activeExtraction.aggregatedKnowledge.entities = data.entities;
        }

        // Replace topics entirely with latest aggregated results
        if (data.keyTopics && Array.isArray(data.keyTopics)) {
            activeExtraction.aggregatedKnowledge.topics = data.keyTopics;
        }

        // Replace relationships entirely with latest aggregated results
        if (data.relationships && Array.isArray(data.relationships)) {
            activeExtraction.aggregatedKnowledge.relationships =
                data.relationships;
        }
    }

    // Update progress state using helper function
    updateExtractionProgressState(activeExtraction, progress);

    // Note: Visual updates are now handled automatically by the dynamic display system
    // The getDynamicDisplay method will be called periodically to generate the HTML

    // Clean up completed extractions after a delay
    if (progress.phase === "complete" || progress.phase === "error") {
        setTimeout(() => {
            deleteActiveKnowledgeExtraction(extractionId);
        }, 30000); // Clean up after 30 seconds
    }

    activeExtraction.lastUpdateTime = Date.now();
}
