// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../browserActions.mjs";

export interface ActionContextCacheEntry {
    url: string;
    normalizedUrl: string;
    actionContext: ActionContext<BrowserActionContext>;
    tabId?: string | undefined;
    dynamicDisplayId?: string | undefined;
    lastAccessed: number;
    createdAt: number;
}

export class ActionContextCache {
    private cache = new Map<string, ActionContextCacheEntry>();
    private maxSize = 50;
    private maxAge = 30 * 60 * 1000;

    set(
        url: string,
        context: ActionContext<BrowserActionContext>,
        tabId?: string,
        dynamicDisplayId?: string,
    ): void {
        const normalizedUrl = this.normalizeUrl(url);
        const entry: ActionContextCacheEntry = {
            url,
            normalizedUrl,
            actionContext: context,
            tabId,
            dynamicDisplayId,
            lastAccessed: Date.now(),
            createdAt: Date.now(),
        };

        this.cache.set(normalizedUrl, entry);
        this.evictOldEntries();
    }

    get(url: string): ActionContext<BrowserActionContext> | null {
        const normalizedUrl = this.normalizeUrl(url);
        const entry = this.cache.get(normalizedUrl);

        if (entry) {
            // Check if entry is still valid (age and context validity)
            if (Date.now() - entry.createdAt > this.maxAge) {
                this.cache.delete(normalizedUrl);
                return null;
            }

            // Check if the ActionContext is still valid (not closed)
            if (!isActionContextValid(entry.actionContext)) {
                this.cache.delete(normalizedUrl);
                return null;
            }

            entry.lastAccessed = Date.now();
            return entry.actionContext;
        }

        return null;
    }

    getDynamicDisplayId(url: string): string | null {
        const normalizedUrl = this.normalizeUrl(url);
        const entry = this.cache.get(normalizedUrl);

        if (entry) {
            // Check if entry is still valid (age and context validity)
            if (Date.now() - entry.createdAt > this.maxAge) {
                this.cache.delete(normalizedUrl);
                return null;
            }

            // Check if the ActionContext is still valid (not closed)
            if (!isActionContextValid(entry.actionContext)) {
                this.cache.delete(normalizedUrl);
                return null;
            }

            entry.lastAccessed = Date.now();
            return entry.dynamicDisplayId || null;
        }

        return null;
    }

    private normalizeUrl(url: string): string {
        try {
            const parsed = new URL(url);
            // Keep query params (they often define unique content)
            // Remove fragments (they're just page anchors)
            return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
        } catch {
            return url;
        }
    }

    private evictOldEntries(): void {
        if (this.cache.size <= this.maxSize) return;

        // Sort by last accessed and remove oldest
        const entries = Array.from(this.cache.entries()).sort(
            (a, b) => a[1].lastAccessed - b[1].lastAccessed,
        );

        const toRemove = entries.slice(0, this.cache.size - this.maxSize);
        toRemove.forEach(([key]) => this.cache.delete(key));
    }
}

// Helper function to check if ActionContext is still valid
export function isActionContextValid(
    context: ActionContext<BrowserActionContext>,
): boolean {
    try {
        // Try to access a property that would throw if context is closed
        context.sessionContext;
        return true;
    } catch (error) {
        if (
            error instanceof Error &&
            error.message.includes("Context is closed")
        ) {
            return false;
        }
        // Re-throw other types of errors
        throw error;
    }
}

export const actionContextCache = new ActionContextCache();
