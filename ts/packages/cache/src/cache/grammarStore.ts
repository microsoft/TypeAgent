// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import {
    Grammar,
    matchGrammar,
    matchGrammarCompletion,
    GrammarCompletionResult,
    NFA,
    compileGrammarToNFA,
    matchGrammarWithNFA,
    computeNFACompletions,
    DFA,
    compileNFAToDFA,
    matchDFAWithSplitting,
    getDFACompletions,
    tokenizeRequest,
} from "action-grammar";

const debug = registerDebug("typeagent:cache:grammarStore");
import {
    CompletionDirection,
    SeparatorMode,
    AfterWildcard,
} from "@typeagent/agent-sdk";
import { mergeSeparatorMode } from "@typeagent/agent-sdk/helpers/command";
import {
    CompletionProperty,
    CompletionResult,
    MatchOptions,
    mergeAfterWildcard,
    shouldPreferNewResult,
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
    dfa?: DFA;
}

export class GrammarStoreImpl implements GrammarStore {
    private readonly grammars: Map<string, GrammarEntry> = new Map();
    private enabled: boolean = true;
    private useNFA: boolean = false;
    private useDFA: boolean = false;

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
    /**
     * Enable or disable DFA matching.
     * DFA requires NFA to be enabled first.
     * When enabling DFA for the first time, compiles existing NFAs to DFAs.
     */
    public setUseDFA(useDFA: boolean): void {
        if (useDFA && !this.useDFA) {
            // Ensure NFA is compiled first
            if (!this.useNFA) {
                this.setUseNFA(true);
            }
            // Compile existing NFAs to DFAs
            for (const [key, entry] of this.grammars) {
                if (entry.nfa && !entry.dfa) {
                    try {
                        const schemaName =
                            splitSchemaNamespaceKey(key).schemaName;
                        entry.dfa = compileNFAToDFA(entry.nfa, schemaName);
                    } catch (error) {
                        console.error(
                            `Failed to compile NFA to DFA for ${key}:`,
                            error,
                        );
                    }
                }
            }
        }
        this.useDFA = useDFA;
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
                // NFA compilation failed; fall back to simple grammar matcher
            }
        }
        if (this.useDFA && entry.nfa) {
            try {
                entry.dfa = compileNFAToDFA(entry.nfa, schemaName);
            } catch (error) {
                console.error(
                    `Failed to compile NFA to DFA for ${schemaName}:`,
                    error,
                );
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
            const matchMode =
                this.useDFA && entry.dfa
                    ? "DFA"
                    : this.useNFA && entry.nfa
                      ? "NFA"
                      : "simple";
            debug(
                `Matching "${request}" against ${schemaName} (${matchMode}) - NFA states: ${entry.nfa?.states.length || 0}, DFA states: ${entry.dfa?.states.length || 0}, rules: ${entry.grammar.rules.length}`,
            );

            // Choose matcher: DFA > NFA > simple
            let grammarMatches;
            if (this.useDFA && entry.dfa) {
                const tokens = tokenizeRequest(request);
                const dfaResult = matchDFAWithSplitting(entry.dfa, tokens);
                grammarMatches = dfaResult.matched
                    ? [
                          {
                              match: dfaResult.actionValue ?? request,
                              matchedValueCount:
                                  dfaResult.fixedStringPartCount +
                                  dfaResult.checkedWildcardCount +
                                  dfaResult.uncheckedWildcardCount,
                              wildcardCharCount:
                                  dfaResult.uncheckedWildcardCount,
                              entityWildcardPropertyNames: [],
                          },
                      ]
                    : [];
            } else if (this.useNFA && entry.nfa) {
                grammarMatches = matchGrammarWithNFA(
                    entry.grammar,
                    entry.nfa,
                    request,
                );
            } else {
                grammarMatches = matchGrammar(entry.grammar, request);
            }

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

    // Architecture: docs/architecture/completion.md — §2 Cache Layer
    public completion(
        input: string,
        options?: MatchOptions,
        direction?: CompletionDirection, // defaults to forward-like behavior when omitted
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
        let matchedPrefixLength = 0;
        let separatorMode: SeparatorMode | undefined;
        let closedSet: boolean | undefined;
        let directionSensitive: boolean = false;
        let afterWildcard: AfterWildcard | undefined;
        const filter = new Set(namespaceKeys);

        // Track per-grammar results at the current matchedPrefixLength
        // so we can detect cross-grammar separator mode conflicts after
        // the loop.  Each entry records the grammar's result and schema
        // name for property conversion.
        type GrammarPartial = {
            partial: GrammarCompletionResult;
            schemaName: string;
        };
        let grammarPartials: GrammarPartial[] = [];

        for (const [name, entry] of this.grammars) {
            if (filter && !filter.has(name)) {
                continue;
            }
            if (this.useDFA && entry.dfa) {
                // DFA-based completions
                const tokens = input
                    .trim()
                    .split(/\s+/)
                    .filter((t) => t.length > 0);

                const dfaCompResult = getDFACompletions(entry.dfa, tokens);
                if (
                    dfaCompResult.completions &&
                    dfaCompResult.completions.length > 0
                ) {
                    completions.push(...dfaCompResult.completions);
                }
                if (
                    dfaCompResult.properties &&
                    dfaCompResult.properties.length > 0
                ) {
                    const { schemaName } = splitSchemaNamespaceKey(name);
                    for (const p of dfaCompResult.properties) {
                        properties.push({
                            actions: [
                                createExecutableAction(
                                    schemaName,
                                    p.actionName,
                                    {},
                                ),
                            ],
                            names: [p.propertyPath],
                        });
                    }
                }
            } else if (this.useNFA && entry.nfa) {
                // NFA-based completions: tokenize into complete whole tokens
                const tokens = input
                    .trim()
                    .split(/\s+/)
                    .filter((t) => t.length > 0);

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
                // simple grammar-based completions
                const partial = matchGrammarCompletion(
                    entry.grammar,
                    input,
                    matchedPrefixLength,
                    direction,
                );
                const partialPrefixLength = partial.matchedPrefixLength ?? 0;
                if (partialPrefixLength !== matchedPrefixLength) {
                    const adopt = shouldPreferNewResult(
                        matchedPrefixLength,
                        afterWildcard,
                        partialPrefixLength,
                        partial.afterWildcard,
                        input.length,
                    );

                    if (!adopt) continue;

                    matchedPrefixLength = partialPrefixLength;
                    completions.length = 0;
                    properties.length = 0;
                    separatorMode = undefined;
                    closedSet = undefined;
                    directionSensitive = false;
                    afterWildcard = undefined;
                    grammarPartials = [];
                }
                if (partialPrefixLength === matchedPrefixLength) {
                    const { schemaName } = splitSchemaNamespaceKey(name);
                    grammarPartials.push({ partial, schemaName });
                }
            }
        }

        // Post-loop merge of grammar-based results with cross-grammar
        // separator mode conflict detection.
        //
        // Each individual grammar's result is already internally
        // consistent (Phase 1 within-grammar conflict filtering).
        // Here we detect when different grammars produce incompatible
        // separator modes and filter by trailing separator state.
        if (grammarPartials.length > 0) {
            let hasRequiring = false;
            let hasNoneMode = false;
            for (const { partial } of grammarPartials) {
                if (partial.separatorMode !== undefined) {
                    if (
                        partial.separatorMode === "space" ||
                        partial.separatorMode === "spacePunctuation"
                    ) {
                        hasRequiring = true;
                    }
                    if (partial.separatorMode === "none") {
                        hasNoneMode = true;
                    }
                }
            }

            const hasCrossGrammarConflict = hasRequiring && hasNoneMode;
            const hasTrailingSep =
                hasCrossGrammarConflict &&
                matchedPrefixLength < input.length &&
                /[\s\p{P}]/u.test(input[matchedPrefixLength]);

            let effectivePartials = grammarPartials;
            let droppedGrammars = false;
            if (hasCrossGrammarConflict) {
                effectivePartials = grammarPartials.filter(({ partial }) => {
                    if (partial.separatorMode === undefined) return true;
                    if (hasTrailingSep) {
                        // Trailing separator: drop "none" mode grammars.
                        if (partial.separatorMode === "none") {
                            droppedGrammars = true;
                            return false;
                        }
                        return true;
                    } else {
                        // No trailing separator: drop requiring modes.
                        if (
                            partial.separatorMode === "space" ||
                            partial.separatorMode === "spacePunctuation"
                        ) {
                            droppedGrammars = true;
                            return false;
                        }
                        return true;
                    }
                });
            }

            // Merge surviving grammar partials.
            for (const { partial, schemaName } of effectivePartials) {
                completions.push(...partial.completions);
                if (partial.separatorMode !== undefined) {
                    separatorMode = mergeSeparatorMode(
                        separatorMode,
                        partial.separatorMode,
                    );
                }
                // AND-merge: closed set only when all grammar
                // results at this prefix length are closed sets.
                if (partial.closedSet !== undefined) {
                    closedSet =
                        closedSet === undefined
                            ? partial.closedSet
                            : closedSet && partial.closedSet;
                }
                // True if any grammar result at this prefix
                // length is direction-sensitive.
                directionSensitive =
                    directionSensitive || partial.directionSensitive;
                // Tri-state merge for afterWildcard.
                afterWildcard = mergeAfterWildcard(
                    afterWildcard,
                    partial.afterWildcard,
                );
                if (
                    partial.properties !== undefined &&
                    partial.properties.length > 0
                ) {
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

            // When grammars were dropped due to separator conflict,
            // advance P past trailing separator and adjust metadata
            // so the shell re-fetches when separator state changes.
            if (droppedGrammars) {
                closedSet = closedSet === undefined ? false : false;
                if (hasTrailingSep) {
                    // Advance past trailing separators.
                    const sepMatch = input
                        .slice(matchedPrefixLength)
                        .match(/^[\s\p{P}]+/u);
                    if (sepMatch) {
                        matchedPrefixLength += sepMatch[0].length;
                    }
                    separatorMode = "optional";
                }
                // Force afterWildcard "all" → "some" so shell
                // doesn't use "slide" noMatchPolicy.
                if (afterWildcard === "all") {
                    afterWildcard = "some";
                }
            }
        }

        return {
            completions,
            properties,
            matchedPrefixLength,
            separatorMode,
            closedSet,
            directionSensitive,
            afterWildcard,
        };
    }
}
