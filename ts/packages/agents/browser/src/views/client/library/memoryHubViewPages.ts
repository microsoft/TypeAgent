// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SchemaViewPageRequest } from "@typeagent/memory-service";
import { routeHash } from "./memoryHubModel";

export function parseSchemaViewPageUri(uri: string): SchemaViewPageRequest {
    const url = new URL(uri);
    if (
        url.protocol !== "memory-view:" ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
    )
        throw new Error("Invalid schema view page URI.");
    const corpusId = decodeURIComponent(url.hostname);
    const parts = url.pathname.split("/").filter(Boolean);
    if (!corpusId || parts.length !== 1)
        throw new Error("Invalid schema view page identity.");
    const request: SchemaViewPageRequest = {
        corpusId,
        viewId: decodeURIComponent(parts[0]),
    };
    for (const key of ["slotId", "itemKey", "revisionId"] as const) {
        const values = url.searchParams.getAll(key);
        if (values.length > 1 || values.some((value) => !value))
            throw new Error("Invalid schema view page selection.");
        if (values.length) request[key] = values[0];
    }
    for (const key of url.searchParams.keys())
        if (!["slotId", "itemKey", "revisionId"].includes(key))
            throw new Error("Unknown schema view page parameter.");
    return request;
}

export function schemaViewPageBrowserLink(uri: string): string {
    const request = parseSchemaViewPageUri(uri);
    return routeHash({
        page: "views",
        corpusId: request.corpusId,
        objectId: request.viewId,
        ...(request.revisionId ? { viewRevisionId: request.revisionId } : {}),
        ...(request.slotId ? { viewPageId: request.slotId } : {}),
        ...(request.itemKey ? { viewItemKey: request.itemKey } : {}),
    });
}
