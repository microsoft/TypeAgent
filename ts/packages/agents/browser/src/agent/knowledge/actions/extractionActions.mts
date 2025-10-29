// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    SessionContext,
    AppAgentEvent,
} from "@typeagent/agent-sdk";
import {
    BrowserActionContext,
    getActionBrowserControl,
    getBrowserControl,
} from "../../browserActions.mjs";
import {
    knowledgeProgressEvents,
    KnowledgeExtractionProgressEvent,
} from "../progress/knowledgeProgressEvents.mjs";
import { sendKnowledgeExtractionProgressViaWebSocket } from "../progress/extractionProgressManager.mjs";
import {
    EnhancedKnowledgeExtractionResult,
    Entity,
    Relationship,
} from "../schema/knowledgeExtraction.mjs";
import {
    ExtractionMode,
    ExtractionInput,
    EXTRACTION_MODE_CONFIGS,
} from "website-memory";
import * as website from "website-memory";
import { BrowserKnowledgeExtractor } from "../browserKnowledgeExtractor.mjs";
import { docPartsFromHtml } from "conversation-memory";
import { handleKnowledgeAction } from "./knowledgeActionRouter.mjs";
import {
    generateDetailedKnowledgeCards,
    updateExtractionProgressState,
    ActiveKnowledgeExtraction,
} from "../ui/knowledgeCardRenderer.mjs";
import { updateExtractionTimestamp } from "../cache/extractionCache.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:knowledge");

// Helper function to get actions from aggregated results
function getActionsFromAggregatedResults(aggregatedResults: any): any[] {
    // If we have contentActions, use them directly
    if (
        aggregatedResults.contentActions &&
        Array.isArray(aggregatedResults.contentActions) &&
        aggregatedResults.contentActions.length > 0
    ) {
        return aggregatedResults.contentActions;
    }

    // If we have relationships but no contentActions, convert relationships to actions
    if (
        aggregatedResults.relationships &&
        Array.isArray(aggregatedResults.relationships) &&
        aggregatedResults.relationships.length > 0
    ) {
        return aggregatedResults.relationships.map((relationship: any) => ({
            verbs: relationship.relationship
                ? relationship.relationship
                      .split(/[,\s]+/)
                      .filter((v: string) => v.trim().length > 0)
                : ["related to"],
            verbTense: "present" as "past" | "present" | "future",
            subjectEntityName: relationship.from || "none",
            objectEntityName: relationship.to || "none",
            indirectObjectEntityName: "none",
            params: [],
            confidence: relationship.confidence || 0.8,
        }));
    }

    return [];
}

// Helper function to check if a page exists in the index
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
    return result && result.errors && result.errors.length > 0;
}

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

