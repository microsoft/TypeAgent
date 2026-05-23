// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Positive-coverage matrix for branch-as-value-producing-node and
// loop-with-continueWhen IR shapes. Each test exercises one cell.
// Negative coverage lives in validate.spec.ts.

import {
    WorkflowIR,
    BranchArm,
    BranchNode,
    LoopNode,
    TaskDefinition,
    validateWorkflowIR,
} from "../src/index.js";

function task(name: string): TaskDefinition {
    return {
        name,
        inputSchema: {},
        outputSchema: {},
        execute: async () => ({ kind: "ok" as const, output: {} }),
    };
}

function taskMap(...names: string[]): Map<string, TaskDefinition> {
    const m = new Map<string, TaskDefinition>();
    for (const n of names) m.set(n, task(n));
    return m;
}

function baseIR(overrides: Partial<WorkflowIR>): WorkflowIR {
    return {
        kind: "workflow",
        name: "branch-loop-ir-coverage",
        version: "1",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        entry: "start",
        nodes: {},
        output: null,
        ...overrides,
    };
}

/** Arm whose single task binds a string-valued result under the given name. */
function stringArm(bindName: string, value: string): BranchArm {
    return {
        inputs: {},
        scope: {
            inputSchema: { type: "object" },
            entry: "t",
            nodes: {
                t: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "string" },
                    inputs: {},
                    bind: bindName,
                },
            },
            output: { $from: "scope", name: bindName },
            outputSchema: { type: "string" },
        },
    };
}

