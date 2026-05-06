// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    LoadedGrammar,
    SymbolIndex,
    SymbolInfo,
    SourceLocation,
    RuleId,
} from "./types.js";
import { MissingDebugInfoError } from "./types.js";

/**
 * Build a symbol index for a loaded grammar.
 * Requires debugInfo (throws MissingDebugInfoError otherwise).
 */
export function getSymbolIndex(g: LoadedGrammar): SymbolIndex {
    if (!g.debugInfo) {
        throw new MissingDebugInfoError(g.source);
    }

    const symbols: SymbolInfo[] = [];
    const byId = new Map<RuleId, SymbolInfo>();

    for (const [id, location] of g.debugInfo.rules) {
        const info: SymbolInfo = { id, location, kind: "rule" };
        symbols.push(info);
        byId.set(id, info);
    }

    // TODO: Build a reference index from the AST (requires source files).
    // For now, references() returns empty.
    const references = (_ruleId: RuleId): readonly SourceLocation[] => [];

    return { symbols, byId, references };
}
