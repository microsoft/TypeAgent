// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    LoadResult,
    LoadedGrammar,
    CompletionPreview,
    MatchTrace,
    CoverageReport,
    GrammarDiff,
    GrammarSnapshot,
} from "grammar-tools-core";

/**
 * Service interface mirroring grammar-tools-core 1:1. Hosts inject an
 * implementation: in-process, over HTTP, or via WebView messaging.
 * See ADR 0005 (shared service contract).
 */
export interface GrammarBackend {
    loadGrammarFromFile(path: string): Promise<LoadResult>;
    loadGrammarFromBuffer(id: string, text: string): Promise<LoadResult>;
    loadGrammarFromAgent(agentName: string): Promise<LoadResult>;
    loadGrammarFromSnapshot(snapshot: GrammarSnapshot): Promise<LoadResult>;

    previewCompletion(
        grammar: LoadedGrammar,
        input: string,
    ): Promise<CompletionPreview>;

    traceMatch(grammar: LoadedGrammar, input: string): Promise<MatchTrace>;

    computeCoverage(
        grammar: LoadedGrammar,
        inputs: readonly string[],
    ): Promise<CoverageReport>;

    diffGrammars(
        before: LoadedGrammar,
        after: LoadedGrammar,
    ): Promise<GrammarDiff>;

    format(grammar: LoadedGrammar): Promise<string>;

    /** Available agent names for the grammar-picker dropdown. */
    listAgents?(): Promise<string[]>;
}
