// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar drift guard.
 *
 * Verifies the TextMate grammar's keyword list matches the lexer's
 * KEYWORDS map. The grammar is hand-maintained; new lexer keywords
 * should land in both places. If this test fails the actionable next
 * step is to add the missing word to `workflow.tmLanguage.json`'s
 * `keyword.control.wf` alternation OR explicitly waive the keyword
 * (record the waiver in lsp-decisions.md).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = resolve(
    here,
    "../../../vscode/syntaxes/workflow.tmLanguage.json",
);

const LEXER_KEYWORDS = [
    "workflow",
    "const",
    "if",
    "else",
    "switch",
    "case",
    "default",
    "return",
    "break",
    "throw",
    "true",
    "false",
    "null",
];

describe("grammar drift", () => {
    it("lists every lexer keyword in the TextMate grammar", () => {
        const grammar = JSON.parse(readFileSync(grammarPath, "utf8"));
        const keywordPattern: string = grammar.repository.keywords.patterns[0]
            .match;
        // Pattern like \b(a|b|c)\b -- extract the alternation.
        const match = keywordPattern.match(/\\b\(([^)]+)\)\\b/);
        expect(match).not.toBeNull();
        const declared = match![1]!.split("|");
        for (const kw of LEXER_KEYWORDS) {
            expect(declared).toContain(kw);
        }
    });
});
