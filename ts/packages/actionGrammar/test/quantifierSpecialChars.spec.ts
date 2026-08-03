// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGrammarRules } from "../src/grammarRuleParser.js";
import { writeGrammarRules } from "../src/grammarRuleWriter.js";
import { loadGrammarRules } from "../src/grammarLoader.js";
import { describeForEachMatcher } from "./testUtils.js";

const testDir = dirname(fileURLToPath(import.meta.url));

/**
 * Proposal (CurtisM): postfix ? / * / + are quantifiers only after ")" or ">".
 * Bare quantifiers are parse errors. Literal ? * + require escaping.
 * Writer/prettier prefers the grouped form (<Name>)? over bare <Name>?.
 */

function parse(src: string, file = "test.agr") {
    return parseGrammarRules(file, src, false);
}

function expectParseError(src: string, match: RegExp | string) {
    expect(() => parse(src)).toThrow(match);
}

describe("Quantifier special chars (? * +)", () => {
    describe("expressionsSpecialChar + bare quantifier errors", () => {
        it("errors on bare '?' not after ')' or '>'", () => {
            expectParseError(
                `<Start> = what is the time? -> "q";`,
                /Unexpected quantifier '\?'/,
            );
        });

        it("errors on bare '*' and '+' after words", () => {
            expectParseError(
                `<Start> = one* two -> "x";`,
                /Unexpected quantifier '\*'/,
            );
            expectParseError(
                `<Start> = one+ two -> "x";`,
                /Unexpected quantifier '\+'/,
            );
        });

        it("errors on $(x)* / $(x)+ with actionable group-form message", () => {
            expectParseError(
                `<Start> = measure $(u:word)* -> "x";`,
                /Capture \$\(\.\.\.\) only supports optional via \)\?/,
            );
            expectParseError(
                `<Start> = measure $(u:word)+ -> "x";`,
                /Use \(\$\(\.\.\.\)\)\+/,
            );
            // Group form still works
            expect(() =>
                parse(`<Start> = measure ($(u:word))+ -> "x";`),
            ).not.toThrow();
        });

        it("errors on bare the?/one?/music? (word + quantifier, no group)", () => {
            // Historical silent-wrong forms that used to mean "optional word".
            // Now they are hard parse errors; use (the)? / (one)? / (music)?.
            expectParseError(
                `<Start> = pause the? music -> "x";`,
                /Unexpected quantifier '\?'/,
            );
            expectParseError(
                `<Start> = one? two -> "x";`,
                /Unexpected quantifier '\?'/,
            );
            expectParseError(
                `<Start> = pause (the)? music? -> "x";`,
                /Unexpected quantifier '\?'/,
            );
        });

        it("errors on bare '?' after a string group close that already consumed )?", () => {
            // After (the)? the next bare ? is illegal.
            expectParseError(
                `<Start> = (the)? ? -> "x";`,
                /Unexpected quantifier '\?'/,
            );
        });

        it('errors on "please"?  (quotes are literal chars; ? is bare)', () => {
            // Quotes have no special meaning in patterns — "please" is chars
            // including the quote glyphs, then bare ? is illegal.
            expectParseError(
                `<Start> = "please"? -> "x";`,
                /Unexpected quantifier '\?'/,
            );
        });

        it("errors on 'really?'  (? inside unescaped quoted-looking text is still special)", () => {
            // parseStrExpr stops at special '?', leaving bare ? → error
            expectParseError(
                `<Start> = 'really?' -> "x";`,
                /Unexpected quantifier '\?'/,
            );
        });

        it("errors on standalone quantifier token", () => {
            expectParseError(
                `<Start> = ? -> "x";`,
                /Unexpected quantifier '\?'/,
            );
            expectParseError(
                `<Start> = * -> "x";`,
                /Unexpected quantifier '\*'/,
            );
            expectParseError(
                `<Start> = + -> "x";`,
                /Unexpected quantifier '\+'/,
            );
        });
    });

    describe("escaped literals", () => {
        it("accepts \\? as a literal question mark in the pattern", () => {
            const ast = parse(`<Start> = what is the time\\? -> "q";`);
            const expr = ast.definitions[0].rules[0].expressions[0] as {
                type: string;
                value: string[];
            };
            expect(expr.type).toBe("string");
            // "time?" is one token (escaped ? is part of the word)
            expect(expr.value).toEqual(["what", "is", "the", "time?"]);
        });

        it("accepts \\* and \\+ as literals", () => {
            const ast = parse(`<Start> = star\\* plus\\+ -> "x";`);
            const expr = ast.definitions[0].rules[0].expressions[0] as {
                type: string;
                value: string[];
            };
            expect(expr.value).toEqual(["star*", "plus+"]);
        });

        it('accepts "really\\?"  (quotes are match chars; escaped ? is literal)', () => {
            const ast = parse(`<Start> = "really\\?" -> "q";`);
            const expr = ast.definitions[0].rules[0].expressions[0] as {
                type: string;
                value: string[];
            };
            // Leading/trailing " are ordinary pattern characters
            expect(expr.value).toEqual(['"really?"']);
        });
    });

    describe("postfix after '>' (rule refs)", () => {
        it("parses <Name>? / <Name>* / <Name>+ as optional/repeat", () => {
            const ast = parse(`
                <Owner> = alice | bob;
                <Opt> = show <Owner>? files -> "opt";
                <Star> = show <Owner>* files -> "star";
                <Plus> = show <Owner>+ files -> "plus";
            `);
            const getRef = (name: string) => {
                const def = ast.definitions.find(
                    (d) => d.definitionName.name === name,
                )!;
                return def.rules[0].expressions[1] as {
                    type: string;
                    optional?: boolean;
                    repeat?: boolean;
                };
            };
            expect(getRef("Opt")).toMatchObject({
                type: "ruleReference",
                optional: true,
            });
            expect(getRef("Star")).toMatchObject({
                type: "ruleReference",
                optional: true,
                repeat: true,
            });
            expect(getRef("Plus")).toMatchObject({
                type: "ruleReference",
                repeat: true,
            });
            expect(getRef("Plus").optional).toBeFalsy();
        });

        it("parses required <Song> + escaped question: who sings song <Song>\\?", () => {
            const ast = parse(`
                <Song> = hello | goodbye;
                <Start> = who sings song <Song>\\? -> "q";
            `);
            const exprs = ast.definitions.find(
                (d) => d.definitionName.name === "Start",
            )!.rules[0].expressions;
            // string "who sings song", ruleRef Song (required), string "?"
            expect(exprs[0]).toMatchObject({
                type: "string",
                value: ["who", "sings", "song"],
            });
            expect(exprs[1]).toMatchObject({
                type: "ruleReference",
            });
            expect((exprs[1] as { optional?: boolean }).optional).toBeFalsy();
            expect(exprs[2]).toMatchObject({
                type: "string",
                value: ["?"],
            });
        });
    });

    describe("postfix after ')' (groups + captures) unchanged", () => {
        it("keeps (the | a)? / (<Polite>)? / $(units:<U>)?", () => {
            const ast = parse(`
                <U> = metric | imperial;
                <Polite> = please | kindly;
                <Start> =
                    (the | a)? item -> "det"
                  | (<Polite>)? open -> "polite"
                  | measure $(units:<U>)? -> "cap"
                ;
            `);
            expect(ast.definitions.length).toBe(3);
            const start = ast.definitions.find(
                (d) => d.definitionName.name === "Start",
            )!;
            const det = start.rules[0].expressions[0] as {
                type: string;
                optional?: boolean;
            };
            expect(det).toMatchObject({ type: "rules", optional: true });
            const polite = start.rules[1].expressions[0] as {
                type: string;
                optional?: boolean;
            };
            expect(polite).toMatchObject({ type: "rules", optional: true });
            const cap = start.rules[2].expressions[1] as {
                type: string;
                optional?: boolean;
            };
            expect(cap).toMatchObject({ type: "variable", optional: true });
        });

        it("keeps ()* and ()+", () => {
            const ast = parse(`
                <Start> =
                    tag (bug | feature)* -> "star"
                  | need (reviewer)+ -> "plus"
                ;
            `);
            const start = ast.definitions[0];
            expect(start.rules[0].expressions[1]).toMatchObject({
                type: "rules",
                optional: true,
                repeat: true,
            });
            expect(start.rules[1].expressions[1]).toMatchObject({
                type: "rules",
                repeat: true,
            });
        });
    });

    describe("writer/prettier prefers grouped form", () => {
        it("rewrites bare <Name>?/*/+ to grouped (<Name>) form", () => {
            const src = `
                <Owner> = alice | bob;
                <Opt> = show <Owner>? files -> "opt";
                <Star> = show <Owner>* files -> "star";
                <Plus> = show <Owner>+ files -> "plus";
            `;
            const written = writeGrammarRules(parse(src));
            expect(written).toContain("(<Owner>)?");
            expect(written).toContain("(<Owner>)*");
            expect(written).toContain("(<Owner>)+");
            // bare form should not remain on those quantified sites
            expect(written).not.toMatch(/<Owner>\?/);
            expect(written).not.toMatch(/<Owner>\*/);
            expect(written).not.toMatch(/<Owner>\+/);

            // reparse still has optional/repeat (via group)
            const reparsed = parse(written, "roundtrip.agr");
            const getExpr = (name: string) => {
                const def = reparsed.definitions.find(
                    (d) => d.definitionName.name === name,
                )!;
                return def.rules[0].expressions[1] as {
                    type: string;
                    optional?: boolean;
                    repeat?: boolean;
                };
            };
            // After prettier, these are groups not bare rule refs
            expect(getExpr("Opt")).toMatchObject({
                type: "rules",
                optional: true,
            });
            expect(getExpr("Star")).toMatchObject({
                type: "rules",
                optional: true,
                repeat: true,
            });
            expect(getExpr("Plus")).toMatchObject({
                type: "rules",
                repeat: true,
            });
        });

        it("escapes literal ? on write-back", () => {
            const src = `<Start> = what is the time\\? -> "q";`;
            const written = writeGrammarRules(parse(src));
            expect(written).toMatch(/time\\\?/);
            // must still parse
            expect(() => parse(written, "rt.agr")).not.toThrow();
        });
    });

    describe("colon stays unescaped (no ambiguity inside $())", () => {
        it("still parses $(h:number) : $(m:number) with spacing annotation", () => {
            // ":" in type position and as a literal separator between captures
            // (existing builtInEntities pattern). Colon is not special.
            const ast = parse(`
                <Start> [spacing=optional] = $(h:number) : $(m:number) -> { h, m };
            `);
            const exprs = ast.definitions[0].rules[0].expressions;
            expect(exprs[0]).toMatchObject({ type: "variable" });
            expect(exprs[1]).toMatchObject({
                type: "string",
                value: [":"],
            });
            expect(exprs[2]).toMatchObject({ type: "variable" });
        });
    });

    describe("value expressions after -> still use ternary ?", () => {
        it("does not treat value-side ? as a pattern quantifier", () => {
            const ast = parse(
                `<Start> = $(h:number) pm -> { hours: h < 12 ? h + 12 : h };`,
            );
            expect(ast.definitions[0].rules[0].value).toBeDefined();
        });

        it("keeps optional chaining ?. and nullish coalescing in values", () => {
            const ast = parse(
                `<Start> = lookup $(obj:word) -> obj.value?.name;`,
            );
            expect(ast.definitions[0].rules[0].value).toBeDefined();
            const ast2 = parse(`<Start> = get $(x:word) -> x ?? "default";`);
            expect(ast2.definitions[0].rules[0].value).toBeDefined();
        });
    });

    describe("import * and $(x)? still work", () => {
        it("parses wildcard import * from without treating * as quantifier", () => {
            const ast = parse(
                `import * from "other.agr";\n<Start> = hi -> "x";`,
            );
            expect(ast.imports).toHaveLength(1);
            expect(ast.imports[0].names).toBe("*");
            expect(ast.imports[0].source).toBe("other.agr");
            expect(ast.definitions[0].definitionName.name).toBe("Start");
        });

        it("keeps $(x)? optional capture", () => {
            const ast = parse(`<Start> = measure $(units:word)? -> "cap";`);
            const cap = ast.definitions[0].rules[0].expressions[1] as {
                type: string;
                optional?: boolean;
            };
            expect(cap).toMatchObject({ type: "variable", optional: true });
        });
    });

    describe("pitfall docs: bare <Song>? is optional, no literal ?", () => {
        it("parses who sings song <Song>? as optional Song (no trailing ? string)", () => {
            const ast = parse(`
                <Song> = hello | goodbye;
                <Start> = who sings song <Song>? -> "hit";
            `);
            const exprs = ast.definitions.find(
                (d) => d.definitionName.name === "Start",
            )!.rules[0].expressions;
            expect(exprs).toHaveLength(2);
            expect(exprs[0]).toMatchObject({
                type: "string",
                value: ["who", "sings", "song"],
            });
            expect(exprs[1]).toMatchObject({
                type: "ruleReference",
                optional: true,
            });
            // No third expression for a literal "?"
        });
    });

    describe("schema→grammar generator prompts use legal quantifiers", () => {
        // LLM prompts that ship illegal bare ?/*/+ CORRECT examples cause the
        // generator to emit unparseable .agr. Guard both package copies.
        // Tests execute from dist/test/*.js — climb to package root / sibling package.
        const promptSources = [
            join(testDir, "../../src/generation/schemaToGrammarGenerator.ts"),
            join(
                testDir,
                "../../../agentSdkWrapper/src/schemaToGrammarGenerator.ts",
            ),
        ];

        function loadPromptSource(path: string): string {
            return readFileSync(path, "utf8");
        }

        /** Lines that teach CORRECT syntax (not WRONG counter-examples). */
        function correctLines(src: string): string[] {
            return src
                .split("\n")
                .filter(
                    (l) => /^\s*CORRECT:/i.test(l) || /^\s*Example:/i.test(l),
                );
        }

        it("CORRECT/Example lines never use bare quantifier after a word or string", () => {
            // Illegal: word?  'str'?  "str"?  (quantifier not after ) or >)
            const bareAfterAtom =
                /(?:^|[^)>\s\\])(['"][^'"]*['"]|[A-Za-z_][\w-]*)\s*[?*+]/;
            for (const path of promptSources) {
                const src = loadPromptSource(path);
                for (const line of correctLines(src)) {
                    expect(line).not.toMatch(bareAfterAtom);
                }
            }
        });

        it("both generators document quantifier special-char rules", () => {
            for (const path of promptSources) {
                const src = loadPromptSource(path);
                expect(src).toMatch(/Quantifiers \? \* \+ are SPECIAL/i);
                expect(src).toMatch(/immediately after "\)" or ">"/i);
                expect(src).toMatch(/PARSE ERROR/);
                expect(src).toMatch(/\(<Name>\)\?/);
                // Shared Polite vocab must not use bare optional words
                expect(src).toMatch(
                    /<Polite>\s*=\s*can you\s*\|\s*please\s*\|\s*would you\s*;/,
                );
                expect(src).toMatch(/\(<Polite>\)\? open outlook/);
                // Old illegal Polite forms must not appear outside WRONG lines
                const nonWrong = src
                    .split("\n")
                    .filter((l) => !/\bWRONG\b/i.test(l))
                    .join("\n");
                expect(nonWrong).not.toMatch(/'can you'\?/);
                expect(nonWrong).not.toMatch(/'please'\?/);
                expect(nonWrong).not.toMatch(/"please"\?/);
                expect(nonWrong).not.toMatch(/Optional elements: element\?/);
            }
        });

        it("literal-escape examples keep a real backslash in the runtime prompt", () => {
            // Prompt bodies are TS template literals. A single \? in source
            // collapses to bare "?" at runtime and teaches the silent pitfall
            // (who sings song <Song>? = optional Song). Source must use \\?
            // so the model sees a real backslash-question sequence.
            for (const path of promptSources) {
                const src = loadPromptSource(path);
                // File text must contain time\\? and <Song>\\? (two backslashes)
                expect(src).toMatch(/time\\\\\?/);
                expect(src).toMatch(/<Song>\\\\\?/);
                expect(src).toMatch(/\)\?\\\\\?/); // (<Song>)?\?
                // Simulate template evaluation of those escape sequences
                expect(Function("return `time\\\\?`")()).toBe("time\\?");
                expect(Function("return `time\\?`")()).toBe("time?"); // the bug
            }
        });

        it("prompt CORRECT fragments actually parse", () => {
            // Fragments taught as CORRECT in both generators.
            const fragments = [
                `<Start> = (((can you)? add) | include) -> "x";`,
                `<Start> = (please)? open -> "x";`,
                `<Start> = (can you)? open -> "x";`,
                `<Polite> = can you | please | would you;\n` +
                    `<Start> = (<Polite>)? open outlook -> "ok";`,
                `<Song> = hello;\n` +
                    `<Start> = who sings song <Song>? -> "opt";`,
                `<Song> = hello;\n` +
                    `<Start> = who sings song <Song>\\? -> "req";`,
                `<Song> = hello;\n` +
                    `<Start> = who sings song (<Song>)?\\? -> "both";`,
                `<Start> = (a|b)* c -> "x";`,
                `<Start> = measure $(x:word)? -> "cap";`,
            ];
            for (const frag of fragments) {
                expect(() => parse(frag)).not.toThrow();
            }
        });
    });
});

