// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Storage functions for browser extension
// Routes storage operations to agent through service worker messages

/**
 * Sets a stored property for a specific page
 * @param url The URL of the page
 * @param key The property key
 * @param value The property value
 */
export async function setStoredPageProperty(
    url: string,
    key: string,
    value: any,
): Promise<void> {
    try {
        const result = await chrome.storage.local.get([url]);
        const urlData = result[url] || {};
        urlData[key] = value;

        await chrome.storage.local.set({ [url]: urlData });
        console.log(`Saved property '${key}' for ${url}`);
    } catch (error) {
        console.error("Error saving data:", error);
    }
}

/**
 * Gets a stored property for a specific page
 * @param url The URL of the page
 * @param key The property key
 * @returns The stored property value or null
 */
export async function getStoredPageProperty(
    url: string,
    key: string,
): Promise<any | null> {
    try {
        const result = await chrome.storage.local.get([url]);
        return result[url]?.[key] ?? null;
    } catch (error) {
        console.error("Error retrieving data:", error);
        return null;
    }
}

/**
 * Deletes a stored property for a specific page
 * @param url The URL of the page
 * @param key The property key
 */
export async function deleteStoredPageProperty(
    url: string,
    key: string,
): Promise<void> {
    try {
        const result = await chrome.storage.local.get([url]);
        const urlData = result[url] || {};

        if (key in urlData) {
            delete urlData[key];

            if (Object.keys(urlData).length === 0) {
                await chrome.storage.local.remove(url);
                console.log(`All properties deleted for ${url}`);
            } else {
                await chrome.storage.local.set({ [url]: urlData });
                console.log(`Deleted property '${key}' for ${url}`);
            }
        }
    } catch (error) {
        console.error("Error deleting data:", error);
    }
}

/**
 * Action storage functions that route operations to the ActionsStore
 * via service worker messages
 */

/**
 * Get actions for a URL
 */
export async function getActionsForUrl(url: string, options: {
    includeGlobal?: boolean;
    author?: "discovered" | "user";
} = {}): Promise<any[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getActionsForUrl",
            url: url,
            includeGlobal: options.includeGlobal ?? true,
            author: options.author
        });
        
        return response?.actions || [];
    } catch (error) {
        console.error("Failed to get actions for URL:", error);
        return [];
    }
}

/**
 * Save an authored action
 */
export async function saveAuthoredAction(url: string, actionData: any): Promise<boolean> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "manualSaveAuthoredAction",
            url: url,
            actionData: actionData
        });
        
        return response?.success || false;
    } catch (error) {
        console.error("Failed to save authored action:", error);
        return false;
    }
}

/**
 * Record action usage for analytics
 */
export async function recordActionUsage(actionId: string): Promise<boolean> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "recordActionUsage",
            actionId: actionId
        });
        
        return response?.success || false;
    } catch (error) {
        console.error("Failed to record action usage:", error);
        return false;
    }
}

/**
 * Get action statistics for a URL
 */
export async function getActionStatistics(url?: string): Promise<{
    totalActions: number;
    actions: any[];
}> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getActionStatistics",
            url: url
        });
        
        return {
            totalActions: response?.totalActions || 0,
            actions: response?.actions || []
        };
    } catch (error) {
        console.error("Failed to get action statistics:", error);
        return { totalActions: 0, actions: [] };
    }
}


