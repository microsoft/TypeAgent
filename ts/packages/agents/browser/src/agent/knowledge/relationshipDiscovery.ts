// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import * as website from "website-memory";

export interface RelationshipResult {
    relatedPages: RelatedPage[];
    relationships: CrossPageRelationship[];
    confidence: number;
    analysisType: "domain" | "topic" | "entity" | "temporal" | "technical";
    qualityScore: number;
    correlationMetrics: CorrelationMetrics;
}

export interface RelatedPage {
    url: string;
    title: string;
    similarity: number;
    relationshipType:
        | "same-domain"
        | "topic-match"
        | "entity-overlap"
        | "temporal-sequence"
        | "technical-similarity";
    sharedElements: string[];
    visitInfo: {
        visitCount: number;
        lastVisited: string;
        source: "history" | "bookmark";
    };
    qualityIndicators: QualityIndicators;
    correlationScore: number;
}

export interface CrossPageRelationship {
    sourceUrl: string;
    targetUrl: string;
    relationshipType: string;
    strength: number;
    sharedEntities: string[];
    sharedTopics: string[];
    description: string;
    confidenceFactors: ConfidenceFactors;
    qualityScore: number;
}

export interface CorrelationMetrics {
    semanticSimilarity: number;
    structuralSimilarity: number;
    temporalRelevance: number;
    contentDepthAlignment: number;
    topicCoherence: number;
    overallScore: number;
}

export interface QualityIndicators {
    contentRichness: number;
    topicSpecificity: number;
    technicalDepth: number;
    informationDensity: number;
    overallQuality: number;
}

export interface ConfidenceFactors {
    sharedElementsWeight: number;
    temporalProximity: number;
    contentSimilarity: number;
    structuralAlignment: number;
    domainRelevance: number;
    combinedConfidence: number;
}

export class RelationshipDiscovery {
    private context: SessionContext<BrowserActionContext>;
    private correlationCache = new Map<string, CorrelationMetrics>();
    private qualityCache = new Map<string, QualityIndicators>();

    constructor(context: SessionContext<BrowserActionContext>) {
        this.context = context;
    }

    /**
     * Discover relationships for a given page using advanced correlation algorithms
     */
    async discoverRelationships(
        currentUrl: string,
        currentKnowledge: any,
        maxResults: number = 10,
    ): Promise<RelationshipResult[]> {
        const websiteCollection = this.context.agentContext.websiteCollection;

        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return [];
        }

        const results: RelationshipResult[] = [];

        // 1. Domain-based relationships
        const domainResults = await this.findDomainBasedRelationships(
            currentUrl,
            websiteCollection,
            maxResults,
        );
        if (domainResults.relatedPages.length > 0) {
            results.push(domainResults);
        }

        // 2. Topic-based relationships
        if (
            currentKnowledge.keyTopics &&
            currentKnowledge.keyTopics.length > 0
        ) {
            const topicResults = await this.findTopicBasedRelationships(
                currentKnowledge.keyTopics,
                currentUrl,
                websiteCollection,
                maxResults,
            );
            if (topicResults.relatedPages.length > 0) {
                results.push(topicResults);
            }
        }

        // 3. Entity-based relationships
        if (currentKnowledge.entities && currentKnowledge.entities.length > 0) {
            const entityResults = await this.findEntityBasedRelationships(
                currentKnowledge.entities,
                currentUrl,
                websiteCollection,
                maxResults,
            );
            if (entityResults.relatedPages.length > 0) {
                results.push(entityResults);
            }
        }

        // 4. Technical content relationships (if code is detected)
        if (currentKnowledge.contentMetrics?.hasCode) {
            const technicalResults = await this.findTechnicalRelationships(
                currentUrl,
                websiteCollection,
                maxResults,
            );
            if (technicalResults.relatedPages.length > 0) {
                results.push(technicalResults);
            }
        }

        // 5. Temporal relationships (recent visits in same domain/topic)
        const temporalResults = await this.findTemporalRelationships(
            currentUrl,
            currentKnowledge,
            websiteCollection,
            maxResults,
        );
        if (temporalResults.relatedPages.length > 0) {
            results.push(temporalResults);
        }

        // Apply advanced correlation analysis to all results
        const enhancedResults = await this.applyAdvancedCorrelation(
            results,
            currentKnowledge,
            currentUrl,
        );

