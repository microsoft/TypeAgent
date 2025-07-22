// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { StoredMacro, UrlPattern, MacroIndexEntry } from "./types.mjs";
import { UrlMatcher, MatchResult } from "./urlMatcher.mjs";

/**
 * Macro with pattern matching information
 */
export interface ResolvedMacro {
    macro: StoredMacro;
    matchedPattern?: UrlPattern;
    priority: number;
    source: "exact" | "pattern" | "domain" | "global";
}

/**
 * Cached resolution result
 */
interface CachedResolution {
    macros: ResolvedMacro[];
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
     * Resolve all macros that should apply to a given URL
     */
    async resolveMacrosForUrl(
        url: string,
        getMacroById: (id: string) => Promise<StoredMacro | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
        getMacroEntriesForDomain: (domain: string) => MacroIndexEntry[],
        getGlobalMacroEntries: () => MacroIndexEntry[],
    ): Promise<ResolvedMacro[]> {
        // Check cache first
        const cached = this.getCachedResolution(url);
        if (cached) {
            return cached;
        }

        try {
            // Perform full resolution
            const resolved = await this.performResolution(
                url,
                getMacroById,
                getAllPatterns,
                getMacroEntriesForDomain,
                getGlobalMacroEntries,
            );

            // Cache the result
            this.setCachedResolution(url, resolved);

            return resolved;
        } catch (error) {
            console.error(`Failed to resolve macros for URL ${url}:`, error);
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
        getMacroById: (id: string) => Promise<StoredMacro | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
        getMacroEntriesForDomain: (domain: string) => MacroIndexEntry[],
        getGlobalMacroEntries: () => MacroIndexEntry[],
    ): Promise<ResolvedMacro[]> {
        const resolvedMacros: ResolvedMacro[] = [];
        const parsedUrl = new URL(url);
        const domain = parsedUrl.hostname;

        // 1. Check for exact URL matches in macro patterns
        const exactMacros = await this.findExactUrlMacros(
            url,
            getMacroById,
            getAllPatterns,
        );
        resolvedMacros.push(...exactMacros);

        // 2. Find pattern-based matches
        const patternMacros = await this.findPatternMacros(
            url,
            getMacroById,
            getAllPatterns,
        );
        resolvedMacros.push(...patternMacros);

        // 3. Get domain-specific macros (non-pattern)
        const domainMacros = await this.findDomainMacros(
            domain,
            getMacroById,
            getMacroEntriesForDomain,
        );
        resolvedMacros.push(...domainMacros);

        // 4. Get global macros
        const globalMacros = await this.findGlobalMacros(
            getMacroById,
            getGlobalMacroEntries,
        );
        resolvedMacros.push(...globalMacros);

        // Remove duplicates and sort by priority
        const uniqueMacros = this.deduplicateAndSort(resolvedMacros);

        return uniqueMacros;
    }

    /**
     * Find macros with exact URL matches
     */
    private async findExactUrlMacros(
        url: string,
        getMacroById: (id: string) => Promise<StoredMacro | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
    ): Promise<ResolvedMacro[]> {
        const patterns = await getAllPatterns();
        const exactPatterns = patterns.filter(
            (p) => p.type === "exact" && p.pattern === url,
        );

        const macros: ResolvedMacro[] = [];

        for (const pattern of exactPatterns) {
            try {
                // Basic implementation: find actions associated with this pattern
                // TODO: Implement proper pattern-to-action mapping
                console.warn(
                    `Pattern matching not fully implemented for pattern: ${pattern.pattern}`,
                );
            } catch (error) {
                console.warn(`Error processing exact pattern:`, error);
            }
        }

        return macros;
    }

    /**
     * Find macros through pattern matching
     */
    private async findPatternMacros(
        url: string,
        getMacroById: (id: string) => Promise<StoredMacro | null>,
        getAllPatterns: () => Promise<UrlPattern[]>,
    ): Promise<ResolvedMacro[]> {
        const matchingPatterns = await this.getApplicablePatterns(
            url,
            getAllPatterns,
        );
        const macros: ResolvedMacro[] = [];

        for (const matchResult of matchingPatterns) {
            if (matchResult.pattern.type !== "exact") {
                try {
                    // TODO: Implement proper pattern-to-action mapping
                    console.warn(
                        `Pattern matching not fully implemented for pattern: ${matchResult.pattern.pattern}`,
                    );
                } catch (error) {
                    console.warn(`Error processing pattern:`, error);
                }
            }
        }

        return macros;
    }

    /**
     * Find domain-specific macros
     */
    private async findDomainMacros(
        domain: string,
        getMacroById: (id: string) => Promise<StoredMacro | null>,
        getMacroEntriesForDomain: (domain: string) => MacroIndexEntry[],
    ): Promise<ResolvedMacro[]> {
        const domainEntries = getMacroEntriesForDomain(domain);
        const macros: ResolvedMacro[] = [];

        for (const entry of domainEntries) {
            const macro = await getMacroById(entry.id);
            if (macro) {
                macros.push({
                    macro,
                    priority: macro.scope.priority || 60,
                    source: "domain",
                });
            }
        }

        return macros;
    }

    /**
     * Find global macros
     */
    private async findGlobalMacros(
        getMacroById: (id: string) => Promise<StoredMacro | null>,
        getGlobalMacroEntries: () => MacroIndexEntry[],
    ): Promise<ResolvedMacro[]> {
        const globalEntries = getGlobalMacroEntries();
        const macros: ResolvedMacro[] = [];

        for (const entry of globalEntries) {
            const macro = await getMacroById(entry.id);
            if (macro) {
                macros.push({
                    macro,
                    priority: macro.scope.priority || 50,
                    source: "global",
                });
            }
        }

        return macros;
    }

    /**
     * Remove duplicate macros and sort by priority
     */
    private deduplicateAndSort(macros: ResolvedMacro[]): ResolvedMacro[] {
        // Remove duplicates based on macro ID
        const uniqueMap = new Map<string, ResolvedMacro>();

        for (const resolvedMacro of macros) {
            const existing = uniqueMap.get(resolvedMacro.macro.id);
            if (!existing || resolvedMacro.priority > existing.priority) {
                uniqueMap.set(resolvedMacro.macro.id, resolvedMacro);
            }
        }

        // Sort by priority (highest first), then by usage count, then by name
        return Array.from(uniqueMap.values()).sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            if (a.macro.metadata.usageCount !== b.macro.metadata.usageCount) {
                return (
                    b.macro.metadata.usageCount - a.macro.metadata.usageCount
                );
            }
            return a.macro.name.localeCompare(b.macro.name);
        });
    }

    /**
     * Get cached resolution result
     */
    private getCachedResolution(url: string): ResolvedMacro[] | null {
        const cached = this.resolvedCache.get(url);
        if (cached && Date.now() - cached.timestamp < cached.ttl) {
            return cached.macros;
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
    private setCachedResolution(url: string, macros: ResolvedMacro[]): void {
        // Implement LRU eviction if cache is full
        if (this.resolvedCache.size >= this.MAX_CACHE_SIZE) {
            this.evictOldestCacheEntry();
        }

        this.resolvedCache.set(url, {
            macros,
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
