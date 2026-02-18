// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    Grammar,
    matchGrammar,
    matchGrammarCompletion,
    NFA,
    compileGrammarToNFA,
    matchGrammarWithNFA,
    computeNFACompletions,
} from "action-grammar";

const debug = registerDebug("typeagent:cache:grammarStore");
import {
    CompletionProperty,
    CompletionResult,
    MatchOptions,
} from "../constructions/constructionCache.js";
import { MatchResult, GrammarStore } from "./types.js";
import { getSchemaNamespaceKey, splitSchemaNamespaceKey } from "./cache.js";
import { SchemaInfoProvider } from "../explanation/schemaInfoProvider.js";
import {
    createExecutableAction,
    RequestAction,
} from "../explanation/requestAction.js";
import { sortMatches } from "./sortMatches.js";

interface GrammarEntry {
    grammar: Grammar;
    nfa?: NFA;
}

export class GrammarStoreImpl implements GrammarStore {
    private readonly grammars: Map<string, GrammarEntry> = new Map();
    private enabled: boolean = true;
    private useNFA: boolean = false;

    public constructor(
        private readonly schemaInfoProvider: SchemaInfoProvider | undefined,
    ) {}

    /**
     * Enable or disable NFA matching
     * When enabling NFA for the first time, compiles existing grammars to NFA
     */
    public setUseNFA(useNFA: boolean): void {
        if (useNFA && !this.useNFA) {
            // Switching to NFA - compile existing grammars
            for (const [key, entry] of this.grammars) {
                if (!entry.nfa) {
                    try {
                        const schemaName =
                            splitSchemaNamespaceKey(key).schemaName;
                        entry.nfa = compileGrammarToNFA(
                            entry.grammar,
                            schemaName,
                        );
                    } catch (error) {
                        console.error(
                            `Failed to compile grammar to NFA for ${key}:`,
                            error,
                        );
                    }
                }
            }
        }
        this.useNFA = useNFA;
    }
    public addGrammar(schemaName: string, grammar: Grammar): void {
        const namespaceKey = getSchemaNamespaceKey(
            schemaName,
            undefined,
            this.schemaInfoProvider,
        );
        const entry: GrammarEntry = { grammar };
        if (this.useNFA) {
            try {
                entry.nfa = compileGrammarToNFA(grammar, schemaName);
            } catch (error) {
                console.error(
                    `Failed to compile grammar to NFA for ${schemaName}:`,
                    error,
                );
                // Fall back to old matcher if compilation fails
            }
        }
        this.grammars.set(namespaceKey, entry);
    }
    public removeGrammar(schemaName: string): void {
        try {
            const namespaceKey = getSchemaNamespaceKey(
                schemaName,
                undefined,
                this.schemaInfoProvider,
            );
            this.grammars.delete(namespaceKey);
        } catch (error) {
            console.warn(
                `Schema ${schemaName} not found, attempting pattern cleanup:`,
                error,
            );

            for (const key of Array.from(this.grammars.keys())) {
                if (key.startsWith(`${schemaName}.`)) {
                    this.grammars.delete(key);
                    console.debug(`Removed grammar cache entry: ${key}`);
                }
            }
        }
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
        for (const [name, entry] of this.grammars) {
            if (filter && !filter.has(name)) {
                continue;
            }

            const { schemaName } = splitSchemaNamespaceKey(name);
            debug(
                `Matching "${request}" against ${schemaName} (${this.useNFA ? "NFA" : "legacy"}) - NFA states: ${entry.nfa?.states.length || 0}, rules: ${entry.grammar.rules.length}`,
            );

            // Use NFA matcher if available, otherwise fall back to old matcher
            const grammarMatches =
                this.useNFA && entry.nfa
                    ? matchGrammarWithNFA(entry.grammar, entry.nfa, request)
                    : matchGrammar(entry.grammar, request);

            if (grammarMatches.length === 0) {
                debug(`No matches in ${schemaName} grammar`);
                continue;
            }

            debug(
                `HIT: "${request}" matched in ${schemaName} - ${grammarMatches.length} match(es)`,
            );

            for (const m of grammarMatches) {
                const action: any = m.match;
                debug(
                    `Action: ${schemaName}.${action.actionName}, params: %O`,
                    action.parameters,
                );
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

        debug(
            matches.length === 0 ? `MISS: "${request}"` : `HIT: "${request}"`,
        );

        return sortMatches(matches);
    }

    public completion(
        requestPrefix: string | undefined,
        options?: MatchOptions,
    ): CompletionResult | undefined {
        if (!this.enabled) {
            return undefined;
        }
        const namespaceKeys = options?.namespaceKeys;
        if (namespaceKeys?.length === 0) {
            return undefined;
        }
        const completions: string[] = [];
        const properties: CompletionProperty[] = [];
        const filter = new Set(namespaceKeys);
        for (const [name, entry] of this.grammars) {
            if (filter && !filter.has(name)) {
                continue;
            }
            if (this.useNFA && entry.nfa) {
                // NFA-based completions: tokenize into complete whole tokens
                const tokens = requestPrefix
                    ? requestPrefix
                          .trim()
                          .split(/\s+/)
                          .filter((t) => t.length > 0)
                    : [];
                const nfaResult = computeNFACompletions(entry.nfa, tokens);
                if (nfaResult.completions.length > 0) {
                    completions.push(...nfaResult.completions);
                }
                if (
                    nfaResult.properties !== undefined &&
                    nfaResult.properties.length > 0
                ) {
                    // NFA schema name is stored in nfa.name, fall back to namespace key
                    const schemaName =
                        entry.nfa.name ??
                        splitSchemaNamespaceKey(name).schemaName;
                    for (const p of nfaResult.properties) {
                        const action: any = p.match;
                        properties.push({
                            actions: [
                                createExecutableAction(
                                    schemaName,
                                    action.actionName,
                                    action.parameters,
                                ),
                            ],
                            names: p.propertyNames,
                        });
                    }
                }
            } else {
                // Legacy grammar-based completions
                const partial = matchGrammarCompletion(
                    entry.grammar,
                    requestPrefix ?? "",
                );
                if (partial.completions.length > 0) {
                    completions.push(...partial.completions);
                }
                if (
                    partial.properties !== undefined &&
                    partial.properties.length > 0
                ) {
                    const { schemaName } = splitSchemaNamespaceKey(name);
                    for (const p of partial.properties) {
                        const action: any = p.match;
                        properties.push({
                            actions: [
                                createExecutableAction(
                                    schemaName,
                                    action.actionName,
                                    action.parameters,
                                ),
                            ],
                            names: p.propertyNames,
                        });
                    }
                }
            }
        }

        return {
            completions,
            properties,
        };
    }
}
