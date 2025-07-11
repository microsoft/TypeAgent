// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as cheerio from "cheerio";
import {
    ActionExtractor,
    DetectedAction,
    ActionSummary,
} from "./actionExtractor.js";
import { docPartsFromHtml } from "conversation-memory";
import { conversation as kpLib } from "knowledge-processor";

export type ExtractionMode = "basic" | "content" | "actions" | "full";

export interface PageContent {
    title: string;
    mainContent: string;
    headings: string[];
    codeBlocks?: string[];
    images?: ImageInfo[];
    links?: LinkInfo[];
    wordCount: number;
    readingTime: number;
}

export interface ImageInfo {
    src: string;
    alt?: string;
    width?: number;
    height?: number;
    isExternal?: boolean;
}

export interface LinkInfo {
    href: string;
    text: string;
    isExternal: boolean;
}

export interface MetaTagCollection {
    description?: string;
    keywords?: string[];
    author?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogType?: string;
    twitterCard?: string;
    custom: { [key: string]: string };
}

export interface StructuredDataCollection {
    schemaType?: string;
    data?: any;
    jsonLd?: any[];
}

export interface ActionInfo {
    type: "form" | "button" | "link";
    action?: string;
    method?: string;
    text?: string;
}

export interface EnhancedContentWithKnowledge extends EnhancedContent {
    knowledge?: kpLib.KnowledgeResponse;
    knowledgeQuality?: KnowledgeQualityMetrics;
}

export interface KnowledgeQualityMetrics {
    entityCount: number;
    topicCount: number;
    actionCount: number;
    confidence: number;
    extractionMode: "basic" | "enhanced" | "hybrid";
}

export interface EnhancedContent {
    pageContent?: PageContent;
    metaTags?: MetaTagCollection;
    structuredData?: StructuredDataCollection;
    actions?: ActionInfo[];
    extractionTime: number;
    success: boolean;
    error?: string;

    // NEW: Action detection results
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
}

export type KnowledgeExtractionMode = "none" | "basic" | "enhanced" | "hybrid";

export interface ContentExtractorConfig {
    timeout?: number;
    userAgent?: string;
    maxContentLength?: number;
    enableActionDetection?: boolean;
    enableKnowledgeExtraction?: boolean;
    knowledgeMode?: KnowledgeExtractionMode;
    maxCharsPerChunk?: number;
    knowledgeExtractor?: kpLib.KnowledgeExtractor;
    maxConcurrentExtractions?: number;
    knowledgeQualityThreshold?: number;
    enableCrossChunkMerging?: boolean;
    preserveChunkContext?: boolean;
}

export class ContentExtractor {
    private userAgent = "Mozilla/5.0 (compatible; TypeAgent-WebMemory/1.0)";
    private defaultTimeout = 10000;
    private actionExtractor: ActionExtractor;

    constructor(
        private config?: ContentExtractorConfig,
    ) {
        if (config?.timeout) this.defaultTimeout = config.timeout;
        if (config?.userAgent) this.userAgent = config.userAgent;
        this.actionExtractor = new ActionExtractor({
            minConfidence: 0.5,
            maxActions: 20,
        });

        this.validateKnowledgeExtractionRequirements();
    }

    /**
     * Validates that enhanced knowledge extraction requirements are met
     * Logs error and disables enhanced extraction if AI model is not available
     */
    private validateKnowledgeExtractionRequirements(): void {
        if (this.config?.enableKnowledgeExtraction && !this.config.knowledgeExtractor) {
            console.error(
                "Enhanced knowledge extraction enabled but no knowledgeExtractor provided. " +
                "Enhanced extraction will be disabled. Please provide a configured KnowledgeExtractor with AI model."
            );
            // Disable enhanced extraction - do not fallback to basic extraction
            this.config = { 
                ...this.config, 
                enableKnowledgeExtraction: false,
                knowledgeMode: "none"
            };
        }

        // Log configuration status for debugging
        if (this.config?.enableKnowledgeExtraction && this.config.knowledgeExtractor) {
            console.log(
                `Enhanced knowledge extraction enabled with mode: ${this.config.knowledgeMode || "hybrid"}`
            );
        }
    }

    /**
     * Returns whether enhanced knowledge extraction is properly configured and enabled
     */
    private isEnhancedKnowledgeExtractionAvailable(): boolean {
        return !!(
            this.config?.enableKnowledgeExtraction && 
            this.config.knowledgeExtractor &&
            this.config.knowledgeMode !== "none"
        );
    }

    /**
     * Gets the effective configuration with defaults applied
     */
    private getEffectiveConfig(): Required<Pick<ContentExtractorConfig, 
        'maxConcurrentExtractions' | 'knowledgeQualityThreshold' | 'enableCrossChunkMerging' | 'preserveChunkContext' | 'maxCharsPerChunk'
    >> {
        return {
            maxConcurrentExtractions: this.config?.maxConcurrentExtractions || 3,
            knowledgeQualityThreshold: this.config?.knowledgeQualityThreshold || 0.3,
            enableCrossChunkMerging: this.config?.enableCrossChunkMerging !== false,
            preserveChunkContext: this.config?.preserveChunkContext !== false,
            maxCharsPerChunk: this.config?.maxCharsPerChunk || 1000,
        };
    }

