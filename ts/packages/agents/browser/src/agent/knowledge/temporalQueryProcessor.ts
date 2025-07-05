// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import * as website from "website-memory";

export interface TemporalQuery {
    timeframe: "week" | "month" | "quarter" | "year" | "custom";
    startDate?: Date | undefined;
    endDate?: Date | undefined;
    queryType: "learned" | "visited" | "discovered" | "progression";
    originalQuery: string;
    extractedTimeTerms: string[];
}

export interface TemporalPattern {
    type:
        | "learning_sequence"
        | "topic_progression"
        | "domain_exploration"
        | "content_evolution";
    timespan: string;
    items: TemporalPatternItem[];
    confidence: number;
    description: string;
}

export interface TemporalPatternItem {
    url: string;
    title: string;
    visitDate: string;
    contentType: string;
    topics: string[];
    domain: string;
}

export class TemporalQueryProcessor {
    private context: SessionContext<BrowserActionContext>;

    constructor(context: SessionContext<BrowserActionContext>) {
        this.context = context;
    }

    /**
     * Parse a query string to extract temporal information
     */
    parseTemporalQuery(query: string): TemporalQuery {
        const lowerQuery = query.toLowerCase();
        let timeframe: TemporalQuery["timeframe"] = "month";
        let queryType: TemporalQuery["queryType"] = "learned";
        const extractedTimeTerms: string[] = [];
        let startDate: Date | undefined;
        let endDate: Date | undefined;

        // Parse timeframe indicators
        if (
            this.containsTerms(lowerQuery, [
                "last week",
                "this week",
                "past week",
                "week ago",
            ])
        ) {
            timeframe = "week";
            extractedTimeTerms.push("week");
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            startDate = weekAgo;
            endDate = new Date();
        } else if (
            this.containsTerms(lowerQuery, [
                "last month",
                "this month",
                "past month",
                "month ago",
            ])
        ) {
            timeframe = "month";
            extractedTimeTerms.push("month");
            const monthAgo = new Date();
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            startDate = monthAgo;
            endDate = new Date();
        } else if (
            this.containsTerms(lowerQuery, [
                "last quarter",
                "past 3 months",
                "quarter ago",
            ])
        ) {
            timeframe = "quarter";
            extractedTimeTerms.push("quarter");
            const quarterAgo = new Date();
            quarterAgo.setMonth(quarterAgo.getMonth() - 3);
            startDate = quarterAgo;
            endDate = new Date();
        } else if (
            this.containsTerms(lowerQuery, [
                "last year",
                "this year",
                "past year",
                "year ago",
            ])
        ) {
            timeframe = "year";
            extractedTimeTerms.push("year");
            const yearAgo = new Date();
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);
            startDate = yearAgo;
            endDate = new Date();
        } else if (
            this.containsTerms(lowerQuery, ["recent", "recently", "lately"])
        ) {
            timeframe = "month";
            extractedTimeTerms.push("recent");
            const recentThreshold = new Date();
            recentThreshold.setDate(recentThreshold.getDate() - 14); // Last 2 weeks
            startDate = recentThreshold;
            endDate = new Date();
        }

        // Parse query type indicators
        if (
            this.containsTerms(lowerQuery, [
                "learned",
                "learning",
                "studied",
                "education",
            ])
        ) {
            queryType = "learned";
        } else if (
            this.containsTerms(lowerQuery, [
                "visited",
                "browsed",
                "viewed",
                "looked at",
            ])
        ) {
            queryType = "visited";
        } else if (
            this.containsTerms(lowerQuery, [
                "discovered",
                "found",
                "explored",
                "new",
            ])
        ) {
            queryType = "discovered";
        } else if (
            this.containsTerms(lowerQuery, [
                "progression",
                "journey",
                "path",
                "evolution",
                "timeline",
            ])
        ) {
            queryType = "progression";
        }

