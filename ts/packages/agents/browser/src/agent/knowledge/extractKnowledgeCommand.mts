// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import {
    displayError,
    displayStatus,
} from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerNoParams } from "@typeagent/agent-sdk/helpers/command";
import registerDebug from "debug";

import {
    BrowserActionContext,
    getActionBrowserControl,
} from "../browserActions.mjs";
import { handleKnowledgeAction } from "./actions/knowledgeActionRouter.mjs";
import {
    knowledgeProgressEvents,
    KnowledgeExtractionProgressEvent,
} from "./progress/knowledgeProgressEvents.mjs";
import {
    generateDetailedKnowledgeCards,
    updateExtractionProgressState,
    ActiveKnowledgeExtraction,
} from "./ui/knowledgeCardRenderer.mjs";
import { actionContextCache } from "./cache/actionContextCache.mjs";
import {
    runningExtractionsCache,
    waitForExtractionCompletion,
} from "./cache/extractionCache.mjs";

const debug = registerDebug("typeagent:browser:action");

// Knowledge extraction progress tracking
const activeKnowledgeExtractions = new Map<string, ActiveKnowledgeExtraction>();

// Utility functions
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

async function checkKnowledgeInIndex(
    url: string,
    context: ActionContext<BrowserActionContext> | any,
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
    context: ActionContext<BrowserActionContext> | any,
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

async function performKnowledgeExtraction(
    url: string,
    context: ActionContext<BrowserActionContext>,
    extractionMode: string,
): Promise<any | null> {
    try {
        const browserControl = getActionBrowserControl(context);

        // Get page contents
        let title = "Unknown Page";
        const htmlFragments =
            await context.sessionContext.agentContext.browserConnector?.getHtmlFragments();
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

export class ExtractKnowledgeHandler implements CommandHandlerNoParams {
    public readonly description = "Extract knowledge from the current web page";

    public async run(
        context: ActionContext<BrowserActionContext>,
    ): Promise<void> {
        try {
            const browserControl = getActionBrowserControl(context);
            const currentUrl = await browserControl.getPageUrl();

            if (!currentUrl) {
                displayError(
                    "No active page found. Please open a web page first.",
                    context,
                );
                return;
            }

            let url: URL;
            try {
                url = new URL(currentUrl);
                if (url.protocol !== "http:" && url.protocol !== "https:") {
                    displayError(
                        `Cannot extract knowledge from ${url.protocol} pages`,
                        context,
                    );
                    return;
                }
            } catch (error) {
                displayError(`Invalid URL: ${currentUrl}`, context);
                return;
            }

            const dynamicDisplayId = `knowledge-extraction-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            // Cache the action context with dynamic display ID
            actionContextCache.set(
                currentUrl,
                context,
                undefined,
                dynamicDisplayId,
            );

            // Display initial status message
            displayStatus(
                `Extracting knowledge from ${currentUrl}...`,
                context,
            );

            // Check for existing knowledge and display it first
            const existingKnowledge = await checkKnowledgeInIndex(
                currentUrl,
                context,
            );
            if (existingKnowledge) {
                const entitiesCount = existingKnowledge.entities?.length || 0;
                const topicsCount = existingKnowledge.topics?.length || 0;
                const relationshipsCount =
                    existingKnowledge.relationships?.length || 0;

                // Display existing knowledge with detailed cards
                const knowledgeHtml =
                    generateDetailedKnowledgeCards(existingKnowledge);
                context.actionIO.appendDisplay(
                    {
                        type: "html",
                        content: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #d1ecf1; border-left: 4px solid #17a2b8; border-radius: 4px;">
                            <div style="font-weight: 600; color: #0c5460;">📖 Existing Knowledge Found</div>
                            <div style="font-size: 13px; color: #0c5460; margin-top: 4px;">
                                Found ${entitiesCount} entities, ${topicsCount} topics, and ${relationshipsCount} relationships from previous extraction
                            </div>
                        </div>
                        ${knowledgeHtml}
                        `,
                    },
                    "block",
                );

                return;
            }

            // Start knowledge extraction with proper async handling to keep context alive
            // Wait for the page to stabilize before starting extraction
            await new Promise((resolve) => setTimeout(resolve, 1000));

            try {
                let completionResult;
                // Check if extraction is already running (dedupe)
                if (runningExtractionsCache.isRunning(currentUrl)) {
                    debug(
                        `Extraction already running for ${currentUrl}, waiting for completion`,
                    );

                    const runningExtraction =
                        runningExtractionsCache.getRunning(currentUrl);
                    completionResult = await waitForExtractionCompletion(
                        runningExtraction!.extractionId,
                        120000,
                        context,
                        activeKnowledgeExtractions,
                    );
                } else {
                    const extractionResult = await performKnowledgeExtraction(
                        currentUrl,
                        context,
                        "content",
                    );

                    if (extractionResult && extractionResult.extractionId) {
                        // Wait for the actual extraction to complete
                        completionResult = await waitForExtractionCompletion(
                            extractionResult.extractionId,
                            120000,
                            context,
                            activeKnowledgeExtractions,
                        );
                    }
                }
                if (completionResult) {
                    if (completionResult.success) {
                        try {
                            await saveKnowledgeToIndex(
                                currentUrl,
                                completionResult.knowledge,
                                context,
                            );
                        } catch (saveError) {
                            console.error(
                                "Failed to save knowledge to index:",
                                saveError,
                            );
                        }

                        // Extraction completed successfully
                        const latestKnowledge = completionResult.knowledge;

                        if (latestKnowledge) {
                            const entitiesCount =
                                latestKnowledge.entities?.length || 0;
                            const topicsCount =
                                latestKnowledge.topics?.length || 0;
                            const relationshipsCount =
                                latestKnowledge.relationships?.length || 0;

                            // Generate detailed knowledge cards for the extracted knowledge
                            const knowledgeHtml =
                                generateDetailedKnowledgeCards(latestKnowledge);

                            const headerText = existingKnowledge
                                ? "✅ Knowledge Re-extraction Complete"
                                : "✅ Knowledge Extraction Complete";
                            const subText = existingKnowledge
                                ? "Knowledge has been refreshed with the latest content from the page"
                                : "Successfully extracted and indexed knowledge from the page";

                            context.actionIO.setDisplay({
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
                            });
                        } else {
                            // Fallback if no knowledge was found after extraction
                            context.actionIO.appendDisplay(
                                {
                                    type: "html",
                                    content: `
                                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #fff3cd; border-left: 4px solid #856404; border-radius: 4px;">
                                        <div style="font-weight: 600; color: #856404;">⚠️ Extraction Complete - No Knowledge Found</div>
                                        <div style="font-size: 13px; color: #856404; margin-top: 4px;">
                                            The page was processed but no significant knowledge was extracted
                                        </div>
                                    </div>
                                    `,
                                },
                                "block",
                            );
                        }
                    } else {
                        // Extraction failed or timed out
                        context.actionIO.appendDisplay(
                            {
                                type: "html",
                                content: `
                                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #f8d7da; border-left: 4px solid #dc3545; border-radius: 4px;">
                                    <div style="font-weight: 600; color: #721c24;">⚠️ Knowledge Extraction Failed</div>
                                    <div style="font-size: 13px; color: #721c24; margin-top: 4px;">
                                        ${completionResult.error || "Unknown error occurred during extraction"}
                                    </div>
                                </div>
                                `,
                            },
                            "block",
                        );
                    }
                } else {
                    // performKnowledgeExtraction itself failed
                    context.actionIO.appendDisplay(
                        {
                            type: "html",
                            content: `
                            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #f8d7da; border-left: 4px solid #dc3545; border-radius: 4px;">
                                <div style="font-weight: 600; color: #721c24;">⚠️ Knowledge Extraction Failed</div>
                                <div style="font-size: 13px; color: #721c24; margin-top: 4px;">
                                    Failed to initialize knowledge extraction
                                </div>
                            </div>
                            `,
                        },
                        "block",
                    );
                }
            } catch (extractionError) {
                console.error(
                    "Knowledge extraction failed in extractKnowledge:",
                    extractionError,
                );
                context.actionIO.appendDisplay(
                    {
                        type: "html",
                        content: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 8px 0; padding: 12px; background: #f8d7da; border-left: 4px solid #dc3545; border-radius: 4px;">
                            <div style="font-weight: 600; color: #721c24;">⚠️ Knowledge Extraction Failed</div>
                            <div style="font-size: 13px; color: #721c24; margin-top: 4px;">
                                ${extractionError instanceof Error ? extractionError.message : "Unknown error occurred"}
                            </div>
                        </div>
                        `,
                    },
                    "block",
                );
            }
        } catch (error) {
            console.error("Manual knowledge extraction command failed:", error);
            displayError(
                `Failed to extract knowledge: ${error instanceof Error ? error.message : "Unknown error"}`,
                context,
            );
        }
    }
}
