// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { UrlPattern } from "./types.mjs";

/**
 * Result of pattern matching with priority information
 */
export interface MatchResult {
    pattern: UrlPattern;
    priority: number;
    specificity: number;
    matchType: "exact" | "glob" | "regex";
}

/**
 * URL pattern matching engine supporting exact, glob, and regex patterns
 */
export class UrlMatcher {
    private globCache = new Map<string, RegExp>();
    private regexCache = new Map<string, RegExp>();

    /**
     * Find all patterns that match a URL, sorted by priority (highest first)
     */
    findMatchingPatterns(url: string, patterns: UrlPattern[]): MatchResult[] {
        const matches: MatchResult[] = [];

        for (const pattern of patterns) {
            if (this.testPattern(url, pattern)) {
                const priority = this.calculatePriority(pattern, url);
                const specificity = this.calculateSpecificity(pattern);

                matches.push({
                    pattern,
                    priority,
                    specificity,
                    matchType: pattern.type,
                });
            }
        }

        // Sort by priority (highest first), then by specificity, then alphabetically
        return matches.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            if (a.specificity !== b.specificity) {
                return b.specificity - a.specificity;
            }
            return a.pattern.pattern.localeCompare(b.pattern.pattern);
        });
    }

    /**
     * Test if a single pattern matches a URL
     */
    testPattern(url: string, pattern: UrlPattern): boolean {
        try {
            switch (pattern.type) {
                case "exact":
                    return this.matchExact(url, pattern.pattern);
                case "glob":
                    return this.matchGlob(url, pattern.pattern);
                case "regex":
                    return this.matchRegex(url, pattern.pattern);
                default:
                    console.warn(`Unknown pattern type: ${pattern.type}`);
                    return false;
            }
        } catch (error) {
            console.error(
                `Pattern matching error for pattern "${pattern.pattern}":`,
                error,
            );
            return false;
        }
    }

    /**
     * Calculate pattern priority for sorting
     */
    calculatePriority(pattern: UrlPattern, url: string): number {
        // Use pattern's explicit priority if set, otherwise calculate
        if (pattern.priority && pattern.priority > 0) {
            return pattern.priority;
        }

        switch (pattern.type) {
            case "exact":
                return 100; // Highest priority for exact matches
            case "glob":
                return this.calculateGlobPriority(pattern.pattern, url);
            case "regex":
                return this.calculateRegexPriority(pattern.pattern);
            default:
                return 1; // Lowest priority for unknown types
        }
    }

    /**
     * Calculate pattern specificity for tie-breaking
     */
    private calculateSpecificity(pattern: UrlPattern): number {
        switch (pattern.type) {
            case "exact":
                return pattern.pattern.length; // Longer exact patterns are more specific
            case "glob":
                return this.calculateGlobSpecificity(pattern.pattern);
            case "regex":
                return this.calculateRegexSpecificity(pattern.pattern);
            default:
                return 0;
        }
    }

    /**
     * Exact URL matching
     */
    private matchExact(url: string, pattern: string): boolean {
        return url === pattern;
    }

    /**
     * Glob pattern matching with caching
     */
    private matchGlob(url: string, pattern: string): boolean {
        let regex = this.globCache.get(pattern);
        if (!regex) {
            const regexStr = this.convertGlobToRegex(pattern);
            regex = new RegExp(`^${regexStr}$`);
            this.globCache.set(pattern, regex);
        }
        return regex.test(url);
    }

    /**
     * Regex pattern matching with caching
     */
    private matchRegex(url: string, pattern: string): boolean {
        let regex = this.regexCache.get(pattern);
        if (!regex) {
            regex = new RegExp(pattern);
            this.regexCache.set(pattern, regex);
        }
        return regex.test(url);
    }

    /**
     * Convert glob pattern to regex string
     */
    private convertGlobToRegex(pattern: string): string {
        // Escape special regex characters except glob wildcards
        let regexStr = pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
            .replace(/\*\*/g, "___DOUBLESTAR___") // Temp placeholder for **
            .replace(/\*/g, "[^/]*") // * matches within path segment
            .replace(/___DOUBLESTAR___/g, ".*") // ** matches across segments
            .replace(/\?/g, "[^/]"); // ? matches single character

        return regexStr;
    }

    /**
     * Calculate priority for glob patterns based on specificity
     */
    private calculateGlobPriority(pattern: string, url: string): number {
        let priority = 70; // Base priority for glob patterns

        // More specific patterns get higher priority
        const segments = pattern.split("/").filter((s) => s.length > 0);
        const literalSegments = segments.filter(
            (s) => !s.includes("*") && !s.includes("?"),
        );

        // Boost priority for more literal segments
        priority += literalSegments.length * 5;

        // Boost priority for patterns with fewer wildcards
        const wildcards = (pattern.match(/\*/g) || []).length;
        priority -= wildcards * 2;

        // Boost priority for longer patterns (more specific)
        priority += Math.min(pattern.length / 10, 10);

        return Math.max(priority, 50); // Minimum priority of 50
    }

    /**
     * Calculate priority for regex patterns
     */
    private calculateRegexPriority(pattern: string): number {
        // Regex patterns get lower priority than glob by default
        let priority = 60;

        // Longer patterns are generally more specific
        priority += Math.min(pattern.length / 15, 10);

        // Patterns with anchors are more specific
        if (pattern.startsWith("^")) priority += 5;
        if (pattern.endsWith("$")) priority += 5;

        return Math.max(priority, 40); // Minimum priority of 40
    }

    /**
     * Calculate specificity for glob patterns
     */
    private calculateGlobSpecificity(pattern: string): number {
        let specificity = 0;

        // Count literal characters (non-wildcard)
        const literalChars = pattern.replace(/[*?]/g, "").length;
        specificity += literalChars;

        // Count path segments
        const segments = pattern.split("/").filter((s) => s.length > 0);
        specificity += segments.length * 10;

        // Penalize wildcards
        const wildcards = (pattern.match(/[*?]/g) || []).length;
        specificity -= wildcards * 5;

        return Math.max(specificity, 0);
    }

    /**
     * Calculate specificity for regex patterns
     */
    private calculateRegexSpecificity(pattern: string): number {
        let specificity = 0;

        // Longer patterns are generally more specific
        specificity += pattern.length / 2;

        // Patterns with anchors are more specific
        if (pattern.startsWith("^")) specificity += 10;
        if (pattern.endsWith("$")) specificity += 10;

        // Count literal characters (rough estimate)
        const literalChars = pattern.replace(/[.*+?^${}()|[\]\\]/g, "").length;
        specificity += literalChars;

        return Math.max(specificity, 0);
    }

    /**
     * Clear all caches (useful for testing or memory management)
     */
    clearCaches(): void {
        this.globCache.clear();
        this.regexCache.clear();
    }

    /**
     * Get cache statistics for monitoring
     */
    getCacheStats(): { globCacheSize: number; regexCacheSize: number } {
        return {
            globCacheSize: this.globCache.size,
            regexCacheSize: this.regexCache.size,
        };
    }
}
