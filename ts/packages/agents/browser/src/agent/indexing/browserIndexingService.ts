// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { fileURLToPath } from "node:url";
import registerDebug from "debug";

import { 
    importWebsites, 
    Website, 
    WebsiteCollection
} from "website-memory";

import { IndexingKnowledgeExtractor } from "./indexingKnowledgeExtractor.mjs";

const debug = registerDebug("typeagent:browserIndexingService");

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
        debug(`Starting indexing for: ${indexData.name} (${indexData.sourceType} from ${indexData.browserType})`);

        try {
            // Load existing collection first (maintains existing behavior)
            const websites = await this.loadExistingCollection();
            
            // Import bookmarks/history using browser agent processing
            const importedWebsites = await this.importWithBrowserAgent(
                indexData.browserType || "chrome",
                indexData.sourceType || "bookmarks", 
                indexData.location
            );
            
            // Filter websites that already exist in the collection
            const existingUrls = new Set(websites.getWebsites().map(w => w.metadata.url));
            const newWebsites = importedWebsites.filter(w => !existingUrls.has(w.metadata.url));
            
            if (newWebsites.length === 0) {
                debug("No new websites to index");
                this.index.state = "finished";
                this.index.progress = 100;
                this.sendIndexStatus();
                return;
            }
            
            debug(`Processing ${newWebsites.length} new websites with enhanced knowledge extraction`);
            
            // Process with enhanced knowledge extraction
            await this.processWebsitesWithKnowledge(newWebsites);
            
            // Add new websites to collection using incremental method
            await this.addWebsitesIncremental(websites, newWebsites);
            
            // Build and save index
            await this.buildAndSaveIndex(websites);
            
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
            const websites = await WebsiteCollection.readFromFile(this.index!.path, "index");
            if (websites && websites.messages.length > 0) {
                debug(`Loaded existing collection with ${websites.messages.length} websites`);
                return websites;
            } else {
                debug("No existing collection found or empty, creating new one");
                return new WebsiteCollection();
            }
        } catch (error) {
            debug(`Failed to load existing collection: ${error}. Creating new collection.`);
            return new WebsiteCollection();
        }
    }

    /**
     * Import websites using browser agent infrastructure
     */
    private async importWithBrowserAgent(
        browserType: string,
        sourceType: string,
        location: string
    ): Promise<Website[]> {
        debug(`Importing ${sourceType} from ${browserType} at ${location}`);
        
        return await importWebsites(
            browserType as "chrome" | "edge",
            sourceType as "bookmarks" | "history",
            location,
            { 
                limit: 10000,
                // Standard content extractor - enhanced processing happens later
            },
            this.indexingProgress.bind(this)
        );
    }

    /**
     * Add websites incrementally to the collection
     */
    private async addWebsitesIncremental(
        websiteCollection: WebsiteCollection,
        newWebsites: Website[]
    ): Promise<void> {
        for (const website of newWebsites) {
            try {
                const { WebsiteDocPart } = await import("website-memory");
                const docPart = WebsiteDocPart.fromWebsite(website);
                await websiteCollection.addWebsiteToIndex(docPart);
            } catch (error) {
                debug(`Error adding website incrementally: ${error}, falling back to batch add`);
                websiteCollection.addWebsites([website]);
            }
        }
    }

    /**
     * Process websites with enhanced knowledge extraction
     */
    private async processWebsitesWithKnowledge(websites: Website[]): Promise<void> {
        debug(`Starting enhanced knowledge processing for ${websites.length} websites`);
        
        let enhancedCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < websites.length; i++) {
            const website = websites[i];
            
            try {
                // Determine extraction mode based on URL
                const extractionMode = this.knowledgeExtractor.getExtractionModeForUrl(website.metadata.url);
                
                debug(`Processing ${website.metadata.url} with ${extractionMode} mode`);
                
                // Enhanced knowledge extraction for each website with context information
                // Includes URL, title, and bookmark folder hierarchy for better AI analysis
                const result = await this.knowledgeExtractor.extractKnowledge({
                    url: website.metadata.url,
                    title: website.metadata.title || "",
                    textContent: website.textChunks?.join('\n') || website.metadata.description || "",
                    source: "import" as const,
                    timestamp: new Date().toISOString(),
                    // Add folder information for context enhancement
                    folder: website.metadata.folder,
                } as any, extractionMode);
                
                if (result.success) {
                    // Update website with extracted knowledge
                    if (result.knowledge) {
                        website.knowledge = result.knowledge;
                        enhancedCount++;
                    }
                    
                    // Add processing metadata (store as additional properties - not ideal but works)
                    (website.metadata as any).extractionMode = extractionMode;
                    (website.metadata as any).processingTime = result.processingTime;
                    (website.metadata as any).aiProcessingUsed = result.aiProcessingUsed;
                    
                    // Add quality metrics if available
                    if (result.qualityMetrics) {
                        (website.metadata as any).qualityScore = this.calculateQualityScore(result.qualityMetrics);
                    }
                    
                    // Add summary data if enhanced with summarization
                    if ((result as any).summaryData) {
                        (website as any).summaryData = (result as any).summaryData;
                        (website.metadata as any).enhancedWithSummary = true;
                    }
                    
                    debug(`Successfully processed ${website.metadata.url} (AI: ${result.aiProcessingUsed})`);
                } else {
                    debug(`Failed to process ${website.metadata.url}: ${result.error}`);
                    errorCount++;
                }
                
            } catch (error) {
                debug(`Error processing ${website.metadata.url}:`, error);
                errorCount++;
            }
            
            // Report progress
            this.indexingProgress(i + 1, websites.length, website.metadata.title || website.metadata.url);
        }
        
        debug(`Enhanced processing complete: ${enhancedCount} enhanced, ${errorCount} errors`);
    }

    /**
     * Calculate overall quality score from extraction metrics
     */
    private calculateQualityScore(metrics: any): number {
        // Combine multiple factors into overall quality score (0-1)
        const factors = [
            Math.min(metrics.confidence || 0, 1),
            Math.min((metrics.entityCount || 0) / 10, 1), // Normalize entity count
            Math.min((metrics.topicCount || 0) / 5, 1),   // Normalize topic count
            metrics.aiProcessingTime ? 0.2 : 0,          // Bonus for AI processing
        ];
        
        return factors.reduce((sum, factor) => sum + factor, 0) / factors.length;
    }

    /**
     * Build and save the search index
     */
    private async buildAndSaveIndex(websites: WebsiteCollection): Promise<void> {
        debug("Building search index...");
        
        try {
            // Build the index using the collection's built-in method
            await websites.addToIndex();
            
            debug(`Index built successfully`);
            
            // Save the index to disk
            await websites.writeToFile(this.index!.path, "index");
            debug(`Index saved to ${this.index!.path}`);
            
        } catch (error) {
            debug("Error building index:", error);
            throw error;
        }
    }

    /**
     * Report indexing progress
     */
    private indexingProgress(current: number, total: number, itemName: string): void {
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
                    error: error instanceof Error ? error.message : "Unknown error"
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

    debug("Browser indexing service started successfully and waiting for instructions");
}
