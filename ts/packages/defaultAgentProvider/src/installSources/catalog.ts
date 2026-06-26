// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import { NpmAppAgentInfo } from "dispatcher-node-providers";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

// Catalog data model (design §3). A catalog is a JSON file listing the
// available agents: name -> NpmAppAgentInfo plus an optional `preinstall` flag.
// The bundled catalog (`"<bundled>"`) is the one that ships in the app.

export type CatalogAgentInfo = NpmAppAgentInfo & {
    // Pre-installed at first run when set (design §7, §12 Q1). In practice only
    // the bundled catalog sets this.
    preinstall?: boolean;
};

export type AgentCatalog = {
    description?: string;
    agents: Record<string, CatalogAgentInfo>;
};

// Sentinel for the catalog that ships in the app bundle (design §3, §12 Q19).
export const BUNDLED_CATALOG = "<bundled>";

export function getBundledCatalogPath(): string {
    return getPackageFilePath("./data/agents.catalog.json");
}

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

let bundledCatalog: AgentCatalog | undefined;
export function loadBundledCatalog(): AgentCatalog {
    if (bundledCatalog === undefined) {
        bundledCatalog = readCatalogFile(getBundledCatalogPath());
    }
    return bundledCatalog;
}

// Resolve a catalog ref ("<bundled>" or a local filesystem path) to its parsed
// catalog JSON. Remote URLs are not supported (design §12 Q19).
export function loadCatalog(catalogRef: string): AgentCatalog {
    if (catalogRef === BUNDLED_CATALOG) {
        return loadBundledCatalog();
    }
    return readCatalogFile(catalogRef);
}
