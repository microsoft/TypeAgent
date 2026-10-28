// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
    EXTENSION_ID,
    getUiCapability,
    RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function supportsHtml(params: unknown): boolean {
    const capabilities = object(object(params)?.capabilities);
    const extensions = object(capabilities?.extensions);
    if (!extensions) return false;
    const ui = getUiCapability({
        extensions: { [EXTENSION_ID]: extensions[EXTENSION_ID] },
    });
    return (
        Array.isArray(ui?.mimeTypes) &&
        ui.mimeTypes.every((type: unknown) => typeof type === "string") &&
        ui.mimeTypes.includes(RESOURCE_MIME_TYPE)
    );
}

/** SDK 1.26 strips the newer extensions field; observe only this UI hint before validation. */
export function observeMemoryUiCapability(transport: Transport): () => boolean {
    const receive = transport.onmessage;
    if (!receive)
        throw new Error(
            "Connect the MCP transport before observing UI capability",
        );
    let supported = false;
    transport.onmessage = (message, extra) => {
        if ("method" in message && message.method === "initialize")
            supported = supportsHtml(message.params);
        receive(message, extra);
    };
    return () => supported;
}
