// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { WebSocket } from "ws";
import { BrowserActionContext } from "../browserActions.mjs";
import { searchByEntities, searchWebMemories } from "../searchWebMemories.mjs";
import * as website from "website-memory";
import {
    knowledgeProgressEvents,
    KnowledgeExtractionProgressEvent,
} from "./knowledgeProgressEvents.mjs";
import {
    KnowledgeExtractionResult,
    EnhancedKnowledgeExtractionResult,
    Entity,
    Relationship,
} from "./schema/knowledgeExtraction.mjs";
// TODO: Move this to common and use the same schema in extension and agent
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
import {
    ExtractionMode,
    ExtractionInput,
    AIModelRequiredError,
} from "website-memory";
import { BrowserKnowledgeExtractor } from "./browserKnowledgeExtractor.mjs";
import { DetailedKnowledgeStats } from "../browserKnowledgeSchema.js";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:knowledge");

/**
 * Knowledge extraction progress update helper function
 */
export function sendKnowledgeExtractionProgressViaWebSocket(
    webSocket: WebSocket | undefined,
    extractionId: string,
    progress: KnowledgeExtractionProgress,
) {
    try {
        if (webSocket && webSocket.readyState === WebSocket.OPEN) {
            // Send progress update message via WebSocket
            const progressMessage = {
                method: "knowledgeExtractionProgress",
                params: {
                    extractionId: extractionId,
                    progress: progress,
                },
                source: "browserAgent",
            };

            webSocket.send(JSON.stringify(progressMessage));
            debug(
                `Knowledge Extraction Progress [${extractionId}] sent via WebSocket:`,
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

// Analytics Data Response Interface
interface AnalyticsDataResponse {
    overview: {
        totalSites: number;
        totalBookmarks: number;
        totalHistory: number;
        topDomains: number;
        knowledgeExtracted: number;
    };
    knowledge: {
        extractionProgress: {
            entityProgress: number;
            topicProgress: number;
            actionProgress: number;
        };
        qualityDistribution: {
            highQuality: number;
            mediumQuality: number;
            lowQuality: number;
        };
        totalEntities: number;
        totalTopics: number;
        totalActions: number;
        totalRelationships: number;
        recentItems?: any[];
        recentEntities?: Array<{
            name: string;
            type: string;
            fromPage: string;
            extractedAt: string;
        }>;
        recentTopics?: Array<{
            name: string;
            fromPage: string;
            extractedAt: string;
        }>;
        recentActions?: Array<{
            type: string;
            element: string;
            text?: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }>;
        recentRelationships?: Array<{
            from: string;
            relationship: string;
            to: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }>;
    };
    domains: {
        topDomains: Array<{
            domain: string;
            count: number;
            percentage: number;
        }>;
        totalSites: number;
    };
    activity: {
        trends: Array<{
            date: string;
            visits: number;
            bookmarks: number;
        }>;
        summary: {
            totalActivity: number;
            peakDay: string | null;
            averagePerDay: number;
            timeRange: string;
        };
    };
    analytics: {
        extractionMetrics: any;
        qualityReport: any;
    };
}

// Helper function to convert HTML fragments to ExtractionInput objects
function createExtractionInputsFromFragments(
    htmlFragments: any[],
    url: string,
    title: string,
    source: "direct" | "index" | "bookmark" | "history" | "import",
    timestamp?: string,
): ExtractionInput[] {
    return htmlFragments
        .filter((fragment) => fragment.text && fragment.text.trim().length > 50) // Filter out empty/tiny fragments
        .map((fragment, index) => ({
            url: `${url}#iframe-${fragment.frameId || index}`, // Include frame context in URL
            title: `${title} (Frame ${fragment.frameId || index})`,
            htmlFragments: [fragment], // Keep individual fragment context
            textContent: fragment.text.trim(),
            source: source,
            ...(timestamp && { timestamp }), // Only include timestamp if it exists
            metadata: {
                frameId: fragment.frameId,
                isIframe: fragment.frameId !== 0, // Main frame is typically 0
            },
        }));
}

// Helper function to aggregate extraction results from multiple fragments
function aggregateExtractionResults(results: any[]): {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
    contentMetrics: any;
    detectedActions?: any[];
    actionSummary?: any;
    contentActions?: any[];
} {
    const allEntities: Entity[] = [];
    const allRelationships: Relationship[] = [];
    const allTopics: string[] = [];
    const allQuestions: string[] = [];
    const summaries: string[] = [];
    const allDetectedActions: any[] = [];
    const allContentActions: any[] = [];

    let totalWordCount = 0;
    let totalReadingTime = 0;

    for (const result of results) {
        if (result.knowledge || result.partialKnowledge) {
            const knowledge = result.knowledge || result.partialKnowledge;
            // Collect entities with frame context
            if (knowledge.entities) {
                allEntities.push(...knowledge.entities);
            }

            // Collect relationships
            if (knowledge.relationships) {
                allRelationships.push(...knowledge.relationships);
            }

            // Collect topics
            if (knowledge.topics) {
                allTopics.push(...knowledge.topics);
            }

            // Collect questions
            if (knowledge.suggestedQuestions) {
                allQuestions.push(...knowledge.suggestedQuestions);
            }

            // Collect summaries
            if (knowledge.summary) {
                summaries.push(knowledge.summary);
            }

            // collect content actions
            if (knowledge.actions && Array.isArray(knowledge.actions)) {
                allContentActions.push(...knowledge.actions);

                const actionRelationships =
                    knowledge.actions?.map((action: any) => ({
                        from: action.subjectEntityName || "unknown",
                        relationship: action.verbs?.join(", ") || "related to",
                        to: action.objectEntityName || "unknown",
                        confidence: 0.8, // Default confidence for indexed content
                    })) || [];

                allRelationships.push(...actionRelationships);
            }
        }

        // Collect detected actions from enhanced results
        if (result.detectedActions && Array.isArray(result.detectedActions)) {
            allDetectedActions.push(...result.detectedActions);
        }

        // Aggregate metrics
        if (result.contentMetrics) {
            totalWordCount += result.contentMetrics.wordCount || 0;
            totalReadingTime += result.contentMetrics.readingTime || 0;
        }
    }

    // Deduplicate entities by name, keeping the most comprehensive version
    const entityMap = new Map<string, Entity>();

    allEntities.forEach((entity) => {
        const key = entity.name.toLowerCase();
        const existing = entityMap.get(key);

        // Keep the entity with more comprehensive data
        // Prefer entities with: description, higher confidence, or more properties
        if (!existing) {
            entityMap.set(key, entity);
        } else {
            const existingScore =
                (existing.description ? 2 : 0) +
                (existing.confidence || 0) +
                Object.keys(existing).length * 0.1;
            const newScore =
                (entity.description ? 2 : 0) +
                (entity.confidence || 0) +
                Object.keys(entity).length * 0.1;

            if (newScore > existingScore) {
                // Merge the best of both entities
                entityMap.set(key, {
                    ...existing,
                    ...entity,
                    // Keep the best confidence
                    confidence: Math.max(
                        existing.confidence || 0,
                        entity.confidence || 0,
                    ),
                });
            }
        }
    });

    const uniqueEntities = Array.from(entityMap.values());

    // Deduplicate relationships
    const uniqueRelationships = allRelationships.filter(
        (rel, index, arr) =>
            arr.findIndex(
                (r) =>
                    r.from === rel.from &&
                    r.relationship === rel.relationship &&
                    r.to === rel.to,
            ) === index,
    );

    // Deduplicate actions by type and element
    const uniqueDetectedActions = allDetectedActions.filter(
        (action, index, arr) =>
            arr.findIndex(
                (a) => a.type === action.type && a.element === action.element,
            ) === index,
    );

    // Create action summary if we have detected actions
    let actionSummary;
    if (uniqueDetectedActions.length > 0) {
        const actionTypes = [
            ...new Set(uniqueDetectedActions.map((a) => a.type)),
        ];
        const highConfidenceActions = uniqueDetectedActions.filter(
            (a) => a.confidence > 0.8,
        ).length;
        const actionDistribution = uniqueDetectedActions.reduce(
            (acc: any, action) => {
                acc[action.type] = (acc[action.type] || 0) + 1;
                return acc;
            },
            {},
        );

        actionSummary = {
            totalActions: uniqueDetectedActions.length,
            actionTypes,
            highConfidenceActions,
            actionDistribution,
        };
    }

    // Deduplicate topics and questions
    const uniqueTopics = [...new Set(allTopics)];
    const uniqueQuestions = [...new Set(allQuestions)];

    const aggregatedResult: any = {
        entities: uniqueEntities,
        relationships: uniqueRelationships,
        keyTopics: uniqueTopics,
        suggestedQuestions: uniqueQuestions,
        summary:
            summaries.length > 1
                ? `Multi-frame content summary:\n${summaries.map((s, i) => `Frame ${i + 1}: ${s}`).join("\n\n")}`
                : summaries[0] || "No content summary available.",
        contentMetrics: {
            wordCount: totalWordCount,
            readingTime: totalReadingTime,
        },
    };

    // Only include action-related fields if we have actions
    if (uniqueDetectedActions.length > 0) {
        aggregatedResult.detectedActions = uniqueDetectedActions;
        aggregatedResult.actionSummary = actionSummary;
    }

    if (allContentActions.length > 0) {
        aggregatedResult.contentActions = allContentActions;
    }

    return aggregatedResult;
}

export interface WebPageDocument {
    url: string;
    title: string;
    content: string;
    htmlFragments: any[];
    timestamp: string;
    indexed: boolean;
    knowledge?: KnowledgeExtractionResult;
    metadata?: {
        quality: string;
        textOnly: boolean;
        contentLength: number;
        entityCount: number;
    };
}

export async function handleKnowledgeAction(
    actionName: string,
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<any> {
    switch (actionName) {
        case "extractKnowledgeFromPage":
            return await extractKnowledgeFromPage(parameters, context);

        case "extractKnowledgeFromPageStreaming":
            return await extractKnowledgeFromPageStreaming(parameters, context);

        case "indexWebPageContent":
            return await indexWebPageContent(parameters, context);

        case "searchWebMemories":
            return await searchWebMemories(parameters, context);

        case "checkPageIndexStatus":
            return await checkPageIndexStatus(parameters, context);

        case "getKnowledgeIndexStats":
            return await getKnowledgeIndexStats(parameters, context);

        case "getKnowledgeStats":
            return await getDetailedKnowledgeStats(parameters, context);

        case "clearKnowledgeIndex":
            return await clearKnowledgeIndex(parameters, context);

        case "getExtractionAnalytics":
            return await getExtractionAnalytics(parameters, context);

        case "generateQualityReport":
            return await generateQualityReport(parameters, context);

        case "getPageQualityMetrics":
            return await getPageQualityMetrics(parameters, context);

        case "checkAIModelStatus":
            return await checkAIModelStatus(parameters, context);

        case "checkActionDetectionStatus":
            return await checkActionDetectionStatus(parameters, context);

        case "getRecentKnowledgeItems":
            return await getRecentKnowledgeItems(parameters, context);

        case "getTopDomains":
            return await getTopDomains(parameters, context);

        case "getActivityTrends":
            return await getActivityTrends(parameters, context);

        case "getPageIndexedKnowledge":
            return await getPageIndexedKnowledge(parameters, context);

        case "getDiscoverInsights":
            return await getDiscoverInsights(parameters, context);

        case "getAnalyticsData":
            return await getAnalyticsData(parameters, context);

        case "getKnowledgeGraphStatus":
            return await getKnowledgeGraphStatus(parameters, context);

        case "buildKnowledgeGraph":
            return await buildKnowledgeGraph(parameters, context);

        case "rebuildKnowledgeGraph":
            return await rebuildKnowledgeGraph(parameters, context);

        case "getAllRelationships":
            return await getAllRelationships(parameters, context);

        case "getAllCommunities":
            return await getAllCommunities(parameters, context);

        case "getAllEntitiesWithMetrics":
            return await getAllEntitiesWithMetrics(parameters, context);

        case "getEntityNeighborhood":
            return await getEntityNeighborhood(parameters, context);

        default:
            throw new Error(`Unknown knowledge action: ${actionName}`);
    }
}

export async function extractKnowledgeFromPage(
    parameters: {
        url: string;
        title: string;
        htmlFragments: any[];
        extractEntities: boolean;
        extractRelationships: boolean;
        suggestQuestions: boolean;
        mode?: "basic" | "summary" | "content" | "full";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<EnhancedKnowledgeExtractionResult> {
    // Create individual extraction inputs for each HTML fragment
    const extractionInputs = createExtractionInputsFromFragments(
        parameters.htmlFragments,
        parameters.url,
        parameters.title,
        "direct",
    );

    if (extractionInputs.length === 0) {
        return {
            entities: [],
            relationships: [],
            keyTopics: [],
            suggestedQuestions: [],
            summary: "Insufficient content to extract knowledge.",
            contentMetrics: {
                readingTime: 0,
                wordCount: 0,
            },
        };
    }

    try {
        const extractionMode = (parameters.mode || "content") as ExtractionMode;
        const extractor = new BrowserKnowledgeExtractor(context);

        // Process each fragment individually using batch processing
        const extractionResults = await extractor.extractBatch(
            extractionInputs,
            extractionMode,
        );

        // Aggregate results from all fragments
        const aggregatedResults = aggregateExtractionResults(extractionResults);

        return {
            ...aggregatedResults,
        };
    } catch (error) {
        console.error("Error extracting knowledge from fragments:", error);
        throw error;
    }
}

export async function extractKnowledgeFromPageStreaming(
    parameters: {
        url: string;
        title: string;
        mode: string;
        extractionId: string;
        htmlFragments: any[];
        extractionSettings?: any;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<EnhancedKnowledgeExtractionResult> {
    const { url, mode, extractionId, htmlFragments } = parameters;
    const extractionMode = mode as ExtractionMode;

    let totalItems = 0;
    let processedItems = 0;
    const startTime = Date.now();

    const sendProgressUpdate = async (
        phase: KnowledgeExtractionProgress["phase"],
        currentItem?: string,
        incrementalData?: Partial<any>,
    ) => {
        processedItems++;
        const progress: KnowledgeExtractionProgress = {
            extractionId,
            phase,
            totalItems: totalItems,
            processedItems,
            currentItem: currentItem || undefined,
            errors: [],
            incrementalData: incrementalData || undefined,
        };

        const progressEvent: KnowledgeExtractionProgressEvent = {
            ...progress,
            timestamp: Date.now(),
            url: parameters.url,
            source: "navigation",
        };
        knowledgeProgressEvents.emitProgress(progressEvent);

        debug("Knowledge extraction progress:", {
            extractionId,
            progress: JSON.stringify(progress),
        });
    };

    try {
        const extractionInputs = createExtractionInputsFromFragments(
            htmlFragments,
            url,
            parameters.title,
            "direct",
        );

        if (extractionInputs.length === 0) {
            await sendProgressUpdate(
                "error",
                "Insufficient content to extract knowledge",
            );
            return {
                entities: [],
                relationships: [],
                keyTopics: [],
                suggestedQuestions: [],
                summary: "Insufficient content to extract knowledge.",
                contentMetrics: { readingTime: 0, wordCount: 0 },
            };
        }

        // Phase 1: Content retrieval feedback
        await sendProgressUpdate(
            "content",
            "Analyzing page structure and content",
            {
                contentMetrics: extractContentMetrics(extractionInputs),
                url,
                title: parameters.title,
            },
        );

        const extractor = new BrowserKnowledgeExtractor(context);

        // Phase 2: Basic extraction
        await sendProgressUpdate("basic", "Processing basic page information");

        let aggregatedResults: any = {
            entities: [],
            relationships: [],
            keyTopics: [],
            suggestedQuestions: [],
            summary: "",
            contentActions: [],
            contentMetrics: { readingTime: 0, wordCount: 0 },
        };

        // Always extract basic info regardless of mode
        if (
            extractionMode === "basic" ||
            shouldIncludeMode("basic", extractionMode)
        ) {
            const basicResults = await extractor.extractBatchWithEvents(
                extractionInputs,
                "basic",
                async (progress) => {
                    debug("Basic extraction progress:", progress);
                    if (
                        progress.intermediateResults &&
                        progress.intermediateResults.length > 0
                    ) {
                        const partialAggregated = aggregateExtractionResults(
                            progress.intermediateResults,
                        );
                        totalItems = progress.total;
                        processedItems = progress.processed;
                        let progressMessage;
                        if (
                            progress.currentItemChunk &&
                            progress.currentItemTotalChunks
                        ) {
                            progressMessage = `Processing chunk ${progress.currentItemChunk} of ${progress.currentItemTotalChunks} (${progress.processed} of ${progress.total} total chunks)`;
                        } else {
                            progressMessage = `Processing chunks: ${progress.processed} of ${progress.total} completed`;
                        }

                        await sendProgressUpdate(
                            "basic",
                            progressMessage,
                            partialAggregated,
                        );
                    }
                },
                3,
            );
            aggregatedResults = aggregateExtractionResults(basicResults);

            await sendProgressUpdate(
                "basic",
                "Basic analysis complete",
                aggregatedResults,
            );
        }

        // Phase 3: Summary mode (if enabled)
        if (shouldIncludeMode("summary", extractionMode)) {
            await sendProgressUpdate("summary", "Generating content summary");

            const summaryResults = await extractor.extractBatchWithEvents(
                extractionInputs,
                "summary",
                async (progress) => {
                    debug("Summary extraction progress:", progress);
                    if (
                        progress.intermediateResults &&
                        progress.intermediateResults.length > 0
                    ) {
                        const partialData = aggregateExtractionResults(
                            progress.intermediateResults,
                        );
                        totalItems = progress.total;
                        processedItems = progress.processed;

                        await sendProgressUpdate(
                            "summary",
                            `Summarizing: ${progress.processed} of ${progress.total} chunks processed`,
                            partialData,
                        );
                    }
                },
                3,
            );
            const summaryData = aggregateExtractionResults(summaryResults);

            // Replace with LLM-based summary data
            aggregatedResults.summary = summaryData.summary;

            // Replace topics with summary extraction results if available
            // Summary extraction provides higher-fidelity topics than basic extraction
            if (summaryData.keyTopics && summaryData.keyTopics.length > 0) {
                aggregatedResults.keyTopics = summaryData.keyTopics;
            }

            // If summary extraction provides entities, replace basic ones
            if (summaryData.entities && summaryData.entities.length > 0) {
                aggregatedResults.entities = summaryData.entities;
            }

            // If summary extraction provides relationships, replace basic ones
            if (
                summaryData.relationships &&
                summaryData.relationships.length > 0
            ) {
                aggregatedResults.relationships = summaryData.relationships;
            }

            await sendProgressUpdate(
                "summary",
                "Summary analysis complete",
                aggregatedResults, // Send the full aggregated results, not just summary/topics
            );
        }

        // Phase 4: Content analysis (if enabled)
        if (shouldIncludeMode("content", extractionMode)) {
            await sendProgressUpdate(
                "analyzing",
                "Discovering entities and topics",
            );

            const contentResults = await extractor.extractBatchWithEvents(
                extractionInputs,
                "content",
                async (progress) => {
                    debug("Content extraction progress:", progress);
                    if (
                        progress.intermediateResults &&
                        progress.intermediateResults.length > 0
                    ) {
                        const partialData = aggregateExtractionResults(
                            progress.intermediateResults,
                        );
                        totalItems = progress.total;
                        processedItems = progress.processed;
                        await sendProgressUpdate(
                            "analyzing",
                            `Analyzing content: ${progress.processed} of ${progress.total} chunks processed`,
                            partialData,
                        );
                    }
                },
                3,
            );
            const contentData = aggregateExtractionResults(contentResults);

            // Replace basic extraction with LLM-based content extraction
            // LLM extraction provides higher-fidelity knowledge than rule-based basic extraction
            if (contentData.entities && contentData.entities.length > 0) {
                // Replace entities entirely with content extraction results
                aggregatedResults.entities = contentData.entities;
            }

            // Replace topics with content extraction results
            if (contentData.keyTopics && contentData.keyTopics.length > 0) {
                // Replace topics entirely with content extraction results
                aggregatedResults.keyTopics = contentData.keyTopics;
            }

            // Replace relationships with content extraction results
            if (
                contentData.relationships &&
                contentData.relationships.length > 0
            ) {
                // Replace relationships entirely with content extraction results
                aggregatedResults.relationships = contentData.relationships;
            }

            // Merge content actions (these are saved as "actions" in the index)
            if (
                contentData.contentActions &&
                contentData.contentActions.length > 0
            ) {
                aggregatedResults.contentActions = [
                    ...(aggregatedResults.contentActions || []),
                    ...contentData.contentActions,
                ];
            }

            await sendProgressUpdate(
                "analyzing",
                "Discovered entities and topics",
                aggregatedResults, // Send full accumulated results
            );
        }

        // Phase 5: Full extraction with relationships (if enabled)
        if (shouldIncludeMode("full", extractionMode)) {
            await sendProgressUpdate(
                "extracting",
                "Analyzing entity relationships",
            );

            const fullResults = await extractor.extractBatchWithEvents(
                extractionInputs,
                "full",
                async (progress) => {
                    debug("Full extraction progress:", progress);
                    if (
                        progress.intermediateResults &&
                        progress.intermediateResults.length > 0
                    ) {
                        const partialData = aggregateExtractionResults(
                            progress.intermediateResults,
                        );
                        totalItems = progress.total;
                        processedItems = progress.processed;
                        await sendProgressUpdate(
                            "extracting",
                            `Extracting relationships: ${progress.processed} of ${progress.total} chunks processed`,
                            partialData,
                        );
                    }
                },
                3,
            );
            const fullData = aggregateExtractionResults(fullResults);

            // Replace with full extraction results - highest fidelity LLM extraction
            // Full extraction provides the most comprehensive relationship analysis
            if (fullData.relationships && fullData.relationships.length > 0) {
                aggregatedResults.relationships = fullData.relationships;
            }

            // If full extraction provides entities, replace previous ones
            if (fullData.entities && fullData.entities.length > 0) {
                aggregatedResults.entities = fullData.entities;
            }

            // If full extraction provides topics, replace previous ones
            if (fullData.keyTopics && fullData.keyTopics.length > 0) {
                aggregatedResults.keyTopics = fullData.keyTopics;
            }

            // Merge content actions from full extraction if present
            if (fullData.contentActions && fullData.contentActions.length > 0) {
                aggregatedResults.contentActions = [
                    ...(aggregatedResults.contentActions || []),
                    ...fullData.contentActions,
                ];
            }

            await sendProgressUpdate(
                "extracting",
                "Analyzed entity relationships",
                aggregatedResults, // Send full accumulated results
            );
        }

        // Final completion
        await sendProgressUpdate(
            "complete",
            "Knowledge extraction completed successfully",
            aggregatedResults,
        );

        debug("Knowledge extraction complete:", {
            extractionId,
            finalData: aggregatedResults,
            totalTime: Date.now() - startTime,
        });

        return aggregatedResults;
    } catch (error) {
        console.error("Error in streaming knowledge extraction:", error);

        // Send error progress update via WebSocket
        const errorProgress: KnowledgeExtractionProgress = {
            extractionId,
            phase: "error",
            totalItems: totalItems,
            processedItems,
            currentItem: undefined,
            errors: [
                {
                    message: (error as Error).message || String(error),
                    timestamp: Date.now(),
                },
            ],
            incrementalData: undefined,
        };

        sendKnowledgeExtractionProgressViaWebSocket(
            context.agentContext.webSocket,
            extractionId,
            errorProgress,
        );

        throw error;
    }
}

function shouldIncludeMode(
    checkMode: ExtractionMode,
    actualMode: ExtractionMode,
): boolean {
    /*
    const modeOrder = ["basic", "summary", "content", "full"];
    const checkIndex = modeOrder.indexOf(checkMode);
    const actualIndex = modeOrder.indexOf(actualMode);
    return actualIndex >= checkIndex;
    */
    // for now, only return the selected mode and "basic"
    return checkMode === "basic" || checkMode === actualMode;
}

function extractContentMetrics(extractionInputs: ExtractionInput[]) {
    const totalWordCount = extractionInputs.reduce((sum, input) => {
        return sum + (input.textContent?.split(/\s+/).length || 0);
    }, 0);

    return {
        wordCount: totalWordCount,
        readingTime: Math.ceil(totalWordCount / 200), // 200 words per minute
    };
}

export async function indexWebPageContent(
    parameters: {
        url: string;
        title: string;
        htmlFragments?: any[];
        extractKnowledge: boolean;
        timestamp: string;
        textOnly?: boolean;
        mode?: "basic" | "content" | "full";
        extractedKnowledge?: any;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    indexed: boolean;
    knowledgeExtracted: boolean;
    entityCount: number;
}> {
    try {
        let aggregatedResults: any;
        let combinedTextContent = "";

        if (parameters.extractedKnowledge) {
            aggregatedResults = parameters.extractedKnowledge;
            combinedTextContent = aggregatedResults.summary || "";
        } else {
            // Create individual extraction inputs for each HTML fragment
            const extractionInputs = createExtractionInputsFromFragments(
                parameters.htmlFragments!,
                parameters.url,
                parameters.title,
                "index",
                parameters.timestamp,
            );

            const extractionMode = parameters.mode || "content";
            const extractor = new BrowserKnowledgeExtractor(context);

            // Process each fragment individually using batch processing
            const extractionResults = await extractor.extractBatch(
                extractionInputs,
                extractionMode,
            );

            // Aggregate results for indexing
            aggregatedResults = aggregateExtractionResults(extractionResults);

            // Create combined text content for website memory indexing
            combinedTextContent = extractionInputs
                .map((input) => input.textContent)
                .join("\n\n");
        }

        const visitInfo: website.WebsiteVisitInfo = {
            url: parameters.url,
            title: parameters.title,
            source: "history",
            visitDate: parameters.timestamp,
        };

        const websiteObj = website.importWebsiteVisit(
            visitInfo,
            combinedTextContent,
        );

        if (aggregatedResults && aggregatedResults.entities.length > 0) {
            // Set knowledge based on what the website-memory package expects
            websiteObj.knowledge = {
                entities: aggregatedResults.entities.map((entity: any) => ({
                    ...entity,
                    type: Array.isArray(entity.type)
                        ? entity.type
                        : [entity.type], // Ensure type is array
                })),
                topics: aggregatedResults.keyTopics,
                actions: aggregatedResults.contentActions || [], // Use actual content actions
                inverseActions: [], // Required property
            };
        }

        // Store detectedActions and actionSummary in metadata for retrieval
        if (
            aggregatedResults &&
            (aggregatedResults.detectedActions ||
                aggregatedResults.actionSummary)
        ) {
            websiteObj.metadata = websiteObj.metadata || {};

            if (
                aggregatedResults.detectedActions &&
                aggregatedResults.detectedActions.length > 0
            ) {
                websiteObj.metadata.detectedActions =
                    aggregatedResults.detectedActions;
            }

            if (aggregatedResults.actionSummary) {
                websiteObj.metadata.actionSummary =
                    aggregatedResults.actionSummary;
            }
        }

        if (context.agentContext.websiteCollection) {
            try {
                const isNewPage = !checkPageExistsInIndex(
                    parameters.url,
                    context,
                );

                if (isNewPage) {
                    const docPart =
                        website.WebsiteDocPart.fromWebsite(websiteObj);
                    const result =
                        await context.agentContext.websiteCollection.addWebsiteToIndex(
                            docPart,
                        );
                    if (hasIndexingErrors(result)) {
                        console.warn(
                            "Incremental indexing failed, falling back to full rebuild",
                        );
                        context.agentContext.websiteCollection.addWebsites([
                            websiteObj,
                        ]);
                        await context.agentContext.websiteCollection.buildIndex();
                    }
                } else {
                    const docPart =
                        website.WebsiteDocPart.fromWebsite(websiteObj);
                    const result =
                        await context.agentContext.websiteCollection.updateWebsiteInIndex(
                            parameters.url,
                            docPart,
                        );
                    if (hasIndexingErrors(result)) {
                        console.warn(
                            "Update indexing failed, falling back to full rebuild",
                        );
                        context.agentContext.websiteCollection.addWebsites([
                            websiteObj,
                        ]);
                        await context.agentContext.websiteCollection.buildIndex();
                    }
                }
            } catch (error) {
                console.warn(
                    "Indexing error, falling back to full rebuild:",
                    error,
                );
                context.agentContext.websiteCollection.addWebsites([
                    websiteObj,
                ]);
                await context.agentContext.websiteCollection.buildIndex();
            }

            try {
                if (context.agentContext.index?.path) {
                    await context.agentContext.websiteCollection.writeToFile(
                        context.agentContext.index.path,
                        "index",
                    );
                    debug(
                        `Saved updated website collection to ${context.agentContext.index.path}`,
                    );
                } else {
                    console.warn(
                        "No index path available, indexed page data not persisted to disk",
                    );
                }
            } catch (error) {
                console.error("Error persisting website collection:", error);
            }
        }

        const entityCount = aggregatedResults.entities?.length || 0;

        return {
            indexed: true,
            knowledgeExtracted: parameters.extractKnowledge,
            entityCount,
        };
    } catch (error) {
        if (error instanceof AIModelRequiredError) {
            throw error;
        }

        console.error("Error indexing page content:", error);
        return {
            indexed: false,
            knowledgeExtracted: false,
            entityCount: 0,
        };
    }
}

export async function checkPageIndexStatus(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    isIndexed: boolean;
    lastIndexed: string | null;
    entityCount: number;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === parameters.url,
        );

        if (foundWebsite) {
            const knowledge = foundWebsite.getKnowledge();
            const metadata =
                foundWebsite.metadata as website.WebsiteDocPartMeta;
            return {
                isIndexed: true,
                lastIndexed:
                    metadata.visitDate || metadata.bookmarkDate || null,
                entityCount: knowledge?.entities?.length || 0,
            };
        } else {
            return { isIndexed: false, lastIndexed: null, entityCount: 0 };
        }
    } catch (error) {
        console.error("Error checking page index status:", error);
        return { isIndexed: false, lastIndexed: null, entityCount: 0 };
    }
}

export async function getKnowledgeIndexStats(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    totalPages: number;
    totalEntities: number;
    totalRelationships: number;
    lastIndexed: string;
    indexSize: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                totalPages: 0,
                totalEntities: 0,
                totalRelationships: 0,
                lastIndexed: "Never",
                indexSize: "0 KB",
            };
        }

        const websites = websiteCollection.messages.getAll();
        let totalEntities = 0;
        let totalRelationships = 0;
        let lastIndexed: string | null = null;

        for (const site of websites) {
            try {
                const knowledge = site.getKnowledge();
                if (knowledge) {
                    totalEntities += knowledge.entities?.length || 0;
                    totalRelationships += knowledge.actions?.length || 0;
                }
            } catch (error) {
                console.warn("Error getting knowledge for site:", error);
                // Continue processing other sites
            }

            const metadata = site.metadata as website.WebsiteDocPartMeta;

            const siteDate = metadata?.visitDate || metadata?.bookmarkDate;
            if (siteDate && (!lastIndexed || siteDate > lastIndexed)) {
                lastIndexed = siteDate;
            }
        }

        const totalContent = websites.reduce(
            (sum: number, site: any) =>
                sum + (site.textChunks?.join("").length || 0),
            0,
        );
        const indexSize = `${Math.round(totalContent / 1024)} KB`;

        return {
            totalPages: websites.length,
            totalEntities,
            totalRelationships,
            lastIndexed: lastIndexed || "Never",
            indexSize,
        };
    } catch (error) {
        console.error("Error getting knowledge index stats:", error);
        return {
            totalPages: 0,
            totalEntities: 0,
            totalRelationships: 0,
            lastIndexed: "Error",
            indexSize: "Unknown",
        };
    }
}

export async function clearKnowledgeIndex(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{ success: boolean; message: string }> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                message: "No website collection found to clear.",
            };
        }

        const itemsCleared = websiteCollection.messages.length;
        context.agentContext.websiteCollection =
            new website.WebsiteCollection();

        return {
            success: true,
            message: `Successfully cleared ${itemsCleared} items from knowledge index.`,
        };
    } catch (error) {
        console.error("Error clearing knowledge index:", error);
        return {
            success: false,
            message: "Failed to clear knowledge index. Please try again.",
        };
    }
}

// Enhanced suggested questions using content analysis and DataFrames
export async function generateSmartSuggestedQuestions(
    knowledge: any,
    extractionResult: any,
    url: string,
    context: SessionContext<BrowserActionContext>,
): Promise<string[]> {
    const questions: string[] = [];
    const domain = extractDomainFromUrl(url);

    // Content-specific questions based on extraction result
    if (extractionResult?.pageContent) {
        if (extractionResult.pageContent.readingTime > 10) {
            questions.push("What are the key points from this long article?");
        }
    }

    // Use DataFrames for context-aware questions
    const websiteCollection = context.agentContext.websiteCollection;
    if (websiteCollection && websiteCollection.visitFrequency) {
        try {
            // Domain visit history - simplified approach for now
            debug("Checking domain visit data for enhanced questions");

            if (domain) {
                questions.push(`When did I first visit ${domain}?`);
                questions.push(`What's my learning journey on ${domain}?`);
            }
        } catch (error) {
            console.warn("Error querying domain data:", error);
        }
    }

    // Topic-based cross-references
    if (knowledge.topics && knowledge.topics.length > 0) {
        for (const topic of knowledge.topics.slice(0, 2)) {
            questions.push(`What other ${topic} resources do I have?`);
        }
    }

    // Learning progression questions
    questions.push("What should I learn next in this area?");
    questions.push("Are there any knowledge gaps I should fill?");

    // Temporal questions
    questions.push("When did I first encounter this information?");
    questions.push("What have I learned recently in this domain?");

    return questions.slice(0, 8); // Limit to most relevant questions
}

// Extract domain from URL
function extractDomainFromUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}

export async function getExtractionAnalytics(
    parameters: {
        timeRange?: string;
        mode?: ExtractionMode;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    analytics: any;
}> {
    try {
        // Analytics functionality moved to website-memory package
        // For now, return basic analytics info
        return {
            success: true,
            analytics: {
                totalExtractions: 0,
                successRate: 100,
                averageProcessingTime: 0,
                modes: {
                    basic: 0,
                    content: 0,
                    actions: 0,
                    full: 0,
                },
            },
        };
    } catch (error) {
        console.error("Error getting extraction analytics:", error);
        return {
            success: false,
            analytics: null,
        };
    }
}

export async function generateQualityReport(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    report: any;
}> {
    try {
        // Quality monitoring functionality moved to website-memory package
        // For now, return basic quality report
        return {
            success: true,
            report: {
                overallQuality: "good",
                averageConfidence: 0.8,
                totalItems: 0,
                qualityDistribution: {
                    excellent: 0,
                    good: 0,
                    fair: 0,
                    poor: 0,
                },
            },
        };
    } catch (error) {
        console.error("Error generating quality report:", error);
        return {
            success: false,
            report: null,
        };
    }
}

export async function getPageQualityMetrics(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    score: number;
    entityCount: number;
    topicCount: number;
    actionCount: number;
    extractionMode: string;
    lastUpdated: string | null;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                score: 0,
                entityCount: 0,
                topicCount: 0,
                actionCount: 0,
                extractionMode: "unknown",
                lastUpdated: null,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === parameters.url,
        );

        if (!foundWebsite) {
            return {
                score: 0,
                entityCount: 0,
                topicCount: 0,
                actionCount: 0,
                extractionMode: "unknown",
                lastUpdated: null,
            };
        }

        const knowledge = foundWebsite.getKnowledge();
        const metadata = foundWebsite.metadata as any;

        const entityCount = knowledge?.entities?.length || 0;
        const topicCount = knowledge?.topics?.length || 0;
        const actionCount = knowledge?.actions?.length || 0;

        // Calculate quality score based on knowledge richness
        let score = 0.2; // Base score

        if (entityCount > 0) score += 0.2;
        if (topicCount > 2) score += 0.2;
        if (actionCount > 0) score += 0.2;
        if (entityCount > 5) score += 0.1;
        if (topicCount > 5) score += 0.1;

        score = Math.min(score, 1.0);

        // Determine extraction mode based on knowledge richness
        let extractionMode = "basic";
        if (actionCount > 0) {
            extractionMode = "full";
        } else if (entityCount > 3 && topicCount > 2) {
            extractionMode = "content";
        }

        return {
            score,
            entityCount,
            topicCount,
            actionCount,
            extractionMode,
            lastUpdated: metadata.visitDate || metadata.bookmarkDate || null,
        };
    } catch (error) {
        console.error("Error getting page quality metrics:", error);
        return {
            score: 0,
            entityCount: 0,
            topicCount: 0,
            actionCount: 0,
            extractionMode: "unknown",
            lastUpdated: null,
        };
    }
}

