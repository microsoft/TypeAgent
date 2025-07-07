// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ActionsStore - Complete storage infrastructure for browser actions
 *
 * This module provides comprehensive storage capabilities including:
 * - File-based storage using agent sessionStorage
 * - Full CRUD operations for actions
 * - Action validation and sanitization
 * - Fast lookup through indexing
 * - URL pattern matching and domain management
 * - Search and analytics capabilities
 */

// Core storage classes
export { ActionsStore } from "./actionsStore.mjs";
export { FileManager } from "./fileManager.mjs";
export { ActionValidator, ActionIndexManager } from "./validator.mjs";

// Pattern matching and domain management
export { UrlMatcher } from "./urlMatcher.mjs";
export { PatternResolver } from "./patternResolver.mjs";
export { DomainManager } from "./domainManager.mjs";

// Advanced features
export { ActionSearchEngine } from "./searchEngine.mjs";
export { AnalyticsManager } from "./analyticsManager.mjs";

// Type definitions
export * from "./types.mjs";

// Convenience factory function
import { ActionsStore } from "./actionsStore.mjs";

/**
 * Create a new ActionsStore instance
 */
export function createActionsStore(sessionStorage: any): ActionsStore {
    return new ActionsStore(sessionStorage);
}
