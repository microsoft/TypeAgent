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
    {
        name: "test.genJson",
        typeParameters: [{ name: "T", default: {} }],
        inputSchema: {
            type: "object",
            required: ["prompt"],
            properties: { prompt: { type: "string" } },
        },
        outputSchema: { $typeParam: "T" },
    },
    {
        name: "test.requiredGeneric",
        typeParameters: [{ name: "T" }],
        inputSchema: {
            type: "object",
            required: ["input"],
            properties: { input: { type: "string" } },
        },
        outputSchema: { $typeParam: "T" },
    },
];

function check(source: string): TypeError[] {
    const { tokens, errors: lexErrors } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens);
    const { module, errors: parseErrors } = parser.parseModule();
    expect(parseErrors).toEqual([]);
    expect(module.workflows.length).toBeGreaterThan(0);
    const checker = new TypeChecker(TASK_SCHEMAS);
    return checker.checkAll(module.workflows);
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
            const { module } = new Parser(tokens).parseModule();
            const checker = new TypeChecker([
                {
                    name: "myTask",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "number" },
                },
            ]);
            const errors = checker.checkAll(module.workflows);
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

        test("recursion detected through parallel maxConcurrency", () => {
            // maxConcurrency accepts an arbitrary numeric expression,
            // including a WorkflowCallExpr. The static recursion check
            // must descend into that expression too.
            expectError(
                `
                workflow pick(): number { const r = self(); return r; }
                workflow self(): number {
                    const t = parallel(
                        () => { return 1; },
                        { maxConcurrency: pick() }
                    );
                    const [x] = t;
                    return x;
                }
            `,
                "Recursive workflow call",
            );
        });

        test("recursion detected through parallelMap maxConcurrency", () => {
            expectError(
                `
                workflow pick(): number { const r = self([1]); return r; }
                workflow self(items: number[]): number[] {
                    return parallelMap(
                        items,
                        (i) => { return i; },
                        { maxConcurrency: pick() }
                    );
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

    // ---- G13: Structural type comparison for objects and arrays ----

    test("object type mismatch in return position", () => {
        expectError(
            `workflow test(): { name: string } {
                return test.exec(command: "ls");
            }`,
            "not assignable to declared type",
        );
    });

    test("object with missing required field in const annotation", () => {
        expectError(
            `workflow test(x: { a: string, b: number }): string {
                const r: { a: string, b: number, c: boolean } = x;
                return r.a;
            }`,
            "not assignable to type",
        );
    });

    test("object type mismatch in ternary arms", () => {
        expectError(
            `workflow test(flag: boolean, x: { a: string }): { a: string } {
                return flag ? x : test.exec(command: "b");
            }`,
            "same type",
        );
    });

    test("array element type mismatch in return position", () => {
        expectError(
            `workflow test(items: string[]): number[] {
                return items;
            }`,
            "not assignable to declared type",
        );
    });

    test("matching object types pass structural check", () => {
        expectNoErrors(`
            workflow test(): { stdout: string, exitCode: integer } {
                return test.exec(command: "ls");
            }
        `);
    });

    test("structural subtype with extra fields is assignable to narrower type", () => {
        expectNoErrors(`
            workflow test(): { stdout: string } {
                return test.exec(command: "ls");
            }
        `);
    });

    test("array element types match pass", () => {
        expectNoErrors(`
            workflow test(items: string[]): string[] {
                return items;
            }
        `);
    });

    test("optional field absent in source is assignable", () => {
        expectNoErrors(`
            workflow test(x: { name: string }): { name: string, tag?: string } {
                return x;
            }
        `);
    });

    test("optional field present in source with wrong type is not assignable", () => {
        expectError(
            `workflow test(x: { name: string, tag: number }): { name: string, tag?: string } {
                return x;
            }`,
            "not assignable to declared type",
        );
    });

    test("ternary narrow then wide object arms errors regardless of order (then=narrow)", () => {
        expectError(
            `workflow test(flag: boolean, a: { x: string }, b: { x: string, y: number }): { x: string } {
                return flag ? a : b;
            }`,
            "same type",
        );
    });

    test("ternary narrow then wide object arms errors regardless of order (then=wide)", () => {
        expectError(
            `workflow test(flag: boolean, a: { x: string }, b: { x: string, y: number }): { x: string, y: number } {
                return flag ? b : a;
            }`,
            "same type",
        );
    });

    test("ternary with identical object types passes", () => {
        expectNoErrors(`
            workflow test(flag: boolean, a: { x: string }, b: { x: string }): { x: string } {
                return flag ? a : b;
            }
        `);
    });

    test("ternary with parallel arms of different tuple lengths errors", () => {
        expectError(
            `workflow test(flag: boolean): string {
                const r = flag
                    ? parallel(() => { return "a"; }, () => { return 1; })
                    : parallel(() => { return "a"; }, () => { return 1; }, () => { return true; });
                const [a] = r;
                return a;
            }`,
            "same type",
        );
    });

    test("optional source field is not assignable to required target field", () => {
        expectError(
            `workflow test(x: { name?: string }): { name: string } {
                return x;
            }`,
            "not assignable to declared type",
        );
    });

    test("required source field satisfies required target field", () => {
        expectNoErrors(`
            workflow test(x: { name: string }): { name: string } {
                return x;
            }
        `);
    });

    // ---- Generic type arguments ----

    test("generic type arg on task allows property access", () => {
        expectNoErrors(`
            workflow test(): string {
                const r = test.genJson<{ name: string }>(prompt: "x");
                return r.name;
            }
        `);
    });

    test("generic type arg with array output", () => {
        expectNoErrors(`
            workflow test(): string[] {
                const r = test.genJson<string[]>(prompt: "x");
                return r;
            }
        `);
    });

    test("generic task without type arg uses default (unknown)", () => {
        expectError(
            `workflow test(): string {
                const r = test.genJson(prompt: "x");
                return r;
            }`,
            "not assignable to declared type",
        );
    });

    test("generic task without type arg allows unknown usage", () => {
        expectNoErrors(`
            workflow test(): unknown {
                const r = test.genJson(prompt: "x");
                return r;
            }
        `);
    });

    test("type arg on non-generic task errors", () => {
        expectError(
            `workflow test(): string {
                const r = test.exec<string>(command: "ls");
                return r.stdout;
            }`,
            "does not accept type arguments",
        );
    });

    test("required generic type param errors when omitted", () => {
        expectError(
            `workflow test(): unknown {
                const r = test.requiredGeneric(input: "x");
                return r;
            }`,
            "requires a type argument",
        );
    });

    test("required generic type param works when provided", () => {
        expectNoErrors(`
            workflow test(): number {
                const r = test.requiredGeneric<number>(input: "x");
                return r;
            }
        `);
    });

    test("too many type args errors", () => {
        expectError(
            `workflow test(): unknown {
                const r = test.genJson<string, number>(prompt: "x");
                return r;
            }`,
            "expects 1 type argument(s) but got 2",
        );
    });

    test("generic type arg with complex object type", () => {
        expectNoErrors(`
            workflow test(): string[] {
                const r = test.genJson<{ items: string[] }>(prompt: "x");
                return r.items;
            }
        `);
    });

    test("generic type arg targeting nested property", () => {
        const { tokens, errors: lexErrors } = lex(`
            workflow test(): { value: string } {
                const r = test.nestedGeneric<string>(prompt: "x");
                return r;
            }
        `);
        expect(lexErrors).toEqual([]);
        const parser = new Parser(tokens);
        const { module, errors: parseErrors } = parser.parseModule();
        expect(parseErrors).toEqual([]);
        const schemas: TaskSchemaInfo[] = [
            {
                name: "test.nestedGeneric",
                typeParameters: [{ name: "T", default: {} }],
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["value"],
                    properties: { value: { $typeParam: "T" } },
                },
            },
        ];
        const checker = new TypeChecker(schemas);
        const errors = checker.checkAll(module.workflows);
        expect(errors).toEqual([]);
    });

    test("generic type arg targeting array items", () => {
        const { tokens, errors: lexErrors } = lex(`
            workflow test(): string[] {
                const r = test.arrayGeneric<string>(prompt: "x");
                return r;
            }
        `);
        expect(lexErrors).toEqual([]);
        const parser = new Parser(tokens);
        const { module, errors: parseErrors } = parser.parseModule();
        expect(parseErrors).toEqual([]);
        const schemas: TaskSchemaInfo[] = [
            {
                name: "test.arrayGeneric",
                typeParameters: [{ name: "T", default: {} }],
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: {
                    type: "array",
                    items: { $typeParam: "T" },
                },
            },
        ];
        const checker = new TypeChecker(schemas);
        const errors = checker.checkAll(module.workflows);
        expect(errors).toEqual([]);
    });

    test("generic type param substituted in multiple output positions", () => {
        const { tokens, errors: lexErrors } = lex(`
            workflow test(): string {
                const r = test.multiSite<string>(prompt: "x");
                const a = r.result;
                const b = r.echo;
                return a;
            }
        `);
        expect(lexErrors).toEqual([]);
        const parser = new Parser(tokens);
        const { module, errors: parseErrors } = parser.parseModule();
        expect(parseErrors).toEqual([]);
        const schemas: TaskSchemaInfo[] = [
            {
                name: "test.multiSite",
                typeParameters: [{ name: "T", default: {} }],
                inputSchema: {
                    type: "object",
                    required: ["prompt"],
                    properties: { prompt: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["result", "echo"],
                    properties: {
                        result: { $typeParam: "T" },
                        echo: { $typeParam: "T" },
                    },
                },
            },
        ];
        const checker = new TypeChecker(schemas);
        const errors = checker.checkAll(module.workflows);
        expect(errors).toEqual([]);
    });

    // ---- resolvedSchemas side map ----

    test("resolvedSchemas map is populated for generic calls", () => {
        const source = `
            workflow test(): unknown {
                const r = test.genJson<{ name: string }>(prompt: "x");
                return r;
            }
        `;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { module } = parser.parseModule();
        const checker = new TypeChecker(TASK_SCHEMAS);
        const errors = checker.checkAll(module.workflows);
        expect(errors).toEqual([]);
        // Should have exactly one resolved schema entry
        expect(checker.resolvedSchemas.size).toBe(1);
        const entry = [...checker.resolvedSchemas.values()][0];
        expect(entry.outputSchema).toEqual({
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
        });
    });

    test("resolvedSchemas uses default when no type arg", () => {
        const source = `
            workflow test(): unknown {
                const r = test.genJson(prompt: "x");
                return r;
            }
        `;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { module } = parser.parseModule();
        const checker = new TypeChecker(TASK_SCHEMAS);
        const errors = checker.checkAll(module.workflows);
        expect(errors).toEqual([]);
        expect(checker.resolvedSchemas.size).toBe(1);
        const entry = [...checker.resolvedSchemas.values()][0];
        // default for test.genJson is {} (unknown)
        expect(entry.outputSchema).toEqual({});
    });

    test("resolvedSchemas has entry per call site", () => {
        const source = `
            workflow test(): unknown {
                const a = test.genJson<string>(prompt: "x");
                const b = test.genJson<number>(prompt: "y");
                return a;
            }
        `;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { module } = parser.parseModule();
        const checker = new TypeChecker(TASK_SCHEMAS);
        const errors = checker.checkAll(module.workflows);
        expect(errors).toEqual([]);
        expect(checker.resolvedSchemas.size).toBe(2);
        const schemas = [...checker.resolvedSchemas.values()];
        const outputs = schemas.map((s) => s.outputSchema);
        expect(outputs).toContainEqual({ type: "string" });
        expect(outputs).toContainEqual({ type: "number" });
    });

    test("resolvedSchemas not populated for non-generic tasks", () => {
        const source = `
            workflow test(): unknown {
                const r = test.exec(command: "ls");
                return r;
            }
        `;
        const { tokens } = lex(source);
        const parser = new Parser(tokens);
        const { module } = parser.parseModule();
        const checker = new TypeChecker(TASK_SCHEMAS);
        checker.checkAll(module.workflows);
        expect(checker.resolvedSchemas.size).toBe(0);
    });

    test("null literal has unknown type", () => {
        expectNoErrors(`
            workflow test(): unknown {
                return null;
            }
        `);
    });

    test("null literal is not assignable to string", () => {
        expectError(
            `workflow test(): string { return null; }`,
            "not assignable to declared type",
        );
    });

    test("integer literal inferred as integer", () => {
        expectNoErrors(`
            workflow test(): integer {
                return 42;
            }
        `);
    });

    test("float literal inferred as number", () => {
        expectNoErrors(`
            workflow test(): number {
                return 3.14;
            }
        `);
    });

    test("integer is assignable to number", () => {
        expectNoErrors(`
            workflow test(): number {
                return 42;
            }
        `);
    });

    test("number is assignable to integer", () => {
        expectNoErrors(`
            workflow test(): integer {
                const x: number = 5;
                return x;
            }
        `);
    });

    test("array literal infers element type from first element", () => {
        expectNoErrors(`
            workflow test(): string[] {
                return ["a", "b", "c"];
            }
        `);
    });

    test("empty array literal has unknown element type", () => {
        expectNoErrors(`
            workflow test(): unknown[] {
                return [];
            }
        `);
    });

    test("object literal infers field types", () => {
        expectNoErrors(`
            workflow test(): { name: string, count: number } {
                return { name: "hello", count: 42 };
            }
        `);
    });

    test("object literal missing field is not assignable", () => {
        expectError(
            `workflow test(): { name: string, count: number } {
                return { name: "hello" };
            }`,
            "not assignable to declared type",
        );
    });

    // ---- Additional operators ----

    test("!== with same types passes", () => {
        expectNoErrors(`
            workflow test(a: string, b: string): boolean {
                return a !== b;
            }
        `);
    });

    test("!== with mixed types errors", () => {
        expectError(
            `workflow test(x: number): boolean { return x !== "5"; }`,
            "same types",
        );
    });

    test(">= comparison", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): boolean {
                return x >= y;
            }
        `);
    });

    test("<= comparison", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): boolean {
                return x <= y;
            }
        `);
    });

    test("< comparison", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): boolean {
                return x < y;
            }
        `);
    });

    test("modulo operator", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): number {
                return x % y;
            }
        `);
    });

    test("modulo on string errors", () => {
        expectError(
            `workflow test(x: string): number { return x % 2; }`,
            "must be numeric",
        );
    });

    test("unary minus on number passes", () => {
        expectNoErrors(`
            workflow test(x: number): number {
                return -x;
            }
        `);
    });

    test("boolean literal", () => {
        expectNoErrors(`
            workflow test(): boolean {
                return true;
            }
        `);
    });

    // ---- Field access edge cases ----

    test("field access on array type errors", () => {
        expectError(
            `workflow test(x: string[]): string { return x.length; }`,
            "Cannot access property",
        );
    });

    test("nested field access (3 segments)", () => {
        expectNoErrors(`
            workflow test(data: { inner: { value: string } }): string {
                return data.inner.value;
            }
        `);
    });

    test("nested field access with intermediate error", () => {
        expectError(
            `workflow test(data: { inner: { value: string } }): string {
                return data.inner.missing;
            }`,
            "does not exist",
        );
    });

    // ---- Destructuring from array ----

    test("destructuring from array assigns element type", () => {
        expectNoErrors(`
            workflow test(items: string[]): string {
                const [a, b] = items;
                return a;
            }
        `);
    });

    // ---- parallelMap ----

    test("parallelMap returns array of body return type", () => {
        expectNoErrors(`
            workflow test(items: string[]): number[] {
                return parallelMap(items, (item) => {
                    return 42;
                });
            }
        `);
    });

    test("parallelMap maxConcurrency must be numeric", () => {
        expectError(
            `workflow test(items: string[]): string[] {
                return parallelMap(items, (item) => { return item; }, { maxConcurrency: "fast" });
            }`,
            "maxConcurrency must be numeric",
        );
    });

    // ---- Switch statement typing ----

    test("switch with numeric discriminant", () => {
        expectNoErrors(`
            workflow test(x: number): string {
                switch (x) {
                    case 1:
                        return "one";
                    case 2:
                        return "two";
                    default:
                        return "other";
                }
            }
        `);
    });

    test("switch return type inferred from first arm", () => {
        expectNoErrors(`
            workflow test(x: string): number {
                switch (x) {
                    case "a":
                        return 1;
                    default:
                        return 0;
                }
            }
        `);
    });

    // ---- If-else ----

    test("if-else both branches type checked", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                if (x) {
                    const r = test.template(template: "yes", vars: {});
                    return r.text;
                } else {
                    return "no";
                }
            }
        `);
    });

    // ---- Attempts fallback ----

    test("attempts with fallback", () => {
        expectNoErrors(`
            workflow test(): string {
                return attempts(3, () => {
                    const r = test.exec(command: "echo hi");
                    return r.stdout;
                }, (err) => {
                    return "fallback";
                });
            }
        `);
    });

    // ---- Filter return type ----

    test("filter returns same array type as input", () => {
        expectNoErrors(`
            workflow test(items: number[]): number[] {
                return filter(items, (item) => {
                    return item > 0;
                });
            }
        `);
    });

    // ---- Template literal with interpolation ----

    test("template literal with multiple interpolations", () => {
        expectNoErrors(`
            workflow test(a: string, b: number): string {
                return \`\${a} is \${b}\`;
            }
        `);
    });

    // ---- Unresolved (error recovery) does not cascade ----

    test("error recovery: access on unknown task does not cascade", () => {
        // Only one error (unknown task), not additional errors from the
        // unresolved result.
        const errors = check(`
            workflow test(): string {
                const r = fake.task(x: 1);
                return r.field;
            }
        `);
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain("Unknown task");
    });

    // ---- Multiple errors accumulate ----

    test("multiple errors reported in same workflow", () => {
        const errors = check(`
            workflow test(x: string): number {
                const a = x + 1;
                const b = x * 2;
                return "hello";
            }
        `);
        // At least: arithmetic on string (x2) + return type mismatch
        expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    // ---- Const annotation overrides inferred type ----

    test("const annotation narrows type for subsequent usage", () => {
        expectNoErrors(`
            workflow test(): string {
                const r: { text: string } = test.template(template: "hi", vars: {});
                return r.text;
            }
        `);
    });

    // ---- Task argument checking ----

    test("task arguments are type-checked", () => {
        expectNoErrors(`
            workflow test(): { text: string } {
                const t = "hello";
                return test.template(template: t, vars: {});
            }
        `);
    });

    // ---- Break statement ----

    test("break statement returns unresolved (no value)", () => {
        expectNoErrors(`
            workflow test(x: string): string {
                switch (x) {
                    case "skip":
                        break;
                    default:
                        return x;
                }
                return "done";
            }
        `);
    });

    // ---- G29: value-producing if/else and switch enforcement ----
    //
    // Type-checker enforces same-type only when ALL arms return a value.
    // Partial-return patterns (e.g. early-return + fall-through, or `break`
    // in some switch arms) are intentionally accepted; the emitter falls
    // back to `{}` outputSchema for those cases pending G18 / phase 5
    // validator follow-up.

    test("value-producing if/else with mismatched arm types errors", () => {
        expectError(
            `
            workflow test(x: boolean): string {
                if (x) { return "a"; } else { return 42; }
            }`,
            "if/else arms must return the same type",
        );
    });

    test("value-producing if/else with matching arm types is OK", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                if (x) { return "a"; } else { return "b"; }
            }
        `);
    });

    test("partial-return if/else is accepted (early return pattern)", () => {
        // `if (x) { return "a" }` with no else followed by `return "b"` is a
        // common early-return pattern — must not error.
        expectNoErrors(`
            workflow test(x: boolean): string {
                if (x) { return "a"; }
                return "b";
            }
        `);
    });

    test("partial-return if/else where else does not return is accepted", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                if (x) { return "a"; } else { const y = "b"; }
                return "c";
            }
        `);
    });

    test("value-producing switch with mismatched arm types errors", () => {
        expectError(
            `
            workflow test(x: string): string {
                switch (x) {
                    case "a": return "x";
                    default: return 42;
                }
            }`,
            "switch arms must return the same type",
        );
    });

    test("switch with break arm is accepted (not all arms return)", () => {
        // `break` in some arms is legal — the switch is not cleanly value-
        // producing and the type checker leaves it untyped.
        expectNoErrors(`
            workflow test(x: string): string {
                switch (x) {
                    case "skip": break;
                    default: return x;
                }
                return "done";
            }
        `);
    });

    test("switch with non-returning arm is accepted (partial-return)", () => {
        expectNoErrors(`
            workflow test(x: string): string {
                switch (x) {
                    case "a": return "x";
                    case "b": const y = "skip";
                    default: return "z";
                }
                return "done";
            }
        `);
    });

    test("value-producing switch with matching arm types is OK", () => {
        expectNoErrors(`
            workflow test(x: string): string {
                switch (x) {
                    case "a": return "x";
                    case "b": return "y";
                    default: return "z";
                }
            }
        `);
    });
});
