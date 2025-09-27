// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import registerDebug from "debug";
import { BrowserActionContext } from "../../browserActions.mjs";
import {
    generateDynamicKnowledgeHtml,
    ActiveKnowledgeExtraction,
} from "../ui/knowledgeCardRenderer.mjs";

const debug = registerDebug("typeagent:browser:action");

export const extractionTimestamps = new Map<string, number>();

// Track currently running extractions to prevent duplicates
export interface RunningExtraction {
    extractionId: string;
    url: string;
    normalizedUrl: string;
    startTime: number;
    promise: Promise<any>;
}

export class RunningExtractionsCache {
    private runningExtractions = new Map<string, RunningExtraction>();

    isRunning(url: string): boolean {
        const normalizedUrl = normalizeUrlForIndex(url);
        return this.runningExtractions.has(normalizedUrl);
    }

    getRunning(url: string): RunningExtraction | undefined {
        const normalizedUrl = normalizeUrlForIndex(url);
        return this.runningExtractions.get(normalizedUrl);
    }

    async startExtraction(
        url: string,
        extractionId: string,
        extractionPromise: Promise<any>,
    ): Promise<any> {
        const normalizedUrl = normalizeUrlForIndex(url);

        // If already running, wait for the existing one
        if (this.runningExtractions.has(normalizedUrl)) {
            const existing = this.runningExtractions.get(normalizedUrl)!;
            debug(
                `Extraction already running for ${url}, waiting for existing extraction ${existing.extractionId}`,
            );
            return existing.promise;
        }

        // Start new extraction
        const runningExtraction: RunningExtraction = {
            extractionId,
            url,
            normalizedUrl,
            startTime: Date.now(),
            promise: extractionPromise,
        };

        this.runningExtractions.set(normalizedUrl, runningExtraction);

        // Clean up when done
        extractionPromise.finally(() => {
            this.runningExtractions.delete(normalizedUrl);
        });

        return extractionPromise;
    }

    cleanup(): void {
        // Remove extractions that have been running too long (> 10 minutes)
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [key, extraction] of this.runningExtractions.entries()) {
            if (extraction.startTime < cutoff) {
                debug(
                    `Cleaning up stale extraction ${extraction.extractionId} for ${extraction.url}`,
                );
                this.runningExtractions.delete(key);
            }
        }
    }
}

export function updateExtractionTimestamp(url: string): void {
    const normalized = normalizeUrlForIndex(url);
    extractionTimestamps.set(normalized, Date.now());
}

export function shouldReExtract(
    url: string,
    maxAge: number = 24 * 60 * 60 * 1000,
): boolean {
    const normalized = normalizeUrlForIndex(url);
    const lastExtraction = extractionTimestamps.get(normalized);
    if (!lastExtraction) return true;

    return Date.now() - lastExtraction > maxAge;
}

export function normalizeUrlForIndex(url: string): string {
    try {
        const parsed = new URL(url);
        // Keep protocol, host, pathname, and query params
        // Remove fragments as they don't affect content
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
}

export async function waitForExtractionCompletion(
    extractionId: string,
    timeoutMs: number = 120000, // 2 minute default timeout
    context?: ActionContext<BrowserActionContext>,
    activeKnowledgeExtractions?: Map<string, ActiveKnowledgeExtraction>,
): Promise<{ success: boolean; knowledge?: any; error?: string }> {
    if (!activeKnowledgeExtractions) {
        return {
            success: false,
            error: "Active knowledge extractions map not provided",
        };
    }

    return new Promise((resolve) => {
        const startTime = Date.now();

        const checkCompletion = () => {
            const activeExtraction =
                activeKnowledgeExtractions.get(extractionId);

            if (!activeExtraction) {
                // Extraction not found or was cleaned up - assume completed
                resolve({
                    success: false,
                    error: "Extraction not found or was cleaned up",
                });
                return;
            }

            const { progressState, aggregatedKnowledge } = activeExtraction;

            if (context && progressState) {
                const progressHtml = generateDynamicKnowledgeHtml(
                    progressState,
                    aggregatedKnowledge || {
                        entities: [],
                        topics: [],
                        relationships: [],
                    },
                );

                context.actionIO.setDisplay({
                    type: "html",
                    content: progressHtml,
                });
            }

            if (progressState && progressState.phase === "complete") {
                resolve({
                    success: true,
                    knowledge: activeExtraction.aggregatedKnowledge,
                });
                return;
            }

            if (progressState && progressState.phase === "error") {
                const errorMessage =
                    progressState.errors && progressState.errors.length > 0
                        ? progressState.errors.join(", ")
                        : "Unknown extraction error";
                resolve({ success: false, error: errorMessage });
                return;
            }

            // Check for timeout
            if (Date.now() - startTime > timeoutMs) {
                resolve({
                    success: false,
                    error: `Extraction timed out after ${timeoutMs}ms`,
                });
                return;
            }

            setTimeout(checkCompletion, 500); // Check every 500ms
        };

        checkCompletion();
    });
}

export const runningExtractionsCache = new RunningExtractionsCache();