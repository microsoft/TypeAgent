// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammar } from "../src/grammarParser.js";
import { escapedSpaces, spaces } from "./testUtils.js";

describe("Grammar Parser", () => {
    describe("Basic Rule Definitions", () => {
        it("a simple rule with string expression", () => {
            const grammar = "@<greeting> = hello world";
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toEqual([
                {
                    name: "greeting",
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
            const grammar = "@<greeting> = hello | hi | hey";
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("greeting");
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
            const grammar = '@<greeting> = hello -> "greeting"';
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toHaveLength(1);
            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: "greeting",
            });
        });

        it("multiple rule definitions", () => {
            const grammar = `
                @<greeting> = hello
                @<farewell> = goodbye
            `;
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("greeting");
            expect(result[1].name).toBe("farewell");
        });

        it("rule with rule reference", () => {
            const grammar = "@<sentence> = <greeting> world";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions).toHaveLength(2);
            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "ruleReference",
                name: "greeting",
            });
            expect(result[0].rules[0].expressions[1]).toEqual({
                type: "string",
                value: ["world"],
            });
        });
    });

    describe("Expression Parsing", () => {
        it("variable expressions with default type", () => {
            const grammar = "@<rule> = $(name)";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                name: "name",
                typeName: "string",
                ruleReference: false,
            });
        });

        it("variable expressions with specified type", () => {
            const grammar = "@<rule> = $(count:number)";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                name: "count",
                typeName: "number",
                ruleReference: false,
            });
        });

        it("variable expressions with rule reference", () => {
            const grammar = "@<rule> = $(item:<ItemType>)";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "variable",
                name: "item",
                typeName: "ItemType",
                ruleReference: true,
            });
        });

        it("group expressions", () => {
            const grammar = "@<rule> = (hello | hi) world";
            const result = parseGrammar("test.grammar", grammar);

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
            const grammar = "@<rule> = (please)? help";
            const result = parseGrammar("test.grammar", grammar);

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

        it("complex expressions with multiple components", () => {
            const grammar = "@<rule> = $(action) the <object> $(adverb:string)";
            const result = parseGrammar("test.grammar", grammar);

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
            const grammar = "@<rule> = hello\\0world";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello\0world"],
            });
        });
    });

    describe("Value Parsing", () => {
        it("boolean literal values", () => {
            const grammar1 = "@<rule> = test -> true";
            const grammar2 = "@<rule> = test -> false";

            const result1 = parseGrammar("test.grammar", grammar1);
            const result2 = parseGrammar("test.grammar", grammar2);

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
            const grammar = "@<rule> = test -> 42.5";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 42.5,
            });
        });

        it("integer literal values", () => {
            const grammar = "@<rule> = test -> 12";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("integer hex literal values", () => {
            const grammar = "@<rule> = test -> 0xC";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("integer oct literal values", () => {
            const grammar = "@<rule> = test -> 0o14";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("integer binary literal values", () => {
            const grammar = "@<rule> = test -> 0b1100";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: 12,
            });
        });

        it("string literal values", () => {
            const grammar1 = '@<rule> = test -> "hello world"';
            const grammar2 = "@<rule> = test -> 'hello world'";

            const result1 = parseGrammar("test.grammar", grammar1);
            const result2 = parseGrammar("test.grammar", grammar2);

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
            const grammar = '@<rule> = test -> "hello\\tworld\\n"';
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "literal",
                value: "hello\tworld\n",
            });
        });

        it("array values", () => {
            const grammar = '@<rule> = test -> [1, "hello", true]';
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "array",
                value: [
                    { type: "literal", value: 1 },
                    { type: "literal", value: "hello" },
                    { type: "literal", value: true },
                ],
            });
        });

        it("empty array values", () => {
            const grammar = "@<rule> = test -> []";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "array",
                value: [],
            });
        });

        it("object values", () => {
            const grammar = '@<rule> = test -> {type: "greeting", count: 1}';
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: {
                    type: { type: "literal", value: "greeting" },
                    count: { type: "literal", value: 1 },
                },
            });
        });

        it("empty object values", () => {
            const grammar = "@<rule> = test -> {}";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: {},
            });
        });

        it("object values with single quote properties", () => {
            const grammar =
                "@<rule> = test -> {'type': \"greeting\", 'count': 1}";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: {
                    type: { type: "literal", value: "greeting" },
                    count: { type: "literal", value: 1 },
                },
            });
        });

        it("object values with double quote properties", () => {
            const grammar =
                '@<rule> = test -> {"type": "greeting", "count": 1}';
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: {
                    type: { type: "literal", value: "greeting" },
                    count: { type: "literal", value: 1 },
                },
            });
        });

        it("variable reference values", () => {
            const grammar = "@<rule> = $(name) -> $(name)";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "variable",
                name: "name",
            });
        });

        it("nested object and array values", () => {
            const grammar =
                "@<rule> = test -> {items: [1, 2], meta: {count: 2}}";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: {
                    items: {
                        type: "array",
                        value: [
                            { type: "literal", value: 1 },
                            { type: "literal", value: 2 },
                        ],
                    },
                    meta: {
                        type: "object",
                        value: {
                            count: { type: "literal", value: 2 },
                        },
                    },
                },
            });
        });

        it("should handle nested groups and complex expressions", () => {
            const grammar = `
                @<complex> = (please)? ($(action) | do) (the)? $(object) ($(adverb))? -> {
                    politeness: $(politeness),
                    actions: [$(action), "execute"],
                    target: {
                        name: $(object),
                        metadata: {
                            hasArticle: true,
                            modifier: $(adverb)
                        }
                    }
                }
            `;

            const result = parseGrammar("nested.grammar", grammar);

            expect(result).toEqual([
                {
                    name: "complex",
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
                                                    name: "action",
                                                    typeName: "string",
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
                                    name: "object",
                                    typeName: "string",
                                    ruleReference: false,
                                },
                                {
                                    type: "rules",
                                    rules: [
                                        {
                                            expressions: [
                                                {
                                                    type: "variable",
                                                    name: "adverb",
                                                    typeName: "string",
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
                                value: {
                                    politeness: {
                                        type: "variable",
                                        name: "politeness",
                                    },
                                    actions: {
                                        type: "array",
                                        value: [
                                            {
                                                type: "variable",
                                                name: "action",
                                            },
                                            {
                                                type: "literal",
                                                value: "execute",
                                            },
                                        ],
                                    },
                                    target: {
                                        type: "object",
                                        value: {
                                            name: {
                                                type: "variable",
                                                name: "object",
                                            },
                                            metadata: {
                                                type: "object",
                                                value: {
                                                    hasArticle: {
                                                        type: "literal",
                                                        value: true,
                                                    },
                                                    modifier: {
                                                        type: "variable",
                                                        name: "adverb",
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    ],
                },
            ]);
        });

        it("grammar with unicode and special characters", () => {
            const grammar = `
                @<unicode> = café \\u00E9 -> "café"
                @<special> = hello\\tworld\\n -> "formatted"
                @<escaped> = \\@ \\| \\( \\) -> "escaped"
            `;

            const result = parseGrammar("unicode.grammar", grammar);

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
                value: ["@", "|", "(", ")"],
            });
        });
    });

    describe("Whitespace and Comments", () => {
        it("should handle collapse whitespace between tokens", () => {
            const spaces =
                "  \t\v\f\u00a0\ufeff\n\r\u2028\u2029\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000";
            const grammar = `${spaces}@${spaces}<greeting>${spaces}=${spaces}hello${spaces}world${spaces}->${spaces}true${spaces}`;
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toEqual([
                {
                    name: "greeting",
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
            const grammar = `@<greeting>=${escapedSpaces}hello${escapedSpaces}world${escapedSpaces}->true`;
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toEqual([
                {
                    name: "greeting",
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
                @<greeting> = hello // End of line comment
                // Another comment
            `;
            const result = parseGrammar("test.grammar", grammar);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("greeting");
        });

        it("should handle multi-line comments", () => {
            const grammar = `
                /* 
                 * This is a multi-line comment
                 * describing the greeting rule
                 */
                @<greeting> = hello /* inline comment */ world
            `;
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello", "world"],
            });
        });

        it("should handle mixed whitespace types", () => {
            const grammar = "@<rule>\t=\r\nhello\n\t world";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello", "world"],
            });
        });

        it("should collapse multiple whitespace in strings to single space", () => {
            const grammar = "@<rule> = hello     world\t\t\ttest";
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].expressions[0]).toEqual({
                type: "string",
                value: ["hello", "world", "test"],
            });
        });

        it("should handle comments in values", () => {
            const grammar = `
                @<rule> = test -> {
                    // Property comment
                    type: "greeting", /* inline */
                    count: 1
                }
            `;
            const result = parseGrammar("test.grammar", grammar);

            expect(result[0].rules[0].value).toEqual({
                type: "object",
                value: {
                    type: { type: "literal", value: "greeting" },
                    count: { type: "literal", value: 1 },
                },
            });
        });
    });

    describe("Error Handling", () => {
        it("should throw error for missing @ at start of rule", () => {
            const grammar = "<greeting> = hello";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "'@' expected",
            );
        });

        it("should throw error for malformed rule name", () => {
            const grammar = "@greeting = hello";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "'<' expected",
            );
        });

        it("should throw error for missing equals sign", () => {
            const grammar = "@<greeting> hello";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "'=' expected",
            );
        });

        it("should throw error for unterminated string literal", () => {
            const grammar = '@<rule> = test -> "unterminated';
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Unterminated string literal",
            );
        });

        it("should throw error for unterminated variable", () => {
            const grammar = "@<rule> = $(name";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "')' expected",
            );
        });

        it("should throw error for unterminated group", () => {
            const grammar = "@<rule> = (hello";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "')' expected",
            );
        });

        it("should throw error for invalid escape sequence", () => {
            const grammar = '@<rule> = test -> "invalid\\';
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Missing escaped character.",
            );
        });

        it("should throw error for invalid hex escape", () => {
            const grammar = '@<rule> = test -> "\\xZZ"';
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Invalid hex escape sequence",
            );
        });

        it("should throw error for invalid unicode escape", () => {
            const grammar = '@<rule> = test -> "\\uZZZZ"';
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Invalid Unicode escape sequence",
            );
        });

        it("should throw error for unterminated array", () => {
            const grammar = "@<rule> = test -> [1, 2";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Unexpected end of file in array value",
            );
        });

        it("should throw error for unterminated object", () => {
            const grammar = '@<rule> = test -> {type: "test"';
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Unexpected end of file in object value",
            );
        });

        it("should throw error for missing colon in object", () => {
            const grammar = '@<rule> = test -> {type "test"}';
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "':' expected",
            );
        });

        it("should throw error for invalid number", () => {
            const grammar = "@<rule> = test -> abc123";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Invalid literal",
            );
        });

        it("should throw error for infinity values", () => {
            const grammar = "@<rule> = test -> Infinity";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Infinity values are not allowed",
            );
        });

        it("should throw error for unescaped special characters", () => {
            const grammar = "@<rule> = hello-world";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Special character needs to be escaped",
            );
        });

        it("should throw error for empty expression", () => {
            const grammar = "@<rule> = ";
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                "Empty expression",
            );
        });

        it("should include line and column information in errors", () => {
            const grammar = `
                @<valid> = hello
                @invalid = world
            `;
            expect(() => parseGrammar("test.grammar", grammar)).toThrow(
                /test\.grammar:\d+:\d+:/,
            );
        });
    });

    describe("Complex Integration", () => {
        it("should handle deeply nested value structures", () => {
            const grammar = `
                @<nested> = test -> {
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
                    variables: [$(param1), $(param2)]
                }
            `;

            const result = parseGrammar("deeply-nested.grammar", grammar);

            const value = result[0].rules[0].value as any;
            expect(value.type).toBe("object");
            expect(value.value.config.type).toBe("object");
            expect(value.value.config.value.settings.type).toBe("array");
            expect(value.value.variables.value).toHaveLength(2);
        });

        it("real-world conversation patterns", () => {
            const grammar = `
                // Weather queries
                @<weather> = (what's | what is) the weather (like)? (in $(location))? -> {
                    intent: "weather.query",
                    location: $(location),
                    type: "current"
                }
                
                // Calendar operations  
                @<calendar> = (schedule | book) (a)? $(event) (for | on) $(date) (at $(time))? -> {
                    intent: "calendar.create",
                    event: {
                        title: $(event),
                        date: $(date),
                        time: $(time)
                    }
                }
                
                // Music control
                @<music> = (play | start) $(song)? (by $(artist))? -> {
                    intent: "music.play",
                    query: {
                        song: $(song),
                        artist: $(artist)
                    },
                    shuffle: false
                }
            `;

            const result = parseGrammar("conversation.grammar", grammar);

            expect(result).toHaveLength(3);

            // Verify each intent has proper structure
            result.forEach((rule) => {
                expect(rule.name).toMatch(/^(weather|calendar|music)$/);
                expect(rule.rules[0].value).toBeDefined();
                const value = rule.rules[0].value as any;
                expect(value.type).toBe("object");
                expect(value.value.intent).toBeDefined();
            });
        });
    });
});
