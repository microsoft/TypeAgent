// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { grammarFromJson } from "../src/grammarDeserializer.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";
import { grammarToJson } from "../src/grammarSerializer.js";
import { Grammar } from "../src/grammarTypes.js";

function testMatchGrammar(grammar: Grammar, request: string) {
    return matchGrammar(grammar, request)?.map((m) => m.match);
}

describe("Grammar Serialization", () => {
    it("Round trip", () => {
        const grammarText = `
            <Start> = hello <nested> $(x:number) <nested> -> { greeting: x, x };
            <nested> = one | two | three | $(y:string) | maybe <nested>;
        `;
        const grammar = loadGrammarRules("test", grammarText);
        const serialized = grammarToJson(grammar);
        const deserialized = grammarFromJson(serialized);
        expect(deserialized).toEqual(grammar);
        const serialized2 = grammarToJson(deserialized);
        expect(serialized2).toEqual(serialized);
    });

    describe("spacingMode preservation", () => {
        it("preserves optional mode through grammarToJson/grammarFromJson", () => {
            const g = `<Start> [spacing=optional] = hello world -> true;`;
            const reloaded = grammarFromJson(
                grammarToJson(loadGrammarRules("test.grammar", g)),
            );
            expect(testMatchGrammar(reloaded, "helloworld")).toStrictEqual([
                true,
            ]);
            expect(testMatchGrammar(reloaded, "hello world")).toStrictEqual([
                true,
            ]);
        });

        it("preserves required mode through grammarToJson/grammarFromJson", () => {
            const g = `<Start> [spacing=required] = hello world -> true;`;
            const reloaded = grammarFromJson(
                grammarToJson(loadGrammarRules("test.grammar", g)),
            );
            expect(testMatchGrammar(reloaded, "hello world")).toStrictEqual([
                true,
            ]);
            expect(testMatchGrammar(reloaded, "helloworld")).toStrictEqual([]);
        });

        it("preserves auto mode through grammarToJson/grammarFromJson", () => {
            const g = `<Start> [spacing=auto] = hello world -> true;`;
            const reloaded = grammarFromJson(
                grammarToJson(loadGrammarRules("test.grammar", g)),
            );
            expect(testMatchGrammar(reloaded, "hello world")).toStrictEqual([
                true,
            ]);
            expect(testMatchGrammar(reloaded, "helloworld")).toStrictEqual([]);
        });
    });
});
