// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StoredAction,
    ActionSearchQuery,
    ActionSearchResult,
    SearchSuggestion,
    ActionFilter,
} from "./types.mjs";

/**
 * ActionSearchEngine - Advanced search and filtering for actions
 *
 * Provides fast, comprehensive search capabilities including:
 * - Text search across action names, descriptions, and tags
 * - Multi-criteria filtering
 * - Search result ranking and pagination
 * - Search suggestions and auto-complete
 * - Performance optimization with caching
 */
export class ActionSearchEngine {
    private searchIndex: Map<string, Set<string>> = new Map();
    private tagIndex: Map<string, Set<string>> = new Map();
    private domainIndex: Map<string, Set<string>> = new Map();
    private categoryIndex: Map<string, Set<string>> = new Map();
    private lastIndexUpdate: number = 0;
    private cacheStats = {
        searchCount: 0,
        cacheHits: 0,
        averageSearchTime: 0,
    };

    /**
     * Search actions with comprehensive filtering and ranking
     */
    async searchActions(
        query: ActionSearchQuery,
        getAllActions: () => Promise<StoredAction[]>,
    ): Promise<ActionSearchResult> {
        const startTime = performance.now();
        this.cacheStats.searchCount++;

        try {
            // Get all actions and ensure search index is up to date
            const allActions = await getAllActions();
            await this.ensureSearchIndex(allActions);

            // Build candidate set based on text search
            let candidates = this.getTextSearchCandidates(
                query.text,
                allActions,
            );

            // Apply filters
            if (query.filters) {
                candidates = this.applyFilters(candidates, query.filters);
            }

            // Rank results
            const rankedResults = this.rankResults(
                candidates,
                query.text || "",
            );

            // Apply pagination
            const offset = query.offset || 0;
            const limit = query.limit || 50;
            const paginatedResults = rankedResults.slice(
                offset,
                offset + limit,
            );

            const searchTime = performance.now() - startTime;
            this.updatePerformanceStats(searchTime);

            return {
                actions: paginatedResults,
                total: rankedResults.length,
                hasMore:
                    rankedResults.length > offset + paginatedResults.length,
                searchStats: {
                    searchTime,
                    cacheHit: false,
                },
            };
        } catch (error) {
            console.error("Search failed:", error);
            return {
                actions: [],
                total: 0,
                hasMore: false,
                searchStats: {
                    searchTime: performance.now() - startTime,
                    cacheHit: false,
                },
            };
        }
    }

