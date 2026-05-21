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

        // Collect all words declared across every pattern in the keywords and
        // constants repositories (the grammar splits keywords by semantic role).
        const allDeclared = new Set<string>();
        const repos = [
            grammar.repository.keywords,
            grammar.repository.constants,
        ];
        for (const repo of repos) {
            if (!repo) continue;
            for (const p of repo.patterns ?? []) {
                const pattern = p.match as string | undefined;
                if (!pattern) continue;
                // Alternation form: \b(a|b|c)\b
                const altMatch = pattern.match(/\\b\(([^)]+)\)\\b/);
                if (altMatch) {
                    for (const kw of altMatch[1]!.split("|"))
                        allDeclared.add(kw);
                    continue;
                }
                // Single-word form: \bword\b
                const singleMatch = pattern.match(/^\\b(\w+)\\b$/);
                if (singleMatch) {
                    allDeclared.add(singleMatch[1]!);
                }
            }
        }

        for (const kw of LEXER_KEYWORDS) {
            expect(allDeclared).toContain(kw);
        }
    });
});
