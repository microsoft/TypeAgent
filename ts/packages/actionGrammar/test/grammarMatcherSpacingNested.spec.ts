// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { testMatchGrammar } from "./testUtils.js";

describe("Grammar Matcher - Spacing Nested Rules and Mode Switching", () => {
    describe("per-rule mode switching", () => {
        // <Start> references two sub-rules declared with different modes.
        const g = `
            <RequiredRule> [spacing=required] = hello world -> "required";
            <OptionalRule> [spacing=optional] = hello world -> "optional";
            <Start> = $(x:<RequiredRule>) -> x | $(x:<OptionalRule>) -> x;
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("both sub-rules match when space is present", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                "required",
                "optional",
            ]);
        });
        it("only the optional sub-rule matches without space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "optional",
            ]);
        });
    });

    describe("nested rule uses its own mode", () => {
        // EnglishRule uses required; NoSpaceRule uses optional.
        // <Start> references both — each sub-rule uses its own declared mode.
        const g = `
            <EnglishRule> [spacing=required] = hello world -> "english";
            <NoSpaceRule> [spacing=optional] = hi there -> "nospace";
            <Start> = $(x:<EnglishRule>) $(y:<NoSpaceRule>) -> { x, y };
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("each nested rule uses its own declared mode", () => {
            // EnglishRule requires space between "hello" and "world";
            // NoSpaceRule allows "hithere" without space.
            expect(
                testMatchGrammar(grammar, "hello world hithere"),
            ).toStrictEqual([{ x: "english", y: "nospace" }]);
        });
    });

    describe("merged rules - same rule name, different modes", () => {
        // Two definitions of <Start> with different spacing modes.
        // The compiler merges them into one rule with two alternatives,
        // each carrying its own declared mode.
        const g = `
            <Start> [spacing=required] = hello world -> "required";
            <Start> [spacing=optional] = hello world -> "optional";
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("both alternatives match when space is present", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                "required",
                "optional",
            ]);
        });
        it("only the optional alternative matches without space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "optional",
            ]);
        });
    });

    describe("inline group inherits enclosing rule mode", () => {
        const g = `<Start> [spacing=optional] = hello (world | earth) -> true;`;
        const grammar = loadGrammarRules("test.grammar", g);
        it("matches with space", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                true,
            ]);
        });
        it("matches without space (inherits optional)", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                true,
            ]);
        });
        it("matches second alternative without space", () => {
            expect(testMatchGrammar(grammar, "helloearth")).toStrictEqual([
                true,
            ]);
        });
    });

    describe("same-name rule with different modes merged", () => {
        // <Greeting> is defined twice with different modes; each alternative
        // must respect its own declared spacingMode.
        const g = `
            <Greeting> [spacing=optional] = hello world -> "optional";
            <Greeting> [spacing=required] = good morning -> "required";
            <Start> = <Greeting>;
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("optional alternative matches without space", () => {
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "optional",
            ]);
        });
        it("required alternative matches with space", () => {
            expect(testMatchGrammar(grammar, "good morning")).toStrictEqual([
                "required",
            ]);
        });
        it("required alternative does not match without space", () => {
            expect(testMatchGrammar(grammar, "goodmorning")).toStrictEqual([]);
        });
    });

    describe("rule without annotation uses auto/default mode", () => {
        // <Before> has no annotation — must behave identically to
        // [spacing=auto]: Latin words require a separator, CJK do not.
        const g = `
            <Before> = hello world -> "before";
            <After> [spacing=optional] = hello world -> "after";
            <Start> = $(x:<Before>) -> x | $(x:<After>) -> x;
        `;
        const grammar = loadGrammarRules("test.grammar", g);
        it("<Before> requires space between Latin words (auto default)", () => {
            expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                "before",
                "after",
            ]);
        });
        it("<Before> does not match without space (auto default)", () => {
            // Only the optional <After> alternative should match.
            expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                "after",
            ]);
        });
    });

    describe("separator AFTER a rule reference follows parent mode", () => {
        // The nested rule uses optional mode, so its own isBoundarySatisfied check
        // always passes. The separator AFTER the rule reference must be
        // validated using the parent (outer) rule's spacingMode.
        describe("parent required, nested optional", () => {
            const g = `
                <Inner> [spacing=optional] = hello world -> true;
                <Start> [spacing=required] = $(x:<Inner>) end -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when space is present after rule reference", () => {
                expect(
                    testMatchGrammar(grammar, "helloworld end"),
                ).toStrictEqual([true]);
            });
            it("does not match without space after rule reference (parent required)", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldend"),
                ).toStrictEqual([]);
            });
        });

        describe("parent optional, nested required", () => {
            // The nested rule's own required mode enforces a separator
            // after its last token, so "hello worldend" is rejected by
            // the inner rule itself regardless of the outer mode.
            const g = `
                <Inner> [spacing=required] = hello world -> true;
                <Start> [spacing=optional] = $(x:<Inner>) end -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches when space is present after rule reference", () => {
                expect(
                    testMatchGrammar(grammar, "hello world end"),
                ).toStrictEqual([true]);
            });
            it("does not match without space (inner required mode enforces the boundary)", () => {
                expect(
                    testMatchGrammar(grammar, "hello worldend"),
                ).toStrictEqual([]);
            });
        });
        describe("deeply nested: grandparent optional, parent required pass-through, grandchild optional", () => {
            // Bug: A(optional) -> B(required, single-part pass-through) -> C(optional)
            // After C finishes, finalizeNestedRule restores B's "required" mode and
            // the separator check fires against it — rejecting "barbaz" even though
            // A (the nearest ancestor with a following part) uses "optional" mode.
            // The correct behaviour is to walk up to the first ancestor that still
            // has remaining parts and use *that* ancestor's spacingMode.
            const g = `
                <Inner> [spacing=optional] = bar -> true;
                <Middle> [spacing=required] = $(x:<Inner>) -> x;
                <Start> [spacing=optional] = $(x:<Middle>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space (works today)", () => {
                expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                    true,
                ]);
            });
            it("matches without space (grandparent optional mode governs the separator after the pass-through)", () => {
                expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([
                    true,
                ]);
            });
        });
        describe("deeply nested: grandparent required, parent optional pass-through, grandchild optional", () => {
            // The separator check is deferred past the exhausted optional parent
            // and fires at the grandparent level with "required" mode.
            const g = `
                <Inner> [spacing=optional] = bar -> true;
                <Middle> [spacing=optional] = $(x:<Inner>) -> x;
                <Start> [spacing=required] = $(x:<Middle>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space (grandparent required governs)", () => {
                expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([]);
            });
        });
        describe("deeply nested: grandparent auto (default), parent required pass-through, grandchild optional", () => {
            // auto mode: both "bar" and "baz" are Latin → space is required.
            const g = `
                <Inner> [spacing=optional] = bar -> true;
                <Middle> [spacing=required] = $(x:<Inner>) -> x;
                <Start> = $(x:<Middle>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space (auto mode: Latin-Latin boundary requires space)", () => {
                expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([]);
            });
        });
        describe("deeply nested: grandchild required enforces its own internal separator", () => {
            // grandchild=required: the string-match isBoundarySatisfied check inside
            // grandchild rejects "bar" immediately followed by "baz" before
            // the nested-rule separator logic even runs.
            const g = `
                <Inner> [spacing=required] = bar -> true;
                <Middle> [spacing=optional] = $(x:<Inner>) -> x;
                <Start> [spacing=optional] = $(x:<Middle>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space (grandchild required catches it internally)", () => {
                expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([]);
            });
        });
        describe("4 levels deep: great-grandparent optional, two required pass-through levels, leaf optional", () => {
            // The fix must skip multiple exhausted ancestors and fire only at
            // the great-grandparent which has a following part ("baz").
            const g = `
                <Leaf> [spacing=optional] = bar -> true;
                <LevelA> [spacing=required] = $(x:<Leaf>) -> x;
                <LevelB> [spacing=required] = $(x:<LevelA>) -> x;
                <Start> [spacing=optional] = $(x:<LevelB>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                    true,
                ]);
            });
            it("matches without space (great-grandparent optional governs after two exhausted pass-through levels)", () => {
                expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([
                    true,
                ]);
            });
        });
        describe("4 levels deep: great-grandparent required, two optional pass-through levels, leaf optional", () => {
            // The boundary check defers past two exhausted optional ancestors
            // and fires at the great-grandparent with "required" mode.
            const g = `
                <Leaf> [spacing=optional] = bar -> true;
                <LevelA> [spacing=optional] = $(x:<Leaf>) -> x;
                <LevelB> [spacing=optional] = $(x:<LevelA>) -> x;
                <Start> [spacing=required] = $(x:<LevelB>) baz -> x;
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "bar baz")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space (great-grandparent required governs)", () => {
                expect(testMatchGrammar(grammar, "barbaz")).toStrictEqual([]);
            });
        });
    });

    describe("separator BEFORE a nested rule reference uses ancestor mode", () => {
        // Symmetric to the "after" tests: when a pass-through chain (A->X) ends
        // and the next sibling part in the ancestor is another nested rule (B),
        // the inter-rule separator is governed by the common ancestor's
        // spacingMode — not by any intermediate exhausted rule's mode.
        describe("grandparent optional, pass-through chain before sibling rule", () => {
            // Start(optional): [A(required)->X(optional) "foo"] then [B(optional) "bar"]
            // The separator between "foo" and "bar" uses Start's "optional" mode.
            const g = `
                <X> [spacing=optional] = foo -> "x";
                <A> [spacing=required] = $(x:<X>) -> x;
                <B> [spacing=optional] = bar -> "b";
                <Start> [spacing=optional] = $(a:<A>) $(b:<B>) -> [a, b];
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    ["x", "b"],
                ]);
            });
            it("matches without space (Start optional governs the inter-rule boundary)", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([
                    ["x", "b"],
                ]);
            });
        });
        describe("grandparent required, pass-through chain before sibling rule", () => {
            // Start(required): [A(optional)->X(optional) "foo"] then [B(optional) "bar"]
            // The separator uses Start's "required" mode regardless of A and X being optional.
            const g = `
                <X> [spacing=optional] = foo -> "x";
                <A> [spacing=optional] = $(x:<X>) -> x;
                <B> [spacing=optional] = bar -> "b";
                <Start> [spacing=required] = $(a:<A>) $(b:<B>) -> [a, b];
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    ["x", "b"],
                ]);
            });
            it("does not match without space (Start required governs)", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([]);
            });
        });
        describe("4 levels deep, great-grandparent optional, pass-through chain before sibling rule", () => {
            // Start(optional): [A(required)->B(required)->X(optional) "foo"] then [C(optional) "bar"]
            // Two exhausted required pass-through levels; Start's optional mode governs.
            const g = `
                <X> [spacing=optional] = foo -> "x";
                <B> [spacing=required] = $(x:<X>) -> x;
                <A> [spacing=required] = $(b:<B>) -> b;
                <C> [spacing=optional] = bar -> "c";
                <Start> [spacing=optional] = $(a:<A>) $(c:<C>) -> [a, c];
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    ["x", "c"],
                ]);
            });
            it("matches without space (Start optional governs after two exhausted pass-through levels)", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([
                    ["x", "c"],
                ]);
            });
        });
        describe("4 levels deep, great-grandparent required, pass-through chain before sibling rule", () => {
            // Start(required): [A(optional)->B(optional)->X(optional) "foo"] then [C(optional) "bar"]
            // Start's required mode governs even though all intermediates are optional.
            const g = `
                <X> [spacing=optional] = foo -> "x";
                <B> [spacing=optional] = $(x:<X>) -> x;
                <A> [spacing=optional] = $(b:<B>) -> b;
                <C> [spacing=optional] = bar -> "c";
                <Start> [spacing=required] = $(a:<A>) $(c:<C>) -> [a, c];
            `;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "foo bar")).toStrictEqual([
                    ["x", "c"],
                ]);
            });
            it("does not match without space (Start required governs)", () => {
                expect(testMatchGrammar(grammar, "foobar")).toStrictEqual([]);
            });
        });
    });
});
