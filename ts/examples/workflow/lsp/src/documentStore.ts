// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Per-URI document cache.
 *
 * Phase 0 placeholder: the production implementation will lex/parse on
 * change and retain the last good AST per URI. For now this is just
 * the shape that future features will consume.
 */

export interface DocumentEntry {
    uri: string;
    version: number;
    text: string;
}

export class DocumentStore {
    private readonly entries = new Map<string, DocumentEntry>();

    set(entry: DocumentEntry): void {
        this.entries.set(entry.uri, entry);
    }

    get(uri: string): DocumentEntry | undefined {
        return this.entries.get(uri);
    }

    delete(uri: string): void {
        this.entries.delete(uri);
    }

    clear(): void {
        this.entries.clear();
    }
}
