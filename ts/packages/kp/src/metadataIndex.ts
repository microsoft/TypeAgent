// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IMetadataIndex } from "./types.js";

/**
 * Generic metadata index: (column, value) → set of chunk IDs.
 * Column names are application-defined (e.g. "sender", "speaker", "location").
 * Values are stored lowercase for case-insensitive matching.
 */
export class MetadataIndex implements IMetadataIndex {
    // column → (value → Set<chunkId>)
    private index: Map<string, Map<string, Set<number>>> = new Map();

    addEntry(column: string, value: string, chunkId: number): void {
        const lower = value.toLowerCase();
        let colMap = this.index.get(column);
        if (!colMap) {
            colMap = new Map();
            this.index.set(column, colMap);
        }
        let chunks = colMap.get(lower);
        if (!chunks) {
            chunks = new Set();
            colMap.set(lower, chunks);
        }
        chunks.add(chunkId);
    }

    lookup(column: string, value: string): Set<number> | undefined {
        return this.index.get(column)?.get(value.toLowerCase());
    }

    lookupContains(column: string, substring: string): Set<number> {
        const result = new Set<number>();
        const sub = substring.toLowerCase();
        const colMap = this.index.get(column);
        if (!colMap) return result;

        for (const [value, chunks] of colMap) {
            if (value.includes(sub)) {
                for (const id of chunks) result.add(id);
            }
        }
        return result;
    }

    /**
     * Lookup by domain: matches values ending with @domain or containing the domain.
     * Useful for email addresses: lookupDomain("sender", "amazon.com")
     */
    lookupDomain(column: string, domain: string): Set<number> {
        const result = new Set<number>();
        const d = domain.toLowerCase();
        const colMap = this.index.get(column);
        if (!colMap) return result;

        for (const [value, chunks] of colMap) {
            if (value.endsWith(d) || value.includes(`@${d}`)) {
                for (const id of chunks) result.add(id);
            }
        }
        return result;
    }

    getColumns(): string[] {
        return Array.from(this.index.keys());
    }

    getValues(column: string): string[] {
        const colMap = this.index.get(column);
        if (!colMap) return [];
        return Array.from(colMap.keys());
    }
}
