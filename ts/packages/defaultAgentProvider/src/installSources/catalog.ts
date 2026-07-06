// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { NpmAppAgentInfo } from "dispatcher-node-providers";

// Catalog data model. A catalog is a JSON file listing the
// available agents: name -> NpmAppAgentInfo. A catalog source resolves an agent
// short name to a record on explicit `@package install`; nothing in a catalog is
// installed automatically. Catalogs are referenced by filesystem path (the
// shipped/bundled agents are no longer modeled as a catalog source - they are a
// separate static provider).

export type AgentCatalog = {
    description?: string;
    agents: Record<string, NpmAppAgentInfo>;
};

// Read + parse a catalog file, wrapping read/parse failures with the file path
// so callers get an actionable message instead of a bare JSON/ENOENT error.
function readCatalogFile(file: string): AgentCatalog {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (e: any) {
        throw new Error(`Could not read catalog '${file}': ${e?.message ?? e}`);
    }
    try {
        return JSON.parse(text) as AgentCatalog;
    } catch (e: any) {
        throw new Error(
            `Catalog '${file}' is not valid JSON: ${e?.message ?? e}`,
        );
    }
}

// Resolve a catalog ref (a local filesystem path) to its parsed catalog JSON.
// Remote URLs are not supported.
export function loadCatalog(catalogRef: string): AgentCatalog {
    return readCatalogFile(catalogRef);
}
