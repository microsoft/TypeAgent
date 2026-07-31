// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CatalogEntry } from "../core/types.js";

const require = createRequire(import.meta.url);
const catalogPath = require.resolve("./catalog.generated.json");
const catalogBytes = readFileSync(catalogPath);

interface GeneratedCatalog {
    catalogVersion: string;
    activeSchemas: string[];
    allRegistrySchemas?: string[];
    actions: CatalogEntry[];
}

const generated = JSON.parse(catalogBytes.toString("utf8")) as GeneratedCatalog;

/** Date/label stamped into catalog.generated.json when regenerated. */
export const CATALOG_VERSION: string = generated.catalogVersion;

/** sha256 of catalog.generated.json bytes (exact file on disk). */
export const CATALOG_SHA256: string = createHash("sha256")
    .update(catalogBytes)
    .digest("hex");

export const ACTIVE_SCHEMAS: string[] = generated.activeSchemas;
export const CATALOG: CatalogEntry[] = generated.actions;

export const CATALOG_KEYS: ReadonlySet<string> = new Set(
    CATALOG.map((c) => `${c.schemaName}.${c.actionName}`),
);
