// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammarRules, writeGrammarRules } from "action-grammar";

/**
 * Format a raw `.agr` source string. Returns the formatted text.
 * If the input cannot be parsed, returns it unchanged.
 */
export function format(source: string): string {
    let parsed;
    try {
        parsed = parseGrammarRules("format-input", source);
    } catch {
        // Parse failure: return input unchanged
        return source;
    }
    // writeGrammarRules errors are formatter bugs; let them propagate
    return writeGrammarRules(parsed);
}
