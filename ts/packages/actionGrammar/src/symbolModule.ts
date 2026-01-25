// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Symbol Module System
 *
 * This provides static TypeScript-based module support for grammar symbols.
 * Symbols can have both matchers (for cache) and converters (for agents).
 */

/**
 * A symbol matcher tests if a token matches a symbol type.
 * Used by cache clients that only need to know if a match occurred.
 */
export interface SymbolMatcher {
    /**
     * Test if a token matches this symbol type
     * @param token The token to test
     * @returns true if the token matches
     */
    match(token: string): boolean;
}

/**
 * A symbol converter both matches and converts tokens to typed values.
 * Used by agent clients that need the actual converted value.
 */
export interface SymbolConverter<T> extends SymbolMatcher {
    /**
     * Convert a matching token to its typed value
     * @param token The token to convert
     * @returns The converted value, or undefined if conversion fails
     */
    convert(token: string): T | undefined;
}

/**
 * Registry for managing symbol modules.
 * This is an internal data structure - symbols are registered via static imports.
 */
export class SymbolRegistry {
    private matchers = new Map<string, SymbolMatcher>();
    private converters = new Map<string, SymbolConverter<any>>();

    /**
     * Register a symbol with just a matcher (for types that don't need conversion)
     */
    registerMatcher(name: string, matcher: SymbolMatcher): void {
        this.matchers.set(name, matcher);
    }

    /**
     * Register a symbol with both matcher and converter
     */
    registerConverter<T>(name: string, converter: SymbolConverter<T>): void {
        this.matchers.set(name, converter);
        this.converters.set(name, converter);
    }

    /**
     * Get a matcher for a symbol (for cache clients)
     */
    getMatcher(name: string): SymbolMatcher | undefined {
        return this.matchers.get(name);
    }

    /**
     * Get a converter for a symbol (for agent clients)
     */
    getConverter<T>(name: string): SymbolConverter<T> | undefined {
        return this.converters.get(name) as SymbolConverter<T> | undefined;
    }

    /**
     * Check if a symbol is registered
     */
    hasSymbol(name: string): boolean {
        return this.matchers.has(name);
    }
}

/**
 * Global registry instance (internal use only)
 * Symbols are registered via module imports during initialization
 */
export const globalSymbolRegistry = new SymbolRegistry();

/**
 * Helper to create a simple matcher from a predicate function
 */
export function createMatcher(test: (token: string) => boolean): SymbolMatcher {
    return { match: test };
}

/**
 * Helper to create a converter from match and convert functions
 */
export function createConverter<T>(
    match: (token: string) => boolean,
    convert: (token: string) => T | undefined,
): SymbolConverter<T> {
    return { match, convert };
}