// Helper function to convert HTML fragments to ExtractionInput objects
export function createExtractionInputsFromFragments(
    htmlFragments: any[],
    url: string,
    title: string,
    source: "direct" | "index" | "bookmark" | "history" | "import",
    timestamp?: string,
): ExtractionInput[] {
    return htmlFragments
        .map((fragment, index) => {
            let textContent = "";
            let htmlContent = "";
            let docParts: any[] | undefined;

            // Process HTML content first to create docParts (needed for AI extraction)
            if (fragment.content && fragment.content.trim().length > 0) {
                htmlContent = fragment.content;

                try {
                    docParts = docPartsFromHtml(
                        fragment.content,
                        false,
                        8000,
                        `${url}#iframe-${fragment.frameId || index}`,
                    );

                    if (docParts && docParts.length > 0) {
                        textContent = docParts
                            .map((p: any) => p.textChunks)
                            .join("\n\n");
                        console.log(
                            `✅ Created ${docParts.length} docParts for ${url}#iframe-${fragment.frameId || index}`,
                        );
                    } else {
                        console.warn(
                            `⚠️ docPartsFromHtml returned empty array for ${url}#iframe-${fragment.frameId || index}`,
                        );
                    }
                } catch (error) {
                    console.warn(
                        "Failed to create doc parts from HTML:",
                        error,
                    );
                    textContent = fragment.content
                        .replace(/<[^>]*>/g, "")
                        .trim();
                }
            }

            // Fall back to fragment.text if no HTML content or docParts creation failed
            if (
                !textContent &&
                fragment.text &&
                fragment.text.trim().length > 0
            ) {
                textContent = fragment.text.trim();
                console.log(
                    `📝 Using fragment.text for ${url}#iframe-${fragment.frameId || index} (no HTML content)`,
                );
            }

            const input: ExtractionInput = {
                url: `${url}#iframe-${fragment.frameId || index}`,
                title: `${title} (Frame ${fragment.frameId || index})`,
                htmlFragments: [fragment],
                textContent: textContent,
                source: source,
                metadata: {
                    frameId: fragment.frameId,
                    isIframe: fragment.frameId !== 0,
                },
            };

            if (htmlContent) {
                input.htmlContent = htmlContent;
            }
            if (docParts) {
                input.docParts = docParts;
            }
            if (timestamp) {
                input.timestamp = timestamp;
            }

            return input;
        })
        .filter((input) => input.textContent && input.textContent.length > 50);
}

