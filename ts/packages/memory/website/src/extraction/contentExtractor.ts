// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    conversation as kpLib,
    splitLargeTextIntoChunks,
} from "knowledge-processor";
import { HtmlFetcher } from "../htmlFetcher.js";
import {
    ExtractionMode,
    ExtractionConfig,
    ExtractionInput,
    ExtractionResult,
    ExtractionOptions,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
    AIModelRequiredError,
    AIExtractionFailedError,
    ChunkProgressInfo,
    EntityFacet,
    TopicCorrelation,
} from "./types.js";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:indexing");

export class ContentExtractor {
    private knowledgeExtractor?: kpLib.KnowledgeExtractor;
    private extractionConfig?: ExtractionConfig;
    private htmlFetcher: HtmlFetcher;

    constructor(
        inputConfig?: ExtractionConfig & {
            knowledgeExtractor?: kpLib.KnowledgeExtractor;
        },
    ) {
        // Initialize HTML fetcher
        this.htmlFetcher = new HtmlFetcher();
        if (inputConfig?.knowledgeExtractor) {
            this.knowledgeExtractor = inputConfig.knowledgeExtractor;
        }

        if (inputConfig && inputConfig?.mode) {
            // Create a clean config object with only defined values
            const cleanConfig: ExtractionConfig = {
                mode: inputConfig.mode,
            };

            // Only add optional properties if they have values
            if (inputConfig.timeout !== undefined)
                cleanConfig.timeout = inputConfig.timeout;
            if (inputConfig.maxContentLength !== undefined)
                cleanConfig.maxContentLength = inputConfig.maxContentLength;
            if (inputConfig.maxCharsPerChunk !== undefined)
                cleanConfig.maxCharsPerChunk = inputConfig.maxCharsPerChunk;
            if (inputConfig.maxConcurrentExtractions !== undefined)
                cleanConfig.maxConcurrentExtractions =
                    inputConfig.maxConcurrentExtractions;
            if (inputConfig.qualityThreshold !== undefined)
                cleanConfig.qualityThreshold = inputConfig.qualityThreshold;
            if (inputConfig.enableCrossChunkMerging !== undefined)
                cleanConfig.enableCrossChunkMerging =
                    inputConfig.enableCrossChunkMerging;

            this.extractionConfig = cleanConfig;
        }
    }

    /**
     * Get the current extraction configuration
     */
    public getConfig(): ExtractionConfig | undefined {
        return this.extractionConfig;
    }

    /**
     * Estimate the number of chunks for given content
     */
    public estimateChunkCount(content: string, maxChunkSize: number): number {
        if (content.length <= maxChunkSize) {
            return 1;
        }
        return Math.ceil(content.length / (maxChunkSize * 0.8));
    }

