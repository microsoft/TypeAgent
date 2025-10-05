// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
import registerDebug from "debug";

import { importWebsites, Website, WebsiteCollection } from "website-memory";

import { IndexingKnowledgeExtractor } from "./indexingKnowledgeExtractor.mjs";

const debug = registerDebug("typeagent:browser:IndexingService");

// Types from website-memory (re-exported for clarity)
export type IndexSource = "website" | "image" | "email";

export type IndexData = {
    source: IndexSource;
    name: string;
    location: string;
    size: number;
    path: string;
    state: "new" | "indexing" | "finished" | "stopped" | "idle" | "error";
    progress: number;
    sizeOnDisk: number;
    sourceType?: "bookmarks" | "history";
    browserType?: "chrome" | "edge";
};

/**
 * Browser Agent Indexing Service
 * Runs as separate process, uses browser agent knowledge processing infrastructure
 * Provides AI-enhanced indexing with content summarization and quality assessment
 */
export class BrowserIndexingService {
    private knowledgeExtractor: IndexingKnowledgeExtractor;
    private index: IndexData | undefined = undefined;

    constructor() {
        this.knowledgeExtractor = new IndexingKnowledgeExtractor();
    }

    /**
     * Initialize the service with AI models and adapters
     */
    async initialize(): Promise<void> {
        debug("Initializing browser indexing service...");

        try {
            await this.knowledgeExtractor.initialize();
            debug("Knowledge extractor initialized");

            debug("Browser indexing service ready");
            debug("Capabilities:", this.knowledgeExtractor.getCapabilities());
        } catch (error) {
            debug("Initialization error:", error);
            throw error;
        }
    }

    /**
     * Start indexing process with provided index data
     */
    async startIndexing(indexData: IndexData): Promise<void> {
        this.index = indexData;
        debug(
            `Starting indexing for: ${indexData.name} (${indexData.sourceType} from ${indexData.browserType})`,
        );

        try {
            // Load existing collection first (maintains existing behavior)
            const websites = await this.loadExistingCollection();

            // Import bookmarks/history using browser agent processing
            const importedWebsites = await this.importWithBrowserAgent(
                indexData.browserType || "chrome",
                indexData.sourceType || "bookmarks",
                indexData.location,
            );

            // Filter websites that already exist in the collection
            const existingUrls = new Set(
                websites.getWebsites().map((w) => w.metadata.url),
            );
            const newWebsites = importedWebsites.filter(
                (w) => !existingUrls.has(w.metadata.url),
            );

            if (newWebsites.length === 0) {
                debug("No new websites to index");
                this.index.state = "finished";
                this.index.progress = 100;
                this.sendIndexStatus();
                return;
            }

            debug(
                `📝 PROCESSING ${newWebsites.length} websites incrementally with enhanced knowledge extraction`,
            );

            // Process websites incrementally - process, add to collection, and index each one
            await this.processWebsitesIncrementally(websites, newWebsites);

            // Final save of the index
            await this.saveIndexToDisk(websites);

            this.index.state = "finished";
            this.index.progress = 100;
            this.index.size = websites.getWebsites().length;
            this.sendIndexStatus();

            debug("Enhanced indexing completed successfully");
        } catch (error) {
            debug("Indexing failed:", error);
            this.index.state = "error";
            this.sendIndexStatus();
        }
    }

    /**
     * Load existing website collection from the index path
     */
    private async loadExistingCollection(): Promise<WebsiteCollection> {
        try {
            const websites = await WebsiteCollection.readFromFile(
                this.index!.path,
                "index",
            );
            if (websites && websites.messages.length > 0) {
                debug(
                    `Loaded existing collection with ${websites.messages.length} websites`,
                );
                return websites;
            } else {
                debug(
                    "No existing collection found or empty, creating new one",
                );
                return new WebsiteCollection();
            }
        } catch (error) {
            debug(
                `Failed to load existing collection: ${error}. Creating new collection.`,
            );
            return new WebsiteCollection();
        }
    }

