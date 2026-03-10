// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { testMatchGrammar } from "./testUtils.js";

describe("Grammar Matcher - Spacing None Mode", () => {
    describe("spacing=none annotation", () => {
        const g = `<Start> [spacing=none] = hello world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches without space (tokens must be adjacent)", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                true,
            ]);
        });
        it("does not match with space (flex-space must be zero-width)", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([]);
        });
    });

    describe("spacing=none with escaped space in literal", () => {
        // An escaped space is a literal character, part of the segment text.
        // It must be matched exactly and must not be confused with a
        // flex-space position.
        const g = `<Start> [spacing=none] = hello\\ world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when the literal space is present", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                true,
            ]);
        });
        it("does not match without the literal space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
        it("does not match with extra space", () => {
            // "hello  world" has two spaces; only one is in the literal.
            expect(testMatchGrammar(grammar, "hello  world")).toStrictEqual([]);
        });
    });

    describe("spacing=none with escaped space at boundary", () => {
        // Literal trailing space must not cause the boundary check to reject
        // the match when the next character in the input is non-separator.
        const g = `<Start> [spacing=none] = hello\\  -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches input with trailing space", () => {
            expect(testMatchGrammar(grammar, "hello ")).toStrictEqual([true]);
        });
    });

    describe("spacing=none in per-rule mode switching", () => {
        const g = `
            <NoneRule> [spacing=none] = hello world -> "none";
            <OptionalRule> [spacing=optional] = hello world -> "optional";
            <Start> = $(x:<NoneRule>) -> x | $(x:<OptionalRule>) -> x;
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("both match when tokens are adjacent", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "none",
                "optional",
            ]);
        });
        it("only optional matches with space", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                "optional",
            ]);
        });
    });

    // ---- spacing=none between different part types ----

    describe("spacing=none: string → number variable", () => {
        const g = `<Start> [spacing=none] = hello $(n:number) -> n;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when number is adjacent to string", () => {
            expect(testMatchGrammar(grammar, "hello42")).toStrictEqual([42]);
        });
        it("does not match when space separates string and number", () => {
            expect(testMatchGrammar(grammar, "hello 42")).toStrictEqual([]);
        });
    });

    describe("spacing=none: number variable → string", () => {
        const g = `<Start> [spacing=none] = $(n:number) world -> n;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when string is adjacent to number", () => {
            expect(testMatchGrammar(grammar, "42world")).toStrictEqual([42]);
        });
        it("does not match when space separates number and string", () => {
            expect(testMatchGrammar(grammar, "42 world")).toStrictEqual([]);
        });
    });

    describe("spacing=none: string → wildcard → string", () => {
        const g = `<Start> [spacing=none] = hello $(x) world -> x;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when all parts are adjacent", () => {
            expect(testMatchGrammar(grammar, "hellofooworld")).toStrictEqual([
                "foo",
            ]);
        });
        it("captures separators in wildcard value", () => {
            expect(testMatchGrammar(grammar, "hello foo world")).toStrictEqual([
                " foo ",
            ]);
        });
    });

    describe("spacing=none: string → rule reference", () => {
        const g = `
            <Other> [spacing=none] = world -> "world";
            <Start> [spacing=none] = hello $(x:<Other>) -> x;
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when nested rule is adjacent", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "world",
            ]);
        });
        it("does not match when space separates string and rule", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([]);
        });
    });

    describe("spacing=none: group expressions", () => {
        const g = `<Start> [spacing=none] = (hello | hi) world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when group and following token are adjacent", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                true,
            ]);
            expect(testMatchGrammar(grammar, "hiworld")).toStrictEqual([true]);
        });
        it("does not match when space follows group", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([]);
            expect(testMatchGrammar(grammar, "hi world")).toStrictEqual([]);
        });
    });

    describe("spacing=none: escaped space mixed with flex-space", () => {
        // Grammar: "hello\ " followed by flex-space followed by "world"
        // The escaped space is a literal; the whitespace between the two
        // quoted-like segments is a flex-space that must be zero-width.
        const g = `<Start> [spacing=none] = hello\\  world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when literal space is present and no flex-space", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                true,
            ]);
        });
        it("does not match with extra space (flex-space consumed)", () => {
            expect(testMatchGrammar(grammar, "hello  world")).toStrictEqual([]);
        });
        it("does not match without literal space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
    });

    describe("spacing=none: string → number → string", () => {
        const g = `<Start> [spacing=none] = item $(n:number) done -> n;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when all parts are adjacent", () => {
            expect(testMatchGrammar(grammar, "item7done")).toStrictEqual([7]);
        });
        it("does not match with any spaces", () => {
            expect(testMatchGrammar(grammar, "item 7 done")).toStrictEqual([]);
            expect(testMatchGrammar(grammar, "item7 done")).toStrictEqual([]);
            expect(testMatchGrammar(grammar, "item 7done")).toStrictEqual([]);
        });
    });

    describe("spacing=none rejects punctuation separators", () => {
        const g = `<Start> [spacing=none] = hello world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("does not match with comma separator", () => {
            expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([]);
        });
        it("does not match with period separator", () => {
            expect(testMatchGrammar(grammar, "hello.world")).toStrictEqual([]);
        });
    });

    describe("repeat group ()+ with none mode", () => {
        const g = `<Start> [spacing=none] = hello (world)+ -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches one repetition without space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                true,
            ]);
        });
        it("matches two repetitions without space", () => {
            expect(testMatchGrammar(grammar, "helloworldworld")).toStrictEqual([
                true,
            ]);
        });
        it("does not match with space before group", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([]);
        });
        it("does not match with space between repetitions", () => {
            expect(testMatchGrammar(grammar, "helloworld world")).toStrictEqual(
                [],
            );
        });
    });

    describe("repeat group ()* with none mode", () => {
        const g = `<Start> [spacing=none] = hello (world)* -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches zero repetitions", () => {
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual([true]);
        });
        it("matches one repetition without space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                true,
            ]);
        });
        it("does not match with space before group", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([]);
        });
    });

    describe("spacing=none: optional part", () => {
        const g = `<Start> [spacing=none] = hello $(x)? world -> x;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when optional part is absent", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                undefined,
            ]);
        });
        it("matches when optional part is present and adjacent", () => {
            expect(testMatchGrammar(grammar, "hellofooworld")).toStrictEqual([
                "foo",
            ]);
        });
        it("captures separators in optional wildcard value", () => {
            expect(testMatchGrammar(grammar, "hello foo world")).toStrictEqual([
                " foo ",
            ]);
        });
    });

    describe("spacing=none: optional group expression", () => {
        const g = `<Start> [spacing=none] = (please)? help -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when optional group is present and adjacent", () => {
            expect(testMatchGrammar(grammar, "pleasehelp")).toStrictEqual([
                true,
            ]);
        });
        it("matches when optional group is absent", () => {
            expect(testMatchGrammar(grammar, "help")).toStrictEqual([true]);
        });
        it("does not match when space separates group and following token", () => {
            expect(testMatchGrammar(grammar, "please help")).toStrictEqual([]);
        });
    });

    describe("separator AFTER nested rule with none parent mode", () => {
        const g = `
            <Inner> [spacing=none] = hello world -> true;
            <Start> [spacing=none] = $(x:<Inner>) end -> x;
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when all parts are adjacent", () => {
            expect(testMatchGrammar(grammar, "helloworldend")).toStrictEqual([
                true,
            ]);
        });
        it("does not match with space after nested rule", () => {
            expect(testMatchGrammar(grammar, "helloworld end")).toStrictEqual(
                [],
            );
        });
    });

    describe("merged rules with none mode", () => {
        const g = `
            <Start> [spacing=none] = hello world -> "none";
            <Start> [spacing=required] = hello world -> "required";
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("only none matches when adjacent", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "none",
            ]);
        });
        it("only required matches with space", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                "required",
            ]);
        });
    });

    describe("spacing=none: trailing wildcard (end of rule)", () => {
        const g = `<Start> [spacing=none] = hello $(x) -> x;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("captures trailing text without trimming", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "world",
            ]);
        });
        it("captures trailing text with spaces as part of value", () => {
            // In "none" mode wildcards do not trim leading/trailing
            // separators because there are no flex-space positions to trim
            // at.  The space before "world" is part of the wildcard value.
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                " world",
            ]);
        });
        it("does not match when wildcard would be empty", () => {
            expect(testMatchGrammar(grammar, "hello")).toStrictEqual([]);
        });
    });

    describe("spacing=none: empty wildcard rejection", () => {
        const g = `<Start> [spacing=none] = hello $(x) world -> x;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("rejects when wildcard captures empty string", () => {
            // "helloworld" means the wildcard between hello and world is empty
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([]);
        });
    });

    describe("spacing=none: wildcard before number variable", () => {
        const g = `<Start> [spacing=none] = $(x) $(n:number) -> n;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches wildcard followed by number", () => {
            expect(testMatchGrammar(grammar, "abc42")).toStrictEqual([42]);
        });
        it("captures wildcard value correctly", () => {
            const gVal = `<Start> [spacing=none] = $(x) $(n:number) -> x;`;
            const grammar2 = loadGrammarRules("test.grammar", gVal);
            expect(testMatchGrammar(grammar2, "abc42")).toStrictEqual(["abc"]);
        });
    });

    describe("spacing=none: negative and special number formats", () => {
        const g = `<Start> [spacing=none] = item $(n:number) done -> n;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches negative integer", () => {
            expect(testMatchGrammar(grammar, "item-42done")).toStrictEqual([
                -42,
            ]);
        });
        it("matches hex number", () => {
            // Use suffix starting with non-hex char to avoid greedy capture
            // TODO: Review the case item0xFFdone and see if we should make that work.
            const gHex = `<Start> [spacing=none] = item $(n:number) stop -> n;`;
            const grammarHex = loadGrammarRules("test.grammar", gHex);
            expect(testMatchGrammar(grammarHex, "item0xFFstop")).toStrictEqual([
                0xff,
            ]);
        });
        it("matches octal number", () => {
            expect(testMatchGrammar(grammar, "item0o77done")).toStrictEqual([
                0o77,
            ]);
        });
        it("matches binary number", () => {
            expect(testMatchGrammar(grammar, "item0b101done")).toStrictEqual([
                0b101,
            ]);
        });
        it("matches float number", () => {
            expect(testMatchGrammar(grammar, "item3.14done")).toStrictEqual([
                3.14,
            ]);
        });
    });

    describe("spacing=none: rule-level alternatives", () => {
        const g = `<Start> [spacing=none] = hello world -> 1 | foo bar -> 2;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches first alternative when adjacent", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([1]);
        });
        it("matches second alternative when adjacent", () => {
            expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([2]);
        });
        it("does not match first alternative with space", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([]);
        });
        it("does not match second alternative with space", () => {
            expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([]);
        });
    });

    describe("spacing=none: case insensitivity", () => {
        const g = `<Start> [spacing=none] = hello world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches mixed case without space", () => {
            expect(testMatchGrammar(grammar, "HelloWorld")).toStrictEqual([
                true,
            ]);
        });
        it("matches all caps without space", () => {
            expect(testMatchGrammar(grammar, "HELLOWORLD")).toStrictEqual([
                true,
            ]);
        });
        it("does not match mixed case with space", () => {
            expect(testMatchGrammar(grammar, "Hello World")).toStrictEqual([]);
        });
    });

    describe("spacing=none: leading/trailing whitespace in input", () => {
        const g = `<Start> [spacing=none] = hello world -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("does not match with leading whitespace", () => {
            // In none mode, no leading separator is consumed
            expect(testMatchGrammar(grammar, "  helloworld")).toStrictEqual([]);
        });
        it("matches with trailing whitespace", () => {
            expect(testMatchGrammar(grammar, "helloworld  ")).toStrictEqual([
                true,
            ]);
        });
        it("does not match with both leading and trailing whitespace", () => {
            expect(testMatchGrammar(grammar, "  helloworld  ")).toStrictEqual(
                [],
            );
        });
    });

    describe("spacing=none vs other modes: leading whitespace", () => {
        // Counter-test: other modes still consume leading whitespace
        // even though none mode rejects it.
        it("auto mode accepts leading whitespace", () => {
            const g = `<Start> = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "  hello world")).toStrictEqual([
                true,
            ]);
        });
        it("required mode accepts leading whitespace", () => {
            const g = `<Start> [spacing=required] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "  hello world")).toStrictEqual([
                true,
            ]);
        });
        it("optional mode accepts leading whitespace", () => {
            const g = `<Start> [spacing=optional] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            expect(testMatchGrammar(grammar, "  helloworld")).toStrictEqual([
                true,
            ]);
        });
    });

    describe("spacing=none: CJK characters", () => {
        const g = `<Start> [spacing=none] = 你好 世界 -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches when CJK tokens are adjacent", () => {
            expect(testMatchGrammar(grammar, "你好世界")).toStrictEqual([true]);
        });
        it("does not match when CJK tokens have space", () => {
            expect(testMatchGrammar(grammar, "你好 世界")).toStrictEqual([]);
        });
    });
});