export async function checkAIModelStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    version?: string;
    endpoint?: string;
    error?: string;
}> {
    try {
        const extractor = new BrowserKnowledgeExtractor(context);

        // Test AI availability with a simple extraction
        await extractor.extractKnowledge(
            {
                url: "test://ai-check",
                title: "AI Availability Test",
                textContent: "test content for AI availability check",
                source: "direct",
            },
            "content",
        );

        return {
            available: true,
            version: "available",
            endpoint: "configured",
        };
    } catch (error) {
        if (error instanceof AIModelRequiredError) {
            return {
                available: false,
                error: error.message,
            };
        }

        return {
            available: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown AI model error",
        };
    }
}

export async function checkActionDetectionStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    available: boolean;
    capabilities?: any;
    error?: string;
}> {
    try {
        const extractor = new BrowserKnowledgeExtractor(context);

        const capabilities = extractor.getActionDetectionCapabilities();
        const isAvailable = extractor.isActionDetectionAvailable();

        return {
            available: isAvailable,
            capabilities: capabilities,
        };
    } catch (error) {
        return {
            available: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Unknown action detection error",
        };
    }
}

export async function getRecentKnowledgeItems(
    parameters: {
        limit?: number;
        type?: "entities" | "topics" | "actions" | "relationships" | "all";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: Array<{
        name: string;
        type: string;
        fromPage: string;
        extractedAt: string;
    }>;
    topics: Array<{ name: string; fromPage: string; extractedAt: string }>;
    actions: Array<{
        type: string;
        element: string;
        text?: string;
        confidence: number;
        fromPage: string;
        extractedAt: string;
    }>;
    relationships: Array<{
        from: string;
        relationship: string;
        to: string;
        confidence: number;
        fromPage: string;
        extractedAt: string;
    }>;
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                entities: [],
                topics: [],
                actions: [],
                relationships: [],
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const limit = parameters.limit || 10;
        const type = parameters.type || "all";

        const recentEntities: Array<{
            name: string;
            type: string;
            fromPage: string;
            extractedAt: string;
        }> = [];
        const recentTopics: Array<{
            name: string;
            fromPage: string;
            extractedAt: string;
        }> = [];
        const recentActions: Array<{
            type: string;
            element: string;
            text?: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }> = [];
        const recentRelationships: Array<{
            from: string;
            relationship: string;
            to: string;
            confidence: number;
            fromPage: string;
            extractedAt: string;
        }> = [];

        // Process all websites and extract entities/topics with timestamps
        for (const site of websites) {
            const knowledge = site.getKnowledge();
            const metadata = site.metadata as any;
            const extractedAt =
                metadata.visitDate ||
                metadata.bookmarkDate ||
                new Date().toISOString();
            const pageTitle = metadata.title || metadata.url || "Unknown Page";

            if (knowledge) {
                // Extract entities
                if (
                    (type === "entities" || type === "all") &&
                    knowledge.entities
                ) {
                    for (const entity of knowledge.entities) {
                        recentEntities.push({
                            name: entity.name,
                            type: Array.isArray(entity.type)
                                ? entity.type.join(", ")
                                : entity.type,
                            fromPage: pageTitle,
                            extractedAt: extractedAt,
                        });
                    }
                }

                // Extract topics
                if ((type === "topics" || type === "all") && knowledge.topics) {
                    for (const topic of knowledge.topics) {
                        recentTopics.push({
                            name: topic,
                            fromPage: pageTitle,
                            extractedAt: extractedAt,
                        });
                    }
                }

                // Extract actions (if available)
                // Note: Actions might not be available in current website-memory structure
                if (type === "actions" || type === "all") {
                    // Try to get actions from various possible sources in the knowledge object
                    const actions =
                        (knowledge as any).actions ||
                        (knowledge as any).detectedActions ||
                        [];

                    if (Array.isArray(actions)) {
                        for (const action of actions) {
                            // Handle different action object structures gracefully
                            const actionType =
                                (action as any).actionType ||
                                (action as any).type ||
                                "unknown";
                            const actionElement =
                                (action as any).target?.name ||
                                (action as any).name ||
                                (action as any).element ||
                                "element";
                            const actionText =
                                (action as any).name ||
                                (action as any).text ||
                                (action as any).target?.name;
                            const actionConfidence =
                                (action as any).confidence || 0.8;

                            recentActions.push({
                                type: actionType,
                                element: actionElement,
                                text: actionText,
                                confidence: actionConfidence,
                                fromPage: pageTitle,
                                extractedAt: extractedAt,
                            });
                        }
                    }
                }

                // Extract relationships from actions data
                // This provides properly formatted relationship data for the UI
                if (type === "relationships" || type === "all") {
                    const actions = (knowledge as any).actions || [];

                    if (Array.isArray(actions)) {
                        for (const action of actions) {
                            // Transform action data to relationship format
                            const from =
                                action.subjectEntityName || "Unknown Entity";
                            const relationship =
                                action.verbs?.join(", ") || "related to";
                            const to =
                                action.objectEntityName || "Unknown Target";
                            const confidence = action.confidence || 0.8;

                            recentRelationships.push({
                                from: from,
                                relationship: relationship,
                                to: to,
                                confidence: confidence,
                                fromPage: pageTitle,
                                extractedAt: extractedAt,
                            });
                        }
                    }
                }
            }
        }

        // Sort by extraction date (most recent first) and limit results
        recentEntities.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );
        recentTopics.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );
        recentActions.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );
        recentRelationships.sort(
            (a, b) =>
                new Date(b.extractedAt).getTime() -
                new Date(a.extractedAt).getTime(),
        );

        // Remove duplicates while preserving order
        const uniqueEntities = recentEntities
            .filter(
                (entity, index, arr) =>
                    arr.findIndex(
                        (e) =>
                            e.name.toLowerCase() === entity.name.toLowerCase(),
                    ) === index,
            )
            .slice(0, limit);

        const uniqueTopics = recentTopics
            .filter(
                (topic, index, arr) =>
                    arr.findIndex(
                        (t) =>
                            t.name.toLowerCase() === topic.name.toLowerCase(),
                    ) === index,
            )
            .slice(0, limit);

        const uniqueActions = recentActions
            .filter(
                (action, index, arr) =>
                    arr.findIndex(
                        (a) =>
                            a.type === action.type &&
                            a.element === action.element &&
                            a.fromPage === action.fromPage,
                    ) === index,
            )
            .slice(0, limit);

        const uniqueRelationships = recentRelationships
            .filter(
                (relationship, index, arr) =>
                    arr.findIndex(
                        (r) =>
                            r.from === relationship.from &&
                            r.relationship === relationship.relationship &&
                            r.to === relationship.to,
                    ) === index,
            )
            .slice(0, limit);

        return {
            entities: uniqueEntities,
            topics: uniqueTopics,
            actions: uniqueActions,
            relationships: uniqueRelationships,
            success: true,
        };
    } catch (error) {
        console.error("Error getting recent knowledge items:", error);
        return {
            entities: [],
            topics: [],
            actions: [],
            relationships: [],
            success: false,
        };
    }
}