    /**
     * Returns current configuration status for debugging and diagnostics
     */
    public getConfigurationStatus(): {
        enhancedKnowledgeAvailable: boolean;
        knowledgeExtractionEnabled: boolean;
        knowledgeMode: KnowledgeExtractionMode;
        hasKnowledgeExtractor: boolean;
        effectiveConfig: {
            maxConcurrentExtractions: number;
            knowledgeQualityThreshold: number;
            enableCrossChunkMerging: boolean;
            preserveChunkContext: boolean;
            maxCharsPerChunk: number;
        };
    } {
        return {
            enhancedKnowledgeAvailable: this.isEnhancedKnowledgeExtractionAvailable(),
            knowledgeExtractionEnabled: this.config?.enableKnowledgeExtraction !== false,
            knowledgeMode: this.config?.knowledgeMode || "hybrid",
            hasKnowledgeExtractor: !!this.config?.knowledgeExtractor,
            effectiveConfig: this.getEffectiveConfig(),
        };
    }

    async extractFromUrl(
        url: string,
        mode: ExtractionMode = "content",
    ): Promise<EnhancedContent> {
        const startTime = Date.now();

        try {
            const html = await this.fetchPage(url);
            const result = await this.extractFromHtml(html, mode);

            return {
                ...result,
                extractionTime: Date.now() - startTime,
                success: true,
            };
        } catch (error) {
            return {
                extractionTime: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                ...this.createEmptyResult(),
            };
        }
    }

    async extractFromHtml(
        html: string,
        mode: ExtractionMode = "content",
    ): Promise<Partial<EnhancedContent>> {
        const $ = cheerio.load(html);
        const result: Partial<EnhancedContent> = {};

        if (mode === "basic") {
            return result; // Only basic URL/title extraction
        }

        if (["content", "actions", "full"].includes(mode)) {
            result.pageContent = this.extractPageContent($);
            result.metaTags = this.extractMetaTags($);
        }

        if (["actions", "full"].includes(mode)) {
            result.actions = this.extractActions($);
        }

        if (mode === "full") {
            result.structuredData = this.extractStructuredData($);
        }

        // NEW: Action detection for 'actions' and 'full' modes
        if (
            ["actions", "full"].includes(mode) &&
            this.config?.enableActionDetection !== false
        ) {
            try {
                result.detectedActions =
                    await this.actionExtractor.extractActionsFromHtml(html);
                result.actionSummary = this.actionExtractor.createActionSummary(
                    result.detectedActions,
                );
            } catch (error) {
                console.warn("Action detection failed:", error);
                result.detectedActions = [];
                result.actionSummary = this.actionExtractor.createActionSummary(
                    [],
                );
            }
        }

        return result;
    }

    async extractWithKnowledge(
        html: string,
        mode: ExtractionMode = "content",
        knowledgeMode: KnowledgeExtractionMode = "hybrid",
    ): Promise<EnhancedContentWithKnowledge> {
        const startTime = Date.now();

        try {
            // Get base content extraction
            const baseContent = await this.extractFromHtml(html, mode);

            // Add knowledge extraction if enabled
            if (
                knowledgeMode !== "none" &&
                this.config?.enableKnowledgeExtraction !== false
            ) {
                const knowledge = await this.extractKnowledge(
                    html,
                    baseContent,
                    knowledgeMode,
                );
                const qualityMetrics = this.calculateKnowledgeQuality(
                    knowledge,
                    baseContent,
                );

                return {
                    ...baseContent,
                    knowledge,
                    knowledgeQuality: qualityMetrics,
                    extractionTime: Date.now() - startTime,
                    success: true,
                };
            }

            return {
                ...baseContent,
                extractionTime: Date.now() - startTime,
                success: true,
            };
        } catch (error) {
            return {
                extractionTime: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                ...this.createEmptyResult(),
            };
        }
    }

    private async extractKnowledge(
        html: string,
        baseContent: Partial<EnhancedContent>,
        mode: KnowledgeExtractionMode,
    ): Promise<kpLib.KnowledgeResponse> {
        try {
            switch (mode) {
                case "basic":
                    return await this.extractBasicKnowledge(baseContent);
                case "enhanced":
                    return await this.extractEnhancedKnowledge(html);
                case "hybrid":
                    return await this.extractHybridKnowledge(html, baseContent);
                default:
                    return this.createEmptyKnowledge();
            }
        } catch (error) {
            console.warn("Knowledge extraction failed:", error);
            return this.createEmptyKnowledge();
        }
    }

    private async extractBasicKnowledge(
        baseContent: Partial<EnhancedContent>,
    ): Promise<kpLib.KnowledgeResponse> {
        const knowledge = this.createEmptyKnowledge();

        // Extract entities from titles and headings
        if (baseContent.pageContent?.title) {
            knowledge.topics.push(baseContent.pageContent.title);
        }

        if (baseContent.pageContent?.headings) {
            knowledge.topics.push(
                ...baseContent.pageContent.headings.slice(0, 5),
            );
        }

        // Basic entity extraction from meta tags
        if (baseContent.metaTags?.keywords) {
            knowledge.topics.push(
                ...baseContent.metaTags.keywords.slice(0, 10),
            );
        }

        return knowledge;
    }

