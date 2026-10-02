// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const browserViews = {
    annotationsLibrary: {
        path: "/annotations/",
        page: "annotationsLibrary.html",
    },
    knowledgeLibrary: {
        path: "/knowledge/",
        page: "knowledgeLibrary.html",
    },
    memoryCenter: { path: "/memory/", page: "memoryCenter.html" },
    automationsLibrary: {
        path: "/automations/",
        page: "automationsLibrary.html",
    },
    entityGraph: {
        path: "/knowledge/entities/",
        page: "entityGraphView.html",
    },
    topicGraph: {
        path: "/knowledge/topics/",
        page: "topicGraphView.html",
    },
} as const;

export type BrowserViewName = keyof typeof browserViews;

const viewNames = Object.keys(browserViews) as BrowserViewName[];

export function getBrowserViewName(value: string): BrowserViewName | undefined {
    const normalized = value.replace(/[\s_-]/g, "").toLowerCase();
    return viewNames.find(
        (name) =>
            name.toLowerCase() === normalized ||
            browserViews[name].page.replace(/\.html$/, "").toLowerCase() ===
                normalized ||
            (name === "automationsLibrary" &&
                ["automations", "actionlibrary", "macroslibrary"].includes(
                    normalized,
                )),
    );
}

export function parseBrowserViewUrl(
    value: string,
): { name: BrowserViewName; search: string; hash: string } | undefined {
    if (!value.toLowerCase().startsWith("typeagent-browser:")) {
        return undefined;
    }
    const url = new URL(value);
    const page =
        url.hostname === "views"
            ? url.pathname.slice(1)
            : url.pathname === "" || url.pathname === "/"
              ? url.hostname
              : "";
    const name = viewNames.find(
        (candidate) =>
            browserViews[candidate].page.toLowerCase() === page.toLowerCase(),
    );
    if (!name) {
        throw new Error(`Unknown browser view URL: ${value}`);
    }
    return { name, search: url.search, hash: url.hash };
}

export function getBrowserViewUrl(
    baseUrl: string,
    name: BrowserViewName,
    search = "",
    hash = "",
): string {
    const base = new URL(baseUrl);
    if (
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.port === "0"
    ) {
        throw new Error("Browser view host URL is invalid or unavailable");
    }
    const url = new URL(browserViews[name].path, base);
    url.search = search;
    url.hash = hash;
    return url.href;
}

export function resolveBrowserViewUrl(value: string, baseUrl: string): string {
    const view = parseBrowserViewUrl(value);
    return view
        ? getBrowserViewUrl(baseUrl, view.name, view.search, view.hash)
        : value;
}

export function isHostedBrowserView(value: string, baseUrl: string): boolean {
    const url = new URL(value);
    if (url.origin !== new URL(baseUrl).origin) {
        return false;
    }
    return viewNames.some(
        (name) =>
            url.pathname === browserViews[name].path ||
            url.pathname === `/library/${browserViews[name].page}`,
    );
}

export function getBrowserViewLink(
    name: BrowserViewName,
    search = "",
    hash = "",
): string {
    const url = new URL(`typeagent-browser://views/${browserViews[name].page}`);
    url.search = search;
    url.hash = hash;
    return url.href;
}

export function getDiscoveredViewHostUrl(
    discoveryUrl: string,
    port: number,
    remoteUrl?: string,
): string {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("Browser view port is invalid or unavailable");
    }
    const base = new URL(remoteUrl ?? discoveryUrl);
    if (base.protocol === "ws:") base.protocol = "http:";
    if (base.protocol === "wss:") base.protocol = "https:";
    if (
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password
    ) {
        throw new Error("Browser view discovery URL is invalid");
    }
    if (remoteUrl === undefined) {
        base.port = String(port);
        base.pathname = "/";
        base.search = "";
        base.hash = "";
    }
    return base.href;
}
