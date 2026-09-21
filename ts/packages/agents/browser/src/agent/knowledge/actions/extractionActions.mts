// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgentEvent,
    SessionContext,
} from "@typeagent/agent-sdk";
import registerDebug from "debug";
import { convert } from "html-to-text";

import {
    BrowserActionContext,
    getActionBrowserControl,
} from "../../browserActions.mjs";
import type { BrowserSourceKnowledge } from "../../browserMemoryService.mjs";
import { updateExtractionTimestamp } from "../cache/extractionCache.mjs";
import {
    knowledgeProgressEvents,
    KnowledgeExtractionProgressEvent,
} from "../progress/knowledgeProgressEvents.mjs";
import {
    EnhancedKnowledgeExtractionResult,
    Entity,
    Relationship,
} from "../schema/knowledgeExtraction.mjs";
import {
    ActiveKnowledgeExtraction,
    generateDetailedKnowledgeCards,
    updateExtractionProgressState,
} from "../ui/knowledgeCardRenderer.mjs";
import { handleKnowledgeAction } from "./knowledgeActionRouter.mjs";

const debug = registerDebug("typeagent:browser:knowledge");
const activeKnowledgeExtractions = new Map<string, ActiveKnowledgeExtraction>();
const extractionControllers = new Map<string, AbortController>();

export interface BrowserDocumentExtractionInput {
    url: string;
    title: string;
    htmlFragments: unknown[];
    textContent: string;
    source: "direct" | "index" | "bookmark" | "history" | "import";
    timestamp?: string;
    metadata: {
        frameId?: number;
        isIframe: boolean;
    };
}

export function createExtractionInputsFromFragments(
    htmlFragments: any[],
    url: string,
    title: string,
    source: BrowserDocumentExtractionInput["source"],
    timestamp?: string,
): BrowserDocumentExtractionInput[] {
    return htmlFragments
        .map((fragment, index) => {
            const frameId = fragment.frameId ?? index;
            const textContent =
                typeof fragment.content === "string" &&
                fragment.content.trim().length > 0
                    ? convert(fragment.content, {
                          wordwrap: false,
                          selectors: [
                              {
                                  selector: "script",
                                  format: "skip",
                              },
                              {
                                  selector: "style",
                                  format: "skip",
                              },
                          ],
                      }).trim()
                    : typeof fragment.text === "string"
                      ? fragment.text.trim()
                      : "";
            const input: BrowserDocumentExtractionInput = {
                url: `${url}#iframe-${frameId}`,
                title: `${title} (Frame ${frameId})`,
                htmlFragments: [fragment],
                textContent,
                source,
                metadata: {
                    frameId,
                    isIframe: frameId !== 0,
                },
            };
            if (timestamp !== undefined) {
                input.timestamp = timestamp;
            }
            return input;
        })
        .filter((input) => input.textContent.length > 50);
}

export function aggregateExtractionResults(results: any[]): {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    suggestedQuestions: string[];
    summary: string;
    contentMetrics: { readingTime: number; wordCount: number };
} {
    const entities = results.flatMap(
        (result) => result.entities ?? result.knowledge?.entities ?? [],
    );
    const relationships = results.flatMap(
        (result) =>
            result.relationships ?? result.knowledge?.relationships ?? [],
    );
    const keyTopics = results.flatMap(
        (result) =>
            result.keyTopics ??
            result.topics ??
            result.knowledge?.keyTopics ??
            [],
    );
    const wordCount = results.reduce(
        (total, result) =>
            total + (result.contentMetrics?.wordCount ?? result.wordCount ?? 0),
        0,
    );
    return {
        entities,
        relationships,
        keyTopics,
        suggestedQuestions: [],
        summary: "",
        contentMetrics: {
            wordCount,
            readingTime: Math.ceil(wordCount / 200),
        },
    };
}

function mapSourceKnowledge(
    title: string,
    markdown: string,
    knowledge: BrowserSourceKnowledge,
): EnhancedKnowledgeExtractionResult {
    const wordCount = markdown.split(/\s+/).filter(Boolean).length;
    return {
        title,
        entities: knowledge.entities.map((entity) => ({
            name: entity.name,
            type: entity.types.join(", ") || "entity",
            confidence: 1,
            occurrenceCount: entity.mentionCount,
        })),
        relationships: knowledge.relationships.map((relationship) => ({
            from: relationship.fromEntity,
            relationship: relationship.relationshipType,
            to: relationship.toEntity,
            confidence: 1,
        })),
        keyTopics: knowledge.topics.map((topic) => topic.name),
        suggestedQuestions: [],
        summary: `Indexed ${title} in durable memory.`,
        contentMetrics: {
            wordCount,
            readingTime: Math.ceil(wordCount / 200),
        },
    };
}

