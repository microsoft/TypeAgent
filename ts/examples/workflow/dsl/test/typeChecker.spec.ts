// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { TypeChecker, TypeError } from "../src/typeChecker.js";
import { TaskSchemaInfo } from "../src/emitter.js";
import { compile } from "../src/compiler.js";

const TASK_SCHEMAS: TaskSchemaInfo[] = [
    {
        name: "test.template",
        inputSchema: {
            type: "object",
            required: ["template", "vars"],
            properties: {
                template: { type: "string" },
                vars: { type: "object" },
            },
        },
        outputSchema: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
        },
    },
    {
        name: "test.exec",
        inputSchema: {
            type: "object",
            required: ["command"],
            properties: { command: { type: "string" } },
        },
        outputSchema: {
            type: "object",
            required: ["stdout", "exitCode"],
            properties: {
                stdout: { type: "string" },
                exitCode: { type: "integer" },
            },
        },
    },
    {
        name: "test.compute",
        inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "number" } },
        },
        outputSchema: {
            type: "object",
            required: ["result"],
            properties: { result: { type: "number" } },
        },
    },
    {
        name: "test.generateJson",
        inputSchema: {
            type: "object",
            required: ["prompt"],
            properties: { prompt: { type: "string" } },
        },
        outputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: {} },
        },
    },
];

function check(source: string): TypeError[] {
    const { tokens, errors: lexErrors } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens);
    const { workflows, errors: parseErrors } = parser.parse();
    expect(parseErrors).toEqual([]);
    expect(workflows.length).toBeGreaterThan(0);
    const checker = new TypeChecker(TASK_SCHEMAS);
    return checker.checkAll(workflows);
}

function expectNoErrors(source: string): void {
    const errors = check(source);
    if (errors.length > 0) {
        throw new Error(
            `Expected no type errors but got:\n${errors.map((e) => `  ${e.line}:${e.col} ${e.message}`).join("\n")}`,
        );
    }
}

function expectError(source: string, messagePart: string): void {
    const errors = check(source);
    const found = errors.some((e) => e.message.includes(messagePart));
    if (!found) {
        throw new Error(
            `Expected error containing '${messagePart}' but got:\n${errors.length === 0 ? "  (no errors)" : errors.map((e) => `  ${e.message}`).join("\n")}`,
        );
    }
}

