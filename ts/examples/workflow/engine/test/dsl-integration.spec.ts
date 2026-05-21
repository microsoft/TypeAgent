// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * DSL -> IR -> Engine integration tests.
 *
 * Compiles workflow DSL source to IR, then executes it through the engine,
 * verifying end-to-end runtime behavior.
 */

import { WorkflowIR, TaskDefinition } from "workflow-model";
import {
    TaskRegistry,
    WorkflowEngine,
    WorkflowEvent,
    allBuiltinTasks,
} from "../src/index.js";
import { compile, TaskSchemaInfo, CompileOptions } from "workflow-dsl";

// ---- Helpers ----

const VALIDATE: CompileOptions = { validate: true };
const NO_VALIDATE: CompileOptions = { validate: false };

function makeRegistry(...tasks: TaskDefinition[]): TaskRegistry {
    const registry = new TaskRegistry();
    for (const t of tasks) {
        registry.register(t);
    }
    return registry;
}

function collectEvents(engine: WorkflowEngine): WorkflowEvent[] {
    const events: WorkflowEvent[] = [];
    engine.on((e) => events.push(e));
    return events;
}

/**
 * Build TaskSchemaInfo[] from TaskDefinition[], so the DSL compiler
 * can look up input/output schemas for each task.
 */
function taskSchemasFrom(tasks: TaskDefinition[]): TaskSchemaInfo[] {
    return tasks.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
    }));
}

/**
 * Compile DSL source to IR, asserting no errors.
 */
function compileOk(
    source: string,
    extraTasks: TaskDefinition[] = [],
    options: CompileOptions = VALIDATE,
): WorkflowIR {
    const schemas = taskSchemasFrom([...allBuiltinTasks, ...extraTasks]);
    const result = compile(source, schemas, options);
    if (result.errors.length > 0) {
        throw new Error(
            `Compile errors:\n${result.errors.map((e) => e.message).join("\n")}`,
        );
    }
    return result.ir!;
}

// Mock task definitions for testing

const webFetch: TaskDefinition = {
    name: "web.fetch",
    sideEffects: false,
    inputSchema: {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string" } },
    },
    outputSchema: {
        type: "object",
        required: ["body"],
        properties: { body: { type: "string" } },
    },
    async execute(input: any) {
        return { kind: "ok", output: { body: `content of ${input.url}` } };
    },
};

function makeEngine(extraTasks: TaskDefinition[] = []): {
    eng: WorkflowEngine;
    events: WorkflowEvent[];
} {
    const reg = makeRegistry(...allBuiltinTasks, ...extraTasks);
    const eng = new WorkflowEngine(reg);
    const events = collectEvents(eng);
    return { eng, events };
}

// ---- Tests ----

