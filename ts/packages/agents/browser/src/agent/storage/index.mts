// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * MacroStore - Complete storage infrastructure for browser macros
 *
 * This module provides comprehensive storage capabilities including:
 * - File-based storage using agent sessionStorage
 * - Full CRUD operations for macros
 * - Macro validation and sanitization
 * - Fast lookup through indexing
 * - URL pattern matching and domain management
 * - Search and analytics capabilities
 */

// Core storage classes
export { MacroStore } from "./macroStore.mjs";
export { FileManager } from "./fileManager.mjs";
export { MacroValidator, MacroIndexManager } from "./validator.mjs";

// Pattern matching and domain management
export { UrlMatcher } from "./urlMatcher.mjs";
export { PatternResolver } from "./patternResolver.mjs";
export { DomainManager } from "./domainManager.mjs";

// Advanced features
export { MacroSearchEngine } from "./searchEngine.mjs";
export { AnalyticsManager } from "./analyticsManager.mjs";

// Backward compatibility exports
export { MacroStore as ActionsStore } from "./macroStore.mjs";
export { MacroValidator as ActionValidator, MacroIndexManager as ActionIndexManager } from "./validator.mjs";
export { MacroSearchEngine as ActionSearchEngine } from "./searchEngine.mjs";

// Type definitions
export * from "./types.mjs";

// Convenience factory function
import { MacroStore } from "./macroStore.mjs";

/**
 * Create a new MacroStore instance
 */
export function createMacroStore(sessionStorage: any): MacroStore {
    return new MacroStore(sessionStorage);
}

/**
 * Create a new ActionsStore instance (backward compatibility)
 */
export function createActionsStore(sessionStorage: any): MacroStore {
    return new MacroStore(sessionStorage);
}