        // Sort by enhanced quality score instead of just confidence
        return enhancedResults.sort(
            (a, b) =>
                b.qualityScore * b.confidence - a.qualityScore * a.confidence,
        );
    }

    /**
     * Apply advanced correlation algorithms to improve relationship quality
     */
    private async applyAdvancedCorrelation(
        results: RelationshipResult[],
        currentKnowledge: any,
        currentUrl: string,
    ): Promise<RelationshipResult[]> {
        const enhancedResults: RelationshipResult[] = [];

        for (const result of results) {
            // Calculate correlation metrics for this analysis type
            const correlationMetrics = await this.calculateCorrelationMetrics(
                result,
                currentKnowledge,
                currentUrl,
            );

            // Enhance each related page with quality indicators
            const enhancedPages = await Promise.all(
                result.relatedPages.map((page) =>
                    this.enhancePageWithQuality(page, currentKnowledge),
                ),
            );

            // Enhance relationships with confidence factors
            const enhancedRelationships = result.relationships.map((rel) =>
                this.enhanceRelationshipWithConfidence(rel, correlationMetrics),
            );

            // Calculate overall quality score
            const qualityScore = this.calculateOverallQualityScore(
                correlationMetrics,
                enhancedPages,
            );

            enhancedResults.push({
                ...result,
                relatedPages: enhancedPages,
                relationships: enhancedRelationships,
                correlationMetrics,
                qualityScore,
            });
        }

        return enhancedResults;
    }

    /**
     * Calculate comprehensive correlation metrics
     */
    private async calculateCorrelationMetrics(
        result: RelationshipResult,
        currentKnowledge: any,
        currentUrl: string,
    ): Promise<CorrelationMetrics> {
        const cacheKey = `${currentUrl}-${result.analysisType}`;

        if (this.correlationCache.has(cacheKey)) {
            return this.correlationCache.get(cacheKey)!;
        }

        // Semantic similarity (based on shared topics and entities)
        const semanticSimilarity = this.calculateSemanticSimilarity(
            result,
            currentKnowledge,
        );

        // Structural similarity (based on page types, domains, etc.)
        const structuralSimilarity = this.calculateStructuralSimilarity(
            result,
            currentUrl,
        );

        // Temporal relevance (based on visit patterns)
        const temporalRelevance = this.calculateTemporalRelevance(result);

        // Content depth alignment (technical level matching)
        const contentDepthAlignment = this.calculateContentDepthAlignment(
            result,
            currentKnowledge,
        );

        // Topic coherence (consistency of topics across related pages)
        const topicCoherence = this.calculateTopicCoherence(result);

        // Combined weighted score
        const overallScore = this.calculateWeightedCorrelationScore({
            semanticSimilarity,
            structuralSimilarity,
            temporalRelevance,
            contentDepthAlignment,
            topicCoherence,
        });

        const metrics: CorrelationMetrics = {
            semanticSimilarity,
            structuralSimilarity,
            temporalRelevance,
            contentDepthAlignment,
            topicCoherence,
            overallScore,
        };

        this.correlationCache.set(cacheKey, metrics);
        return metrics;
    }

    /**
     * Enhance a related page with quality indicators
     */
    private async enhancePageWithQuality(
        page: RelatedPage,
        currentKnowledge: any,
    ): Promise<RelatedPage> {
        const cacheKey = page.url;

        let qualityIndicators: QualityIndicators;
        if (this.qualityCache.has(cacheKey)) {
            qualityIndicators = this.qualityCache.get(cacheKey)!;
        } else {
            qualityIndicators = await this.calculateQualityIndicators(
                page,
                currentKnowledge,
            );
            this.qualityCache.set(cacheKey, qualityIndicators);
        }

        // Calculate enhanced correlation score
        const correlationScore = this.calculatePageCorrelationScore(
            page,
            qualityIndicators,
        );

        return {
            ...page,
            qualityIndicators,
            correlationScore,
        };
    }

    /**
     * Calculate quality indicators for a page
     */
    private async calculateQualityIndicators(
        page: RelatedPage,
        currentKnowledge: any,
    ): Promise<QualityIndicators> {
        // Content richness (based on shared elements count and diversity)
        const contentRichness = Math.min(1.0, page.sharedElements.length / 10);

        // Topic specificity (how specific/focused the shared topics are)
        const topicSpecificity = this.calculateTopicSpecificity(
            page.sharedElements,
        );

        // Technical depth (presence of technical content indicators)
        const technicalDepth = this.calculateTechnicalDepth(page);

        // Information density (estimated content quality)
        const informationDensity = this.calculateInformationDensity(page);

        // Overall quality (weighted combination)
        const overallQuality = this.calculateWeightedQualityScore({
            contentRichness,
            topicSpecificity,
            technicalDepth,
            informationDensity,
        });

        return {
            contentRichness,
            topicSpecificity,
            technicalDepth,
            informationDensity,
            overallQuality,
        };
    }

    /**
     * Find pages from the same domain with enhanced correlation
     */
    private async findDomainBasedRelationships(
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number,
    ): Promise<RelationshipResult> {
        const currentDomain = this.extractDomain(currentUrl);
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Simple domain matching using website collection
            const websites = websiteCollection.messages.getAll();
            for (const website of websites.slice(0, maxResults * 2)) {
                const metadata = website.metadata as website.WebsiteDocPartMeta;
                const websiteUrl = metadata.url;
                const websiteDomain = this.extractDomain(websiteUrl);

                if (
                    websiteDomain === currentDomain &&
                    websiteUrl !== currentUrl
                ) {
                    relatedPages.push(
                        this.createRelatedPage(
                            websiteUrl,
                            metadata.title || websiteUrl,
                            this.calculateDomainSimilarity(
                                currentUrl,
                                websiteUrl,
                            ),
                            "same-domain",
                            [currentDomain],
                            {
                                visitCount: 1,
                                lastVisited:
                                    metadata.visitDate ||
                                    metadata.bookmarkDate ||
                                    new Date().toISOString(),
                                source: this.mapWebsiteSource(
                                    metadata.websiteSource,
                                ),
                            },
                        ),
                    );

                    relationships.push(
                        this.createCrossPageRelationship(
                            currentUrl,
                            websiteUrl,
                            "same-domain",
                            0.8,
                            [],
                            [],
                            `Both pages are from ${currentDomain}`,
                        ),
                    );
                }

                if (relatedPages.length >= maxResults) break;
            }
        } catch (error) {
            console.warn("Error querying domain relationships:", error);
        }

        return this.createRelationshipResult(
            relatedPages,
            relationships,
            relatedPages.length > 0 ? 0.8 : 0,
            "domain",
        );
    }

    /**
     * Find pages with similar topics using KnowPro semantic search
     */
    private async findTopicBasedRelationships(
        topics: string[],
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number,
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Use simple topic matching for now
            const websites = websiteCollection.messages.getAll();
            for (const website of websites) {
                const metadata = website.metadata as website.WebsiteDocPartMeta;
                if (metadata.url !== currentUrl) {
                    const knowledge = website.getKnowledge();
                    if (knowledge && knowledge.topics) {
                        const sharedTopics = this.findSharedTopics(
                            topics,
                            knowledge.topics || [],
                        );

                        if (sharedTopics.length > 0) {
                            const similarity = this.calculateTopicSimilarity(
                                topics,
                                knowledge.topics || [],
                            );

                            relatedPages.push(
                                this.createRelatedPage(
                                    metadata.url,
                                    metadata.title || metadata.url,
                                    similarity,
                                    "topic-match",
                                    sharedTopics,
                                    {
                                        visitCount: 1,
                                        lastVisited:
                                            metadata.visitDate ||
                                            metadata.bookmarkDate ||
                                            new Date().toISOString(),
                                        source: this.mapWebsiteSource(
                                            metadata.websiteSource,
                                        ),
                                    },
                                ),
                            );

                            relationships.push(
                                this.createCrossPageRelationship(
                                    currentUrl,
                                    metadata.url,
                                    "topic-similarity",
                                    similarity,
                                    [],
                                    sharedTopics,
                                    `Shared topics: ${sharedTopics.join(", ")}`,
                                ),
                            );
                        }
                    }
                }

                if (relatedPages.length >= maxResults) break;
            }
        } catch (error) {
            console.warn("Error finding topic relationships:", error);
        }

        // Remove duplicates and sort by similarity
        const uniquePages = this.removeDuplicatePages(relatedPages);
        const topPages = uniquePages
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxResults);

        return this.createRelationshipResult(
            topPages,
            relationships.slice(0, maxResults),
            topPages.length > 0
                ? Math.max(...topPages.map((p) => p.similarity))
                : 0,
            "topic",
        );
    }

    /**
     * Find pages with similar entities
     */
    private async findEntityBasedRelationships(
        entities: any[],
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number,
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Simple entity matching
            const websites = websiteCollection.messages.getAll();
            for (const website of websites) {
                const metadata = website.metadata as website.WebsiteDocPartMeta;
                if (metadata.url !== currentUrl) {
                    const knowledge = website.getKnowledge();
                    if (knowledge && knowledge.entities) {
                        const sharedEntities = this.findSharedEntities(
                            entities,
                            knowledge.entities || [],
                        );

                        if (sharedEntities.length > 0) {
                            const similarity = this.calculateEntitySimilarity(
                                entities,
                                knowledge.entities || [],
                            );

                            relatedPages.push(
                                this.createRelatedPage(
                                    metadata.url,
                                    metadata.title || metadata.url,
                                    similarity,
                                    "entity-overlap",
                                    sharedEntities,
                                    {
                                        visitCount: 1,
                                        lastVisited:
                                            metadata.visitDate ||
                                            metadata.bookmarkDate ||
                                            new Date().toISOString(),
                                        source: this.mapWebsiteSource(
                                            metadata.websiteSource,
                                        ),
                                    },
                                ),
                            );

                            relationships.push(
                                this.createCrossPageRelationship(
                                    currentUrl,
                                    metadata.url,
                                    "entity-overlap",
                                    similarity,
                                    sharedEntities,
                                    [],
                                    `Shared entities: ${sharedEntities.join(", ")}`,
                                ),
                            );
                        }
                    }
                }

                if (relatedPages.length >= maxResults) break;
            }
        } catch (error) {
            console.warn("Error finding entity relationships:", error);
        }

        const uniquePages = this.removeDuplicatePages(relatedPages);
        const topPages = uniquePages
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxResults);

        return this.createRelationshipResult(
            topPages,
            relationships.slice(0, maxResults),
            topPages.length > 0
                ? Math.max(...topPages.map((p) => p.similarity))
                : 0,
            "entity",
        );
    }

    /**
     * Find technically similar pages (code content, APIs, etc.)
     */
    private async findTechnicalRelationships(
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number,
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Simple technical content matching
            const websites = websiteCollection.messages.getAll();
            for (const website of websites) {
                const metadata = website.metadata as website.WebsiteDocPartMeta;
                if (metadata.url !== currentUrl) {
                    const knowledge = website.getKnowledge();

                    // Check if this page likely has technical content
                    const hasTechnicalContent = this.assessTechnicalContent(
                        knowledge,
                        website,
                    );

                    if (hasTechnicalContent.score > 0.3) {
                        relatedPages.push(
                            this.createRelatedPage(
                                metadata.url,
                                metadata.title || metadata.url,
                                hasTechnicalContent.score,
                                "technical-similarity",
                                hasTechnicalContent.indicators,
                                {
                                    visitCount: 1,
                                    lastVisited:
                                        metadata.visitDate ||
                                        metadata.bookmarkDate ||
                                        new Date().toISOString(),
                                    source: this.mapWebsiteSource(
                                        metadata.websiteSource,
                                    ),
                                },
                            ),
                        );

                        relationships.push(
                            this.createCrossPageRelationship(
                                currentUrl,
                                metadata.url,
                                "technical-similarity",
                                hasTechnicalContent.score,
                                [],
                                [],
                                `Both contain technical content: ${hasTechnicalContent.indicators.join(", ")}`,
                            ),
                        );
                    }
                }

                if (relatedPages.length >= maxResults) break;
            }
        } catch (error) {
            console.warn("Error finding technical relationships:", error);
        }

        const topPages = relatedPages
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxResults);

        return this.createRelationshipResult(
            topPages,
            relationships.slice(0, maxResults),
            topPages.length > 0
                ? Math.max(...topPages.map((p) => p.similarity))
                : 0,
            "technical",
        );
    }

    /**
     * Find temporally related pages (recent visits, sequences)
     */
    private async findTemporalRelationships(
        currentUrl: string,
        currentKnowledge: any,
        websiteCollection: website.WebsiteCollection,
        maxResults: number,
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Simple recent date filtering
            const websites = websiteCollection.messages.getAll();
            const now = new Date();
            const recentThreshold = new Date(
                now.getTime() - 7 * 24 * 60 * 60 * 1000,
            );

            for (const website of websites) {
                const metadata = website.metadata as website.WebsiteDocPartMeta;
                const websiteUrl = metadata.url;
                const visitDate = metadata.visitDate || metadata.bookmarkDate;

                if (websiteUrl !== currentUrl && visitDate) {
                    const websiteDate = new Date(visitDate);
                    if (websiteDate > recentThreshold) {
                        const daysDiff = this.calculateDaysDifference(
                            visitDate,
                            now.toISOString(),
                        );
                        const temporalScore = Math.max(0, 1 - daysDiff / 7);

                        relatedPages.push(
                            this.createRelatedPage(
                                websiteUrl,
                                metadata.title || websiteUrl,
                                temporalScore,
                                "temporal-sequence",
                                [`Visited ${daysDiff} days ago`],
                                {
                                    visitCount: 1,
                                    lastVisited: visitDate,
                                    source: this.mapWebsiteSource(
                                        metadata.websiteSource,
                                    ),
                                },
                            ),
                        );

                        relationships.push(
                            this.createCrossPageRelationship(
                                currentUrl,
                                websiteUrl,
                                "temporal-proximity",
                                temporalScore,
                                [],
                                [],
                                `Recently visited (${daysDiff} days ago)`,
                            ),
                        );
                    }
                }

                if (relatedPages.length >= maxResults) break;
            }
        } catch (error) {
            console.warn("Error finding temporal relationships:", error);
        }

        return this.createRelationshipResult(
            relatedPages,
            relationships,
            relatedPages.length > 0 ? 0.6 : 0,
            "temporal",
        );
    }

    // Helper methods
    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }

    private mapWebsiteSource(
        websiteSource: string | undefined,
    ): "history" | "bookmark" {
        if (websiteSource === "bookmark" || websiteSource === "reading_list") {
            return "bookmark";
        }
        return "history";
    }

    private calculateDomainSimilarity(url1: string, url2: string): number {
        const domain1 = this.extractDomain(url1);
        const domain2 = this.extractDomain(url2);
        return domain1 === domain2 ? 0.9 : 0;
    }

    private findSharedTopics(topics1: string[], topics2: string[]): string[] {
        return topics1.filter((topic) =>
            topics2.some(
                (t2) =>
                    t2.toLowerCase().includes(topic.toLowerCase()) ||
                    topic.toLowerCase().includes(t2.toLowerCase()),
            ),
        );
    }

    private calculateTopicSimilarity(
        topics1: string[],
        topics2: string[],
    ): number {
        const shared = this.findSharedTopics(topics1, topics2);
        const total = new Set([...topics1, ...topics2]).size;
        return total > 0
            ? shared.length / Math.min(topics1.length, topics2.length)
            : 0;
    }

    private findSharedEntities(entities1: any[], entities2: any[]): string[] {
        const names1 = entities1.map((e) => e.name.toLowerCase());
        const names2 = entities2.map((e) => e.name.toLowerCase());
        return names1.filter((name) => names2.includes(name));
    }

    private calculateEntitySimilarity(
        entities1: any[],
        entities2: any[],
    ): number {
        const shared = this.findSharedEntities(entities1, entities2);
        return shared.length / Math.min(entities1.length, entities2.length);
    }

    private assessTechnicalContent(
        knowledge: any,
        website: any,
    ): { score: number; indicators: string[] } {
        const indicators: string[] = [];
        let score = 0;

        // Check for technical terms in topics
        const technicalTopics = (knowledge?.topics || []).filter(
            (topic: string) =>
                /code|api|function|class|method|programming|software|development/i.test(
                    topic,
                ),
        );
        if (technicalTopics.length > 0) {
            score += 0.4;
            indicators.push("technical topics");
        }

        // Check for technical entities
        const technicalEntities = (knowledge?.entities || []).filter(
            (entity: any) =>
                /api|function|class|method|library|framework/i.test(
                    entity.type,
                ),
        );
        if (technicalEntities.length > 0) {
            score += 0.3;
            indicators.push("technical entities");
        }

        // Check URL patterns
        if (
            /github|stackoverflow|docs?\.|api\.|dev\.|developer/i.test(
                website.metadata.url,
            )
        ) {
            score += 0.3;
            indicators.push("technical domain");
        }

        return { score: Math.min(score, 1), indicators };
    }

    private calculateDaysDifference(date1: string, date2: string): number {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffTime = Math.abs(d2.getTime() - d1.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    private removeDuplicatePages(pages: RelatedPage[]): RelatedPage[] {
        const seen = new Set<string>();
        return pages.filter((page) => {
            if (seen.has(page.url)) {
                return false;
            }
            seen.add(page.url);
            return true;
        });
    }

    // === HELPER METHODS ===

    /**
     * Create a RelatedPage with default quality indicators
     */
    private createRelatedPage(
        url: string,
        title: string,
        similarity: number,
        relationshipType: RelatedPage["relationshipType"],
        sharedElements: string[],
        visitInfo: RelatedPage["visitInfo"],
    ): RelatedPage {
        return {
            url,
            title,
            similarity,
            relationshipType,
            sharedElements,
            visitInfo,
            qualityIndicators: {
                contentRichness: 0.5,
                topicSpecificity: 0.5,
                technicalDepth: 0.5,
                informationDensity: 0.5,
                overallQuality: 0.5,
            },
            correlationScore: similarity,
        };
    }

    /**
     * Create a CrossPageRelationship with default confidence factors
     */
    private createCrossPageRelationship(
        sourceUrl: string,
        targetUrl: string,
        relationshipType: string,
        strength: number,
        sharedEntities: string[],
        sharedTopics: string[],
        description: string,
    ): CrossPageRelationship {
        return {
            sourceUrl,
            targetUrl,
            relationshipType,
            strength,
            sharedEntities,
            sharedTopics,
            description,
            confidenceFactors: {
                sharedElementsWeight: Math.min(
                    1.0,
                    (sharedEntities.length + sharedTopics.length) / 5,
                ),
                temporalProximity: 0.5,
                contentSimilarity: 0.5,
                structuralAlignment: 0.5,
                domainRelevance: 0.5,
                combinedConfidence: strength,
            },
            qualityScore: strength,
        };
    }

    /**
     * Create a RelationshipResult with default correlation metrics
     */
    private createRelationshipResult(
        relatedPages: RelatedPage[],
        relationships: CrossPageRelationship[],
        confidence: number,
        analysisType: RelationshipResult["analysisType"],
    ): RelationshipResult {
        return {
            relatedPages,
            relationships,
            confidence,
            analysisType,
            qualityScore: confidence,
            correlationMetrics: {
                semanticSimilarity: 0.5,
                structuralSimilarity: 0.5,
                temporalRelevance: 0.5,
                contentDepthAlignment: 0.5,
                topicCoherence: 0.5,
                overallScore: confidence,
            },
        };
    }

    // === ADVANCED CORRELATION METHODS ===

    /**
     * Calculate semantic similarity based on shared topics and entities
     */
    private calculateSemanticSimilarity(
        result: RelationshipResult,
        currentKnowledge: any,
    ): number {
        if (result.relatedPages.length === 0) return 0;

        let totalSimilarity = 0;
        let count = 0;

        for (const page of result.relatedPages) {
            const sharedTopicsRatio =
                page.sharedElements.length /
                Math.max(currentKnowledge.keyTopics?.length || 1, 1);
            totalSimilarity += Math.min(1.0, sharedTopicsRatio);
            count++;
        }

        return count > 0 ? totalSimilarity / count : 0;
    }

    /**
     * Calculate structural similarity based on page characteristics
     */
    private calculateStructuralSimilarity(
        result: RelationshipResult,
        currentUrl: string,
    ): number {
        if (result.relatedPages.length === 0) return 0;

        const currentDomain = this.extractDomain(currentUrl);
        let structuralScore = 0;
        let count = 0;

        for (const page of result.relatedPages) {
            let pageScore = 0;

            // Same domain bonus
            if (this.extractDomain(page.url) === currentDomain) {
                pageScore += 0.4;
            }

            // Relationship type alignment
            switch (page.relationshipType) {
                case "same-domain":
                    pageScore += 0.3;
                    break;
                case "topic-match":
                    pageScore += 0.4;
                    break;
                case "technical-similarity":
                    pageScore += 0.3;
                    break;
                default:
                    pageScore += 0.2;
            }

            // Visit source consistency
            if (page.visitInfo.source === "bookmark") {
                pageScore += 0.2; // Bookmarked content tends to be higher quality
            }

            structuralScore += Math.min(1.0, pageScore);
            count++;
        }

        return count > 0 ? structuralScore / count : 0;
    }

    /**
     * Calculate temporal relevance based on visit patterns
     */
    private calculateTemporalRelevance(result: RelationshipResult): number {
        if (result.relatedPages.length === 0) return 0;

        const now = new Date();
        let temporalScore = 0;
        let count = 0;

        for (const page of result.relatedPages) {
            const daysSinceVisit = this.calculateDaysDifference(
                page.visitInfo.lastVisited,
                now.toISOString(),
            );

            // Fresher content gets higher score (decay over 90 days)
            const freshnessFactor = Math.max(0, 1 - daysSinceVisit / 90);

            // Multiple visits indicate higher relevance
            const visitFactor = Math.min(1.0, page.visitInfo.visitCount / 5);

            temporalScore += freshnessFactor * 0.7 + visitFactor * 0.3;
            count++;
        }

        return count > 0 ? temporalScore / count : 0;
    }

    /**
     * Calculate content depth alignment
     */
    private calculateContentDepthAlignment(
        result: RelationshipResult,
        currentKnowledge: any,
    ): number {
        if (result.relatedPages.length === 0) return 0;

        // Estimate current content technical depth
        const currentDepth = this.estimateContentDepth(currentKnowledge);

        let alignmentScore = 0;
        let count = 0;

        for (const page of result.relatedPages) {
            const pageDepth = this.estimatePageDepth(page);

            // Calculate alignment (closer depths = higher score)
            const depthDifference = Math.abs(currentDepth - pageDepth);
            const alignmentFactor = Math.max(0, 1 - depthDifference / 1.0); // Normalize to 0-1

            alignmentScore += alignmentFactor;
            count++;
        }

        return count > 0 ? alignmentScore / count : 0;
    }

    /**
     * Calculate topic coherence across related pages
     */
    private calculateTopicCoherence(result: RelationshipResult): number {
        if (result.relatedPages.length < 2) return 1.0; // Perfect coherence for single page

        // Extract all shared elements across pages
        const allSharedElements = new Set<string>();
        for (const page of result.relatedPages) {
            page.sharedElements.forEach((element) =>
                allSharedElements.add(element),
            );
        }

        if (allSharedElements.size === 0) return 0;

        // Calculate how consistently topics appear across pages
        let coherenceScore = 0;
        for (const element of allSharedElements) {
            const pageCount = result.relatedPages.filter((page) =>
                page.sharedElements.includes(element),
            ).length;

            const consistency = pageCount / result.relatedPages.length;
            coherenceScore += consistency;
        }

        return coherenceScore / allSharedElements.size;
    }

    /**
     * Calculate weighted correlation score
     */
    private calculateWeightedCorrelationScore(
        metrics: Omit<CorrelationMetrics, "overallScore">,
    ): number {
        // Weights based on importance for relationship quality
        const weights = {
            semanticSimilarity: 0.3,
            structuralSimilarity: 0.2,
            temporalRelevance: 0.2,
            contentDepthAlignment: 0.15,
            topicCoherence: 0.15,
        };

        return (
            metrics.semanticSimilarity * weights.semanticSimilarity +
            metrics.structuralSimilarity * weights.structuralSimilarity +
            metrics.temporalRelevance * weights.temporalRelevance +
            metrics.contentDepthAlignment * weights.contentDepthAlignment +
            metrics.topicCoherence * weights.topicCoherence
        );
    }

    /**
     * Calculate quality indicators for page
     */
    private calculateTopicSpecificity(sharedElements: string[]): number {
        if (sharedElements.length === 0) return 0;

        // More specific topics (longer, technical terms) get higher scores
        let specificityScore = 0;
        for (const element of sharedElements) {
            let elementScore = 0;

            // Length indicates specificity
            if (element.length > 10) elementScore += 0.3;
            else if (element.length > 5) elementScore += 0.2;
            else elementScore += 0.1;

            // Technical terms are more specific
            if (
                /api|framework|library|algorithm|architecture|pattern/i.test(
                    element,
                )
            ) {
                elementScore += 0.4;
            }

            // Domain-specific terms
            if (
                /react|javascript|python|machine.*learning|neural.*network/i.test(
                    element,
                )
            ) {
                elementScore += 0.3;
            }

            specificityScore += Math.min(1.0, elementScore);
        }

        return specificityScore / sharedElements.length;
    }

    private calculateTechnicalDepth(page: RelatedPage): number {
        let depth = 0;

        // Technical relationship types indicate depth
        if (page.relationshipType === "technical-similarity") {
            depth += 0.5;
        }

        // Technical shared elements
        const technicalElements = page.sharedElements.filter((element) =>
            /code|api|function|class|programming|development|architecture/i.test(
                element,
            ),
        );
        depth += Math.min(0.5, technicalElements.length / 5);

        return Math.min(1.0, depth);
    }

    private calculateInformationDensity(page: RelatedPage): number {
        // Estimate based on shared elements richness and visit patterns
        let density = 0;

        // More shared elements indicate higher information density
        density += Math.min(0.4, page.sharedElements.length / 10);

        // Multiple visits suggest valuable content
        density += Math.min(0.3, page.visitInfo.visitCount / 5);

        // Bookmarked content tends to be more information-dense
        if (page.visitInfo.source === "bookmark") {
            density += 0.3;
        }

        return Math.min(1.0, density);
    }

    private calculateWeightedQualityScore(
        indicators: Omit<QualityIndicators, "overallQuality">,
    ): number {
        const weights = {
            contentRichness: 0.3,
            topicSpecificity: 0.25,
            technicalDepth: 0.25,
            informationDensity: 0.2,
        };

        return (
            indicators.contentRichness * weights.contentRichness +
            indicators.topicSpecificity * weights.topicSpecificity +
            indicators.technicalDepth * weights.technicalDepth +
            indicators.informationDensity * weights.informationDensity
        );
    }

    private calculatePageCorrelationScore(
        page: RelatedPage,
        quality: QualityIndicators,
    ): number {
        // Combine similarity with quality for enhanced correlation
        return page.similarity * 0.6 + quality.overallQuality * 0.4;
    }

    private calculateOverallQualityScore(
        metrics: CorrelationMetrics,
        pages: RelatedPage[],
    ): number {
        if (pages.length === 0) return 0;

        const avgPageQuality =
            pages.reduce(
                (sum, page) => sum + page.qualityIndicators.overallQuality,
                0,
            ) / pages.length;

        // Combine correlation metrics with page quality
        return metrics.overallScore * 0.7 + avgPageQuality * 0.3;
    }

    private enhanceRelationshipWithConfidence(
        relationship: CrossPageRelationship,
        metrics: CorrelationMetrics,
    ): CrossPageRelationship {
        const confidenceFactors: ConfidenceFactors = {
            sharedElementsWeight: Math.min(
                1.0,
                relationship.sharedTopics.length / 5,
            ),
            temporalProximity: metrics.temporalRelevance,
            contentSimilarity: metrics.semanticSimilarity,
            structuralAlignment: metrics.structuralSimilarity,
            domainRelevance:
                relationship.relationshipType === "same-domain" ? 1.0 : 0.5,
            combinedConfidence: metrics.overallScore,
        };

        return {
            ...relationship,
            confidenceFactors,
            qualityScore: metrics.overallScore,
        };
    }

    private estimateContentDepth(knowledge: any): number {
        let depth = 0.5; // baseline

        // Technical entities increase depth
        if (knowledge.entities) {
            const techEntities = knowledge.entities.filter((e: any) =>
                /api|framework|architecture|algorithm/i.test(e.type),
            );
            depth += Math.min(0.3, techEntities.length / 5);
        }

        // Advanced topics increase depth
        if (knowledge.keyTopics) {
            const advancedTopics = knowledge.keyTopics.filter((topic: string) =>
                /advanced|expert|architecture|internals|deep/i.test(topic),
            );
            depth += Math.min(0.2, advancedTopics.length / 3);
        }

        return Math.min(1.0, depth);
    }

    private estimatePageDepth(page: RelatedPage): number {
        let depth = 0.5; // baseline

        if (page.relationshipType === "technical-similarity") {
            depth += 0.3;
        }

        // Technical shared elements
        const techElements = page.sharedElements.filter((element) =>
            /advanced|expert|architecture|algorithm|deep/i.test(element),
        );
        depth += Math.min(0.2, techElements.length / 3);

        return Math.min(1.0, depth);
    }
}
