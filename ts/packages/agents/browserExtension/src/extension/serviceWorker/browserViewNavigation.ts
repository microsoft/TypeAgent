// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getBrowserViewUrl,
    browserViews,
    parseBrowserViewUrl,
    type BrowserViewName,
    getBrowserViewDestination,
    isRetiredBrowserView,
} from "@typeagent/browser-control-rpc/viewRoutes";

export type ViewHostLookup = () => Promise<string>;

export async function getViewHostUrl(
    sendActionToAgent: (request: {
        actionName: "getViewHostUrl";
        parameters: {};
    }) => Promise<unknown>,
): Promise<string> {
    const response: unknown = await sendActionToAgent({
        actionName: "getViewHostUrl",
        parameters: {},
    });
    if (
        typeof response !== "object" ||
        response === null ||
        !("url" in response) ||
        typeof response.url !== "string"
    ) {
        throw new Error(
            "Browser view host is unavailable. Ensure TypeAgent is running.",
        );
    }
    return response.url;
}

export async function resolveLocalBrowserViewUrl(
    url: string,
    lookup: ViewHostLookup,
): Promise<string> {
    const view = parseBrowserViewUrl(url);
    return view
        ? getBrowserViewUrl(await lookup(), view.name, view.search, view.hash)
        : url;
}

export async function openBrowserView(
    name: BrowserViewName,
    lookup: ViewHostLookup,
): Promise<void> {
    const url = getBrowserViewUrl(await lookup(), name);
    const destination = getBrowserViewDestination(name);
    const canonical = new URL(url);
    canonical.search = "";
    canonical.hash = "";
    const pageUrl = new URL(`/library/${browserViews[destination].page}`, url)
        .href;
    const tabs = await chrome.tabs.query({ url: [canonical.href, pageUrl] });
    const existing = tabs[0];
    if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, {
            active: true,
            ...(isRetiredBrowserView(name) ? { url } : {}),
        });
        await chrome.windows.update(existing.windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url, active: true });
    }
}
