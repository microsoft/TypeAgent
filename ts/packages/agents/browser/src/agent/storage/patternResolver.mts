// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StoredAction, UrlPattern, ActionIndexEntry } from "./types.mjs";
import { UrlMatcher, MatchResult } from "./urlMatcher.mjs";

/**
 * Action with pattern matching information
 */
export interface ResolvedAction {
    action: StoredAction;
    matchedPattern?: UrlPattern;
    priority: number;
    source: "exact" | "pattern" | "domain" | "global";
}

/**
 * Cached resolution result
 */
interface CachedResolution {
    actions: ResolvedAction[];
    timestamp: number;
    ttl: number;
}

/**
 * Pattern resolver for finding actions that match URLs using patterns
 */
export class PatternResolver {
    private urlMatcher: UrlMatcher;
    private resolvedCache = new Map<string, CachedResolution>();
    private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly MAX_CACHE_SIZE = 1000;

    constructor() {
        this.urlMatcher = new UrlMatcher();
    }

    /**
     * Resolve all actions that should apply to a given URL
     */
    async resolveActionsForUrl(
        url: string,
        getActionById: (id: string) => Promise<StoredAction | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
        getActionEntriesForDomain: (domain: string) => ActionIndexEntry[],
        getGlobalActionEntries: () => ActionIndexEntry[],
    ): Promise<ResolvedAction[]> {
        // Check cache first
        const cached = this.getCachedResolution(url);
        if (cached) {
            return cached;
        }

        try {
            // Perform full resolution
            const resolved = await this.performResolution(
                url,
                getActionById,
                getAllPatterns,
                getActionEntriesForDomain,
                getGlobalActionEntries,
            );

            // Cache the result
            this.setCachedResolution(url, resolved);

            return resolved;
        } catch (error) {
            console.error(`Failed to resolve actions for URL ${url}:`, error);
            return [];
        }
    }

    /**
     * Get all URL patterns that match a given URL
     */
    async getApplicablePatterns(
        url: string,
        getAllPatterns: () => Promise<UrlPattern[]>,
    ): Promise<MatchResult[]> {
        try {
            const allPatterns = await getAllPatterns();
            return this.urlMatcher.findMatchingPatterns(url, allPatterns);
        } catch (error) {
            console.error(
                `Failed to get applicable patterns for URL ${url}:`,
                error,
            );
            return [];
        }
    }

    /**
     * Perform the actual action resolution
     */
    private async performResolution(
        url: string,
        getActionById: (id: string) => Promise<StoredAction | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
        getActionEntriesForDomain: (domain: string) => ActionIndexEntry[],
        getGlobalActionEntries: () => ActionIndexEntry[],
    ): Promise<ResolvedAction[]> {
        const resolvedActions: ResolvedAction[] = [];
        const parsedUrl = new URL(url);
        const domain = parsedUrl.hostname;

        // 1. Check for exact URL matches in action patterns
        const exactActions = await this.findExactUrlActions(
            url,
            getActionById,
            getAllPatterns,
        );
        resolvedActions.push(...exactActions);

        // 2. Find pattern-based matches
        const patternActions = await this.findPatternActions(
            url,
            getActionById,
            getAllPatterns,
        );
        resolvedActions.push(...patternActions);

        // 3. Get domain-specific actions (non-pattern)
        const domainActions = await this.findDomainActions(
            domain,
            getActionById,
            getActionEntriesForDomain,
        );
        resolvedActions.push(...domainActions);

        // 4. Get global actions
        const globalActions = await this.findGlobalActions(
            getActionById,
            getGlobalActionEntries,
        );
        resolvedActions.push(...globalActions);

        // Remove duplicates and sort by priority
        const uniqueActions = this.deduplicateAndSort(resolvedActions);

        return uniqueActions;
    }

    /**
     * Find actions with exact URL matches
     */
    private async findExactUrlActions(
        url: string,
        getActionById: (id: string) => Promise<StoredAction | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
    ): Promise<ResolvedAction[]> {
        const patterns = await getAllPatterns();
        const exactPatterns = patterns.filter(
            (p) => p.type === "exact" && p.pattern === url,
        );

        const actions: ResolvedAction[] = [];

        for (const _pattern of exactPatterns) {
            // Find actions that use this exact pattern
            // This would need integration with action-pattern mapping
            // For now, this is a placeholder for future implementation
        }

        return actions;
    }