function normalizePageDocument(
    htmlFragments: any[],
    url: string,
    title: string,
): string {
    const inputs = createExtractionInputsFromFragments(
        htmlFragments,
        url,
        title,
        "direct",
    );
    if (inputs.length === 0) {
        throw new Error("The page did not contain enough text to index");
    }
    return inputs
        .map((input) => `## ${input.title}\n\n${input.textContent}`)
        .join("\n\n");
}

function emitProgress(
    extractionId: string,
    url: string,
    phase: KnowledgeExtractionProgressEvent["phase"],
    percentage: number,
    currentItem: string,
    knowledge?: EnhancedKnowledgeExtractionResult,
    error?: unknown,
): void {
    knowledgeProgressEvents.emitProgress({
        extractionId,
        phase,
        totalItems: 100,
        processedItems: percentage,
        currentItem,
        errors:
            error === undefined
                ? []
                : [
                      {
                          message:
                              error instanceof Error
                                  ? error.message
                                  : String(error),
                          timestamp: Date.now(),
                      },
                  ],
        incrementalData:
            knowledge === undefined
                ? undefined
                : {
                      entities: knowledge.entities,
                      keyTopics: knowledge.keyTopics,
                      relationships: knowledge.relationships,
                  },
        timestamp: Date.now(),
        url,
        source: "navigation",
    });
}

