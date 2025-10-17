// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar, matchGrammar } from "action-grammar";
import { MatchOptions } from "../constructions/constructionCache.js";
import { MatchResult, GrammarStore } from "../cache/types.js";
import { getSchemaNamespaceKey } from "../cache/cache.js";
import { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";

export class GrammarStoreImpl implements GrammarStore {
    private readonly grammars: Map<string, any> = new Map();
    public constructor(
        private readonly schemaInfoProvider: SchemaInfoProvider | undefined,
    ) {}
    public addGrammar(schemaName: string, grammar: Grammar): void {
        const namespaceKey = getSchemaNamespaceKey(
            schemaName,
            undefined,
            this.schemaInfoProvider,
        );
        this.grammars.set(namespaceKey, grammar);
    }
    public removeGrammar(schemaName: string): void {
        const namespaceKey = getSchemaNamespaceKey(
            schemaName,
            undefined,
            this.schemaInfoProvider,
        );
        this.grammars.delete(namespaceKey);
    }
    public match(request: string, options?: MatchOptions): MatchResult[] {
        const namespaceKeys = options?.namespaceKeys;
        if (namespaceKeys?.length === 0) {
            return [];
        }
        const matches: MatchResult[] = [];
        const filter = namespaceKeys ? new Set(namespaceKeys) : undefined;
        for (const [name, grammar] of this.grammars) {
            if (filter && !filter.has(name)) {
                continue;
            }
            matches.push(...matchGrammar(grammar, request));
        }
        return matches;
    }
}