describeForEachMatcher(
    "Quantifier special chars — match semantics",
    (testMatchGrammar) => {
        it("bare <Owner>? matches with or without owner (same as (<Owner>)?)", () => {
            const bare = loadGrammarRules(
                "bare.agr",
                `
                <Owner> = alice | bob;
                <Start> = show <Owner>? files -> "bare";
                `,
            );
            const grouped = loadGrammarRules(
                "grouped.agr",
                `
                <Owner> = alice | bob;
                <Start> = show (<Owner>)? files -> "grouped";
                `,
            );
            for (const input of [
                "show files",
                "show alice files",
                "show bob files",
            ]) {
                expect(testMatchGrammar(bare, input).length).toBe(
                    testMatchGrammar(grouped, input).length,
                );
                expect(testMatchGrammar(bare, input)).toStrictEqual(["bare"]);
            }
            expect(testMatchGrammar(bare, "show charlie files")).toStrictEqual(
                [],
            );
        });

        it("required Song + escaped ? matches question utterances", () => {
            const g = loadGrammarRules(
                "q.agr",
                `
                <Song> = hello | goodbye;
                <Start> = who sings song <Song>\\? -> "hit";
                `,
            );
            expect(testMatchGrammar(g, "who sings song hello?")).toStrictEqual([
                "hit",
            ]);
            expect(
                testMatchGrammar(g, "who sings song goodbye?"),
            ).toStrictEqual(["hit"]);
            // missing song
            expect(testMatchGrammar(g, "who sings song?")).toStrictEqual([]);
            // missing ?
            expect(testMatchGrammar(g, "who sings song hello")).toStrictEqual(
                [],
            );
        });

        it("optional Song + escaped ?: who sings song (<Song>)?\\?", () => {
            const g = loadGrammarRules(
                "opt.agr",
                `
                <Song> = hello | goodbye;
                <Start> = who sings song (<Song>)?\\? -> "hit";
                `,
            );
            expect(testMatchGrammar(g, "who sings song?")).toStrictEqual([
                "hit",
            ]);
            expect(testMatchGrammar(g, "who sings song hello?")).toStrictEqual([
                "hit",
            ]);
        });

        it("pitfall: who sings song <Song>? is OPTIONAL song (no literal ? in pattern)", () => {
            const g = loadGrammarRules(
                "pitfall.agr",
                `
                <Song> = hello | goodbye;
                <Start> = who sings song <Song>? -> "hit";
                `,
            );
            // optional song — pattern has no literal "?"
            expect(testMatchGrammar(g, "who sings song")).toStrictEqual([
                "hit",
            ]);
            expect(testMatchGrammar(g, "who sings song hello")).toStrictEqual([
                "hit",
            ]);
            // Matcher treats trailing utterance "?" as flex-space punctuation, so
            // these still match. The pitfall is author intent (optional Song), not
            // a hard reject of "?" in the request.
            expect(testMatchGrammar(g, "who sings song hello?")).toStrictEqual([
                "hit",
            ]);
            // "who sings song?" — song name missing; trailing punct alone is not a Song
            expect(testMatchGrammar(g, "who sings song?")).toStrictEqual([
                "hit",
            ]);
        });

        it("literal time\\? matches trailing question mark", () => {
            const g = loadGrammarRules(
                "time.agr",
                `<Start> = what is the time\\? -> "q";`,
            );
            expect(testMatchGrammar(g, "what is the time?")).toStrictEqual([
                "q",
            ]);
            expect(testMatchGrammar(g, "what is the time")).toStrictEqual([]);
        });

        it("<Polite>? open app — optional polite prefix", () => {
            const g = loadGrammarRules(
                "polite.agr",
                `
                <Polite> = please | can you;
                <Start> = <Polite>? open outlook -> "ok";
                `,
            );
            expect(testMatchGrammar(g, "open outlook")).toStrictEqual(["ok"]);
            expect(testMatchGrammar(g, "please open outlook")).toStrictEqual([
                "ok",
            ]);
            expect(testMatchGrammar(g, "can you open outlook")).toStrictEqual([
                "ok",
            ]);
            expect(testMatchGrammar(g, "open notepad")).toStrictEqual([]);
        });

        it("bare <Owner>* / <Owner>+ match zero-or-more / one-or-more", () => {
            const star = loadGrammarRules(
                "star.agr",
                `
                <Owner> = alice | bob;
                <Start> = show <Owner>* files -> "star";
                `,
            );
            const plus = loadGrammarRules(
                "plus.agr",
                `
                <Owner> = alice | bob;
                <Start> = show <Owner>+ files -> "plus";
                `,
            );
            expect(testMatchGrammar(star, "show files")).toStrictEqual([
                "star",
            ]);
            expect(
                testMatchGrammar(star, "show alice bob files"),
            ).toStrictEqual(["star"]);
            expect(testMatchGrammar(plus, "show files")).toStrictEqual([]);
            expect(testMatchGrammar(plus, "show alice files")).toStrictEqual([
                "plus",
            ]);
        });

        it("is Tesla the best car(\\?)?  — optional literal ?", () => {
            const g = loadGrammarRules(
                "tesla.agr",
                `<Start> = is Tesla the best car(\\?)? -> "ok";`,
            );
            expect(testMatchGrammar(g, "is Tesla the best car")).toContain(
                "ok",
            );
            // May yield multiple matches (optional group taken vs skipped with
            // trailing punct as flex-space) — both are successful hits.
            const withQ = testMatchGrammar(g, "is Tesla the best car?");
            expect(withQ.length).toBeGreaterThanOrEqual(1);
            expect(withQ.every((v) => v === "ok")).toBe(true);
        });
    },
);