export async function extractKnowledgeFromPage(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<EnhancedKnowledgeExtractionResult> {
    return extractKnowledgeFromPageStreaming(parameters, context);
}

export async function extractKnowledgeFromPageStreaming(
    parameters: any,
    context: SessionContext<BrowserActionContext>,
): Promise<EnhancedKnowledgeExtractionResult> {
    const { url, title = url, htmlFragments, extractionId } = parameters;
    const memoryService = context.agentContext.browserMemoryService;
    if (memoryService === undefined) {
        throw new Error("Durable browser memory is not available");
    }
    if (!Array.isArray(htmlFragments)) {
        throw new Error(
            "Page HTML fragments are required for memory ingestion",
        );
    }

    const id = extractionId ?? `extraction-${Date.now()}`;
    try {
        emitProgress(id, url, "content", 5, "Normalizing page content");
        const markdown = normalizePageDocument(htmlFragments, url, title);
        const ingestionMode =
            parameters.mode === "basic"
                ? "basic"
                : parameters.mode === "full"
                  ? "full"
                  : "content";
        const knowledge = await memoryService.ingest(
            {
                url,
                title,
                markdown,
                ...(parameters.timestamp === undefined
                    ? {}
                    : { capturedAt: parameters.timestamp }),
            },
            ingestionMode,
            {
                ...(parameters.signal === undefined
                    ? {}
                    : { signal: parameters.signal }),
                onProgress: (progress) => {
                    const percentage = Math.min(
                        95,
                        Math.max(10, progress.percentage ?? 10),
                    );
                    emitProgress(
                        id,
                        url,
                        "extracting",
                        percentage,
                        progress.message,
                    );
                },
            },
        );
        const result = mapSourceKnowledge(title, markdown, knowledge);
        emitProgress(id, url, "complete", 100, "Memory indexed", result);
        updateExtractionTimestamp(url);
        return result;
    } catch (error) {
        emitProgress(
            id,
            url,
            "error",
            100,
            "Memory ingestion failed",
            undefined,
            error,
        );
        throw error;
    }
}

async function handleKnowledgeExtractionProgressFromEvent(
    progress: KnowledgeExtractionProgressEvent,
    activeExtraction: ActiveKnowledgeExtraction,
): Promise<void> {
    if (progress.incrementalData) {
        activeExtraction.aggregatedKnowledge.entities =
            progress.incrementalData.entities ?? [];
        activeExtraction.aggregatedKnowledge.topics =
            progress.incrementalData.keyTopics ?? [];
        activeExtraction.aggregatedKnowledge.relationships =
            progress.incrementalData.relationships ?? [];
    }
    updateExtractionProgressState(activeExtraction, progress);
    activeExtraction.lastUpdateTime = Date.now();
}

export async function performKnowledgeExtraction(
    url: string,
    context: ActionContext<BrowserActionContext>,
    extractionMode: string,
): Promise<any | null> {
    const browserControl = getActionBrowserControl(context);
    const htmlFragments =
        await context.sessionContext.agentContext.browserControl?.getHtmlFragments(
            false,
            "knowledgeExtraction",
        );
    if (!htmlFragments) {
        return null;
    }

    const title = await browserControl.getPageUrl();
    const extractionId = `navigation-${Date.now()}`;
    const controller = new AbortController();
    extractionControllers.set(extractionId, controller);
    const dynamicDisplayId = `knowledge-extraction-${extractionId}`;
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
    knowledgeProgressEvents.onProgressById(extractionId, (progress) =>
        handleKnowledgeExtractionProgressFromEvent(progress, activeExtraction),
    );

    handleKnowledgeAction(
        "extractKnowledgeFromPageStreaming",
        {
            url,
            title,
            mode: extractionMode,
            extractionId,
            htmlFragments,
            signal: controller.signal,
        },
        context.sessionContext,
    )
        .catch((error) => {
            debug("Durable memory ingestion failed", error);
        })
        .finally(() => {
            knowledgeProgressEvents.removeProgressListener(extractionId);
            extractionControllers.delete(extractionId);
            setTimeout(
                () => activeKnowledgeExtractions.delete(extractionId),
                30_000,
            );
        });

    return {
        extractionId,
        dynamicDisplayId,
        dynamicDisplayNextRefreshMs: 1500,
        knowledge: null,
    };
}

export async function performKnowledgeExtractionWithNotifications(
    url: string,
    sessionContext: SessionContext<BrowserActionContext>,
    extractionMode: string,
    parameters: any,
): Promise<void> {
    const knowledge = await extractKnowledgeFromPageStreaming(
        {
            ...parameters,
            url,
            mode: extractionMode,
        },
        sessionContext,
    );
    const cards = generateDetailedKnowledgeCards({
        entities: knowledge.entities,
        topics: knowledge.keyTopics,
        relationships: knowledge.relationships,
    });
    sessionContext.notify(AppAgentEvent.Inline, {
        type: "markdown",
        content: `> **Memory indexed**
>
> ${knowledge.entities.length} entities, ${knowledge.keyTopics.length} topics, and ${knowledge.relationships.length} relationships

${cards}`,
    });
}

async function checkKnowledgeInIndex(
    url: string,
    context: ActionContext<BrowserActionContext> | any,
): Promise<any | null> {
    const sessionContext =
        "sessionContext" in context ? context.sessionContext : context;
    const result = await handleKnowledgeAction(
        "getPageIndexedKnowledge",
        { url },
        sessionContext,
    );
    return result.isIndexed ? result.knowledge : null;
}

async function saveKnowledgeToIndex(
    url: string,
    _knowledge: any,
    context: ActionContext<BrowserActionContext> | any,
): Promise<void> {
    const existing = await checkKnowledgeInIndex(url, context);
    if (existing === null) {
        throw new Error(
            "Cannot index generated knowledge without the original page content",
        );
    }
}

export async function shouldRunKnowledgeExtraction(
    url: string,
    context: ActionContext<BrowserActionContext>,
): Promise<boolean> {
    const memoryService =
        context.sessionContext.agentContext.browserMemoryService;
    if (memoryService === undefined) {
        return false;
    }
    const capabilities = await memoryService.getCapabilities();
    if (!capabilities.features.knowledgeExtraction) {
        return false;
    }
    return (await memoryService.getSource(url)) === undefined;
}

export { checkKnowledgeInIndex, saveKnowledgeToIndex };

export function getActiveKnowledgeExtraction(
    extractionId: string,
): ActiveKnowledgeExtraction | undefined {
    return activeKnowledgeExtractions.get(extractionId);
}

export function deleteActiveKnowledgeExtraction(extractionId: string): void {
    extractionControllers
        .get(extractionId)
        ?.abort(new Error("Knowledge extraction cancelled"));
    extractionControllers.delete(extractionId);
    activeKnowledgeExtractions.delete(extractionId);
}