    /**
     * Extract content using the specified extraction mode with unified processing
     * This is the main API that consolidates all extraction logic with rich metadata
     */
    async extract(
        content: ExtractionInput,
        mode: ExtractionMode = "content",
        options: ExtractionOptions = {},
    ): Promise<ExtractionResult> {
        const startTime = Date.now();
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        const { processingMode = "batch", chunkProgressCallback } = options;

        try {
            // Fetch HTML if needed and not provided
            if (
                mode !== "basic" &&
                !content.htmlContent &&
                !content.htmlFragments &&
                content.url
            ) {
                const fetchResult = await this.htmlFetcher.fetchHtml(
                    content.url,
                );
                if (fetchResult.html) {
                    content.htmlContent = fetchResult.html;
                } else if (fetchResult.error) {
                    // Log the error but continue with title-only processing
                    debug(
                        `Failed to fetch ${content.url}: ${fetchResult.error}`,
                    );
                }
            }

            // Validate AI availability for AI-powered modes
            if (modeConfig.usesAI && !this.knowledgeExtractor) {
                throw new AIModelRequiredError(mode);
            }

            const knowledge = await this.extractKnowledgeByMode(
                content,
                mode,
                chunkProgressCallback,
            );

            const processingTime = Date.now() - startTime;

            const qualityMetrics = this.calculateQualityMetrics(
                knowledge,
                modeConfig,
                processingTime,
            );

            const extractionTimestamp = new Date();
            const entityFacets = await this.generateEntityFacets(knowledge);
            const topicCorrelations = await this.generateTopicCorrelations(knowledge);

            const wordCount = content.textContent?.split(/\s+/).length || 0;

            return {
                pageContent: {
                    title: content.title || "",
                    mainContent: content.textContent || "",
                    headings: [],
                    wordCount,
                    readingTime: Math.ceil(wordCount / 200),
                },
                knowledge,
                qualityMetrics,
                entityFacets,
                topicCorrelations,
                temporalContext: {
                    extractionDate: extractionTimestamp,
                    timeReferences: [],
                },
                extractionMode: mode,
                aiProcessingUsed: modeConfig.usesAI,
                processingMode,
                extractionTimestamp,
                source: content.source,
                timestamp: new Date().toISOString(),
                processingTime,
            };
        } catch (error) {
            if (
                error instanceof AIModelRequiredError ||
                error instanceof AIExtractionFailedError
            ) {
                throw error; // Re-throw extraction-specific errors
            }

            // Wrap other errors with context
            throw new Error(
                `Extraction failed for mode '${mode}': ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Extract knowledge using the appropriate strategy for the given mode
     */
    private async extractKnowledgeByMode(
        content: ExtractionInput,
        mode: ExtractionMode,
        chunkProgressCallback?: (chunkInfo: ChunkProgressInfo) => Promise<void>,
    ): Promise<kpLib.KnowledgeResponse> {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];

        if (modeConfig.knowledgeStrategy === "basic") {
            if (chunkProgressCallback) {
                await chunkProgressCallback({
                    itemUrl: content.url,
                    itemIndex: 0,
                    chunkIndex: 0,
                    totalChunksInItem: 1,
                    globalChunkIndex: 0,
                    totalChunksGlobal: 1,
                });
            }
            return this.extractBasicKnowledge(content);
        }

        if (!this.knowledgeExtractor) {
            return this.extractBasicKnowledge(content);
        }

        const textContent = content.textContent || content.title || "";
        if (!textContent) {
            return {
                topics: [],
                entities: [],
                actions: [],
                inverseActions: [],
            };
        }

        const textWithTitle = content.title
            ? `Title: ${content.title}\n\n${textContent}`
            : textContent;

        try {
            const result = await this.extractChunkedAIKnowledge(
                textWithTitle,
                modeConfig.defaultChunkSize,
                chunkProgressCallback,
                modeConfig.defaultConcurrentExtractions,
                content.url,
            );
            return result;
        } catch (error) {
            throw new AIExtractionFailedError(mode, error as Error);
        }
    }

    /**
     * Extract basic knowledge without AI
     */
    private extractBasicKnowledge(
        content: ExtractionInput,
    ): kpLib.KnowledgeResponse {
        const knowledge: kpLib.KnowledgeResponse = {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };

        const title = content.title || "";
        const textContent = content.textContent || "";

        if (title) {
            const cleanTitle = this.stripMarkdownSyntax(title);
            knowledge.entities.push({
                name: cleanTitle,
                type: ["title"],
                facets: [
                    { name: "source", value: "title_extraction" },
                    { name: "confidence", value: 0.8 },
                ],
            });
        }

        if (textContent) {
            const markdownHeadings = this.extractMarkdownHeadings(textContent);
            markdownHeadings.forEach((heading) => {
                const cleanHeading = this.stripMarkdownSyntax(heading.text);
                if (cleanHeading.length > 3) {
                    knowledge.topics.push(cleanHeading);
                    knowledge.entities.push({
                        name: cleanHeading,
                        type: ["heading"],
                        facets: [
                            { name: "source", value: "markdown_heading" },
                            { name: "confidence", value: 0.7 },
                            { name: "level", value: heading.level },
                        ],
                    });
                }
            });

            const listItems = this.extractMarkdownListItems(textContent);
            listItems.forEach((item) => {
                const cleanItem = this.stripMarkdownSyntax(item);
                if (cleanItem.length >= 5 && cleanItem.length <= 100) {
                    knowledge.topics.push(cleanItem);
                }
            });

            const namedEntities = this.extractNamedEntities(textContent);
            namedEntities.forEach((entity) => {
                const cleanEntity = this.stripMarkdownSyntax(entity.text);
                knowledge.entities.push({
                    name: cleanEntity,
                    type: [entity.type],
                    facets: [
                        { name: "source", value: entity.source },
                        { name: "confidence", value: entity.confidence },
                    ],
                });
            });
        }

        // Add domain-based topics
        if (content.url) {
            try {
                const domain = new URL(content.url).hostname.replace(
                    "www.",
                    "",
                );
                knowledge.topics.push(domain);
            } catch {
                // Invalid URL, skip domain topic
            }
        }

        knowledge.topics = [...new Set(knowledge.topics)].slice(0, 15);
        knowledge.entities = knowledge.entities.slice(0, 20);

        return knowledge;
    }

    private stripMarkdownSyntax(text: string): string {
        return text
            .replace(/(\*\*|__)(.*?)\1/g, "$2")
            .replace(/(\*|_)(.*?)\1/g, "$2")
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/~~(.+?)~~/g, "$1")
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "$1")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    private extractMarkdownHeadings(text: string): Array<{
        text: string;
        level: number;
    }> {
        const headings: Array<{ text: string; level: number }> = [];
        const lines = text.split("\n");

        for (const line of lines) {
            const trimmedLine = line.trim();

            const atxMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
            if (atxMatch) {
                headings.push({
                    text: atxMatch[2].trim(),
                    level: atxMatch[1].length,
                });
                continue;
            }

            const setextMatch = lines.indexOf(line);
            if (setextMatch < lines.length - 1) {
                const nextLine = lines[setextMatch + 1];
                if (/^=+\s*$/.test(nextLine)) {
                    headings.push({ text: trimmedLine, level: 1 });
                } else if (/^-+\s*$/.test(nextLine)) {
                    headings.push({ text: trimmedLine, level: 2 });
                }
            }
        }

        return headings;
    }

    private extractMarkdownListItems(text: string): string[] {
        const listItems: string[] = [];
        const lines = text.split("\n");

        for (const line of lines) {
            const trimmedLine = line.trim();

            const unorderedMatch = trimmedLine.match(/^[-*+]\s+(.+)$/);
            if (unorderedMatch) {
                const item = unorderedMatch[1].trim();
                if (item.length >= 5 && item.length <= 100) {
                    listItems.push(item);
                }
                continue;
            }

            const orderedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
            if (orderedMatch) {
                const item = orderedMatch[1].trim();
                if (item.length >= 5 && item.length <= 100) {
                    listItems.push(item);
                }
            }
        }

        return [...new Set(listItems)].slice(0, 10);
    }

    private extractNamedEntities(text: string): Array<{
        text: string;
        type: string;
        source: string;
        confidence: number;
    }> {
        const entities: Array<{
            text: string;
            type: string;
            source: string;
            confidence: number;
        }> = [];

        const plainText = this.stripMarkdownSyntax(text);

        const titleCasePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g;
        let match;
        const titleCaseMatches = new Set<string>();
        while ((match = titleCasePattern.exec(plainText)) !== null) {
            const phrase = match[1];
            if (phrase.length > 3 && phrase.split(/\s+/).length >= 2) {
                titleCaseMatches.add(phrase);
            }
        }

        Array.from(titleCaseMatches)
            .slice(0, 8)
            .forEach((phrase) => {
                entities.push({
                    text: phrase,
                    type: "named_entity",
                    source: "title_case_pattern",
                    confidence: 0.6,
                });
            });

        const acronymPattern = /\b[A-Z]{2,6}\b/g;
        const acronyms = new Set<string>();
        while ((match = acronymPattern.exec(plainText)) !== null) {
            const acronym = match[0];
            if (acronym.length >= 2 && acronym.length <= 6) {
                acronyms.add(acronym);
            }
        }

        Array.from(acronyms)
            .slice(0, 5)
            .forEach((acronym) => {
                entities.push({
                    text: acronym,
                    type: "acronym",
                    source: "acronym_pattern",
                    confidence: 0.5,
                });
            });

        const links = this.extractMarkdownLinks(text);
        links.slice(0, 5).forEach((linkText) => {
            if (linkText.length > 3) {
                entities.push({
                    text: linkText,
                    type: "reference",
                    source: "markdown_link",
                    confidence: 0.7,
                });
            }
        });

        return entities;
    }

    private extractMarkdownLinks(text: string): string[] {
        const links: string[] = [];
        const linkPattern = /\[([^\]]+)\]\([^\)]+\)/g;
        let match;

        while ((match = linkPattern.exec(text)) !== null) {
            const linkText = match[1].trim();
            if (linkText.length > 0) {
                links.push(linkText);
            }
        }

        return [...new Set(links)];
    }

    /**
     * Calculate quality metrics for the extraction result
     */
    private calculateQualityMetrics(
        knowledge: kpLib.KnowledgeResponse,
        modeConfig: any,
        aiProcessingTime: number,
    ): ExtractionQualityMetrics {
        const entityCount = knowledge.entities?.length || 0;
        const topicCount = knowledge.topics?.length || 0;
        const actionCount = knowledge.actions?.length || 0;

        // Calculate confidence based on entity and topic counts
        let confidence = 0.1; // Base confidence
        if (entityCount > 0) confidence += Math.min(entityCount / 10, 0.4);
        if (topicCount > 0) confidence += Math.min(topicCount / 5, 0.3);
        if (actionCount > 0) confidence += Math.min(actionCount / 5, 0.2);

        return {
            confidence: Math.min(confidence, 1.0),
            entityCount,
            topicCount,
            actionCount,
            extractionTime: aiProcessingTime,
            knowledgeStrategy: modeConfig.knowledgeStrategy,
        };
    }

    /**
     * Get the capabilities of a specific extraction mode
     */
    public getModeCapabilities(mode: ExtractionMode): {
        usesAI: boolean;
        extractsActions: boolean;
        extractsRelationships: boolean;
        knowledgeStrategy: "basic" | "hybrid";
        requiresAI: boolean;
    } {
        const config = EXTRACTION_MODE_CONFIGS[mode];
        return {
            usesAI: config.usesAI,
            extractsActions: config.extractsActions,
            extractsRelationships: config.extractsRelationships,
            knowledgeStrategy: config.knowledgeStrategy,
            requiresAI: config.usesAI,
        };
    }

    /**
     * Check if the extractor is properly configured for a given mode
     */
    public isConfiguredForMode(mode: ExtractionMode): boolean {
        const modeConfig = EXTRACTION_MODE_CONFIGS[mode];
        if (modeConfig.usesAI) {
            return !!this.knowledgeExtractor;
        }
        return true; // Basic mode always works
    }

    /**
     * Extract knowledge from content using AI with intelligent chunking
     */
    private async extractChunkedAIKnowledge(
        content: string,
        maxChunkSize: number,
        chunkProgressCallback?: (chunkInfo: ChunkProgressInfo) => Promise<void>,
        maxConcurrent: number = 3,
        itemUrl: string = "",
    ): Promise<kpLib.KnowledgeResponse> {
        console.log(`\n🔍 [TRACE] extractChunkedAIKnowledge called`);
        console.log(`   URL: ${itemUrl}`);
        console.log(`   Content length: ${content.length}`);
        console.trace('Call stack:');

        if (!this.knowledgeExtractor) {
            throw new Error("Knowledge extractor not available");
        }

        if (content.length <= maxChunkSize) {
            console.log(`   Content fits in single chunk (${content.length} <= ${maxChunkSize})`);
            console.log(`   Extracting knowledge and generating hierarchy for single-chunk content`);

            if (chunkProgressCallback) {
                await chunkProgressCallback({
                    itemUrl,
                    itemIndex: 0,
                    chunkIndex: 0,
                    totalChunksInItem: 1,
                    globalChunkIndex: 0,
                    totalChunksGlobal: 1,
                    chunkContent: content.substring(0, 100),
                });
            }

            const result = await this.knowledgeExtractor.extract(content);
            if (!result) {
                throw new Error("Knowledge extractor returned undefined");
            }

            // For single-chunk content, still generate hierarchical topics
            const aggregated = await this.aggregateChunkResults([result], [content], itemUrl);
            return aggregated;
        }

        const chunks = this.intelligentChunking(content, maxChunkSize);
        const chunkResults: kpLib.KnowledgeResponse[] = [];
        const chunkTexts: string[] = [];

        // Create short URL identifier for log prefixing (handle concurrent processing)
        const urlParts = (itemUrl || "unknown").split("/");
        const urlId = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || "unknown";
        const shortId = urlId.substring(0, 30);
        const logPrefix = `[${shortId}]`;

        console.log(`\n${"=".repeat(80)}`);
        console.log(`${logPrefix} CHUNKED EXTRACTION`);
        console.log(`${logPrefix} URL: ${itemUrl || "unknown"}`);
        console.log(`${logPrefix} Total chunks: ${chunks.length}, Processing in batches of ${maxConcurrent}`);
        console.log("=".repeat(80));

        for (let i = 0; i < chunks.length; i += maxConcurrent) {
            const batch = chunks.slice(i, i + maxConcurrent);
            const batchNumber = Math.floor(i / maxConcurrent) + 1;
            const totalBatches = Math.ceil(chunks.length / maxConcurrent);

            console.log(`\n${logPrefix} BATCH ${batchNumber}/${totalBatches} (chunks ${i + 1}-${Math.min(i + maxConcurrent, chunks.length)})`);

            const batchPromises = batch.map((chunk, batchIndex) => {
                const chunkIndex = i + batchIndex;

                return this.knowledgeExtractor!.extract(chunk)
                    .then(async (result) => {
                        const outcome = {
                            success: true,
                            result,
                            chunk,
                            chunkIndex,
                        };

                        if (result) {
                            chunkResults.push(result);
                            chunkTexts.push(chunk);
                        }

                        // Log chunk details (only first 5 batches to avoid spam)
                        if (batchNumber <= 5) {
                            console.log(`\n${logPrefix}   📄 CHUNK ${outcome.chunkIndex + 1}/${chunks.length}:`);
                            console.log(`${logPrefix}   Text: ${outcome.chunk.substring(0, 300).replace(/\n/g, " ")}...`);

                            if (outcome.result) {
                                console.log(`${logPrefix}   📚 Topics (${outcome.result.topics?.length || 0}):`);
                                outcome.result.topics?.slice(0, 8).forEach((topic, idx) => {
                                    console.log(`${logPrefix}     ${idx + 1}. ${topic}`);
                                });
                                if ((outcome.result.topics?.length || 0) > 8) {
                                    console.log(`${logPrefix}     ... and ${outcome.result.topics.length - 8} more`);
                                }

                                console.log(`${logPrefix}   🏷️  Entities (${outcome.result.entities?.length || 0}):`);
                                outcome.result.entities?.slice(0, 5).forEach((entity, idx) => {
                                    console.log(`${logPrefix}     ${idx + 1}. ${entity.name} [${entity.type?.join(", ")}]`);
                                    if (entity.facets && entity.facets.length > 0) {
                                        const facetStr = entity.facets.slice(0, 3).map(f => `${f.name}:${f.value}`).join(", ");
                                        console.log(`${logPrefix}        ${facetStr}`);
                                    }
                                });
                                if ((outcome.result.entities?.length || 0) > 5) {
                                    console.log(`${logPrefix}     ... and ${outcome.result.entities.length - 5} more`);
                                }

                                console.log(`${logPrefix}   ⚡ Actions (${outcome.result.actions?.length || 0}):`);
                                outcome.result.actions?.slice(0, 3).forEach((action, idx) => {
                                    const verbs = action.verbs?.join("/") || "?";
                                    console.log(`${logPrefix}     ${idx + 1}. ${action.subjectEntityName} → ${verbs} → ${action.objectEntityName}`);
                                });
                                if ((outcome.result.actions?.length || 0) > 3) {
                                    console.log(`${logPrefix}     ... and ${outcome.result.actions.length - 3} more`);
                                }
                            } else {
                                console.log(`${logPrefix}   ❌ No knowledge extracted from this chunk`);
                            }
                        }

                        if (chunkProgressCallback) {
                            await chunkProgressCallback({
                                itemUrl,
                                itemIndex: 0,
                                chunkIndex: outcome.chunkIndex,
                                totalChunksInItem: chunks.length,
                                globalChunkIndex: 0,
                                totalChunksGlobal: 1,
                                chunkContent: outcome.chunk.substring(0, 100),
                                chunkResult: outcome.result,
                            });
                        }

                        return outcome;
                    })
                    .catch(async (error) => {
                        const outcome = {
                            success: false,
                            error,
                            chunk,
                            chunkIndex,
                        };

                        console.warn(
                            `Chunk ${outcome.chunkIndex} extraction failed:`,
                            error,
                        );
                        if (chunkProgressCallback) {
                            await chunkProgressCallback({
                                itemUrl,
                                itemIndex: 0,
                                chunkIndex: outcome.chunkIndex,
                                totalChunksInItem: chunks.length,
                                globalChunkIndex: 0,
                                totalChunksGlobal: 1,
                                chunkContent: outcome.chunk.substring(0, 100),
                            });
                        }

                        return outcome;
                    });
            });

            const batchResults = await Promise.allSettled(batchPromises);

            if (batchNumber <= 5) {
                const successCount = batchResults.filter(r => r.status === 'fulfilled').length;
                console.log(`\n${logPrefix} ✅ Batch ${batchNumber} completed: ${successCount}/${batch.length} chunks successful`);
            }

            if (i + maxConcurrent < chunks.length) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        const aggregated = await this.aggregateChunkResults(chunkResults, chunkTexts, itemUrl);

        console.log(`\n${"=".repeat(80)}`);
        console.log(`${logPrefix} AGGREGATED RESULTS`);
        console.log(`${logPrefix} Processed ${chunks.length} chunks`);
        console.log(`${logPrefix} 📊 Final counts:`);
        console.log(`${logPrefix}   Topics: ${aggregated.topics?.length || 0}`);
        console.log(`${logPrefix}   Entities: ${aggregated.entities?.length || 0}`);
        console.log(`${logPrefix}   Actions: ${aggregated.actions?.length || 0}`);
        console.log("=".repeat(80) + "\n");

        return aggregated;
    }

    /**
     * Intelligently chunk content using knowledge-processor's semantic-aware chunking
     */
    private intelligentChunking(
        content: string,
        maxChunkSize: number,
        preserveStructure: boolean = true,
    ): string[] {
        return Array.from(
            splitLargeTextIntoChunks(content, maxChunkSize, preserveStructure),
        );
    }

    /**
     * Aggregate knowledge results from multiple chunks
     */
    private async aggregateChunkResults(
        chunkResults: kpLib.KnowledgeResponse[],
        chunkTexts: string[],
        itemUrl?: string,
    ): Promise<kpLib.KnowledgeResponse> {
        console.log(`\n🔍 [TRACE] aggregateChunkResults called`);
        console.log(`   URL: ${itemUrl || 'no URL'}`);
        console.log(`   Chunk results count: ${chunkResults.length}`);
        console.log(`   Chunk texts count: ${chunkTexts.length}`);
        console.trace('Call stack:');

        const aggregated: kpLib.KnowledgeResponse = {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };

        const entityMap = new Map<
            string,
            { entity: kpLib.ConcreteEntity; count: number }
        >();
        const allActions: kpLib.Action[] = [];

        chunkResults.forEach((result) => {
            result.entities.forEach((entity) => {
                const normalized = entity.name.toLowerCase();
                const existing = entityMap.get(normalized);
                if (existing) {
                    existing.count++;
                } else {
                    entityMap.set(normalized, { entity, count: 1 });
                }
            });

            allActions.push(...(result.actions || []));
        });

        const fragmentExtractions: kpLib.FragmentTopicExtraction[] = chunkResults.map(
            (result, idx) => ({
                fragmentId: `chunk_${idx}`,
                topics: result.topics,
                fragmentText: chunkTexts[idx]?.substring(0, 2000), // Limit text to 2000 chars per chunk
                confidence: 0.8,
                extractionDate: new Date().toISOString(),
            })
        );

        if (fragmentExtractions.length > 0 && itemUrl) {
            console.log(`\n🌲 [TRACE] Starting hierarchical topic extraction`);
            console.log(`   Fragment extractions: ${fragmentExtractions.length}`);
            console.log(`   URL: ${itemUrl}`);

            const model = this.knowledgeExtractor?.translator?.model;
            if (model) {
                console.log(`   ✓ Model available for hierarchy extraction`);
                const topicExtractor = kpLib.createTopicExtractor(model);
                const hierarchyExtractor = kpLib.createHierarchicalTopicExtractor(
                    model,
                    topicExtractor
                );

                try {
                    const domain = new URL(itemUrl).hostname;
                    console.log(`   Calling extractHierarchicalTopics for domain: ${domain}`);

                    const hierarchyResponse = await hierarchyExtractor.extractHierarchicalTopics(
                        fragmentExtractions,
                        {
                            url: itemUrl,
                            domain: domain,
                        }
                    );

                    console.log(`   Hierarchy extraction status: ${hierarchyResponse.status}`);

                    if (hierarchyResponse.status === "Success") {
                        aggregated.topics = hierarchyResponse.flatTopics.slice(0, 20);
                        (aggregated as any).topicHierarchy = hierarchyResponse.hierarchy;

                        console.log(`   ✅ SUCCESS: Generated hierarchy with ${hierarchyResponse.hierarchy.totalTopics} topics, max depth ${hierarchyResponse.hierarchy.maxDepth}`);
                        console.log(`   Root topics: ${hierarchyResponse.hierarchy.rootTopics.map(t => t.name).join(', ')}`);
                        console.log(`   Flat topics (first 5): ${hierarchyResponse.flatTopics.slice(0, 5).join(', ')}`);

                        debug(`[Hierarchical Topics] Generated hierarchy with ${hierarchyResponse.hierarchy.totalTopics} topics, max depth ${hierarchyResponse.hierarchy.maxDepth}`);
                    } else {
                        console.log(`   ⚠️ Extraction status not Success: ${hierarchyResponse.status}`);
                        debug(`[Hierarchical Topics] Extraction status: ${hierarchyResponse.status}`);
                    }
                } catch (error) {
                    console.error(`   ❌ Error during hierarchy extraction:`, error);
                    debug(`[Hierarchical Topics] Error: ${error}`);
                    // Fall back to frequency-based topic aggregation
                    const topicCounts = new Map<string, number>();
                    chunkResults.forEach((result) => {
                        result.topics.forEach((topic) => {
                            const normalized = topic.toLowerCase();
                            topicCounts.set(
                                normalized,
                                (topicCounts.get(normalized) || 0) + 1,
                            );
                        });
                    });
                    aggregated.topics = Array.from(topicCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 20)
                        .map(([topic]) => topic);
                }
            } else {
                console.log(`   ⚠️ Model NOT available for hierarchy extraction`);
                debug(`[Hierarchical Topics] Skipped - model not available`);
                // Fall back to frequency-based topic aggregation
                const topicCounts = new Map<string, number>();
                chunkResults.forEach((result) => {
                    result.topics.forEach((topic) => {
                        const normalized = topic.toLowerCase();
                        topicCounts.set(
                            normalized,
                            (topicCounts.get(normalized) || 0) + 1,
                        );
                    });
                });
                aggregated.topics = Array.from(topicCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([topic]) => topic);
            }
        } else {
            console.log(`\n⚠️ [TRACE] Skipping hierarchical extraction`);
            console.log(`   Fragments: ${fragmentExtractions.length}`);
            console.log(`   URL: ${itemUrl || 'NO URL PROVIDED'}`);
            debug(`[Hierarchical Topics] Skipped - no fragments (${fragmentExtractions.length}) or no URL (${itemUrl || 'empty'})`);
            // Fall back to frequency-based topic aggregation
            const topicCounts = new Map<string, number>();
            chunkResults.forEach((result) => {
                result.topics.forEach((topic) => {
                    const normalized = topic.toLowerCase();
                    topicCounts.set(
                        normalized,
                        (topicCounts.get(normalized) || 0) + 1,
                    );
                });
            });
            aggregated.topics = Array.from(topicCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([topic]) => topic);
        }

        aggregated.entities = Array.from(entityMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 30)
            .map((item) => item.entity);

        aggregated.actions = allActions.slice(0, 15);
        aggregated.inverseActions = [];

        const hasHierarchy = !!(aggregated as any).topicHierarchy;
        console.log(`\n📊 [TRACE] aggregateChunkResults complete`);
        console.log(`   Topic hierarchy attached: ${hasHierarchy ? 'YES' : 'NO'}`);
        if (hasHierarchy) {
            console.log(`   Hierarchy total topics: ${(aggregated as any).topicHierarchy.totalTopics}`);
        }

        return aggregated;
    }

    /**
     * Generate entity facets from knowledge and content
     */
    private async generateEntityFacets(
        knowledge: kpLib.KnowledgeResponse,
    ): Promise<Map<string, EntityFacet[]>> {
        const entityFacets = new Map<string, EntityFacet[]>();

        // Process entities from knowledge response
        if (knowledge.entities) {
            for (const entity of knowledge.entities) {
                const entityType =
                    typeof entity === "string" ? "generic" : "specific";
                const entityName =
                    typeof entity === "string" ? entity : String(entity);

                const facet: EntityFacet = {
                    entityName,
                    entityType,
                    attributes: {},
                    confidence: 0.8,
                };

                const existing = entityFacets.get(entityName) || [];
                existing.push(facet);
                entityFacets.set(entityName, existing);
            }
        }

        return entityFacets;
    }

    /**
     * Generate topic correlations from knowledge
     */
    private async generateTopicCorrelations(
        knowledge: kpLib.KnowledgeResponse,
    ): Promise<TopicCorrelation[]> {
        const correlations: TopicCorrelation[] = [];

        if (knowledge.topics && knowledge.topics.length > 0) {
            for (let i = 0; i < knowledge.topics.length; i++) {
                const topic = knowledge.topics[i];
                const relatedTopics = knowledge.topics
                    .filter((_, index) => index !== i)
                    .slice(0, 3);

                correlations.push({
                    topic: typeof topic === "string" ? topic : String(topic),
                    relatedTopics: relatedTopics.map((t) =>
                        typeof t === "string" ? t : String(t),
                    ),
                    strength: 0.7,
                    context: "document",
                });
            }
        }

        return correlations;
    }

}
