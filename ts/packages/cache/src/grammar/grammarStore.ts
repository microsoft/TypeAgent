// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar, matchGrammar } from "action-grammar";
import { MatchOptions } from "../constructions/constructionCache.js";
import { MatchResult, GrammarStore } from "../cache/types.js";

export class GrammarStoreImpl implements GrammarStore {
    private readonly grammars: Map<string, any> = new Map();
    public addGrammar(namespace: string, grammar: Grammar): void {
        this.grammars.set(namespace, grammar);
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
