// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import * as kp from "knowpro";
import * as website from "website-memory";

export interface RelationshipResult {
    relatedPages: RelatedPage[];
    relationships: CrossPageRelationship[];
    confidence: number;
    analysisType: "domain" | "topic" | "entity" | "temporal" | "technical";
}

export interface RelatedPage {
    url: string;
    title: string;
    similarity: number;
    relationshipType: "same-domain" | "topic-match" | "entity-overlap" | "temporal-sequence" | "technical-similarity";
    sharedElements: string[];
    visitInfo: {
        visitCount: number;
        lastVisited: string;
        source: "history" | "bookmark";
    };
}

export interface CrossPageRelationship {
    sourceUrl: string;
    targetUrl: string;
    relationshipType: string;
    strength: number;
    sharedEntities: string[];
    sharedTopics: string[];
    description: string;
}

export class RelationshipDiscovery {
    private context: SessionContext<BrowserActionContext>;

    constructor(context: SessionContext<BrowserActionContext>) {
        this.context = context;
    }

    /**
     * Discover relationships for a given page using the website collection
     */
    async discoverRelationships(
        currentUrl: string,
        currentKnowledge: any,
        maxResults: number = 10
    ): Promise<RelationshipResult[]> {
        const websiteCollection = this.context.agentContext.websiteCollection;
        
        if (!websiteCollection || websiteCollection.messages.length === 0) {
            return [];
        }

        const results: RelationshipResult[] = [];

        // 1. Domain-based relationships
        const domainResults = await this.findDomainBasedRelationships(currentUrl, websiteCollection, maxResults);
        if (domainResults.relatedPages.length > 0) {
            results.push(domainResults);
        }

        // 2. Topic-based relationships
        if (currentKnowledge.keyTopics && currentKnowledge.keyTopics.length > 0) {
            const topicResults = await this.findTopicBasedRelationships(
                currentKnowledge.keyTopics,
                currentUrl,
                websiteCollection,
                maxResults
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
                maxResults
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
                maxResults
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
            maxResults
        );
        if (temporalResults.relatedPages.length > 0) {
            results.push(temporalResults);
        }

        return results.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Find pages from the same domain
     */
    private async findDomainBasedRelationships(
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number
    ): Promise<RelationshipResult> {
        const currentDomain = this.extractDomain(currentUrl);
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Use DataFrames to query visit frequency for same domain (if available)
            if (websiteCollection.visitFrequency && 'query' in websiteCollection.visitFrequency) {
                const domainQuery = `
                    SELECT sourceRef, visitCount, lastVisitDate, domain
                    FROM visitFrequency 
                    WHERE domain = ? AND sourceRef != ?
                    ORDER BY visitCount DESC, lastVisitDate DESC
                    LIMIT ?
                `;
                
                const domainData = await (websiteCollection.visitFrequency as any).query(
                    domainQuery, 
                    [currentDomain, currentUrl, maxResults]
                );

                for (const row of domainData) {
                    // Get the actual website object for this sourceRef
                    const websites = websiteCollection.messages.getAll();
                    const website = websites.find((site: any) => 
                        site.metadata.url === row.sourceRef || 
                        site.metadata.sourceRef === row.sourceRef
                    );

                    if (website) {
                        relatedPages.push({
                            url: website.metadata.url,
                            title: website.metadata.title || website.metadata.url,
                            similarity: this.calculateDomainSimilarity(currentUrl, website.metadata.url),
                            relationshipType: "same-domain",
                            sharedElements: [currentDomain],
                            visitInfo: {
                                visitCount: row.visitCount || 1,
                                lastVisited: row.lastVisitDate || website.metadata.visitDate,
                                source: this.mapWebsiteSource(website.metadata.websiteSource)
                            }
                        });

                        relationships.push({
                            sourceUrl: currentUrl,
                            targetUrl: website.metadata.url,
                            relationshipType: "same-domain",
                            strength: 0.8,
                            sharedEntities: [],
                            sharedTopics: [],
                            description: `Both pages are from ${currentDomain}`
                        });
                    }
                }
            } else {
                // Fallback: simple domain matching without DataFrames
                const websites = websiteCollection.messages.getAll();
                for (const website of websites.slice(0, maxResults)) {
                    const websiteUrl = website.metadata.url;
                    const websiteDomain = this.extractDomain(websiteUrl);
                    
                    if (websiteDomain === currentDomain && websiteUrl !== currentUrl) {
                        relatedPages.push({
                            url: websiteUrl,
                            title: website.metadata.title || websiteUrl,
                            similarity: this.calculateDomainSimilarity(currentUrl, websiteUrl),
                            relationshipType: "same-domain",
                            sharedElements: [currentDomain],
                            visitInfo: {
                                visitCount: 1,
                                lastVisited: website.metadata.visitDate || website.metadata.bookmarkDate || new Date().toISOString(),
                                source: this.mapWebsiteSource(website.metadata.websiteSource)
                            }
                        });

                        relationships.push({
                            sourceUrl: currentUrl,
                            targetUrl: websiteUrl,
                            relationshipType: "same-domain",
                            strength: 0.8,
                            sharedEntities: [],
                            sharedTopics: [],
                            description: `Both pages are from ${currentDomain}`
                        });
                    }
                }
            }
        } catch (error) {
            console.warn("Error querying domain relationships:", error);
        }

        return {
            relatedPages,
            relationships,
            confidence: relatedPages.length > 0 ? 0.8 : 0,
            analysisType: "domain"
        };
    }

    /**
     * Find pages with similar topics using KnowPro semantic search
     */
    private async findTopicBasedRelationships(
        topics: string[],
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Use KnowPro to find semantically similar content
            for (const topic of topics.slice(0, 3)) { // Limit to top 3 topics
                const searchResults = await kp.searchConversationKnowledge(
                    websiteCollection,
                    {
                        booleanOp: "and",
                        terms: [{ term: { text: topic } }],
                    },
                    {},
                    {
                        exactMatch: false
                    }
                );

                if (searchResults && searchResults.size > 0) {
                    const processedMessages = new Set<number>();
                    let resultsFound = 0;
                    
                    searchResults.forEach((match: any) => {
                        if (resultsFound >= Math.ceil(maxResults / topics.length)) return;
                        
                        match.semanticRefMatches?.forEach((refMatch: any) => {
                            if (resultsFound >= Math.ceil(maxResults / topics.length)) return;
                            if (refMatch.score >= 0.3) {
                                const semanticRef = websiteCollection.semanticRefs?.get(refMatch.semanticRefOrdinal);
                                if (semanticRef) {
                                    const messageOrdinal = semanticRef.range.start.messageOrdinal;
                                    if (messageOrdinal !== undefined && !processedMessages.has(messageOrdinal)) {
                                        processedMessages.add(messageOrdinal);
                                        
                                        const website = websiteCollection.messages.get(messageOrdinal);
                                        if (website && website.metadata && website.metadata.url !== currentUrl) {
                                            const knowledge = website.getKnowledge();
                                            if (knowledge && knowledge.topics) {
                                                const sharedTopics = this.findSharedTopics(topics, knowledge.topics || []);
                                            
                                            if (sharedTopics.length > 0) {
                                                const similarity = this.calculateTopicSimilarity(topics, knowledge.topics || []);
                                                
                                                relatedPages.push({
                                                    url: website.metadata.url,
                                                    title: website.metadata.title || website.metadata.url,
                                                    similarity,
                                                    relationshipType: "topic-match",
                                                    sharedElements: sharedTopics,
                                                    visitInfo: {
                                                        visitCount: 1,
                                                        lastVisited: website.metadata.visitDate || website.metadata.bookmarkDate || new Date().toISOString(),
                                                        source: this.mapWebsiteSource(website.metadata.websiteSource)
                                                    }
                                                });

                                                relationships.push({
                                                    sourceUrl: currentUrl,
                                                    targetUrl: website.metadata.url,
                                                    relationshipType: "topic-similarity",
                                                    strength: similarity,
                                                    sharedEntities: [],
                                                    sharedTopics,
                                                    description: `Shared topics: ${sharedTopics.join(", ")}`
                                                });
                                                
                                                resultsFound++;
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    });
                }
            }
        } catch (error) {
            console.warn("Error finding topic relationships:", error);
        }

        // Remove duplicates and sort by similarity
        const uniquePages = this.removeDuplicatePages(relatedPages);
        const topPages = uniquePages.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);

        return {
            relatedPages: topPages,
            relationships: relationships.slice(0, maxResults),
            confidence: topPages.length > 0 ? Math.max(...topPages.map(p => p.similarity)) : 0,
            analysisType: "topic"
        };
    }

    /**
     * Find pages with similar entities
     */
    private async findEntityBasedRelationships(
        entities: any[],
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Search for pages containing similar entities
            const entityNames = entities.map(e => e.name).slice(0, 5); // Top 5 entities
            
            for (const entityName of entityNames) {
                const searchResults = await kp.searchConversationKnowledge(
                    websiteCollection,
                    {
                        booleanOp: "and",
                        terms: [{ term: { text: entityName } }],
                    },
                    {},
                    {
                        exactMatch: false
                    }
                );

                if (searchResults && searchResults.size > 0) {
                    const processedMessages = new Set<number>();
                    let resultsFound = 0;
                    
                    searchResults.forEach((match: any) => {
                        if (resultsFound >= Math.ceil(maxResults / entityNames.length)) return;
                        
                        match.semanticRefMatches?.forEach((refMatch: any) => {
                            if (resultsFound >= Math.ceil(maxResults / entityNames.length)) return;
                            if (refMatch.score >= 0.3) {
                                const semanticRef = websiteCollection.semanticRefs?.get(refMatch.semanticRefOrdinal);
                                if (semanticRef) {
                                    const messageOrdinal = semanticRef.range.start.messageOrdinal;
                                    if (messageOrdinal !== undefined && !processedMessages.has(messageOrdinal)) {
                                        processedMessages.add(messageOrdinal);
                                        
                                        const website = websiteCollection.messages.get(messageOrdinal);
                                        if (website && website.metadata && website.metadata.url !== currentUrl) {
                                            const knowledge = website.getKnowledge();
                                            if (knowledge && knowledge.entities) {
                                                const sharedEntities = this.findSharedEntities(
                                                entities,
                                                knowledge.entities || []
                                            );
                                            
                                            if (sharedEntities.length > 0) {
                                                const similarity = this.calculateEntitySimilarity(entities, knowledge.entities || []);
                                                
                                                relatedPages.push({
                                                    url: website.metadata.url,
                                                    title: website.metadata.title || website.metadata.url,
                                                    similarity,
                                                    relationshipType: "entity-overlap",
                                                    sharedElements: sharedEntities,
                                                    visitInfo: {
                                                        visitCount: 1,
                                                        lastVisited: website.metadata.visitDate || website.metadata.bookmarkDate || new Date().toISOString(),
                                                        source: this.mapWebsiteSource(website.metadata.websiteSource)
                                                    }
                                                });

                                                relationships.push({
                                                    sourceUrl: currentUrl,
                                                    targetUrl: website.metadata.url,
                                                    relationshipType: "entity-overlap",
                                                    strength: similarity,
                                                    sharedEntities,
                                                    sharedTopics: [],
                                                    description: `Shared entities: ${sharedEntities.join(", ")}`
                                                });
                                                
                                                resultsFound++;
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    });
                }
            }
        } catch (error) {
            console.warn("Error finding entity relationships:", error);
        }

        const uniquePages = this.removeDuplicatePages(relatedPages);
        const topPages = uniquePages.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);

        return {
            relatedPages: topPages,
            relationships: relationships.slice(0, maxResults),
            confidence: topPages.length > 0 ? Math.max(...topPages.map(p => p.similarity)) : 0,
            analysisType: "entity"
        };
    }

    /**
     * Find technically similar pages (code content, APIs, etc.)
     */
    private async findTechnicalRelationships(
        currentUrl: string,
        websiteCollection: website.WebsiteCollection,
        maxResults: number
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Search for other pages with code content
            const technicalTerms = ["code", "API", "function", "class", "method", "tutorial", "documentation"];
            
            const searchResults = await kp.searchConversationKnowledge(
                websiteCollection,
                {
                    booleanOp: "or",
                    terms: technicalTerms.map(term => ({ term: { text: term } })),
                },
                {},
                {
                    exactMatch: false
                }
            );

            if (searchResults && searchResults.size > 0) {
                const processedMessages = new Set<number>();
                let resultsFound = 0;
                
                searchResults.forEach((match: any) => {
                    if (resultsFound >= maxResults * 2) return; // Get more to filter
                    
                    match.semanticRefMatches?.forEach((refMatch: any) => {
                        if (resultsFound >= maxResults * 2) return;
                        if (refMatch.score >= 0.3) {
                            const semanticRef = websiteCollection.semanticRefs?.get(refMatch.semanticRefOrdinal);
                            if (semanticRef) {
                                const messageOrdinal = semanticRef.range.start.messageOrdinal;
                                if (messageOrdinal !== undefined && !processedMessages.has(messageOrdinal)) {
                                    processedMessages.add(messageOrdinal);
                                    
                                    const website = websiteCollection.messages.get(messageOrdinal);
                                    if (website && website.metadata && website.metadata.url !== currentUrl) {
                                        const knowledge = website.getKnowledge();
                                        
                                        // Check if this page likely has technical content
                                        const hasTechnicalContent = this.assessTechnicalContent(knowledge, website);
                                        
                                        if (hasTechnicalContent.score > 0.3) {
                                            relatedPages.push({
                                                url: website.metadata.url,
                                                title: website.metadata.title || website.metadata.url,
                                                similarity: hasTechnicalContent.score,
                                                relationshipType: "technical-similarity",
                                                sharedElements: hasTechnicalContent.indicators,
                                                visitInfo: {
                                                    visitCount: 1,
                                                    lastVisited: website.metadata.visitDate || website.metadata.bookmarkDate || new Date().toISOString(),
                                                    source: this.mapWebsiteSource(website.metadata.websiteSource)
                                                }
                                            });

                                            relationships.push({
                                                sourceUrl: currentUrl,
                                                targetUrl: website.metadata.url,
                                                relationshipType: "technical-similarity",
                                                strength: hasTechnicalContent.score,
                                                sharedEntities: [],
                                                sharedTopics: [],
                                                description: `Both contain technical content: ${hasTechnicalContent.indicators.join(", ")}`
                                            });
                                            
                                            resultsFound++;
                                        }
                                    }
                                }
                            }
                        }
                    });
                });
            }
        } catch (error) {
            console.warn("Error finding technical relationships:", error);
        }

        const topPages = relatedPages.sort((a, b) => b.similarity - a.similarity).slice(0, maxResults);

        return {
            relatedPages: topPages,
            relationships: relationships.slice(0, maxResults),
            confidence: topPages.length > 0 ? Math.max(...topPages.map(p => p.similarity)) : 0,
            analysisType: "technical"
        };
    }

    /**
     * Find temporally related pages (recent visits, sequences)
     */
    private async findTemporalRelationships(
        currentUrl: string,
        currentKnowledge: any,
        websiteCollection: website.WebsiteCollection,
        maxResults: number
    ): Promise<RelationshipResult> {
        const relatedPages: RelatedPage[] = [];
        const relationships: CrossPageRelationship[] = [];

        try {
            // Find pages visited recently or in sequence
            if (websiteCollection.visitFrequency && 'query' in websiteCollection.visitFrequency) {
                const now = new Date();
                const recentThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
                
                const recentQuery = `
                    SELECT sourceRef, visitCount, lastVisitDate, domain
                    FROM visitFrequency 
                    WHERE lastVisitDate > ? AND sourceRef != ?
                    ORDER BY lastVisitDate DESC
                    LIMIT ?
                `;
                
                const recentData = await (websiteCollection.visitFrequency as any).query(
                    recentQuery, 
                    [recentThreshold.toISOString(), currentUrl, maxResults]
                );

                for (const row of recentData) {
                    const websites = websiteCollection.messages.getAll();
                    const website = websites.find((site: any) => 
                        site.metadata.url === row.sourceRef || 
                        site.metadata.sourceRef === row.sourceRef
                    );

                    if (website) {
                        const daysDiff = this.calculateDaysDifference(row.lastVisitDate, now.toISOString());
                        const temporalScore = Math.max(0, 1 - (daysDiff / 7)); // Decay over 7 days
                        
                        relatedPages.push({
                            url: website.metadata.url,
                            title: website.metadata.title || website.metadata.url,
                            similarity: temporalScore,
                            relationshipType: "temporal-sequence",
                            sharedElements: [`Visited ${daysDiff} days ago`],
                            visitInfo: {
                                visitCount: row.visitCount || 1,
                                lastVisited: row.lastVisitDate,
                                source: this.mapWebsiteSource(website.metadata.websiteSource)
                            }
                        });

                        relationships.push({
                            sourceUrl: currentUrl,
                            targetUrl: website.metadata.url,
                            relationshipType: "temporal-proximity",
                            strength: temporalScore,
                            sharedEntities: [],
                            sharedTopics: [],
                            description: `Recently visited (${daysDiff} days ago)`
                        });
                    }
                }
            } else {
                // Fallback: simple recent date filtering without DataFrames
                const websites = websiteCollection.messages.getAll();
                const now = new Date();
                const recentThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                
                for (const website of websites.slice(0, maxResults)) {
                    const websiteUrl = website.metadata.url;
                    const visitDate = website.metadata.visitDate || website.metadata.bookmarkDate;
                    
                    if (websiteUrl !== currentUrl && visitDate) {
                        const websiteDate = new Date(visitDate);
                        if (websiteDate > recentThreshold) {
                            const daysDiff = this.calculateDaysDifference(visitDate, now.toISOString());
                            const temporalScore = Math.max(0, 1 - (daysDiff / 7));
                            
                            relatedPages.push({
                                url: websiteUrl,
                                title: website.metadata.title || websiteUrl,
                                similarity: temporalScore,
                                relationshipType: "temporal-sequence",
                                sharedElements: [`Visited ${daysDiff} days ago`],
                                visitInfo: {
                                    visitCount: 1,
                                    lastVisited: visitDate,
                                    source: this.mapWebsiteSource(website.metadata.websiteSource)
                                }
                            });

                            relationships.push({
                                sourceUrl: currentUrl,
                                targetUrl: websiteUrl,
                                relationshipType: "temporal-proximity",
                                strength: temporalScore,
                                sharedEntities: [],
                                sharedTopics: [],
                                description: `Recently visited (${daysDiff} days ago)`
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("Error finding temporal relationships:", error);
        }

        return {
            relatedPages,
            relationships,
            confidence: relatedPages.length > 0 ? 0.6 : 0,
            analysisType: "temporal"
        };
    }

    // Helper methods
    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }

    private mapWebsiteSource(websiteSource: string | undefined): "history" | "bookmark" {
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
        return topics1.filter(topic => 
            topics2.some(t2 => t2.toLowerCase().includes(topic.toLowerCase()) || 
                             topic.toLowerCase().includes(t2.toLowerCase()))
        );
    }

    private calculateTopicSimilarity(topics1: string[], topics2: string[]): number {
        const shared = this.findSharedTopics(topics1, topics2);
        const total = new Set([...topics1, ...topics2]).size;
        return total > 0 ? shared.length / Math.min(topics1.length, topics2.length) : 0;
    }

    private findSharedEntities(entities1: any[], entities2: any[]): string[] {
        const names1 = entities1.map(e => e.name.toLowerCase());
        const names2 = entities2.map(e => e.name.toLowerCase());
        return names1.filter(name => names2.includes(name));
    }

    private calculateEntitySimilarity(entities1: any[], entities2: any[]): number {
        const shared = this.findSharedEntities(entities1, entities2);
        return shared.length / Math.min(entities1.length, entities2.length);
    }

    private assessTechnicalContent(knowledge: any, website: any): { score: number, indicators: string[] } {
        const indicators: string[] = [];
        let score = 0;

        // Check for technical terms in topics
        const technicalTopics = (knowledge.topics || []).filter((topic: string) =>
            /code|api|function|class|method|programming|software|development/i.test(topic)
        );
        if (technicalTopics.length > 0) {
            score += 0.4;
            indicators.push("technical topics");
        }

        // Check for technical entities
        const technicalEntities = (knowledge.entities || []).filter((entity: any) =>
            /api|function|class|method|library|framework/i.test(entity.type)
        );
        if (technicalEntities.length > 0) {
            score += 0.3;
            indicators.push("technical entities");
        }

        // Check URL patterns
        if (/github|stackoverflow|docs?\.|api\.|dev\.|developer/i.test(website.metadata.url)) {
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
        return pages.filter(page => {
            if (seen.has(page.url)) {
                return false;
            }
            seen.add(page.url);
            return true;
        });
    }
}
