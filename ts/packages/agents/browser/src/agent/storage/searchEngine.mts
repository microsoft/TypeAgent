// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    StoredMacro,
    MacroSearchQuery,
    MacroSearchResult,
    SearchSuggestion,
    MacroFilter,
} from "./types.mjs";

/**
 * MacroSearchEngine - Advanced search and filtering for macros
 *
 * Provides fast, comprehensive search capabilities including:
 * - Text search across action names, descriptions, and tags
 * - Multi-criteria filtering
 * - Search result ranking and pagination
 * - Search suggestions and auto-complete
 * - Performance optimization with caching
 */
export class MacroSearchEngine {
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
     * Search macros with comprehensive filtering and ranking
     */
    async searchMacros(
        query: MacroSearchQuery,
        getAllMacros: () => Promise<StoredMacro[]>,
    ): Promise<MacroSearchResult> {
        const startTime = performance.now();
        this.cacheStats.searchCount++;

        try {
            // Get all macros and ensure search index is up to date
            const allMacros = await getAllMacros();
            await this.ensureSearchIndex(allMacros);

            // Build candidate set based on text search
            let candidates = this.getTextSearchCandidates(
                query.text,
                allMacros,
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
                macros: paginatedResults,
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
                macros: [],
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
        getAllMacros: () => Promise<StoredMacro[]>,
        limit: number = 10,
    ): Promise<SearchSuggestion[]> {
        if (!partialQuery || partialQuery.length < 2) {
            return [];
        }

        const allMacros = await getAllMacros();
        await this.ensureSearchIndex(allMacros);

        const suggestions: SearchSuggestion[] = [];
        const lowerQuery = partialQuery.toLowerCase();

        // Macro name suggestions
        for (const macro of allMacros) {
            if (macro.name.toLowerCase().includes(lowerQuery)) {
                suggestions.push({
                    text: macro.name,
                    type: "macro",
                    score: this.calculateSuggestionScore(
                        macro.name,
                        lowerQuery,
                        macro.metadata.usageCount,
                    ),
                    context: macro.category,
                });
            }
        }

        // Tag suggestions
        for (const macro of allMacros) {
            for (const tag of macro.tags) {
                if (tag.toLowerCase().includes(lowerQuery)) {
                    suggestions.push({
                        text: tag,
                        type: "tag",
                        score: this.calculateTagScore(tag, lowerQuery),
                        context: `${this.getTagUsageCount(tag, allMacros)} macros`,
                    });
                }
            }
        }

        // Domain suggestions
        const domains = new Set(
            allMacros.map((a) => a.scope.domain).filter(Boolean),
        );
        for (const domain of domains) {
            if (domain!.toLowerCase().includes(lowerQuery)) {
                suggestions.push({
                    text: domain!,
                    type: "domain",
                    score: this.calculateDomainScore(
                        domain!,
                        lowerQuery,
                        allMacros,
                    ),
                    context: `${this.getDomainMacroCount(domain!, allMacros)} macros`,
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
                        allMacros,
                    ),
                    context: `${this.getCategoryMacroCount(category, allMacros)} macros`,
                });
            }
        }

        // Sort by score and return top suggestions
        return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    /**
     * Build search index for fast text search
     */
    private async ensureSearchIndex(macros: StoredMacro[]): Promise<void> {
        // Simple timestamp-based cache invalidation
        const currentTime = Date.now();
        if (currentTime - this.lastIndexUpdate < 5000) {
            // 5 seconds cache
            return;
        }

        await this.buildSearchIndex(macros);
        this.lastIndexUpdate = currentTime;
    }

    /**
     * Build search index for fast text search
     */
    private async buildSearchIndex(macros: StoredMacro[]): Promise<void> {
        this.searchIndex.clear();
        this.tagIndex.clear();
        this.domainIndex.clear();
        this.categoryIndex.clear();

        for (const macro of macros) {
            // Index macro text content
            const searchableText = [
                macro.name,
                macro.description,
                ...macro.tags,
            ]
                .join(" ")
                .toLowerCase();

            const terms = this.tokenize(searchableText);

            for (const term of terms) {
                if (!this.searchIndex.has(term)) {
                    this.searchIndex.set(term, new Set());
                }
                this.searchIndex.get(term)!.add(macro.id);
            }

            // Index tags
            for (const tag of macro.tags) {
                const lowerTag = tag.toLowerCase();
                if (!this.tagIndex.has(lowerTag)) {
                    this.tagIndex.set(lowerTag, new Set());
                }
                this.tagIndex.get(lowerTag)!.add(macro.id);
            }

            // Index domains
            if (macro.scope.domain) {
                const domain = macro.scope.domain.toLowerCase();
                if (!this.domainIndex.has(domain)) {
                    this.domainIndex.set(domain, new Set());
                }
                this.domainIndex.get(domain)!.add(macro.id);
            }

            // Index categories
            const category = macro.category.toLowerCase();
            if (!this.categoryIndex.has(category)) {
                this.categoryIndex.set(category, new Set());
            }
            this.categoryIndex.get(category)!.add(macro.id);
        }
    }

    /**
     * Get candidate macros based on text search
     */
    private getTextSearchCandidates(
        searchText: string | undefined,
        allMacros: StoredMacro[],
    ): StoredMacro[] {
        if (!searchText || searchText.trim().length === 0) {
            return allMacros;
        }

        const terms = this.tokenize(searchText.toLowerCase());
        if (terms.length === 0) {
            return allMacros;
        }

        // Get macros that match any search term
        const matchingMacroIds = new Set<string>();

        for (const term of terms) {
            // Exact matches in search index
            if (this.searchIndex.has(term)) {
                for (const macroId of this.searchIndex.get(term)!) {
                    matchingMacroIds.add(macroId);
                }
            }

            // Partial matches (slower but more comprehensive)
            for (const [indexTerm, macroIds] of this.searchIndex.entries()) {
                if (indexTerm.includes(term)) {
                    for (const macroId of macroIds) {
                        matchingMacroIds.add(macroId);
                    }
                }
            }
        }

        // Convert macro IDs back to macro objects
        const macroMap = new Map(allMacros.map((m) => [m.id, m]));
        return Array.from(matchingMacroIds)
            .map((id) => macroMap.get(id)!)
            .filter(Boolean);
    }

    /**
     * Apply filters to candidate macros
     */
    private applyFilters(
        macros: StoredMacro[],
        filters: MacroFilter,
    ): StoredMacro[] {
        let filtered = macros;

        if (filters.categories && filters.categories.length > 0) {
            filtered = filtered.filter((macro) =>
                filters.categories!.includes(macro.category),
            );
        }

        if (filters.authors && filters.authors.length > 0) {
            filtered = filtered.filter((macro) =>
                filters.authors!.includes(macro.author),
            );
        }

        if (filters.domains && filters.domains.length > 0) {
            filtered = filtered.filter(
                (macro) =>
                    macro.scope.domain &&
                    filters.domains!.includes(macro.scope.domain),
            );
        }

        if (filters.scopes && filters.scopes.length > 0) {
            filtered = filtered.filter((macro) =>
                filters.scopes!.includes(macro.scope.type),
            );
        }

        if (filters.tags && filters.tags.length > 0) {
            filtered = filtered.filter((macro) =>
                filters.tags!.some((tag) =>
                    macro.tags.some(
                        (macroTag) =>
                            macroTag.toLowerCase() === tag.toLowerCase(),
                    ),
                ),
            );
        }

        if (filters.minUsage !== undefined) {
            filtered = filtered.filter(
                (macro) => macro.metadata.usageCount >= filters.minUsage!,
            );
        }

        if (filters.maxUsage !== undefined) {
            filtered = filtered.filter(
                (macro) => macro.metadata.usageCount <= filters.maxUsage!,
            );
        }

        if (filters.createdAfter) {
            const afterDate = new Date(filters.createdAfter);
            filtered = filtered.filter(
                (macro) => new Date(macro.metadata.createdAt) >= afterDate,
            );
        }

        if (filters.createdBefore) {
            const beforeDate = new Date(filters.createdBefore);
            filtered = filtered.filter(
                (macro) => new Date(macro.metadata.createdAt) <= beforeDate,
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
        actions: StoredMacro[],
        searchText: string,
    ): StoredMacro[] {
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
        action: StoredMacro,
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
        allActions: StoredMacro[],
    ): number {
        let score = 0;

        if (domain.toLowerCase().includes(query.toLowerCase())) {
            score += 60;
        }

        // Boost based on number of macros in domain
        const domainMacroCount = this.getDomainMacroCount(domain, allActions);
        score += Math.min(domainMacroCount * 2, 40);

        return score;
    }

    /**
     * Calculate category suggestion score
     */
    private calculateCategoryScore(
        category: string,
        query: string,
        allActions: StoredMacro[],
    ): number {
        let score = 0;

        if (category.toLowerCase().includes(query.toLowerCase())) {
            score += 70;
        }

        // Boost based on number of macros in category
        const categoryMacroCount = this.getCategoryMacroCount(
            category,
            allActions,
        );
        score += Math.min(categoryMacroCount * 2, 30);

        return score;
    }

    /**
     * Get number of times a tag is used
     */
    private getTagUsageCount(tag: string, allActions: StoredMacro[]): number {
        return allActions.filter((action) =>
            action.tags.some(
                (actionTag) => actionTag.toLowerCase() === tag.toLowerCase(),
            ),
        ).length;
    }

    /**
     * Get number of actions in a domain
     */
    private getDomainMacroCount(
        domain: string,
        allMacros: StoredMacro[],
    ): number {
        return allMacros.filter((macro) => macro.scope.domain === domain)
            .length;
    }

    /**
     * Get number of actions in a category
     */
    private getCategoryMacroCount(
        category: string,
        allMacros: StoredMacro[],
    ): number {
        return allMacros.filter((macro) => macro.category === category).length;
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