    private async extractEnhancedKnowledge(
        html: string,
    ): Promise<kpLib.KnowledgeResponse> {
        if (!this.isEnhancedKnowledgeExtractionAvailable()) {
            console.warn(
                "Enhanced knowledge extraction requested but not properly configured. " +
                "Returning empty knowledge response."
            );
            return this.createEmptyKnowledge();
        }

        try {
            const effectiveConfig = this.getEffectiveConfig();
            const docParts = docPartsFromHtml(html, effectiveConfig.maxCharsPerChunk);
            
            if (docParts.length === 0) {
                return this.createEmptyKnowledge();
            }

            const knowledgeResults = await this.extractKnowledgeFromAllParts(docParts);
            
            const aggregatedKnowledge = await this.aggregateKnowledgeResults(knowledgeResults);
            
            return this.enhanceAndFilterKnowledge(aggregatedKnowledge, docParts);
            
        } catch (error) {
            console.error("Enhanced knowledge extraction failed:", error);
            return this.createEmptyKnowledge();
        }
    }

    private async extractKnowledgeFromAllParts(
        docParts: any[]
    ): Promise<Array<{ 
        chunkIndex: number; 
        knowledge: kpLib.KnowledgeResponse; 
        confidence: number 
    }>> {
        const effectiveConfig = this.getEffectiveConfig();
        const maxConcurrent = effectiveConfig.maxConcurrentExtractions;
        const results: Array<{ chunkIndex: number; knowledge: kpLib.KnowledgeResponse; confidence: number }> = [];
        
        for (let i = 0; i < docParts.length; i += maxConcurrent) {
            const batch = docParts.slice(i, i + maxConcurrent);
            const batchPromises = batch.map(async (part, batchIndex) => {
                const chunkIndex = i + batchIndex;
                return this.extractKnowledgeFromSinglePart(part, chunkIndex, docParts);
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, batchIndex) => {
                if (result.status === 'fulfilled' && result.value) {
                    results.push(result.value);
                } else if (result.status === 'rejected') {
                    console.warn(`Chunk ${i + batchIndex} extraction failed:`, result.reason);
                }
            });
        }
        
        return results;
    }

    private async extractKnowledgeFromSinglePart(
        part: any, 
        chunkIndex: number, 
        allParts: any[]
    ): Promise<{ chunkIndex: number; knowledge: kpLib.KnowledgeResponse; confidence: number } | null> {
        
        if (!this.config?.knowledgeExtractor) {
            throw new Error("Knowledge extractor not available - this indicates a configuration error");
        }
        
        try {
            const contextualText = this.buildContextualText(part, chunkIndex, allParts);
            
            const knowledge = await this.config.knowledgeExtractor.extract(contextualText);
            
            if (!knowledge) {
                return null;
            }
            
            const confidence = this.calculateExtractionConfidence(knowledge, part);
            
            const effectiveConfig = this.getEffectiveConfig();
            const threshold = effectiveConfig.knowledgeQualityThreshold;
            if (confidence < threshold) {
                return null;
            }
            
            return { chunkIndex, knowledge, confidence };
            
        } catch (error) {
            console.warn(`Knowledge extraction failed for chunk ${chunkIndex}:`, error);
            throw error;
        }
    }

    private buildContextualText(part: any, chunkIndex: number, allParts: any[]): string {
        const effectiveConfig = this.getEffectiveConfig();
        
        if (!effectiveConfig.preserveChunkContext) {
            return part.content || part.textChunks?.join(' ') || '';
        }

        const contextParts: string[] = [];
        const contextWindow = 1;
        
        const startIndex = Math.max(0, chunkIndex - contextWindow);
        const endIndex = Math.min(allParts.length, chunkIndex + contextWindow + 1);
        
        for (let i = startIndex; i < endIndex; i++) {
            const currentPart = allParts[i];
            const text = currentPart.content || currentPart.textChunks?.join(' ') || '';
            
            if (i === chunkIndex) {
                contextParts.push(`[MAIN CONTENT]: ${text}`);
            } else if (i < chunkIndex) {
                contextParts.push(`[CONTEXT BEFORE]: ${text.substring(0, 200)}`);
            } else {
                contextParts.push(`[CONTEXT AFTER]: ${text.substring(0, 200)}`);
            }
        }
        
        return contextParts.join('\n\n');
    }

    private calculateExtractionConfidence(knowledge: kpLib.KnowledgeResponse, part: any): number {
        let confidence = 0.5;
        
        const entityCount = knowledge.entities?.length || 0;
        const topicCount = knowledge.topics?.length || 0;
        const actionCount = knowledge.actions?.length || 0;
        
        if (entityCount > 0) confidence += Math.min(entityCount * 0.1, 0.3);
        if (topicCount > 0) confidence += Math.min(topicCount * 0.05, 0.2);
        if (actionCount > 0) confidence += Math.min(actionCount * 0.05, 0.2);
        
        const textLength = (part.content || part.textChunks?.join('') || '').length;
        if (textLength > 200) confidence += 0.1;
        if (textLength > 500) confidence += 0.1;
        
        return Math.min(confidence, 1.0);
    }