        return {
            timeframe,
            startDate,
            endDate,
            queryType,
            originalQuery: query,
            extractedTimeTerms,
        };
    }

    /**
     * Analyze temporal patterns in browsing history
     */
    async analyzeTemporalPatterns(results: any[]): Promise<TemporalPattern[]> {
        const patterns: TemporalPattern[] = [];

        try {
            // Group results by time periods
            const timeGroups = this.groupResultsByTime(results);

            // Detect learning sequences
            const learningSequences = this.detectLearningSequences(timeGroups);
            patterns.push(...learningSequences);

            // Detect topic progression
            const topicProgressions = this.detectTopicProgression(timeGroups);
            patterns.push(...topicProgressions);

            // Detect domain exploration patterns
            const domainPatterns = this.detectDomainExploration(timeGroups);
            patterns.push(...domainPatterns);
        } catch (error) {
            console.warn("Error analyzing temporal patterns:", error);
        }

        return patterns.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Generate temporal suggestions based on user history
     */
    async generateTemporalSuggestions(
        websiteCollection: website.WebsiteCollection,
    ): Promise<string[]> {
        const suggestions: string[] = [];

        try {
            const websites = websiteCollection.messages.getAll();

            // Analyze recent activity
            const recentSites = this.getRecentSites(websites, 7); // Last week
            const recentDomains = this.extractUniqueDomains(recentSites);
            const recentTopics = this.extractUniqueTopics(recentSites);

            // Generate domain-based temporal suggestions
            if (recentDomains.length > 0) {
                recentDomains.slice(0, 2).forEach((domain) => {
                    suggestions.push(`What did I learn on ${domain} recently?`);
                    suggestions.push(`Show me my ${domain} browsing timeline`);
                });
            }

            // Generate topic-based temporal suggestions
            if (recentTopics.length > 0) {
                recentTopics.slice(0, 2).forEach((topic) => {
                    suggestions.push(
                        `How has my understanding of ${topic} evolved?`,
                    );
                    suggestions.push(`Show me recent ${topic} content`);
                });
            }

            // Add general temporal suggestions
            suggestions.push("What have I been learning lately?");
            suggestions.push("Show me this month's discoveries");
            suggestions.push("What topics did I explore last week?");
            suggestions.push("Display my recent learning progression");
        } catch (error) {
            console.warn("Error generating temporal suggestions:", error);
        }

        return suggestions.slice(0, 6);
    }

    /**
     * Apply temporal filtering to DataFrames queries
     */
    async applyTemporalFiltering(
        temporalQuery: TemporalQuery,
        websiteCollection: website.WebsiteCollection,
    ): Promise<string[]> {
        const filteredUrls: string[] = [];

        try {
            const websites = websiteCollection.messages.getAll();

            for (const website of websites) {
                const visitDate =
                    website.metadata.visitDate || website.metadata.bookmarkDate;
                if (!visitDate) continue;

                const siteDate = new Date(visitDate);

                // Apply date range filtering
                if (
                    temporalQuery.startDate &&
                    siteDate < temporalQuery.startDate
                )
                    continue;
                if (temporalQuery.endDate && siteDate > temporalQuery.endDate)
                    continue;

                // Apply query type filtering
                if (this.matchesQueryType(website, temporalQuery.queryType)) {
                    filteredUrls.push(website.metadata.url);
                }
            }
        } catch (error) {
            console.warn("Error applying temporal filtering:", error);
            // Use context for error reporting in the future
            const agentContext = this.context.agentContext;
            if (agentContext) {
                console.debug("Context available for enhanced error handling");
            }
        }

        return filteredUrls;
    }

    // Helper methods
    private containsTerms(text: string, terms: string[]): boolean {
        return terms.some((term) => text.includes(term));
    }

    private groupResultsByTime(results: any[]): Map<string, any[]> {
        const groups = new Map<string, any[]>();

        for (const result of results) {
            const visitDate =
                result.metadata.visitDate || result.metadata.bookmarkDate;
            if (!visitDate) continue;

            const date = new Date(visitDate);
            const weekKey = this.getWeekKey(date);

            if (!groups.has(weekKey)) {
                groups.set(weekKey, []);
            }
            groups.get(weekKey)!.push(result);
        }

        return groups;
    }

    private getWeekKey(date: Date): string {
        const startOfYear = new Date(date.getFullYear(), 0, 1);
        const weekNumber = Math.ceil(
            ((date.getTime() - startOfYear.getTime()) / 86400000 +
                startOfYear.getDay() +
                1) /
                7,
        );
        return `${date.getFullYear()}-W${weekNumber}`;
    }

    private detectLearningSequences(
        timeGroups: Map<string, any[]>,
    ): TemporalPattern[] {
        const patterns: TemporalPattern[] = [];

        // Look for sequences where content becomes progressively more advanced
        const sortedWeeks = Array.from(timeGroups.keys()).sort();

        for (let i = 0; i < sortedWeeks.length - 1; i++) {
            const currentWeek = timeGroups.get(sortedWeeks[i])!;
            const nextWeek = timeGroups.get(sortedWeeks[i + 1])!;

            const progressionScore = this.calculateProgressionScore(
                currentWeek,
                nextWeek,
            );

            if (progressionScore > 0.6) {
                patterns.push({
                    type: "learning_sequence",
                    timespan: `${sortedWeeks[i]} to ${sortedWeeks[i + 1]}`,
                    items: [...currentWeek, ...nextWeek].map(
                        this.convertToPatternItem,
                    ),
                    confidence: progressionScore,
                    description:
                        "Detected learning progression in content complexity",
                });
            }
        }

        return patterns;
    }

    private detectTopicProgression(
        timeGroups: Map<string, any[]>,
    ): TemporalPattern[] {
        const patterns: TemporalPattern[] = [];

        // Look for evolution within the same topic over time
        const topicTimelines = new Map<string, any[]>();

        for (const [week, sites] of timeGroups) {
            for (const site of sites) {
                const knowledge = site.getKnowledge();
                if (knowledge?.topics) {
                    for (const topic of knowledge.topics) {
                        if (!topicTimelines.has(topic)) {
                            topicTimelines.set(topic, []);
                        }
                        topicTimelines.get(topic)!.push({ ...site, week });
                    }
                }
            }
        }

        // Analyze topics with multiple entries over time
        for (const [topic, timeline] of topicTimelines) {
            if (timeline.length >= 3) {
                const sortedTimeline = timeline.sort(
                    (a, b) =>
                        new Date(
                            a.metadata.visitDate || a.metadata.bookmarkDate,
                        ).getTime() -
                        new Date(
                            b.metadata.visitDate || b.metadata.bookmarkDate,
                        ).getTime(),
                );

                patterns.push({
                    type: "topic_progression",
                    timespan: `${sortedTimeline[0].week} to ${sortedTimeline[sortedTimeline.length - 1].week}`,
                    items: sortedTimeline.map(this.convertToPatternItem),
                    confidence: Math.min(0.9, timeline.length * 0.15),
                    description: `Learning progression in ${topic}`,
                });
            }
        }

        return patterns;
    }

    private detectDomainExploration(
        timeGroups: Map<string, any[]>,
    ): TemporalPattern[] {
        const patterns: TemporalPattern[] = [];

        // Look for exploration patterns within domains
        const domainTimelines = new Map<string, any[]>();

        for (const [week, sites] of timeGroups) {
            for (const site of sites) {
                const domain = this.extractDomain(site.metadata.url);
                if (!domainTimelines.has(domain)) {
                    domainTimelines.set(domain, []);
                }
                domainTimelines.get(domain)!.push({ ...site, week });
            }
        }

        // Analyze domains with sustained exploration
        for (const [domain, timeline] of domainTimelines) {
            if (timeline.length >= 2) {
                const uniqueWeeks = new Set(timeline.map((item) => item.week));
                if (uniqueWeeks.size >= 2) {
                    patterns.push({
                        type: "domain_exploration",
                        timespan: Array.from(uniqueWeeks).sort().join(" to "),
                        items: timeline.map(this.convertToPatternItem),
                        confidence: Math.min(0.8, uniqueWeeks.size * 0.2),
                        description: `Sustained exploration of ${domain}`,
                    });
                }
            }
        }

        return patterns;
    }

    private calculateProgressionScore(
        currentWeek: any[],
        nextWeek: any[],
    ): number {
        // Simple heuristic: look for increase in technical content or complexity
        const currentComplexity = this.calculateAverageComplexity(currentWeek);
        const nextComplexity = this.calculateAverageComplexity(nextWeek);

        if (nextComplexity > currentComplexity) {
            return Math.min(0.9, (nextComplexity - currentComplexity) * 2);
        }
        return 0;
    }

    private calculateAverageComplexity(sites: any[]): number {
        let totalComplexity = 0;
        let count = 0;

        for (const site of sites) {
            const knowledge = site.getKnowledge();
            let complexity = 0.5; // Default complexity

            // Factors that increase complexity
            if (
                knowledge?.topics?.some((topic: string) =>
                    /advanced|expert|complex|deep|architecture|internals/i.test(
                        topic,
                    ),
                )
            ) {
                complexity += 0.3;
            }

            if (
                site.metadata.url.includes("docs") ||
                site.metadata.url.includes("documentation")
            ) {
                complexity += 0.2;
            }

            if (
                knowledge?.entities?.some((entity: any) =>
                    /api|framework|architecture|algorithm/i.test(entity.type),
                )
            ) {
                complexity += 0.2;
            }

            totalComplexity += Math.min(1.0, complexity);
            count++;
        }

        return count > 0 ? totalComplexity / count : 0.5;
    }

    private convertToPatternItem(site: any): TemporalPatternItem {
        const knowledge = site.getKnowledge();
        return {
            url: site.metadata.url,
            title: site.metadata.title || site.metadata.url,
            visitDate: site.metadata.visitDate || site.metadata.bookmarkDate,
            contentType: site.metadata.pageType || "unknown",
            topics: knowledge?.topics || [],
            domain: this.extractDomain(site.metadata.url),
        };
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }

    private getRecentSites(websites: any[], days: number): any[] {
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - days);

        return websites.filter((site: any) => {
            const visitDate =
                site.metadata.visitDate || site.metadata.bookmarkDate;
            if (!visitDate) return false;
            return new Date(visitDate) > threshold;
        });
    }

    private extractUniqueDomains(sites: any[]): string[] {
        const domains = new Set<string>();
        for (const site of sites) {
            domains.add(this.extractDomain(site.metadata.url));
        }
        return Array.from(domains);
    }

    private extractUniqueTopics(sites: any[]): string[] {
        const topics = new Set<string>();
        for (const site of sites) {
            const knowledge = site.getKnowledge();
            if (knowledge?.topics) {
                for (const topic of knowledge.topics) {
                    topics.add(topic);
                }
            }
        }
        return Array.from(topics);
    }

    private matchesQueryType(
        website: any,
        queryType: TemporalQuery["queryType"],
    ): boolean {
        const knowledge = website.getKnowledge();

        switch (queryType) {
            case "learned":
                // Educational or tutorial content
                return (
                    website.metadata.pageType === "tutorial" ||
                    website.metadata.pageType === "documentation" ||
                    knowledge?.topics?.some((topic: string) =>
                        /learn|tutorial|guide|course|education/i.test(topic),
                    ) ||
                    false
                );

            case "discovered":
                // New or exploratory content
                return (
                    website.metadata.websiteSource === "history" ||
                    knowledge?.topics?.some((topic: string) =>
                        /new|discover|explore|introduction/i.test(topic),
                    ) ||
                    false
                );

            case "progression":
                // Content indicating skill building
                return (
                    knowledge?.topics?.some((topic: string) =>
                        /advanced|intermediate|beginner|level|progression/i.test(
                            topic,
                        ),
                    ) || false
                );

            case "visited":
            default:
                return true; // All content counts as "visited"
        }
    }
}
