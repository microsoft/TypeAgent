// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { compileGrammar, Grammar } from "./grammarCompiler.js";
import { parseGrammar } from "./grammarParser.js";

export function loadGrammar(fileName: string, content: string): Grammar {
    const definitions = parseGrammar(fileName, content);
    const grammar = compileGrammar(definitions);
    return grammar;
}