    /**
     * Find actions through pattern matching
     */
    private async findPatternActions(
        url: string,
        getActionById: (id: string) => Promise<StoredAction | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
    ): Promise<ResolvedAction[]> {
        const matchingPatterns = await this.getApplicablePatterns(
            url,
            getAllPatterns,
        );
        const actions: ResolvedAction[] = [];

        for (const _matchResult of matchingPatterns) {
            if (_matchResult.pattern.type !== "exact") {
                // Find actions that use this pattern
                // This would need integration with action-pattern mapping
                // For now, this is a placeholder for future implementation
            }
        }

        return actions;
    }

    /**
     * Find domain-specific actions
     */
    private async findDomainActions(
        domain: string,
        getActionById: (id: string) => Promise<StoredAction | null>,
        getActionEntriesForDomain: (domain: string) => ActionIndexEntry[],
    ): Promise<ResolvedAction[]> {
        const domainEntries = getActionEntriesForDomain(domain);
        const actions: ResolvedAction[] = [];

        for (const entry of domainEntries) {
            const action = await getActionById(entry.id);
            if (action) {
                actions.push({
                    action,
                    priority: action.scope.priority || 60,
                    source: "domain",
                });
            }
        }

        return actions;
    }

    /**
     * Find global actions
     */
    private async findGlobalActions(
        getActionById: (id: string) => Promise<StoredAction | null>,
        getGlobalActionEntries: () => ActionIndexEntry[],
    ): Promise<ResolvedAction[]> {
        const globalEntries = getGlobalActionEntries();
        const actions: ResolvedAction[] = [];

        for (const entry of globalEntries) {
            const action = await getActionById(entry.id);
            if (action) {
                actions.push({
                    action,
                    priority: action.scope.priority || 50,
                    source: "global",
                });
            }
        }

        return actions;
    }

    /**
     * Remove duplicate actions and sort by priority
     */
    private deduplicateAndSort(actions: ResolvedAction[]): ResolvedAction[] {
        // Remove duplicates based on action ID
        const uniqueMap = new Map<string, ResolvedAction>();

        for (const resolvedAction of actions) {
            const existing = uniqueMap.get(resolvedAction.action.id);
            if (!existing || resolvedAction.priority > existing.priority) {
                uniqueMap.set(resolvedAction.action.id, resolvedAction);
            }
        }

        // Sort by priority (highest first), then by usage count, then by name
        return Array.from(uniqueMap.values()).sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            if (a.action.metadata.usageCount !== b.action.metadata.usageCount) {
                return (
                    b.action.metadata.usageCount - a.action.metadata.usageCount
                );
            }
            return a.action.name.localeCompare(b.action.name);
        });
    }

    /**
     * Get cached resolution result
     */
    private getCachedResolution(url: string): ResolvedAction[] | null {
        const cached = this.resolvedCache.get(url);
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
            return cached.actions;
        }

        // Remove expired entry
        if (cached) {
            this.resolvedCache.delete(url);
        }

        return null;
    }

    /**
     * Cache resolution result
     */
    private setCachedResolution(url: string, actions: ResolvedAction[]): void {
        // Implement LRU eviction if cache is full
        if (this.resolvedCache.size >= this.MAX_CACHE_SIZE) {
            this.evictOldestCacheEntry();
        }

        this.resolvedCache.set(url, {
            actions,
            timestamp: Date.now(),
            ttl: this.DEFAULT_TTL,
        });
    }

    /**
     * Evict oldest cache entry
     */
    private evictOldestCacheEntry(): void {
        let oldestKey: string | null = null;
        let oldestTime = Date.now();

        for (const [key, value] of this.resolvedCache.entries()) {
            if (value.timestamp < oldestTime) {
                oldestTime = value.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.resolvedCache.delete(oldestKey);
        }
    }

    /**
     * Clear resolution cache
     */
    clearCache(): void {
        this.resolvedCache.clear();
        this.urlMatcher.clearCaches();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        cacheSize: number;
        maxCacheSize: number;
        hitRate: number;
        urlMatcherStats: { globCacheSize: number; regexCacheSize: number };
    } {
        return {
            cacheSize: this.resolvedCache.size,
            maxCacheSize: this.MAX_CACHE_SIZE,
            hitRate: 0, // Would need to track hits/misses to calculate
            urlMatcherStats: this.urlMatcher.getCacheStats(),
        };
    }
}