    private async aggregateKnowledgeResults(
        results: Array<{ chunkIndex: number; knowledge: kpLib.KnowledgeResponse; confidence: number }>
    ): Promise<kpLib.KnowledgeResponse> {
        
        const aggregated = this.createEmptyKnowledge();
        const entityMap = new Map<string, { entity: kpLib.ConcreteEntity; confidence: number; sources: number[] }>();
        const topicMap = new Map<string, { topic: string; confidence: number; sources: number[] }>();
        const actionList: Array<{ action: kpLib.Action; confidence: number; source: number }> = [];
        
        for (const result of results) {
            for (const entity of result.knowledge.entities) {
                this.aggregateEntity(entity, result.confidence, result.chunkIndex, entityMap);
            }
            
            for (const topic of result.knowledge.topics) {
                this.aggregateTopic(topic, result.confidence, result.chunkIndex, topicMap);
            }
            
            for (const action of result.knowledge.actions || []) {
                actionList.push({ 
                    action, 
                    confidence: result.confidence, 
                    source: result.chunkIndex 
                });
            }
        }
        
        aggregated.entities = this.rankAndSelectEntities(entityMap);
        aggregated.topics = this.rankAndSelectTopics(topicMap);
        aggregated.actions = this.buildActionRelationships(actionList);
        
        return aggregated;
    }

    private aggregateEntity(
        entity: kpLib.ConcreteEntity,
        confidence: number,
        sourceIndex: number,
        entityMap: Map<string, { entity: kpLib.ConcreteEntity; confidence: number; sources: number[] }>
    ): void {
        
        const normalizedName = this.normalizeEntityName(entity.name);
        const existing = entityMap.get(normalizedName);
        
        if (existing) {
            existing.confidence = Math.max(existing.confidence, confidence);
            existing.sources.push(sourceIndex);
            
            existing.entity.type = this.mergeEntityTypes(existing.entity.type, entity.type);
            
            if (entity.facets && existing.entity.facets) {
                existing.entity.facets = this.mergeFacets(existing.entity.facets, entity.facets, confidence);
            } else if (entity.facets && !existing.entity.facets) {
                existing.entity.facets = [...entity.facets];
            }
            
        } else {
            entityMap.set(normalizedName, {
                entity: { ...entity, name: normalizedName },
                confidence,
                sources: [sourceIndex]
            });
        }
    }

    private aggregateTopic(
        topic: string,
        confidence: number,
        sourceIndex: number,
        topicMap: Map<string, { topic: string; confidence: number; sources: number[] }>
    ): void {
        const normalizedTopic = topic.toLowerCase().trim();
        const existing = topicMap.get(normalizedTopic);
        
        if (existing) {
            existing.confidence = Math.max(existing.confidence, confidence);
            existing.sources.push(sourceIndex);
        } else {
            topicMap.set(normalizedTopic, {
                topic,
                confidence,
                sources: [sourceIndex]
            });
        }
    }

    private normalizeEntityName(name: string): string {
        return name.toLowerCase().trim().replace(/\s+/g, ' ');
    }

    private mergeEntityTypes(type1: string[], type2: string[]): string[] {
        const types1 = Array.isArray(type1) ? type1 : [type1];
        const types2 = Array.isArray(type2) ? type2 : [type2];
        
        return [...new Set([...types1, ...types2])];
    }

    private mergeFacets(facets1: any[], facets2: any[], confidence: number): any[] {
        const facetMap = new Map<string, any>();
        
        for (const facet of facets1) {
            facetMap.set(facet.name, facet);
        }
        
        for (const facet of facets2) {
            const existing = facetMap.get(facet.name);
            if (!existing || confidence > 0.7) {
                facetMap.set(facet.name, facet);
            }
        }
        
        return Array.from(facetMap.values());
    }

    private rankAndSelectEntities(
        entityMap: Map<string, { entity: kpLib.ConcreteEntity; confidence: number; sources: number[] }>
    ): kpLib.ConcreteEntity[] {
        return Array.from(entityMap.values())
            .sort((a, b) => {
                if (b.confidence !== a.confidence) {
                    return b.confidence - a.confidence;
                }
                return b.sources.length - a.sources.length;
            })
            .slice(0, 30)
            .map(item => item.entity);
    }

    private rankAndSelectTopics(
        topicMap: Map<string, { topic: string; confidence: number; sources: number[] }>
    ): string[] {
        return Array.from(topicMap.values())
            .sort((a, b) => {
                if (b.confidence !== a.confidence) {
                    return b.confidence - a.confidence;
                }
                return b.sources.length - a.sources.length;
            })
            .slice(0, 20)
            .map(item => item.topic);
    }

