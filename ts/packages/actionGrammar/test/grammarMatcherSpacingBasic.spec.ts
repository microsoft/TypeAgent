// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachMatcher } from "./testUtils.js";

describeForEachMatcher(
    "Grammar Matcher - Spacing Modes (Basic)",
    (testMatchGrammar) => {
        describe("default (auto) - Latin requires space", () => {
            const g = `<Start> = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=required annotation", () => {
            const g = `<Start> [spacing=required] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
        });

        describe("spacing=optional annotation", () => {
            const g = `<Start> [spacing=optional] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("matches without space", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=auto annotation - CJK (Han)", () => {
            // In the grammar, whitespace creates a flex-space boundary.
            // With auto mode, Han characters don't need spaces between them.
            const g = `<Start> [spacing=auto] = 你好 世界 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space", () => {
                expect(testMatchGrammar(grammar, "你好世界")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "你好 世界")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("no annotation is identical to [spacing=auto]", () => {
            // Omitting the annotation must produce the same behavior as
            // explicitly writing [spacing=auto] — both store spacingMode as
            // undefined and both enforce word-boundary rules for Latin scripts
            // while allowing adjacent CJK characters.
            it("Latin words without space are rejected in both", () => {
                const gNoAnnotation = loadGrammarRules(
                    "test.grammar",
                    `<Start> = hello world -> true;`,
                );
                const gAutoExplicit = loadGrammarRules(
                    "test.grammar",
                    `<Start> [spacing=auto] = hello world -> true;`,
                );
                expect(
                    testMatchGrammar(gNoAnnotation, "helloworld"),
                ).toStrictEqual([]);
                expect(
                    testMatchGrammar(gAutoExplicit, "helloworld"),
                ).toStrictEqual([]);
            });
            it("CJK characters without space match in both", () => {
                const gNoAnnotation = loadGrammarRules(
                    "test.grammar",
                    `<Start> = 你好 世界 -> true;`,
                );
                const gAutoExplicit = loadGrammarRules(
                    "test.grammar",
                    `<Start> [spacing=auto] = 你好 世界 -> true;`,
                );
                expect(
                    testMatchGrammar(gNoAnnotation, "你好世界"),
                ).toStrictEqual([true]);
                expect(
                    testMatchGrammar(gAutoExplicit, "你好世界"),
                ).toStrictEqual([true]);
            });
        });

        describe("spacing=auto annotation - mixed Latin+CJK boundary", () => {
            // At the Latin→CJK boundary no space is needed (CJK side is no-space)
            const g = `<Start> [spacing=auto] = hello 世界 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space at Latin-CJK boundary", () => {
                expect(testMatchGrammar(grammar, "hello世界")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space at Latin-CJK boundary", () => {
                expect(testMatchGrammar(grammar, "hello 世界")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=auto annotation - Hangul (Korean)", () => {
            // Hangul is in wordBoundaryScriptRe so adjacent Hangul syllables
            // require a separator, just like Latin.
            const g = `<Start> [spacing=auto] = 안녕 세계 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("does not match without space (Hangul requires separator)", () => {
                expect(testMatchGrammar(grammar, "안녕세계")).toStrictEqual([]);
            });
            it("matches with space", () => {
                expect(testMatchGrammar(grammar, "안녕 세계")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=auto annotation - CJK→Latin boundary", () => {
            // Reverse of the Latin→CJK test: CJK on the left, Latin on the right.
            // CJK is not in wordBoundaryScriptRe so no space is needed at this boundary.
            const g = `<Start> [spacing=auto] = 世界 hello -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space at CJK-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "世界hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space at CJK-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "世界 hello")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("spacing=required annotation - punctuation-only separator in input", () => {
            // required mode uses [\s\p{P}]+ which accepts punctuation characters.
            const g = `<Start> [spacing=required] = hello world -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("accepts a comma as the separator", () => {
                expect(testMatchGrammar(grammar, "hello,world")).toStrictEqual([
                    true,
                ]);
            });
            it("accepts a period as the separator", () => {
                expect(testMatchGrammar(grammar, "hello.world")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("[spacing=auto] - digit-Latin boundary does not require space", () => {
            // One side being a digit and the other Latin: no space needed.
            const g = `<Start> = 123 hello -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches without space at digit-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "123hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches with space at digit-Latin boundary", () => {
                expect(testMatchGrammar(grammar, "123 hello")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("[spacing=auto] - digit-digit boundary requires space", () => {
            // Both sides are digits: a separator is required because "123456"
            // is a different token from "123 456".
            const g = `<Start> = 123 456 -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("does not match without space at digit-digit boundary", () => {
                expect(testMatchGrammar(grammar, "123456")).toStrictEqual([]);
            });
            it("matches with space at digit-digit boundary", () => {
                expect(testMatchGrammar(grammar, "123 456")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("empty wildcard rejection - spacing=auto (default)", () => {
            // wildcardTrimRegExp uses .+? so all-whitespace or empty content is rejected
            const g = `<Start> = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard is pure whitespace (trims to empty)", () => {
                expect(
                    testMatchGrammar(grammar, "hello   world"),
                ).toStrictEqual([]);
            });
            it("matches when wildcard has non-separator content", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual(["foo"]);
            });
        });

        describe("empty wildcard rejection - spacing=required", () => {
            const g = `<Start> [spacing=required] = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard is pure whitespace", () => {
                expect(
                    testMatchGrammar(grammar, "hello   world"),
                ).toStrictEqual([]);
            });
            it("matches when wildcard has non-separator content", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual(["foo"]);
            });
        });

        describe("empty wildcard rejection - spacing=optional", () => {
            const g = `<Start> [spacing=optional] = hello $(x) world -> x;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("rejects when wildcard is pure whitespace", () => {
                expect(
                    testMatchGrammar(grammar, "hello   world"),
                ).toStrictEqual([]);
            });
            it("matches when wildcard has non-separator content", () => {
                expect(
                    testMatchGrammar(grammar, "hello foo world"),
                ).toStrictEqual(["foo"]);
            });
        });

        describe("parse error - unknown annotation key", () => {
            it("throws on unknown annotation key", () => {
                expect(() =>
                    loadGrammarRules(
                        "test.grammar",
                        `<Start> [unknown=auto] = hello -> true;`,
                    ),
                ).toThrow("Unknown rule annotation");
            });
        });

        describe("parse error - invalid spacing value", () => {
            it("throws on invalid value", () => {
                expect(() =>
                    loadGrammarRules(
                        "test.grammar",
                        `<Start> [spacing=never] = hello -> true;`,
                    ),
                ).toThrow("Invalid value");
            });
        });

        describe("number variable respects spacingMode", () => {
            describe("required mode - trailing separator after number", () => {
                const g = `<Start> [spacing=required] = set $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by word (no separator)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50items"),
                    ).toStrictEqual([]);
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 items"),
                    ).toStrictEqual([50]);
                });
            });

            describe("optional mode - trailing separator after number", () => {
                const g = `<Start> [spacing=optional] = set $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("accepts number immediately followed by word (no separator needed)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50items"),
                    ).toStrictEqual([50]);
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 items"),
                    ).toStrictEqual([50]);
                });
            });

            describe("auto mode - digit-Latin boundary does not require space", () => {
                // Digit followed by Latin: not both in wordBoundaryScriptRe, so no separator needed.
                const g = `<Start> = set $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("accepts number immediately followed by Latin word (auto mode)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50items"),
                    ).toStrictEqual([50]);
                });
            });

            describe("required mode - number at start of rule (no preceding part)", () => {
                // Verifies the trailing separator check fires even when there is no
                // preceding string part whose own isBoundarySatisfied check would have
                // enforced a separator earlier.
                const g = `<Start> [spacing=required] = $(n:number) items -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by word (no separator)", () => {
                    expect(testMatchGrammar(grammar, "50items")).toStrictEqual(
                        [],
                    );
                });
                it("accepts number followed by space then word", () => {
                    expect(testMatchGrammar(grammar, "50 items")).toStrictEqual(
                        [50],
                    );
                });
            });

            describe("auto mode - digit-digit boundary requires space after number variable", () => {
                // Both the end of the matched number and the start of the next
                // literal are digits → isBoundarySatisfied returns false in auto mode.
                const g = `<Start> = $(n:number) 456 -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by digit literal (no separator)", () => {
                    expect(testMatchGrammar(grammar, "123456")).toStrictEqual(
                        [],
                    );
                });
                it("accepts number followed by space then digit literal", () => {
                    expect(testMatchGrammar(grammar, "123 456")).toStrictEqual([
                        123,
                    ]);
                });
            });

            describe("required mode - number with wildcard trailing separator", () => {
                const g = `<Start> [spacing=required] = $(x) $(n:number) end -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("rejects number immediately followed by word (no separator)", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50end"),
                    ).toStrictEqual([]);
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 end"),
                    ).toStrictEqual([50]);
                });
            });

            describe("optional mode - number with wildcard trailing separator", () => {
                // In optional mode the wildcard path should accept no separator.
                const g = `<Start> [spacing=optional] = $(x) $(n:number) end -> n;`;
                const grammar = loadGrammarRules("test.grammar", g);
                it("accepts number immediately followed by word (no separator needed)", () => {
                    expect(testMatchGrammar(grammar, "set50end")).toStrictEqual(
                        [50],
                    );
                });
                it("accepts number followed by space then word", () => {
                    expect(
                        testMatchGrammar(grammar, "set 50 end"),
                    ).toStrictEqual([50]);
                });
            });
        });

        describe("repeat group ()* inherits optional mode", () => {
            const g = `<Start> [spacing=optional] = hello (world)* -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches zero repetitions", () => {
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    true,
                ]);
            });
            it("matches one repetition without space (optional mode)", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches two repetitions without space (optional mode)", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldworld"),
                ).toStrictEqual([true]);
            });
        });

        describe("repeat group ()+ with required mode", () => {
            const g = `<Start> [spacing=required] = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches one repetition with space", () => {
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    true,
                ]);
            });
            it("does not match without space before group", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual(
                    [],
                );
            });
            it("matches two repetitions with spaces", () => {
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
            it("does not match when repetitions are not space-separated", () => {
                // The first 'world' ends with 'w' at index 11 in input; required
                // mode rejects a match unless a separator follows the token.
                expect(
                    testMatchGrammar(grammar, "hello worldworld"),
                ).toStrictEqual([]);
            });
        });

        describe("repeat group ()+ with optional mode", () => {
            const g = `<Start> [spacing=optional] = hello (world)+ -> true;`;
            const grammar = loadGrammarRules("test.grammar", g);
            it("matches one repetition without space (optional mode)", () => {
                expect(testMatchGrammar(grammar, "helloworld")).toStrictEqual([
                    true,
                ]);
            });
            it("matches two repetitions without space (optional mode)", () => {
                expect(
                    testMatchGrammar(grammar, "helloworldworld"),
                ).toStrictEqual([true]);
            });
            it("matches two repetitions with spaces (optional mode)", () => {
                expect(
                    testMatchGrammar(grammar, "hello world world"),
                ).toStrictEqual([true]);
            });
        });
    },
);