describe("branch/loop IR positive coverage matrix", () => {
    // ---- Cell 1: branch with bind + outputSchema (uniform-output arms) ----
    it("accepts branch with bind+outputSchema (uniform string arms)", () => {
        const branch: BranchNode = {
            kind: "branch",
            selector: { $from: "input", name: "which" },
            selectorSchema: { type: "string", enum: ["a", "b"] },
            cases: {
                a: stringArm("a", "alpha"),
                b: stringArm("b", "beta"),
            },
            bind: "picked",
            outputSchema: { type: "string" },
        };
        const ir = baseIR({
            inputSchema: {
                type: "object",
                required: ["which"],
                properties: { which: { type: "string", enum: ["a", "b"] } },
            },
            entry: "br",
            nodes: { br: branch },
            output: { $from: "scope", name: "picked" },
            outputSchema: { type: "string" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));

        expect(r.valid).toBe(true);
    });

    // ---- Cell 2: branch with mixed-type arms compatible via union outputSchema ----
    it("accepts branch whose arms produce different types unified by anyOf", () => {
        const sArm = stringArm("v", "hi");
        const nArm: BranchArm = {
            inputs: {},
            scope: {
                inputSchema: { type: "object" },
                entry: "t",
                nodes: {
                    t: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "number" },
                        inputs: {},
                        bind: "v",
                    },
                },
                output: { $from: "scope", name: "v" },
                outputSchema: { type: "number" },
            },
        };
        const branch: BranchNode = {
            kind: "branch",
            selector: { $from: "input", name: "which" },
            selectorSchema: { type: "string", enum: ["s", "n"] },
            cases: { s: sArm, n: nArm },
            bind: "picked",
            outputSchema: { anyOf: [{ type: "string" }, { type: "number" }] },
        };
        const ir = baseIR({
            inputSchema: {
                type: "object",
                required: ["which"],
                properties: { which: { type: "string", enum: ["s", "n"] } },
            },
            entry: "br",
            nodes: { br: branch },
            output: { $from: "scope", name: "picked" },
            outputSchema: { anyOf: [{ type: "string" }, { type: "number" }] },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });

    // ---- Cell 3: branch with onError ----
    it("accepts branch with onError pointing to recovery task", () => {
        const branch: BranchNode = {
            kind: "branch",
            selector: { $from: "input", name: "which" },
            selectorSchema: { type: "string", enum: ["a", "b"] },
            cases: { a: stringArm("a", "alpha"), b: stringArm("b", "beta") },
            bind: "picked",
            outputSchema: { type: "string" },
            onError: "recover",
        };
        const ir = baseIR({
            inputSchema: {
                type: "object",
                required: ["which"],
                properties: { which: { type: "string", enum: ["a", "b"] } },
            },
            entry: "br",
            nodes: {
                br: branch,
                recover: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["error", "trigger"],
                        properties: {
                            error: { type: "object" },
                            trigger: { type: "object" },
                        },
                    },
                    outputSchema: { type: "string" },
                    inputs: {},
                    bind: "picked",
                },
            },
            output: { $from: "scope", name: "picked" },
            outputSchema: { type: "string" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });

    // ---- Cell 4: arm-scope `inputs` wiring (templates from outer scope) ----
    it("accepts branch arm whose inputs read from outer scope via template", () => {
        // arm reads `prefix` from the parent scope via arm.inputs.
        const arm: BranchArm = {
            inputs: {
                prefix: { $from: "input", name: "prefix" },
            },
            scope: {
                inputSchema: {
                    type: "object",
                    required: ["prefix"],
                    properties: { prefix: { type: "string" } },
                },
                entry: "t",
                nodes: {
                    t: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["prefix"],
                            properties: { prefix: { type: "string" } },
                        },
                        outputSchema: { type: "string" },
                        inputs: { prefix: { $from: "input", name: "prefix" } },
                        bind: "v",
                    },
                },
                output: { $from: "scope", name: "v" },
                outputSchema: { type: "string" },
            },
        };
        const branch: BranchNode = {
            kind: "branch",
            selector: { $from: "input", name: "which" },
            selectorSchema: { type: "string", enum: ["a"] },
            cases: { a: arm },
            default: stringArm("v", "z"),
            bind: "picked",
            outputSchema: { type: "string" },
        };
        const ir = baseIR({
            inputSchema: {
                type: "object",
                required: ["which", "prefix"],
                properties: {
                    which: { type: "string" },
                    prefix: { type: "string" },
                },
            },
            entry: "br",
            nodes: { br: branch },
            output: { $from: "scope", name: "picked" },
            outputSchema: { type: "string" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });

    // ---- Cell 5: branch as DDG producer (downstream consumes its bind) ----
    it("accepts downstream task reading branch.bind via $from:scope", () => {
        const branch: BranchNode = {
            kind: "branch",
            selector: { $from: "input", name: "which" },
            selectorSchema: { type: "string", enum: ["a", "b"] },
            cases: {
                a: stringArm("a", "alpha"),
                b: stringArm("b", "beta"),
            },
            bind: "picked",
            outputSchema: { type: "string" },
            next: "consumer",
        };
        const ir = baseIR({
            inputSchema: {
                type: "object",
                required: ["which"],
                properties: { which: { type: "string", enum: ["a", "b"] } },
            },
            entry: "br",
            nodes: {
                br: branch,
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["v"],
                        properties: { v: { type: "string" } },
                    },
                    outputSchema: { type: "string" },
                    inputs: { v: { $from: "scope", name: "picked" } },
                    bind: "final",
                },
            },
            output: { $from: "scope", name: "final" },
            outputSchema: { type: "string" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });

    // ---- Cell 7: loop with continueWhen reading body-scoped binding ----
    it("accepts loop whose continueWhen reads a body-scope binding", () => {
        const loop: LoopNode = {
            kind: "loop",
            inputs: {},
            body: {
                inputSchema: { type: "object" },
                entry: "decide",
                nodes: {
                    decide: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "boolean" },
                        inputs: {},
                        bind: "keepGoing",
                    },
                },
                output: { $from: "scope", name: "keepGoing" },
                outputSchema: { type: "boolean" },
            },
            state: {},
            iterateState: {},
            continueWhen: { $from: "scope", name: "keepGoing" },
            maxIterations: 5,
            bind: "out",
        };
        const ir = baseIR({
            entry: "loop",
            nodes: { loop },
            output: { $from: "scope", name: "out" },
            outputSchema: { type: "boolean" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });

    // ---- Cell 8: loop with continueWhen reading state ----
    it("accepts loop whose continueWhen reads loop state", () => {
        const loop: LoopNode = {
            kind: "loop",
            inputs: {},
            body: {
                inputSchema: { type: "object" },
                entry: "step",
                nodes: {
                    step: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                    },
                },
                output: { $from: "state", name: "i" },
                outputSchema: { type: "integer" },
            },
            state: {
                i: { schema: { type: "integer" }, initial: 0 },
                done: { schema: { type: "boolean" }, initial: false },
            },
            iterateState: {
                i: { $from: "state", name: "i" },
                done: { $from: "state", name: "done" },
            },
            continueWhen: { $from: "state", name: "done" },
            maxIterations: 5,
            bind: "out",
        };
        const ir = baseIR({
            entry: "loop",
            nodes: { loop },
            output: { $from: "scope", name: "out" },
            outputSchema: { type: "integer" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });

    // ---- Cell 9: loop with onError + maxIterations ----
    it("accepts loop with onError handler (maxIterations exhaustion path)", () => {
        const loop: LoopNode = {
            kind: "loop",
            inputs: {},
            body: {
                inputSchema: { type: "object" },
                entry: "step",
                nodes: {
                    step: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "boolean" },
                        inputs: {},
                        bind: "keepGoing",
                    },
                },
                output: { $from: "scope", name: "keepGoing" },
                outputSchema: { type: "boolean" },
            },
            state: {},
            iterateState: {},
            continueWhen: { $from: "scope", name: "keepGoing" },
            maxIterations: 3,
            onError: "recover",
            bind: "out",
        };
        const ir = baseIR({
            entry: "loop",
            nodes: {
                loop,
                recover: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["error", "trigger"],
                        properties: {
                            error: { type: "object" },
                            trigger: { type: "object" },
                        },
                    },
                    outputSchema: { type: "boolean" },
                    inputs: {},
                    bind: "out",
                },
            },
            output: { $from: "scope", name: "out" },
            outputSchema: { type: "boolean" },
        });
        const r = validateWorkflowIR(ir, taskMap("noop"));
        expect(r.valid).toBe(true);
    });
});