// Helper function to aggregate extraction results from multiple fragments
export function aggregateExtractionResults(results: any[]): {
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

    // Generate summary from available data
    let finalSummary: string;
    if (summaries.length > 1) {
        finalSummary = `Multi-frame content summary:\n${summaries.map((s, i) => `Frame ${i + 1}: ${s}`).join("\n\n")}`;
    } else if (summaries.length === 1 && summaries[0]) {
        finalSummary = summaries[0];
    } else {
        // Generate a basic summary from entities and topics if no explicit summary exists
        const topEntities = uniqueEntities.slice(0, 5).map((e) => e.name);
        const topTopics = uniqueTopics.slice(0, 5);

        if (topEntities.length > 0 || topTopics.length > 0) {
            const parts = [];
            if (topTopics.length > 0) {
                parts.push(`Topics: ${topTopics.join(", ")}`);
            }
            if (topEntities.length > 0) {
                parts.push(`Key entities: ${topEntities.join(", ")}`);
            }
            finalSummary = parts.join(". ");
        } else {
            finalSummary = "No content summary available.";
        }
    }

    const aggregatedResult: any = {
        entities: uniqueEntities,
        relationships: uniqueRelationships,
        keyTopics: uniqueTopics,
        suggestedQuestions: uniqueQuestions,
        summary: finalSummary,
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

function shouldIncludeMode(
    checkMode: ExtractionMode,
    actualMode: ExtractionMode,
): boolean {
    // Only return the selected mode and "basic"
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

/**
 * Save extracted knowledge to index with proper text chunking
 * This preserves the docParts chunking structure instead of flattening to a single chunk
 */
async function saveExtractedKnowledgeWithChunks(
    url: string,
    title: string,
    extractionInputs: ExtractionInput[],
    aggregatedResults: any,
    context: SessionContext<BrowserActionContext>,
): Promise<void> {
    if (!context.agentContext.websiteCollection) {
        debug("No websiteCollection available, skipping save");
        return;
    }

    try {
        debug(`Saving extracted knowledge to index for URL: ${url}`);

        // Extract text chunks from docParts (preserves chunking structure)
        const allTextChunks: string[] = [];
        let totalDocParts = 0;

        extractionInputs.forEach((input, idx) => {
            if (input.docParts && input.docParts.length > 0) {
                totalDocParts += input.docParts.length;

                input.docParts.forEach((docPart, dpIdx) => {
                    if (Array.isArray(docPart.textChunks)) {
                        allTextChunks.push(...docPart.textChunks);
                    } else if (typeof docPart.textChunks === "string") {
                        allTextChunks.push(docPart.textChunks);
                    }
                });
            } else if (input.textContent) {
                allTextChunks.push(input.textContent);
            }
        });

        debug(
            `Extracted ${allTextChunks.length} text chunks from ${extractionInputs.length} extraction inputs with ${totalDocParts} docParts`,
        );

        // Create WebsiteMeta
        const timestamp = new Date().toISOString();
        const meta = new website.WebsiteMeta({
            url,
            title,
            source: "history",
            visitDate: timestamp,
        });

        // Create Website object directly with chunked text
        const websiteObj = new website.Website(
            meta,
            allTextChunks, // Preserves chunking!
            [],
            aggregatedResults.entities && aggregatedResults.entities.length > 0
                ? {
                      entities: aggregatedResults.entities.map(
                          (entity: any) => ({
                              ...entity,
                              type: Array.isArray(entity.type)
                                  ? entity.type
                                  : [entity.type],
                          }),
                      ),
                      topics:
                          aggregatedResults.keyTopics ||
                          aggregatedResults.topics,
                      actions:
                          getActionsFromAggregatedResults(aggregatedResults),
                      inverseActions: [],
                  }
                : undefined,
            undefined, // topicHierarchy - will be built during indexing
            undefined, // deletionInfo
            true, // isNew
        );

        // Add metadata
        if (
            aggregatedResults.detectedActions ||
            aggregatedResults.actionSummary
        ) {
            websiteObj.metadata.detectedActions =
                aggregatedResults.detectedActions;
            websiteObj.metadata.actionSummary = aggregatedResults.actionSummary;
        }
        if (aggregatedResults.summary) {
            websiteObj.metadata.contentSummary = aggregatedResults.summary;
        }

        // Check if page already exists
        const isNewPage = !checkPageExistsInIndex(url, context);

        // Save to index
        if (isNewPage) {
            const docPart = website.WebsiteDocPart.fromWebsite(websiteObj);
            const result =
                await context.agentContext.websiteCollection.addWebsiteToIndex(
                    docPart,
                );
            if (hasIndexingErrors(result)) {
                debug(
                    "Incremental indexing failed, falling back to full rebuild",
                );
                context.agentContext.websiteCollection.addWebsites([
                    websiteObj,
                ]);
                await context.agentContext.websiteCollection.buildIndex();
            }
            debug(`Saved new page to index: ${url}`);
        } else {
            const docPart = website.WebsiteDocPart.fromWebsite(websiteObj);

            const result =
                await context.agentContext.websiteCollection.updateWebsiteInIndex(
                    url,
                    docPart,
                );
            if (hasIndexingErrors(result)) {
                debug(
                    "Incremental update failed, falling back to full rebuild",
                );
                context.agentContext.websiteCollection.addWebsites([
                    websiteObj,
                ]);
                await context.agentContext.websiteCollection.buildIndex();
            }
            debug(`Updated existing page in index: ${url}`);
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

        debug(
            `Knowledge saved successfully for ${url} with ${allTextChunks.length} text chunks`,
        );
    } catch (error) {
        console.error("Error saving knowledge to index:", error);
        throw error; // Re-throw so caller knows save failed
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
            title: parameters.title,
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
            title: parameters.title,
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
        saveToIndex?: boolean; // Auto-save results to index after extraction
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
        incrementCounter: boolean = true,
    ) => {
        if (incrementCounter) {
            processedItems++;
        }

        totalItems = Math.max(totalItems, processedItems);
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

        debug(
            `📊 Progress Update [${extractionId}]: phase=${phase}, item=${currentItem || "N/A"}, ` +
                `entities=${incrementalData?.entities?.length || 0}, ` +
                `topics=${incrementalData?.keyTopics?.length || 0}, ` +
                `relationships=${incrementalData?.relationships?.length || 0}, ` +
                `processed=${processedItems}/${totalItems}`,
        );
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
                title: parameters.title,
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

        // Verify AI model is available for the requested mode
        const modeConfig = EXTRACTION_MODE_CONFIGS[extractionMode];
        if (
            modeConfig &&
            modeConfig.usesAI &&
            !extractor.isConfiguredForMode(extractionMode)
        ) {
            debug(
                `⚠️ AI model not available for ${extractionMode} mode, falling back to basic extraction`,
            );
        }

        // Phase 2: Basic extraction
        await sendProgressUpdate("basic", "Processing basic page information");

        let aggregatedResults: any = {
            title: parameters.title,
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
                            false, // Don't increment - already set from progress.processed
                        );
                    }
                },
                3,
            );
            aggregatedResults = aggregateExtractionResults(basicResults);
            aggregatedResults.title = parameters.title;

            await sendProgressUpdate(
                "basic",
                "Basic analysis complete",
                aggregatedResults,
            );

            // Save to index if basic was the requested mode
            if (parameters.saveToIndex && extractionMode === "basic") {
                await saveExtractedKnowledgeWithChunks(
                    url,
                    parameters.title,
                    extractionInputs,
                    aggregatedResults,
                    context,
                );
            }
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
                            false, // Don't increment - already set from progress.processed
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

            // Save to index if summary was the requested mode
            if (parameters.saveToIndex && extractionMode === "summary") {
                await saveExtractedKnowledgeWithChunks(
                    url,
                    parameters.title,
                    extractionInputs,
                    aggregatedResults,
                    context,
                );
            }
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
                            false, // Don't increment - already set from progress.processed
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

            // Replace summary with content extraction results (includes AI-generated summaries)
            if (contentData.summary) {
                aggregatedResults.summary = contentData.summary;
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

            // Save to index if content was the requested mode
            if (parameters.saveToIndex && extractionMode === "content") {
                await saveExtractedKnowledgeWithChunks(
                    url,
                    parameters.title,
                    extractionInputs,
                    aggregatedResults,
                    context,
                );
            }
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
                            false, // Don't increment - already set from progress.processed
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

            // If full extraction provides summary, replace previous one
            if (fullData.summary) {
                aggregatedResults.summary = fullData.summary;
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

            // Save to index if full was the requested mode
            if (parameters.saveToIndex && extractionMode === "full") {
                await saveExtractedKnowledgeWithChunks(
                    url,
                    parameters.title,
                    extractionInputs,
                    aggregatedResults,
                    context,
                );
            }
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
            context.agentContext.currentClient,
            extractionId,
            errorProgress,
        );

        throw error;
    }
}

// Global tracking for active knowledge extractions
const activeKnowledgeExtractions = new Map<string, ActiveKnowledgeExtraction>();

// Convert stored knowledge format (with actions) back to display format (with relationships)
function convertStoredKnowledgeToDisplayFormat(storedKnowledge: any): any {
    const displayKnowledge = { ...storedKnowledge };

    // Convert actions array to relationships array
    if (storedKnowledge.actions && Array.isArray(storedKnowledge.actions)) {
        displayKnowledge.relationships = storedKnowledge.actions.map(
            (action: any) => ({
                from: action.subjectEntityName || "unknown",
                relationship: Array.isArray(action.verbs)
                    ? action.verbs.join(" ")
                    : action.verbs || "related to",
                to: action.objectEntityName || "unknown",
                confidence: action.confidence || 0.8,
            }),
        );
    } else {
        displayKnowledge.relationships = [];
    }

    return displayKnowledge;
}

// Helper functions for enhanced navigation with index integration
async function checkKnowledgeInIndex(
    url: string,
    context:
        | ActionContext<BrowserActionContext>
        | SessionContext<BrowserActionContext>,
): Promise<any | null> {
    try {
        // Get the session context - either directly or from action context
        const sessionContext =
            "sessionContext" in context ? context.sessionContext : context;
        const websiteCollection = sessionContext.agentContext.websiteCollection;

        if (!websiteCollection) {
            return null;
        }

        const websites = websiteCollection.messages.getAll();
        const foundWebsite = websites.find(
            (site: any) => site.metadata.url === url,
        );

        if (foundWebsite) {
            const knowledge = foundWebsite.getKnowledge();
            if (knowledge) {
                return convertStoredKnowledgeToDisplayFormat(knowledge);
            }
            return null;
        }

        return null;
    } catch (error) {
        debug("No existing knowledge found in index for:", url);
        return null;
    }
}

async function saveKnowledgeToIndex(
    url: string,
    knowledge: any,
    context:
        | ActionContext<BrowserActionContext>
        | SessionContext<BrowserActionContext>,
): Promise<void> {
    try {
        if (!knowledge || !url) {
            debug(
                `Indexing knowledge failed. The URL is ${url} and the knowledge was (${JSON.stringify(knowledge)})`,
            );
            return;
        }

        debug(
            `Indexing knowledge started. The URL is ${url} and the knowledge was (${JSON.stringify(knowledge)})`,
        );

        // Use the existing indexWebPageContent function with extracted knowledge
        const parameters = {
            url,
            title: knowledge.title || "Extracted Page",
            extractKnowledge: true,
            timestamp: new Date().toISOString(),
            extractedKnowledge: knowledge,
        };

        // Get the session context - either directly or from action context
        const sessionContext =
            "sessionContext" in context ? context.sessionContext : context;

        const result = await handleKnowledgeAction(
            "indexWebPageContent",
            parameters,
            sessionContext,
        );

        if (result.indexed) {
            debug(
                `Successfully indexed knowledge for ${url} (${result.entityCount} entities)`,
            );
        } else {
            console.warn(`Failed to index knowledge for ${url}`);
        }
    } catch (error) {
        console.error("Failed to save knowledge to index:", error);
    }
}

async function handleKnowledgeExtractionProgressFromEvent(
    progress: KnowledgeExtractionProgressEvent,
    activeExtraction: ActiveKnowledgeExtraction,
) {
    debug(
        `Knowledge Extraction Progress Event [${progress.extractionId}]:`,
        progress,
    );

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

    activeExtraction.lastUpdateTime = Date.now();
}

// Orchestration functions for knowledge extraction workflows

export async function performKnowledgeExtraction(
    url: string,
    context: ActionContext<BrowserActionContext>,
    extractionMode: string,
): Promise<any | null> {
    try {
        const browserControl = getActionBrowserControl(context);

        // Get page contents
        let title = "Unknown Page";
        const htmlFragments =
            await context.sessionContext.agentContext.browserConnector?.getHtmlFragments(
                false,
                "knowledgeExtraction",
            );
        if (!htmlFragments) {
            return null;
        }

        title = await browserControl.getPageUrl(); // Get actual URL as fallback title

        // Use the existing streaming extraction function
        const extractionId = `navigation-${Date.now()}`;
        const parameters = {
            url,
            title,
            mode: extractionMode,
            extractionId,
            htmlFragments,
        };

        // Set up dynamic display ID for real-time progress updates
        const dynamicDisplayId = `knowledge-extraction-${extractionId}`;

        // Register the extraction for progress tracking with enhanced state
        const activeExtraction: ActiveKnowledgeExtraction = {
            extractionId,
            url,
            actionIO: context.actionIO,
            dynamicDisplayId,
            progressState: {
                phase: "initializing",
                percentage: 0,
                startTime: Date.now(),
                lastUpdate: Date.now(),
                errors: [],
            },
            aggregatedKnowledge: {
                entities: [],
                topics: [],
                relationships: [],
            },
            lastUpdateTime: Date.now(),
        };
        activeKnowledgeExtractions.set(extractionId, activeExtraction);

        // Subscribe to progress events for this extraction
        const progressHandler = async (
            progress: KnowledgeExtractionProgressEvent,
        ) => {
            await handleKnowledgeExtractionProgressFromEvent(
                progress,
                activeExtraction,
            );
        };
        knowledgeProgressEvents.onProgressById(extractionId, progressHandler);

        // Ensure cleanup after extraction completes
        const cleanup = () => {
            knowledgeProgressEvents.removeProgressListener(extractionId);
            setTimeout(() => {
                activeKnowledgeExtractions.delete(extractionId);
            }, 30000);
        };

        // Start the extraction process without awaiting (background processing)
        handleKnowledgeAction(
            "extractKnowledgeFromPageStreaming",
            parameters,
            context.sessionContext,
        )
            .then(async (knowledge) => {
                // Update the final state when extraction completes
                if (activeExtraction.progressState) {
                    activeExtraction.progressState.phase = "complete";
                    activeExtraction.progressState.percentage = 100;
                    activeExtraction.progressState.lastUpdate = Date.now();
                }

                // Auto-save to index when extraction completes
                if (knowledge) {
                    try {
                        await saveKnowledgeToIndex(url, knowledge, context);
                    } catch (saveError) {
                        console.error(
                            "Failed to save knowledge to index:",
                            saveError,
                        );
                    }
                }

                cleanup();
                return knowledge || null;
            })
            .catch((error) => {
                // Handle errors by updating progress state
                if (activeExtraction.progressState) {
                    activeExtraction.progressState.phase = "error";
                    activeExtraction.progressState.lastUpdate = Date.now();
                    activeExtraction.progressState.errors = [error.message];
                }
                cleanup();
                console.error("Knowledge extraction failed:", error);
            });

        // Return immediately with the dynamic display information and extractionId
        return {
            extractionId,
            dynamicDisplayId,
            dynamicDisplayNextRefreshMs: 1500,
            knowledge: null, // No immediate knowledge, will be populated via progress events
        };
    } catch (error) {
        console.error("Failed to extract knowledge:", error);
        return null;
    }
}

export async function performKnowledgeExtractionWithNotifications(
    url: string,
    sessionContext: SessionContext<BrowserActionContext>,
    extractionMode: string,
    parameters: any,
): Promise<void> {
    let progressInterval: NodeJS.Timeout | null = null;

    try {
        const extractionId = parameters.extractionId;

        // Create a minimal tracking entry
        const activeExtraction: ActiveKnowledgeExtraction = {
            extractionId,
            url,
            actionIO: null, // No actionIO for notification-based extraction
            dynamicDisplayId: null,
            progressState: {
                phase: "initializing",
                percentage: 0,
                startTime: Date.now(),
                lastUpdate: Date.now(),
                errors: [],
            },
            aggregatedKnowledge: {
                entities: [],
                topics: [],
                relationships: [],
            },
            lastUpdateTime: Date.now(),
        };

        activeKnowledgeExtractions.set(extractionId, activeExtraction);

        // Subscribe to progress events to update internal state only
        const progressHandler = (
            progress: KnowledgeExtractionProgressEvent,
        ) => {
            handleKnowledgeExtractionProgressFromEvent(
                progress,
                activeExtraction,
            );
        };

        knowledgeProgressEvents.onProgressById(extractionId, progressHandler);

        // Set up periodic notification callback similar to dynamic display system
        let lastNotificationState: string | null = null;

        const sendPeriodicProgress = () => {
            if (
                !activeExtraction.progressState ||
                !activeExtraction.aggregatedKnowledge
            ) {
                return;
            }

            const { progressState, aggregatedKnowledge } = activeExtraction;
            const entitiesCount = aggregatedKnowledge.entities?.length || 0;
            const topicsCount =
                aggregatedKnowledge.topics?.length ||
                (aggregatedKnowledge as any).keyTopics?.length ||
                0;
            const relationshipsCount =
                aggregatedKnowledge.relationships?.length || 0;

            // Only send notification if knowledge has changed
            const currentState = `${entitiesCount}-${topicsCount}-${relationshipsCount}-${progressState.phase}-${progressState.percentage}`;
            if (
                currentState !== lastNotificationState &&
                (entitiesCount > 0 || topicsCount > 0 || relationshipsCount > 0)
            ) {
                lastNotificationState = currentState;

                const knowledgeHtml =
                    generateDetailedKnowledgeCards(aggregatedKnowledge);
                const headerText = "🔄 Knowledge Extraction Progress";
                const subText = `Extracting knowledge from ${url}`;

                sessionContext.notify(
                    AppAgentEvent.Inline,
                    {
                        type: "html",
                        content: `
                            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #e3f2fd; border-left: 4px solid #2196f3; border-radius: 4px;">
                                <div style="font-weight: 600; color: #0d47a1;">${headerText}</div>
                                <div style="font-size: 13px; color: #0d47a1; margin-top: 4px;">
                                    ${subText}
                                </div>
                                <div style="font-size: 13px; color: #0d47a1; margin-top: 8px;">
                                    Found ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships
                                </div>
                            </div>
                            ${knowledgeHtml}
                        `,
                    },
                    extractionId,
                );
            }
        };

        // Start periodic progress notifications every 1.5 seconds (same as dynamic display)
        progressInterval = setInterval(() => {
            if (
                activeExtraction.progressState?.phase === "complete" ||
                activeExtraction.progressState?.phase === "error"
            ) {
                if (progressInterval) clearInterval(progressInterval);
                return;
            }
            sendPeriodicProgress();
        }, 1500);

        // Start the extraction process without awaiting (background processing)
        handleKnowledgeAction(
            "extractKnowledgeFromPageStreaming",
            parameters,
            sessionContext,
        )
            .then(async (knowledge) => {
                // Clear the interval when extraction completes
                if (progressInterval) clearInterval(progressInterval);

                // Update the final state when extraction completes
                if (activeExtraction.progressState) {
                    activeExtraction.progressState.phase = "complete";
                    activeExtraction.progressState.percentage = 100;
                    activeExtraction.progressState.lastUpdate = Date.now();
                }

                // Send completion notification with summary

                // Always save to index first (critical for performance)
                try {
                    await saveKnowledgeToIndex(url, knowledge, sessionContext);
                    updateExtractionTimestamp(url);

                    const entitiesCount = knowledge.entities?.length || 0;
                    const topicsCount =
                        knowledge.topics?.length ||
                        knowledge.keyTopics?.length ||
                        0;
                    const relationshipsCount =
                        knowledge.relationships?.length || 0;

                    const knowledgeHtml =
                        generateDetailedKnowledgeCards(knowledge);

                    const headerText = "✅ Knowledge Extraction Complete";
                    const subText = `Successfully extracted and indexed knowledge from the ${url} page`;

                    sessionContext.notify(
                        AppAgentEvent.Inline,
                        {
                            type: "html",
                            content: `
                                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #d4edda; border-left: 4px solid #28a745; border-radius: 4px;">
                                    <div style="font-weight: 600; color: #155724;">${headerText}</div>
                                    <div style="font-size: 13px; color: #155724; margin-top: 4px;">
                                        ${subText}
                                    </div>
                                    <div style="font-size: 13px; color: #155724; margin-top: 8px;">
                                        Found ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships
                                    </div>
                                </div>
                                ${knowledgeHtml}
                            `,
                        },
                        extractionId,
                    );
                } catch (indexError) {
                    // Still notify about extraction, but warn about index failure
                    console.error(
                        `Failed to index knowledge for ${url}:`,
                        indexError,
                    );
                    const entitiesCount = knowledge.entities?.length || 0;
                    const topicsCount =
                        knowledge.topics?.length ||
                        knowledge.keyTopics?.length ||
                        0;
                    const relationshipsCount =
                        knowledge.relationships?.length || 0;

                    const knowledgeHtml =
                        generateDetailedKnowledgeCards(knowledge);

                    const headerText =
                        "⚠️ Knowledge Extraction Complete (Warning)";
                    const subText = `Successfully extracted knowledge from the ${url} page, but failed to save to index`;

                    sessionContext.notify(
                        AppAgentEvent.Inline,
                        {
                            type: "html",
                            content: `
                                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                                    <div style="font-weight: 600; color: #856404;">${headerText}</div>
                                    <div style="font-size: 13px; color: #856404; margin-top: 4px;">
                                        ${subText}
                                    </div>
                                    <div style="font-size: 13px; color: #856404; margin-top: 8px;">
                                        Found ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships
                                    </div>
                                </div>
                                ${knowledgeHtml}
                            `,
                        },
                        extractionId,
                    );
                }

                // Cleanup when extraction completes
                knowledgeProgressEvents.removeProgressListener(
                    parameters.extractionId,
                );
                setTimeout(() => {
                    activeKnowledgeExtractions.delete(parameters.extractionId);
                }, 30000);
            })
            .catch((error: any) => {
                // Clear the interval on error
                if (progressInterval) clearInterval(progressInterval);

                console.error(
                    "Knowledge extraction with notifications failed:",
                    error,
                );
                // Send final error notification with the same eventSetId to replace progress
                sessionContext.notify(
                    AppAgentEvent.Inline,
                    {
                        type: "html",
                        content: `
                            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #f8d7da; border-left: 4px solid #dc3545; border-radius: 4px;">
                                <div style="font-weight: 600; color: #721c24;">❌ Knowledge Extraction Failed</div>
                                <div style="font-size: 13px; color: #721c24; margin-top: 4px;">
                                    Failed to extract knowledge from ${url}
                                </div>
                                <div style="font-size: 12px; color: #721c24; margin-top: 8px;">
                                    Error: ${error.message}
                                </div>
                            </div>
                        `,
                    },
                    extractionId,
                );

                // Cleanup on error
                knowledgeProgressEvents.removeProgressListener(
                    parameters.extractionId,
                );
                setTimeout(() => {
                    activeKnowledgeExtractions.delete(parameters.extractionId);
                }, 30000);
            });
    } catch (error: any) {
        // Clear the interval if setup fails
        if (progressInterval) clearInterval(progressInterval);

        console.error("Knowledge extraction setup failed:", error);
        sessionContext.notify(
            AppAgentEvent.Error,
            `Knowledge extraction setup failed for ${url}: ${error.message}`,
        );
    }
}

/**
 * Determines whether knowledge extraction should run for the current page
 * based on auto-indexing settings and URL validation
 */
export async function shouldRunKnowledgeExtraction(
    url: string,
    context:
        | ActionContext<BrowserActionContext>
        | SessionContext<BrowserActionContext>,
): Promise<boolean> {
    try {
        // Check if auto-indexing is enabled
        const browserControl =
            "actionIO" in context
                ? getActionBrowserControl(
                      context as ActionContext<BrowserActionContext>,
                  )
                : getBrowserControl(context.agentContext);

        const browserSettings = await browserControl.getBrowserSettings();
        if (!browserSettings.autoIndexing) {
            return false;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return false;
        }

        const validProtocols = ["http:", "https:"];
        if (!validProtocols.includes(parsedUrl.protocol)) {
            return false;
        }

        // TODO: Add domain filtering to skip indexing for specific user-configured domains

        return true;
    } catch (error) {
        debug("Error checking if knowledge extraction should run:", error);
        return false;
    }
}

// Export utility functions for use in other modules
export { checkKnowledgeInIndex, saveKnowledgeToIndex };

// Export function to access active extractions for dynamic display purposes
export function getActiveKnowledgeExtraction(
    extractionId: string,
): ActiveKnowledgeExtraction | undefined {
    return activeKnowledgeExtractions.get(extractionId);
}

// Export function to cleanup active extractions
export function deleteActiveKnowledgeExtraction(extractionId: string): void {
    activeKnowledgeExtractions.delete(extractionId);
}
