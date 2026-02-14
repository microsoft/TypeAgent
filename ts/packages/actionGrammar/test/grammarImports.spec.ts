// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Grammar Imports with File Loading", () => {
    let tempDir: string;

    beforeEach(() => {
        // Create a temporary directory for test fixtures
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grammar-test-"));
    });

    afterEach(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe("Basic Grammar Imports", () => {
        it("should import and use a simple rule from another file", () => {
            // Create the imported file
            const greetingFile = path.join(tempDir, "greeting.agr");
            fs.writeFileSync(
                greetingFile,
                `@<Greeting> = hello | hi | hey -> "greeting"`,
            );

            // Create the main file that imports
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Greeting } from "./greeting.agr"

                @<Start> = <Greeting> world -> { greeting: $(greeting), target: "world" }
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
            expect(grammar?.rules).toBeDefined();
            expect(grammar?.rules.length).toBeGreaterThan(0);
        });

        it("should import multiple rules from a single file", () => {
            // Create the imported file with multiple rules
            const actionsFile = path.join(tempDir, "actions.agr");
            fs.writeFileSync(
                actionsFile,
                `
                @<Play> = play $(track) -> { action: "play", track: $(track) }
                @<Pause> = pause -> { action: "pause" }
                @<Stop> = stop -> { action: "stop" }
            `,
            );

            // Create the main file that imports multiple rules
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Play, Pause, Stop } from "./actions.agr"

                @<Start> = <Play> | <Pause> | <Stop>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should import from multiple files", () => {
            // Create first imported file
            const greetingFile = path.join(tempDir, "greeting.agr");
            fs.writeFileSync(
                greetingFile,
                `@<Greeting> = hello | hi -> "greeting"`,
            );

            // Create second imported file
            const farewellFile = path.join(tempDir, "farewell.agr");
            fs.writeFileSync(
                farewellFile,
                `@<Farewell> = goodbye | bye -> "farewell"`,
            );

            // Create the main file that imports from both
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Greeting } from "./greeting.agr"
                @import { Farewell } from "./farewell.agr"

                @<Start> = <Greeting> | <Farewell>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should use imported rule in a variable reference", () => {
            // Create the imported file
            const numbersFile = path.join(tempDir, "numbers.agr");
            fs.writeFileSync(
                numbersFile,
                `@<Number> = one -> 1 | two -> 2 | three -> 3`,
            );

            // Create the main file that uses imported rule in a variable
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Number } from "./numbers.agr"

                @<Start> = count to $(num:<Number>) -> { count: $(num) }
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });
    });

    describe("Wildcard Imports", () => {
        it("should import all rules with wildcard", () => {
            // Create the imported file with multiple rules
            const colorsFile = path.join(tempDir, "colors.agr");
            fs.writeFileSync(
                colorsFile,
                `
                @<Red> = red -> "red"
                @<Blue> = blue -> "blue"
                @<Green> = green -> "green"
            `,
            );

            // Create the main file with wildcard import
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import * from "./colors.agr"

                @<Start> = <Red> | <Blue> | <Green>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should allow any rule reference with wildcard import", () => {
            // Create the imported file
            const actionsFile = path.join(tempDir, "actions.agr");
            fs.writeFileSync(
                actionsFile,
                `
                @<Action1> = action one -> 1
                @<Action2> = action two -> 2
            `,
            );

            // Create main file that references rules not explicitly listed
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import * from "./actions.agr"

                @<Start> = <Action1> | <Action2>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });
    });

    describe("Nested Imports", () => {
        it("should handle transitive imports (A imports B, B imports C)", () => {
            // Create the base file (C)
            const baseFile = path.join(tempDir, "base.agr");
            fs.writeFileSync(
                baseFile,
                `@<BaseRule> = base value -> "base"`,
            );

            // Create the middle file (B) that imports C
            const middleFile = path.join(tempDir, "middle.agr");
            fs.writeFileSync(
                middleFile,
                `
                @import { BaseRule } from "./base.agr"

                @<MiddleRule> = middle <BaseRule> -> "middle"
            `,
            );

            // Create the main file (A) that imports B
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { MiddleRule } from "./middle.agr"

                @<Start> = start <MiddleRule> -> "start"
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle complex import chains", () => {
            // Create multiple layers of imports
            const level3File = path.join(tempDir, "level3.agr");
            fs.writeFileSync(level3File, `@<L3> = level three -> 3`);

            const level2File = path.join(tempDir, "level2.agr");
            fs.writeFileSync(
                level2File,
                `
                @import { L3 } from "./level3.agr"
                @<L2> = level two <L3> -> 2
            `,
            );

            const level1File = path.join(tempDir, "level1.agr");
            fs.writeFileSync(
                level1File,
                `
                @import { L2 } from "./level2.agr"
                @<L1> = level one <L2> -> 1
            `,
            );

            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { L1 } from "./level1.agr"
                @<Start> = <L1>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle imports from subdirectories", () => {
            // Create subdirectory
            const subDir = path.join(tempDir, "lib");
            fs.mkdirSync(subDir);

            // Create file in subdirectory
            const libFile = path.join(subDir, "utils.agr");
            fs.writeFileSync(libFile, `@<UtilRule> = utility -> "util"`);

            // Create main file that imports from subdirectory
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { UtilRule } from "./lib/utils.agr"
                @<Start> = <UtilRule> rule
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });
    });

    describe("Error Cases", () => {
        it("should error when imported file does not exist", () => {
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Missing } from "./nonexistent.agr"
                @<Start> = <Missing>
            `;

            const errors: string[] = [];
            expect(() => {
                loadGrammarRules(mainFile, mainContent, errors);
            }).toThrow();
        });

        it("should error when imported rule is not defined in the file", () => {
            // Create file without the expected rule
            const actionsFile = path.join(tempDir, "actions.agr");
            fs.writeFileSync(actionsFile, `@<Play> = play -> "play"`);

            // Try to import a rule that doesn't exist
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Stop } from "./actions.agr"
                @<Start> = <Stop>
            `;

            const errors: string[] = [];
            loadGrammarRules(mainFile, mainContent, errors);

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("Missing rule definition for '<Stop>'");
        });

        it("should error when trying to redefine an imported rule", () => {
            // Create imported file
            const rulesFile = path.join(tempDir, "rules.agr");
            fs.writeFileSync(
                rulesFile,
                `@<Action> = imported action -> "imported"`,
            );

            // Try to redefine the imported rule
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Action } from "./rules.agr"

                @<Start> = <Action>
                @<Action> = local action -> "local"
            `;

            const errors: string[] = [];
            loadGrammarRules(mainFile, mainContent, errors);

            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain("cannot be defined because it is imported");
        });

        it("should error when imported file has syntax errors", () => {
            // Create file with syntax error
            const badFile = path.join(tempDir, "bad.agr");
            fs.writeFileSync(badFile, `@<Bad> = invalid syntax {{{`);

            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Bad } from "./bad.agr"
                @<Start> = <Bad>
            `;

            const errors: string[] = [];
            expect(() => {
                loadGrammarRules(mainFile, mainContent, errors);
            }).toThrow();
        });
    });

    describe("Complex Scenarios", () => {
        it("should handle imported rules with their own rule references", () => {
            // Create base rules file
            const baseFile = path.join(tempDir, "base.agr");
            fs.writeFileSync(
                baseFile,
                `
                @<Subject> = cat | dog | bird -> $(subject)
                @<Verb> = runs | jumps | flies -> $(verb)
                @<Sentence> = the $(subject:<Subject>) $(verb:<Verb>) -> {
                    subject: $(subject),
                    verb: $(verb)
                }
            `,
            );

            // Import and use the complex rule
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Sentence } from "./base.agr"
                @<Start> = <Sentence>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle mixing imported and local rules", () => {
            // Create imported file
            const importedFile = path.join(tempDir, "imported.agr");
            fs.writeFileSync(
                importedFile,
                `
                @<ImportedRule1> = imported one -> 1
                @<ImportedRule2> = imported two -> 2
            `,
            );

            // Create main file with both imported and local rules
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { ImportedRule1, ImportedRule2 } from "./imported.agr"

                @<LocalRule1> = local one -> 3
                @<LocalRule2> = local two -> 4

                @<Start> = <ImportedRule1> | <ImportedRule2> | <LocalRule1> | <LocalRule2>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle imported rules that produce values", () => {
            // Create file with value-producing rules
            const valuesFile = path.join(tempDir, "values.agr");
            fs.writeFileSync(
                valuesFile,
                `
                @<Priority> = high -> 1 | medium -> 2 | low -> 3
                @<Status> = active -> "active" | inactive -> "inactive"
            `,
            );

            // Use in main file
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Priority, Status } from "./values.agr"

                @<Start> = task $(name) priority $(p:<Priority>) status $(s:<Status>) -> {
                    name: $(name),
                    priority: $(p),
                    status: $(s)
                }
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle optional rule references in imported rules", () => {
            // Create file with optional groups
            const optionalFile = path.join(tempDir, "optional.agr");
            fs.writeFileSync(
                optionalFile,
                `
                @<Polite> = (please)? $(action) (thank you)? -> $(action)
            `,
            );

            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Polite } from "./optional.agr"
                @<Start> = <Polite>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle imported rules with multiple alternatives", () => {
            // Create file with complex alternatives
            const altFile = path.join(tempDir, "alternatives.agr");
            fs.writeFileSync(
                altFile,
                `
                @<Command> =
                    start $(service) -> { action: "start", service: $(service) } |
                    stop $(service) -> { action: "stop", service: $(service) } |
                    restart $(service) -> { action: "restart", service: $(service) }
            `,
            );

            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Command } from "./alternatives.agr"
                @<Start> = <Command>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should handle same file imported from multiple places", () => {
            // Create a shared utility file
            const utilsFile = path.join(tempDir, "utils.agr");
            fs.writeFileSync(utilsFile, `@<Common> = common -> "common"`);

            // Create two files that both import utils
            const module1File = path.join(tempDir, "module1.agr");
            fs.writeFileSync(
                module1File,
                `
                @import { Common } from "./utils.agr"
                @<Module1> = module1 <Common> -> "m1"
            `,
            );

            const module2File = path.join(tempDir, "module2.agr");
            fs.writeFileSync(
                module2File,
                `
                @import { Common } from "./utils.agr"
                @<Module2> = module2 <Common> -> "m2"
            `,
            );

            // Main file imports both modules
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { Module1 } from "./module1.agr"
                @import { Module2 } from "./module2.agr"
                @<Start> = <Module1> | <Module2>
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });
    });

    describe("Type Imports", () => {
        it("should accept imported types from .ts files", () => {
            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { CustomType } from "./types.ts"
                @<Start> = value $(x:CustomType) -> $(x)
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            // Type imports don't load actual files, just mark types as valid
            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });

        it("should distinguish between grammar imports and type imports", () => {
            // Create grammar file
            const rulesFile = path.join(tempDir, "rules.agr");
            fs.writeFileSync(rulesFile, `@<MyRule> = my rule -> "rule"`);

            const mainFile = path.join(tempDir, "main.agr");
            const mainContent = `
                @import { MyRule } from "./rules.agr"
                @import { MyType } from "./types.ts"

                @<Start> = <MyRule> $(value:MyType) -> { value: $(value) }
            `;

            const errors: string[] = [];
            const grammar = loadGrammarRules(mainFile, mainContent, errors);

            expect(errors).toEqual([]);
            expect(grammar).toBeDefined();
        });
    });
});