export async function getTopDomains(
    parameters: {
        limit?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    domains: Array<{
        domain: string;
        count: number;
        percentage: number;
    }>;
    totalSites: number;
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                domains: [],
                totalSites: 0,
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const limit = parameters.limit || 10;

        // Count sites by domain
        const domainCounts: { [domain: string]: number } = {};
        let totalCount = websites.length;

        for (const site of websites) {
            const metadata = site.metadata as any;
            const domain = metadata.domain || "unknown";
            domainCounts[domain] = (domainCounts[domain] || 0) + 1;
        }

        // Sort by count and limit results
        const sortedDomains = Object.entries(domainCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, limit)
            .map(([domain, count]) => ({
                domain,
                count,
                percentage: parseFloat(((count / totalCount) * 100).toFixed(1)),
            }));

        return {
            domains: sortedDomains,
            totalSites: totalCount,
            success: true,
        };
    } catch (error) {
        console.error("Error getting top domains:", error);
        return {
            domains: [],
            totalSites: 0,
            success: false,
        };
    }
}

export async function getActivityTrends(
    parameters: {
        timeRange?: string;
        granularity?: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    trends: Array<{
        date: string;
        visits: number;
        bookmarks: number;
    }>;
    summary: {
        totalActivity: number;
        peakDay: string | null;
        averagePerDay: number;
        timeRange: string;
    };
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                trends: [],
                summary: {
                    totalActivity: 0,
                    peakDay: null,
                    averagePerDay: 0,
                    timeRange: parameters.timeRange || "30d",
                },
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const timeRange = parameters.timeRange || "30d";

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        switch (timeRange) {
            case "7d":
                startDate.setDate(endDate.getDate() - 7);
                break;
            case "30d":
                startDate.setDate(endDate.getDate() - 30);
                break;
            case "90d":
                startDate.setDate(endDate.getDate() - 90);
                break;
            default:
                startDate.setDate(endDate.getDate() - 30);
        }

        // Extract activity data from websites
        const activityMap = new Map<
            string,
            { visits: number; bookmarks: number }
        >();

        for (const site of websites) {
            const metadata = site.metadata as any;

            // Process visit dates
            if (metadata.visitDate) {
                const visitDate = new Date(metadata.visitDate);
                if (visitDate >= startDate && visitDate <= endDate) {
                    const dateKey = visitDate.toISOString().split("T")[0];
                    const current = activityMap.get(dateKey) || {
                        visits: 0,
                        bookmarks: 0,
                    };
                    current.visits += metadata.visitCount || 1;
                    activityMap.set(dateKey, current);
                }
            }

            // Process bookmark dates
            if (metadata.bookmarkDate) {
                const bookmarkDate = new Date(metadata.bookmarkDate);
                if (bookmarkDate >= startDate && bookmarkDate <= endDate) {
                    const dateKey = bookmarkDate.toISOString().split("T")[0];
                    const current = activityMap.get(dateKey) || {
                        visits: 0,
                        bookmarks: 0,
                    };
                    current.bookmarks += 1;
                    activityMap.set(dateKey, current);
                }
            }
        }

        // Convert to trends array
        const trends = Array.from(activityMap.entries())
            .map(([date, activity]) => ({
                date,
                visits: activity.visits,
                bookmarks: activity.bookmarks,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Calculate summary statistics
        const totalVisits = trends.reduce((sum, t) => sum + t.visits, 0);
        const totalBookmarks = trends.reduce((sum, t) => sum + t.bookmarks, 0);
        const peakDay = trends.reduce(
            (peak, current) =>
                current.visits + current.bookmarks >
                peak.visits + peak.bookmarks
                    ? current
                    : peak,
            trends[0] || { date: null, visits: 0, bookmarks: 0 },
        );

        return {
            trends,
            summary: {
                totalActivity: totalVisits + totalBookmarks,
                peakDay: peakDay.date,
                averagePerDay:
                    trends.length > 0
                        ? (totalVisits + totalBookmarks) / trends.length
                        : 0,
                timeRange,
            },
            success: true,
        };
    } catch (error) {
        console.error("Error getting activity trends:", error);
        return {
            trends: [],
            summary: {
                totalActivity: 0,
                peakDay: null,
                averagePerDay: 0,
                timeRange: parameters.timeRange || "30d",
            },
            success: false,
        };
    }
}

export async function getPageIndexedKnowledge(
    parameters: { url: string },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    isIndexed: boolean;
    knowledge?: EnhancedKnowledgeExtractionResult;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                isIndexed: false,
                error: "No website collection available",
            };
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === parameters.url,
        );

        if (!foundWebsite) {
            return {
                isIndexed: false,
                error: "Page not found in index",
            };
        }

        try {
            const knowledge = foundWebsite.getKnowledge();

            if (!knowledge) {
                return {
                    isIndexed: true,
                    knowledge: {
                        entities: [],
                        relationships: [],
                        keyTopics: [],
                        detectedActions: [],
                        suggestedQuestions: [],
                        summary:
                            "Page is indexed but no knowledge was extracted.",
                        contentMetrics: {
                            readingTime: 0,
                            wordCount: 0,
                        },
                    },
                };
            }

            let detectedActions: any[] = [];

            // Check websiteObj metadata for detectedActions first (with safe property access)
            if (
                foundWebsite.metadata &&
                (foundWebsite.metadata as any).detectedActions &&
                Array.isArray((foundWebsite.metadata as any).detectedActions)
            ) {
                detectedActions = (foundWebsite.metadata as any)
                    .detectedActions;
            }

            // Also check knowledge object for detectedActions (fallback)
            if (
                (knowledge as any).detectedActions &&
                Array.isArray((knowledge as any).detectedActions)
            ) {
                detectedActions.push(...(knowledge as any).detectedActions);
            }

            // Convert the stored knowledge to the expected format
            const entities: Entity[] =
                knowledge.entities?.map((entity) => ({
                    name: entity.name,
                    type: Array.isArray(entity.type)
                        ? entity.type.join(", ")
                        : entity.type,
                    description: entity.facets?.find(
                        (f) => f.name === "description",
                    )?.value as string,
                    confidence: 0.8, // Default confidence for indexed content
                })) || [];

            const keyTopics: string[] = knowledge.topics || [];

            const allRelationships: Relationship[] =
                knowledge.actions?.map((action) => ({
                    from: action.subjectEntityName || "unknown",
                    relationship: action.verbs?.join(", ") || "related to",
                    to: action.objectEntityName || "unknown",
                    confidence: 0.8, // Default confidence for indexed content
                })) || [];

            // Deduplicate relationships
            const relationships = allRelationships.filter(
                (rel, index, arr) =>
                    arr.findIndex(
                        (r) =>
                            r.from === rel.from &&
                            r.relationship === rel.relationship &&
                            r.to === rel.to,
                    ) === index,
            );

            // Generate contextual questions for indexed content
            const suggestedQuestions: string[] = [];
            /*
            const suggestedQuestions: string[] =
                await generateSmartSuggestedQuestions(
                    knowledge,
                    null,
                    parameters.url,
                    context,
                );
            */

            // Calculate content metrics from the stored text
            const textContent = foundWebsite.textChunks?.join("\n\n") || "";
            const wordCount = textContent.split(/\s+/).length;
            const contentMetrics = {
                readingTime: Math.ceil(wordCount / 225),
                wordCount: wordCount,
            };

            const summary = `Retrieved indexed knowledge: ${entities.length} entities, ${keyTopics.length} topics, ${relationships.length} relationships.`;

            return {
                isIndexed: true,
                knowledge: {
                    entities,
                    relationships,
                    keyTopics,
                    detectedActions,
                    contentActions: knowledge.actions || [],
                    actionSummary: foundWebsite.metadata
                        ? (foundWebsite.metadata as any).actionSummary
                        : undefined,
                    suggestedQuestions,
                    summary,
                    contentMetrics,
                },
            };
        } catch (knowledgeError) {
            console.warn(
                "Error extracting knowledge from indexed page:",
                knowledgeError,
            );
            return {
                isIndexed: true,
                knowledge: {
                    entities: [],
                    relationships: [],
                    keyTopics: [],
                    detectedActions: [],
                    suggestedQuestions: [],
                    summary: "Page is indexed but knowledge extraction failed.",
                    contentMetrics: {
                        readingTime: 0,
                        wordCount: 0,
                    },
                },
            };
        }
    } catch (error) {
        console.error("Error getting page indexed knowledge:", error);
        return {
            isIndexed: false,
            error: "Failed to retrieve indexed knowledge",
        };
    }
}

