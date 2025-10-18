// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compileGrammar } from "./grammarCompiler.js";
import { parseGrammarRules } from "./grammarRuleParser.js";
import { Grammar } from "./grammarTypes.js";

export function loadGrammarRules(fileName: string, content: string): Grammar {
    const definitions = parseGrammarRules(fileName, content);
    const grammar = compileGrammar(definitions);
    return grammar;
}
