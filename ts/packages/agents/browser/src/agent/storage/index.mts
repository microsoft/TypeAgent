// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ActionsStore Phase 1 - Foundation
 * 
 * This module provides the core storage infrastructure for browser actions.
 * 
 * Phase 1 Features:
 * - File-based storage using agent sessionStorage
 * - Basic CRUD operations for actions
 * - Action validation and sanitization  
 * - Fast lookup through indexing
 * - Compatibility layer for existing APIs
 */

// Core storage classes
export { ActionsStore } from "./actionsStore.mjs";
export { FileManager } from "./fileManager.mjs";
export { ActionValidator, ActionIndexManager } from "./validator.mjs";
export { StorageCompatibilityAdapter } from "./compatibilityAdapter.mjs";

// Type definitions
export * from "./types.mjs";

// Convenience factory function
import { ActionsStore } from "./actionsStore.mjs";
import { StorageCompatibilityAdapter } from "./compatibilityAdapter.mjs";

/**
 * Create a new ActionsStore instance
 */
export function createActionsStore(sessionStorage: any): ActionsStore {
    return new ActionsStore(sessionStorage);
}

/**
 * Create a complete storage system with compatibility adapter
 */
export async function createActionsStoreWithAdapter(sessionStorage: any): Promise<{
    store: ActionsStore;
    adapter: StorageCompatibilityAdapter;
}> {
    const store = new ActionsStore(sessionStorage);
    await store.initialize();
    
    const adapter = new StorageCompatibilityAdapter(store);
    
    return { store, adapter };
}
