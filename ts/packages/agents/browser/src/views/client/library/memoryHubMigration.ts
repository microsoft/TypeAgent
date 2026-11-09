// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    getBrowserViewName,
    getRetiredBrowserViewHash,
    isRetiredBrowserView,
} from "@typeagent/browser-control-rpc/viewRoutes";

export function migrateLegacyMemoryLocation(value: string): URL {
    const url = new URL(value);
    const markers = url.searchParams.getAll("legacyView");
    if (!markers.length) return url;
    const name = getBrowserViewName(markers[markers.length - 1]);
    if (!name || !isRetiredBrowserView(name)) {
        throw new Error("The legacy Memory page link is invalid");
    }
    url.hash = getRetiredBrowserViewHash(name, url.search, url.hash);
    url.searchParams.delete("legacyView");
    return url;
}
