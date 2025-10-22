// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Grammar, matchGrammar } from "action-grammar";
import { MatchOptions } from "../constructions/constructionCache.js";
import { MatchResult, GrammarStore } from "./types.js";
import { getSchemaNamespaceKey, splitSchemaNamespaceKey } from "./cache.js";
import { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";
import {
    createExecutableAction,
    RequestAction,
} from "../explanation/requestAction.js";
import { sortMatches } from "./sortMatches.js";

export class GrammarStoreImpl implements GrammarStore {
    private readonly grammars: Map<string, any> = new Map();
    private enabled: boolean = true;
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
    public isEnabled(): boolean {
        return this.enabled;
    }
    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
    public match(request: string, options?: MatchOptions): MatchResult[] {
        if (!this.enabled) {
            throw new Error("GrammarStore is disabled");
        }
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
            const grammarMatches = matchGrammar(grammar, request);
            if (grammarMatches.length === 0) {
                continue;
            }
            const { schemaName } = splitSchemaNamespaceKey(name);
            for (const m of grammarMatches) {
                const action: any = m.match;
                matches.push({
                    type: "grammar",
                    match: new RequestAction(request, [
                        createExecutableAction(
                            schemaName,
                            action.actionName,
                            action.parameters,
                        ),
                    ]),
                    wildcardCharCount: m.wildcardCharCount,
                    implicitParameterCount: 0,
                    nonOptionalCount: 0,
                    matchedCount: m.matchedValueCount,
                    entityWildcardPropertyNames: m.entityWildcardPropertyNames,
                });
            }
        }
        return sortMatches(matches);
    }

    public completion(
        requestPrefix: string | undefined,
        options?: MatchOptions,
    ) {
        return undefined;
    }
}
