// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from "node:events";

export interface KnowledgeExtractionProgressEvent {
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
    timestamp: number;
    url: string | undefined;
    source: "navigation" | "manual" | "background" | "api";
}

export type ProgressCallback = (
    progress: KnowledgeExtractionProgressEvent,
) => void | Promise<void>;

export class KnowledgeProgressEventEmitter extends EventEmitter {
    private activeExtractions = new Set<string>();
    private extractionHistory: KnowledgeExtractionProgressEvent[] = [];
    private maxHistorySize = 100;

    emitProgress(progress: KnowledgeExtractionProgressEvent): void {
        this.activeExtractions.add(progress.extractionId);

        // Store in history (limited)
        this.extractionHistory.push(progress);
        if (this.extractionHistory.length > this.maxHistorySize) {
            this.extractionHistory.shift();
        }

        // Emit events with multiple targeting strategies
        this.emit("knowledgeExtractionProgress", progress);
        this.emit(`progress:${progress.extractionId}`, progress);
        this.emit(`phase:${progress.phase}`, progress);

        // Mark completed extractions
        if (progress.phase === "complete" || progress.phase === "error") {
            this.activeExtractions.delete(progress.extractionId);
        }
    }

    onProgress(
        listener: (progress: KnowledgeExtractionProgressEvent) => void,
    ): void {
        this.on("knowledgeExtractionProgress", listener);
    }

    onProgressById(
        extractionId: string,
        listener: (progress: KnowledgeExtractionProgressEvent) => void,
    ): void {
        this.on(`progress:${extractionId}`, listener);
    }

    onPhase(
        phase: KnowledgeExtractionProgressEvent["phase"],
        listener: (progress: KnowledgeExtractionProgressEvent) => void,
    ): void {
        this.on(`phase:${phase}`, listener);
    }

    removeProgressListener(extractionId: string): void {
        this.removeAllListeners(`progress:${extractionId}`);
    }

    getActiveExtractions(): string[] {
        return Array.from(this.activeExtractions);
    }

    getExtractionHistory(filter?: {
        extractionId?: string;
        phase?: string;
        limit?: number;
    }): KnowledgeExtractionProgressEvent[] {
        let results = [...this.extractionHistory];

        if (filter) {
            if (filter.extractionId) {
                results = results.filter(
                    (event) => event.extractionId === filter.extractionId,
                );
            }
            if (filter.phase) {
                results = results.filter(
                    (event) => event.phase === filter.phase,
                );
            }
            if (filter.limit) {
                results = results.slice(-filter.limit);
            }
        }

        return results;
    }

    clearHistory(): void {
        this.extractionHistory = [];
    }
}

export const knowledgeProgressEvents = new KnowledgeProgressEventEmitter();