describe("type checker", () => {
    // ---- Valid programs ----

    test("empty workflow passes", () => {
        expectNoErrors('workflow test(): string { return "hello"; }');
    });

    test("const with matching type annotation", () => {
        expectNoErrors(`
            workflow test(): string {
                const x: number = 42;
                return "ok";
            }
        `);
    });

    test("dotted name resolution", () => {
        expectNoErrors(`
            workflow test(data: { name: string, count: number }): string {
                const n = data.name;
                return n;
            }
        `);
    });

    test("task call returns typed result", () => {
        expectNoErrors(`
            workflow test(): string {
                const r = test.template(template: "hi", vars: {});
                return r.text;
            }
        `);
    });

    test("numeric comparison", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): boolean {
                return x > y;
            }
        `);
    });

    test("boolean logic", () => {
        expectNoErrors(`
            workflow test(a: boolean, b: boolean): boolean {
                return a && b || !a;
            }
        `);
    });

    test("arithmetic", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): number {
                return x + y * 2 - 1;
            }
        `);
    });

    test("equality with same types", () => {
        expectNoErrors(`
            workflow test(a: string, b: string): boolean {
                return a === b;
            }
        `);
    });

    test("ternary with matching arms", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                return x ? "yes" : "no";
            }
        `);
    });

    test("if with boolean condition", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                if (x) {
                    return "yes";
                }
                return "no";
            }
        `);
    });

    test("template literal always string", () => {
        expectNoErrors(`
            workflow test(name: string): string {
                return \`hello \${name}\`;
            }
        `);
    });

    test("any is not a valid type keyword", () => {
        expectError(
            `workflow test(x: any): string { return "ok"; }`,
            "Unknown type",
        );
    });

    test("map with array collection", () => {
        expectNoErrors(`
            workflow test(items: string[]): string[] {
                return map(items, (item) => {
                    return item;
                });
            }
        `);
    });

    test("filter with array collection", () => {
        expectNoErrors(`
            workflow test(items: number[]): number[] {
                return filter(items, (item) => {
                    return item > 0;
                });
            }
        `);
    });

    test("parallel returns tuple", () => {
        expectNoErrors(`
            workflow test(): string {
                const [a, b] = parallel(
                    () => { return "a"; },
                    () => { return 42; }
                );
                return a;
            }
        `);
    });

    test("attempts valid", () => {
        expectNoErrors(`
            workflow test(): { stdout: string, exitCode: integer } {
                return attempts(3, () => {
                    return test.exec(command: "echo hi");
                });
            }
        `);
    });

    test("switch statement", () => {
        expectNoErrors(`
            workflow test(x: string): string {
                switch (x) {
                    case "a":
                        return "alpha";
                    default:
                        return "other";
                }
            }
        `);
    });

    test("throw statement", () => {
        expectNoErrors(`
            workflow test(): string {
                throw "error";
            }
        `);
    });

    test("destructuring from parallel (tuple)", () => {
        expectNoErrors(`
            workflow test(): string {
                const [a, b] = parallel(
                    () => { return "x"; },
                    () => { return 42; }
                );
                return a;
            }
        `);
    });

    // ---- Type errors: operators ----

    test("arithmetic on string", () => {
        expectError(
            `workflow test(x: string): number { return x + 1; }`,
            "must be numeric",
        );
    });

    test("arithmetic on boolean", () => {
        expectError(
            `workflow test(x: boolean): number { return x * 2; }`,
            "must be numeric",
        );
    });

    test("comparison on string vs number", () => {
        expectError(
            `workflow test(x: string): boolean { return x > 0; }`,
            "must be numeric",
        );
    });

    test("=== with mixed types", () => {
        expectError(
            `workflow test(x: number): boolean { return x === "5"; }`,
            "same types",
        );
    });

    test("&& with non-boolean", () => {
        expectError(
            `workflow test(x: number, y: boolean): boolean { return x && y; }`,
            "must be boolean",
        );
    });

    test("|| with non-boolean", () => {
        expectError(
            `workflow test(x: string, y: boolean): boolean { return x || y; }`,
            "must be boolean",
        );
    });

    test("! on non-boolean", () => {
        expectError(
            `workflow test(x: number): boolean { return !x; }`,
            "must be boolean",
        );
    });

    test("unary minus on string", () => {
        expectError(
            `workflow test(x: string): number { return -x; }`,
            "must be numeric",
        );
    });

    // ---- Type errors: references ----

    test("unknown variable", () => {
        expectError(
            `workflow test(): string { return unknown; }`,
            "Unknown reference",
        );
    });

    test("unknown task", () => {
        expectError(
            `workflow test(): string { return fake.task(); }`,
            "Unknown task",
        );
    });

    test("field access on non-object", () => {
        expectError(
            `workflow test(x: number): string { return x.name; }`,
            "Cannot access property",
        );
    });

    test("unknown field on object", () => {
        expectError(
            `workflow test(x: { name: string }): string { return x.age; }`,
            "does not exist",
        );
    });

    test("unknown type annotation", () => {
        expectError(
            `workflow test(x: mystery): string { return "ok"; }`,
            "Unknown type",
        );
    });

    // ---- Type errors: control flow ----

    test("if with non-boolean condition", () => {
        expectError(
            `workflow test(x: number): string {
                if (x) { return "yes"; }
                return "no";
            }`,
            "must be boolean",
        );
    });

    test("ternary with non-boolean condition", () => {
        expectError(
            `workflow test(x: string): string { return x ? "a" : "b"; }`,
            "must be boolean",
        );
    });

    test("ternary arms with different types", () => {
        expectError(
            `workflow test(x: boolean): string { return x ? "text" : 42; }`,
            "same type",
        );
    });

    // ---- Type errors: collections ----

    test("map on non-array", () => {
        expectError(
            `workflow test(x: string): string {
                return map(x, (item) => { return item; });
            }`,
            "must be an array",
        );
    });

    test("filter on non-array", () => {
        expectError(
            `workflow test(x: number): number {
                return filter(x, (item) => { return true; });
            }`,
            "must be an array",
        );
    });

    test("parallelMap on non-array", () => {
        expectError(
            `workflow test(x: string): string {
                return parallelMap(x, (item) => { return item; });
            }`,
            "must be an array",
        );
    });

    // ---- Type errors: const annotation mismatch ----

    test("const type annotation mismatch", () => {
        expectError(
            `workflow test(): string {
                const x: number = "hello";
                return x;
            }`,
            "not assignable",
        );
    });

    // ---- Destructuring ----

    test("destructuring non-array/tuple", () => {
        expectError(
            `workflow test(x: string): string {
                const [a, b] = x;
                return a;
            }`,
            "Cannot destructure",
        );
    });

    // ---- Type errors: return type mismatch ----

    test("workflow return type mismatch", () => {
        expectError(
            `workflow test(): number { return "hello"; }`,
            "not assignable to declared type",
        );
    });

    test("workflow return type matches", () => {
        expectNoErrors(`workflow test(): string { return "hello"; }`);
    });

    // ---- Type errors: built-in argument validation ----

    test("attempts count must be numeric", () => {
        expectError(
            `workflow test(): number {
                return attempts("hello", () => { return 1; });
            }`,
            "count must be numeric",
        );
    });

    test("maxConcurrency must be numeric", () => {
        expectError(
            `workflow test(): string {
                const [a] = parallel(
                    () => { return 1; },
                    { maxConcurrency: "fast" }
                );
                return "ok";
            }`,
            "maxConcurrency must be numeric",
        );
    });

    // ---- never type ----

    test("never is accepted as a return type", () => {
        expectNoErrors(`workflow test(): never { throw "boom"; }`);
    });

    test("never is compatible with any declared return type", () => {
        expectNoErrors(`workflow test(): string { throw "boom"; }`);
    });

    test("concrete type is not assignable to never", () => {
        expectError(
            `workflow test(): never { return "hello"; }`,
            "not assignable to declared type",
        );
    });

    test("ternary with never arm matches the other arm's type", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom"; }
            workflow test(x: boolean): string {
                return x ? "ok" : fail();
            }
        `);
    });

    test("ternary with never consequent matches alternate type", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom"; }
            workflow test(x: boolean): string {
                return x ? fail() : "ok";
            }
        `);
    });

    test("ternary with both arms never is valid", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom"; }
            workflow test(x: boolean): never {
                return x ? fail() : fail();
            }
        `);
    });

    test("=== with never operand does not error", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom"; }
            workflow test(x: string): boolean {
                return x === fail();
            }
        `);
    });

    // ---- unknown type ----

    test("unknown is accepted as a return type", () => {
        expectNoErrors(`workflow test(): unknown { return "hello"; }`);
    });

    test("any concrete type is assignable to declared unknown", () => {
        expectNoErrors(`
            workflow test(): unknown {
                const x = 42;
                return x;
            }
        `);
    });

    test("unknown source is not assignable to concrete target", () => {
        expectError(
            `workflow test(): string {
                const r = test.generateJson(prompt: "give me json");
                return r.value;
            }`,
            "not assignable to declared type",
        );
    });

    test("field access on unknown type errors", () => {
        expectError(
            `workflow test(): unknown {
                const r = test.generateJson(prompt: "give me json");
                return r.value.foo;
            }`,
            "Cannot access property 'foo' on unknown type",
        );
    });

    test("=== with unknown operand does not error", () => {
        expectNoErrors(`
            workflow test(x: string): boolean {
                const r = test.generateJson(prompt: "check");
                return x === r.value;
            }
        `);
    });

    test("ternary with unknown and concrete arms reports type mismatch", () => {
        expectError(
            `workflow test(flag: boolean): unknown {
                const r = test.generateJson(prompt: "maybe");
                return flag ? "ok" : r.value;
            }`,
            "Ternary arms must have the same type",
        );
    });

    test("unknown param is not assignable to concrete return", () => {
        expectError(
            `workflow test(x: unknown): string { return x; }`,
            "not assignable to declared type",
        );
    });

    test("never is assignable to unknown", () => {
        expectNoErrors(`
            workflow test(): unknown { throw "boom"; }
        `);
    });

    // ---- Phase 3: workflow composition ----

    describe("composition (sub-workflows)", () => {
        test("cross-workflow call type-checks against callee signature", () => {
            expectNoErrors(`
                workflow helper(n: number): number { return n; }
                workflow main(x: number): number {
                    const r = helper(x);
                    return r;
                }
            `);
        });

        test("unknown workflow name is an error", () => {
            expectError(
                `workflow main(): number { const r = ghost(1); return r; }`,
                "Unknown workflow",
            );
        });

        test("argument type mismatch on workflow call", () => {
            expectError(
                `
                workflow helper(n: number): number { return n; }
                workflow main(s: string): number {
                    const r = helper(s);
                    return r;
                }
            `,
                "not assignable to parameter 'n'",
            );
        });

        test("too many positional arguments", () => {
            expectError(
                `
                workflow helper(n: number): number { return n; }
                workflow main(): number {
                    const r = helper(1, 2);
                    return r;
                }
            `,
                "Too many arguments",
            );
        });

        test("named argument resolves to parameter", () => {
            expectNoErrors(`
                workflow helper(n: number, m: number): number { return n; }
                workflow main(): number {
                    const r = helper(n: 1, m: 2);
                    return r;
                }
            `);
        });

        test("unknown named argument is an error", () => {
            expectError(
                `
                workflow helper(n: number): number { return n; }
                workflow main(): number {
                    const r = helper(bogus: 1);
                    return r;
                }
            `,
                "Unknown parameter 'bogus'",
            );
        });

        test("named-record argument syntax (single object literal)", () => {
            expectNoErrors(`
                workflow helper(n: number, m: number): number { return n; }
                workflow main(): number {
                    const r = helper({ n: 1, m: 2 });
                    return r;
                }
            `);
        });

        test("named-record with unknown key is an error", () => {
            expectError(
                `
                workflow helper(n: number): number { return n; }
                workflow main(): number {
                    const r = helper({ n: 1, extra: 2 });
                    return r;
                }
            `,
                "Unknown parameter 'extra'",
            );
        });

        test("missing required argument", () => {
            expectError(
                `
                workflow helper(n: number, m: number): number { return n; }
                workflow main(): number {
                    const r = helper(n: 1);
                    return r;
                }
            `,
                "Missing required parameter 'm'",
            );
        });

        test("parameter with default may be omitted", () => {
            expectNoErrors(`
                workflow helper(n: number, m: number = 0): number { return n; }
                workflow main(): number {
                    const r = helper(1);
                    return r;
                }
            `);
        });

        test("default expression must match parameter type", () => {
            expectError(
                `workflow helper(n: number, m: number = "no"): number { return n; }`,
                "Default value of type 'string' is not assignable",
            );
        });

        test("default expression can reference earlier parameter", () => {
            expectNoErrors(`
                workflow helper(a: number, b: number = a): number { return b; }
            `);
        });

        test("direct recursion is an error", () => {
            expectError(
                `
                workflow self(n: number): number {
                    const r = self(n);
                    return r;
                }
            `,
                "Recursive workflow call",
            );
        });

        test("mutual recursion is an error", () => {
            expectError(
                `
                workflow a(n: number): number { const r = b(n); return r; }
                workflow b(n: number): number { const r = a(n); return r; }
            `,
                "Recursive workflow call",
            );
        });

        test("task/workflow name shadow is an error", () => {
            // Build a checker with a single-segment task that collides
            // with a workflow name.
            const { tokens } = lex(`workflow myTask(): number { return 1; }`);
            const { workflows } = new Parser(tokens).parse();
            const checker = new TypeChecker([
                {
                    name: "myTask",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "number" },
                },
            ]);
            const errors = checker.checkAll(workflows);
            expect(
                errors.some((e) => e.message.includes("shadows a task")),
            ).toBe(true);
        });

        test("positional after named is an error", () => {
            expectError(
                `
                workflow helper(n: number, m: number): number { return n; }
                workflow main(): number {
                    const r = helper(n: 1, 2);
                    return r;
                }
            `,
                "Positional argument follows named argument",
            );
        });

        test("duplicate workflow declaration", () => {
            expectError(
                `
                workflow dup(): number { return 1; }
                workflow dup(): number { return 2; }
            `,
                "Duplicate workflow declaration",
            );
        });

        // ---- Gap-analysis: recursion through nested control flow ----

        test("recursion detected through if branch", () => {
            expectError(
                `
                workflow self(n: number): number {
                    if (n > 0) {
                        const r = self(n);
                        return r;
                    }
                    return n;
                }
            `,
                "Recursive workflow call",
            );
        });

        test("recursion detected through attempts body", () => {
            expectError(
                `
                workflow self(n: number): number {
                    return attempts(3, () => { return self(n); });
                }
            `,
                "Recursive workflow call",
            );
        });

        test("recursion detected through map body", () => {
            expectError(
                `
                workflow self(items: number[]): number[] {
                    return map(items, (i) => { const r = self(items); return r; });
                }
            `,
                "Recursive workflow call",
            );
        });

        test("recursion detected through 3-workflow cycle a->b->c->a", () => {
            expectError(
                `
                workflow a(n: number): number { const r = b(n); return r; }
                workflow b(n: number): number { const r = c(n); return r; }
                workflow c(n: number): number { const r = a(n); return r; }
            `,
                "Recursive workflow call",
            );
        });

        // ---- Gap-analysis: nested calls and shorthand record ----

        test("nested workflow calls flow types correctly", () => {
            expectNoErrors(`
                workflow inner(x: number): number { return x; }
                workflow outer(n: number): number { return n; }
                workflow main(): number {
                    const a = inner(5);
                    const b = outer(a);
                    return b;
                }
            `);
        });

        test("named-record argument with object shorthand", () => {
            expectNoErrors(`
                workflow helper(n: number): number { return n; }
                workflow main(): number {
                    const n = 5;
                    const r = helper({ n });
                    return r;
                }
            `);
        });

        // ---- Second-pass gap fills ----

        test("workflow call as direct return value", () => {
            expectNoErrors(`
                workflow helper(n: number): number { return n; }
                workflow main(): number {
                    return helper(5);
                }
            `);
        });

        test("default expression invoking another workflow", () => {
            expectNoErrors(`
                workflow inner(): number { return 5; }
                workflow helper(x: number = inner()): number { return x; }
            `);
        });

        test("duplicate parameter names is an error", () => {
            expectError(
                `workflow dup(n: number, n: string): number { return n; }`,
                "Duplicate parameter 'n'",
            );
        });

        test("recursion detected through attempts fallback", () => {
            expectError(
                `
                workflow self(): number {
                    return attempts(1, () => { return 0; }, () => { const r = self(); return r; });
                }
            `,
                "Recursive workflow call",
            );
        });
    });

    // ---- Phase 3: compiler entry selection ----

    describe("compiler entry selection", () => {
        test("single workflow becomes the entry", () => {
            const result = compile(
                `workflow onlyOne(): number { return 1; }`,
                TASK_SCHEMAS,
            );
            expect(result.errors).toEqual([]);
            expect(result.ir).toBeDefined();
            expect(result.ir!.entry).toBe("onlyOne");
        });

        test("requested entry not present is an error", () => {
            const result = compile(
                `workflow main(): number { return 1; }`,
                TASK_SCHEMAS,
                { entry: "missing" },
            );
            expect(
                result.errors.some((e: { message: string }) =>
                    e.message.includes("Entry workflow 'missing' not found"),
                ),
            ).toBe(true);
        });

        test("multiple exports without --entry is an error", () => {
            const result = compile(
                `
                export workflow a(): number { return 1; }
                export workflow b(): number { return 2; }
            `,
                TASK_SCHEMAS,
            );
            expect(
                result.errors.some((e: { message: string }) =>
                    e.message.includes(
                        "Multiple 'export workflow' declarations",
                    ),
                ),
            ).toBe(true);
        });

        test("multiple workflows without any export is an error", () => {
            const result = compile(
                `
                workflow a(): number { return 1; }
                workflow b(): number { return 2; }
            `,
                TASK_SCHEMAS,
            );
            expect(
                result.errors.some((e: { message: string }) =>
                    e.message.includes("none marked 'export'"),
                ),
            ).toBe(true);
        });

        test("one exported workflow selected as entry from a mix", () => {
            const result = compile(
                `
                workflow priv(): number { return 1; }
                export workflow pub(): number { return 2; }
            `,
                TASK_SCHEMAS,
            );
            expect(result.errors).toEqual([]);
            expect(result.ir!.entry).toBe("pub");
        });
    });
});
