// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AppAgentSource } from "agent-dispatcher";
import type { RegisteredMcpToolCatalog } from "./mcpToolCatalog.js";

type CatalogSource = AppAgentSource & {
    getCurrentToolCatalogs(): Promise<RegisteredMcpToolCatalog[]>;
};

function hasCatalog(source: AppAgentSource): source is CatalogSource {
    return (
        "getCurrentToolCatalogs" in source &&
        typeof source.getCurrentToolCatalogs === "function"
    );
}

// Only registered source-owned providers are inspected. Never connect servers
// or discover connectors as a side effect of a binding picker.
export async function getCurrentMcpToolCatalogs(
    sources: readonly AppAgentSource[],
): Promise<RegisteredMcpToolCatalog[]> {
    const catalogs = sources.filter(hasCatalog);
    if (catalogs.length === 0) {
        throw new Error(
            "Registered MCP tool catalog is unavailable in this host.",
        );
    }
    return (
        await Promise.all(
            catalogs.map((source) => source.getCurrentToolCatalogs()),
        )
    ).flat();
}