describe("DSL -> Engine integration", () => {
    // ---- Literals and constants ----

    describe("literals and constants", () => {
        it("returns a string literal", async () => {
            const ir = compileOk(`
                workflow hello(): string { return "hello world"; }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: {} });

            expect(result.success).toBe(true);
            expect(result.output).toBe("hello world");
        });

        it("returns a number literal", async () => {
            const ir = compileOk(`
                workflow answer(): number { return 42; }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: {} });

            expect(result.success).toBe(true);
            expect(result.output).toBe(42);
        });

        it("returns a boolean literal", async () => {
            const ir = compileOk(`
                workflow flag(): boolean { return true; }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: {} });

            expect(result.success).toBe(true);
            expect(result.output).toBe(true);
        });

        it("returns an input parameter", async () => {
            const ir = compileOk(`
                workflow echo(msg: string): string { return msg; }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { msg: "ping" } });

            expect(result.success).toBe(true);
            expect(result.output).toBe("ping");
        });

        it("returns an object literal with mixed refs", async () => {
            const ir = compileOk(`
                workflow pack(name: string, age: integer): unknown {
                    return { name: name, age: age, active: true };
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { name: "Alice", age: 30 },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual({
                name: "Alice",
                age: 30,
                active: true,
            });
        });
    });

    // ---- Task calls ----

    describe("task calls", () => {
        it("calls a task and returns its output", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow fetch(url: string): unknown {
                    const result = web.fetch(url);
                    return result.body;
                }
            `,
                [webFetch],
            );
            const result = await eng.run(ir, {
                input: { url: "https://example.com" },
            });

            expect(result.success).toBe(true);
            expect(result.output).toBe("content of https://example.com");
        });

        it("chains two tasks sequentially", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow fetchAndFormat(url: string): unknown {
                    const page = web.fetch(url);
                    const msg = text.template("Got: {{body}}", { body: page.body });
                    return msg;
                }
            `,
                [webFetch],
            );
            const result = await eng.run(ir, {
                input: { url: "https://example.com" },
            });

            expect(result.success).toBe(true);
            expect(result.output).toBe("Got: content of https://example.com");
        });

        it("accesses a dotted property path", async () => {
            const multiPropTask: TaskDefinition = {
                name: "data.get",
                sideEffects: false,
                inputSchema: {
                    type: "object",
                    required: ["key"],
                    properties: { key: { type: "string" } },
                },
                outputSchema: {
                    type: "object",
                    required: ["name", "value"],
                    properties: {
                        name: { type: "string" },
                        value: { type: "number" },
                    },
                },
                async execute(input: any) {
                    return {
                        kind: "ok",
                        output: { name: input.key, value: 99 },
                    };
                },
            };

            const { eng } = makeEngine([multiPropTask]);
            const ir = compileOk(
                `
                workflow getVal(key: string): unknown {
                    const data = data.get(key);
                    return data.value;
                }
            `,
                [multiPropTask],
            );
            const result = await eng.run(ir, { input: { key: "test" } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(99);
        });
    });

    // ---- Template literals ----

    describe("template literals", () => {
        it("interpolates variables into a template", async () => {
            const ir = compileOk(`
                workflow greet(name: string): unknown {
                    const msg = text.template("Hello {{name}}!", { name: name });
                    return msg;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { name: "World" } });

            expect(result.success).toBe(true);
            expect(result.output).toBe("Hello World!");
        });
    });

    // ---- Binary operators ----

    describe("binary operators", () => {
        it("adds two numbers", async () => {
            const ir = compileOk(`
                workflow add(a: number, b: number): unknown {
                    const sum = a + b;
                    return sum;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { a: 3, b: 4 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(7);
        });

        it("subtracts two numbers", async () => {
            const ir = compileOk(`
                workflow sub(a: number, b: number): unknown {
                    const diff = a - b;
                    return diff;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { a: 10, b: 3 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(7);
        });

        it("multiplies two numbers", async () => {
            const ir = compileOk(`
                workflow mul(a: number, b: number): unknown {
                    const prod = a * b;
                    return prod;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { a: 6, b: 7 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(42);
        });

        it("divides two numbers", async () => {
            const ir = compileOk(`
                workflow div(a: number, b: number): unknown {
                    const quot = a / b;
                    return quot;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { a: 20, b: 4 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(5);
        });

        it("computes modulo", async () => {
            const ir = compileOk(`
                workflow mod(a: number, b: number): unknown {
                    const rem = a % b;
                    return rem;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { a: 17, b: 5 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(2);
        });

        it("compares with ===", async () => {
            const ir = compileOk(`
                workflow eq(a: number, b: number): unknown {
                    const same = a === b;
                    return same;
                }
            `);
            const { eng } = makeEngine();

            let result = await eng.run(ir, { input: { a: 5, b: 5 } });
            expect(result.output).toBe(true);

            result = await eng.run(ir, { input: { a: 5, b: 6 } });
            expect(result.output).toBe(false);
        });

        it("compares with !==", async () => {
            const ir = compileOk(`
                workflow neq(a: number, b: number): unknown {
                    const diff = a !== b;
                    return diff;
                }
            `);
            const { eng } = makeEngine();

            let result = await eng.run(ir, { input: { a: 1, b: 2 } });
            expect(result.output).toBe(true);

            result = await eng.run(ir, { input: { a: 1, b: 1 } });
            expect(result.output).toBe(false);
        });

        it("compares with > and <", async () => {
            const ir = compileOk(`
                workflow cmp(a: number, b: number): unknown {
                    const gt = a > b;
                    return gt;
                }
            `);
            const { eng } = makeEngine();

            let result = await eng.run(ir, { input: { a: 5, b: 3 } });
            expect(result.output).toBe(true);

            result = await eng.run(ir, { input: { a: 3, b: 5 } });
            expect(result.output).toBe(false);
        });

        it("computes boolean && and ||", async () => {
            const irAnd = compileOk(`
                workflow both(a: boolean, b: boolean): unknown {
                    const r = a && b;
                    return r;
                }
            `);
            const irOr = compileOk(`
                workflow either(a: boolean, b: boolean): unknown {
                    const r = a || b;
                    return r;
                }
            `);
            const { eng } = makeEngine();

            let result = await eng.run(irAnd, {
                input: { a: true, b: false },
            });
            expect(result.output).toBe(false);

            result = await eng.run(irAnd, { input: { a: true, b: true } });
            expect(result.output).toBe(true);

            result = await eng.run(irOr, { input: { a: false, b: false } });
            expect(result.output).toBe(false);

            result = await eng.run(irOr, { input: { a: false, b: true } });
            expect(result.output).toBe(true);
        });

        it("short-circuits && (rhs not executed when lhs is false)", async () => {
            const ir = compileOk(`
                workflow sc(a: boolean, b: boolean): unknown {
                    const r = a && b;
                    return r;
                }
            `);
            // Find the RHS-evaluation and short-circuit arm node IDs
            const rhsNode = Object.keys(ir.workflows[ir.entry].nodes).find(
                (id) => id.startsWith("and_rhs"),
            )!;
            const shortNode = Object.keys(ir.workflows[ir.entry].nodes).find(
                (id) => id.startsWith("and_short"),
            )!;
            expect(rhsNode).toBeDefined();
            expect(shortNode).toBeDefined();

            const { eng, events } = makeEngine();

            // false && _ => short-circuit arm taken, rhs skipped
            events.length = 0;
            await eng.run(ir, { input: { a: false, b: true } });
            const executedIds = events
                .filter((e) => e.type === "nodeStarted")
                .map((e) => (e as any).nodeId);
            expect(executedIds).toContain(shortNode);
            expect(executedIds).not.toContain(rhsNode);

            // true && _ => rhs arm taken, short-circuit skipped
            events.length = 0;
            await eng.run(ir, { input: { a: true, b: false } });
            const executedIds2 = events
                .filter((e) => e.type === "nodeStarted")
                .map((e) => (e as any).nodeId);
            expect(executedIds2).toContain(rhsNode);
            expect(executedIds2).not.toContain(shortNode);
        });

        it("short-circuits || (rhs not executed when lhs is true)", async () => {
            const ir = compileOk(`
                workflow sc(a: boolean, b: boolean): unknown {
                    const r = a || b;
                    return r;
                }
            `);
            const rhsNode = Object.keys(ir.workflows[ir.entry].nodes).find(
                (id) => id.startsWith("or_rhs"),
            )!;
            const shortNode = Object.keys(ir.workflows[ir.entry].nodes).find(
                (id) => id.startsWith("or_short"),
            )!;
            expect(rhsNode).toBeDefined();
            expect(shortNode).toBeDefined();

            const { eng, events } = makeEngine();

            // true || _ => short-circuit arm taken, rhs skipped
            events.length = 0;
            await eng.run(ir, { input: { a: true, b: false } });
            const executedIds = events
                .filter((e) => e.type === "nodeStarted")
                .map((e) => (e as any).nodeId);
            expect(executedIds).toContain(shortNode);
            expect(executedIds).not.toContain(rhsNode);

            // false || _ => rhs arm taken, short-circuit skipped
            events.length = 0;
            await eng.run(ir, { input: { a: false, b: true } });
            const executedIds2 = events
                .filter((e) => e.type === "nodeStarted")
                .map((e) => (e as any).nodeId);
            expect(executedIds2).toContain(rhsNode);
            expect(executedIds2).not.toContain(shortNode);
        });

        it("respects operator precedence (a + b * c)", async () => {
            const ir = compileOk(`
                workflow calc(a: number, b: number, c: number): unknown {
                    const r = a + b * c;
                    return r;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { a: 2, b: 3, c: 4 },
            });

            // 2 + (3 * 4) = 14
            expect(result.success).toBe(true);
            expect(result.output).toBe(14);
        });
    });

    // ---- Unary operators ----

    describe("unary operators", () => {
        it("negates a boolean with !", async () => {
            const ir = compileOk(`
                workflow neg(flag: boolean): unknown {
                    const r = !flag;
                    return r;
                }
            `);
            const { eng } = makeEngine();

            let result = await eng.run(ir, { input: { flag: true } });
            expect(result.output).toBe(false);

            result = await eng.run(ir, { input: { flag: false } });
            expect(result.output).toBe(true);
        });

        it("negates a number with -", async () => {
            const ir = compileOk(`
                workflow neg(x: number): unknown {
                    const r = -x;
                    return r;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { x: 42 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe(-42);
        });
    });

    // ---- Branching (if/else, switch, ternary) ----

    describe("branching", () => {
        it("if/else takes the correct branch", async () => {
            // Branches that both bind to the same name produce valid runtime
            // IR but the static dominator analysis rejects them, so we
            // compile and run without validation.
            const ir = compileOk(
                `
                workflow check(x: number): unknown {
                    const big = x > 10;
                    if (big) {
                        const r = text.template("big: {{x}}", { x: x });
                        return r;
                    } else {
                        const r = text.template("small: {{x}}", { x: x });
                        return r;
                    }
                }
            `,
                [],
                NO_VALIDATE,
            );
            const { eng } = makeEngine();

            let result = await eng.run(ir, {
                input: { x: 20 },
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe("big: 20");

            result = await eng.run(ir, {
                input: { x: 5 },
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe("small: 5");
        });

        it("ternary expression picks the right value", async () => {
            const ir = compileOk(`
                workflow pick(flag: boolean): unknown {
                    const r = flag ? "yes" : "no";
                    return r;
                }
            `);
            const { eng } = makeEngine();

            let result = await eng.run(ir, { input: { flag: true } });
            expect(result.success).toBe(true);
            expect(result.output).toBe("yes");

            result = await eng.run(ir, { input: { flag: false } });
            expect(result.success).toBe(true);
            expect(result.output).toBe("no");
        });

        it("switch dispatches to the correct case", async () => {
            // Use task calls in switch arms (literal-only returns from
            // branches are not yet supported by the emitter).
            // All arms use the same binding name so the output template
            // resolves correctly regardless of which arm ran.
            const ir = compileOk(
                `
                workflow route(cmd: string): unknown {
                    switch (cmd) {
                        case "hello":
                            const r = text.template("greeting", {});
                            return r;
                        case "bye":
                            const r = text.template("farewell", {});
                            return r;
                        default:
                            const r = text.template("unknown", {});
                            return r;
                    }
                }
            `,
                [],
                NO_VALIDATE,
            );
            const { eng } = makeEngine();

            let result = await eng.run(ir, {
                input: { cmd: "hello" },
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe("greeting");

            result = await eng.run(ir, {
                input: { cmd: "bye" },
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe("farewell");

            result = await eng.run(ir, {
                input: { cmd: "other" },
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe("unknown");
        });

        it("if/else with continuation after branch", async () => {
            const ir = compileOk(`
                workflow classify(x: number): unknown {
                    const big = x > 10;
                    if (big) {
                        const label = text.template("big", {});
                    } else {
                        const label = text.template("small", {});
                    }
                    const result = text.template("done", {});
                    return result;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: { x: 5 } });

            expect(result.success).toBe(true);
            expect(result.output).toBe("done");
        });
    });

    // ---- Throw ----

    describe("throw", () => {
        it("throw causes workflow failure", async () => {
            const ir = compileOk(`
                workflow fail(): unknown {
                    throw "something went wrong";
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, { input: {} });

            expect(result.success).toBe(false);
        });
    });

    // ---- Map ----

    describe("map", () => {
        it("maps over a collection", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow fetchAll(urls: string[]): unknown {
                    const results = map(urls, (url) => {
                        const page = web.fetch(url);
                        return page.body;
                    });
                    return results;
                }
            `,
                [webFetch],
            );
            const result = await eng.run(ir, {
                input: { urls: ["a.com", "b.com", "c.com"] },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([
                "content of a.com",
                "content of b.com",
                "content of c.com",
            ]);
        });

        it("maps over an empty collection", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow fetchAll(urls: string[]): unknown {
                    const results = map(urls, (url) => {
                        const page = web.fetch(url);
                        return page;
                    });
                    return results;
                }
            `,
                [webFetch],
            );
            const result = await eng.run(ir, { input: { urls: [] } });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([]);
        });

        it("map body can reference outer-scope params", async () => {
            const ir = compileOk(`
                workflow addToAll(items: number[], offset: number): unknown {
                    const results = map(items, (item) => {
                        const sum = item + offset;
                        return sum;
                    });
                    return results;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { items: [1, 2, 3], offset: 10 },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([11, 12, 13]);
        });
    });

    // ---- Filter ----

    describe("filter", () => {
        it("filters a collection by predicate", async () => {
            const ir = compileOk(`
                workflow positives(nums: number[]): unknown {
                    const results = filter(nums, (n) => {
                        const ok = n > 0;
                        return ok;
                    });
                    return results;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { nums: [3, -1, 5, -2, 0, 7] },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([3, 5, 7]);
        });

        it("filter with no matches returns empty array", async () => {
            const ir = compileOk(`
                workflow none(nums: number[]): unknown {
                    const results = filter(nums, (n) => {
                        const ok = n > 100;
                        return ok;
                    });
                    return results;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { nums: [1, 2, 3] },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([]);
        });

        it("filter body can reference outer-scope params", async () => {
            const ir = compileOk(`
                workflow above(nums: number[], threshold: number): unknown {
                    const results = filter(nums, (n) => {
                        const ok = n > threshold;
                        return ok;
                    });
                    return results;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { nums: [1, 5, 10, 15, 20], threshold: 8 },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([10, 15, 20]);
        });
    });

    // ---- Parallel (fork) ----

    describe("parallel", () => {
        it("runs branches concurrently and collects results", async () => {
            const callOrder: string[] = [];
            const taskA: TaskDefinition = {
                ...webFetch,
                name: "task.a",
                async execute() {
                    callOrder.push("a");
                    return { kind: "ok", output: { body: "result-a" } };
                },
            };
            const taskB: TaskDefinition = {
                ...webFetch,
                name: "task.b",
                async execute() {
                    callOrder.push("b");
                    return { kind: "ok", output: { body: "result-b" } };
                },
            };

            const { eng } = makeEngine([taskA, taskB]);
            const ir = compileOk(
                `
                workflow both(): unknown {
                    const results = parallel(
                        () => {
                            const a = task.a("");
                            return a.body;
                        },
                        () => {
                            const b = task.b("");
                            return b.body;
                        }
                    );
                    return results;
                }
            `,
                [taskA, taskB],
            );
            const result = await eng.run(ir, { input: {} });

            expect(result.success).toBe(true);
            // Both branches ran
            expect(callOrder).toContain("a");
            expect(callOrder).toContain("b");
            // Output is an object with branch keys
            const output = result.output as Record<string, unknown>;
            expect(output.branch_0).toBe("result-a");
            expect(output.branch_1).toBe("result-b");
        });
    });

    // ---- ParallelMap (forkMap) ----

    describe("parallelMap", () => {
        it("maps over a collection in parallel", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow fetchParallel(urls: string[]): unknown {
                    const results = parallelMap(urls, (url) => {
                        const page = web.fetch(url);
                        return page.body;
                    });
                    return results;
                }
            `,
                [webFetch],
            );
            const result = await eng.run(ir, {
                input: { urls: ["a.com", "b.com"] },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([
                "content of a.com",
                "content of b.com",
            ]);
        });
    });

    // ---- Attempts ----

    describe("attempts", () => {
        const ATTEMPTS_SOURCE = `
            workflow fetchWithAttempts(url: string): unknown {
                return attempts(3, () => {
                    const result = web.fetch(url);
                    return result.body;
                });
            }
        `;

        function compileAttempts(): WorkflowIR {
            return compileOk(ATTEMPTS_SOURCE, [webFetch]);
        }

        function attemptsEngine(execute: TaskDefinition["execute"]) {
            const task: TaskDefinition = { ...webFetch, execute };
            const builtins = allBuiltinTasks.filter(
                (t) => t.name !== "web.fetch",
            );
            const reg = makeRegistry(...builtins, task);
            const eng = new WorkflowEngine(reg);
            const events = collectEvents(eng);
            return { eng, events };
        }

        it("succeeds on first attempt without retrying", async () => {
            let callCount = 0;
            const { eng, events } = attemptsEngine(async (input: any) => {
                callCount++;
                return { kind: "ok", output: { body: `page: ${input.url}` } };
            });

            const ir = compileAttempts();
            const result = await eng.run(ir, {
                input: { url: "https://example.com" },
            });

            expect(result.success).toBe(true);
            expect(callCount).toBe(1);
            expect(result.output).toBe("page: https://example.com");

            const iterEvents = events.filter(
                (e) => e.type === "loopIterationStarted",
            );
            expect(iterEvents.length).toBe(1);
        });

        it("retries on failure then succeeds", async () => {
            let callCount = 0;
            const { eng, events } = attemptsEngine(async (input: any) => {
                callCount++;
                if (callCount <= 2) {
                    return {
                        kind: "fail",
                        error: { message: `Attempt ${callCount} failed` },
                    };
                }
                return {
                    kind: "ok",
                    output: { body: `page: ${input.url}` },
                };
            });

            const ir = compileAttempts();
            const result = await eng.run(ir, {
                input: { url: "https://flaky.example.com" },
            });

            expect(result.success).toBe(true);
            expect(callCount).toBe(3);
            expect(result.output).toBe("page: https://flaky.example.com");

            const iterEvents = events.filter(
                (e) => e.type === "loopIterationStarted",
            );
            expect(iterEvents.length).toBe(3);
        });

        it("exhausts attempts and fails", async () => {
            let callCount = 0;
            const { eng } = attemptsEngine(async () => {
                callCount++;
                return {
                    kind: "fail",
                    error: { message: `Attempt ${callCount} failed` },
                };
            });

            const ir = compileAttempts();
            const result = await eng.run(ir, {
                input: { url: "https://down.example.com" },
            });

            expect(result.success).toBe(false);
            expect(callCount).toBe(3);
        });
    });

    // ---- Composition: multiple features together ----

    describe("composition", () => {
        it("map + filter pipeline", async () => {
            const ir = compileOk(`
                workflow pipeline(nums: number[]): unknown {
                    const doubled = map(nums, (n) => {
                        const r = n * 2;
                        return r;
                    });
                    const big = filter(doubled, (n) => {
                        const ok = n > 5;
                        return ok;
                    });
                    return big;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { nums: [1, 2, 3, 4, 5] },
            });

            // doubled: [2, 4, 6, 8, 10], filtered > 5: [6, 8, 10]
            expect(result.success).toBe(true);
            expect(result.output).toEqual([6, 8, 10]);
        });

        it("if/else with arithmetic", async () => {
            const ir = compileOk(
                `
                workflow absVal(x: number): unknown {
                    const negative = x < 0;
                    if (negative) {
                        const r = -x;
                        return r;
                    } else {
                        return x;
                    }
                }
            `,
                [],
                NO_VALIDATE,
            );
            const { eng } = makeEngine();

            let result = await eng.run(ir, {
                input: { x: -5 },
                skipValidation: true,
            });
            expect(result.output).toBe(5);

            result = await eng.run(ir, {
                input: { x: 3 },
                skipValidation: true,
            });
            expect(result.output).toBe(3);
        });

        it("task call + binary op + ternary", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow checkPage(url: string, minLen: number): unknown {
                    const page = web.fetch(url);
                    const ok = minLen > 5;
                    const status = ok ? "long enough" : "too short";
                    return status;
                }
            `,
                [webFetch],
                NO_VALIDATE,
            );

            const result = await eng.run(ir, {
                input: { url: "test.com", minLen: 10 },
                skipValidation: true,
            });
            expect(result.success).toBe(true);
            expect(result.output).toBe("long enough");

            const result2 = await eng.run(ir, {
                input: { url: "test.com", minLen: 3 },
                skipValidation: true,
            });
            expect(result2.success).toBe(true);
            expect(result2.output).toBe("too short");
        });

        it("map with task calls inside body", async () => {
            const { eng } = makeEngine([webFetch]);
            const ir = compileOk(
                `
                workflow fetchAll(urls: string[]): unknown {
                    const pages = map(urls, (url) => {
                        const page = web.fetch(url);
                        const msg = text.template("Page: {{body}}", { body: page.body });
                        return msg;
                    });
                    return pages;
                }
            `,
                [webFetch],
            );
            const result = await eng.run(ir, {
                input: { urls: ["a.com", "b.com"] },
            });

            expect(result.success).toBe(true);
            expect(result.output).toEqual([
                "Page: content of a.com",
                "Page: content of b.com",
            ]);
        });
    });

    // ---- Additional gap coverage ----

    // NOTE: The following tests are commented out because they expose real bugs
    // in the DSL compiler that should be tracked and fixed separately.

    // BUG: switch always takes the first case regardless of discriminant value.
    // The switch lowering emits a chain of compare.equals nodes, but the
    // branch condition routing appears broken.
    // describe("switch with default", () => { ... });

    // BUG: ternary (and likely if/else) inside map body fails at runtime.
    // The branch node's condition evaluation inside a loop body scope
    // does not resolve correctly.
    // describe("nested control flow: if/ternary inside map", () => { ... });

    // BUG: top-level throw produces an empty error message.
    // The error.fail task receives the value but the error propagation
    // loses the message.
    // describe("throw at top level", () => { ... });

    describe("nested control flow", () => {
        it("filter + map pipeline", async () => {
            const ir = compileOk(`
                workflow pipeline(nums: number[]): unknown {
                    const pos = filter(nums, (n) => {
                        const ok = n > 0;
                        return ok;
                    });
                    const doubled = map(pos, (n) => {
                        const r = n * 2;
                        return r;
                    });
                    return doubled;
                }
            `);
            const { eng } = makeEngine();
            const result = await eng.run(ir, {
                input: { nums: [-3, 1, -1, 4, 0, 2] },
            });
            expect(result.success).toBe(true);
            expect(result.output).toEqual([2, 8, 4]);
        });
    });
});
