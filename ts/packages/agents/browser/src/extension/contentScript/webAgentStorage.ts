// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const PREFIX = "__typeagent_wa_";

export const TTL = {
    CONTINUATION: 5 * 60 * 1000, // 5 minutes
    CROSSWORD_SCHEMA: 6 * 60 * 60 * 1000, // 6 hours
    AGENT_REGISTERED: 60 * 60 * 1000, // 1 hour
};

interface StoredItem<T> {
    value: T;
    expiry: number;
}

export const webAgentStorage = {
    set<T>(key: string, value: T, ttlMs: number): void {
        const item: StoredItem<T> = {
            value,
            expiry: Date.now() + ttlMs,
        };
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify(item));
        } catch (e) {
            console.error("webAgentStorage.set failed:", e);
        }
    },

    get<T>(key: string): T | null {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (!raw) return null;

            const item: StoredItem<T> = JSON.parse(raw);
            if (Date.now() > item.expiry) {
                localStorage.removeItem(PREFIX + key);
                return null;
            }
            return item.value;
        } catch (e) {
            console.error("webAgentStorage.get failed:", e);
            return null;
        }
    },

    remove(key: string): void {
        try {
            localStorage.removeItem(PREFIX + key);
        } catch (e) {
            console.error("webAgentStorage.remove failed:", e);
        }
    },

    cleanup(): void {
        try {
            const now = Date.now();
            const keysToRemove: string[] = [];

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(PREFIX)) {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        try {
                            const item: StoredItem<unknown> = JSON.parse(raw);
                            if (now > item.expiry) {
                                keysToRemove.push(key);
                            }
                        } catch {
                            keysToRemove.push(key);
                        }
                    }
                }
            }

            keysToRemove.forEach((key) => localStorage.removeItem(key));
            if (keysToRemove.length > 0) {
                console.log(
                    `webAgentStorage.cleanup: removed ${keysToRemove.length} expired items`,
                );
            }
        } catch (e) {
            console.error("webAgentStorage.cleanup failed:", e);
        }
    },
};

export interface ContinuationState {
    type: string;
    step: string;
    data: Record<string, unknown>;
    tabId: string;
    url: string;
    createdAt: number;
}

export const continuationStorage = {
    set(
        tabId: string,
        state: Omit<ContinuationState, "tabId" | "createdAt">,
    ): void {
        const fullState: ContinuationState = {
            ...state,
            tabId,
            createdAt: Date.now(),
        };
        webAgentStorage.set(
            `continuation_${tabId}`,
            fullState,
            TTL.CONTINUATION,
        );
    },

    get(tabId: string): ContinuationState | null {
        return webAgentStorage.get<ContinuationState>(`continuation_${tabId}`);
    },

    remove(tabId: string): void {
        webAgentStorage.remove(`continuation_${tabId}`);
    },
};

export interface CrosswordSchema {
    boardId: string;
    cells: Record<string, { selector: string; clueNumber?: number }>;
    clues: {
        across: Record<number, { text: string; selector: string }>;
        down: Record<number, { text: string; selector: string }>;
    };
    extractedAt: number;
}

export const crosswordSchemaStorage = {
    set(url: string, schema: Omit<CrosswordSchema, "extractedAt">): void {
        const fullSchema: CrosswordSchema = {
            ...schema,
            extractedAt: Date.now(),
        };
        const key = `crossword_${normalizeUrl(url)}`;
        webAgentStorage.set(key, fullSchema, TTL.CROSSWORD_SCHEMA);
    },

    get(url: string): CrosswordSchema | null {
        const key = `crossword_${normalizeUrl(url)}`;
        return webAgentStorage.get<CrosswordSchema>(key);
    },

    remove(url: string): void {
        const key = `crossword_${normalizeUrl(url)}`;
        webAgentStorage.remove(key);
    },
};

export const registrationStorage = {
    markRegistered(agentName: string): void {
        webAgentStorage.set(
            `registered_${agentName}`,
            true,
            TTL.AGENT_REGISTERED,
        );
    },

    wasRecentlyRegistered(agentName: string): boolean {
        return webAgentStorage.get<boolean>(`registered_${agentName}`) === true;
    },
};

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname}`.replace(
            /[^a-zA-Z0-9]/g,
            "_",
        );
    } catch {
        return url.replace(/[^a-zA-Z0-9]/g, "_");
    }
}
