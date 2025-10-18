// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { grammarFromJson } from "../src/grammarDeserializer.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { grammarToJson } from "../src/grammarSerializer.js";

describe("Grammar Serialization", () => {
    it("Round trip", () => {
        const grammarText = `
            @<Start> = hello <nested> $(x:number) <nested> -> { greeting: $(x) }
            @<nested> = one | two | three | $(y:string) | maybe <nested>
        `;
        const grammar = loadGrammarRules("test", grammarText);
        const serialized = grammarToJson(grammar);
        const deserialized = grammarFromJson(serialized);
        expect(deserialized).toEqual(grammar);
        const serialized2 = grammarToJson(deserialized);
        expect(serialized2).toEqual(serialized);
    });
});