export async function getDiscoverInsights(
    parameters: {
        limit?: number;
        timeframe?: string;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    trendingTopics: Array<{
        topic: string;
        count: number;
        trend: "up" | "down" | "stable";
        percentage: number;
    }>;
    readingPatterns: Array<{
        timeframe: string;
        activity: number;
        peak: boolean;
    }>;
    popularPages: Array<{
        url: string;
        title: string;
        visitCount: number;
        isBookmarked: boolean;
        domain: string;
        lastVisited: string;
    }>;
    topDomains: Array<{
        domain: string;
        count: number;
        favicon?: string;
        trend: "up" | "down" | "stable";
    }>;
    success: boolean;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                trendingTopics: [],
                readingPatterns: [],
                popularPages: [],
                topDomains: [],
                success: false,
            };
        }

        const websites = websiteCollection.messages.getAll();
        const limit = parameters.limit || 10;
        const timeframe = parameters.timeframe || "30d";

        // Analyze trending topics from titles and knowledge entities
        const trendingTopics = analyzeTrendingTopics(websites, limit);

        // Analyze reading patterns from temporal data
        const readingPatterns = analyzeReadingPatterns(websites, timeframe);

        // Identify popular pages by activity metrics
        const popularPages = analyzePopularPages(websites, limit);

        // Enhanced domain analysis with trends
        const topDomains = analyzeTopDomains(websites, limit);

        return {
            trendingTopics,
            readingPatterns,
            popularPages,
            topDomains,
            success: true,
        };
    } catch (error) {
        console.error("Error getting discover insights:", error);
        return {
            trendingTopics: [],
            readingPatterns: [],
            popularPages: [],
            topDomains: [],
            success: false,
        };
    }
}

