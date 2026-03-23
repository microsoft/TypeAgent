// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { parseGrammarRules } from "../src/grammarRuleParser.js";
import { writeGrammarRules } from "../src/grammarRuleWriter.js";
import { describeForEachMatcher } from "./testUtils.js";

const enableExpressions = true;

function loadWithExpressions(grammar: string) {
    return loadGrammarRules("test.grammar", grammar, { enableExpressions });
}

function parseWithExpressions(grammar: string) {
    return parseGrammarRules("test.agr", grammar, false, enableExpressions);
}

// ── Parser Tests ──────────────────────────────────────────────────────────────

describe("Value Expression Parser", () => {
    describe("Arithmetic", () => {
        it("addition", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x + 1;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("+");
                expect(value.left).toEqual({ type: "variable", name: "x" });
                expect(value.right).toEqual({ type: "literal", value: 1 });
            }
        });

        it("subtraction", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x - 1;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("-");
            }
        });

        it("multiplication", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x * 2;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("*");
            }
        });

        it("division", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x / 2;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("/");
            }
        });

        it("modulo", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x % 2;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("%");
            }
        });

        it("precedence: * before +", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:number) -> x + 2 * 3;`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("+");
                expect(value.right).toEqual({
                    type: "binaryExpression",
                    operator: "*",
                    left: { type: "literal", value: 2 },
                    right: { type: "literal", value: 3 },
                });
            }
        });

        it("grouping with parentheses", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:number) -> (x + 2) * 3;`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("*");
                expect(value.left).toEqual({
                    type: "binaryExpression",
                    operator: "+",
                    left: { type: "variable", name: "x" },
                    right: { type: "literal", value: 2 },
                });
            }
        });
    });

    describe("Comparison & Equality", () => {
        it("strict equality", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x === 0;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("===");
            }
        });

        it("strict inequality", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x !== 0;`);
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("!==");
            }
        });

        it("less-than", () => {
            const r = parseWithExpressions(`<Start> = $(x:number) -> x < 10;`);
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("<");
            }
        });
    });

    describe("Logical & Ternary", () => {
        it("logical AND", () => {
            const r = parseWithExpressions(
                `<Start> = $(a:string) $(b:string) -> a && b;`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("binaryExpression");
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("&&");
            }
        });

        it("logical OR", () => {
            const r = parseWithExpressions(
                `<Start> = $(a:string) $(b:string) -> a || b;`,
            );
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("||");
            }
        });

        it("nullish coalescing", () => {
            const r = parseWithExpressions(
                `<Start> = $(a:string) -> a ?? "default";`,
            );
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "binaryExpression") {
                expect(value.operator).toBe("??");
            }
        });

        it("ternary expression", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:number) -> x > 0 ? "positive" : "non-positive";`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("conditionalExpression");
            if (value.type === "conditionalExpression") {
                expect(value.test).toEqual({
                    type: "binaryExpression",
                    operator: ">",
                    left: { type: "variable", name: "x" },
                    right: { type: "literal", value: 0 },
                });
                expect(value.consequent).toEqual({
                    type: "literal",
                    value: "positive",
                });
                expect(value.alternate).toEqual({
                    type: "literal",
                    value: "non-positive",
                });
            }
        });
    });

    describe("Unary", () => {
        it("logical NOT", () => {
            const r = parseWithExpressions(`<Start> = $(x:string) -> !x;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("unaryExpression");
            if (value.type === "unaryExpression") {
                expect(value.operator).toBe("!");
                expect(value.operand).toEqual({
                    type: "variable",
                    name: "x",
                });
            }
        });

        it("typeof", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> typeof x;`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("unaryExpression");
            if (value.type === "unaryExpression") {
                expect(value.operator).toBe("typeof");
                expect(value.operand).toEqual({
                    type: "variable",
                    name: "x",
                });
            }
        });

        it("typeof in ternary", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> typeof x === "string" ? x : "default";`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("conditionalExpression");
        });
    });

    describe("Member Access", () => {
        it("dot access", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> x.length;`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("memberExpression");
            if (value.type === "memberExpression") {
                expect(value.object).toEqual({
                    type: "variable",
                    name: "x",
                });
                expect(value.property).toBe("length");
                expect(value.computed).toBe(false);
                expect(value.optional).toBe(false);
            }
        });

        it("optional chaining", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> x?.length;`,
            );
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "memberExpression") {
                expect(value.optional).toBe(true);
            }
        });

        it("computed access", () => {
            const r = parseWithExpressions(`<Start> = $(x:string) -> x[0];`);
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("memberExpression");
            if (value.type === "memberExpression") {
                expect(value.computed).toBe(true);
                expect(value.property).toEqual({
                    type: "literal",
                    value: 0,
                });
            }
        });
    });

    describe("Method Calls", () => {
        it("method call with no args", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> x.toLowerCase();`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("callExpression");
            if (value.type === "callExpression") {
                expect(value.callee).toEqual({
                    type: "memberExpression",
                    object: { type: "variable", name: "x" },
                    property: "toLowerCase",
                    computed: false,
                    optional: false,
                });
                expect(value.arguments).toEqual([]);
            }
        });

        it("method call with args", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> x.slice(0, 5);`,
            );
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "callExpression") {
                expect(value.arguments).toEqual([
                    { type: "literal", value: 0 },
                    { type: "literal", value: 5 },
                ]);
            }
        });
    });

    describe("Template Literals", () => {
        it("simple template", () => {
            const r = parseWithExpressions(
                "<Start> = $(name:string) -> `Hello ${name}`;",
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("templateLiteral");
            if (value.type === "templateLiteral") {
                expect(value.quasis).toEqual(["Hello ", ""]);
                expect(value.expressions).toEqual([
                    { type: "variable", name: "name" },
                ]);
            }
        });

        it("template with multiple expressions", () => {
            const r = parseWithExpressions(
                "<Start> = $(first:string) $(last:string) -> `${first} ${last}`;",
            );
            const value = r.definitions[0].rules[0].value!;
            if (value.type === "templateLiteral") {
                expect(value.quasis).toEqual(["", " ", ""]);
                expect(value.expressions).toHaveLength(2);
            }
        });
    });

    describe("Spread", () => {
        it("array spread", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> [...x, "extra"];`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("array");
        });

        it("object spread is rejected at parse time", () => {
            expect(() =>
                parseWithExpressions(`<Start> = $(x:string) -> { ...x };`),
            ).toThrow(/Spread is not supported in object literals/);
        });
    });

    describe("Backward Compatibility (no expressions)", () => {
        it("simple literal value still works", () => {
            const r = parseWithExpressions(`<Start> = hello -> "greeting";`);
            const value = r.definitions[0].rules[0].value!;
            expect(value).toEqual({ type: "literal", value: "greeting" });
        });

        it("object value still works", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> { actionName: "test", param: x };`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("object");
        });

        it("array value still works", () => {
            const r = parseWithExpressions(
                `<Start> = $(x:string) -> [x, "a"];`,
            );
            const value = r.definitions[0].rules[0].value!;
            expect(value.type).toBe("array");
        });

        it("variable reference still works", () => {
            const r = parseWithExpressions(`<Start> = $(x:string) -> x;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value).toEqual({ type: "variable", name: "x" });
        });

        it("boolean literal still works", () => {
            const r = parseWithExpressions(`<Start> = hello -> true;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value).toEqual({ type: "literal", value: true });
        });

        it("number literal still works", () => {
            const r = parseWithExpressions(`<Start> = hello -> 42;`);
            const value = r.definitions[0].rules[0].value!;
            expect(value).toEqual({ type: "literal", value: 42 });
        });
    });

    describe("Feature Flag Off", () => {
        it("expressions are not parsed when flag is off", () => {
            // With flag off, `x + 1` after -> should fail because `+` is not
            // a valid token in simple value mode (x is parsed as variable, then
            // `+ 1` is unexpected).
            expect(() =>
                loadGrammarRules(
                    "test.grammar",
                    `<Start> = $(x:number) -> x + 1;`,
                ),
            ).toThrow();
        });

        it("simple values still work when flag is off", () => {
            const grammar = loadGrammarRules(
                "test.grammar",
                `<Start> = hello -> "world";`,
            );
            expect(grammar).toBeDefined();
        });
    });
});

// ── Matcher Tests ─────────────────────────────────────────────────────────────

describeForEachMatcher(
    "Value Expression Matcher",
    (testMatchGrammar, variant) => {
        describe("Arithmetic", () => {
            it("addition with number variable", () => {
                const g = `<Start> = $(x:number) -> x + 1;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "5")).toStrictEqual([6]);
            });

            it("multiplication", () => {
                const g = `<Start> = $(x:number) -> x * 3;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "4")).toStrictEqual([12]);
            });

            it("precedence: 2 + 3 * 4 = 14", () => {
                const g = `<Start> = $(x:number) -> x + 3 * 4;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "2")).toStrictEqual([14]);
            });

            it("grouped: (2 + 3) * 4 = 20", () => {
                const g = `<Start> = $(x:number) -> (x + 3) * 4;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "2")).toStrictEqual([20]);
            });
        });

        describe("String Operations", () => {
            it("string concatenation with +", () => {
                const g = `<Start> = $(x:string) -> x + " world";`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    "hello world",
                ]);
            });

            it("method call: toLowerCase", () => {
                const g = `<Start> = $(x:string) -> x.toLowerCase();`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "HELLO")).toStrictEqual([
                    "hello",
                ]);
            });

            it("method call: toUpperCase", () => {
                const g = `<Start> = $(x:string) -> x.toUpperCase();`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    "HELLO",
                ]);
            });

            it("method call: trim", () => {
                const g = `<Start> = $(x:string) -> x.trim();`;
                const grammar = loadWithExpressions(g);
                // Note: grammar matching trims wildcards by default, so test
                // with a non-wildcard capture.
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    "hello",
                ]);
            });

            it("method call: slice with args", () => {
                const g = `<Start> = $(x:string) -> x.slice(0, 3);`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    "hel",
                ]);
            });

            it("template literal", () => {
                const g = "<Start> = $(name:string) -> `Hello ${name}!`;";
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "world")).toStrictEqual([
                    "Hello world!",
                ]);
            });
        });

        describe("Comparison & Ternary", () => {
            it("ternary with comparison", () => {
                const g = `<Start> = $(x:number) -> x > 0 ? "positive" : "non-positive";`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "5")).toStrictEqual([
                    "positive",
                ]);
                expect(testMatchGrammar(grammar, "0")).toStrictEqual([
                    "non-positive",
                ]);
            });

            it("strict equality", () => {
                const g = `<Start> = $(x:number) -> x === 1 ? "one" : "other";`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "1")).toStrictEqual(["one"]);
                expect(testMatchGrammar(grammar, "2")).toStrictEqual(["other"]);
            });
        });

        describe("Logical Operators", () => {
            it("logical OR with fallback", () => {
                const g = `<Start> = $(x:string) -> x || "default";`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    "hello",
                ]);
            });
        });

        describe("Unary Operators", () => {
            it("typeof returns type string", () => {
                const g = `<Start> = $(x:string) -> typeof x;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    "string",
                ]);
            });

            it("logical NOT", () => {
                const g = `<Start> = hello -> !false;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    true,
                ]);
            });
        });

        describe("Member Access", () => {
            it("string length property", () => {
                const g = `<Start> = $(x:string) -> x.length;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([5]);
            });

            it("bracket access on string", () => {
                const g = `<Start> = $(x:string) -> x[0];`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual(["h"]);
            });
        });

        describe("Complex Expressions", () => {
            it("nested expression in object value", () => {
                const g = `<Start> = $(x:string) -> { name: x.toUpperCase(), len: x.length };`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello")).toStrictEqual([
                    { name: "HELLO", len: 5 },
                ]);
            });

            it("expression with multiple variables", () => {
                const g = `<Start> = $(a:number) plus $(b:number) -> a + b;`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "3 plus 4")).toStrictEqual([
                    7,
                ]);
            });

            it("chained method calls", () => {
                const g = `<Start> = $(x:string) -> x.trim().toLowerCase();`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "HELLO")).toStrictEqual([
                    "hello",
                ]);
            });
        });

        describe("Security", () => {
            it("rejects disallowed method calls at runtime", () => {
                const g = `<Start> = $(x:string) -> x.constructor();`;
                const grammar = loadWithExpressions(g);
                expect(() => testMatchGrammar(grammar, "hello")).toThrow(
                    /not allowed/,
                );
            });

            it("rejects prototype-chain methods at runtime", () => {
                const g = `<Start> = $(x:string) -> x.hasOwnProperty("length");`;
                const grammar = loadWithExpressions(g);
                expect(() => testMatchGrammar(grammar, "hello")).toThrow(
                    /not allowed/,
                );
            });

            it("rejects valueOf at runtime", () => {
                const g = `<Start> = $(x:string) -> x.valueOf();`;
                const grammar = loadWithExpressions(g);
                expect(() => testMatchGrammar(grammar, "hello")).toThrow(
                    /not allowed/,
                );
            });
        });

        describe("Spread", () => {
            it("spread in array flattens elements", () => {
                const g = `<Start> = $(x:string) -> [...x.split(" "), "extra"];`;
                const grammar = loadWithExpressions(g);
                expect(testMatchGrammar(grammar, "hello world")).toStrictEqual([
                    ["hello", "world", "extra"],
                ]);
            });
        });
    },
);

