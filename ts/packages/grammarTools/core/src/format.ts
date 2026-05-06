// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammarRules, writeGrammarRules } from "action-grammar";

/**
 * Format a raw `.agr` source string. Returns the formatted text.
 * If the input cannot be parsed, returns it unchanged.
 */
export function format(source: string): string {
    try {
        const parsed = parseGrammarRules("format-input", source);
        return writeGrammarRules(parsed);
    } catch {
        return source;
    }
}