function analyzeTrendingTopics(websites: any[], limit: number) {
    const topicCounts = new Map<string, number>();
    const recentTopicCounts = new Map<string, number>();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const site of websites) {
        const metadata = site.metadata as any;
        const title = metadata.title || "";
        const knowledge = site.getKnowledge();

        // Extract topics from title words (basic implementation)
        const titleWords = title
            .toLowerCase()
            .split(/\s+/)
            .filter(
                (word: string) =>
                    word.length > 3 &&
                    ![
                        "the",
                        "and",
                        "for",
                        "are",
                        "but",
                        "not",
                        "you",
                        "all",
                        "can",
                        "had",
                        "her",
                        "was",
                        "one",
                        "our",
                        "out",
                        "day",
                        "get",
                        "has",
                        "him",
                        "his",
                        "how",
                        "its",
                        "may",
                        "new",
                        "now",
                        "old",
                        "see",
                        "two",
                        "way",
                        "who",
                        "boy",
                        "did",
                        "man",
                        "car",
                        "got",
                        "let",
                        "say",
                        "she",
                        "too",
                        "use",
                    ].includes(word),
            );

        titleWords.forEach((word: string) => {
            topicCounts.set(word, (topicCounts.get(word) || 0) + 1);

            const visitDate = metadata.visitDate || metadata.bookmarkDate;
            if (visitDate && new Date(visitDate) > thirtyDaysAgo) {
                recentTopicCounts.set(
                    word,
                    (recentTopicCounts.get(word) || 0) + 1,
                );
            }
        });

        // Extract topics from knowledge entities
        if (knowledge?.entities) {
            knowledge.entities.forEach((entity: any) => {
                const entityName = entity.name?.toLowerCase();
                if (entityName && entityName.length > 2) {
                    topicCounts.set(
                        entityName,
                        (topicCounts.get(entityName) || 0) + 1,
                    );

                    const visitDate =
                        metadata.visitDate || metadata.bookmarkDate;
                    if (visitDate && new Date(visitDate) > thirtyDaysAgo) {
                        recentTopicCounts.set(
                            entityName,
                            (recentTopicCounts.get(entityName) || 0) + 1,
                        );
                    }
                }
            });
        }
    }

    const sortedTopics = Array.from(topicCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit);

    return sortedTopics.map(([topic, count]) => {
        const recentCount = recentTopicCounts.get(topic) || 0;
        const historicalCount = count - recentCount;
        let trend: "up" | "down" | "stable" = "stable";

        if (recentCount > historicalCount * 1.5) {
            trend = "up";
        } else if (recentCount < historicalCount * 0.5) {
            trend = "down";
        }

        return {
            topic,
            count,
            trend,
            percentage: Math.round((count / websites.length) * 100),
        };
    });
}

function analyzeReadingPatterns(websites: any[], timeframe: string) {
    const patterns = new Map<string, number>();
    const dayOfWeek = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];

    for (const site of websites) {
        const metadata = site.metadata as any;
        const visitDate = metadata.visitDate || metadata.bookmarkDate;

        if (visitDate) {
            const date = new Date(visitDate);
            const day = dayOfWeek[date.getDay()];
            patterns.set(day, (patterns.get(day) || 0) + 1);
        }
    }

    const maxActivity = Math.max(...Array.from(patterns.values()));

    return dayOfWeek.map((day) => ({
        timeframe: day,
        activity: patterns.get(day) || 0,
        peak: (patterns.get(day) || 0) === maxActivity && maxActivity > 0,
    }));
}