    private buildActionRelationships(
        actionList: Array<{ action: kpLib.Action; confidence: number; source: number }>
    ): kpLib.Action[] {
        const actionMap = new Map<string, { action: kpLib.Action; confidence: number; sources: number[] }>();
        
        for (const item of actionList) {
            const key = this.createActionKey(item.action);
            const existing = actionMap.get(key);
            
            if (existing) {
                existing.confidence = Math.max(existing.confidence, item.confidence);
                existing.sources.push(item.source);
            } else {
                actionMap.set(key, {
                    action: item.action,
                    confidence: item.confidence,
                    sources: [item.source]
                });
            }
        }
        
        return Array.from(actionMap.values())
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 15)
            .map(item => item.action);
    }

    private createActionKey(action: kpLib.Action): string {
        const verbs = action.verbs.join('|');
        return `${action.subjectEntityName || 'unknown'}:${verbs}:${action.objectEntityName || 'unknown'}`;
    }

    private enhanceAndFilterKnowledge(
        knowledge: kpLib.KnowledgeResponse,
        originalParts: any[]
    ): kpLib.KnowledgeResponse {
        
        const qualityScore = this.calculateKnowledgeQualityScore(knowledge, originalParts);
        
        const filtered = this.filterByQuality(knowledge, qualityScore);
        
        const enhanced = this.addCrossReferences(filtered, originalParts);
        
        return this.validateAndCleanKnowledge(enhanced);
    }

    private calculateKnowledgeQualityScore(knowledge: kpLib.KnowledgeResponse, originalParts: any[]): number {
        let score = 0.5;
        
        const entityCount = knowledge.entities?.length || 0;
        const topicCount = knowledge.topics?.length || 0;
        const actionCount = knowledge.actions?.length || 0;
        
        if (entityCount > 0) score += Math.min(entityCount * 0.05, 0.2);
        if (topicCount > 0) score += Math.min(topicCount * 0.03, 0.15);
        if (actionCount > 0) score += Math.min(actionCount * 0.03, 0.15);
        
        const totalTextLength = originalParts.reduce((sum, part) => {
            return sum + ((part.content || part.textChunks?.join('') || '').length);
        }, 0);
        
        if (totalTextLength > 1000) score += 0.1;
        if (totalTextLength > 5000) score += 0.1;
        
        return Math.min(score, 1.0);
    }

    private filterByQuality(knowledge: kpLib.KnowledgeResponse, qualityScore: number): kpLib.KnowledgeResponse {
        if (qualityScore < 0.3) {
            return this.createEmptyKnowledge();
        }
        
        const filtered = this.createEmptyKnowledge();
        
        filtered.entities = knowledge.entities.filter(entity => {
            const nameLength = entity.name?.length || 0;
            return nameLength > 2 && nameLength < 100;
        });
        
        filtered.topics = knowledge.topics.filter(topic => {
            return topic.length > 2 && topic.length < 50;
        });
        
        filtered.actions = knowledge.actions.filter(action => {
            return action.verbs && action.verbs.length > 0 && 
                   (action.subjectEntityName || action.objectEntityName);
        });
        
        return filtered;
    }

    private addCrossReferences(knowledge: kpLib.KnowledgeResponse, originalParts: any[]): kpLib.KnowledgeResponse {
        const enhanced = { ...knowledge };
        
        const allText = originalParts.map(part => 
            (part.content || part.textChunks?.join('') || '').toLowerCase()
        ).join(' ');
        
        enhanced.entities = enhanced.entities.map(entity => {
            const mentions = this.countEntityMentions(entity.name, allText);
            if (mentions > 1 && entity.facets) {
                entity.facets.push({
                    name: 'cross_references',
                    value: mentions
                });
            }
            return entity;
        });
        
        enhanced.topics = enhanced.topics.filter(topic => {
            return this.countEntityMentions(topic, allText) > 0;
        });
        
        return enhanced;
    }

    private countEntityMentions(entityName: string, text: string): number {
        const normalized = entityName.toLowerCase();
        const regex = new RegExp(`\\b${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const matches = text.match(regex);
        return matches ? matches.length : 0;
    }

    private validateAndCleanKnowledge(knowledge: kpLib.KnowledgeResponse): kpLib.KnowledgeResponse {
        const cleaned = this.createEmptyKnowledge();
        
        cleaned.entities = knowledge.entities
            .filter(entity => entity.name && entity.name.trim().length > 0)
            .slice(0, 30);
        
        cleaned.topics = [...new Set(knowledge.topics)]
            .filter(topic => topic && topic.trim().length > 0)
            .slice(0, 20);
        
        cleaned.actions = knowledge.actions
            .filter(action => action.verbs && action.verbs.length > 0)
            .slice(0, 15);
        
        return cleaned;
    }

    private async extractHybridKnowledge(
        html: string,
        baseContent: Partial<EnhancedContent>,
    ): Promise<kpLib.KnowledgeResponse> {
        try {
            // Combine basic extraction with enhanced processing
            const basicKnowledge =
                await this.extractBasicKnowledge(baseContent);
            const enhancedKnowledge = await this.extractEnhancedKnowledge(html);

            // Merge knowledge results
            return this.mergeKnowledgeResults(
                basicKnowledge,
                enhancedKnowledge,
                baseContent,
            );
        } catch (error) {
            console.warn("Hybrid knowledge extraction failed:", error);
            return await this.extractBasicKnowledge(baseContent);
        }
    }

    private mergeKnowledgeResults(
        basicKnowledge: kpLib.KnowledgeResponse,
        enhancedKnowledge: kpLib.KnowledgeResponse,
        baseContent: Partial<EnhancedContent>,
    ): kpLib.KnowledgeResponse {
        const merged = this.createEmptyKnowledge();

        // Merge topics (removing duplicates)
        const allTopics = [
            ...basicKnowledge.topics,
            ...enhancedKnowledge.topics,
        ];
        merged.topics = [...new Set(allTopics)].slice(0, 20);

        // Merge entities (removing duplicates by name)
        const allEntities = [
            ...basicKnowledge.entities,
            ...enhancedKnowledge.entities,
        ];
        const entityMap = new Map<string, kpLib.ConcreteEntity>();
        allEntities.forEach((entity) => {
            if (!entityMap.has(entity.name)) {
                entityMap.set(entity.name, entity);
            }
        });
        merged.entities = Array.from(entityMap.values()).slice(0, 30);

        // Merge actions, including detected actions from base content
        merged.actions = [
            ...basicKnowledge.actions,
            ...enhancedKnowledge.actions,
        ];

        // Add action detection results as knowledge actions
        if (baseContent.detectedActions) {
            for (const detectedAction of baseContent.detectedActions) {
                merged.actions.push({
                    verbs: [detectedAction.actionType || "unknown"],
                    verbTense: "present",
                    subjectEntityName: "user",
                    objectEntityName: detectedAction.target?.name || "page",
                    indirectObjectEntityName: "none",
                    params: [
                        {
                            name: "confidence",
                            value: detectedAction.confidence,
                        },
                        {
                            name: "description",
                            value: detectedAction.name || "",
                        },
                    ],
                });
            }
        }

        return merged;
    }

    private calculateKnowledgeQuality(
        knowledge: kpLib.KnowledgeResponse,
        baseContent: Partial<EnhancedContent>,
    ): KnowledgeQualityMetrics {
        const entityCount = knowledge.entities.length;
        const topicCount = knowledge.topics.length;
        const actionCount = knowledge.actions.length;

        // Calculate confidence based on content richness
        let confidence = 0.5; // Base confidence

        if (
            baseContent.pageContent?.mainContent &&
            baseContent.pageContent.mainContent.length > 500
        ) {
            confidence += 0.2;
        }

        if (entityCount > 5) confidence += 0.1;
        if (topicCount > 3) confidence += 0.1;
        if (actionCount > 0) confidence += 0.1;

        confidence = Math.min(confidence, 1.0);

        return {
            entityCount,
            topicCount,
            actionCount,
            confidence,
            extractionMode:
                (this.config?.knowledgeMode === "none"
                    ? "basic"
                    : this.config?.knowledgeMode) || "hybrid",
        };
    }

    private createEmptyKnowledge(): kpLib.KnowledgeResponse {
        return {
            topics: [],
            entities: [],
            actions: [],
            inverseActions: [],
        };
    }

    private async fetchPage(url: string): Promise<string> {
        console.log(
            `[ContentExtractor] Starting fetch for: ${url} (timeout: ${this.defaultTimeout}ms)`,
        );
        const fetchStart = Date.now();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.log(
                `[ContentExtractor] Timeout triggered for: ${url} after ${this.defaultTimeout}ms`,
            );
            controller.abort();
        }, this.defaultTimeout);

        try {
            console.log(`[ContentExtractor] Sending HTTP request to: ${url}`);
            const response = await fetch(url, {
                headers: {
                    "User-Agent": this.userAgent,
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate",
                    "Cache-Control": "no-cache",
                },
                signal: controller.signal,
                redirect: "follow",
            });

            const responseTime = Date.now() - fetchStart;
            console.log(
                `[ContentExtractor] Got response for ${url} in ${responseTime}ms (status: ${response.status})`,
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html")) {
                throw new Error(`Non-HTML content type: ${contentType}`);
            }

            console.log(`[ContentExtractor] Reading response body for: ${url}`);
            const text = await response.text();
            const totalTime = Date.now() - fetchStart;
            console.log(
                `[ContentExtractor] Successfully fetched ${text.length} chars from ${url} in ${totalTime}ms`,
            );

            return text;
        } catch (error) {
            const totalTime = Date.now() - fetchStart;
            console.error(
                `[ContentExtractor] Fetch failed for ${url} after ${totalTime}ms:`,
                error,
            );
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private extractPageContent($: cheerio.CheerioAPI): PageContent {
        const title = this.extractTitle($);
        const mainContent = this.extractMainContent($);
        const headings = this.extractHeadings($);
        const codeBlocks = this.extractCodeBlocks($);
        const images = this.extractImages($);
        const links = this.extractLinks($);

        const wordCount = this.calculateWordCount(mainContent);
        const readingTime = this.calculateReadingTime(wordCount);

        return {
            title,
            mainContent,
            headings,
            codeBlocks,
            images,
            links,
            wordCount,
            readingTime,
        };
    }

    private extractTitle($: cheerio.CheerioAPI): string {
        // Try different title sources in order of preference
        let title = $("title").first().text().trim();

        if (!title) {
            title = $('meta[property="og:title"]').attr("content") || "";
        }

        if (!title) {
            title = $("h1").first().text().trim();
        }

        return title || "Untitled";
    }

    private extractMainContent($: cheerio.CheerioAPI): string {
        // Remove unwanted elements
        $(
            "script, style, nav, header, footer, aside, .nav, .navigation, .sidebar",
        ).remove();
        $('[class*="ad"], [id*="ad"], .advertisement, .ads').remove();
        $(".social-share, .share-buttons, .comments, .cookie-banner").remove();

        // Try semantic content selectors first
        const contentSelectors = [
            'main [role="main"]',
            "article",
            '[role="main"]',
            "main",
            ".content",
            ".main-content",
            ".post-content",
            ".entry-content",
            "#content",
            "#main-content",
        ];

        for (const selector of contentSelectors) {
            const content = $(selector);
            if (content.length > 0) {
                return this.cleanText(content.text());
            }
        }

        // Fallback: get body content with noise removal
        const bodyContent = $("body").clone();
        bodyContent.find("script, style, nav, header, footer, aside").remove();

        return this.cleanText(bodyContent.text());
    }

    private extractHeadings($: cheerio.CheerioAPI): string[] {
        const headings: string[] = [];

        $("h1, h2, h3, h4, h5, h6").each((_, element) => {
            const text = $(element).text().trim();
            if (text && text.length > 0 && text.length < 200) {
                headings.push(text);
            }
        });

        return headings;
    }

    private extractCodeBlocks($: cheerio.CheerioAPI): string[] {
        const codeBlocks: string[] = [];

        // Common code block selectors
        const codeSelectors = [
            "pre code",
            "pre",
            ".highlight code",
            ".code-block",
            ".codehilite",
            '[class*="lang-"]',
            '[class*="language-"]',
        ];

        for (const selector of codeSelectors) {
            $(selector).each((_, element) => {
                const code = $(element).text().trim();
                if (code && code.length > 10 && code.length < 5000) {
                    codeBlocks.push(code);
                }
            });
        }

        return [...new Set(codeBlocks)]; // Remove duplicates
    }

    private extractImages($: cheerio.CheerioAPI): ImageInfo[] {
        const images: ImageInfo[] = [];

        $("img").each((_, element) => {
            const $img = $(element);
            const src = $img.attr("src");

            if (src && !src.startsWith("data:") && src.length > 5) {
                const imageInfo: ImageInfo = {
                    src,
                    isExternal: src.startsWith("http"),
                };

                const alt = $img.attr("alt");
                if (alt) imageInfo.alt = alt;

                const width = parseInt($img.attr("width") || "0");
                if (width > 0) imageInfo.width = width;

                const height = parseInt($img.attr("height") || "0");
                if (height > 0) imageInfo.height = height;

                images.push(imageInfo);
            }
        });

        return images.slice(0, 50); // Limit to avoid memory issues
    }

    private extractLinks($: cheerio.CheerioAPI): LinkInfo[] {
        const links: LinkInfo[] = [];

        $("a[href]").each((_, element) => {
            const $link = $(element);
            const href = $link.attr("href");
            const text = $link.text().trim();

            if (href && text && text.length > 0 && text.length < 200) {
                const isExternal = href.startsWith("http");
                links.push({
                    href,
                    text,
                    isExternal,
                });
            }
        });

        return links.slice(0, 100); // Limit to avoid memory issues
    }

    private extractMetaTags($: cheerio.CheerioAPI): MetaTagCollection {
        const metaTags: MetaTagCollection = { custom: {} };

        // Standard meta tags
        const description = $('meta[name="description"]').attr("content");
        if (description) metaTags.description = description;

        const author = $('meta[name="author"]').attr("content");
        if (author) metaTags.author = author;

        // Keywords
        const keywordsContent = $('meta[name="keywords"]').attr("content");
        if (keywordsContent) {
            metaTags.keywords = keywordsContent
                .split(",")
                .map((k) => k.trim())
                .filter((k) => k.length > 0);
        }

        // Open Graph tags
        const ogTitle = $('meta[property="og:title"]').attr("content");
        if (ogTitle) metaTags.ogTitle = ogTitle;

        const ogDescription = $('meta[property="og:description"]').attr(
            "content",
        );
        if (ogDescription) metaTags.ogDescription = ogDescription;

        const ogType = $('meta[property="og:type"]').attr("content");
        if (ogType) metaTags.ogType = ogType;

        // Twitter Card tags
        const twitterCard = $('meta[name="twitter:card"]').attr("content");
        if (twitterCard) metaTags.twitterCard = twitterCard;

        // Custom meta tags
        $("meta[name], meta[property]").each((_, element) => {
            const $meta = $(element);
            const name = $meta.attr("name") || $meta.attr("property");
            const content = $meta.attr("content");

            if (
                name &&
                content &&
                !["description", "author", "keywords"].includes(name)
            ) {
                metaTags.custom[name] = content;
            }
        });

        return metaTags;
    }

    private extractStructuredData(
        $: cheerio.CheerioAPI,
    ): StructuredDataCollection {
        const structuredData: StructuredDataCollection = {};

        // JSON-LD structured data
        const jsonLdScripts: any[] = [];
        $('script[type="application/ld+json"]').each((_, element) => {
            try {
                const jsonData = JSON.parse($(element).html() || "");
                jsonLdScripts.push(jsonData);

                // Extract primary schema type
                if (jsonData["@type"] && !structuredData.schemaType) {
                    structuredData.schemaType = jsonData["@type"];
                    structuredData.data = jsonData;
                }
            } catch (error) {
                // Ignore malformed JSON-LD
            }
        });

        if (jsonLdScripts.length > 0) {
            structuredData.jsonLd = jsonLdScripts;
        }

        return structuredData;
    }

    private extractActions($: cheerio.CheerioAPI): ActionInfo[] {
        const actions: ActionInfo[] = [];

        // Forms
        $("form").each((_, element) => {
            const $form = $(element);
            const actionInfo: ActionInfo = {
                type: "form",
                method: $form.attr("method") || "GET",
            };

            const action = $form.attr("action");
            if (action) actionInfo.action = action;

            actions.push(actionInfo);
        });

        // Buttons
        $('button, input[type="button"], input[type="submit"]').each(
            (_, element) => {
                const $button = $(element);
                const text =
                    $button.text().trim() ||
                    $button.attr("value") ||
                    $button.attr("title");

                if (text) {
                    actions.push({
                        type: "button",
                        text,
                    });
                }
            },
        );

        // Important links (likely actions)
        $("a[href]").each((_, element) => {
            const $link = $(element);
            const href = $link.attr("href");
            const text = $link.text().trim();
            const className = $link.attr("class") || "";

            // Only include action-like links
            if (
                href &&
                text &&
                (className.includes("btn") ||
                    className.includes("button") ||
                    className.includes("action") ||
                    text.toLowerCase().includes("download") ||
                    text.toLowerCase().includes("sign up") ||
                    text.toLowerCase().includes("login"))
            ) {
                actions.push({
                    type: "link",
                    action: href,
                    text,
                });
            }
        });

        return actions.slice(0, 50); // Limit to avoid memory issues
    }

    private calculateWordCount(text: string): number {
        return text
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length;
    }

    private calculateReadingTime(wordCount: number): number {
        // Average reading speed: 200-250 words per minute
        return Math.ceil(wordCount / 225);
    }

    private cleanText(text: string): string {
        return text
            .replace(/\s+/g, " ")
            .replace(/\n\s*\n/g, "\n")
            .trim()
            .substring(0, this.config?.maxContentLength || 10000);
    }

    private createEmptyResult(): Partial<EnhancedContent> {
        return {
            pageContent: {
                title: "",
                mainContent: "",
                headings: [],
                codeBlocks: [],
                images: [],
                links: [],
                wordCount: 0,
                readingTime: 0,
            },
            metaTags: { custom: {} },
            structuredData: {},
            actions: [],
            detectedActions: [],
            actionSummary: {
                totalActions: 0,
                actionTypes: [],
                highConfidenceActions: 0,
                actionDistribution: {},
            },
        };
    }
}

/**
 * Factory function to create a ContentExtractor with enhanced knowledge extraction
 * @param knowledgeExtractor The configured knowledge extractor with AI model
 * @param options Additional configuration options
 * @returns ContentExtractor instance with enhanced knowledge extraction enabled
 */
export function createContentExtractorWithKnowledge(
    knowledgeExtractor: kpLib.KnowledgeExtractor,
    options: Partial<ContentExtractorConfig> = {}
): ContentExtractor {
    const config: ContentExtractorConfig = {
        enableKnowledgeExtraction: true,
        knowledgeMode: "hybrid",
        maxCharsPerChunk: 1500,
        maxConcurrentExtractions: 3,
        knowledgeQualityThreshold: 0.4,
        enableCrossChunkMerging: true,
        preserveChunkContext: true,
        ...options,
        knowledgeExtractor, // Ensure this is set
    };

    return new ContentExtractor(config);
}

/**
 * Factory function to create a basic ContentExtractor without enhanced knowledge extraction
 * @param options Configuration options
 * @returns ContentExtractor instance with basic functionality only
 */
export function createBasicContentExtractor(
    options: Partial<ContentExtractorConfig> = {}
): ContentExtractor {
    const config: ContentExtractorConfig = {
        enableKnowledgeExtraction: false,
        knowledgeMode: "none",
        ...options,
    };
    
    // Explicitly remove knowledgeExtractor to avoid type issues
    delete config.knowledgeExtractor;

    return new ContentExtractor(config);
}