    /**
     * Import websites using browser agent infrastructure
     */
    private async importWithBrowserAgent(
        browserType: string,
        sourceType: string,
        location: string,
    ): Promise<Website[]> {
        debug(`Importing ${sourceType} from ${browserType} at ${location}`);

        // Resolve browser file path - needed when location is not a direct file path
        let resolvedLocation = location;
        if (
            location === "browser-agent" ||
            location === "default" ||
            !location.includes(path.sep)
        ) {
            const { getDefaultBrowserPaths } = await import("website-memory");
            const defaultPaths = getDefaultBrowserPaths();

            if (browserType === "chrome") {
                resolvedLocation =
                    sourceType === "bookmarks"
                        ? defaultPaths.chrome.bookmarks
                        : defaultPaths.chrome.history;
            } else if (browserType === "edge") {
                resolvedLocation =
                    sourceType === "bookmarks"
                        ? defaultPaths.edge.bookmarks
                        : defaultPaths.edge.history;
            }

            debug(
                `Resolved location from '${location}' to '${resolvedLocation}'`,
            );
        }

        return await importWebsites(
            browserType as "chrome" | "edge",
            sourceType as "bookmarks" | "history",
            resolvedLocation,
            {
                limit: 10000,
                // Standard content extractor - enhanced processing happens later
            },
            this.indexingProgress.bind(this),
        );
    }

    /**
     * Calculate overall quality score from extraction metrics
     */
    private calculateQualityScore(metrics: any): number {
        // Combine multiple factors into overall quality score (0-1)
        const factors = [
            Math.min(metrics.confidence || 0, 1),
            Math.min((metrics.entityCount || 0) / 10, 1), // Normalize entity count
            Math.min((metrics.topicCount || 0) / 5, 1), // Normalize topic count
            metrics.aiProcessingTime ? 0.2 : 0, // Bonus for AI processing
        ];

        return (
            factors.reduce((sum, factor) => sum + factor, 0) / factors.length
        );
    }

    /**
     * Process websites incrementally - for each website: process, add to collection, and index
     * This follows the pattern from websiteMemory.mts line 739
     */
    private async processWebsitesIncrementally(
        websiteCollection: WebsiteCollection,
        newWebsites: Website[],
    ): Promise<void> {
        debug(
            `INCREMENTAL PROCESSING: Starting processing of ${newWebsites.length} websites`,
        );

        for (let i = 0; i < newWebsites.length; i++) {
            const website = newWebsites[i];

            try {
                debug(
                    `📄 PROCESSING WEBSITE ${i + 1}/${newWebsites.length}: ${website.metadata.title || website.metadata.url}`,
                );

                // Step 1: Enhanced knowledge extraction for this website
                await this.processWebsiteWithKnowledge(
                    website,
                    i + 1,
                    newWebsites.length,
                );

                // Step 2: Add to collection
                websiteCollection.addWebsites([website]); // Add to collection

                // Step 3: Incrementally add to search index
                try {
                    await websiteCollection.addToIndex();
                } catch (indexError) {
                    debug(
                        `⚠️  INCREMENTAL INDEX FAILED: Falling back to full rebuild: ${indexError}`,
                    );
                    await websiteCollection.buildIndex();
                }

                // Update progress
                this.indexingProgress(
                    i + 1,
                    newWebsites.length,
                    website.metadata.title || website.metadata.url,
                );

                // Periodic save every 10 websites to preserve progress
                if ((i + 1) % 10 === 0) {
                    debug(
                        `💾 PERIODIC SAVE: Saving progress after ${i + 1} websites`,
                    );
                    await this.saveIndexToDisk(websiteCollection);
                }
            } catch (error) {
                debug(
                    `❌ FAILED TO PROCESS: ${website.metadata.title || website.metadata.url}: ${error}`,
                );
                // Continue with next website rather than failing entire batch
            }
        }

        debug(
            `✅ INCREMENTAL PROCESSING COMPLETE: Successfully processed ${newWebsites.length} websites`,
        );
    }