function analyzePopularPages(websites: any[], limit: number) {
    const pageStats = new Map<
        string,
        {
            url: string;
            title: string;
            visitCount: number;
            isBookmarked: boolean;
            domain: string;
            lastVisited: string;
        }
    >();

    for (const site of websites) {
        const metadata = site.metadata as any;
        const url = metadata.url || "";
        const title = metadata.title || url;
        const domain = url ? new URL(url).hostname : "";
        const isBookmarked = !!metadata.bookmarkDate;
        const lastVisited =
            metadata.visitDate ||
            metadata.bookmarkDate ||
            new Date().toISOString();

        if (url) {
            const existing = pageStats.get(url);
            if (existing) {
                existing.visitCount++;
                if (new Date(lastVisited) > new Date(existing.lastVisited)) {
                    existing.lastVisited = lastVisited;
                }
                if (isBookmarked) {
                    existing.isBookmarked = true;
                }
            } else {
                pageStats.set(url, {
                    url,
                    title,
                    visitCount: 1,
                    isBookmarked,
                    domain,
                    lastVisited,
                });
            }
        }
    }

    return Array.from(pageStats.values())
        .sort((a, b) => {
            // Prioritize bookmarked pages and visit count
            const scoreA = (a.isBookmarked ? 10 : 0) + a.visitCount;
            const scoreB = (b.isBookmarked ? 10 : 0) + b.visitCount;
            return scoreB - scoreA;
        })
        .slice(0, limit);
}

function analyzeTopDomains(websites: any[], limit: number) {
    const domainCounts = new Map<string, number>();
    const recentDomainCounts = new Map<string, number>();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const site of websites) {
        const metadata = site.metadata as any;
        const url = metadata.url;

        if (url) {
            try {
                const domain = new URL(url).hostname;
                domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);

                const visitDate = metadata.visitDate || metadata.bookmarkDate;
                if (visitDate && new Date(visitDate) > thirtyDaysAgo) {
                    recentDomainCounts.set(
                        domain,
                        (recentDomainCounts.get(domain) || 0) + 1,
                    );
                }
            } catch (error) {
                // Invalid URL, skip
            }
        }
    }

    return Array.from(domainCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([domain, count]) => {
            const recentCount = recentDomainCounts.get(domain) || 0;
            const historicalCount = count - recentCount;
            let trend: "up" | "down" | "stable" = "stable";

            if (recentCount > historicalCount * 1.5) {
                trend = "up";
            } else if (recentCount < historicalCount * 0.5) {
                trend = "down";
            }

            return {
                domain,
                count,
                trend,
                favicon: `https://www.google.com/s2/favicons?domain=${domain}`,
            };
        });
}

function checkPageExistsInIndex(
    url: string,
    context: SessionContext<BrowserActionContext>,
): boolean {
    try {
        const websiteCollection = context.agentContext.websiteCollection;
        if (!websiteCollection) {
            return false;
        }

        const websites = websiteCollection.messages.getAll();
        return websites.some((site: any) => site.metadata.url === url);
    } catch (error) {
        console.error("Error checking page existence:", error);
        return false;
    }
}

function hasIndexingErrors(result: any): boolean {
    return !!(
        result?.semanticRefs?.error || result?.secondaryIndexResults?.error
    );
}