// ── Round-trip Writer Tests ───────────────────────────────────────────────────

describe("Value Expression Round-trip", () => {
    // Helper: parse → write → re-parse → compare ASTs (just the value part)
    function assertRoundTrip(grammar: string) {
        const parsed1 = parseWithExpressions(grammar);
        const written = writeGrammarRules(parsed1);
        const parsed2 = parseWithExpressions(written);
        const v1 = parsed1.definitions[0].rules[0].value;
        const v2 = parsed2.definitions[0].rules[0].value;
        // Strip pos/comments for comparison
        expect(stripAnnotations(v2)).toEqual(stripAnnotations(v1));
    }

    function stripAnnotations(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== "object") return obj;
        if (Array.isArray(obj)) return obj.map(stripAnnotations);
        const result: any = {};
        for (const [k, v] of Object.entries(obj)) {
            if (
                k === "pos" ||
                k === "leadingComments" ||
                k === "trailingComments" ||
                k === "closingComments"
            ) {
                continue;
            }
            result[k] = stripAnnotations(v);
        }
        return result;
    }

    it("arithmetic", () => {
        assertRoundTrip(`<Start> = $(x:number) -> x + 1;`);
    });

    it("ternary", () => {
        assertRoundTrip(
            `<Start> = $(x:number) -> x > 0 ? "positive" : "non-positive";`,
        );
    });

    it("method call", () => {
        assertRoundTrip(`<Start> = $(x:string) -> x.toLowerCase();`);
    });

    it("template literal", () => {
        assertRoundTrip("<Start> = $(x:string) -> `hello ${x}`;");
    });

    it("member access", () => {
        assertRoundTrip(`<Start> = $(x:string) -> x.length;`);
    });

    it("typeof", () => {
        assertRoundTrip(`<Start> = $(x:string) -> typeof x;`);
    });

    it("complex nested", () => {
        assertRoundTrip(
            `<Start> = $(x:string) -> { name: x.toUpperCase(), len: x.length };`,
        );
    });

    // ── Precedence edge cases ─────────────────────────────────────────────
    // These validate that the shared BINARY_PRECEDENCE table in grammarTypes.ts
    // stays in sync with the parser's implicit precedence (function call chain).

    it("left-associativity: a + b + c", () => {
        assertRoundTrip(
            `<Start> = $(a:number) $(b:number) $(c:number) -> a + b + c;`,
        );
    });

    it("left-assoc preserves: (a + b) + c === a + b + c", () => {
        // Left-associative: (a + b) + c should NOT add parens
        const g1 = `<Start> = $(a:number) $(b:number) $(c:number) -> a + b + c;`;
        const g2 = `<Start> = $(a:number) $(b:number) $(c:number) -> (a + b) + c;`;
        const parsed1 = parseWithExpressions(g1);
        const parsed2 = parseWithExpressions(g2);
        // Both should produce the same AST (left-associative)
        expect(stripAnnotations(parsed1.definitions[0].rules[0].value)).toEqual(
            stripAnnotations(parsed2.definitions[0].rules[0].value),
        );
    });

    it("right-associativity required: a + (b + c)", () => {
        assertRoundTrip(
            `<Start> = $(a:number) $(b:number) $(c:number) -> a + (b + c);`,
        );
    });

    it("precedence boundary: * vs +", () => {
        assertRoundTrip(
            `<Start> = $(a:number) $(b:number) $(c:number) -> a + b * c;`,
        );
    });

    it("precedence boundary: + vs ===", () => {
        assertRoundTrip(`<Start> = $(a:number) $(b:number) -> a + b === 5;`);
    });

    it("precedence boundary: && vs ||", () => {
        assertRoundTrip(
            `<Start> = $(a:string) $(b:string) $(c:string) -> a && b || c;`,
        );
    });

    it("precedence boundary: ?? vs ||", () => {
        assertRoundTrip(`<Start> = $(a:string) $(b:string) -> (a ?? b) || b;`);
    });

    it("nested ternary (right-associative)", () => {
        assertRoundTrip(
            `<Start> = $(a:number) -> a > 0 ? a > 10 ? "big" : "small" : "negative";`,
        );
    });

    it("optional call: ?.() round-trips", () => {
        assertRoundTrip(`<Start> = $(x:string) -> x?.toLowerCase();`);
    });
});