    /**
     * Process a single website with enhanced knowledge extraction
     */
    private async processWebsiteWithKnowledge(
        website: Website,
        current: number,
        total: number,
    ): Promise<void> {
        try {
            // Determine extraction mode based on URL
            const extractionMode =
                this.knowledgeExtractor.getExtractionModeForUrl(
                    website.metadata.url,
                );

            debug(
                `Processing ${website.metadata.url} with ${extractionMode} mode`,
            );

            // Enhanced knowledge extraction with context information
            const result = await this.knowledgeExtractor.extractKnowledge(
                {
                    url: website.metadata.url,
                    title: website.metadata.title || "",
                    textContent:
                        website.textChunks?.join("\n") ||
                        website.metadata.description ||
                        "",
                    source: "import" as const,
                    timestamp: new Date().toISOString(),
                    folder: website.metadata.folder,
                } as any,
                extractionMode,
            );

            // Update website with extracted knowledge
            if (result.knowledge) {
                website.knowledge = result.knowledge;

                // Extract and assign topicHierarchy if present
                const topicHierarchy = (result.knowledge as any)?.topicHierarchy;
                if (topicHierarchy) {
                    (website as any).topicHierarchy = topicHierarchy;
                    debug(`Extracted topic hierarchy with ${topicHierarchy.totalTopics} topics for ${website.metadata.url}`);
                }
            }

            // Add processing metadata
            (website.metadata as any).extractionMode = extractionMode;
            (website.metadata as any).processingTime = result.processingTime;
            (website.metadata as any).aiProcessingUsed =
                result.aiProcessingUsed;

            // Add quality metrics if available
            if (result.qualityMetrics) {
                (website.metadata as any).qualityScore =
                    this.calculateQualityScore(result.qualityMetrics);
            }

            // Add summary data if enhanced with summarization
            if ((result as any).summaryData) {
                (website as any).summaryData = (result as any).summaryData;
                (website.metadata as any).enhancedWithSummary = true;
            }

            debug(
                `Successfully processed ${website.metadata.url} (AI: ${result.aiProcessingUsed})`,
            );
        } catch (error) {
            debug(
                `❌ KNOWLEDGE EXTRACTION ERROR: ${website.metadata.url}:`,
                error,
            );
        }
    }

    /**
     * Save the index to disk
     */
    private async saveIndexToDisk(websites: WebsiteCollection): Promise<void> {
        try {
            // Ensure index directory exists before writing
            const { ensureDir } = await import("typeagent");
            await ensureDir(this.index!.path);

            // Save the index to disk
            await websites.writeToFile(this.index!.path, "index");
            debug(`Index saved to ${this.index!.path}`);
        } catch (error) {
            debug("Error saving index to disk:", error);
            throw error;
        }
    }

    /**
     * Report indexing progress
     */
    private indexingProgress(
        current: number,
        total: number,
        itemName: string,
    ): void {
        if (!this.index) return;

        this.index.progress = current;
        this.index.size = current;
        this.index.state = "indexing";

        debug(`Progress: ${current}/${total} - ${itemName}`);

        // Send progress to parent process (every 10 items or at completion)
        if (current % 10 === 0 || current === total) {
            this.sendIndexStatus();
        }
    }

    /**
     * Send index status to parent process
     */
    private sendIndexStatus(): void {
        process.send?.(this.index);
    }
}

// Process entry point for separate process execution
if (
    process.argv.filter((value: string) => {
        const thisFile = fileURLToPath(import.meta.url);
        return path.basename(value) === path.basename(thisFile);
    }).length > 0
) {
    const service = new BrowserIndexingService();

    /**
     * Indicate to the host/parent process that we've started successfully
     */
    process.send?.("Success");

    /**
     * Process messages received from the host/parent process
     */
    process.on("message", async (message: any) => {
        debug("Received message from parent:", message);

        if (message !== undefined) {
            try {
                // Initialize service
                await service.initialize();

                // Start indexing with provided data
                await service.startIndexing(message as IndexData);
            } catch (error) {
                debug("Error in message handling:", error);
                process.send?.({
                    ...message,
                    state: "error",
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                });
            }
        }
    });

    /**
     * Closes this process at the request of the host/parent process
     */
    process.on("disconnect", () => {
        debug("Parent process disconnected, exiting");
        process.exit(1);
    });

    debug(
        "Browser indexing service started successfully and waiting for instructions",
    );
}