    /**
     * Get search suggestions based on partial query
     */
    async getSearchSuggestions(
        partialQuery: string,
        getAllActions: () => Promise<StoredAction[]>,
        limit: number = 10,
    ): Promise<SearchSuggestion[]> {
        if (!partialQuery || partialQuery.length < 2) {
            return [];
        }

        const allActions = await getAllActions();
        await this.ensureSearchIndex(allActions);

        const suggestions: SearchSuggestion[] = [];
        const lowerQuery = partialQuery.toLowerCase();

        // Action name suggestions
        for (const action of allActions) {
            if (action.name.toLowerCase().includes(lowerQuery)) {
                suggestions.push({
                    text: action.name,
                    type: "action",
                    score: this.calculateSuggestionScore(
                        action.name,
                        lowerQuery,
                        action.metadata.usageCount,
                    ),
                    context: action.category,
                });
            }
        }

        // Tag suggestions
        for (const action of allActions) {
            for (const tag of action.tags) {
                if (tag.toLowerCase().includes(lowerQuery)) {
                    suggestions.push({
                        text: tag,
                        type: "tag",
                        score: this.calculateTagScore(tag, lowerQuery),
                        context: `${this.getTagUsageCount(tag, allActions)} actions`,
                    });
                }
            }
        }

        // Domain suggestions
        const domains = new Set(
            allActions.map((a) => a.scope.domain).filter(Boolean),
        );
        for (const domain of domains) {
            if (domain!.toLowerCase().includes(lowerQuery)) {
                suggestions.push({
                    text: domain!,
                    type: "domain",
                    score: this.calculateDomainScore(
                        domain!,
                        lowerQuery,
                        allActions,
                    ),
                    context: `${this.getDomainActionCount(domain!, allActions)} actions`,
                });
            }
        }

        // Category suggestions
        const categories = [
            "navigation",
            "form",
            "commerce",
            "search",
            "content",
            "social",
            "media",
            "utility",
            "custom",
        ];
        for (const category of categories) {
            if (category.toLowerCase().includes(lowerQuery)) {
                suggestions.push({
                    text: category,
                    type: "category",
                    score: this.calculateCategoryScore(
                        category,
                        lowerQuery,
                        allActions,
                    ),
                    context: `${this.getCategoryActionCount(category, allActions)} actions`,
                });
            }
        }

        // Sort by score and return top suggestions
        return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    /**
     * Build search index for fast text search
     */
    private async ensureSearchIndex(actions: StoredAction[]): Promise<void> {
        // Simple timestamp-based cache invalidation
        const currentTime = Date.now();
        if (currentTime - this.lastIndexUpdate < 5000) {
            // 5 seconds cache
            return;
        }

        await this.buildSearchIndex(actions);
        this.lastIndexUpdate = currentTime;
    }

    /**
     * Build search index for fast text search
     */
    private async buildSearchIndex(actions: StoredAction[]): Promise<void> {
        this.searchIndex.clear();
        this.tagIndex.clear();
        this.domainIndex.clear();
        this.categoryIndex.clear();

        for (const action of actions) {
            // Index action text content
            const searchableText = [
                action.name,
                action.description,
                ...action.tags,
            ]
                .join(" ")
                .toLowerCase();

            const terms = this.tokenize(searchableText);

            for (const term of terms) {
                if (!this.searchIndex.has(term)) {
                    this.searchIndex.set(term, new Set());
                }
                this.searchIndex.get(term)!.add(action.id);
            }

            // Index tags
            for (const tag of action.tags) {
                const lowerTag = tag.toLowerCase();
                if (!this.tagIndex.has(lowerTag)) {
                    this.tagIndex.set(lowerTag, new Set());
                }
                this.tagIndex.get(lowerTag)!.add(action.id);
            }

            // Index domains
            if (action.scope.domain) {
                const domain = action.scope.domain.toLowerCase();
                if (!this.domainIndex.has(domain)) {
                    this.domainIndex.set(domain, new Set());
                }
                this.domainIndex.get(domain)!.add(action.id);
            }

            // Index categories
            const category = action.category.toLowerCase();
            if (!this.categoryIndex.has(category)) {
                this.categoryIndex.set(category, new Set());
            }
            this.categoryIndex.get(category)!.add(action.id);
        }
    }

    /**
     * Get candidate actions based on text search
     */
    private getTextSearchCandidates(
        searchText: string | undefined,
        allActions: StoredAction[],
    ): StoredAction[] {
        if (!searchText || searchText.trim().length === 0) {
            return allActions;
        }

        const terms = this.tokenize(searchText.toLowerCase());
        if (terms.length === 0) {
            return allActions;
        }

        // Get actions that match any search term
        const matchingActionIds = new Set<string>();

        for (const term of terms) {
            // Exact matches in search index
            if (this.searchIndex.has(term)) {
                for (const actionId of this.searchIndex.get(term)!) {
                    matchingActionIds.add(actionId);
                }
            }

            // Partial matches (slower but more comprehensive)
            for (const [indexTerm, actionIds] of this.searchIndex.entries()) {
                if (indexTerm.includes(term)) {
                    for (const actionId of actionIds) {
                        matchingActionIds.add(actionId);
                    }
                }
            }
        }

        // Convert action IDs back to action objects
        const actionMap = new Map(allActions.map((a) => [a.id, a]));
        return Array.from(matchingActionIds)
            .map((id) => actionMap.get(id)!)
            .filter(Boolean);
    }

    /**
     * Apply filters to candidate actions
     */
    private applyFilters(
        actions: StoredAction[],
        filters: ActionFilter,
    ): StoredAction[] {
        let filtered = actions;

        if (filters.categories && filters.categories.length > 0) {
            filtered = filtered.filter((action) =>
                filters.categories!.includes(action.category),
            );
        }

        if (filters.authors && filters.authors.length > 0) {
            filtered = filtered.filter((action) =>
                filters.authors!.includes(action.author),
            );
        }

        if (filters.domains && filters.domains.length > 0) {
            filtered = filtered.filter(
                (action) =>
                    action.scope.domain &&
                    filters.domains!.includes(action.scope.domain),
            );
        }

        if (filters.scopes && filters.scopes.length > 0) {
            filtered = filtered.filter((action) =>
                filters.scopes!.includes(action.scope.type),
            );
        }

        if (filters.tags && filters.tags.length > 0) {
            filtered = filtered.filter((action) =>
                filters.tags!.some((tag) =>
                    action.tags.some(
                        (actionTag) =>
                            actionTag.toLowerCase() === tag.toLowerCase(),
                    ),
                ),
            );
        }

        if (filters.minUsage !== undefined) {
            filtered = filtered.filter(
                (action) => action.metadata.usageCount >= filters.minUsage!,
            );
        }

        if (filters.maxUsage !== undefined) {
            filtered = filtered.filter(
                (action) => action.metadata.usageCount <= filters.maxUsage!,
            );
        }

        if (filters.createdAfter) {
            const afterDate = new Date(filters.createdAfter);
            filtered = filtered.filter(
                (action) => new Date(action.metadata.createdAt) >= afterDate,
            );
        }

        if (filters.createdBefore) {
            const beforeDate = new Date(filters.createdBefore);
            filtered = filtered.filter(
                (action) => new Date(action.metadata.createdAt) <= beforeDate,
            );
        }

        if (filters.lastUsedAfter) {
            const afterDate = new Date(filters.lastUsedAfter);
            filtered = filtered.filter(
                (action) =>
                    action.metadata.lastUsed &&
                    new Date(action.metadata.lastUsed) >= afterDate,
            );
        }

        return filtered;
    }

    /**
     * Rank search results by relevance
     */
    private rankResults(
        actions: StoredAction[],
        searchText: string,
    ): StoredAction[] {
        if (!searchText || searchText.trim().length === 0) {
            // Sort by usage count when no search text
            return actions.sort(
                (a, b) => b.metadata.usageCount - a.metadata.usageCount,
            );
        }

        const lowerSearchText = searchText.toLowerCase();
        const searchTerms = this.tokenize(lowerSearchText);

        return actions
            .map((action) => ({
                action,
                score: this.calculateRelevanceScore(
                    action,
                    lowerSearchText,
                    searchTerms,
                ),
            }))
            .sort((a, b) => b.score - a.score)
            .map((item) => item.action);
    }

    /**
     * Calculate relevance score for an action
     */
    private calculateRelevanceScore(
        action: StoredAction,
        searchText: string,
        searchTerms: string[],
    ): number {
        let score = 0;

        const name = action.name.toLowerCase();
        const description = action.description.toLowerCase();
        const tags = action.tags.map((t) => t.toLowerCase());

        // Exact name match gets highest score
        if (name === searchText) {
            score += 1000;
        } else if (name.includes(searchText)) {
            score += 500;
        }

        // Description match
        if (description.includes(searchText)) {
            score += 200;
        }

        // Tag matches
        for (const tag of tags) {
            if (tag === searchText) {
                score += 300;
            } else if (tag.includes(searchText)) {
                score += 150;
            }
        }

        // Individual term matches
        for (const term of searchTerms) {
            if (name.includes(term)) score += 100;
            if (description.includes(term)) score += 50;
            for (const tag of tags) {
                if (tag.includes(term)) score += 75;
            }
        }

        // Usage count boost (popular actions score higher)
        score += Math.min(action.metadata.usageCount * 10, 100);

        // Recent usage boost
        if (action.metadata.lastUsed) {
            const daysSinceUsed = this.getDaysSince(action.metadata.lastUsed);
            if (daysSinceUsed < 7) {
                score += (7 - daysSinceUsed) * 10;
            }
        }

        return score;
    }

    /**
     * Tokenize text for search indexing
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter((token) => token.length > 2);
    }

    /**
     * Calculate suggestion score for action names
     */
    private calculateSuggestionScore(
        actionName: string,
        query: string,
        usageCount: number,
    ): number {
        let score = 0;

        const name = actionName.toLowerCase();
        const lowerQuery = query.toLowerCase();

        if (name.startsWith(lowerQuery)) {
            score += 100;
        } else if (name.includes(lowerQuery)) {
            score += 50;
        }

        // Boost score based on usage
        score += Math.min(usageCount * 5, 50);

        return score;
    }

    /**
     * Calculate tag suggestion score
     */
    private calculateTagScore(tag: string, query: string): number {
        const lowerTag = tag.toLowerCase();
        const lowerQuery = query.toLowerCase();

        if (lowerTag.startsWith(lowerQuery)) {
            return 80;
        } else if (lowerTag.includes(lowerQuery)) {
            return 40;
        }
        return 0;
    }

    /**
     * Calculate domain suggestion score
     */
    private calculateDomainScore(
        domain: string,
        query: string,
        allActions: StoredAction[],
    ): number {
        let score = 0;

        if (domain.toLowerCase().includes(query.toLowerCase())) {
            score += 60;
        }

        // Boost based on number of actions in domain
        const domainActionCount = this.getDomainActionCount(domain, allActions);
        score += Math.min(domainActionCount * 2, 40);

        return score;
    }

    /**
     * Calculate category suggestion score
     */
    private calculateCategoryScore(
        category: string,
        query: string,
        allActions: StoredAction[],
    ): number {
        let score = 0;

        if (category.toLowerCase().includes(query.toLowerCase())) {
            score += 70;
        }

        // Boost based on number of actions in category
        const categoryActionCount = this.getCategoryActionCount(
            category,
            allActions,
        );
        score += Math.min(categoryActionCount * 2, 30);

        return score;
    }

    /**
     * Get number of times a tag is used
     */
    private getTagUsageCount(tag: string, allActions: StoredAction[]): number {
        return allActions.filter((action) =>
            action.tags.some(
                (actionTag) => actionTag.toLowerCase() === tag.toLowerCase(),
            ),
        ).length;
    }

    /**
     * Get number of actions in a domain
     */
    private getDomainActionCount(
        domain: string,
        allActions: StoredAction[],
    ): number {
        return allActions.filter((action) => action.scope.domain === domain)
            .length;
    }

    /**
     * Get number of actions in a category
     */
    private getCategoryActionCount(
        category: string,
        allActions: StoredAction[],
    ): number {
        return allActions.filter((action) => action.category === category)
            .length;
    }

    /**
     * Calculate days since a given date
     */
    private getDaysSince(dateString: string): number {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - date.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Update performance statistics
     */
    private updatePerformanceStats(searchTime: number): void {
        const totalTime =
            this.cacheStats.averageSearchTime *
                (this.cacheStats.searchCount - 1) +
            searchTime;
        this.cacheStats.averageSearchTime =
            totalTime / this.cacheStats.searchCount;
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return { ...this.cacheStats };
    }

    /**
     * Clear all caches
     */
    clearCaches(): void {
        this.searchIndex.clear();
        this.tagIndex.clear();
        this.domainIndex.clear();
        this.categoryIndex.clear();
        this.lastIndexUpdate = 0;
        this.cacheStats = {
            searchCount: 0,
            cacheHits: 0,
            averageSearchTime: 0,
        };
    }
}
