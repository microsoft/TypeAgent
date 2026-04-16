// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammarRules } from "../src/grammarRuleParser.js";
import { escapedSpaces, spaces } from "./testUtils.js";

const testParamGrammarRules = (fileName: string, content: string) =>
    parseGrammarRules(fileName, content, false).definitions;

describe("Grammar Rule Parser", () => {
    describe("Basic Rule Definitions", () => {
        it("a simple rule with string expression", () => {
            const grammar = "<greeting> = hello world;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toEqual([
                {
                    definitionName: { name: "greeting" },
                    rules: [
                        {
                            expressions: [
                                {
                                    type: "string",
                                    value: ["hello", "world"],
                                },
                            ],
                        },
                    ],
                },
            ]);
        });

        it("a rule with multiple alternatives", () => {
            const grammar = "<greeting> = hello | hi | hey;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toHaveLength(1);
            expect(result[0].definitionName.name).toBe("greeting");
            expect(result[0].rules).toHaveLength(3);
            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello"],
            });
            expect(result[0].rules[1].expressions[0]).toEqual({
                type: "string",
                value: ["hi"],
            });
            expect(result[0].rules[2].expressions[0]).toEqual({
                type: "string",
                value: ["hey"],
            });
        });

        it("a rule with value mapping", () => {
            const grammar = '<greeting> = hello -> "greeting";';
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toHaveLength(1);
            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: "greeting",
            });
        });

        it("multiple rule definitions", () => {
            const grammar = `
                <greeting> = hello;
                <farewell> = goodbye;
            `;
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toHaveLength(2);
            expect(result[0].definitionName.name).toBe("greeting");
            expect(result[1].definitionName.name).toBe("farewell");
        });

        it("rule with rule reference", () => {
            const grammar = "<sentence> = <greeting> world;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions).toHaveLength(2);
            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "ruleReference",
                refName: { name: "greeting" },
            });
            expect(result[0].rules[0].expressions[1]).toEqual({
                type: "string",
                value: ["world"],
            });
        });
    });

    describe("Expression Parsing", () => {
        it("variable expressions with default type", () => {
            const grammar = "<rule> = $(name);";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                variableName: { name: "name" },
                ruleReference: false,
            });
        });

        it("variable expressions with specified type", () => {
            const grammar = "<rule> = $(count:number);";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                variableName: { name: "count" },
                refName: { name: "number" },
                ruleReference: false,
            });
        });

        it("variable expressions with rule reference", () => {
            const grammar = "<rule> = $(item:<ItemType>);";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                variableName: { name: "item" },
                refName: { name: "ItemType" },
                ruleReference: true,
            });
        });

        it("variable expressions - optional", () => {
            const grammar = "<rule> = $(item:<ItemType>)?;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                variableName: { name: "item" },
                refName: { name: "ItemType" },
                ruleReference: true,
                optional: true,
            });
        });

        it("group expressions", () => {
            const grammar = "<rule> = (hello | hi) world;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions).toHaveLength(2);
            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "rules",
                rules: [
                    {
                        expressions: [{ type: "string", value: ["hello"] }],
                        value: undefined,
                    },
                    {
                        expressions: [{ type: "string", value: ["hi"] }],
                        value: undefined,
                    },
                ],
            });
        });

        it("optional group expressions", () => {
            const grammar = "<rule> = (please)? help;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "rules",
                rules: [
                    {
                        expressions: [{ type: "string", value: ["please"] }],
                        value: undefined,
                    },
                ],
                optional: true,
            });
        });

        it("Kleene star group expressions ()*", () => {
            const grammar = "<rule> = (um | uh)* help;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "rules",
                rules: [
                    {
                        expressions: [{ type: "string", value: ["um"] }],
                        value: undefined,
                    },
                    {
                        expressions: [{ type: "string", value: ["uh"] }],
                        value: undefined,
                    },
                ],
                optional: true,
                repeat: true,
            });
        });

        it("Kleene plus group expressions )+", () => {
            const grammar = "<rule> = (word)+ end;";
            const result = testParamGrammarRules("test.agr", grammar);

            // repeat: true, optional absent (must match at least once)
            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "rules",
                rules: [
                    {
                        expressions: [{ type: "string", value: ["word"] }],
                        value: undefined,
                    },
                ],
                repeat: true,
            });
            // 'optional' must NOT be set
            expect(
                (result[0].rules[0].expressions[0] as any).optional,
            ).toBeUndefined();
        });

        it("Kleene plus with alternatives )+", () => {
            const grammar = "<rule> = (yes | no)+ done;";
            const result = testParamGrammarRules("test.agr", grammar);

            const group = result[0].rules[0].expressions[0] as any;
            expect(group.type).toBe("rules");
            expect(group.repeat).toBe(true);
            expect(group.optional).toBeUndefined();
            expect(group.rules).toHaveLength(2);
        });

        it("complex expressions with multiple components", () => {
            const grammar = "<rule> = $(action) the <object> $(adverb:string);";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions).toHaveLength(4);
            expect(result[0].rules[0].expressions[0].type).toBe("variable");
            expect(result[0].rules[0].expressions[1]).toEqual({
                type: "string",
                value: ["the"],
            });
            expect(result[0].rules[0].expressions[2].type).toBe(
                "ruleReference",
            );
            expect(result[0].rules[0].expressions[3].type).toBe("variable");
        });

        it("should handle escaped characters in string expressions", () => {
            const grammar = "<rule> = hello\\0world;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello\0world"],
            });
        });
    });

    describe("Value Parsing", () => {
        it("boolean literal values", () => {
            const grammar1 = "<rule> = test -> true;";
            const grammar2 = "<rule> = test -> false;";

            const result1 = testParamGrammarRules("test.agr", grammar1);
            const result2 = testParamGrammarRules("test.agr", grammar2);

            expect(result1[0].rules[0].value).toEqual({
                type: "literal",
                value: true,
            });
            expect(result2[0].rules[0].value).toEqual({
                type: "literal",
                value: false,
            });
        });

        it("float literal values", () => {
            const grammar = "<rule> = test -> 42.5;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 42.5,
            });
        });

        it("integer literal values", () => {
            const grammar = "<rule> = test -> 12;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("integer hex literal values", () => {
            const grammar = "<rule> = test -> 0xC;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("integer oct literal values", () => {
            const grammar = "<rule> = test -> 0o14;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("integer binary literal values", () => {
            const grammar = "<rule> = test -> 0b1100;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("string literal values", () => {
            const grammar1 = '<rule> = test -> "hello world";';
            const grammar2 = "<rule> = test -> 'hello world';";

            const result1 = testParamGrammarRules("test.agr", grammar1);
            const result2 = testParamGrammarRules("test.agr", grammar2);

            expect(result1[0].rules[0].value).toEqual({
                type: "literal",
                value: "hello world",
            });
            expect(result2[0].rules[0].value).toEqual({
                type: "literal",
                value: "hello world",
            });
        });

        it("string values with escape sequences", () => {
            const grammar = '<rule> = test -> "hello\\tworld\\n";';
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: "hello\tworld\n",
            });
        });

        it("array values", () => {
            const grammar = '<rule> = test -> [1, "hello", true];';
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "array",
                value: [
                    { value: { type: "literal", value: 1 } },
                    { value: { type: "literal", value: "hello" } },
                    { value: { type: "literal", value: true } },
                ],
            });
        });

        it("empty array values", () => {
            const grammar = "<rule> = test -> [];";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "array",
                value: [],
            });
        });

        it("object values", () => {
            const grammar = '<rule> = test -> {type: "greeting", count: 1};';
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: [
                    {
                        type: "property",
                        key: "type",
                        value: { type: "literal", value: "greeting" },
                    },
                    {
                        type: "property",
                        key: "count",
                        value: { type: "literal", value: 1 },
                    },
                ],
            });
        });

        it("empty object values", () => {
            const grammar = "<rule> = test -> {};";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: [],
            });
        });

        it("object values with single quote properties", () => {
            const grammar =
                "<rule> = test -> {'type': \"greeting\", 'count': 1};";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: [
                    {
                        type: "property",
                        key: "type",
                        value: { type: "literal", value: "greeting" },
                    },
                    {
                        type: "property",
                        key: "count",
                        value: { type: "literal", value: 1 },
                    },
                ],
            });
        });

        it("object values with double quote properties", () => {
            const grammar =
                '<rule> = test -> {"type": "greeting", "count": 1};';
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: [
                    {
                        type: "property",
                        key: "type",
                        value: { type: "literal", value: "greeting" },
                    },
                    {
                        type: "property",
                        key: "count",
                        value: { type: "literal", value: 1 },
                    },
                ],
            });
        });

        it("variable reference values", () => {
            const grammar = "<rule> = $(name) -> name;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "variable",
                name: "name",
            });
        });

        it("nested object and array values", () => {
            const grammar =
                "<rule> = test -> {items: [1, 2], meta: {count: 2}};";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: [
                    {
                        type: "property",
                        key: "items",
                        value: {
                            type: "array",
                            value: [
                                { value: { type: "literal", value: 1 } },
                                { value: { type: "literal", value: 2 } },
                            ],
                        },
                    },
                    {
                        type: "property",
                        key: "meta",
                        value: {
                            type: "object",
                            value: [
                                {
                                    type: "property",
                                    key: "count",
                                    value: { type: "literal", value: 2 },
                                },
                            ],
                        },
                    },
                ],
            });
        });

        it("should handle nested groups and complex expressions", () => {
            const grammar = `
                <complex> = (please)? ($(action) | do) (the)? $(object) ($(adverb))? -> {
                    politeness,
                    actions: [action, "execute"],
                    target: {
                        name: object,
                        metadata: {
                            hasArticle: true,
                            modifier: adverb
                        }
                    }
                };
            `;

            const result = testParamGrammarRules("nested.agr", grammar);

            expect(result).toEqual([
                {
                    definitionName: { name: "complex" },
                    rules: [
                        {
                            expressions: [
                                {
                                    type: "rules",
                                    rules: [
                                        {
                                            expressions: [
                                                {
                                                    type: "string",
                                                    value: ["please"],
                                                },
                                            ],
                                        },
                                    ],
                                    optional: true,
                                },
                                {
                                    type: "rules",
                                    rules: [
                                        {
                                            expressions: [
                                                {
                                                    type: "variable",
                                                    variableName: {
                                                        name: "action",
                                                    },
                                                    ruleReference: false,
                                                },
                                            ],
                                        },
                                        {
                                            expressions: [
                                                {
                                                    type: "string",
                                                    value: ["do"],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "rules",
                                    rules: [
                                        {
                                            expressions: [
                                                {
                                                    type: "string",
                                                    value: ["the"],
                                                },
                                            ],
                                        },
                                    ],
                                    optional: true,
                                },
                                {
                                    type: "variable",
                                    variableName: {
                                        name: "object",
                                    },
                                    ruleReference: false,
                                },
                                {
                                    type: "rules",
                                    rules: [
                                        {
                                            expressions: [
                                                {
                                                    type: "variable",
                                                    variableName: {
                                                        name: "adverb",
                                                    },
                                                    ruleReference: false,
                                                },
                                            ],
                                        },
                                    ],
                                    optional: true,
                                },
                            ],
                            value: {
                                type: "object",
                                value: [
                                    {
                                        type: "property",
                                        key: "politeness",
                                        value: null,
                                    },
                                    {
                                        type: "property",
                                        key: "actions",
                                        value: {
                                            type: "array",
                                            value: [
                                                {
                                                    value: {
                                                        type: "variable",
                                                        name: "action",
                                                    },
                                                },
                                                {
                                                    value: {
                                                        type: "literal",
                                                        value: "execute",
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                    {
                                        type: "property",
                                        key: "target",
                                        value: {
                                            type: "object",
                                            value: [
                                                {
                                                    type: "property",
                                                    key: "name",
                                                    value: {
                                                        type: "variable",
                                                        name: "object",
                                                    },
                                                },
                                                {
                                                    type: "property",
                                                    key: "metadata",
                                                    value: {
                                                        type: "object",
                                                        value: [
                                                            {
                                                                type: "property",
                                                                key: "hasArticle",
                                                                value: {
                                                                    type: "literal",
                                                                    value: true,
                                                                },
                                                            },
                                                            {
                                                                type: "property",
                                                                key: "modifier",
                                                                value: {
                                                                    type: "variable",
                                                                    name: "adverb",
                                                                },
                                                            },
                                                        ],
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            ]);
        });

        it("grammar with unicode and special characters", () => {
            const grammar = `
                <unicode> = café \\u00E9 -> "café";
                <special> = hello\\tworld\\n -> "formatted";
                <escaped> = \\| \\( \\) -> "escaped";
            `;

            const result = testParamGrammarRules("unicode.agr", grammar);

            expect(result).toHaveLength(3);
            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["café", "é"],
            });
            expect(result[1].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello\tworld\n"],
            });
            expect(result[2].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["|", "(", ")"],
            });
        });
    });

    describe("Whitespace and Comments", () => {
        it("should handle collapse whitespace between tokens", () => {
            const spaces =
                "  \t\v\f\u00a0\ufeff\n\r\u2028\u2029\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000";
            const grammar = `${spaces}<greeting>${spaces}=${spaces}hello${spaces}world${spaces}->${spaces}true${spaces};`;
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toEqual([
                {
                    definitionName: { name: "greeting" },
                    rules: [
                        {
                            expressions: [
                                {
                                    type: "string",
                                    value: ["hello", "world"],
                                },
                            ],
                            value: {
                                type: "literal",
                                value: true,
                            },
                        },
                    ],
                },
            ]);
        });

        it("should keep escaped whitespace in expression", () => {
            const grammar = `<greeting>=${escapedSpaces}hello${escapedSpaces}world${escapedSpaces}->true;`;
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toEqual([
                {
                    definitionName: { name: "greeting" },
                    rules: [
                        {
                            expressions: [
                                {
                                    type: "string",
                                    value: [
                                        `${spaces}hello${spaces}world${spaces}`,
                                    ],
                                },
                            ],
                            value: {
                                type: "literal",
                                value: true,
                            },
                        },
                    ],
                },
            ]);
        });

        it("should handle single-line comments", () => {
            const grammar = `
                // This is a greeting rule
                <greeting> = hello; // End of line comment
                // Another comment
            `;
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result).toHaveLength(1);
            expect(result[0].definitionName.name).toBe("greeting");
        });

        it("should handle multi-line comments", () => {
            const grammar = `
                /*
                 * This is a multi-line comment
                 * describing the greeting rule
                 */
                <greeting> = hello /* inline comment */ world;
            `;
            const result = testParamGrammarRules("test.agr", grammar);

            // Inline block comments become leadingComments on the following expr.
            const exprs = result[0].rules[0].expressions;
            expect(exprs).toHaveLength(2);
            expect(exprs[0]).toEqual({ type: "string", value: ["hello"] });
            expect(exprs[1]).toMatchObject({
                type: "string",
                value: ["world"],
                leadingComments: [{ style: "block", text: " inline comment " }],
            });
        });

        it("should handle mixed whitespace types", () => {
            const grammar = "<rule>\t=\r\nhello\n\t world;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello", "world"],
            });
        });

        it("should collapse multiple whitespace in strings to single space", () => {
            const grammar = "<rule> = hello     world\t\t\ttest;";
            const result = testParamGrammarRules("test.agr", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello", "world", "test"],
            });
        });

        it("should handle comments in values", () => {
            const grammar = `
                <rule> = test -> {
                    // Property comment
                    type: "greeting", /* inline */
                    count: 1
                };
            `;
            const result = testParamGrammarRules("test.agr", grammar);

            // "// Property comment" starts on its own line → leadingComments on "type".
            // "/* inline */" is on the same line as the comma → trailingComment on "type".
            // "count" gets no leadingComments.
            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: [
                    {
                        type: "property",
                        key: "type",
                        value: { type: "literal", value: "greeting" },
                        leadingComments: [
                            { style: "line", text: " Property comment" },
                        ],
                        trailingComments: [
                            { style: "block", text: " inline " },
                        ],
                    },
                    {
                        type: "property",
                        key: "count",
                        value: { type: "literal", value: 1 },
                    },
                ],
            });
        });

        describe("Value node comments", () => {
            it("should preserve block comment after ':' as leadingComments on object property value", () => {
                const grammar = `<rule> = test -> { type: /* before */ "greeting" };`;
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props.find((p: any) => p.key === "type").value).toEqual({
                    type: "literal",
                    value: "greeting",
                    leadingComments: [{ style: "block", text: " before " }],
                });
            });

            it("should preserve line comment after ':' as leadingComments on object property value", () => {
                const grammar =
                    '<rule> = test -> {\n    type: // before\n    "greeting"\n};';
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props.find((p: any) => p.key === "type").value).toEqual({
                    type: "literal",
                    value: "greeting",
                    leadingComments: [{ style: "line", text: " before" }],
                });
            });

            it("should preserve block comment after property value as trailingComments", () => {
                const grammar = `<rule> = test -> { type: "greeting" /* after */ };`;
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props.find((p: any) => p.key === "type").value).toEqual({
                    type: "literal",
                    value: "greeting",
                    trailingComments: [{ style: "block", text: " after " }],
                });
            });

            it("should preserve line comment after property value as trailingComments", () => {
                const grammar = "<rule> = test -> {\n    count: 1 // after\n};";
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props.find((p: any) => p.key === "count").value).toEqual(
                    {
                        type: "literal",
                        value: 1,
                        trailingComments: [{ style: "line", text: " after" }],
                    },
                );
            });

            it("should preserve block comment after '[' as leadingComments on first array element", () => {
                const grammar = `<rule> = test -> [/* first */ "a", "b"];`;
                const result = testParamGrammarRules("test.agr", grammar);

                const arr = (result[0].rules[0].value as any).value;
                expect(arr[0]).toEqual({
                    value: {
                        type: "literal",
                        value: "a",
                        leadingComments: [{ style: "block", text: " first " }],
                    },
                });
                expect(arr[1]).toEqual({
                    value: { type: "literal", value: "b" },
                });
            });

            it("should capture block comment after ',' as leadingComment on next element when followed by non-comment token", () => {
                // "a", /* second */ "b" — the comment is on the same line as "b",
                // so it becomes leadingComments on the ArrayElement for "b".
                const grammar = `<rule> = test -> ["a", /* second */ "b"];`;
                const result = testParamGrammarRules("test.agr", grammar);

                const arr = (result[0].rules[0].value as any).value;
                expect(arr[0]).toEqual({
                    value: { type: "literal", value: "a" },
                });
                expect(arr[1]).toEqual({
                    value: {
                        type: "literal",
                        value: "b",
                        leadingComments: [{ style: "block", text: " second " }],
                    },
                });
            });

            it("should preserve same-line line comment after ',' as trailingComment on that element", () => {
                // "a", // first\n"b" — the comment is on the same line as the comma,
                // so it becomes trailingComment on the ArrayElement for "a".
                const grammar =
                    '<rule> = test -> [\n    "a", // first\n    "b"\n];';
                const result = testParamGrammarRules("test.agr", grammar);

                const arr = (result[0].rules[0].value as any).value;
                expect(arr[0]).toEqual({
                    value: { type: "literal", value: "a" },
                    trailingComments: [{ style: "line", text: " first" }],
                });
                expect(arr[1]).toEqual({
                    value: { type: "literal", value: "b" },
                });
            });

            it("should preserve block comment before ',' as trailingComments on the value", () => {
                // "a" /* trailing */, "b" — comment is BEFORE the comma, so it is
                // trailingComments on the value node inside the ArrayElement for "a".
                const grammar = `<rule> = test -> ["a" /* trailing */, "b"];`;
                const result = testParamGrammarRules("test.agr", grammar);

                const arr = (result[0].rules[0].value as any).value;
                expect(arr[0]).toEqual({
                    value: {
                        type: "literal",
                        value: "a",
                        trailingComments: [
                            { style: "block", text: " trailing " },
                        ],
                    },
                });
                expect(arr[1]).toEqual({
                    value: { type: "literal", value: "b" },
                });
            });

            it("should capture comments after '{' as leadingComments on the first ObjectProperty", () => {
                // Comments after "{" precede the first property key and are now
                // preserved as leadingComments on that ObjectProperty.
                const grammar = `<rule> = test -> { /* after-brace */ type: "greeting" };`;
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props[0].leadingComments).toEqual([
                    { style: "block", text: " after-brace " },
                ]);
                // The value node itself has no leadingComments.
                expect(props[0].value.leadingComments).toBeUndefined();
            });

            it("should capture /* */ comment after ',' as leadingComment on next property when followed by non-comment token", () => {
                // "/* between */" is on the same line as "count" → leadingComments
                // on the following property, not trailingComment on the preceding one.
                const grammar = `<rule> = test -> { type: "greeting", /* between */ count: 1 };`;
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                const typeProp = props.find((p: any) => p.key === "type");
                expect(typeProp.trailingComments).toBeUndefined();
                const countProp = props.find((p: any) => p.key === "count");
                expect(countProp.leadingComments).toEqual([
                    { style: "block", text: " between " },
                ]);
                // The value node itself has no leadingComments.
                expect(countProp.value.leadingComments).toBeUndefined();
            });

            it("should capture // line comment after ',' as trailingComment on the property", () => {
                // "greeting", // note\n  count — the // comment is on the same
                // line as the comma, so it becomes trailingComment on "type".
                // "count" gets no leadingComments.
                const grammar =
                    '<rule> = test -> { type: "greeting", // note\n   count: 1 };';
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props[0].trailingComments).toEqual([
                    { style: "line", text: " note" },
                ]);
                expect(props[1].leadingComments).toBeUndefined();
            });

            it("should distinguish // trailing from /* */ leading when both present", () => {
                // "greeting", // trailing\n  /* leading */ count — // goes to
                // trailingComment on "type", /* */ goes to leadingComments on "count".
                const grammar =
                    '<rule> = test -> { type: "greeting", // trailing\n   /* leading */ count: 1 };';
                const result = testParamGrammarRules("test.agr", grammar);

                const props = (result[0].rules[0].value as any).value;
                expect(props[0].trailingComments).toEqual([
                    { style: "line", text: " trailing" },
                ]);
                expect(props[1].leadingComments).toEqual([
                    { style: "block", text: " leading " },
                ]);
            });

            // ── Trailing comma ────────────────────────────────────────────────

            it("should accept trailing comma in array", () => {
                const grammar = `<rule> = test -> ["a", "b",];`;
                const result = testParamGrammarRules("test.agr", grammar);
                const arr = (result[0].rules[0].value as any).value;
                expect(arr).toHaveLength(2);
                expect(arr[0]).toEqual({
                    value: { type: "literal", value: "a" },
                });
                expect(arr[1]).toEqual({
                    value: { type: "literal", value: "b" },
                });
            });

            it("should accept trailing comma in object", () => {
                const grammar = `<rule> = test -> { type: "greeting", count: 1, };`;
                const result = testParamGrammarRules("test.agr", grammar);
                const props = (result[0].rules[0].value as any).value;
                expect(props).toHaveLength(2);
                expect(props[0].key).toBe("type");
                expect(props[1].key).toBe("count");
            });

            it("should capture comments after trailing ',' as closingComments on array", () => {
                const grammar =
                    '<rule> = test -> [\n    "a",\n    /* footer */\n];';
                const result = testParamGrammarRules("test.agr", grammar);
                const node = result[0].rules[0].value as any;
                expect(node.value).toHaveLength(1);
                expect(node.closingComments).toEqual([
                    { style: "block", text: " footer " },
                ]);
            });

            it("should capture comments after trailing ',' as closingComments on object", () => {
                const grammar =
                    '<rule> = test -> {\n    type: "greeting",\n    /* footer */\n};';
                const result = testParamGrammarRules("test.agr", grammar);
                const node = result[0].rules[0].value as any;
                expect(node.value).toHaveLength(1);
                expect(node.closingComments).toEqual([
                    { style: "block", text: " footer " },
                ]);
            });

            it("should capture comments inside empty array as closingComments", () => {
                const grammar = `<rule> = test -> [/* empty */];`;
                const result = testParamGrammarRules("test.agr", grammar);
                const node = result[0].rules[0].value as any;
                expect(node.value).toHaveLength(0);
                expect(node.closingComments).toEqual([
                    { style: "block", text: " empty " },
                ]);
            });

            it("should capture comments inside empty object as closingComments", () => {
                const grammar = `<rule> = test -> {/* empty */};`;
                const result = testParamGrammarRules("test.agr", grammar);
                const node = result[0].rules[0].value as any;
                expect(node.value).toHaveLength(0);
                expect(node.closingComments).toEqual([
                    { style: "block", text: " empty " },
                ]);
            });
        });

        it("should preserve // comment as leadingComment at start of expression", () => {
            const grammar = "<rule> = //leading\nworld;";
            const result = testParamGrammarRules("test.agr", grammar);

            const exprs = result[0].rules[0].expressions;
            expect(exprs).toHaveLength(1);
            expect(exprs[0]).toMatchObject({
                type: "string",
                value: ["world"],
                leadingComments: [{ style: "line", text: "leading" }],
            });
        });

        it("should preserve // comment as leadingComment at start of alternative", () => {
            const grammar = "<rule> = x\n| //leading\ny;";
            const result = testParamGrammarRules("test.agr", grammar);

            const exprs = result[0].rules[1].expressions;
            expect(exprs).toHaveLength(1);
            expect(exprs[0]).toMatchObject({
                type: "string",
                value: ["y"],
                leadingComments: [{ style: "line", text: "leading" }],
            });
        });

        it("should preserve // comment as leadingComment on following expr", () => {
            const grammar = "<rule> = hello//comment\nworld;";
            const result = testParamGrammarRules("test.agr", grammar);

            const exprs = result[0].rules[0].expressions;
            expect(exprs).toHaveLength(2);
            expect(exprs[0]).toEqual({ type: "string", value: ["hello"] });
            expect(exprs[1]).toMatchObject({
                type: "string",
                value: ["world"],
                leadingComments: [{ style: "line", text: "comment" }],
            });
        });

        it("should preserve /* */ comment as leadingComment on following expr", () => {
            const grammar = "<rule> = hello/*comment*/world;";
            const result = testParamGrammarRules("test.agr", grammar);

            const exprs = result[0].rules[0].expressions;
            expect(exprs).toHaveLength(2);
            expect(exprs[0]).toEqual({ type: "string", value: ["hello"] });
            expect(exprs[1]).toMatchObject({
                type: "string",
                value: ["world"],
                leadingComments: [{ style: "block", text: "comment" }],
            });
        });

        it("should preserve multiple consecutive comments as leadingComments on following expr", () => {
            const grammar = "<rule> = hello//c1\n//c2\nworld;";
            const result = testParamGrammarRules("test.agr", grammar);

            const exprs = result[0].rules[0].expressions;
            expect(exprs).toHaveLength(2);
            expect(exprs[0]).toEqual({ type: "string", value: ["hello"] });
            expect(exprs[1]).toMatchObject({
                type: "string",
                value: ["world"],
                leadingComments: [
                    { style: "line", text: "c1" },
                    { style: "line", text: "c2" },
                ],
            });
        });

        it("should preserve mixed comment styles as leadingComments on following expr", () => {
            const grammar = "<rule> = hello//line\n/*block*/world;";
            const result = testParamGrammarRules("test.agr", grammar);

            const exprs = result[0].rules[0].expressions;
            expect(exprs).toHaveLength(2);
            expect(exprs[0]).toEqual({ type: "string", value: ["hello"] });
            expect(exprs[1]).toMatchObject({
                type: "string",
                value: ["world"],
                leadingComments: [
                    { style: "line", text: "line" },
                    { style: "block", text: "block" },
                ],
            });
        });

        it("should capture full text of // comment at EOF without trailing newline", () => {
            // Regression: the old parseComment used `this.curr - 1` to strip the
            // newline, but when no newline exists skipAfter sets curr = content.length,
            // so `curr - 1` silently dropped the last character of the comment text.
            const result = parseGrammarRules(
                "test.agr",
                "// leading comment at eof",
                false,
            );
            expect(result.leadingComments).toEqual([
                { style: "line", text: " leading comment at eof" },
            ]);

            const result2 = parseGrammarRules(
                "test.agr",
                "<rule> = foo; // trailing",
                false,
            );
            expect(result2.definitions[0].trailingComments).toEqual([
                { style: "line", text: " trailing" },
            ]);
        });
    });

    describe("Error Handling", () => {
        it("should throw error for missing rule terminator", () => {
            const grammar = "<greeting> = hello";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "';' expected",
            );
        });

        it("should throw error for malformed rule name", () => {
            const grammar = "greeting = hello;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Expected rule definition or 'import' statement",
            );
        });

        it("should throw error for missing equals sign", () => {
            const grammar = "<greeting> hello;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "'=' expected",
            );
        });

        it("should throw error for unterminated string literal", () => {
            const grammar = '<rule> = test -> "unterminated';
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Unterminated string literal",
            );
        });

        it("should throw error for unterminated variable", () => {
            const grammar = "<rule> = $(name;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "')' expected",
            );
        });

        it("should throw error for unterminated group", () => {
            const grammar = "<rule> = (hello;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "')' expected",
            );
        });

        it("should throw error for invalid escape sequence", () => {
            const grammar = '<rule> = test -> "invalid\\';
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Missing escaped character.",
            );
        });

        it("should throw error for invalid hex escape", () => {
            const grammar = '<rule> = test -> "\\xZZ";';
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Invalid hex escape sequence",
            );
        });

        it("should throw error for invalid unicode escape", () => {
            const grammar = '<rule> = test -> "\\uZZZZ";';
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Invalid Unicode escape sequence",
            );
        });

        it("should throw error for unterminated array", () => {
            const grammar = "<rule> = test -> [1, 2";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Unexpected end of file in array value",
            );
        });

        it("should throw error for unterminated object", () => {
            const grammar = '<rule> = test -> {type: "test"';
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Unexpected end of file in object value",
            );
        });

        it("should throw error for missing colon in object", () => {
            const grammar = '<rule> = test -> {type "test"};';
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "':' expected",
            );
        });

        it("should throw error for invalid number", () => {
            const grammar = "<rule> = test -> 1abc;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Invalid literal",
            );
        });

        it("should throw error for infinity values", () => {
            const grammar = "<rule> = test -> Infinity;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Infinity values are not allowed",
            );
        });

        it("should throw error for unescaped special characters", () => {
            const grammar = "<rule> = hello-world;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Special character needs to be escaped",
            );
        });

        it("should throw error for empty expression", () => {
            const grammar = "<rule> = ;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Empty expression",
            );
        });

        it("should throw error for expression with only comments", () => {
            const grammar = "<rule> = // just a comment\n;";
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                "Empty expression",
            );
        });

        it("should include line and column information in errors", () => {
            const grammar = `
                <valid> = hello;
                invalid = world;
            `;
            expect(() => testParamGrammarRules("test.agr", grammar)).toThrow(
                /test\.agr:\d+:\d+:/,
            );
        });
    });

    describe("Spacing Annotation", () => {
        it("attaches spacingMode optional via annotation", () => {
            const result = testParamGrammarRules(
                "test.agr",
                `<Rule> [spacing=optional] = hello;`,
            );
            expect(result).toHaveLength(1);
            expect(result[0].spacingMode).toBe("optional");
        });

        it("attaches spacingMode required via annotation", () => {
            const result = testParamGrammarRules(
                "test.agr",
                `<Rule> [spacing=required] = hello;`,
            );
            expect(result[0].spacingMode).toBe("required");
        });

        it("attaches spacingMode auto via explicit annotation (stored as 'auto')", () => {
            const result = testParamGrammarRules(
                "test.agr",
                `<Rule> [spacing=auto] = hello;`,
            );
            // Explicit [spacing=auto] annotation is stored as "auto" (distinct from no annotation = undefined).
            expect(result[0].spacingMode).toBe("auto");
        });

        it("attaches spacingMode none via annotation", () => {
            const result = testParamGrammarRules(
                "test.agr",
                `<Rule> [spacing=none] = hello;`,
            );
            expect(result[0].spacingMode).toBe("none");
        });

        it("rule without annotation has undefined spacingMode", () => {
            const result = testParamGrammarRules("test.agr", `<Rule> = hello;`);
            expect(result[0].spacingMode).toBeUndefined();
        });

        it("each rule carries its own independently declared mode", () => {
            const result = testParamGrammarRules(
                "test.agr",
                `<A> [spacing=optional] = a;
                 <B> [spacing=required] = b;
                 <C> = c;`,
            );
            expect(result[0].spacingMode).toBe("optional");
            expect(result[1].spacingMode).toBe("required");
            // "auto" is the default; stored as undefined
            expect(result[2].spacingMode).toBeUndefined();
        });

        it("throws on unknown annotation key", () => {
            expect(() =>
                testParamGrammarRules(
                    "test.agr",
                    `<Rule> [unknown=auto] = hello;`,
                ),
            ).toThrow("Unknown rule annotation");
        });

        it("throws on invalid spacing value", () => {
            expect(() =>
                testParamGrammarRules(
                    "test.agr",
                    `<Rule> [spacing=never] = hello;`,
                ),
            ).toThrow("Invalid value");
        });

        it("throws when '=' is missing in annotation", () => {
            expect(() =>
                testParamGrammarRules(
                    "test.agr",
                    `<Rule> [spacing required] = hello;`,
                ),
            ).toThrow("'=' expected in spacing annotation");
        });

        it("throws when ']' is missing in annotation", () => {
            expect(() =>
                testParamGrammarRules(
                    "test.agr",
                    `<Rule> [spacing=required = hello;`,
                ),
            ).toThrow("']' expected at end of spacing annotation");
        });

        it("throws on unterminated block comment at EOF", () => {
            expect(() =>
                testParamGrammarRules("test.agr", `<A> = hello; /* oops`),
            ).toThrow("Unterminated");
        });

        it("throws on unterminated block comment mid-file", () => {
            expect(() =>
                testParamGrammarRules("test.agr", `<A> = /* never closed`),
            ).toThrow("Unterminated");
        });

        it("throws on invalid per-alternate spacing value", () => {
            expect(() =>
                testParamGrammarRules(
                    "test.agr",
                    `<Rule> = hello | [spacing=never] world;`,
                ),
            ).toThrow("Invalid value");
        });

        it("throws on unknown per-alternate annotation key", () => {
            expect(() =>
                testParamGrammarRules(
                    "test.agr",
                    `<Rule> = hello | [unknown=auto] world;`,
                ),
            ).toThrow("Unknown rule annotation");
        });
    });

    describe("Value Type Annotation", () => {
        it("parses value type", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `<Rule> : MyType = hello;`,
            );
            expect(defs[0].valueType?.map((v) => v.name)).toEqual(["MyType"]);
        });
        it("parses value type with spacing annotation", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `<Rule> [spacing=required] : MyType = hello;`,
            );
            expect(defs[0].spacingMode).toBe("required");
            expect(defs[0].valueType?.map((v) => v.name)).toEqual(["MyType"]);
        });
        it("parses value type with export", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `export <Rule> : MyType = hello;`,
            );
            expect(defs[0].exported).toBe(true);
            expect(defs[0].valueType?.map((v) => v.name)).toEqual(["MyType"]);
        });
        it("parses export with spacing and value type", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `export <Rule> [spacing=required] : MyType = hello;`,
            );
            expect(defs[0].exported).toBe(true);
            expect(defs[0].spacingMode).toBe("required");
            expect(defs[0].valueType?.map((v) => v.name)).toEqual(["MyType"]);
        });
        it("rule without value type has undefined valueType", () => {
            const defs = testParamGrammarRules("test.agr", `<Rule> = hello;`);
            expect(defs[0].valueType).toBeUndefined();
        });
        it("parses union value type", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `<Rule> : TypeA | TypeB = hello;`,
            );
            expect(defs[0].valueType?.map((v) => v.name)).toEqual([
                "TypeA",
                "TypeB",
            ]);
        });
        it("parses three-way union value type", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `<Rule> : A | B | C = hello;`,
            );
            expect(defs[0].valueType?.map((v) => v.name)).toEqual([
                "A",
                "B",
                "C",
            ]);
        });
        it("parses union value type with spacing and export", () => {
            const defs = testParamGrammarRules(
                "test.agr",
                `export <Rule> [spacing=required] : A | B = hello;`,
            );
            expect(defs[0].exported).toBe(true);
            expect(defs[0].spacingMode).toBe("required");
            expect(defs[0].valueType?.map((v) => v.name)).toEqual(["A", "B"]);
        });
    });

    describe("Complex Integration", () => {
        it("should handle deeply nested value structures", () => {
            const grammar = `
                <nested> = test -> {
                    config: {
                        settings: [
                            {name: "debug", value: true},
                            {name: "timeout", value: 30}
                        ],
                        metadata: {
                            version: "1.0",
                            features: ["async", "cache"]
                        }
                    },
                    variables: [param1, param2]
                };
            `;

            const result = testParamGrammarRules("deeply-nested.agr", grammar);

            const value = result[0].rules[0].value as any;
            expect(value.type).toBe("object");
            const configProp = value.value.find((p: any) => p.key === "config");
            expect(configProp.value.type).toBe("object");
            const settingsProp = configProp.value.value.find(
                (p: any) => p.key === "settings",
            );
            expect(settingsProp.value.type).toBe("array");
            const variablesProp = value.value.find(
                (p: any) => p.key === "variables",
            );
            expect(variablesProp.value.value).toHaveLength(2);
        });

        it("real-world conversation patterns", () => {
            const grammar = `
                // Weather queries
                <weather> = (what's | what is) the weather (like)? (in $(location))? -> {
                    intent: "weather.query",
                    location,
                    type: "current"
                };

                // Calendar operations
                <calendar> = (schedule | book) (a)? $(event) (for | on) $(date) (at $(time))? -> {
                    intent: "calendar.create",
                    event: {
                        title: event,
                        date,
                        time
                    }
                };

                // Music control
                <music> = (play | start) $(song)? (by $(artist))? -> {
                    intent: "music.play",
                    query: {
                        song,
                        artist
                    },
                    shuffle: false
                };
            `;

            const result = testParamGrammarRules("conversation.agr", grammar);

            expect(result).toHaveLength(3);

            // Verify each intent has proper structure
            result.forEach((rule) => {
                expect(rule.definitionName.name).toMatch(
                    /^(weather|calendar|music)$/,
                );
                expect(rule.rules[0].value).toBeDefined();
                const value = rule.rules[0].value as any;
                expect(value.type).toBe("object");
                expect(
                    value.value.find((p: any) => p.key === "intent"),
                ).toBeDefined();
            });
        });
    });

    describe("Import Statements", () => {
        it("parse granular import statement", () => {
            const grammar = 'import { Name1, Name2 } from "file.agr";';
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.imports).toHaveLength(1);
            expect(result.imports[0].names).toEqual([
                { name: "Name1" },
                { name: "Name2" },
            ]);
            expect(result.imports[0].source).toBe("file.agr");
        });

        it("parse wildcard import statement", () => {
            const grammar = 'import * from "file.agr";';
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.imports).toHaveLength(1);
            expect(result.imports[0].names).toBe("*");
            expect(result.imports[0].source).toBe("file.agr");
        });

        it("parse multiple import statements", () => {
            const grammar = `
                import { Action1, Action2 } from "actions.agr";
                import * from "types.ts";
                import { Helper } from "helpers.agr";
            `;
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.imports).toHaveLength(3);
            expect(result.imports[0].names).toEqual([
                { name: "Action1" },
                { name: "Action2" },
            ]);
            expect(result.imports[0].source).toBe("actions.agr");
            expect(result.imports[1].names).toBe("*");
            expect(result.imports[1].source).toBe("types.ts");
            expect(result.imports[2].names).toEqual([{ name: "Helper" }]);
            expect(result.imports[2].source).toBe("helpers.agr");
        });

        it("parse imports with grammar rules", () => {
            const grammar = `
                import { BaseRule } from "base.agr";

                <Start> = <BaseRule> world;
                <BaseRule> = hello;
            `;
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.imports).toHaveLength(1);
            expect(result.imports[0].names).toEqual([{ name: "BaseRule" }]);
            expect(result.definitions).toHaveLength(2);
            expect(result.definitions[0].definitionName.name).toBe("Start");
            expect(result.definitions[1].definitionName.name).toBe("BaseRule");
        });

        it("parse single name import", () => {
            const grammar = 'import { SingleName } from "file.agr";';
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.imports).toHaveLength(1);
            expect(result.imports[0].names).toEqual([{ name: "SingleName" }]);
            expect(result.imports[0].source).toBe("file.agr");
        });

        it("preserves block comments inside braces before/after names", () => {
            const grammar =
                'import { /* A */ Name1 /* B */, /* C */ Name2 /* D */ } from "file.agr";';
            const result = parseGrammarRules("test.agr", grammar, false);
            const names = result.imports[0].names;
            expect(names).not.toBe("*");
            if (names !== "*") {
                expect(names[0].leadingComments).toEqual([
                    { style: "block", text: " A " },
                ]);
                expect(names[0].trailingComments).toEqual([
                    { style: "block", text: " B " },
                ]);
                expect(names[1].leadingComments).toEqual([
                    { style: "block", text: " C " },
                ]);
                expect(names[1].trailingComments).toEqual([
                    { style: "block", text: " D " },
                ]);
            }
        });

        it("preserves block comments after 'import' keyword and after closing brace", () => {
            const grammar =
                'import /* after-import */ { Name1 } /* after-brace */ from "file.agr";';
            const result = parseGrammarRules("test.agr", grammar, false);
            expect(result.imports[0].afterImportComments).toEqual([
                { style: "block", text: " after-import " },
            ]);
            expect(result.imports[0].afterCloseBraceComments).toEqual([
                { style: "block", text: " after-brace " },
            ]);
        });
    });

    describe("Export Keyword on Rule Definitions", () => {
        it("parse exported rule definition", () => {
            const grammar = "export <Rule1> = hello;";
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.definitions).toHaveLength(1);
            expect(result.definitions[0].exported).toBe(true);
            expect(result.definitions[0].definitionName.name).toBe("Rule1");
        });

        it("non-exported rule has no exported flag", () => {
            const grammar = "<Rule1> = hello;";
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.definitions).toHaveLength(1);
            expect(result.definitions[0].exported).toBeUndefined();
        });

        it("parse multiple rules with mixed export", () => {
            const grammar = `
                export <Rule1> = hello;
                <Rule2> = world;
                export <Rule3> = foo;
            `;
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.definitions).toHaveLength(3);
            expect(result.definitions[0].exported).toBe(true);
            expect(result.definitions[0].definitionName.name).toBe("Rule1");
            expect(result.definitions[1].exported).toBeUndefined();
            expect(result.definitions[1].definitionName.name).toBe("Rule2");
            expect(result.definitions[2].exported).toBe(true);
            expect(result.definitions[2].definitionName.name).toBe("Rule3");
        });

        it("export with imports and rules", () => {
            const grammar = `
                import { BaseRule } from "base.agr";
                export <Start> = <BaseRule> world;
            `;
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.imports).toHaveLength(1);
            expect(result.definitions).toHaveLength(1);
            expect(result.definitions[0].exported).toBe(true);
        });

        it("preserves comment between export keyword and rule name", () => {
            const grammar = "export /* after-export */ <Rule1> = hello;";
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.definitions[0].exported).toBe(true);
            expect(result.definitions[0].afterExportComments).toEqual([
                { style: "block", text: " after-export " },
            ]);
        });

        it("preserves leading comment before export keyword", () => {
            const grammar =
                "<Rule0> = world;\n// leading\nexport <Rule1> = hello;";
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.definitions[1].exported).toBe(true);
            expect(result.definitions[1].leadingComments).toEqual([
                { style: "line", text: " leading" },
            ]);
        });

        it("exported rule with spacing annotation", () => {
            const grammar = "export <Rule1> [spacing=required] = hello;";
            const result = parseGrammarRules("test.agr", grammar, false);

            expect(result.definitions[0].exported).toBe(true);
            expect(result.definitions[0].spacingMode).toBe("required");
        });

        it("throws when export is not followed by rule definition", () => {
            expect(() =>
                parseGrammarRules("test.agr", "export hello;", false),
            ).toThrow();
        });
    });

    describe("Comment preservation at structural positions", () => {
        it("preserves block comment inside rule name angle brackets", () => {
            const result = parseGrammarRules(
                "test.agr",
                `</*A*/Rule/*B*/> = hello;`,
                false,
            );
            expect(
                result.definitions[0].definitionName.leadingComments,
            ).toEqual([{ style: "block", text: "A" }]);
            expect(
                result.definitions[0].definitionName.trailingComments,
            ).toEqual([{ style: "block", text: "B" }]);
        });

        it("preserves block comments in [spacing=...] annotation", () => {
            const result = parseGrammarRules(
                "test.agr",
                `<Rule> [/*a*/spacing/*b*/=/*c*/required/*d*/] = hello;`,
                false,
            );
            const def = result.definitions[0];
            expect(def.spacingMode).toBe("required");
            expect(def.spacingAnnotationComments?.afterBracket).toEqual([
                { style: "block", text: "a" },
            ]);
            expect(def.spacingAnnotationComments?.afterKey).toEqual([
                { style: "block", text: "b" },
            ]);
            expect(def.spacingAnnotationComments?.afterEquals).toEqual([
                { style: "block", text: "c" },
            ]);
            expect(def.spacingAnnotationComments?.afterValue).toEqual([
                { style: "block", text: "d" },
            ]);
        });

        it("preserves block comment between $( and variable name", () => {
            const result = parseGrammarRules(
                "test.agr",
                `<Rule> = $(/*c*/x);`,
                false,
            );
            const expr = result.definitions[0].rules[0]
                .expressions[0] as import("../src/grammarRuleParser.js").VarDefExpr;
            expect(expr.variableName.leadingComments).toEqual([
                { style: "block", text: "c" },
            ]);
        });

        it("preserves block comment after colon in variable specifier", () => {
            const result = parseGrammarRules(
                "test.agr",
                `<Rule> = $(x:/*c*/string);`,
                false,
            );
            const expr = result.definitions[0].rules[0]
                .expressions[0] as import("../src/grammarRuleParser.js").VarDefExpr;
            expect(expr.colonComments).toEqual([{ style: "block", text: "c" }]);
        });

        it("preserves block comment after plain type name in variable specifier", () => {
            const result = parseGrammarRules(
                "test.agr",
                `<Rule> = $(x:string/*c*/);`,
                false,
            );
            const expr = result.definitions[0].rules[0]
                .expressions[0] as import("../src/grammarRuleParser.js").VarDefExpr;
            expect(expr.refName?.name).toEqual("string");
            expect(expr.refName?.trailingComments).toEqual([
                { style: "block", text: "c" },
            ]);
        });

        it("preserves block comment inside rule reference in variable type", () => {
            const result = parseGrammarRules(
                "test.agr",
                `<Rule> = $(x:</*a*/Inner/*b*/>);`,
                false,
            );
            const expr = result.definitions[0].rules[0]
                .expressions[0] as import("../src/grammarRuleParser.js").VarDefExpr;
            expect(expr.refName?.leadingComments).toEqual([
                { style: "block", text: "a" },
            ]);
            expect(expr.refName?.trailingComments).toEqual([
                { style: "block", text: "b" },
            ]);
        });

        it("preserves block comment inside inline rule reference angle brackets", () => {
            const result = parseGrammarRules(
                "test.agr",
                `<Rule> = </*a*/Other/*b*/>;`,
                false,
            );
            const expr = result.definitions[0].rules[0]
                .expressions[0] as import("../src/grammarRuleParser.js").RuleRefExpr;
            expect(expr.refName.leadingComments).toEqual([
                { style: "block", text: "a" },
            ]);
            expect(expr.refName.trailingComments).toEqual([
                { style: "block", text: "b" },
            ]);
        });
    });
});
