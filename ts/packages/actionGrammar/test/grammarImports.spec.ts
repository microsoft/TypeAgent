// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import {
    loadGrammarRules,
    loadGrammarRulesNoThrow,
} from "../src/grammarLoader.js";
import { FileLoader } from "../src/grammarCompiler.js";
import { defaultFileLoader } from "../src/defaultFileLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";

function getTestFileLoader(grammarFiles: Record<string, string>): FileLoader {
    const fileMap = new Map(
        Object.keys(grammarFiles).map((key) => [
            defaultFileLoader.resolvePath(key),
            key,
        ]),
    );
    return {
        ...defaultFileLoader,
        readContent: (fullPath: string) => {
            const fileKey = fileMap.get(fullPath);
            const content = fileKey ? grammarFiles[fileKey] : undefined;
            if (content === undefined) {
                throw new Error(`File not found: ${fullPath}`);
            }
            return content;
        },
    };
}

function testMatch(grammar: any, input: string) {
    return matchGrammar(grammar, input)?.map((m) => m.match);
}

describe("Grammar Imports with File Loading", () => {
    describe("Basic Grammar Imports", () => {
        it("should import and use a simple rule from another file", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "greeting.agr": `export <Greeting> = (hello | hi | hey) -> "greeting";`,
                "main.agr": `
                    import { Greeting } from "./greeting.agr";
                    <Start> = $(greeting:<Greeting>) world -> { greeting, target: "world" };
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
            expect(grammar?.rules).toBeDefined();
            expect(grammar?.rules.length).toBeGreaterThan(0);

            // Test match functionality
            expect(testMatch(grammar, "hello world")).toEqual([
                { greeting: "greeting", target: "world" },
            ]);
            expect(testMatch(grammar, "hi world")).toEqual([
                { greeting: "greeting", target: "world" },
            ]);
            expect(testMatch(grammar, "hey world")).toEqual([
                { greeting: "greeting", target: "world" },
            ]);
        });

        it("should import multiple rules from a single file", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "actions.agr": `
                                export <Play> = play $(track) -> { action: "play", track };
                                export <Pause> = pause -> { action: "pause" };
                                export <Stop> = stop -> { action: "stop" };
                            `,
                "main.agr": `
                                import { Play, Pause, Stop } from "./actions.agr";

                                <Start> = <Play> | <Pause> | <Stop>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "play song")).toEqual([
                { action: "play", track: "song" },
            ]);
            expect(testMatch(grammar, "pause")).toEqual([{ action: "pause" }]);
            expect(testMatch(grammar, "stop")).toEqual([{ action: "stop" }]);
        });

        it("should import from multiple files", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "greeting.agr": `export <Greeting> = (hello | hi) -> "greeting";`,
                "farewell.agr": `export <Farewell> = (goodbye | bye) -> "farewell";`,
                "main.agr": `
                                import { Greeting } from "./greeting.agr";
                                import { Farewell } from "./farewell.agr";

                                <Start> = <Greeting> | <Farewell>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "hello")).toEqual(["greeting"]);
            expect(testMatch(grammar, "hi")).toEqual(["greeting"]);
            expect(testMatch(grammar, "goodbye")).toEqual(["farewell"]);
            expect(testMatch(grammar, "bye")).toEqual(["farewell"]);
        });

        it("should use imported rule in a variable reference", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "numbers.agr": `export <Number> = one -> 1 | two -> 2 | three -> 3;`,
                "main.agr": `
                                import { Number } from "./numbers.agr";

                                <Start> = count to $(num:<Number>) -> { count: num };
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "count to one")).toEqual([{ count: 1 }]);
            expect(testMatch(grammar, "count to two")).toEqual([{ count: 2 }]);
            expect(testMatch(grammar, "count to three")).toEqual([
                { count: 3 },
            ]);
        });
    });

    describe("Wildcard Imports", () => {
        it("should import all rules with wildcard", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "colors.agr": `
                                export <Red> = red -> "red";
                                export <Blue> = blue -> "blue";
                                export <Green> = green -> "green";
                            `,
                "main.agr": `
                                import * from "./colors.agr";

                                <Start> = <Red> | <Blue> | <Green>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "red")).toEqual(["red"]);
            expect(testMatch(grammar, "blue")).toEqual(["blue"]);
            expect(testMatch(grammar, "green")).toEqual(["green"]);
        });

        it("should allow any rule reference with wildcard import", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "actions.agr": `
                                export <Action1> = action one -> 1;
                                export <Action2> = action two -> 2;
                            `,
                "main.agr": `
                                import * from "./actions.agr";

                                <Start> = <Action1> | <Action2>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "action one")).toEqual([1]);
            expect(testMatch(grammar, "action two")).toEqual([2]);
        });
    });

    describe("Nested Imports", () => {
        it("should handle transitive imports (A imports B, B imports C)", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "base.agr": `export <BaseRule> = base value -> "base";`,
                "middle.agr": `
                                import { BaseRule } from "./base.agr";

                                export <MiddleRule> = middle <BaseRule> -> "middle";
                            `,
                "main.agr": `
                                import { MiddleRule } from "./middle.agr";

                                <Start> = start <MiddleRule> -> "start";
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "start middle base value")).toEqual([
                "start",
            ]);
        });

        it("should handle complex import chains", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "level3.agr": `export <L3> = level three -> 3;`,
                "level2.agr": `
                                import { L3 } from "./level3.agr";
                                export <L2> = level two <L3> -> 2;
                            `,
                "level1.agr": `
                                import { L2 } from "./level2.agr";
                                export <L1> = level one <L2> -> 1;
                            `,
                "main.agr": `
                                import { L1 } from "./level1.agr";
                                <Start> = <L1>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(
                testMatch(grammar, "level one level two level three"),
            ).toEqual([1]);
        });

        it("should handle imports from subdirectories", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib/utils.agr": `export <UtilRule> = utility -> "util";`,
                "main.agr": `
                                import { UtilRule } from "./lib/utils.agr";
                                <Start> = <UtilRule> rule -> "result";
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "utility rule")).toEqual(["result"]);
        });

        it("should resolve paths relative to each referencing file at multiple levels", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                // Deepest level: /dir1/dir2/base.agr
                "dir1/dir2/base.agr": `export <Base> = base -> "base";`,
                // Middle level: /dir1/middle.agr imports from ./dir2/base.agr (relative to /dir1/)
                "dir1/middle.agr": `
                                import { Base } from "./dir2/base.agr";
                                export <Middle> = middle <Base> -> "middle";
                            `,
                // Top level: /main.agr imports from ./dir1/middle.agr (relative to /)
                "main.agr": `
                                import { Middle } from "./dir1/middle.agr";
                                <Start> = start <Middle> -> "start";
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "start middle base")).toEqual(["start"]);
        });

        it("should resolve sibling and parent directory paths at multiple levels", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                // Shared utility in /shared/common.agr
                "shared/common.agr": `export <Common> = common -> "common";`,
                // Module in /modules/sub/feature.agr imports from ../../shared/common.agr
                "modules/sub/feature.agr": `
                                import { Common } from "../../shared/common.agr";
                                export <Feature> = feature <Common> -> "feature";
                            `,
                // Wrapper in /modules/wrapper.agr imports from ./sub/feature.agr
                "modules/wrapper.agr": `
                                import { Feature } from "./sub/feature.agr";
                                export <Wrapper> = wrapper <Feature> -> "wrapper";
                            `,
                // Main imports from ./modules/wrapper.agr
                "main.agr": `
                                import { Wrapper } from "./modules/wrapper.agr";
                                <Start> = <Wrapper>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "wrapper feature common")).toEqual([
                "wrapper",
            ]);
        });
    });
    describe("Throw Cases", () => {
        it("should throw when imported file does not exist", () => {
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                                import { Missing } from "./nonexistent.agr";
                                <Start> = <Missing>;
                            `,
            };
            expect(() => {
                loadGrammarRules("main.agr", getTestFileLoader(grammarFiles));
            }).toThrow();
        });
        it("should throw when imported file has syntax errors", () => {
            const grammarFiles: Record<string, string> = {
                "bad.agr": `<Bad> = invalid syntax {{{`,
                "main.agr": `
                                import { Bad } from "./bad.agr";
                                <Start> = <Bad>;
                            `,
            };
            expect(() => {
                loadGrammarRules("main.agr", getTestFileLoader(grammarFiles));
            }).toThrow();
        });
    });
    describe("Error Cases", () => {
        it("should error when imported file does not exist", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                                import { Missing } from "./nonexistent.agr";
                                <Start> = <Missing>;
                            `,
            };
            expect(
                loadGrammarRulesNoThrow(
                    "main.agr",
                    getTestFileLoader(grammarFiles),
                    errors,
                ),
            ).toBeUndefined();
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("File not found: ");
        });
        it("should error when imported rule is not defined in the file", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "actions.agr": `export <Play> = play -> "play";`,
                "main.agr": `
                                import { Stop } from "./actions.agr";
                                <Start> = <Stop>;
                            `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Stop");
            expect(errors[0]).toContain("not exported");
        });

        it("should error when trying to import a locally defined rule", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "rules.agr": `export <Action> = imported action -> "imported";`,
                "main.agr": `
                                import { Action } from "./rules.agr";

                                <Start> = <Action>;
                                <Action> = local action -> "local";
                            `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain(
                "cannot be imported because it is already defined",
            );
        });

        it("should error when imported file has syntax errors", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "bad.agr": `<Bad> = invalid syntax {{{`,
                "main.agr": `
                                import { Bad } from "./bad.agr";
                                <Start> = <Bad>;
                            `,
            };
            expect(
                loadGrammarRulesNoThrow(
                    "main.agr",
                    getTestFileLoader(grammarFiles),
                    errors,
                ),
            ).toBeUndefined();
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("Special character");
            expect(errors[0]).toContain("bad.agr");
        });
        it("should refer to files using relative paths in error messages - parse error", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib/broken.agr": `<Broken> = syntax error ->;`,
                "main.agr": `
                                import { Broken } from "./lib/broken.agr";
                                <Start> = <Broken>;
                            `,
            };

            expect(
                loadGrammarRulesNoThrow(
                    "main.agr",
                    getTestFileLoader(grammarFiles),
                    errors,
                ),
            ).toBeUndefined();
            expect(errors.length).toBe(1);
            // Error should reference the file with relative path (platform-specific separators)
            const expectedPath = path.join("lib", "broken.agr");
            expect(errors[0]).toContain(expectedPath);
            // Error should NOT contain absolute path (starting with path separator)
            expect(errors[0]).not.toContain(path.sep + expectedPath);
        });

        it("should refer to files using relative paths in error messages - compile error", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib/broken.agr": `export <Broken> = $(x:UndefinedType);`,
                "main.agr": `
                                import { Broken } from "./lib/broken.agr";
                                <Start> = <Broken>;
                            `,
            };

            const result = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(result).toBeUndefined();
            expect(errors.length).toBe(1);

            const errorMessage = errors[0];
            // Error should reference the file with relative path (platform-specific separators)
            const expectedPath = path.join("lib", "broken.agr");
            expect(errorMessage).toContain(expectedPath);
            // Error should NOT contain absolute path (starting with path separator)
            expect(errorMessage).not.toContain(path.sep + expectedPath);
        });
    });

    describe("Complex Scenarios", () => {
        it("should handle imported rules with their own rule references", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "base.agr": `
                                <Subject> = ( cat | dog | bird ) -> "subject";
                                <Verb> = ( runs | jumps | flies ) -> "verb";
                                export <Sentence> = the $(subject:<Subject>) $(verb:<Verb>) -> {
                                    subject,
                                    verb
                                };
                            `,
                "main.agr": `
                                import { Sentence } from "./base.agr";
                                <Start> = <Sentence>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "the cat runs")).toEqual([
                { subject: "subject", verb: "verb" },
            ]);
            expect(testMatch(grammar, "the dog jumps")).toEqual([
                { subject: "subject", verb: "verb" },
            ]);
            expect(testMatch(grammar, "the bird flies")).toEqual([
                { subject: "subject", verb: "verb" },
            ]);
        });

        it("should handle mixing imported and local rules", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "imported.agr": `
                                export <ImportedRule1> = imported one -> 1;
                                export <ImportedRule2> = imported two -> 2;
                            `,
                "main.agr": `
                                import { ImportedRule1, ImportedRule2 } from "./imported.agr";

                                <LocalRule1> = local one -> 3;
                                <LocalRule2> = local two -> 4;

                                <Start> = <ImportedRule1> | <ImportedRule2> | <LocalRule1> | <LocalRule2>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "imported one")).toEqual([1]);
            expect(testMatch(grammar, "imported two")).toEqual([2]);
            expect(testMatch(grammar, "local one")).toEqual([3]);
            expect(testMatch(grammar, "local two")).toEqual([4]);
        });

        it("should handle imported rules that produce values", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "values.agr": `
                                export <Priority> = high -> 1 | medium -> 2 | low -> 3;
                                export <Status> = active -> "active" | inactive -> "inactive";
                            `,
                "main.agr": `
                                import { Priority, Status } from "./values.agr";

                                <Start> = task $(name) priority $(p:<Priority>) status $(s:<Status>) -> {
                                    name,
                                    priority: p,
                                    status: s
                                };
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(
                testMatch(grammar, "task mytask priority high status active"),
            ).toEqual([{ name: "mytask", priority: 1, status: "active" }]);
            expect(
                testMatch(grammar, "task project priority low status inactive"),
            ).toEqual([{ name: "project", priority: 3, status: "inactive" }]);
        });

        it("should handle optional rule references in imported rules", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "optional.agr": `
                                export <Polite> = (please)? $(action) (thank you)? -> action;
                            `,
                "main.agr": `
                                import { Polite } from "./optional.agr";
                                <Start> = <Polite>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "please run")).toEqual([
                "run",
                "please run", // REVIEW: avoid this in the possible result, even though it is possible valid?
            ]);
            expect(testMatch(grammar, "run")).toEqual(["run"]);
            expect(testMatch(grammar, "run thank you")).toEqual([
                "run",
                "run thank you", // REVIEW: avoid this in the possible result, even though it is possible valid?
            ]);
            expect(testMatch(grammar, "please run thank you")).toEqual([
                "run",
                // REVIEW: avoid the "please run thank you" result, even though it is possible valid?
                "run thank you",
                "please run",
                "please run thank you",
            ]);
        });

        it("should handle imported rules with multiple alternatives", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "alternatives.agr": `
                                export <Command> =
                                    start $(service) -> { action: "start", service } |
                                    stop $(service) -> { action: "stop", service } |
                                    restart $(service) -> { action: "restart", service };
                            `,
                "main.agr": `
                                import { Command } from "./alternatives.agr";
                                <Start> = <Command>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "start nginx")).toEqual([
                { action: "start", service: "nginx" },
            ]);
            expect(testMatch(grammar, "stop apache")).toEqual([
                { action: "stop", service: "apache" },
            ]);
            expect(testMatch(grammar, "restart mysql")).toEqual([
                { action: "restart", service: "mysql" },
            ]);
        });

        it("should handle same file imported from multiple places", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "utils.agr": `export <Common> = common -> "common";`,
                "module1.agr": `
                                import { Common } from "./utils.agr";
                                export <Module1> = module1 <Common> -> "m1";
                            `,
                "module2.agr": `
                                import { Common } from "./utils.agr";
                                export <Module2> = module2 <Common> -> "m2";
                            `,
                "main.agr": `
                                import { Module1 } from "./module1.agr";
                                import { Module2 } from "./module2.agr";
                                <Start> = <Module1> | <Module2>;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "module1 common")).toEqual(["m1"]);
            expect(testMatch(grammar, "module2 common")).toEqual(["m2"]);
        });
    });

    describe("Type Imports", () => {
        it("should accept imported types from .ts files", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                                import { CustomType } from "./types.ts";
                                <Start> = value $(x:CustomType) -> x;
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            // Type imports don't load actual files, just mark types as valid
            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "value something")).toEqual([
                "something",
            ]);
        });

        it("should distinguish between grammar imports and type imports", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "rules.agr": `export <MyRule> = my rule -> "rule";`,
                "main.agr": `
                                import { MyRule } from "./rules.agr";
                                import { MyType } from "./types.ts";

                                <Start> = <MyRule> $(value:MyType) -> { value };
                            `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();

            // Test match functionality
            expect(testMatch(grammar, "my rule something")).toEqual([
                { value: "something" },
            ]);
        });
    });

    describe("Circular Dependency Handling", () => {
        it("should support circular imports (A imports B, B imports A)", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "fileA.agr": `
                    import { RuleB } from "./fileB.agr";
                    export <RuleA> = a <RuleB> -> "a";
                    <Start> = <RuleA>;
                `,
                "fileB.agr": `
                    import { RuleA } from "./fileA.agr";
                    export <RuleB> = b value -> "b";
                `,
            };

            // Circular dependencies are now fully supported
            const grammar = loadGrammarRulesNoThrow(
                "fileA.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            // Should load successfully
            expect(grammar).toBeDefined();
            expect(errors).toEqual([]);

            // Test that the grammar works correctly
            expect(testMatch(grammar, "a b value")).toEqual(["a"]);
        });

        it("should detect self-import conflicts", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "fileA.agr": `
                    import { RuleA } from "./fileA.agr";
                    export <RuleA> = a value -> "a";
                    <Start> = <RuleA>;
                `,
            };

            // Self-import of a locally defined rule should be detected as an error
            loadGrammarRulesNoThrow(
                "fileA.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            // Should have an error about importing a locally defined rule
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain(
                "cannot be imported because it is already defined",
            );
        });

        it("should error when same rule name is imported from different files", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                    import { Shared } from "./fileA.agr";
                    import { Shared } from "./fileB.agr";
                    <Start> = <Shared>;
                `,
                "fileA.agr": `
                    export <Shared> = a value -> "a";
                `,
                "fileB.agr": `
                    export <Shared> = b value -> "b";
                `,
            };

            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("already imported from");
        });

        it("should allow importing same rule name from same file twice", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                    import { Shared } from "./fileA.agr";
                    import { Shared } from "./fileA.agr";
                    <Start> = <Shared>;
                `,
                "fileA.agr": `
                    export <Shared> = a value -> "a";
                `,
            };

            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should error when wildcard import conflicts with named import from different file", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                    import { Shared } from "./fileA.agr";
                    import * from "./fileB.agr";
                    <Start> = <Shared>;
                `,
                "fileA.agr": `
                    export <Shared> = a value -> "a";
                `,
                "fileB.agr": `
                    export <Shared> = b value -> "b";
                `,
            };

            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("already imported from");
        });

        it("should support three-way circular import (A→B→C→A)", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "fileA.agr": `
                    import { RuleB } from "./fileB.agr";
                    export <RuleA> = a <RuleB> -> "a";
                    <Start> = <RuleA>;
                `,
                "fileB.agr": `
                    import { RuleC } from "./fileC.agr";
                    export <RuleB> = b <RuleC> -> "b";
                `,
                "fileC.agr": `
                    import { RuleA } from "./fileA.agr";
                    export <RuleC> = c value -> "c";
                `,
            };

            // Multi-file circular dependencies are fully supported
            const grammar = loadGrammarRulesNoThrow(
                "fileA.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(grammar).toBeDefined();
            expect(errors).toEqual([]);

            // Test that the grammar works correctly
            expect(testMatch(grammar, "a b c value")).toEqual(["a"]);
        });
    });

    describe("Export Keyword on Definitions", () => {
        it("should allow importing exported rules", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Greeting> = hello -> "hello";
                    <Internal> = internal -> "internal";
                `,
                "main.agr": `
                    import { Greeting } from "./lib.agr";
                    <Start> = <Greeting>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
            expect(testMatch(grammar, "hello")).toEqual(["hello"]);
        });

        it("should prevent importing non-exported rules", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Greeting> = hello -> "hello";
                    <Internal> = internal -> "internal";
                `,
                "main.agr": `
                    import { Internal } from "./lib.agr";
                    <Start> = <Internal>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(grammar).toBeUndefined();
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Internal");
            expect(errors[0]).toContain("not exported");
        });

        it("should restrict wildcard imports to exported rules only", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Exported> = exported -> "exported";
                    <Hidden> = hidden -> "hidden";
                `,
                "main.agr": `
                    import * from "./lib.agr";
                    <Start> = <Exported>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
            expect(testMatch(grammar, "exported")).toEqual(["exported"]);
        });

        it("should not include non-exported rules in wildcard imports", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Exported> = exported -> "exported";
                    <Hidden> = hidden -> "hidden";
                `,
                "main.agr": `
                    import * from "./lib.agr";
                    <Start> = <Exported> | <Hidden>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(grammar).toBeUndefined();
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Hidden");
        });

        it("should allow importing multiple exported rules", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Rule1> = one -> 1;
                    export <Rule2> = two -> 2;
                    <Rule3> = three -> 3;
                `,
                "main.agr": `
                    import { Rule1, Rule2 } from "./lib.agr";
                    <Start> = <Rule1> | <Rule2>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
            expect(testMatch(grammar, "one")).toEqual([1]);
            expect(testMatch(grammar, "two")).toEqual([2]);
        });

        it("should handle exports with transitive imports", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "base.agr": `
                    export <BaseRule> = base -> "base";
                    <InternalBase> = internal -> "internal";
                `,
                "middle.agr": `
                    import { BaseRule } from "./base.agr";
                    export <MiddleRule> = middle <BaseRule> -> "middle";
                    <InternalMiddle> = internal middle -> "internal-middle";
                `,
                "main.agr": `
                    import { MiddleRule } from "./middle.agr";
                    <Start> = <MiddleRule>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
            expect(testMatch(grammar, "middle base")).toEqual(["middle"]);
        });

        it("should error when no rules are exported and import is attempted", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    <Rule1> = one -> 1;
                    <Rule2> = two -> 2;
                `,
                "main.agr": `
                    import { Rule1 } from "./lib.agr";
                    <Start> = <Rule1>;
                `,
            };
            const grammar = loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(grammar).toBeUndefined();
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Rule1");
            expect(errors[0]).toContain("not exported");
        });
    });

    describe("importGrammarRule error paths", () => {
        it("should error when source-less import conflicts with local definition", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                    import { Ordinal };
                    <Start> = <Ordinal>;
                    <Ordinal> = first -> 1;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Ordinal");
            expect(errors[0]).toContain(
                "cannot be imported because it is already defined",
            );
        });

        it("should error when source-less import conflicts with .agr import from different file", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "custom.agr": `
                    export <Ordinal> = custom ordinal -> 1;
                `,
                "main.agr": `
                    import { Ordinal } from "./custom.agr";
                    import { Ordinal };
                    <Start> = <Ordinal>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Ordinal");
            expect(errors[0]).toContain("already imported from");
        });

        it("should error on source-less import of non-built-in name", () => {
            const errors: string[] = [];
            const warnings: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                    import { UnknownEntity };
                    <Start> = $(x:UnknownEntity) -> x;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
                warnings,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("UnknownEntity");
            expect(errors[0]).toContain("not exported");
        });

        it("should error when .agr import conflicts with earlier source-less import", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "custom.agr": `
                    export <Ordinal> = custom ordinal -> 1;
                `,
                "main.agr": `
                    import { Ordinal };
                    import { Ordinal } from "./custom.agr";
                    <Start> = <Ordinal>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Ordinal");
            expect(errors[0]).toContain("already imported from");
        });

        it("should error when multiple named imports from different files have overlapping names", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "fileA.agr": `
                    export <Foo> = a -> "a";
                    export <Bar> = b -> "b";
                `,
                "fileB.agr": `
                    export <Bar> = c -> "c";
                    export <Baz> = d -> "d";
                `,
                "main.agr": `
                    import { Foo, Bar } from "./fileA.agr";
                    import { Bar, Baz } from "./fileB.agr";
                    <Start> = <Foo> | <Bar> | <Baz>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("Bar");
            expect(errors[0]).toContain("already imported from");
        });

        it("should error when wildcard import conflicts with local definition", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Action> = lib action -> "lib";
                `,
                "main.agr": `
                    import * from "./lib.agr";
                    <Start> = <Action>;
                    <Action> = local action -> "local";
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Action");
            expect(errors[0]).toContain(
                "cannot be imported because it is already defined",
            );
        });

        it("should report correct source file in already-imported error message", () => {
            const errors: string[] = [];
            const grammarFiles: Record<string, string> = {
                "first.agr": `
                    export <Common> = first -> "first";
                `,
                "second.agr": `
                    export <Common> = second -> "second";
                `,
                "main.agr": `
                    import { Common } from "./first.agr";
                    import { Common } from "./second.agr";
                    <Start> = <Common>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
            );

            expect(errors.length).toBe(1);
            expect(errors[0]).toContain("already imported from");
            expect(errors[0]).toContain("first.agr");
        });

        it("should warn when imported rule is never used", () => {
            const errors: string[] = [];
            const warnings: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Used> = used -> "used";
                    export <Unused> = unused -> "unused";
                `,
                "main.agr": `
                    import { Used, Unused } from "./lib.agr";
                    <Start> = <Used>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
                warnings,
            );

            expect(errors).toEqual([]);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain("Unused");
            expect(warnings[0]).toContain("declared but never used");
        });

        it("should not warn when all imported rules are used", () => {
            const errors: string[] = [];
            const warnings: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Foo> = foo -> "foo";
                    export <Bar> = bar -> "bar";
                `,
                "main.agr": `
                    import { Foo, Bar } from "./lib.agr";
                    <Start> = <Foo> | <Bar>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
                warnings,
            );

            expect(errors).toEqual([]);
            expect(warnings).toEqual([]);
        });

        it("should warn when wildcard-imported rules are unused", () => {
            const errors: string[] = [];
            const warnings: string[] = [];
            const grammarFiles: Record<string, string> = {
                "lib.agr": `
                    export <Used> = used -> "used";
                    export <Unused> = unused -> "unused";
                `,
                "main.agr": `
                    import * from "./lib.agr";
                    <Start> = <Used>;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
                warnings,
            );

            expect(errors).toEqual([]);
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain("Unused");
            expect(warnings[0]).toContain("declared but never used");
        });

        it("should warn when source-less imported rule is unused", () => {
            const errors: string[] = [];
            const warnings: string[] = [];
            const grammarFiles: Record<string, string> = {
                "main.agr": `
                    import { Ordinal, Cardinal };
                    <Start> = $(x:<Ordinal>) -> x;
                `,
            };
            loadGrammarRulesNoThrow(
                "main.agr",
                getTestFileLoader(grammarFiles),
                errors,
                warnings,
            );

            expect(errors).toEqual([]);
            // Cardinal is unused as a rule (but still registered as entity type,
            // which produces its own "imported type never used" warning)
            const ruleWarning = warnings.find(
                (w) =>
                    w.includes("Cardinal") &&
                    w.includes("Imported rule") &&
                    w.includes("declared but never used"),
            );
            expect(ruleWarning).toBeDefined();
        });
    });
});
