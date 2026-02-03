// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA } from "../src/nfaMatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("List Grammar Smoke Tests", () => {
    const listGrammarPath = path.resolve(
        __dirname,
        "../../../agents/list/src/listSchema.agr",
    );

    let grammar: NonNullable<ReturnType<typeof loadGrammarRules>>;
    let nfa: ReturnType<typeof compileGrammarToNFA>;

    beforeAll(() => {
        if (!fs.existsSync(listGrammarPath)) {
            throw new Error(`List grammar not found at ${listGrammarPath}`);
        }
        const content = fs.readFileSync(listGrammarPath, "utf-8");
        const loadedGrammar = loadGrammarRules(listGrammarPath, content);
        if (!loadedGrammar) {
            throw new Error(
                `Failed to compile grammar from ${listGrammarPath}`,
            );
        }
        grammar = loadedGrammar;
        nfa = compileGrammarToNFA(grammar);
    });

    // These are the exact test cases from the smoke test
    const testCases = [
        {
            request: "create a shopping list",
            expectedAction: "createList",
            expectedListName: "shopping",
        },
        {
            request: "what's on the shopping list?",
            expectedAction: "getList",
            expectedListName: "shopping",
        },
        {
            request: "add bread, milk, flour to the shopping list",
            expectedAction: "addItems",
            expectedListName: "shopping",
        },
        {
            request: "remove milk from the shopping list",
            expectedAction: "removeItems",
            expectedListName: "shopping",
        },
        {
            request: "clear the shopping list",
            expectedAction: "clearList",
            expectedListName: "shopping",
        },
    ];

    test.each(testCases)(
        'should match "$request" as $expectedAction',
        ({ request, expectedAction, expectedListName }) => {
            const results = matchGrammarWithNFA(grammar, nfa, request);

            expect(results.length).toBeGreaterThan(0);

            const match = results[0].match as {
                actionName: string;
                parameters?: { listName?: string; items?: string[] };
            };

            expect(match.actionName).toBe(expectedAction);
            expect(match.parameters?.listName).toBe(expectedListName);
        },
    );

    // Additional edge cases that caused previous failures
    describe("Edge cases", () => {
        test('should NOT match "add X to the Y list" as getList', () => {
            const results = matchGrammarWithNFA(
                grammar,
                nfa,
                "add bread to the shopping list",
            );

            expect(results.length).toBeGreaterThan(0);
            const match = results[0].match as { actionName: string };
            // Should be addItems, NOT getList
            expect(match.actionName).toBe("addItems");
            expect(match.actionName).not.toBe("getList");
        });

        test('should match "what\'s on the shopping list" correctly', () => {
            const results = matchGrammarWithNFA(
                grammar,
                nfa,
                "what's on the shopping list",
            );

            expect(results.length).toBeGreaterThan(0);
            const match = results[0].match as {
                actionName: string;
                parameters?: { listName?: string };
            };
            expect(match.actionName).toBe("getList");
            expect(match.parameters?.listName).toBe("shopping");
        });
    });
});