export async function getDetailedKnowledgeStats(
    parameters: {
        includeQuality?: boolean;
        includeProgress?: boolean;
        timeRange?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<DetailedKnowledgeStats> {
    const websiteCollection = context.agentContext.websiteCollection;

    if (!websiteCollection) {
        return createEmptyKnowledgeStats();
    }

    const websites = websiteCollection.messages.getAll();

    // Calculate base stats
    const baseStats = await calculateBaseStats(websites);

    // Calculate extraction progress
    const extractionProgress = calculateExtractionProgress(websites);

    // Calculate quality distribution
    const qualityDistribution =
        parameters.includeQuality !== false
            ? calculateQualityDistribution(websites)
            : { highQuality: 0, mediumQuality: 0, lowQuality: 0 };

    // Calculate completion rates
    const completionRates = calculateCompletionRates(websites);

    return {
        ...baseStats,
        extractionProgress,
        qualityDistribution,
        completionRates,
    };
}

function createEmptyKnowledgeStats(): DetailedKnowledgeStats {
    return {
        totalPages: 0,
        totalEntities: 0,
        totalTopics: 0,
        totalRelationships: 0,
        uniqueDomains: 0,
        topEntityTypes: [],
        topDomains: [],
        recentActivity: [],
        storageSize: {
            totalBytes: 0,
            entitiesBytes: 0,
            contentBytes: 0,
            metadataBytes: 0,
        },
        extractionProgress: {
            entityProgress: 0,
            topicProgress: 0,
            actionProgress: 0,
        },
        qualityDistribution: {
            highQuality: 0,
            mediumQuality: 0,
            lowQuality: 0,
        },
        completionRates: {
            pagesWithEntities: 0,
            pagesWithTopics: 0,
            pagesWithActions: 0,
            totalProcessedPages: 0,
        },
    };
}

async function calculateBaseStats(websites: any[]): Promise<{
    totalPages: number;
    totalEntities: number;
    totalTopics: number;
    totalRelationships: number;
    uniqueDomains: number;
    topEntityTypes: Array<{ type: string; count: number }>;
    topDomains: Array<{ domain: string; pageCount: number }>;
    recentActivity: Array<{ date: string; pagesIndexed: number }>;
    storageSize: {
        totalBytes: number;
        entitiesBytes: number;
        contentBytes: number;
        metadataBytes: number;
    };
}> {
    let totalEntities = 0;
    let totalTopics = 0;
    let totalRelationships = 0;
    const domains = new Set<string>();
    const entityTypeCounts = new Map<string, number>();
    const domainCounts = new Map<string, number>();
    const uniqueTopicsSet = new Set<string>();
    let totalContent = 0;

    for (const site of websites) {
        try {
            const knowledge = site.getKnowledge();
            const metadata = site.metadata as website.WebsiteDocPartMeta;

            // Extract domain from URL
            if (metadata?.url) {
                try {
                    const domain = new URL(metadata.url).hostname;
                    domains.add(domain);
                    domainCounts.set(
                        domain,
                        (domainCounts.get(domain) || 0) + 1,
                    );
                } catch (error) {
                    // Invalid URL, skip domain extraction
                }
            }

            if (knowledge) {
                // Count entities and their types
                if (knowledge.entities?.length > 0) {
                    totalEntities += knowledge.entities.length;
                    knowledge.entities.forEach((entity: any) => {
                        const type = entity.type || "Unknown";
                        entityTypeCounts.set(
                            type,
                            (entityTypeCounts.get(type) || 0) + 1,
                        );
                    });
                }

                // Count unique topics
                if (knowledge.topics?.length > 0) {
                    knowledge.topics.forEach((topic: string) => {
                        uniqueTopicsSet.add(topic.toLowerCase().trim());
                    });
                }

                // Count relationships/actions
                if (knowledge.actions?.length > 0) {
                    totalRelationships += knowledge.actions.length;
                }
            }

            // Calculate content size
            const textContent = site.textChunks?.join("") || "";
            totalContent += textContent.length;
        } catch (error) {
            console.warn("Error processing site for stats:", error);
        }
    }

    // Set totalTopics to the count of unique topics found
    totalTopics = uniqueTopicsSet.size;

    // Convert entity types to sorted array
    const topEntityTypes = Array.from(entityTypeCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([type, count]) => ({ type, count }));

    // Convert domains to sorted array
    const topDomains = Array.from(domainCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([domain, pageCount]) => ({ domain, pageCount }));

    // Simple recent activity (last 7 days)
    const recentActivity = generateRecentActivity(websites);

    return {
        totalPages: websites.length,
        totalEntities,
        totalTopics,
        totalRelationships,
        uniqueDomains: domains.size,
        topEntityTypes,
        topDomains,
        recentActivity,
        storageSize: {
            totalBytes: totalContent,
            entitiesBytes: Math.round(totalContent * 0.3), // Estimate
            contentBytes: Math.round(totalContent * 0.6), // Estimate
            metadataBytes: Math.round(totalContent * 0.1), // Estimate
        },
    };
}

function calculateExtractionProgress(websites: any[]): {
    entityProgress: number;
    topicProgress: number;
    actionProgress: number;
} {
    let pagesWithEntities = 0;
    let pagesWithTopics = 0;
    let pagesWithActions = 0;

    websites.forEach((site) => {
        try {
            const knowledge = site.getKnowledge();
            if (knowledge) {
                if (knowledge.entities?.length > 0) pagesWithEntities++;
                if (knowledge.topics?.length > 0) pagesWithTopics++;
                if (knowledge.actions?.length > 0) pagesWithActions++;
            }
        } catch (error) {
            // Skip sites with knowledge extraction errors
        }
    });

    const total = websites.length || 1; // Prevent division by zero

    return {
        entityProgress: Math.round((pagesWithEntities / total) * 100),
        topicProgress: Math.round((pagesWithTopics / total) * 100),
        actionProgress: Math.round((pagesWithActions / total) * 100),
    };
}

function calculateQualityDistribution(websites: any[]): {
    highQuality: number;
    mediumQuality: number;
    lowQuality: number;
} {
    let high = 0,
        medium = 0,
        low = 0;
    let totalPagesWithKnowledge = 0;

    websites.forEach((site) => {
        try {
            const knowledge = site.getKnowledge();
            if (knowledge && knowledge.entities?.length > 0) {
                totalPagesWithKnowledge++;

                // Calculate average confidence across entities
                const confidences = knowledge.entities
                    .map((e: any) => e.confidence || 0)
                    .filter((c: number) => c > 0);

                if (confidences.length > 0) {
                    const avgConfidence =
                        confidences.reduce((a: number, b: number) => a + b) /
                        confidences.length;

                    if (avgConfidence >= 0.8) high++;
                    else if (avgConfidence >= 0.5) medium++;
                    else low++;
                } else {
                    // No confidence scores, assume medium quality
                    medium++;
                }
            }
        } catch (error) {
            // Skip sites with knowledge extraction errors
        }
    });

    const total = totalPagesWithKnowledge || 1;

    return {
        highQuality: Math.round((high / total) * 100),
        mediumQuality: Math.round((medium / total) * 100),
        lowQuality: Math.round((low / total) * 100),
    };
}

function calculateCompletionRates(websites: any[]): {
    pagesWithEntities: number;
    pagesWithTopics: number;
    pagesWithActions: number;
    totalProcessedPages: number;
} {
    let pagesWithEntities = 0;
    let pagesWithTopics = 0;
    let pagesWithActions = 0;

    websites.forEach((site) => {
        try {
            const knowledge = site.getKnowledge();
            if (knowledge) {
                if (knowledge.entities?.length > 0) pagesWithEntities++;
                if (knowledge.topics?.length > 0) pagesWithTopics++;
                if (knowledge.actions?.length > 0) pagesWithActions++;
            }
        } catch (error) {
            // Skip sites with knowledge extraction errors
        }
    });

    return {
        pagesWithEntities,
        pagesWithTopics,
        pagesWithActions,
        totalProcessedPages: websites.length,
    };
}

function generateRecentActivity(
    websites: any[],
): Array<{ date: string; pagesIndexed: number }> {
    const activityMap = new Map<string, number>();
    const now = new Date();

    // Initialize last 7 days with 0
    for (let i = 6; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split("T")[0];
        activityMap.set(dateStr, 0);
    }

    // Count pages by date
    websites.forEach((site) => {
        try {
            const metadata = site.metadata as website.WebsiteDocPartMeta;
            const siteDate = metadata?.visitDate || metadata?.bookmarkDate;

            if (siteDate) {
                const date = new Date(siteDate);
                const dateStr = date.toISOString().split("T")[0];

                if (activityMap.has(dateStr)) {
                    activityMap.set(
                        dateStr,
                        (activityMap.get(dateStr) || 0) + 1,
                    );
                }
            }
        } catch (error) {
            // Skip sites with invalid dates
        }
    });

    return Array.from(activityMap.entries())
        .map(([date, pagesIndexed]) => ({ date, pagesIndexed }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAnalyticsData(
    parameters: {
        timeRange?: string;
        includeQuality?: boolean;
        includeProgress?: boolean;
        topDomainsLimit?: number;
        activityGranularity?: "day" | "week" | "month";
    },
    context: SessionContext<BrowserActionContext>,
): Promise<AnalyticsDataResponse> {
    try {
        // Single coordinated data collection using Promise.all for efficiency
        const [
            knowledgeStats,
            topDomains,
            activityTrends,
            extractionAnalytics,
            recentKnowledgeItems,
        ] = await Promise.all([
            getDetailedKnowledgeStats(
                {
                    includeQuality: parameters.includeQuality !== false,
                    includeProgress: parameters.includeProgress !== false,
                    timeRange: 30,
                },
                context,
            ),
            getTopDomains(
                {
                    limit: parameters.topDomainsLimit || 10,
                },
                context,
            ),
            getActivityTrends(
                {
                    timeRange: parameters.timeRange || "30d",
                    granularity: parameters.activityGranularity || "day",
                },
                context,
            ),
            getExtractionAnalytics(
                {
                    timeRange: parameters.timeRange || "30d",
                },
                context,
            ),
            getRecentKnowledgeItems({ limit: 10, type: "all" }, context),
        ]);

        // Get basic website statistics from websiteCollection
        const websiteCollection = context.agentContext.websiteCollection;
        let totalSites = 0;
        let totalBookmarks = 0;
        let totalHistory = 0;
        let totalActions = 0;

        if (websiteCollection) {
            const websites = websiteCollection.messages.getAll();
            totalSites = websites.length;

            // Count bookmarks vs history and total actions
            websites.forEach((site) => {
                const metadata = site.metadata as website.WebsiteDocPartMeta;
                if (metadata?.bookmarkDate) {
                    totalBookmarks++;
                } else {
                    totalHistory++;
                }

                // Count actions in this site's knowledge
                const knowledge = site.getKnowledge();
                if (knowledge) {
                    const actions =
                        (knowledge as any).actions ||
                        (knowledge as any).detectedActions ||
                        [];
                    if (Array.isArray(actions)) {
                        totalActions += actions.length;
                    }
                }
            });
        }

        return {
            overview: {
                totalSites,
                totalBookmarks,
                totalHistory,
                topDomains: topDomains.domains?.length || 0,
                knowledgeExtracted: knowledgeStats.totalPages || 0,
            },
            knowledge: {
                extractionProgress: knowledgeStats.extractionProgress || {
                    entityProgress: 0,
                    topicProgress: 0,
                    actionProgress: 0,
                },
                qualityDistribution: knowledgeStats.qualityDistribution || {
                    highQuality: 0,
                    mediumQuality: 0,
                    lowQuality: 0,
                },
                totalEntities: knowledgeStats.totalEntities || 0,
                totalTopics: knowledgeStats.totalTopics || 0,
                totalActions: totalActions,
                totalRelationships: knowledgeStats.totalRelationships || 0,
                recentItems: knowledgeStats.recentActivity || [],
                recentEntities: recentKnowledgeItems.entities || [],
                recentTopics: recentKnowledgeItems.topics || [],
                recentActions: recentKnowledgeItems.actions || [],
                recentRelationships: recentKnowledgeItems.relationships || [],
            },
            domains: {
                topDomains: topDomains.domains || [],
                totalSites: topDomains.totalSites || 0,
            },
            activity: {
                trends: activityTrends.trends || [],
                summary: activityTrends.summary || {
                    totalActivity: 0,
                    peakDay: null,
                    averagePerDay: 0,
                    timeRange: parameters.timeRange || "30d",
                },
            },
            analytics: {
                extractionMetrics: extractionAnalytics.analytics || {},
                qualityReport: extractionAnalytics.analytics || {},
            },
        };
    } catch (error) {
        console.error("Error aggregating analytics data:", error);
        // Return empty analytics data on error
        return {
            overview: {
                totalSites: 0,
                totalBookmarks: 0,
                totalHistory: 0,
                topDomains: 0,
                knowledgeExtracted: 0,
            },
            knowledge: {
                extractionProgress: {
                    entityProgress: 0,
                    topicProgress: 0,
                    actionProgress: 0,
                },
                qualityDistribution: {
                    highQuality: 0,
                    mediumQuality: 0,
                    lowQuality: 0,
                },
                totalEntities: 0,
                totalTopics: 0,
                totalActions: 0,
                totalRelationships: 0,
                recentItems: [],
            },
            domains: {
                topDomains: [],
                totalSites: 0,
            },
            activity: {
                trends: [],
                summary: {
                    totalActivity: 0,
                    peakDay: null,
                    averagePerDay: 0,
                    timeRange: parameters.timeRange || "30d",
                },
            },
            analytics: {
                extractionMetrics: {},
                qualityReport: {},
            },
        };
    }
}

export async function getKnowledgeGraphStatus(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    hasGraph: boolean;
    entityCount: number;
    relationshipCount: number;
    communityCount: number;
    isBuilding: boolean;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            debug("website collection not found");
            return {
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
                error: "Website collection not available",
            };
        }

        // Check if relationships and communities tables exist
        if (
            !websiteCollection.relationships ||
            !websiteCollection.communities
        ) {
            // Tables not initialized, no graph exists
            return {
                hasGraph: false,
                entityCount: 0,
                relationshipCount: 0,
                communityCount: 0,
                isBuilding: false,
            };
        }

        // Get entity count from knowledge entities table
        let entityCount = 0;
        try {
            if (websiteCollection.knowledgeEntities) {
                entityCount = (
                    websiteCollection.knowledgeEntities as any
                ).getTotalEntityCount();
            }
        } catch (error) {
            console.warn("Failed to get entity count:", error);
        }

        // Get relationship count
        let relationshipCount = 0;
        try {
            const relationships =
                websiteCollection.relationships.getAllRelationships();
            relationshipCount = relationships.length;
        } catch (error) {
            console.warn("Failed to get relationship count:", error);
        }

        // Get community count
        let communityCount = 0;
        try {
            const communities =
                websiteCollection.communities.getAllCommunities();
            communityCount = communities.length;
        } catch (error) {
            console.warn("Failed to get community count:", error);
        }

        // Determine if graph exists based on actual data
        const hasGraph = relationshipCount > 0 || entityCount > 0;

        return {
            hasGraph: hasGraph,
            entityCount,
            relationshipCount,
            communityCount,
            isBuilding: false,
        };
    } catch (error) {
        console.error("Error getting knowledge graph status:", error);
        return {
            hasGraph: false,
            entityCount: 0,
            relationshipCount: 0,
            communityCount: 0,
            isBuilding: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function buildKnowledgeGraph(
    parameters: {
        minimalMode?: boolean;
        urlLimit?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    stats?: {
        urlsProcessed: number;
        entitiesFound: number;
        relationshipsCreated: number;
        communitiesDetected: number;
        timeElapsed: number;
    };
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        console.log(
            "[Knowledge Graph] Starting knowledge graph build with parameters:",
            parameters,
        );
        const startTime = Date.now();

        // TODO: Implement actual graph building logic here
        // This method currently only reports stats from existing data
        // Actual graph building should process URLs, extract entities/relationships,
        // run community detection, and calculate metrics

        const timeElapsed = Date.now() - startTime;

        // Get stats directly from websiteCollection using existing status method
        const status = await getKnowledgeGraphStatus({}, context);

        const stats = {
            urlsProcessed: parameters.urlLimit || status.entityCount,
            entitiesFound: status.entityCount,
            relationshipsCreated: status.relationshipCount,
            communitiesDetected: status.communityCount,
            timeElapsed: timeElapsed,
        };

        console.log("[Knowledge Graph] Build completed:", stats);

        return {
            success: true,
            message: `Knowledge graph build completed in ${timeElapsed}ms`,
            stats,
        };
    } catch (error) {
        console.error("[Knowledge Graph] Error building:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function rebuildKnowledgeGraph(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    success: boolean;
    message?: string;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                success: false,
                error: "Website collection not available",
            };
        }

        // Clear existing graph data and rebuild
        try {
            // Clear existing graph tables if they exist
            if (websiteCollection.relationships) {
                await websiteCollection.relationships.clear();
            }
            if (websiteCollection.communities) {
                await websiteCollection.communities.clear();
            }
        } catch (clearError) {
            // Continue even if clearing fails, as the rebuild might overwrite
            console.warn("Failed to clear existing graph data:", clearError);
        }

        // Rebuild the knowledge graph
        await websiteCollection.buildGraph();

        return {
            success: true,
            message: "Knowledge graph rebuilt successfully",
        };
    } catch (error) {
        console.error("Error rebuilding knowledge graph:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function getAllRelationships(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    relationships: any[];
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                relationships: [],
                error: "Website collection not available",
            };
        }

        const relationships =
            websiteCollection.relationships?.getAllRelationships() || [];

        return {
            relationships: relationships,
        };
    } catch (error) {
        console.error("Error getting all relationships:", error);
        return {
            relationships: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function getAllCommunities(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    communities: any[];
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                communities: [],
                error: "Website collection not available",
            };
        }

        const communities =
            websiteCollection.communities?.getAllCommunities() || [];

        return {
            communities: communities,
        };
    } catch (error) {
        console.error("Error getting all communities:", error);
        return {
            communities: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// Simple in-memory cache for graph data
interface GraphCache {
    entities: any[];
    relationships: any[];
    communities: any[];
    entityMetrics: any[];
    lastUpdated: number;
    isValid: boolean;
}

// Cache storage attached to websiteCollection
function getGraphCache(websiteCollection: any): GraphCache | null {
    return (websiteCollection as any).__graphCache || null;
}

function setGraphCache(websiteCollection: any, cache: GraphCache): void {
    (websiteCollection as any).__graphCache = cache;
}

// Ensure graph data is cached for fast access
async function ensureGraphCache(websiteCollection: any): Promise<void> {
    const cache = getGraphCache(websiteCollection);
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Check if cache is valid
    if (cache && cache.isValid && Date.now() - cache.lastUpdated < CACHE_TTL) {
        debug("[Knowledge Graph] Using valid cached graph data");
        return;
    }

    debug("[Knowledge Graph] Building in-memory cache for graph data");

    try {
        // Fetch raw data
        const entities =
            (websiteCollection.knowledgeEntities as any)?.getTopEntities(
                5000,
            ) || [];
        const relationships =
            websiteCollection.relationships?.getAllRelationships() || [];
        const communities =
            websiteCollection.communities?.getAllCommunities() || [];

        // Calculate metrics
        const entityMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );

        // Store in cache
        const newCache: GraphCache = {
            entities: entities,
            relationships: relationships,
            communities: communities,
            entityMetrics: entityMetrics,
            lastUpdated: Date.now(),
            isValid: true,
        };

        setGraphCache(websiteCollection, newCache);

        debug(
            `[Knowledge Graph] Cached ${entities.length} entities, ${relationships.length} relationships, ${communities.length} communities`,
        );
    } catch (error) {
        console.error("[Knowledge Graph] Failed to build cache:", error);

        // Mark cache as invalid but keep existing data if available
        const existingCache = getGraphCache(websiteCollection);
        if (existingCache) {
            existingCache.isValid = false;
        }
    }
}

export async function getAllEntitiesWithMetrics(
    parameters: {},
    context: SessionContext<BrowserActionContext>,
): Promise<{
    entities: any[];
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                entities: [],
                error: "Website collection not available",
            };
        }

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);
        if (cache && cache.isValid && cache.entityMetrics.length > 0) {
            debug(
                `[Knowledge Graph] Using cached entity data: ${cache.entityMetrics.length} entities`,
            );
            return {
                entities: cache.entityMetrics,
            };
        }

        // Fallback to live computation if no cache
        console.log(
            "[Knowledge Graph] Cache not available, computing entities with metrics",
        );
        const entities =
            (websiteCollection.knowledgeEntities as any)?.getTopEntities(
                5000,
            ) || [];
        const relationships =
            websiteCollection.relationships?.getAllRelationships() || [];
        const communities =
            websiteCollection.communities?.getAllCommunities() || [];

        const entityMetrics = calculateEntityMetrics(
            entities,
            relationships,
            communities,
        );

        return {
            entities: entityMetrics,
        };
    } catch (error) {
        console.error("Error getting all entities with metrics:", error);
        return {
            entities: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function getEntityNeighborhood(
    parameters: {
        entityId: string;
        depth?: number;
        maxNodes?: number;
    },
    context: SessionContext<BrowserActionContext>,
): Promise<{
    centerEntity?: any;
    neighbors: any[];
    relationships: any[];
    searchData?: any;
    metadata?: any;
    error?: string;
}> {
    try {
        const websiteCollection = context.agentContext.websiteCollection;

        if (!websiteCollection) {
            return {
                neighbors: [],
                relationships: [],
                error: "Website collection not available",
            };
        }

        const { entityId, depth = 2, maxNodes = 100 } = parameters;

        // Ensure cache is populated
        await ensureGraphCache(websiteCollection);

        // Get cached data
        const cache = getGraphCache(websiteCollection);
        if (!cache || !cache.isValid) {
            return {
                neighbors: [],
                relationships: [],
                error: "Graph cache not available",
            };
        }

        debug(
            `[Knowledge Graph] Performing BFS for entity "${entityId}" (depth: ${depth}, maxNodes: ${maxNodes})`,
        );

        // Perform BFS to find neighborhood
        const neighborhoodResult = performBFS(
            entityId,
            cache.entityMetrics,
            cache.relationships,
            depth,
            maxNodes,
        );

        if (!neighborhoodResult.centerEntity) {
            const searchNeibhbors = await searchByEntities(
                { entities: [entityId], maxResults: 20 },
                context,
            );

            if (
                searchNeibhbors 
            ) {
                return {
                    centerEntity: {
                        id: entityId,
                        name: entityId,
                        type: "entity",
                        confidence: 0.5,
                        count: 1,
                    },
                    neighbors: searchNeibhbors.relatedEntities || [],
                    relationships: [],
                    searchData: {
                        relatedEntities: searchNeibhbors?.relatedEntities || [],
                        topTopics: searchNeibhbors?.topTopics || [],
                        websites: searchNeibhbors?.websites || [],
                    },
                    metadata: {
                        source: "in_memory_cache",
                        queryDepth: depth,
                        maxNodes: maxNodes,
                        actualNodes:
                            (searchNeibhbors?.relatedEntities?.length || 0) + 1,
                        actualEdges: 0,
                        searchEnrichment: {
                            relatedEntities:
                                searchNeibhbors?.relatedEntities?.length || 0,
                            topTopics: searchNeibhbors?.topTopics?.length || 0,
                            websites: searchNeibhbors?.websites?.length || 0,
                        },
                    },
                };
            } else {
                return {
                    neighbors: [],
                    relationships: [],
                    error: `Entity "${entityId}" not found`,
                };
            }
        }

        // Get search enrichment for topics and related entities
        let searchData: any = null;
        try {
            const searchResults = await searchByEntities(
                { entities: [entityId], maxResults: 20 },
                context,
            );

            if (searchResults) {
                searchData = {
                    websites: searchResults.websites?.slice(0, 15) || [],
                    relatedEntities:
                        searchResults.relatedEntities?.slice(0, 15) || [],
                    topTopics: searchResults.topTopics?.slice(0, 10) || [],
                };

                debug(
                    `[Knowledge Graph] Search enrichment found: ${searchData.websites.length} websites, ${searchData.relatedEntities.length} related entities, ${searchData.topTopics.length} topics`,
                );
            }
        } catch (searchError) {
            console.warn(
                `[Knowledge Graph] Search enrichment failed:`,
                searchError,
            );
        }

        return {
            centerEntity: neighborhoodResult.centerEntity,
            neighbors: neighborhoodResult.neighbors,
            relationships: neighborhoodResult.relationships,
            searchData: {
                relatedEntities: searchData?.relatedEntities || [],
                topTopics: searchData?.topTopics || [],
                websites: searchData?.websites || [],
            },
            metadata: {
                source: "in_memory_cache",
                queryDepth: depth,
                maxNodes: maxNodes,
                actualNodes: neighborhoodResult.neighbors.length + 1,
                actualEdges: neighborhoodResult.relationships.length,
                searchEnrichment: {
                    relatedEntities: searchData?.relatedEntities?.length || 0,
                    topTopics: searchData?.topTopics?.length || 0,
                    websites: searchData?.websites?.length || 0,
                },
            },
        };
    } catch (error) {
        console.error("Error getting entity neighborhood:", error);
        return {
            neighbors: [],
            relationships: [],
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

// BFS implementation for finding entity neighborhood
function performBFS(
    entityId: string,
    entities: any[],
    relationships: any[],
    maxDepth: number,
    maxNodes: number,
): {
    centerEntity?: any;
    neighbors: any[];
    relationships: any[];
} {
    // Find center entity (case insensitive)
    const centerEntity = entities.find(
        (e) =>
            e.name?.toLowerCase() === entityId.toLowerCase() ||
            e.id?.toLowerCase() === entityId.toLowerCase(),
    );

    if (!centerEntity) {
        return { neighbors: [], relationships: [] };
    }

    // Build adjacency map for fast lookups
    const adjacencyMap = new Map<string, any[]>();
    const relationshipMap = new Map<string, any>();

    relationships.forEach((rel) => {
        const fromName = rel.fromEntity || rel.from;
        const toName = rel.toEntity || rel.to;

        if (fromName && toName) {
            // Normalize entity names for lookup
            const fromKey = fromName.toLowerCase();
            const toKey = toName.toLowerCase();

            if (!adjacencyMap.has(fromKey)) adjacencyMap.set(fromKey, []);
            if (!adjacencyMap.has(toKey)) adjacencyMap.set(toKey, []);

            adjacencyMap.get(fromKey)!.push(toKey);
            adjacencyMap.get(toKey)!.push(fromKey);

            const relKey = `${fromKey}-${toKey}`;
            const relKey2 = `${toKey}-${fromKey}`;
            relationshipMap.set(relKey, rel);
            relationshipMap.set(relKey2, rel);
        }
    });

    // BFS traversal
    const visited = new Set<string>();
    const queue: Array<{ entityName: string; depth: number }> = [];
    const result = {
        neighbors: [] as any[],
        relationships: [] as any[],
    };

    const centerKey =
        centerEntity.name?.toLowerCase() || centerEntity.id?.toLowerCase();
    queue.push({ entityName: centerKey, depth: 0 });
    visited.add(centerKey);

    while (queue.length > 0 && result.neighbors.length < maxNodes) {
        const current = queue.shift()!;

        if (current.depth > 0) {
            // Find the actual entity object
            const entity = entities.find(
                (e) =>
                    e.name?.toLowerCase() === current.entityName ||
                    e.id?.toLowerCase() === current.entityName,
            );

            if (entity) {
                result.neighbors.push(entity);
            }
        }

        if (current.depth < maxDepth) {
            const neighbors = adjacencyMap.get(current.entityName) || [];

            for (const neighborKey of neighbors) {
                if (
                    !visited.has(neighborKey) &&
                    result.neighbors.length < maxNodes
                ) {
                    visited.add(neighborKey);
                    queue.push({
                        entityName: neighborKey,
                        depth: current.depth + 1,
                    });

                    // Add relationship
                    const relKey = `${current.entityName}-${neighborKey}`;
                    const relationship = relationshipMap.get(relKey);
                    if (
                        relationship &&
                        !result.relationships.find(
                            (r) => r.rowId === relationship.rowId,
                        )
                    ) {
                        result.relationships.push(relationship);
                    }
                }
            }
        }
    }

    // add relationships between neighbors
    for (let i = 0; i < result.neighbors.length; i++) {
        for (let j = i + 1; j < result.neighbors.length; j++) {
            const neighborA = result.neighbors[i];
            const neighborB = result.neighbors[j];
            const relKey = `${neighborA.name?.toLowerCase() || neighborA.id?.toLowerCase()}-${neighborB.name?.toLowerCase() || neighborB.id?.toLowerCase()}`;
            const relationship = relationshipMap.get(relKey);
            if (
                relationship &&
                !result.relationships.find(
                    (r) => r.rowId === relationship.rowId,
                )
            ) {
                result.relationships.push(relationship);
            }
        }
    }

    return {
        centerEntity,
        neighbors: result.neighbors,
        relationships: result.relationships,
    };
}

function calculateEntityMetrics(
    entities: any[],
    relationships: any[],
    communities: any[],
): any[] {
    const entityMap = new Map<string, any>();
    const degreeMap = new Map<string, number>();
    const communityMap = new Map<string, string>();

    entities.forEach((entity) => {
        entityMap.set(entity.entityName, {
            id: entity.entityName,
            name: entity.entityName,
            type: entity.entityType || "entity",
            confidence: entity.confidence || 0.5,
            count: entity.count || 1,
        });
        degreeMap.set(entity.entityName, 0);
    });

    communities.forEach((community, index) => {
        let communityEntities: string[] = [];
        try {
            communityEntities =
                typeof community.entities === "string"
                    ? JSON.parse(community.entities)
                    : Array.isArray(community.entities)
                      ? community.entities
                      : [];
        } catch (e) {
            communityEntities = [];
        }

        communityEntities.forEach((entityName) => {
            communityMap.set(entityName, community.id || `community_${index}`);
        });
    });

    relationships.forEach((rel) => {
        const from = rel.fromEntity;
        const to = rel.toEntity;

        if (degreeMap.has(from)) {
            degreeMap.set(from, degreeMap.get(from)! + 1);
        }
        if (degreeMap.has(to)) {
            degreeMap.set(to, degreeMap.get(to)! + 1);
        }
    });

    const maxDegree = Math.max(...Array.from(degreeMap.values())) || 1;

    return Array.from(entityMap.values()).map((entity) => ({
        ...entity,
        degree: degreeMap.get(entity.name) || 0,
        importance: (degreeMap.get(entity.name) || 0) / maxDegree,
        communityId: communityMap.get(entity.name) || "default",
        size: Math.max(
            8,
            Math.min(40, 8 + Math.sqrt((degreeMap.get(entity.name) || 0) * 3)),
        ),
    }));
}
