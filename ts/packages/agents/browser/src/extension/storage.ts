// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Storage functions for browser extension
// Routes storage operations to agent through service worker messages

/**
 * Action storage functions that route operations to the ActionsStore
 * via service worker messages
 */

/**
 * Get actions for a URL
 */
export async function getActionsForUrl(
    url: string,
    options: {
        includeGlobal?: boolean;
        author?: "discovered" | "user";
    } = {},
): Promise<any[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getActionsForUrl",
            url: url,
            includeGlobal: options.includeGlobal ?? true,
            author: options.author,
        });

        return response?.actions || [];
    } catch (error) {
        console.error("Failed to get actions for URL:", error);
        return [];
    }
}

/**
 * Record action usage for analytics
 */
export async function recordActionUsage(actionId: string): Promise<boolean> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "recordActionUsage",
            actionId: actionId,
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
            url: url,
        });

        return {
            totalActions: response?.totalActions || 0,
            actions: response?.actions || [],
        };
    } catch (error) {
        console.error("Failed to get action statistics:", error);
        return { totalActions: 0, actions: [] };
    }
}

/**
 * Get all actions across all URLs
 */
export async function getAllActions(): Promise<any[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getAllActions",
        });

        return response?.actions || [];
    } catch (error) {
        console.error("Failed to get all actions:", error);
        return [];
    }
}

/**
 * Get unique domains from actions
 */
export async function getActionDomains(): Promise<string[]> {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "getActionDomains",
        });

        return response?.domains || [];
    } catch (error) {
        console.error("Failed to get action domains:", error);
        return [];
    }
}
