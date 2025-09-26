// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface TabNavigationState {
    url: string;
    title: string;
    lastNavigationTime: number;
    navigationSent: boolean;
    isUserRefresh: boolean;
    pendingTimer: NodeJS.Timeout | null;
}

export type NavigationType = "new" | "refresh" | "duplicate" | "tracking";

const tabNavigationStates = new Map<string, TabNavigationState>();

const trackingParams = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "msclkid",
    "rdr",
    "rdrig",
    "_ga",
    "_gl",
    "mc_cid",
    "mc_eid",
    "yclid",
    "zanpid",
    "kenshoo_id",
    "guccounter",
];

const analyticsPatterns = [
    /analytics\./i,
    /\/analytics\//i,
    /zephr-templates/i,
    /google-analytics/i,
    /googletagmanager/i,
    /doubleclick/i,
    /scorecardresearch/i,
    /quantserve/i,
    /facebook\.com\/tr/i,
    /amazon-adsystem/i,
    /googlesyndication/i,
    /chartbeat/i,
    /newrelic/i,
];

export function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);

        trackingParams.forEach((param) => parsed.searchParams.delete(param));

        parsed.searchParams.sort();

        parsed.hash = "";

        return parsed.toString();
    } catch {
        return url;
    }
}

export function isSamePageWithTracking(url1: string, url2: string): boolean {
    if (!url1 || !url2) return false;
    return normalizeUrl(url1) === normalizeUrl(url2);
}

export function isAnalyticsUrl(url: string): boolean {
    return analyticsPatterns.some((pattern) => pattern.test(url));
}

export function detectNavigationType(
    tabId: string,
    url: string,
    title: string,
    isUserInitiated: boolean = false,
): NavigationType {
    const tabState = tabNavigationStates.get(tabId);

    if (!tabState) {
        return "new";
    }

    if (isUserInitiated && tabState.url === url) {
        return "refresh";
    }

    if (tabState.url === url && tabState.title === title) {
        const timeSinceLastNav = Date.now() - tabState.lastNavigationTime;

        if (tabState.navigationSent && timeSinceLastNav < 2000) {
            return "duplicate";
        }

        if (tabState.navigationSent && timeSinceLastNav >= 2000) {
            return "refresh";
        }
    }

    if (isSamePageWithTracking(tabState.url, url) && tabState.title === title) {
        return "tracking";
    }

    return "new";
}

export function getTabState(tabId: string): TabNavigationState | undefined {
    return tabNavigationStates.get(tabId);
}

export function createTabState(tabId: string): TabNavigationState {
    const state: TabNavigationState = {
        url: "",
        title: "",
        lastNavigationTime: 0,
        navigationSent: false,
        isUserRefresh: false,
        pendingTimer: null,
    };
    tabNavigationStates.set(tabId, state);
    return state;
}

export function updateTabState(
    tabId: string,
    url: string,
    title: string,
    navigationSent: boolean = true,
    isUserRefresh: boolean = false,
): void {
    const state = tabNavigationStates.get(tabId) || createTabState(tabId);
    state.url = url;
    state.title = title;
    state.lastNavigationTime = Date.now();
    state.navigationSent = navigationSent;
    state.isUserRefresh = isUserRefresh;
    state.pendingTimer = null;
}

export function markUserRefresh(tabId: string): void {
    const state = tabNavigationStates.get(tabId);
    if (state) {
        state.isUserRefresh = true;
    }
}

export function clearPendingTimer(tabId: string): void {
    const state = tabNavigationStates.get(tabId);
    if (state?.pendingTimer) {
        clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
    }
}

export function setPendingTimer(tabId: string, timer: NodeJS.Timeout): void {
    const state = tabNavigationStates.get(tabId) || createTabState(tabId);
    state.pendingTimer = timer;
}

export function cleanupTabState(tabId: string): void {
    clearPendingTimer(tabId);
    tabNavigationStates.delete(tabId);
}

export function shouldProcessRefresh(
    tabState: TabNavigationState,
    currentTime: number = Date.now(),
): { process: boolean; reason: string } {
    const timeSinceLastNav = currentTime - tabState.lastNavigationTime;

    if (tabState.isUserRefresh) {
        return { process: true, reason: "User-initiated refresh" };
    }

    if (timeSinceLastNav < 10000) {
        return { process: false, reason: "Too rapid - likely duplicate" };
    }

    if (timeSinceLastNav < 60000) {
        if (tabState.url.match(/dashboard|monitor|live|feed|stream/i)) {
            return {
                process: false,
                reason: "Dashboard auto-refresh - skipping",
            };
        }
        return {
            process: true,
            reason: "Auto-refresh after reasonable interval",
        };
    }

    return { process: true, reason: "Refresh after significant time" };
}
