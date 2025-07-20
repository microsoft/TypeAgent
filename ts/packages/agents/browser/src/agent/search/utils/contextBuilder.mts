// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Website } from "website-memory";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:context-builder");

export interface SearchContext {
    query: string;
    totalResults: number;
    results: ResultContext[];
    patterns: {
        dominantDomains: Array<{ domain: string; count: number }>;
        timeRange?: { earliest?: string; latest?: string };
        hasKnowledge: boolean;
    };
}

export interface ResultContext {
    title: string;
    domain: string;
    snippet: string;
    visitCount?: number;
    lastVisited?: string;
    source: "bookmarks" | "history";
    hasKnowledge: boolean;
}

/**
 * ContextBuilder extracts meaningful context from search results for LLM processing
 */
export class ContextBuilder {
    
    /**
     * Build simplified context from search query and results
     */
    buildContext(query: string, results: Website[]): SearchContext {
        debug(`Building context for query: "${query}" with ${results.length} results`);
        
        // Extract basic result information
        const resultContexts = results.slice(0, 10).map(result => this.extractResultContext(result));
        
        // Analyze patterns in the results
        const patterns = this.analyzePatterns(results);
        
        const context: SearchContext = {
            query,
            totalResults: results.length,
            results: resultContexts,
            patterns
        };
        
        debug(`Context built: ${patterns.dominantDomains.length} domains, hasKnowledge: ${patterns.hasKnowledge}`);
        
        return context;
    }
    
    /**
     * Convert context to JSON string for LLM consumption
     */
    contextToString(context: SearchContext): string {
        return JSON.stringify(context, null, 2);
    }
    
    private extractResultContext(website: Website): ResultContext {
        const metadata = website.metadata as any;
        const knowledge = website.getKnowledge?.();
        
        return {
            title: this.truncateText(metadata.title || "", 100),
            domain: metadata.domain || "",
            snippet: this.truncateText(metadata.snippet || "", 200),
            visitCount: metadata.visitCount,
            lastVisited: metadata.lastVisited || metadata.visitDate || metadata.bookmarkDate,
            source: metadata.source || (metadata.bookmarkDate ? "bookmarks" : "history"),
            hasKnowledge: !!(knowledge && (knowledge.entities?.length > 0 || knowledge.topics?.length > 0))
        };
    }
    
    private analyzePatterns(results: Website[]): SearchContext["patterns"] {
        // Count domains
        const domainCounts = new Map<string, number>();
        let hasKnowledge = false;
        let earliestDate: string | undefined;
        let latestDate: string | undefined;
        
        for (const result of results) {
            const metadata = result.metadata as any;
            
            // Domain analysis
            if (metadata.domain) {
                const count = domainCounts.get(metadata.domain) || 0;
                domainCounts.set(metadata.domain, count + 1);
            }
            
            // Knowledge analysis
            const knowledge = result.getKnowledge?.();
            if (knowledge && (knowledge.entities?.length > 0 || knowledge.topics?.length > 0)) {
                hasKnowledge = true;
            }
            
            // Time analysis - check multiple possible date fields
            const dateFields = [metadata.lastVisited, metadata.visitDate, metadata.bookmarkDate];
            for (const dateField of dateFields) {
                if (dateField) {
                    if (!earliestDate || dateField < earliestDate) {
                        earliestDate = dateField;
                    }
                    if (!latestDate || dateField > latestDate) {
                        latestDate = dateField;
                    }
                    break; // Use the first available date field
                }
            }
        }
        
        // Convert domain counts to sorted array
        const dominantDomains = Array.from(domainCounts.entries())
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5); // Top 5 domains
        
        const result: SearchContext["patterns"] = {
            dominantDomains,
            hasKnowledge
        };
        
        if (earliestDate && latestDate) {
            result.timeRange = { earliest: earliestDate, latest: latestDate };
        }
        
        return result;
    }
    
    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + "...";
    }
}
