// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lex } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
import { TypeChecker, TypeError } from "../src/typeChecker.js";
import { TaskSchemaInfo } from "../src/emitter.js";

const TASK_SCHEMAS: TaskSchemaInfo[] = [
    {
        name: "text.template",
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
        name: "shell.exec",
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
        name: "math.compute",
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
];

function check(source: string): TypeError[] {
    const { tokens, errors: lexErrors } = lex(source);
    expect(lexErrors).toEqual([]);
    const parser = new Parser(tokens);
    const { workflows, errors: parseErrors } = parser.parse();
    expect(parseErrors).toEqual([]);
    expect(workflows.length).toBeGreaterThan(0);
    const checker = new TypeChecker(TASK_SCHEMAS, workflows);
    const errors: TypeError[] = [];
    for (const wf of workflows) {
        errors.push(...checker.check(wf));
    }
    return errors;
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
        expectNoErrors('workflow test(): string { return "hello" }');
    });

    test("const with matching type annotation", () => {
        expectNoErrors(`
            workflow test(): string {
                const x: number = 42
                return "ok"
            }
        `);
    });

    test("dotted name resolution", () => {
        expectNoErrors(`
            workflow test(data: { name: string, count: number }): string {
                const n = data.name
                return n
            }
        `);
    });

    test("task call returns typed result", () => {
        expectNoErrors(`
            workflow test(): string {
                const r = text.template(template: "hi", vars: {})
                return r.text
            }
        `);
    });

    test("numeric comparison", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): boolean {
                return x > y
            }
        `);
    });

    test("boolean logic", () => {
        expectNoErrors(`
            workflow test(a: boolean, b: boolean): boolean {
                return a && b || !a
            }
        `);
    });

    test("arithmetic", () => {
        expectNoErrors(`
            workflow test(x: number, y: number): number {
                return x + y * 2 - 1
            }
        `);
    });

    test("equality with same types", () => {
        expectNoErrors(`
            workflow test(a: string, b: string): boolean {
                return a === b
            }
        `);
    });

    test("ternary with matching arms", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                return x ? "yes" : "no"
            }
        `);
    });

    test("if with boolean condition", () => {
        expectNoErrors(`
            workflow test(x: boolean): string {
                if (x) {
                    return "yes"
                }
                return "no"
            }
        `);
    });

    test("template literal always string", () => {
        expectNoErrors(`
            workflow test(name: string): string {
                return \`hello \${name}\`
            }
        `);
    });

    test("any type passes all checks", () => {
        expectNoErrors(`
            workflow test(x: any): any {
                const r = x + 1
                const s = x === "hello"
                return x
            }
        `);
    });

    test("map with array collection", () => {
        expectNoErrors(`
            workflow test(items: string[]): string[] {
                return map(items, (item) => {
                    return item
                })
            }
        `);
    });

    test("filter with array collection", () => {
        expectNoErrors(`
            workflow test(items: number[]): number[] {
                return filter(items, (item) => {
                    return item > 0
                })
            }
        `);
    });

    test("parallel returns tuple", () => {
        expectNoErrors(`
            workflow test(): any {
                return parallel(
                    () => { return "a" },
                    () => { return 42 }
                )
            }
        `);
    });

    test("retry valid", () => {
        expectNoErrors(`
            workflow test(): any {
                return retry(3, () => {
                    return shell.exec(command: "echo hi")
                })
            }
        `);
    });

    test("switch statement", () => {
        expectNoErrors(`
            workflow test(x: string): string {
                switch (x) {
                    case "a":
                        return "alpha"
                    default:
                        return "other"
                }
            }
        `);
    });

    test("throw statement", () => {
        expectNoErrors(`
            workflow test(): string {
                throw "error"
            }
        `);
    });

    test("destructuring from parallel (tuple)", () => {
        expectNoErrors(`
            workflow test(): any {
                const [a, b] = parallel(
                    () => { return "x" },
                    () => { return 42 }
                )
                return a
            }
        `);
    });

    // ---- Type errors: operators ----

    test("arithmetic on string", () => {
        expectError(
            `workflow test(x: string): number { return x + 1 }`,
            "must be numeric",
        );
    });

    test("arithmetic on boolean", () => {
        expectError(
            `workflow test(x: boolean): number { return x * 2 }`,
            "must be numeric",
        );
    });

    test("comparison on string vs number", () => {
        expectError(
            `workflow test(x: string): boolean { return x > 0 }`,
            "must be numeric",
        );
    });

    test("=== with mixed types", () => {
        expectError(
            `workflow test(x: number): boolean { return x === "5" }`,
            "same types",
        );
    });

    test("&& with non-boolean", () => {
        expectError(
            `workflow test(x: number, y: boolean): boolean { return x && y }`,
            "must be boolean",
        );
    });

    test("|| with non-boolean", () => {
        expectError(
            `workflow test(x: string, y: boolean): boolean { return x || y }`,
            "must be boolean",
        );
    });

    test("! on non-boolean", () => {
        expectError(
            `workflow test(x: number): boolean { return !x }`,
            "must be boolean",
        );
    });

    test("unary minus on string", () => {
        expectError(
            `workflow test(x: string): number { return -x }`,
            "must be numeric",
        );
    });

    // ---- Type errors: references ----

    test("unknown variable", () => {
        expectError(
            `workflow test(): string { return unknown }`,
            "Unknown reference",
        );
    });

    test("unknown task", () => {
        expectError(
            `workflow test(): string { return fake.task() }`,
            "Unknown task",
        );
    });

    test("field access on non-object", () => {
        expectError(
            `workflow test(x: number): string { return x.name }`,
            "Cannot access property",
        );
    });

    test("unknown field on object", () => {
        expectError(
            `workflow test(x: { name: string }): string { return x.age }`,
            "does not exist",
        );
    });

    test("unknown type annotation", () => {
        expectError(
            `workflow test(x: mystery): string { return "ok" }`,
            "Unknown type",
        );
    });

    // ---- Type errors: control flow ----

    test("if with non-boolean condition", () => {
        expectError(
            `workflow test(x: number): string {
                if (x) { return "yes" }
                return "no"
            }`,
            "must be boolean",
        );
    });

    test("ternary with non-boolean condition", () => {
        expectError(
            `workflow test(x: string): string { return x ? "a" : "b" }`,
            "must be boolean",
        );
    });

    test("ternary arms with different types", () => {
        expectError(
            `workflow test(x: boolean): any { return x ? "text" : 42 }`,
            "same type",
        );
    });

    // ---- Type errors: collections ----

    test("map on non-array", () => {
        expectError(
            `workflow test(x: string): any {
                return map(x, (item) => { return item })
            }`,
            "must be an array",
        );
    });

    test("filter on non-array", () => {
        expectError(
            `workflow test(x: number): any {
                return filter(x, (item) => { return true })
            }`,
            "must be an array",
        );
    });

    test("parallelMap on non-array", () => {
        expectError(
            `workflow test(x: string): any {
                return parallelMap(x, (item) => { return item })
            }`,
            "must be an array",
        );
    });

    // ---- Type errors: const annotation mismatch ----

    test("const type annotation mismatch", () => {
        expectError(
            `workflow test(): string {
                const x: number = "hello"
                return x
            }`,
            "not assignable",
        );
    });

    // ---- Destructuring ----

    test("destructuring non-array/tuple", () => {
        expectError(
            `workflow test(x: string): any {
                const [a, b] = x
                return a
            }`,
            "Cannot destructure",
        );
    });

    // ---- Type errors: return type mismatch ----

    test("workflow return type mismatch", () => {
        expectError(
            `workflow test(): number { return "hello" }`,
            "not assignable to declared type",
        );
    });

    test("workflow return type matches", () => {
        expectNoErrors(`workflow test(): string { return "hello" }`);
    });

    // ---- Type errors: built-in argument validation ----

    test("retry count must be numeric", () => {
        expectError(
            `workflow test(): any {
                return retry("hello", () => { return 1 })
            }`,
            "count must be numeric",
        );
    });

    test("maxConcurrency must be numeric", () => {
        expectError(
            `workflow test(): any {
                return parallel(
                    () => { return 1 },
                    { maxConcurrency: "fast" }
                )
            }`,
            "maxConcurrency must be numeric",
        );
    });

    // ---- never type ----

    test("never is accepted as a return type", () => {
        expectNoErrors(`workflow test(): never { throw "boom" }`);
    });

    test("never is compatible with any declared return type", () => {
        expectNoErrors(`workflow test(): string { throw "boom" }`);
    });

    test("concrete type is not assignable to never", () => {
        expectError(
            `workflow test(): never { return "hello" }`,
            "not assignable to declared type",
        );
    });

    test("ternary with never arm matches the other arm's type", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom" }
            workflow test(x: boolean): string {
                return x ? "ok" : fail()
            }
        `);
    });

    test("ternary with never consequent matches alternate type", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom" }
            workflow test(x: boolean): string {
                return x ? fail() : "ok"
            }
        `);
    });

    test("ternary with both arms never is valid", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom" }
            workflow test(x: boolean): never {
                return x ? fail() : fail()
            }
        `);
    });

    test("=== with never operand does not error", () => {
        expectNoErrors(`
            workflow fail(): never { throw "boom" }
            workflow test(x: string): boolean {
                return x === fail()
            }
        `);
    });
});
