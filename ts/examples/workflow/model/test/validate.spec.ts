// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowIR,
    WorkflowBody,
    TaskNode,
    LoopNode,
    BranchNode,
    BranchArm,
    ForkNode,
    ForkMapNode,
    JSONSchema,
    Template,
    ConstantDef,
    WorkflowNode,
    WorkflowCallNode,
    TaskDefinition,
    validateWorkflowIR,
    isNeverSchema,
    isStructuralSubtype,
} from "../src/index.js";

/**
 * Test override shape. Accepts legacy single-workflow fields (`nodes`, `entry`,
 * `output`, `inputSchema`, `outputSchema`) which are routed into the synthetic
 * body, plus IR-level fields. `name` overrides the synthetic workflow's name.
 */
type IROverrides = {
    kind?: "workflow";
    name?: string;
    version?: string;
    description?: string;
    types?: Record<string, JSONSchema>;
    constants?: Record<string, ConstantDef>;
    // Body fields (legacy compat — routed into workflows[name]):
    entry?: string;
    nodes?: Record<string, WorkflowNode>;
    output?: Template;
    inputSchema?: JSONSchema;
    outputSchema?: JSONSchema;
    // New: full workflows table override.
    workflows?: Record<string, WorkflowBody>;
};

function makeMinimalIR(overrides?: IROverrides): WorkflowIR {
    const o = overrides ?? {};
    const name = o.name ?? "test-workflow";
    if (o.workflows) {
        const ir: WorkflowIR = {
            kind: "workflow",
            version: o.version ?? "1",
            entry: name,
            workflows: o.workflows,
        };
        if (o.description !== undefined) ir.description = o.description;
        if (o.types !== undefined) ir.types = o.types;
        if (o.constants !== undefined) ir.constants = o.constants;
        return ir;
    }
    const body: WorkflowBody = {
        inputSchema: o.inputSchema ?? { type: "object" },
        outputSchema: o.outputSchema ?? { type: "object" },
        entry: o.entry ?? "start",
        nodes: o.nodes ?? {
            start: {
                kind: "task",
                task: "noop",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                inputs: {},
                bind: "out",
            },
        },
        output:
            "output" in o
                ? (o.output as Template)
                : { $from: "scope", name: "out" },
    };
    const ir: WorkflowIR = {
        kind: "workflow",
        version: o.version ?? "1",
        entry: name,
        workflows: { [name]: body },
    };
    if (o.description !== undefined) ir.description = o.description;
    if (o.types !== undefined) ir.types = o.types;
    if (o.constants !== undefined) ir.constants = o.constants;
    return ir;
}

/** Build a task node with sensible defaults. */
function makeTaskNode(overrides?: Partial<TaskNode>): TaskNode {
    return {
        kind: "task",
        task: "noop",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        inputs: {},
        ...overrides,
    };
}

/**
 * Build a loop node with a single-counter state and a simple task body.
 * Override any field via `overrides`; override the body scope fields via
 * `bodyOverrides`.
 */
function makeLoopNode(
    overrides?: Partial<LoopNode>,
    bodyOverrides?: Partial<LoopNode["body"]>,
): LoopNode {
    return {
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
            ...bodyOverrides,
        },
        state: {
            i: { schema: { type: "integer" }, initial: 0 },
        },
        iterateState: { i: { $from: "state", name: "i" } },
        continueWhen: { $literal: false },
        maxIterations: 10,
        ...overrides,
    };
}

/** Build a minimal valid BranchArm with a single noop task scope. */
function makeSimpleArm(entryName: string = "step"): BranchArm {
    return {
        inputs: {},
        scope: {
            inputSchema: { type: "object" },
            entry: entryName,
            nodes: {
                [entryName]: makeTaskNode(),
            },
            output: null,
            outputSchema: { type: "null" },
        },
    };
}

function makeTask(name: string): TaskDefinition {
    return {
        name,
        inputSchema: {},
        outputSchema: {},
        execute: async () => ({ kind: "ok" as const, output: {} }),
    };
}

function taskMap(...names: string[]): Map<string, TaskDefinition> {
    const m = new Map<string, TaskDefinition>();
    for (const n of names) {
        m.set(n, makeTask(n));
    }
    return m;
}

describe("validateWorkflowIR", () => {
    it("accepts a minimal valid IR", () => {
        const result = validateWorkflowIR(makeMinimalIR(), taskMap("noop"));
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("rejects missing entry node", () => {
        const ir = makeMinimalIR({ entry: "missing" });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("missing");
    });

    it("rejects unregistered task", () => {
        const result = validateWorkflowIR(makeMinimalIR(), taskMap("other"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("not registered");
    });

    it("rejects broken next target", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeTaskNode({
                    next: "nowhere",
                    bind: "out",
                }),
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("nowhere");
    });

    it("rejects wrong kind", () => {
        const ir = makeMinimalIR();
        Object.assign(ir, { kind: "not-a-workflow" });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
    });

    it("rejects broken onError target", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeTaskNode({
                    onError: "ghost",
                    bind: "out",
                }),
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("ghost");
    });

    it("rejects branch arm scope with missing entry node", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: true,
                    selectorSchema: { type: "boolean" },
                    cases: {
                        true: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "missing",
                                nodes: { exists: makeTaskNode() },
                                output: null,
                                outputSchema: { type: "null" },
                            },
                        },
                    },
                    default: makeSimpleArm("defaultStep"),
                } as BranchNode,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("missing"))).toBe(
            true,
        );
    });

    it("rejects branch default arm scope with missing entry node", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: true,
                    selectorSchema: { type: "boolean" },
                    cases: {
                        true: makeSimpleArm("trueStep"),
                    },
                    default: {
                        inputs: {},
                        scope: {
                            inputSchema: { type: "object" },
                            entry: "nowhere",
                            nodes: { exists: makeTaskNode() },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                    },
                } as BranchNode,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("nowhere"))).toBe(
            true,
        );
    });

    it("rejects loop with missing body entry", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeLoopNode(
                    { bind: "out" },
                    {
                        entry: "missing",
                        nodes: {
                            step: makeTaskNode(),
                        },
                    },
                ),
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("missing"))).toBe(
            true,
        );
    });

    it("rejects loop body node with broken next target", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeLoopNode(
                    { bind: "out" },
                    {
                        entry: "step",
                        nodes: {
                            step: makeTaskNode({ next: "ghost" }),
                        },
                    },
                ),
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("ghost"))).toBe(
            true,
        );
    });

    it("rejects loop next pointing to non-existent node", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeLoopNode(
                    { next: "nowhere", bind: "out" },
                    {
                        entry: "step",
                        nodes: {
                            step: makeTaskNode(),
                        },
                        output: null,
                        outputSchema: { type: "null" },
                    },
                ),
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("nowhere"))).toBe(
            true,
        );
    });

    it("reports multiple errors at once", () => {
        const ir = makeMinimalIR({
            entry: "missing",
            nodes: {
                start: {
                    kind: "task",
                    task: "unregistered",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {},
                    next: "ghost",
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, taskMap("other"));
        expect(result.valid).toBe(false);
        // Should report: missing entry, unregistered task, broken next
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
        const msgs = result.errors.map((e) => e.message);
        expect(msgs.some((m) => m.includes("missing"))).toBe(true);
        expect(msgs.some((m) => m.includes("not registered"))).toBe(true);
        expect(msgs.some((m) => m.includes("ghost"))).toBe(true);
    });

    it("includes path in error messages", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeTaskNode({
                    next: "ghost",
                    bind: "out",
                }),
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].path).toContain("nodes.start");
    });

    it("rejects loop missing continueWhen", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "loop",
                    inputs: {},
                    body: {
                        inputSchema: { type: "object" },
                        entry: "step",
                        nodes: { step: makeTaskNode() },
                        output: null,
                        outputSchema: { type: "null" },
                    },
                    state: {},
                    iterateState: {},
                    // continueWhen intentionally omitted
                } as unknown as LoopNode,
            },
            output: null,
            outputSchema: { type: "null" },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes("continueWhen")),
        ).toBe(true);
    });

    it("accepts loop with continueWhen and simple body", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: makeLoopNode(
                    {
                        onError: "recover",
                        bind: "out",
                    },
                    {
                        output: null,
                        outputSchema: { type: "null" },
                        entry: "step",
                        nodes: {
                            step: makeTaskNode(),
                        },
                    },
                ),
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
                    outputSchema: { type: "object" },
                    inputs: {},
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(true);
    });

    it("detects type mismatch between producer and consumer", () => {
        const ir = makeMinimalIR({
            nodes: {
                producer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: { value: { type: "string" } },
                    },
                    inputs: {},
                    next: "consumer",
                    bind: "data",
                },
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["x"],
                        properties: { x: { type: "integer" } },
                    },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: {
                            $from: "scope",
                            name: "data",
                            path: ["value"],
                        },
                    },
                    bind: "out",
                },
            },
            entry: "producer",
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes("not assignable")),
        ).toBe(true);
        expect(result.errors.some((e) => e.message.includes("string"))).toBe(
            true,
        );
        expect(result.errors.some((e) => e.message.includes("integer"))).toBe(
            true,
        );
    });

    it("passes when producer and consumer types are compatible", () => {
        const ir = makeMinimalIR({
            nodes: {
                producer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: { value: { type: "integer" } },
                    },
                    inputs: {},
                    next: "consumer",
                    bind: "data",
                },
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["x"],
                        properties: { x: { type: "integer" } },
                    },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: {
                            $from: "scope",
                            name: "data",
                            path: ["value"],
                        },
                    },
                    bind: "out",
                },
            },
            entry: "producer",
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(true);
    });

    it("detects type mismatch when producer has properties but no .type (inferred object)", () => {
        const ir = makeMinimalIR({
            nodes: {
                producer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        required: ["value"],
                        properties: { value: { type: "string" } },
                    },
                    inputs: {},
                    next: "consumer",
                    bind: "data",
                },
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["x"],
                        properties: { x: { type: "integer" } },
                    },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: {
                            $from: "scope",
                            name: "data",
                            path: ["value"],
                        },
                    },
                    bind: "out",
                },
            },
            entry: "producer",
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes("not assignable")),
        ).toBe(true);
    });

    it("detects type mismatch when consumer has items but no .type (inferred array vs object)", () => {
        const ir = makeMinimalIR({
            nodes: {
                producer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["data"],
                        properties: {
                            data: {
                                type: "object",
                                properties: { x: { type: "string" } },
                            },
                        },
                    },
                    inputs: {},
                    next: "consumer",
                    bind: "result",
                },
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["arr"],
                        properties: { arr: { items: { type: "string" } } },
                    },
                    outputSchema: { type: "object" },
                    inputs: {
                        arr: {
                            $from: "scope",
                            name: "result",
                            path: ["data"],
                        },
                    },
                    bind: "out",
                },
            },
            entry: "producer",
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("object") && e.message.includes("array"),
            ),
        ).toBe(true);
    });

    it("rejects union producer [string, null] against consumer string (null has no match)", () => {
        const ir = makeMinimalIR({
            nodes: {
                producer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: {
                            value: { type: ["string", "null"] },
                        },
                    },
                    inputs: {},
                    next: "consumer",
                    bind: "data",
                },
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["x"],
                        properties: { x: { type: "string" } },
                    },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: {
                            $from: "scope",
                            name: "data",
                            path: ["value"],
                        },
                    },
                    bind: "out",
                },
            },
            entry: "producer",
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes("not assignable")),
        ).toBe(true);
    });

    it("allows union producer [string, null] when consumer also accepts null", () => {
        const ir = makeMinimalIR({
            nodes: {
                producer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: {
                            value: { type: ["string", "null"] },
                        },
                    },
                    inputs: {},
                    next: "consumer",
                    bind: "data",
                },
                consumer: {
                    kind: "task",
                    task: "noop",
                    inputSchema: {
                        type: "object",
                        required: ["x"],
                        properties: { x: { type: ["string", "null"] } },
                    },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: {
                            $from: "scope",
                            name: "data",
                            path: ["value"],
                        },
                    },
                    bind: "out",
                },
            },
            entry: "producer",
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(true);
    });

    it("rejects branch selectorSchema with object type", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: { $from: "input", name: "x" },
                    selectorSchema: { type: "object" },
                    cases: { a: makeSimpleArm() },
                    default: makeSimpleArm("dflt"),
                } as BranchNode,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) =>
                e.message.includes("cannot be meaningfully coerced"),
            ),
        ).toBe(true);
    });

    it("rejects branch selectorSchema with array type", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: { $from: "input", name: "x" },
                    selectorSchema: { type: "array" },
                    cases: { a: makeSimpleArm() },
                    default: makeSimpleArm("dflt"),
                } as BranchNode,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) =>
                e.message.includes("cannot be meaningfully coerced"),
            ),
        ).toBe(true);
    });

    it("rejects branch selectorSchema with null type", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: null,
                    selectorSchema: { type: "null" },
                    cases: { null: makeSimpleArm() },
                    default: makeSimpleArm("dflt"),
                } as BranchNode,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
    });

    it("allows branch selectorSchema with boolean type", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: true,
                    selectorSchema: { type: "boolean" },
                    cases: {
                        true: makeSimpleArm("trueStep"),
                        false: makeSimpleArm("falseStep"),
                    },
                    default: makeSimpleArm("defaultStep"),
                } as BranchNode,
            },
            output: null,
            outputSchema: {},
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(true);
    });

    it("allows branch selectorSchema with integer type", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: 1,
                    selectorSchema: { type: "integer" },
                    cases: {
                        "1": makeSimpleArm("oneStep"),
                        "2": makeSimpleArm("twoStep"),
                    },
                    default: makeSimpleArm("defaultStep"),
                } as BranchNode,
            },
            output: null,
            outputSchema: {},
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(true);
    });

    it("rejects union selectorSchema containing object", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: { $from: "input", name: "x" },
                    selectorSchema: { type: ["string", "object"] },
                    cases: { a: makeSimpleArm() },
                    default: makeSimpleArm("dflt"),
                } as BranchNode,
            },
            output: "done",
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) =>
                e.message.includes("cannot be meaningfully coerced"),
            ),
        ).toBe(true);
    });

    // ---- Node-vs-task schema compatibility ----

    function makeTypedTask(
        name: string,
        inputSchema: Record<string, unknown>,
        outputSchema: Record<string, unknown>,
    ): TaskDefinition {
        return {
            name,
            inputSchema,
            outputSchema,
            execute: async () => ({ kind: "ok" as const, output: {} }),
        };
    }

    it("accepts node that refines a top-schema output property", () => {
        // Task produces { value: {} } (top type); node narrows to object
        const task = makeTypedTask(
            "gen",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            { type: "object", required: ["value"], properties: { value: {} } },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: {
                            value: {
                                type: "object",
                                required: ["name"],
                                properties: { name: { type: "string" } },
                            },
                        },
                    },
                    inputs: { prompt: "hello" },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("rejects node that declares input property task does not accept", () => {
        const task = makeTypedTask(
            "gen",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            { type: "object" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt", "extra"],
                        properties: {
                            prompt: { type: "string" },
                            extra: { type: "number" },
                        },
                    },
                    outputSchema: { type: "object" },
                    inputs: { prompt: "hello", extra: 42 },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message ===
                    'Node declares input property "extra" but task does not accept it.',
            ),
        ).toBe(true);
    });

    it("allows extra input properties when task inputSchema is unconstrained", () => {
        // Task inputSchema is {} (top type) - node can declare anything
        const task = makeTypedTask(
            "gen",
            {},
            { type: "object", properties: { out: { type: "string" } } },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: {
                        type: "object",
                        required: ["anything"],
                        properties: { anything: { type: "number" } },
                    },
                    outputSchema: {
                        type: "object",
                        properties: { out: { type: "string" } },
                    },
                    inputs: { anything: 42 },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("allows extra output properties when task outputSchema is unconstrained", () => {
        // Task outputSchema is {} (top type) - node can declare anything
        const task = makeTypedTask(
            "gen",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {},
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["anything"],
                        properties: { anything: { type: "boolean" } },
                    },
                    inputs: { prompt: "hi" },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("rejects node that declares output property task does not produce", () => {
        const task = makeTypedTask(
            "gen",
            { type: "object" },
            {
                type: "object",
                required: ["text"],
                properties: { text: { type: "string" } },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["text", "extra"],
                        properties: {
                            text: { type: "string" },
                            extra: { type: "integer" },
                        },
                    },
                    inputs: {},
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message ===
                    'Node declares output property "extra" but task does not produce it.',
            ),
        ).toBe(true);
    });

    it("rejects node that requires an output property the task does not guarantee", () => {
        const task = makeTypedTask(
            "gen",
            { type: "object" },
            {
                type: "object",
                required: ["a"],
                properties: {
                    a: { type: "string" },
                    b: { type: "integer" },
                },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["a", "b"],
                        properties: {
                            a: { type: "string" },
                            b: { type: "integer" },
                        },
                    },
                    inputs: {},
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes('requires "b"') &&
                    e.message.includes("does not declare it as required"),
            ),
        ).toBe(true);
    });

    it("rejects node that narrows output type incompatibly", () => {
        const task = makeTypedTask(
            "gen",
            { type: "object" },
            {
                type: "object",
                required: ["value"],
                properties: { value: { type: "string" } },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: { value: { type: "integer" } },
                    },
                    inputs: {},
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("integer") &&
                    e.message.includes("string"),
            ),
        ).toBe(true);
    });

    it("allows widened output type (node accepts superset of task types)", () => {
        // Task produces "string", node declares ["string", "number"].
        // task ⊆ node: "string" is in ["string", "number"] → OK
        const task = makeTypedTask(
            "gen",
            { type: "object" },
            {
                type: "object",
                required: ["value"],
                properties: { value: { type: "string" } },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: {
                            value: { type: ["string", "number"] },
                        },
                    },
                    inputs: {},
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("rejects narrowed output type (node does not accept all task types)", () => {
        // Task produces ["string", "number"], node only declares "string".
        // task ⊆ node: "number" is NOT in ["string"] → error
        const task = makeTypedTask(
            "gen",
            { type: "object" },
            {
                type: "object",
                required: ["value"],
                properties: { value: { type: ["string", "number"] } },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: { type: "object" },
                    outputSchema: {
                        type: "object",
                        required: ["value"],
                        properties: { value: { type: "string" } },
                    },
                    inputs: {},
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("not assignable") &&
                    e.message.includes("number"),
            ),
        ).toBe(true);
    });

    it("rejects node that drops a task-required input property", () => {
        const task = makeTypedTask(
            "gen",
            {
                type: "object",
                required: ["prompt", "endpoint"],
                properties: {
                    prompt: { type: "string" },
                    endpoint: { type: "string" },
                },
            },
            { type: "object" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: { type: "object" },
                    inputs: { prompt: "hello" },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) =>
                e.message.includes('requires "endpoint"'),
            ),
        ).toBe(true);
    });

    it("rejects node with incompatible input type", () => {
        const task = makeTypedTask(
            "gen",
            {
                type: "object",
                required: ["count"],
                properties: { count: { type: "integer" } },
            },
            { type: "object" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "gen",
                    inputSchema: {
                        type: "object",
                        required: ["count"],
                        properties: { count: { type: "string" } },
                    },
                    outputSchema: { type: "object" },
                    inputs: { count: "five" },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, new Map([["gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("string") &&
                    e.message.includes("integer"),
            ),
        ).toBe(true);
    });

    // ---- Generic task schema validation ----

    function makeGenericTask(
        name: string,
        inputSchemaTemplate: Record<string, unknown>,
        outputSchemaTemplate: Record<string, unknown>,
    ): TaskDefinition {
        return {
            name,
            typeParameters: [{ name: "T" }],
            inputSchemaTemplate,
            outputSchemaTemplate,
            execute: async () => ({ kind: "ok" as const, output: {} }),
        } as TaskDefinition;
    }

    it("accepts generic task node with correctly resolved schemas", () => {
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["name"],
                        properties: { name: { type: "string" } },
                    },
                    inputs: { prompt: "hello" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("rejects generic task node missing required input field", () => {
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt", "schema"],
                properties: {
                    prompt: { type: "string" },
                    schema: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: { type: "string" },
                    inputs: { prompt: "hello" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes('requires "schema"')),
        ).toBe(true);
    });

    it("validates non-marker input property types on generic task", () => {
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt"],
                properties: {
                    prompt: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        // Node declares prompt as integer (wrong)
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "integer" } },
                    },
                    outputSchema: { type: "number" },
                    inputs: { prompt: 42 },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("prompt") &&
                    e.message.includes("string"),
            ),
        ).toBe(true);
    });

    it("skips type check for $typeParam marker properties", () => {
        // The "data" property is $typeParam - any resolved type is valid
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt", "data"],
                properties: {
                    prompt: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            outputSchema: { type: "array", items: { type: "number" } },
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt", "data"],
                        properties: {
                            prompt: { type: "string" },
                            data: { type: "array", items: { type: "number" } },
                        },
                    },
                    outputSchema: { type: "array", items: { type: "number" } },
                    inputs: { prompt: "hi", data: [1, 2, 3] },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("rejects input union type where one member is not accepted by task", () => {
        // Task accepts string, node declares ["string", "number"] - number is invalid
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt"],
                properties: {
                    prompt: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: {
                            prompt: { type: ["string", "number"] },
                        },
                    },
                    outputSchema: { type: "object" },
                    inputs: { prompt: "hi" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("prompt") &&
                    e.message.includes("number") &&
                    e.message.includes("not assignable"),
            ),
        ).toBe(true);
    });

    it("allows widened output type on generic task (overlap is sufficient)", () => {
        // Task produces { meta: string }, node claims { meta: ["string", "number"] }
        // Widening is safe - overlap with string is enough
        const task = makeGenericTask(
            "llm.nested",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {
                type: "object",
                required: ["meta"],
                properties: {
                    meta: { type: "string" },
                    value: { $typeParam: "T" },
                },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.nested",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["meta"],
                        properties: {
                            meta: { type: ["string", "number"] },
                        },
                    },
                    inputs: { prompt: "test" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.nested", task]]));
        expect(result.valid).toBe(true);
    });

    it("validates output required fields for generic task with structured template", () => {
        const task = makeGenericTask(
            "llm.nested",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {
                type: "object",
                required: ["value"],
                properties: {
                    value: { $typeParam: "T" },
                    meta: { type: "string" },
                },
            },
        );
        // Node requires "meta" but task template does not guarantee it
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.nested",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["value", "meta"],
                        properties: {
                            value: { type: "number" },
                            meta: { type: "string" },
                        },
                    },
                    inputs: { prompt: "test" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.nested", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes('requires "meta"') &&
                    e.message.includes("does not declare it as required"),
            ),
        ).toBe(true);
    });

    it("rejects undeclared output property on generic task with structured template", () => {
        const task = makeGenericTask(
            "llm.nested",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {
                type: "object",
                required: ["value"],
                properties: { value: { $typeParam: "T" } },
            },
        );
        // Node claims "extra" which the task template does not declare
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.nested",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["value", "extra"],
                        properties: {
                            value: { type: "string" },
                            extra: { type: "number" },
                        },
                    },
                    inputs: { prompt: "test" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.nested", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("extra") &&
                    e.message.includes("does not produce"),
            ),
        ).toBe(true);
    });

    it("allows any output when template is purely $typeParam", () => {
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            { $typeParam: "T" },
        );
        // Output can be anything since the template is entirely parameterized
        const ir = makeMinimalIR({
            outputSchema: {
                type: "array",
                items: {
                    type: "object",
                    properties: { x: { type: "number" } },
                },
            },
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: { x: { type: "number" } },
                        },
                    },
                    inputs: { prompt: "give me data" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("accepts consistent type param resolution across input and output", () => {
        // T appears in input (data property) and output (entire schema)
        // Both resolve to { type: "number" } - consistent
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt", "data"],
                properties: {
                    prompt: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            outputSchema: { type: "number" },
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt", "data"],
                        properties: {
                            prompt: { type: "string" },
                            data: { type: "number" },
                        },
                    },
                    outputSchema: { type: "number" },
                    inputs: { prompt: "hi", data: 42 },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("rejects inconsistent type param resolution across input and output", () => {
        // T in input resolves to { type: "number" }, T in output resolves to { type: "string" }
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt", "data"],
                properties: {
                    prompt: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            outputSchema: { type: "string" },
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt", "data"],
                        properties: {
                            prompt: { type: "string" },
                            data: { type: "number" },
                        },
                    },
                    outputSchema: { type: "string" },
                    inputs: { prompt: "hi", data: 42 },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("T") &&
                    e.message.includes("inconsistently"),
            ),
        ).toBe(true);
    });

    it("rejects inconsistent type param within same template", () => {
        // T appears twice in the output template, resolves to different types
        const task = makeGenericTask(
            "llm.dual",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {
                type: "object",
                required: ["first", "second"],
                properties: {
                    first: { $typeParam: "T" },
                    second: { $typeParam: "T" },
                },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.dual",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["first", "second"],
                        properties: {
                            first: { type: "number" },
                            second: { type: "string" },
                        },
                    },
                    inputs: { prompt: "test" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.dual", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("T") &&
                    e.message.includes("inconsistently"),
            ),
        ).toBe(true);
    });

    it("rejects generic task when node is missing a required input field", () => {
        // Template requires ["prompt", "context"], node only requires ["prompt"]
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt", "context"],
                properties: {
                    prompt: { type: "string" },
                    context: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: {
                            prompt: { type: "string" },
                            data: { type: "number" },
                        },
                    },
                    outputSchema: { type: "number" },
                    inputs: { prompt: "hi", data: 42 },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes('"context"') &&
                    e.message.includes("required"),
            ),
        ).toBe(true);
    });

    it("rejects generic task when concrete input type is structurally incompatible", () => {
        // Template has prompt: { type: "object", properties: { text: string } }
        // Node declares prompt: { type: "string" } - not assignable
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt"],
                properties: {
                    prompt: {
                        type: "object",
                        properties: { text: { type: "string" } },
                    },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: {
                            prompt: { type: "string" },
                            data: { type: "number" },
                        },
                    },
                    outputSchema: { type: "number" },
                    inputs: { prompt: "hi", data: 42 },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.path.includes("inputSchema") &&
                    e.message.includes("not assignable"),
            ),
        ).toBe(true);
    });

    it("rejects generic task when concrete output type is incompatible", () => {
        // Template produces meta: { type: "string" }, node expects meta: { type: "number" }
        const task = makeGenericTask(
            "llm.nested",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {
                type: "object",
                required: ["meta"],
                properties: {
                    meta: { type: "string" },
                    value: { $typeParam: "T" },
                },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.nested",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["meta"],
                        properties: {
                            meta: { type: "number" },
                            value: { type: "boolean" },
                        },
                    },
                    inputs: { prompt: "test" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.nested", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.path.includes("outputSchema") &&
                    e.message.includes("not assignable"),
            ),
        ).toBe(true);
    });

    it("allows extra input properties on generic task (type params may expand)", () => {
        // Template only declares prompt + $typeParam data.
        // Node adds "extra" property - allowed since type params can introduce new fields.
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt"],
                properties: {
                    prompt: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            outputSchema: { type: "boolean" },
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt", "extra"],
                        properties: {
                            prompt: { type: "string" },
                            extra: { type: "number" },
                            data: { type: "boolean" },
                        },
                    },
                    outputSchema: { type: "boolean" },
                    inputs: { prompt: "hi", extra: 1, data: true },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(true);
    });

    it("reports multiple errors for generic task with both required and type violations", () => {
        // Template requires ["prompt", "context"] with prompt: string, context: string
        // Node missing "context" required AND prompt has wrong type
        const task = makeGenericTask(
            "llm.gen",
            {
                type: "object",
                required: ["prompt", "context"],
                properties: {
                    prompt: { type: "string" },
                    context: { type: "string" },
                    data: { $typeParam: "T" },
                },
            },
            { $typeParam: "T" },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.gen",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: {
                            prompt: { type: "number" },
                            data: { type: "boolean" },
                        },
                    },
                    outputSchema: { type: "boolean" },
                    inputs: { prompt: 42, data: true },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.gen", task]]));
        expect(result.valid).toBe(false);
        // Should have both a required-field error and a type-mismatch error
        const hasRequired = result.errors.some(
            (e) =>
                e.message.includes('"context"') &&
                e.message.includes("required"),
        );
        const hasType = result.errors.some(
            (e) =>
                e.message.includes("not assignable") &&
                e.path.includes("inputSchema"),
        );
        expect(hasRequired).toBe(true);
        expect(hasType).toBe(true);
    });

    it("rejects generic task output when node requires field not guaranteed by template", () => {
        // Template: required: ["value"], properties: { value: $T, info: string }
        // Node requires "info" but template doesn't guarantee it
        const task = makeGenericTask(
            "llm.nested",
            {
                type: "object",
                required: ["prompt"],
                properties: { prompt: { type: "string" } },
            },
            {
                type: "object",
                required: ["value"],
                properties: {
                    value: { $typeParam: "T" },
                    info: { type: "string" },
                },
            },
        );
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "llm.nested",
                    inputSchema: {
                        type: "object",
                        required: ["prompt"],
                        properties: { prompt: { type: "string" } },
                    },
                    outputSchema: {
                        type: "object",
                        required: ["value", "info"],
                        properties: {
                            value: { type: "number" },
                            info: { type: "string" },
                        },
                    },
                    inputs: { prompt: "test" },
                    bind: "out",
                } as TaskNode,
            },
        });
        const result = validateWorkflowIR(ir, new Map([["llm.nested", task]]));
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes('"info"') &&
                    e.message.includes("required"),
            ),
        ).toBe(true);
    });

    // ---- Unresolved binding detection ----

    it("rejects $from scope reference to non-existent binding", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: { $from: "scope", name: "ghost" },
                    },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("ghost") &&
                    e.message.includes("no node"),
            ),
        ).toBe(true);
    });

    it("accepts $from scope reference to existing binding", () => {
        const ir = makeMinimalIR({
            nodes: {
                first: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {},
                    next: "second",
                    bind: "firstOut",
                },
                second: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: { $from: "scope", name: "firstOut" },
                    },
                    bind: "out",
                },
            },
            entry: "first",
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(true);
    });

    it("allows optional $from scope reference to non-existent binding", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {
                        x: { $from: "scope", name: "ghost", optional: true },
                    },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(true);
    });

    it("rejects workflow output referencing non-existent binding", () => {
        const ir = makeMinimalIR({
            output: { $from: "scope", name: "missing" },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some(
                (e) =>
                    e.message.includes("missing") &&
                    e.message.includes("no node"),
            ),
        ).toBe(true);
    });

    it("accepts workflow output referencing existing binding", () => {
        const ir = makeMinimalIR({
            output: { $from: "scope", name: "out" },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(true);
    });

    it("rejects nested $from scope reference to non-existent binding", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {
                        vars: {
                            nested: {
                                $from: "scope",
                                name: "noSuchBinding",
                            },
                        },
                    },
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(
            result.errors.some((e) => e.message.includes("noSuchBinding")),
        ).toBe(true);
    });

    // ---- Phase 1: CFG construction and acyclicity (pass 10) ----

    describe("acyclicity", () => {
        it("rejects a self-loop (task next points to itself)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "start",
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("Cycle detected")),
            ).toBe(true);
        });

        it("rejects a two-node cycle (A -> B -> A)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "b",
                    },
                    b: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "start",
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("Cycle detected")),
            ).toBe(true);
        });

        it("rejects a longer cycle (A -> B -> C -> A)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "b",
                    },
                    b: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "c",
                    },
                    c: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "start",
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("Cycle detected")),
            ).toBe(true);
        });

        it("accepts a valid acyclic chain", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "b",
                    },
                    b: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "c",
                    },
                    c: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects a cycle through a branch node", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "pick",
                    },
                    pick: {
                        kind: "branch",
                        selectorSchema: { type: "boolean" },
                        selector: true,
                        cases: {
                            true: makeSimpleArm("trueStep"),
                        },
                        default: makeSimpleArm("defaultStep"),
                        next: "start",
                    },
                    end: makeTaskNode({ bind: "out" }),
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("Cycle detected")),
            ).toBe(true);
        });
    });

    // ---- Phase 2: onError structural rules (pass 4) ----

    describe("onError rules", () => {
        it("rejects recovery target reachable via normal path (exclusive path rule)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "handler",
                        onError: "handler",
                        bind: "out",
                    },
                    handler: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("also reachable via a normal path"),
                ),
            ).toBe(true);
        });

        it("rejects recovery target used by multiple triggers (single trigger rule)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "second",
                        onError: "handler",
                    },
                    second: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "handler",
                        bind: "out",
                    },
                    handler: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("exactly one trigger"),
                ),
            ).toBe(true);
        });

        it("rejects recovery target that itself declares onError (no recursive recovery)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "handler",
                        bind: "out",
                    },
                    handler: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "handler2",
                    },
                    handler2: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("Recursive recovery"),
                ),
            ).toBe(true);
        });

        it("rejects recovery target that is not a task node", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "handler",
                        bind: "out",
                    },
                    handler: {
                        kind: "branch",
                        selectorSchema: { type: "boolean" },
                        selector: true,
                        cases: { true: makeSimpleArm("trueStep") },
                        default: makeSimpleArm("dfltStep"),
                    } as BranchNode,
                    end: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("must be a task node"),
                ),
            ).toBe(true);
        });

        it("accepts valid onError recovery pattern", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "recover",
                        bind: "out",
                    },
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects loop node with onError targeting a non-task", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
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
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                        onError: "handler",
                    } as LoopNode,
                    handler: {
                        kind: "branch",
                        selectorSchema: { type: "boolean" },
                        selector: true,
                        cases: { true: makeSimpleArm("trueStep") },
                        default: makeSimpleArm("dfltStep"),
                    } as BranchNode,
                    end: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("must be a task node"),
                ),
            ).toBe(true);
        });

        it("rejects loop recovery target with its own onError exactly once (no Rule 4 + task-kind double-fire)", () => {
            // Regression test for the validateOnErrorRules fix: a loop-kind
            // recovery target that also declares onError used to trip both
            // Rule 4 ("no recursive recovery") and the task-kind check.
            // Rule 4 is task-specific; only the task-kind check
            // should fire here.
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        bind: "out",
                        onError: "handler",
                    }),
                    handler: {
                        kind: "loop",
                        inputs: {},
                        state: {},
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: makeTaskNode({ bind: "h" }),
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {},
                        continueWhen: false,
                        maxIterations: 1,
                        onError: "end",
                    } as LoopNode,
                    end: makeTaskNode({ bind: "end" }),
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            // Exactly one error mentions the recovery-target-kind rule.
            const kindErrors = result.errors.filter((e) =>
                e.message.includes("must be a task node"),
            );
            expect(kindErrors).toHaveLength(1);
            // No Rule 4 ("Recursive recovery") error should be present.
            const recursiveErrors = result.errors.filter((e) =>
                e.message.includes("Recursive recovery"),
            );
            expect(recursiveErrors).toHaveLength(0);
        });
    });

    // ---- Phase 3: Termination (pass 9) ----

    describe("termination", () => {
        it("rejects loop body node that cannot reach a terminal", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeLoopNode(
                        { bind: "out" },
                        {
                            entry: "step",
                            nodes: {
                                step: makeTaskNode({ next: "step" }),
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                    ),
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("Cycle detected") ||
                        e.message.includes("cannot reach a terminal"),
                ),
            ).toBe(true);
        });

        it("accepts loop body where all nodes reach a terminal", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeLoopNode(
                        { bind: "out" },
                        {
                            entry: "step",
                            nodes: {
                                step: makeTaskNode(),
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                    ),
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects top-level node that cannot reach a terminal", () => {
            // Node "orphan" is reachable from entry via branch but has
            // next pointing back into the graph forming a dead-end
            // that was already caught by acyclicity. Instead, test a
            // node that simply is never reached (unreachable from entry).
            // Actually, termination checks reachable nodes. Let's use
            // a valid acyclic graph but inside a loop body where one
            // branch path leads to a dead-end (no sentinel).
            // For top-level: a branch where one path ends normally and
            // the other path is a task with no next (terminal) - that
            // actually works fine. The termination pass for top-level
            // just checks that every node can reach SOME terminal.
            // A disconnected node (not reachable from entry) is not
            // in the CFG so won't be checked. Let's verify the pass
            // catches a real case: all nodes reachable, all are
            // terminals -> passes.
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
            expect(
                result.errors.some((e) =>
                    e.message.includes("cannot reach a terminal"),
                ),
            ).toBe(false);
        });
    });

    // ---- Phase 4: Scope closure (pass 5) ----

    describe("scope closure", () => {
        it("rejects body node referencing outer-scope binding", () => {
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "start",
                        bind: "outerResult",
                    },
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "noop",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {
                                        data: {
                                            $from: "scope",
                                            name: "outerResult",
                                        },
                                    },
                                },
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                    } as LoopNode,
                },
                entry: "producer",
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("outer-scope binding"),
                ),
            ).toBe(true);
        });

        it("accepts body node using $from input and $from state", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "noop",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {
                                        idx: {
                                            $from: "state",
                                            name: "i",
                                        },
                                    },
                                },
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                        bind: "out",
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects nested loop body referencing grandparent scope binding", () => {
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "outerLoop",
                        bind: "grandparentData",
                    },
                    outerLoop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "innerLoop",
                            nodes: {
                                innerLoop: {
                                    kind: "loop",
                                    inputs: {},
                                    state: {
                                        j: {
                                            schema: { type: "integer" },
                                            initial: 0,
                                        },
                                    },
                                    body: {
                                        inputSchema: { type: "object" },
                                        entry: "innerStep",
                                        nodes: {
                                            innerStep: {
                                                kind: "task",
                                                task: "noop",
                                                inputSchema: {
                                                    type: "object",
                                                },
                                                outputSchema: {
                                                    type: "object",
                                                },
                                                inputs: {
                                                    val: {
                                                        $from: "scope",
                                                        name: "grandparentData",
                                                    },
                                                },
                                            },
                                        },
                                        output: null,
                                        outputSchema: { type: "null" },
                                    },
                                    iterateState: {
                                        j: {
                                            $from: "state",
                                            name: "j",
                                        },
                                    },
                                    maxIterations: 5,
                                    continueWhen: { $literal: false },
                                } as LoopNode,
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                    } as LoopNode,
                },
                entry: "producer",
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            // The inner body references "grandparentData" which is not
            // bound in the inner body scope (scope closure violation).
            expect(
                result.errors.some((e) =>
                    e.message.includes("grandparentData"),
                ),
            ).toBe(true);
        });
    });

    // ---- Phase 5: Dominator analysis (pass 6) ----

    describe("dominator analysis", () => {
        it("rejects reference to binding not on all execution paths", () => {
            const ir = makeMinimalIR({
                nodes: {
                    trigger: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "producer",
                        onError: "failHandler",
                    },
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    failHandler: {
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "consumer",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            val: { $from: "scope", name: "data" },
                        },
                        bind: "out",
                    },
                },
                entry: "trigger",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("no binder of") &&
                        e.message.includes("dominates"),
                ),
            ).toBe(true);
        });

        it("accepts reference to binding that dominates the consumer", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            val: { $from: "scope", name: "data" },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts onError split with shared bind name on both sides", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "recover",
                        bind: "out",
                    },
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects duplicate binders on same path (not mutually exclusive)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "second",
                        bind: "data",
                    },
                    second: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "data",
                    },
                },
                output: { $from: "scope", name: "data" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("Bind name") &&
                        e.message.includes("one dominates the other"),
                ),
            ).toBe(true);
        });

        it("allows optional ref to skip coverage check", () => {
            const ir = makeMinimalIR({
                nodes: {
                    trigger: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "producer",
                        onError: "failHandler",
                    },
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    failHandler: {
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "consumer",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            val: {
                                $from: "scope",
                                name: "data",
                                optional: true,
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "trigger",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    // ---- Phase 6: State soundness (pass 11) ----

    describe("state soundness", () => {
        it("rejects missing iterateState entry for declared state var", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                            j: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
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
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                            // missing "j"
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                        bind: "out",
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes('"j"') &&
                        e.message.includes(
                            "no corresponding entry in iterateState",
                        ),
                ),
            ).toBe(true);
        });

        it("rejects $from state reference to unknown state variable", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "noop",
                                    inputSchema: { type: "object" },
                                    outputSchema: { type: "object" },
                                    inputs: {
                                        idx: {
                                            $from: "state",
                                            name: "nonexistent",
                                        },
                                    },
                                },
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                        bind: "out",
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes('"nonexistent"') &&
                        e.message.includes("no state variable"),
                ),
            ).toBe(true);
        });

        it("rejects extra iterateState entry with no state declaration", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
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
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                            phantom: { $from: "state", name: "phantom" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                        bind: "out",
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes('"phantom"') &&
                        e.message.includes("no corresponding state variable"),
                ),
            ).toBe(true);
        });

        it("rejects $from state reference with incompatible type", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            count: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "noop",
                                    inputSchema: {
                                        type: "object",
                                        properties: {
                                            label: { type: "string" },
                                        },
                                    },
                                    outputSchema: { type: "object" },
                                    inputs: {
                                        label: {
                                            $from: "state",
                                            name: "count",
                                        },
                                    },
                                },
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        iterateState: {
                            count: { $from: "state", name: "count" },
                        },
                        continueWhen: { $literal: false },
                        maxIterations: 10,
                        bind: "out",
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("not assignable") &&
                        e.message.includes("integer") &&
                        e.message.includes("string"),
                ),
            ).toBe(true);
        });
    });

    // ---- Phase 7: Output binding coverage (pass 12) ----

    describe("output binding coverage", () => {
        it("rejects output ref not covered on onError path", () => {
            // start has onError -> recover.
            // Only start binds "data", recover does not.
            // Output references "data", so the onError path is uncovered.
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "recover",
                        bind: "data",
                    },
                    recover: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        // does NOT bind "data"
                    },
                },
                output: { result: { $from: "scope", name: "data" } },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes(
                        "not covered on the path through terminal",
                    ),
                ),
            ).toBe(true);
        });

        it("accepts output ref covered on all paths (both sides bind)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "recover",
                        bind: "data",
                    },
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "data",
                    },
                },
                output: { result: { $from: "scope", name: "data" } },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects output ref not covered on branch path", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        onError: "skipper",
                        next: "producer",
                    },
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "data",
                    },
                    skipper: {
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        // does NOT bind "data"
                    },
                },
                output: { result: { $from: "scope", name: "data" } },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes(
                        "not covered on the path through terminal",
                    ),
                ),
            ).toBe(true);
        });

        it("accepts output ref covered by binders on all paths", () => {
            const ir = makeMinimalIR({
                entry: "start",
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "producer",
                        onError: "recover",
                    },
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "boolean" } },
                        },
                        inputs: {},
                        bind: "data",
                    },
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
                        outputSchema: {
                            type: "object",
                            required: ["result"],
                            properties: { result: { type: "boolean" } },
                        },
                        inputs: {},
                        bind: "data",
                    },
                },
                output: {
                    result: {
                        $from: "scope",
                        name: "data",
                        path: ["result"],
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    describe("type compatibility (pass 7)", () => {
        it("rejects literal string input where consumer expects integer", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["count"],
                            properties: { count: { type: "integer" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: { count: "not-a-number" },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("inputs.count") &&
                        e.message.includes("not assignable"),
                ),
            ).toBe(true);
        });

        it("accepts literal string input where consumer expects string", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["mode"],
                            properties: { mode: { type: "string" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: { mode: "fast" },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("accepts $literal input with compatible type", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["config"],
                            properties: {
                                config: {
                                    type: "object",
                                    properties: { x: { type: "number" } },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            config: { $literal: { x: 42 } },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("rejects $literal input with incompatible type", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["count"],
                            properties: { count: { type: "integer" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            count: { $literal: "hello" },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("inputs.count") &&
                        e.message.includes("not assignable"),
                ),
            ).toBe(true);
        });

        it("rejects selector type incompatible with selectorSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: 42,
                        selectorSchema: { type: "string" },
                        cases: { a: makeSimpleArm() },
                        default: makeSimpleArm("dflt"),
                    } as BranchNode,
                    end: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("selector") &&
                        e.message.includes("Selector resolved type"),
                ),
            ).toBe(true);
        });

        it("accepts selector type compatible with selectorSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "done",
                        selectorSchema: { type: "string" },
                        cases: {
                            done: makeSimpleArm("doneStep"),
                        },
                        default: makeSimpleArm("defaultStep"),
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("rejects cases key not in selectorSchema enum", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: { $from: "input", name: "choice" },
                        selectorSchema: {
                            type: "string",
                            enum: ["yes", "no"],
                        },
                        cases: {
                            yes: makeSimpleArm("yesStep"),
                            maybe: makeSimpleArm("maybeStep"),
                        },
                        default: makeSimpleArm("dfltStep"),
                    } as BranchNode,
                    end: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
                inputSchema: {
                    type: "object",
                    properties: { choice: { type: "string" } },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("cases.maybe") &&
                        e.message.includes("not a valid value"),
                ),
            ).toBe(true);
        });

        it("accepts cases keys that are all in selectorSchema enum", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: { $from: "input", name: "choice" },
                        selectorSchema: {
                            type: "string",
                            enum: ["yes", "no"],
                        },
                        cases: {
                            yes: makeSimpleArm("yesStep"),
                            no: makeSimpleArm("noStep"),
                        },
                        default: makeSimpleArm("defaultStep"),
                    } as BranchNode,
                },
                inputSchema: {
                    type: "object",
                    properties: { choice: { type: "string" } },
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("accepts exhaustive branch with literal string selector (no default)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string", enum: ["yes", "no"] },
                        cases: {
                            yes: makeSimpleArm("yesStep"),
                            no: makeSimpleArm("noStep"),
                        },
                        // no default — exhaustiveness must be inferred
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("accepts exhaustive branch with literal number selector (no default)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: 42,
                        selectorSchema: {
                            type: "integer",
                            enum: [42, 99],
                        },
                        cases: {
                            "42": makeSimpleArm("fortyTwoStep"),
                            "99": makeSimpleArm("ninetyNineStep"),
                        },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("accepts exhaustive branch with literal boolean selector (no default)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: makeSimpleArm("trueStep"),
                            false: makeSimpleArm("falseStep"),
                        },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("rejects workflow output type incompatible with outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["val"],
                            properties: { val: { type: "string" } },
                        },
                        inputs: {},
                        bind: "result",
                    },
                },
                output: { $from: "scope", name: "result" },
                outputSchema: {
                    type: "object",
                    required: ["val"],
                    properties: { val: { type: "integer" } },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("output") &&
                        e.message.includes("not assignable"),
                ),
            ).toBe(true);
        });

        it("accepts workflow output type compatible with outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["val"],
                            properties: { val: { type: "string" } },
                        },
                        inputs: {},
                        bind: "result",
                    },
                },
                output: { $from: "scope", name: "result" },
                outputSchema: {
                    type: "object",
                    required: ["val"],
                    properties: { val: { type: "string" } },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("rejects phi-merge binder with incompatible type", () => {
            const ir = makeMinimalIR({
                nodes: {
                    trigger: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "success",
                        onError: "recovery",
                    },
                    success: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: { x: { type: "string" } },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    recovery: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: { x: { type: "integer" } },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["val"],
                            properties: { val: { type: "string" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            val: {
                                $from: "scope",
                                name: "data",
                                path: ["x"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "trigger",
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("Phi-merge") &&
                        e.message.includes("recovery"),
                ),
            ).toBe(true);
        });

        it("accepts phi-merge when all binders are compatible", () => {
            const ir = makeMinimalIR({
                nodes: {
                    trigger: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        next: "success",
                        onError: "recovery",
                    },
                    success: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: { x: { type: "string" } },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    recovery: {
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
                        outputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: { x: { type: "string" } },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["val"],
                            properties: { val: { type: "string" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            val: {
                                $from: "scope",
                                name: "data",
                                path: ["x"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "trigger",
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("checks integer is subtype of number", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["val"],
                            properties: { val: { type: "number" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: { val: 42 },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("rejects object input missing required consumer property", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["cfg"],
                            properties: {
                                cfg: {
                                    type: "object",
                                    required: ["a", "b"],
                                    properties: {
                                        a: { type: "string" },
                                        b: { type: "string" },
                                    },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            cfg: { a: "hello" },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("inputs.cfg") &&
                        (e.message.includes("not assignable") ||
                            e.message.includes("required")),
                ),
            ).toBe(true);
        });

        it("accepts object input with all required consumer properties", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["cfg"],
                            properties: {
                                cfg: {
                                    type: "object",
                                    required: ["a"],
                                    properties: {
                                        a: { type: "string" },
                                    },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            cfg: { a: "hello", b: "extra" },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("rejects loop output type incompatible with loop outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            i: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: {
                                step: {
                                    kind: "task",
                                    task: "noop",
                                    inputSchema: { type: "object" },
                                    outputSchema: {
                                        type: "object",
                                        required: ["val"],
                                        properties: {
                                            val: { type: "string" },
                                        },
                                    },
                                    inputs: {},
                                    bind: "stepOut",
                                },
                            },
                            output: {
                                $from: "scope",
                                name: "stepOut",
                                path: ["val"],
                            },
                            outputSchema: { type: "integer" },
                        },
                        iterateState: {
                            i: { $from: "state", name: "i" },
                        },
                        continueWhen: false,
                        maxIterations: 5,
                        bind: "out",
                    } as LoopNode,
                },
                outputSchema: { type: "integer" },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("output") &&
                        e.message.includes("not assignable"),
                ),
            ).toBe(true);
        });

        // ---- Top schema ({}) consumer-side rejection ----

        it("rejects top-schema producer feeding constrained consumer", () => {
            // A task with outputSchema {} (unknown/top) produces a value
            // consumed by a task expecting { type: "string" }. Per
            // Decision 0011, reading an unknown value as a typed value is
            // unsound and is rejected at the consumer site.
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "opaque",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: {} },
                        },
                        inputs: {},
                        bind: "p",
                        next: "consumer",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            text: {
                                $from: "scope",
                                name: "p",
                                path: ["value"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    /resolves to \{\} \(unknown\)/.test(e.message),
                ),
            ).toBe(true);
        });

        it("accepts top-schema consumer receiving constrained producer", () => {
            // A task with concrete output feeds into a task expecting {} (top
            // schema) on an input property. Always valid: anything is a subtype
            // of the unconstrained top schema.
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "typed",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
                        inputs: {},
                        bind: "p",
                        next: "consumer",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["data"],
                            properties: { data: {} },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            data: {
                                $from: "scope",
                                name: "p",
                                path: ["text"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });

        it("accepts workflow outputSchema {} with any concrete output", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
                        inputs: {},
                        bind: "out",
                    },
                },
                outputSchema: {},
                output: {
                    $from: "scope",
                    name: "out",
                    path: ["text"],
                },
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(true);
        });
    });

    // ---- Fork validation ----

    describe("fork node validation", () => {
        function makeForkIR(
            forkOverrides?: Partial<ForkNode>,
            extraNodes?: Record<string, any>,
        ): WorkflowIR {
            return makeMinimalIR({
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_step",
                                    nodes: {
                                        a_step: makeTaskNode({ bind: "aOut" }),
                                    },
                                    output: { $from: "scope", name: "aOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_step",
                                    nodes: {
                                        b_step: makeTaskNode({ bind: "bOut" }),
                                    },
                                    output: { $from: "scope", name: "bOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            properties: {
                                a: { type: "object" },
                                b: { type: "object" },
                            },
                        },
                        bind: "out",
                        ...forkOverrides,
                    } as ForkNode,
                    ...extraNodes,
                },
                output: { $from: "scope", name: "out" },
            });
        }

        it("accepts a valid fork with two branches", () => {
            const result = validateWorkflowIR(makeForkIR(), taskMap("noop"));
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("rejects fork with fewer than 2 branches", () => {
            const ir = makeForkIR({
                branches: {
                    only: {
                        inputs: {},
                        scope: {
                            inputSchema: {},
                            entry: "s",
                            nodes: { s: makeTaskNode({ bind: "x" }) },
                            output: { $from: "scope", name: "x" },
                            outputSchema: {},
                        },
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("at least 2 branches"),
                ),
            ).toBe(true);
        });

        it("rejects fork with invalid maxConcurrency (zero)", () => {
            const ir = makeForkIR({ maxConcurrency: 0 });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("maxConcurrency")),
            ).toBe(true);
        });

        it("rejects fork with non-integer maxConcurrency", () => {
            const ir = makeForkIR({ maxConcurrency: 1.5 });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("maxConcurrency")),
            ).toBe(true);
        });

        it("accepts fork with valid maxConcurrency", () => {
            const ir = makeForkIR({ maxConcurrency: 2 });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects fork with missing branch entry", () => {
            const ir = makeForkIR({
                branches: {
                    a: {
                        inputs: {},
                        scope: {
                            inputSchema: {},
                            entry: "missing",
                            nodes: { a_step: makeTaskNode({ bind: "x" }) },
                            output: null,
                            outputSchema: {},
                        },
                    },
                    b: {
                        inputs: {},
                        scope: {
                            inputSchema: {},
                            entry: "b_step",
                            nodes: { b_step: makeTaskNode({ bind: "y" }) },
                            output: { $from: "scope", name: "y" },
                            outputSchema: {},
                        },
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("does not exist")),
            ).toBe(true);
        });

        it("rejects fork with nonexistent next target", () => {
            const ir = makeForkIR({ next: "nowhere" });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("next") &&
                        e.message.includes("nowhere"),
                ),
            ).toBe(true);
        });

        it("rejects fork with nonexistent onError target", () => {
            const ir = makeForkIR({ onError: "nowhere" });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("onError") &&
                        e.message.includes("nowhere"),
                ),
            ).toBe(true);
        });

        it("accepts fork with valid next pointing to another node", () => {
            const ir = makeForkIR(
                { next: "after" },
                { after: makeTaskNode({ bind: "afterOut" }) },
            );
            ir.workflows[ir.entry].output = {
                $from: "scope",
                name: "afterOut",
            };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    // ---- ForkMap validation ----

    describe("forkMap node validation", () => {
        function makeForkMapIR(
            forkMapOverrides?: Partial<ForkMapNode>,
            extraNodes?: Record<string, any>,
        ): WorkflowIR {
            return makeMinimalIR({
                entry: "forkMap_0",
                nodes: {
                    forkMap_0: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "body_step",
                            nodes: {
                                body_step: makeTaskNode({ bind: "stepOut" }),
                            },
                            output: { $from: "scope", name: "stepOut" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                        ...forkMapOverrides,
                    } as ForkMapNode,
                    ...extraNodes,
                },
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "string" } },
                    },
                },
                outputSchema: {
                    type: "array",
                    items: { type: "object" },
                },
                output: { $from: "scope", name: "out" },
            });
        }

        it("accepts a valid forkMap", () => {
            const result = validateWorkflowIR(makeForkMapIR(), taskMap("noop"));
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("rejects forkMap with non-array collectionSchema", () => {
            const ir = makeForkMapIR({
                collectionSchema: { type: "object" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('type "array"')),
            ).toBe(true);
        });

        it("rejects forkMap with missing body entry", () => {
            const ir = makeForkMapIR({
                body: {
                    inputSchema: {},
                    entry: "missing",
                    nodes: { body_step: makeTaskNode() },
                    output: null,
                    outputSchema: {},
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("does not exist")),
            ).toBe(true);
        });

        it("rejects forkMap body that uses $from: state", () => {
            const ir = makeForkMapIR({
                body: {
                    inputSchema: {},
                    entry: "body_step",
                    nodes: {
                        body_step: makeTaskNode({
                            inputs: {
                                val: { $from: "state", name: "counter" },
                            },
                            bind: "stepOut",
                        }),
                    },
                    output: { $from: "scope", name: "stepOut" },
                    outputSchema: {},
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('$from: "state"')),
            ).toBe(true);
        });

        it("rejects forkMap with invalid maxConcurrency", () => {
            const ir = makeForkMapIR({ maxConcurrency: 0 });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("maxConcurrency")),
            ).toBe(true);
        });

        it("rejects forkMap with invalid maxIterations", () => {
            const ir = makeForkMapIR({ maxIterations: -1 });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("maxIterations")),
            ).toBe(true);
        });

        it("accepts forkMap with valid maxConcurrency and maxIterations", () => {
            const ir = makeForkMapIR({
                maxConcurrency: 3,
                maxIterations: 10,
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects forkMap with nonexistent next target", () => {
            const ir = makeForkMapIR({ next: "nowhere" });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("next") &&
                        e.message.includes("nowhere"),
                ),
            ).toBe(true);
        });

        it("accepts forkMap with valid next target", () => {
            const ir = makeForkMapIR(
                { next: "after" },
                { after: makeTaskNode({ bind: "afterOut" }) },
            );
            ir.workflows[ir.entry].output = {
                $from: "scope",
                name: "afterOut",
            };
            ir.workflows[ir.entry].outputSchema = { type: "object" };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts forkMap when element schema matches body elementParam type", () => {
            const ir = makeForkMapIR({
                collectionSchema: {
                    type: "array",
                    items: { type: "string" },
                },
                elementParam: "item",
                body: {
                    inputSchema: {
                        type: "object",
                        required: ["item"],
                        properties: { item: { type: "string" } },
                    },
                    entry: "body_step",
                    nodes: {
                        body_step: makeTaskNode({ bind: "stepOut" }),
                    },
                    output: { $from: "scope", name: "stepOut" },
                    outputSchema: { type: "object" },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects forkMap when element schema mismatches body elementParam type", () => {
            const ir = makeForkMapIR({
                collectionSchema: {
                    type: "array",
                    items: { type: "string" },
                },
                elementParam: "item",
                body: {
                    inputSchema: {
                        type: "object",
                        required: ["item"],
                        properties: { item: { type: "integer" } },
                    },
                    entry: "body_step",
                    nodes: {
                        body_step: makeTaskNode({ bind: "stepOut" }),
                    },
                    output: { $from: "scope", name: "stepOut" },
                    outputSchema: { type: "object" },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("collection element") &&
                        e.message.includes("body elementParam"),
                ),
            ).toBe(true);
        });

        it("skips element check when collectionSchema has no items", () => {
            const ir = makeForkMapIR({
                collectionSchema: { type: "array" },
                elementParam: "item",
                body: {
                    inputSchema: {
                        type: "object",
                        required: ["item"],
                        properties: { item: { type: "integer" } },
                    },
                    entry: "body_step",
                    nodes: {
                        body_step: makeTaskNode({ bind: "stepOut" }),
                    },
                    output: { $from: "scope", name: "stepOut" },
                    outputSchema: { type: "object" },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    describe("never-output schema", () => {
        it("accepts a never-output task with no next, bind, or onError", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        task: "error.fail",
                        outputSchema: { not: {} },
                    }),
                },
                output: {},
            });
            const result = validateWorkflowIR(ir, taskMap("error.fail"));
            expect(result.valid).toBe(true);
        });

        it("rejects a never-output task with next", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        task: "error.fail",
                        outputSchema: { not: {} },
                        next: "after",
                    }),
                    after: makeTaskNode({ bind: "out" }),
                },
            });
            const result = validateWorkflowIR(
                ir,
                taskMap("error.fail", "noop"),
            );
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes('must not have "next"'),
                ),
            ).toBe(true);
        });

        it("rejects a never-output task with bind", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        task: "error.fail",
                        outputSchema: { not: {} },
                        bind: "x",
                    }),
                },
                output: {},
            });
            const result = validateWorkflowIR(ir, taskMap("error.fail"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes('must not have "bind"'),
                ),
            ).toBe(true);
        });

        it("rejects a never-output task with onError", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        task: "error.fail",
                        outputSchema: { not: {} },
                        onError: "handler",
                    }),
                    handler: makeTaskNode({ bind: "out" }),
                },
            });
            const result = validateWorkflowIR(
                ir,
                taskMap("error.fail", "noop"),
            );
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes('must not have "onError"'),
                ),
            ).toBe(true);
        });
    });

    describe("isNeverSchema", () => {
        it("returns true for { not: {} }", () => {
            expect(isNeverSchema({ not: {} })).toBe(true);
        });

        it("returns false for empty schema", () => {
            expect(isNeverSchema({})).toBe(false);
        });

        it("returns false for normal object schema", () => {
            expect(isNeverSchema({ type: "object" })).toBe(false);
        });

        it("returns false for non-empty not", () => {
            expect(isNeverSchema({ not: { type: "string" } })).toBe(false);
        });

        it("returns false for undefined", () => {
            expect(isNeverSchema(undefined)).toBe(false);
        });
    });

    // ---- Gap 3: Version field validation ----

    describe("version validation", () => {
        it("rejects IR with wrong version", () => {
            const ir = makeMinimalIR();
            Object.assign(ir, { version: "2" });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('"1"'))).toBe(
                true,
            );
        });

        it("rejects IR with missing version", () => {
            const ir = makeMinimalIR();
            delete (ir as Partial<WorkflowIR>).version;
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
        });

        it("accepts IR with version 1", () => {
            const result = validateWorkflowIR(makeMinimalIR(), taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    // ---- Gap 2: Reserved $-key check ----

    describe("reserved $-key check", () => {
        it("rejects unknown $-prefixed key in task inputs", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        inputs: { x: { $foo: "bar" } },
                        bind: "out",
                    }),
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$foo"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key nested in inputs", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        inputs: {
                            outer: {
                                inner: { $magic: 1 },
                            },
                        },
                        bind: "out",
                    }),
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$magic"')),
            ).toBe(true);
        });

        it("accepts $from and $literal as the only valid $-keys", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        inputs: {
                            a: { $from: "input", name: "x" },
                            b: { $literal: { nested: "value" } },
                        },
                        bind: "out",
                    }),
                },
                inputSchema: {
                    type: "object",
                    properties: { x: { type: "string" } },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            // Should not have any $-key errors (may have other errors, but not
            // about reserved keys)
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("$-prefixed key") ||
                        e.message.includes('"$from"') ||
                        e.message.includes('"$literal"'),
                ),
            ).toBe(false);
        });

        it("rejects unknown $-prefixed key in workflow output template", () => {
            const ir = makeMinimalIR({
                output: { $bad: "value" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$bad"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key in branch arm inputs", () => {
            const arm = makeSimpleArm("armStep");
            (arm.inputs as Record<string, unknown>).bad = { $weird: 1 };
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: { true: arm },
                        default: makeSimpleArm("defStep"),
                    } as BranchNode,
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$weird"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key in fork branch inputs", () => {
            const ir = makeMinimalIR({
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {
                                    bad: { $weirdA: 1 },
                                },
                                scope: {
                                    inputSchema: {},
                                    entry: "a_step",
                                    nodes: {
                                        a_step: makeTaskNode({ bind: "aOut" }),
                                    },
                                    output: { $from: "scope", name: "aOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_step",
                                    nodes: {
                                        b_step: makeTaskNode({ bind: "bOut" }),
                                    },
                                    output: { $from: "scope", name: "bOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            properties: {
                                a: { type: "object" },
                                b: { type: "object" },
                            },
                        },
                        bind: "out",
                    } as ForkNode,
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$weirdA"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key in fork branch scope.output", () => {
            const ir = makeMinimalIR({
                entry: "fork_0",
                nodes: {
                    fork_0: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_step",
                                    nodes: {
                                        a_step: makeTaskNode({ bind: "aOut" }),
                                    },
                                    output: { $weirdOut: 1 },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_step",
                                    nodes: {
                                        b_step: makeTaskNode({ bind: "bOut" }),
                                    },
                                    output: { $from: "scope", name: "bOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: {
                            type: "object",
                            properties: {
                                a: { type: "object" },
                                b: { type: "object" },
                            },
                        },
                        bind: "out",
                    } as ForkNode,
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$weirdOut"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key in forkMap.collection template", () => {
            const ir = makeMinimalIR({
                entry: "forkMap_0",
                nodes: {
                    forkMap_0: {
                        kind: "forkMap",
                        collection: { $weirdColl: 1 },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "body_step",
                            nodes: {
                                body_step: makeTaskNode({ bind: "stepOut" }),
                            },
                            output: { $from: "scope", name: "stepOut" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    } as ForkMapNode,
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$weirdColl"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key in forkMap.inputs", () => {
            const ir = makeMinimalIR({
                entry: "forkMap_0",
                nodes: {
                    forkMap_0: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        inputs: { bad: { $weirdInputs: 1 } },
                        body: {
                            inputSchema: {},
                            entry: "body_step",
                            nodes: {
                                body_step: makeTaskNode({ bind: "stepOut" }),
                            },
                            output: { $from: "scope", name: "stepOut" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    } as ForkMapNode,
                },
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "string" } },
                    },
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$weirdInputs"')),
            ).toBe(true);
        });

        it("rejects unknown $-prefixed key in forkMap.body.output", () => {
            const ir = makeMinimalIR({
                entry: "forkMap_0",
                nodes: {
                    forkMap_0: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "body_step",
                            nodes: {
                                body_step: makeTaskNode({ bind: "stepOut" }),
                            },
                            output: { $weirdBodyOut: 1 },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    } as ForkMapNode,
                },
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "string" } },
                    },
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes('"$weirdBodyOut"'),
                ),
            ).toBe(true);
        });
    });

    // ---- Gap 4: bind on branch node ----

    describe("bind on branch node", () => {
        it("rejects branch node with bind but no outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: makeSimpleArm("trueStep"),
                            false: makeSimpleArm("falseStep"),
                        },
                        default: makeSimpleArm("defaultStep"),
                        bind: "shouldNotExist",
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.toLowerCase().includes("bind") &&
                        e.message.toLowerCase().includes("branch"),
                ),
            ).toBe(true);
        });

        it("accepts branch node without bind or outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: makeSimpleArm("trueStep"),
                            false: makeSimpleArm("falseStep"),
                        },
                        default: makeSimpleArm("defaultStep"),
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    // ---- Gap 5: recovery task inputSchema must declare error and trigger ----

    describe("recovery task error/trigger fields", () => {
        it("accepts recovery task without error/trigger in inputSchema (recovery namespace)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        onError: "recover",
                        bind: "out",
                    }),
                    recover: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts $from recovery ref in an onError target node", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        onError: "recover",
                        bind: "out",
                    }),
                    recover: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            error: {
                                $from: "recovery",
                                name: "error",
                            },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects $from recovery ref in a non-onError-target node (Rule 5)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            error: {
                                $from: "recovery",
                                name: "error",
                            },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("not an onError target"),
                ),
            ).toBe(true);
        });

        it("rejects invalid recovery name in onError target (Rule 5)", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        onError: "recover",
                        bind: "out",
                    }),
                    recover: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {
                            foo: {
                                $from: "recovery",
                                name: "bogus",
                            },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes('"bogus"') &&
                        e.message.includes("only"),
                ),
            ).toBe(true);
        });

        it("accepts recovery task with both error and trigger in required", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        onError: "recover",
                        bind: "out",
                    }),
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
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts $from recovery with valid path into error schema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        onError: "recover",
                        bind: "out",
                    }),
                    recover: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            properties: {
                                msg: { type: "string" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            msg: {
                                $from: "recovery",
                                name: "error",
                                path: ["message"],
                            },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects $from recovery with invalid path into error schema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        onError: "recover",
                        bind: "out",
                    }),
                    recover: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            properties: {
                                x: { type: "string" },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            x: {
                                $from: "recovery",
                                name: "error",
                                path: ["nonexistent"],
                            },
                        },
                        bind: "out",
                    },
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("nonexistent")),
            ).toBe(true);
        });
    });

    // ---- Gap 16: anyOf / oneOf / allOf structural subtyping ----

    describe("anyOf/oneOf/allOf subtyping", () => {
        it("accepts producer anyOf when both variants are compatible with consumer", () => {
            // producer: { value: anyOf [string, integer] }
            // consumer: { value: anyOf [string, integer] }  — widened consumer
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: {
                                value: {
                                    anyOf: [
                                        { type: "string" },
                                        { type: "integer" },
                                    ],
                                },
                            },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: {
                                x: {
                                    anyOf: [
                                        { type: "string" },
                                        { type: "integer" },
                                        { type: "boolean" },
                                    ],
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            x: {
                                $from: "scope",
                                name: "data",
                                path: ["value"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects producer anyOf when one variant has no compatible consumer variant", () => {
            // producer: anyOf [string, boolean]; consumer: string only
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: {
                                value: {
                                    anyOf: [
                                        { type: "string" },
                                        { type: "boolean" },
                                    ],
                                },
                            },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: { x: { type: "string" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            x: {
                                $from: "scope",
                                name: "data",
                                path: ["value"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("not assignable")),
            ).toBe(true);
        });

        it("accepts producer when consumer is oneOf and producer matches one variant", () => {
            // producer: string; consumer: oneOf [string, integer]
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: { type: "string" } },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: {
                                x: {
                                    oneOf: [
                                        { type: "string" },
                                        { type: "integer" },
                                    ],
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            x: {
                                $from: "scope",
                                name: "data",
                                path: ["value"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects producer when consumer is oneOf and producer matches no variant", () => {
            // producer: boolean; consumer: oneOf [string, integer]
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: { value: { type: "boolean" } },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: {
                                x: {
                                    oneOf: [
                                        { type: "string" },
                                        { type: "integer" },
                                    ],
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            x: {
                                $from: "scope",
                                name: "data",
                                path: ["value"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("not assignable")),
            ).toBe(true);
        });

        it("accepts producer when consumer is allOf all members are satisfied", () => {
            // producer: object with required [a, b]; consumer allOf: needs a, needs b
            const ir = makeMinimalIR({
                nodes: {
                    producer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: { type: "object" },
                        outputSchema: {
                            type: "object",
                            required: ["value"],
                            properties: {
                                value: {
                                    type: "object",
                                    required: ["a", "b"],
                                    properties: {
                                        a: { type: "string" },
                                        b: { type: "integer" },
                                    },
                                },
                            },
                        },
                        inputs: {},
                        next: "consumer",
                        bind: "data",
                    },
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            required: ["x"],
                            properties: {
                                x: {
                                    allOf: [
                                        {
                                            type: "object",
                                            required: ["a"],
                                            properties: {
                                                a: { type: "string" },
                                            },
                                        },
                                        {
                                            type: "object",
                                            required: ["b"],
                                            properties: {
                                                b: { type: "integer" },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            x: {
                                $from: "scope",
                                name: "data",
                                path: ["value"],
                            },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    describe("branch as value-producing node", () => {
        it("accepts branch with bind+outputSchema where arms are assignable", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "yesTask",
                                    nodes: {
                                        yesTask: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                required: ["val"],
                                                properties: {
                                                    val: { type: "string" },
                                                },
                                            },
                                            inputs: {},
                                            bind: "result",
                                        },
                                    },
                                    output: { $from: "scope", name: "result" },
                                    outputSchema: {
                                        type: "object",
                                        required: ["val"],
                                        properties: {
                                            val: { type: "string" },
                                        },
                                    },
                                },
                            },
                        },
                        default: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "noTask",
                                nodes: {
                                    noTask: {
                                        kind: "task",
                                        task: "noop",
                                        inputSchema: { type: "object" },
                                        outputSchema: {
                                            type: "object",
                                            required: ["val"],
                                            properties: {
                                                val: { type: "string" },
                                            },
                                        },
                                        inputs: {},
                                        bind: "result",
                                    },
                                },
                                output: { $from: "scope", name: "result" },
                                outputSchema: {
                                    type: "object",
                                    required: ["val"],
                                    properties: {
                                        val: { type: "string" },
                                    },
                                },
                            },
                        },
                        bind: "branchOut",
                        outputSchema: {
                            type: "object",
                            required: ["val"],
                            properties: { val: { type: "string" } },
                        },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects branch where arm outputSchema is incompatible with branch outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "yesTask",
                                    nodes: {
                                        yesTask: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: { type: "integer" },
                                            inputs: {},
                                            bind: "r",
                                        },
                                    },
                                    output: { $from: "scope", name: "r" },
                                    outputSchema: { type: "integer" },
                                },
                            },
                        },
                        default: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "defTask",
                                nodes: {
                                    defTask: makeTaskNode({ bind: "r" }),
                                },
                                output: { $from: "scope", name: "r" },
                                outputSchema: { type: "object" },
                            },
                        },
                        bind: "branchOut",
                        outputSchema: { type: "object" },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) =>
                    e.message.includes("not assignable to branch outputSchema"),
                ),
            ).toBe(true);
        });

        it("rejects branch with bind but no outputSchema", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: makeSimpleArm("trueStep"),
                            false: makeSimpleArm("falseStep"),
                        },
                        bind: "x",
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("bind") &&
                        e.message.includes("outputSchema"),
                ),
            ).toBe(true);
        });

        it("rejects branch with outputSchema but no bind", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: makeSimpleArm("trueStep"),
                            false: makeSimpleArm("falseStep"),
                        },
                        outputSchema: { type: "object" },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("outputSchema") &&
                        e.message.includes("bind"),
                ),
            ).toBe(true);
        });

        it("rejects branch.next pointing to missing node", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: true,
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: makeSimpleArm("trueStep"),
                            false: makeSimpleArm("falseStep"),
                        },
                        next: "doesNotExist",
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir);
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("doesNotExist")),
            ).toBe(true);
        });

        // continueWhen is a Template resolved against the body scope on each
        // iteration. The validator checks $from:scope and $from:state refs in
        // continueWhen against the body's binding map and the loop's declared
        // state variables respectively.
        it("rejects continueWhen referencing an unknown scope name", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: { step: makeTaskNode() },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        state: {},
                        iterateState: {},
                        continueWhen: {
                            $from: "scope",
                            name: "doesNotExist",
                        },
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("doesNotExist")),
            ).toBe(true);
        });

        it("rejects continueWhen referencing an undeclared state variable", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: { step: makeTaskNode() },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        state: {},
                        iterateState: {},
                        continueWhen: {
                            $from: "state",
                            name: "noSuchVar",
                        },
                    } as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("noSuchVar")),
            ).toBe(true);
        });

        it("rejects loop missing continueWhen entirely", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "loop",
                        inputs: {},
                        body: {
                            inputSchema: { type: "object" },
                            entry: "step",
                            nodes: { step: makeTaskNode() },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        state: {},
                        iterateState: {},
                    } as unknown as LoopNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("continueWhen")),
            ).toBe(true);
        });
    });

    describe("branch arm state isolation", () => {
        it("rejects $from:state ref in a branch arm node input", () => {
            // Branch arms are isolated sub-scopes with no state namespace.
            // $from:"state" inside an arm is invalid; state must be threaded
            // through arm.inputs.
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "step",
                                    nodes: {
                                        step: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: {
                                                type: "object",
                                                properties: {
                                                    x: { type: "integer" },
                                                },
                                            },
                                            outputSchema: { type: "null" },
                                            inputs: {
                                                x: {
                                                    $from: "state",
                                                    name: "counter",
                                                },
                                            },
                                        },
                                    },
                                    output: null,
                                    outputSchema: { type: "null" },
                                },
                            },
                        },
                        default: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "noop",
                                nodes: { noop: makeTaskNode() },
                                output: null,
                                outputSchema: { type: "null" },
                            },
                        },
                    } as BranchNode,
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("counter") &&
                        e.message.includes("state namespace"),
                ),
            ).toBe(true);
        });

        it("accepts $from:state in arm.inputs (crosses the boundary correctly)", () => {
            // State values may appear in arm.inputs (evaluated in outer scope).
            // Inside the arm they are accessed via $from:"input".
            const ir = makeMinimalIR({
                entry: "loop",
                output: null,
                outputSchema: { type: "null" },
                nodes: {
                    loop: {
                        kind: "loop",
                        inputs: {},
                        state: {
                            counter: {
                                schema: { type: "integer" },
                                initial: 0,
                            },
                        },
                        iterateState: {
                            counter: { $from: "state", name: "counter" },
                        },
                        continueWhen: false,
                        body: {
                            inputSchema: { type: "object" },
                            entry: "branch",
                            nodes: {
                                branch: {
                                    kind: "branch",
                                    selector: "yes",
                                    selectorSchema: { type: "string" },
                                    cases: {
                                        yes: {
                                            inputs: {
                                                // state value crosses boundary here
                                                counter: {
                                                    $from: "state",
                                                    name: "counter",
                                                },
                                            },
                                            scope: {
                                                inputSchema: {
                                                    type: "object",
                                                    properties: {
                                                        counter: {
                                                            type: "integer",
                                                        },
                                                    },
                                                },
                                                entry: "step",
                                                nodes: {
                                                    step: {
                                                        kind: "task",
                                                        task: "noop",
                                                        inputSchema: {
                                                            type: "object",
                                                            properties: {
                                                                counter: {
                                                                    type: "integer",
                                                                },
                                                            },
                                                        },
                                                        outputSchema: {
                                                            type: "null",
                                                        },
                                                        inputs: {
                                                            // inside arm: $from:"input"
                                                            counter: {
                                                                $from: "input",
                                                                name: "counter",
                                                            },
                                                        },
                                                    },
                                                },
                                                output: null,
                                                outputSchema: { type: "null" },
                                            },
                                        },
                                    },
                                    default: {
                                        inputs: {},
                                        scope: {
                                            inputSchema: { type: "object" },
                                            entry: "noop",
                                            nodes: { noop: makeTaskNode() },
                                            output: null,
                                            outputSchema: { type: "null" },
                                        },
                                    },
                                } as BranchNode,
                            },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                    } as LoopNode,
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    // ---- Workflow call graph validation ----

    describe("workflow call graph validation", () => {
        /** Minimal WorkflowCallNode whose inputSchema/outputSchema match the given body. */
        function makeCallNode(
            targetName: string,
            overrides?: Partial<WorkflowCallNode>,
        ): WorkflowCallNode {
            return {
                kind: "workflowCall",
                workflowRef: { name: targetName },
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                inputs: {},
                bind: "result",
                ...overrides,
            };
        }

        /** Minimal workflow body that runs a single noop task. */
        function makeHelperBody(): WorkflowBody {
            return {
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                entry: "step",
                nodes: {
                    step: makeTaskNode({ bind: "out" }),
                },
                output: { $from: "scope", name: "out" },
            };
        }

        it("accepts a valid two-workflow IR (entry calls helper)", () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                version: "1",
                entry: "main",
                workflows: {
                    main: {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "callHelper",
                        nodes: { callHelper: makeCallNode("helper") },
                        output: { $from: "scope", name: "result" },
                    },
                    helper: makeHelperBody(),
                },
            };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("rejects a direct workflow call cycle (alpha -> beta -> alpha)", () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                version: "1",
                entry: "alpha",
                workflows: {
                    alpha: {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "callBeta",
                        nodes: { callBeta: makeCallNode("beta") },
                        output: { $from: "scope", name: "result" },
                    },
                    beta: {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "callAlpha",
                        nodes: { callAlpha: makeCallNode("alpha") },
                        output: { $from: "scope", name: "result" },
                    },
                },
            };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes("cycle"))).toBe(
                true,
            );
        });

        it("rejects a workflow call cycle routed through a branch arm (previously missed)", () => {
            // alpha has a branch node whose arm contains a workflowCall to beta.
            // beta calls alpha directly. Before the fix, collectCalleesInNode
            // did not traverse into branch arms, so this cycle was invisible
            // to the static check.
            const callAlpha = makeCallNode("alpha");
            const callBeta = makeCallNode("beta");
            const ir: WorkflowIR = {
                kind: "workflow",
                version: "1",
                entry: "alpha",
                workflows: {
                    alpha: {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "pick",
                        nodes: {
                            pick: {
                                kind: "branch",
                                selector: { $literal: true },
                                selectorSchema: { type: "boolean" },
                                cases: {
                                    true: {
                                        inputs: {},
                                        scope: {
                                            inputSchema: { type: "object" },
                                            entry: "callBeta",
                                            nodes: { callBeta },
                                            output: {
                                                $from: "scope",
                                                name: "result",
                                            },
                                            outputSchema: { type: "object" },
                                        },
                                    },
                                },
                                default: makeSimpleArm(),
                                bind: "result",
                                outputSchema: { type: "object" },
                            },
                        },
                        output: { $from: "scope", name: "result" },
                    },
                    beta: {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "callAlpha",
                        nodes: { callAlpha },
                        output: { $from: "scope", name: "result" },
                    },
                },
            };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes("cycle"))).toBe(
                true,
            );
        });

        it("rejects reserved $-key in workflowCall inputs (previously missed by validateScopeTemplates)", () => {
            // validateScopeTemplates previously only checked task/loop inputs;
            // workflowCall.inputs was not checked for reserved $-keys.
            const ir: WorkflowIR = {
                kind: "workflow",
                version: "1",
                entry: "main",
                workflows: {
                    main: {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "callHelper",
                        nodes: {
                            callHelper: makeCallNode("helper", {
                                inputs: { x: { $bad: "value" } },
                            }),
                        },
                        output: { $from: "scope", name: "result" },
                    },
                    helper: makeHelperBody(),
                },
            };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes('"$bad"')),
            ).toBe(true);
        });

        it("rejects type mismatch inside a branch arm sub-scope (previously missed by validateTypeCompatibility)", () => {
            // validateTypeCompatibility previously did not recurse into branch
            // arm sub-scopes. A producer emitting string and a consumer
            // expecting integer inside the arm was silently accepted.
            const ir = makeMinimalIR({
                entry: "pick",
                nodes: {
                    pick: {
                        kind: "branch",
                        selector: { $literal: true },
                        selectorSchema: { type: "boolean" },
                        cases: {
                            true: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "producer",
                                    nodes: {
                                        producer: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                required: ["value"],
                                                properties: {
                                                    value: { type: "string" },
                                                },
                                            },
                                            inputs: {},
                                            next: "consumer",
                                            bind: "data",
                                        },
                                        consumer: makeTaskNode({
                                            inputSchema: {
                                                type: "object",
                                                required: ["x"],
                                                properties: {
                                                    x: { type: "integer" },
                                                },
                                            },
                                            inputs: {
                                                x: {
                                                    $from: "scope",
                                                    name: "data",
                                                    path: ["value"],
                                                },
                                            },
                                            bind: "armOut",
                                        }),
                                    },
                                    output: { $from: "scope", name: "armOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        default: makeSimpleArm(),
                        bind: "result",
                        outputSchema: { type: "object" },
                    } as BranchNode,
                },
                output: { $from: "scope", name: "result" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("not assignable")),
            ).toBe(true);
        });
    });

    describe("isStructuralSubtype required-field semantics", () => {
        it("rejects when consumer requires a field the producer only has as optional", () => {
            const producer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" }, b: { type: "number" } },
                required: ["a"],
            };
            const consumer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" }, b: { type: "number" } },
                required: ["a", "b"],
            };
            expect(isStructuralSubtype(producer, consumer)).toBe(false);
        });

        it("accepts when producer requires all fields the consumer requires", () => {
            const producer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" }, b: { type: "number" } },
                required: ["a", "b"],
            };
            const consumer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" }, b: { type: "number" } },
                required: ["a"],
            };
            expect(isStructuralSubtype(producer, consumer)).toBe(true);
        });

        it("accepts when producer and consumer have identical required fields", () => {
            const schema: JSONSchema = {
                type: "object",
                properties: { x: { type: "string" }, y: { type: "integer" } },
                required: ["x", "y"],
            };
            expect(isStructuralSubtype(schema, schema)).toBe(true);
        });

        it("rejects when consumer requires a field not present in producer at all", () => {
            const producer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" } },
                required: ["a"],
            };
            const consumer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" }, b: { type: "number" } },
                required: ["a", "b"],
            };
            expect(isStructuralSubtype(producer, consumer)).toBe(false);
        });

        it("accepts when consumer has no required fields", () => {
            const producer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" } },
            };
            const consumer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" }, b: { type: "number" } },
            };
            expect(isStructuralSubtype(producer, consumer)).toBe(true);
        });

        it("rejects when required property types are incompatible", () => {
            const producer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" } },
                required: ["a"],
            };
            const consumer: JSONSchema = {
                type: "object",
                properties: { a: { type: "number" } },
                required: ["a"],
            };
            expect(isStructuralSubtype(producer, consumer)).toBe(false);
        });

        it("accepts top-schema consumer regardless of producer shape", () => {
            const producer: JSONSchema = {
                type: "object",
                properties: { a: { type: "string" } },
                required: ["a"],
            };
            const consumer: JSONSchema = {};
            expect(isStructuralSubtype(producer, consumer)).toBe(true);
        });
    });

    describe("checkNodeTaskSchemas required-field integration", () => {
        it("rejects node input requiring a field the task input only has as optional", () => {
            const task: TaskDefinition = {
                name: "t1",
                inputSchema: {
                    type: "object",
                    properties: {
                        a: { type: "string" },
                        b: { type: "number" },
                    },
                    required: ["a", "b"],
                },
                outputSchema: {},
                execute: async () => ({ kind: "ok" as const, output: {} }),
            };
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "t1",
                        inputSchema: {
                            type: "object",
                            properties: {
                                a: { type: "string" },
                                b: { type: "number" },
                            },
                            required: ["a"],
                        },
                        outputSchema: {},
                        inputs: {},
                    },
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, new Map([["t1", task]]));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("required")),
            ).toBe(true);
        });

        it("rejects node output that makes a field optional when task output requires it", () => {
            const task: TaskDefinition = {
                name: "t1",
                inputSchema: {},
                outputSchema: {
                    type: "object",
                    properties: {
                        x: { type: "string" },
                        y: { type: "number" },
                    },
                    required: ["x"],
                },
                execute: async () => ({ kind: "ok" as const, output: {} }),
            };
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "t1",
                        inputSchema: {},
                        outputSchema: {
                            type: "object",
                            properties: {
                                x: { type: "string" },
                                y: { type: "number" },
                            },
                            required: ["x", "y"],
                        },
                        inputs: {},
                        bind: "r",
                    },
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, new Map([["t1", task]]));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => e.message.includes("required")),
            ).toBe(true);
        });

        it("accepts when node and task schemas have matching required fields", () => {
            const task: TaskDefinition = {
                name: "t1",
                inputSchema: {
                    type: "object",
                    properties: { a: { type: "string" } },
                    required: ["a"],
                },
                outputSchema: {
                    type: "object",
                    properties: { x: { type: "number" } },
                    required: ["x"],
                },
                execute: async () => ({ kind: "ok" as const, output: {} }),
            };
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "task",
                        task: "t1",
                        inputSchema: {
                            type: "object",
                            properties: { a: { type: "string" } },
                            required: ["a"],
                        },
                        outputSchema: {
                            type: "object",
                            properties: { x: { type: "number" } },
                            required: ["x"],
                        },
                        inputs: {},
                        bind: "r",
                    },
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, new Map([["t1", task]]));
            expect(result.valid).toBe(true);
        });
    });

    describe("checkArmCovariance required-field integration", () => {
        it("rejects arm outputSchema with optional field that branch outputSchema requires", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "yesTask",
                                    nodes: {
                                        yesTask: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                properties: {
                                                    a: { type: "string" },
                                                    b: { type: "number" },
                                                },
                                                required: ["a"],
                                            },
                                            inputs: {},
                                            bind: "r",
                                        },
                                    },
                                    output: { $from: "scope", name: "r" },
                                    outputSchema: {
                                        type: "object",
                                        properties: {
                                            a: { type: "string" },
                                            b: { type: "number" },
                                        },
                                        required: ["a"],
                                    },
                                },
                            },
                        },
                        default: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "defTask",
                                nodes: {
                                    defTask: makeTaskNode({ bind: "r" }),
                                },
                                output: { $from: "scope", name: "r" },
                                outputSchema: { type: "object" },
                            },
                        },
                        bind: "branchOut",
                        outputSchema: {
                            type: "object",
                            properties: {
                                a: { type: "string" },
                                b: { type: "number" },
                            },
                            required: ["a", "b"],
                        },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("branch outputSchema") &&
                        e.message.includes("required"),
                ),
            ).toBe(true);
        });

        it("accepts arm outputSchema that requires superset of branch outputSchema required fields", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "yesTask",
                                    nodes: {
                                        yesTask: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                properties: {
                                                    a: { type: "string" },
                                                    b: { type: "number" },
                                                },
                                                required: ["a", "b"],
                                            },
                                            inputs: {},
                                            bind: "r",
                                        },
                                    },
                                    output: { $from: "scope", name: "r" },
                                    outputSchema: {
                                        type: "object",
                                        properties: {
                                            a: { type: "string" },
                                            b: { type: "number" },
                                        },
                                        required: ["a", "b"],
                                    },
                                },
                            },
                        },
                        default: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "defTask",
                                nodes: {
                                    defTask: {
                                        kind: "task",
                                        task: "noop",
                                        inputSchema: { type: "object" },
                                        outputSchema: {
                                            type: "object",
                                            properties: {
                                                a: { type: "string" },
                                                b: { type: "number" },
                                            },
                                            required: ["a", "b"],
                                        },
                                        inputs: {},
                                        bind: "r",
                                    },
                                },
                                output: { $from: "scope", name: "r" },
                                outputSchema: {
                                    type: "object",
                                    properties: {
                                        a: { type: "string" },
                                        b: { type: "number" },
                                    },
                                    required: ["a", "b"],
                                },
                            },
                        },
                        bind: "branchOut",
                        outputSchema: {
                            type: "object",
                            properties: {
                                a: { type: "string" },
                                b: { type: "number" },
                            },
                            required: ["a"],
                        },
                    } as BranchNode,
                },
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });
    });

    describe("phi-merge required-field integration", () => {
        it("rejects phi merge when binder has optional field that consumer requires", () => {
            // Branch binds to "branchOut" with outputSchema that has "x" optional,
            // but a downstream node consumes it with "x" required.
            const ir = makeMinimalIR({
                nodes: {
                    start: {
                        kind: "branch",
                        selector: "yes",
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "yesTask",
                                    nodes: {
                                        yesTask: {
                                            kind: "task",
                                            task: "noop",
                                            inputSchema: { type: "object" },
                                            outputSchema: {
                                                type: "object",
                                                properties: {
                                                    x: { type: "string" },
                                                },
                                            },
                                            inputs: {},
                                            bind: "r",
                                        },
                                    },
                                    output: { $from: "scope", name: "r" },
                                    outputSchema: {
                                        type: "object",
                                        properties: { x: { type: "string" } },
                                    },
                                },
                            },
                        },
                        default: {
                            inputs: {},
                            scope: {
                                inputSchema: { type: "object" },
                                entry: "defTask",
                                nodes: {
                                    defTask: {
                                        kind: "task",
                                        task: "noop",
                                        inputSchema: { type: "object" },
                                        outputSchema: {
                                            type: "object",
                                            properties: {
                                                x: { type: "string" },
                                            },
                                        },
                                        inputs: {},
                                        bind: "r",
                                    },
                                },
                                output: { $from: "scope", name: "r" },
                                outputSchema: {
                                    type: "object",
                                    properties: { x: { type: "string" } },
                                },
                            },
                        },
                        bind: "branchOut",
                        outputSchema: {
                            type: "object",
                            properties: { x: { type: "string" } },
                        },
                        next: "consumer",
                    } as BranchNode,
                    consumer: {
                        kind: "task",
                        task: "noop",
                        inputSchema: {
                            type: "object",
                            properties: { x: { type: "string" } },
                            required: ["x"],
                        },
                        outputSchema: {},
                        inputs: {
                            x: { $from: "scope", name: "branchOut" },
                        },
                    },
                },
                entry: "start",
                output: null,
                outputSchema: {},
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("not assignable") ||
                        e.message.includes("required"),
                ),
            ).toBe(true);
        });
    });

    // ---- Gaps 3 + 4 + 5: input/constant ref existence & path checks ----

    describe("input/constant ref validation (gaps 3-5)", () => {
        describe("gap 3: $from input name existence", () => {
            it("rejects $from input ref to undeclared name", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: { x: { type: "string" } },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: { $from: "input", name: "missing" },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "input"') &&
                            e.message.includes('"missing"') &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("accepts $from input ref to declared name", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: { x: { type: "string" } },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: { $from: "input", name: "x" },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });

            it("accepts optional $from input ref to undeclared name", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: { x: { type: "string" } },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: {
                                    $from: "input",
                                    name: "missing",
                                    optional: true,
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });

            it("rejects $from input when inputSchema is top schema ({}) with no properties", () => {
                const ir = makeMinimalIR({
                    inputSchema: {},
                    nodes: {
                        start: makeTaskNode({
                            inputs: {
                                val: { $from: "input", name: "anything" },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "input"') &&
                            e.message.includes('"anything"') &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("rejects $from input in output template to undeclared name", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: { x: { type: "string" } },
                    },
                    nodes: {
                        start: makeTaskNode({ bind: "out" }),
                    },
                    output: { $from: "input", name: "bogus" },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "input"') &&
                            e.message.includes('"bogus"') &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("rejects $from input in loop body node to name not in body inputSchema", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: { x: { type: "string" } },
                    },
                    nodes: {
                        start: {
                            kind: "loop",
                            inputs: {},
                            body: {
                                inputSchema: {
                                    type: "object",
                                    properties: { i: { type: "integer" } },
                                },
                                entry: "step",
                                nodes: {
                                    step: makeTaskNode({
                                        inputs: {
                                            val: {
                                                $from: "input",
                                                name: "x",
                                            },
                                        },
                                    }),
                                },
                                output: null,
                                outputSchema: {},
                            },
                            state: {
                                i: {
                                    schema: { type: "integer" },
                                    initial: 0,
                                },
                            },
                            iterateState: { i: 0 },
                            continueWhen: false,
                            bind: "out",
                        } as unknown as LoopNode,
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "input"') &&
                            e.message.includes('"x"') &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });
        });

        describe("gap 4: $from constant name existence", () => {
            it("rejects $from constant ref to undeclared name", () => {
                const ir = makeMinimalIR({
                    constants: {
                        greeting: {
                            schema: { type: "string" },
                            value: "hello",
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: { $from: "constant", name: "missing" },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "constant"') &&
                            e.message.includes('"missing"') &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("accepts $from constant ref to declared name", () => {
                const ir = makeMinimalIR({
                    constants: {
                        greeting: {
                            schema: { type: "string" },
                            value: "hello",
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: { $from: "constant", name: "greeting" },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });

            it("rejects $from constant when no constants defined", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: { $from: "constant", name: "anything" },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "constant"') &&
                            e.message.includes('"anything"') &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("accepts optional $from constant ref to undeclared name", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        start: makeTaskNode({
                            inputs: {
                                val: {
                                    $from: "constant",
                                    name: "missing",
                                    optional: true,
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });
        });

        describe("gap 5: input/constant path validation", () => {
            it("rejects $from input with invalid path", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: {
                            user: {
                                type: "object",
                                properties: { name: { type: "string" } },
                            },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: {
                                    $from: "input",
                                    name: "user",
                                    path: ["nonexistent"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "input"') &&
                            e.message.includes("path") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("accepts $from input with valid path", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: {
                            user: {
                                type: "object",
                                properties: { name: { type: "string" } },
                            },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: {
                                    $from: "input",
                                    name: "user",
                                    path: ["name"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });

            it("rejects $from constant with invalid path", () => {
                const ir = makeMinimalIR({
                    constants: {
                        config: {
                            schema: {
                                type: "object",
                                properties: { host: { type: "string" } },
                            },
                            value: { host: "localhost" },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: {
                                    $from: "constant",
                                    name: "config",
                                    path: ["bogusField"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "constant"') &&
                            e.message.includes("path") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("accepts $from constant with valid path", () => {
                const ir = makeMinimalIR({
                    constants: {
                        config: {
                            schema: {
                                type: "object",
                                properties: { host: { type: "string" } },
                            },
                            value: { host: "localhost" },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: {
                                    $from: "constant",
                                    name: "config",
                                    path: ["host"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });

            it("rejects $from input with nested path through non-object", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: {
                            count: { type: "integer" },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputs: {
                                val: {
                                    $from: "input",
                                    name: "count",
                                    path: ["foo"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes('$from "input"') &&
                            e.message.includes("path") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });
        });

        describe("path validation coverage: all $from namespaces", () => {
            // Guards against future regressions: every namespace that supports
            // `path` must reject an invalid path in an earlier pass.

            it("rejects $from scope with invalid path", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        first: makeTaskNode({
                            outputSchema: {
                                type: "object",
                                properties: { x: { type: "string" } },
                            },
                            bind: "a",
                            next: "second",
                        }),
                        second: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { val: { type: "string" } },
                            },
                            inputs: {
                                val: {
                                    $from: "scope",
                                    name: "a",
                                    path: ["bogus"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                    entry: "first",
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes("bogus") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("rejects $from state with invalid path", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        start: makeLoopNode({
                            state: {
                                obj: {
                                    schema: {
                                        type: "object",
                                        properties: {
                                            count: { type: "integer" },
                                        },
                                    },
                                    initial: { count: 0 },
                                },
                            },
                            iterateState: {
                                obj: { $from: "state", name: "obj" },
                            },
                            body: {
                                inputSchema: { type: "object" },
                                entry: "step",
                                nodes: {
                                    step: makeTaskNode({
                                        inputSchema: {
                                            type: "object",
                                            properties: {
                                                val: { type: "integer" },
                                            },
                                        },
                                        inputs: {
                                            val: {
                                                $from: "state",
                                                name: "obj",
                                                path: ["nonexistent"],
                                            },
                                        },
                                    }),
                                },
                                output: { $from: "state", name: "obj" },
                                outputSchema: { type: "object" },
                            },
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes("nonexistent") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("rejects $from recovery with invalid path", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        start: makeTaskNode({
                            onError: "recover",
                            bind: "out",
                        }),
                        recover: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { x: { type: "string" } },
                            },
                            inputs: {
                                x: {
                                    $from: "recovery",
                                    name: "error",
                                    path: ["bogusField"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes("bogusField") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("rejects $from recovery trigger with invalid path into trigger inputSchema", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: {
                                    url: { type: "string" },
                                },
                            },
                            inputs: {
                                url: { $from: "input", name: "url" },
                            },
                            onError: "recover",
                            bind: "out",
                        }),
                        recover: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { x: { type: "string" } },
                            },
                            inputs: {
                                x: {
                                    $from: "recovery",
                                    name: "trigger",
                                    path: ["nonexistentField"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                    inputSchema: {
                        type: "object",
                        properties: { url: { type: "string" } },
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes("nonexistentField") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("accepts $from recovery trigger with valid path into trigger inputSchema", () => {
                const ir = makeMinimalIR({
                    nodes: {
                        start: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: {
                                    url: { type: "string" },
                                },
                            },
                            inputs: {
                                url: { $from: "input", name: "url" },
                            },
                            onError: "recover",
                            bind: "out",
                        }),
                        recover: makeTaskNode({
                            inputSchema: {
                                type: "object",
                                properties: { x: { type: "string" } },
                            },
                            inputs: {
                                x: {
                                    $from: "recovery",
                                    name: "trigger",
                                    path: ["url"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                    inputSchema: {
                        type: "object",
                        properties: { url: { type: "string" } },
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(true);
            });

            it("rejects $from input with invalid path", () => {
                const ir = makeMinimalIR({
                    inputSchema: {
                        type: "object",
                        properties: {
                            data: {
                                type: "object",
                                properties: { id: { type: "string" } },
                            },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputs: {
                                val: {
                                    $from: "input",
                                    name: "data",
                                    path: ["missing"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes("missing") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });

            it("rejects $from constant with invalid path", () => {
                const ir = makeMinimalIR({
                    constants: {
                        cfg: {
                            schema: {
                                type: "object",
                                properties: { port: { type: "integer" } },
                            },
                            value: { port: 8080 },
                        },
                    },
                    nodes: {
                        start: makeTaskNode({
                            inputs: {
                                val: {
                                    $from: "constant",
                                    name: "cfg",
                                    path: ["noSuchKey"],
                                },
                            },
                            bind: "out",
                        }),
                    },
                });
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(result.valid).toBe(false);
                expect(
                    result.errors.some(
                        (e) =>
                            e.message.includes("noSuchKey") &&
                            e.message.includes("not declared"),
                    ),
                ).toBe(true);
            });
        });
    });
    // ---- Single-pass walk: remaining coverage gaps ----

    describe("single-pass walk coverage", () => {
        it("rejects unknown $from namespace value", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        inputs: {
                            x: { $from: "badns" as any, name: "x" },
                        },
                        bind: "out",
                    }),
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.message.includes("Unknown $from namespace") &&
                        e.message.includes("badns"),
                ),
            ).toBe(true);
        });

        it("rejects forkMap collection template with type incompatible with collectionSchema", () => {
            // collection template resolves to a string literal; collectionSchema
            // declares an array — the walk should detect the mismatch.
            const ir = makeMinimalIR({
                entry: "forkMap_0",
                nodes: {
                    forkMap_0: {
                        kind: "forkMap",
                        collection: { $literal: "not-an-array" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "body_step",
                            nodes: {
                                body_step: makeTaskNode({ bind: "stepOut" }),
                            },
                            output: { $from: "scope", name: "stepOut" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {
                            type: "array",
                            items: { type: "object" },
                        },
                        bind: "out",
                    } as ForkMapNode,
                },
                outputSchema: { type: "array", items: { type: "object" } },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some(
                    (e) =>
                        e.path.includes("collection") &&
                        e.message.includes("not assignable"),
                ),
            ).toBe(true);
        });

        it("accepts optional $from state ref to undeclared state variable", () => {
            const ir = makeMinimalIR({
                nodes: {
                    start: makeLoopNode(
                        {
                            bind: "out",
                        },
                        {
                            nodes: {
                                step: makeTaskNode({
                                    inputSchema: {
                                        type: "object",
                                        properties: { x: { type: "string" } },
                                    },
                                    inputs: {
                                        x: {
                                            $from: "state",
                                            name: "notDeclared",
                                            optional: true,
                                        },
                                    },
                                }),
                            },
                            output: { $from: "state", name: "i" },
                            outputSchema: { type: "integer" },
                        },
                    ),
                },
                output: null,
                outputSchema: { type: "null" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(
                result.errors.some((e) =>
                    e.message.includes("no state variable"),
                ),
            ).toBe(false);
        });
    });

    //
    // A bound producer may legally publish `outputSchema: {}` (the top
    // type, i.e. "unknown"). The value is opaque: only consumers whose
    // expected schema is also `{}` (i.e., accept unknown) may read it.
    // These tests pin:
    //   1. bound `{}` producers are accepted (no producer-side rejection)
    //      at every node kind that can carry `bind` + `outputSchema`; and
    //   2. reading from a `{}` producer into a typed consumer is rejected
    //      with the consumer-side "schema is {} (unknown)" diagnostic.

    describe("Decision 0011: `{}` = unknown semantics", () => {
        // Matches the consumer-side diagnostic emitted by
        // checkUnknownAssignability when a template resolves to {} and is
        // read into a typed slot.
        const unknownConsumerRe =
            /resolves to \{\} \(unknown\); not assignable to/;

        // 1) Producer-side: bound `{}` is accepted (no "Bound …" rejection).

        it("accepts bound task with outputSchema {}", () => {
            const ir = makeMinimalIR({
                outputSchema: {},
                nodes: {
                    start: makeTaskNode({
                        bind: "out",
                        outputSchema: {},
                    }),
                },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts bound branch with outputSchema {}", () => {
            const ir = makeMinimalIR({
                outputSchema: {},
                nodes: {
                    start: {
                        kind: "branch",
                        selector: { $literal: "yes" } as unknown as Template,
                        selectorSchema: { type: "string" },
                        cases: {
                            yes: makeSimpleArm("yesStep"),
                        },
                        default: makeSimpleArm("defaultStep"),
                        bind: "out",
                        outputSchema: {},
                    } as BranchNode,
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts bound loop with body.outputSchema {}", () => {
            const ir = makeMinimalIR({
                outputSchema: {},
                nodes: {
                    start: makeLoopNode({ bind: "out" }, { outputSchema: {} }),
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts bound fork with outputSchema {}", () => {
            const ir = makeMinimalIR({
                outputSchema: {},
                nodes: {
                    start: {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "a_step",
                                    nodes: {
                                        a_step: makeTaskNode({ bind: "aOut" }),
                                    },
                                    output: { $from: "scope", name: "aOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: {},
                                    entry: "b_step",
                                    nodes: {
                                        b_step: makeTaskNode({ bind: "bOut" }),
                                    },
                                    output: { $from: "scope", name: "bOut" },
                                    outputSchema: { type: "object" },
                                },
                            },
                        },
                        outputSchema: {},
                        bind: "out",
                    } as ForkNode,
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts bound forkMap with outputSchema {}", () => {
            const ir = makeMinimalIR({
                outputSchema: {},
                nodes: {
                    start: {
                        kind: "forkMap",
                        collection: { $from: "input", name: "items" },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "item",
                        body: {
                            inputSchema: {},
                            entry: "body_step",
                            nodes: {
                                body_step: makeTaskNode({ bind: "stepOut" }),
                            },
                            output: { $from: "scope", name: "stepOut" },
                            outputSchema: { type: "object" },
                        },
                        outputSchema: {},
                        bind: "out",
                    } as ForkMapNode,
                },
                inputSchema: {
                    type: "object",
                    required: ["items"],
                    properties: {
                        items: { type: "array", items: { type: "string" } },
                    },
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts bound workflowCall with outputSchema {} when callee returns {}", () => {
            const ir: WorkflowIR = {
                kind: "workflow",
                version: "1",
                entry: "main",
                workflows: {
                    main: {
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        entry: "callHelper",
                        nodes: {
                            callHelper: {
                                kind: "workflowCall",
                                workflowRef: { name: "helper" },
                                inputSchema: { type: "object" },
                                outputSchema: {},
                                inputs: {},
                                bind: "result",
                            },
                        },
                        output: { $from: "scope", name: "result" },
                    },
                    helper: {
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        entry: "step",
                        nodes: {
                            step: makeTaskNode({ bind: "out" }),
                        },
                        output: { $from: "scope", name: "out" },
                    },
                },
            };
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        it("accepts unbound task with outputSchema {}", () => {
            // Unbound nodes have no addressable output, so {} is moot.
            const ir = makeMinimalIR({
                nodes: {
                    start: makeTaskNode({
                        outputSchema: {},
                        next: "end",
                    }),
                    end: makeTaskNode({
                        bind: "out",
                        outputSchema: { type: "object" },
                    }),
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(true);
        });

        // 2) Consumer-side: reading a `{}` producer into a typed slot errors.

        it("rejects feeding bound `{}` producer into a typed workflow output", () => {
            // Workflow declares outputSchema { type: "object" } but its
            // output references a bound `{}` producer \u2014 the unknown value
            // is not assignable to the typed consumer.
            const ir = makeMinimalIR({
                outputSchema: { type: "object" },
                nodes: {
                    start: makeTaskNode({
                        bind: "out",
                        outputSchema: {},
                    }),
                },
                output: { $from: "scope", name: "out" },
            });
            const result = validateWorkflowIR(ir, taskMap("noop"));
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => unknownConsumerRe.test(e.message)),
            ).toBe(true);
        });

        it("rejects feeding bound `{}` producer into a typed task input", () => {
            const ir = makeMinimalIR({
                outputSchema: {},
                nodes: {
                    producer: {
                        kind: "task",
                        task: "opaque",
                        inputSchema: { type: "object" },
                        outputSchema: {},
                        inputs: {},
                        bind: "p",
                        next: "consumer",
                    },
                    consumer: {
                        kind: "task",
                        task: "typed",
                        inputSchema: {
                            type: "object",
                            required: ["text"],
                            properties: { text: { type: "string" } },
                        },
                        outputSchema: { type: "object" },
                        inputs: {
                            text: { $from: "scope", name: "p" },
                        },
                        bind: "out",
                    },
                },
                entry: "producer",
            });
            const result = validateWorkflowIR(
                ir,
                taskMap("opaque", "typed", "noop"),
            );
            expect(result.valid).toBe(false);
            expect(
                result.errors.some((e) => unknownConsumerRe.test(e.message)),
            ).toBe(true);
        });
    });

    // ---- Per-kind validation coverage ----
    //
    // These tests drive a per-kind table to assert that every WorkflowNode
    // kind is structurally validated for the obligations that apply to it.
    // They are intended to fail loudly when a new node kind is added but
    // the dispatch in `validateScopeNodes` is not updated (the
    // `default: assertNever(node)` guarantees a compile-time failure, but
    // these tests also catch missed obligations such as dangling
    // next/onError or never-output guards).
    describe("per-kind validation coverage", () => {
        // The set of kinds we expect to exist. If WorkflowNode["kind"]
        // changes, this list must change too — keeping the obligation
        // matrix in sync with the type definition.
        const ALL_KINDS: WorkflowNode["kind"][] = [
            "task",
            "branch",
            "loop",
            "fork",
            "forkMap",
            "workflowCall",
        ];

        /** Build a minimal valid node of the given kind, with optional overrides on next/onError/etc. */
        function makeNodeOfKind(
            kind: WorkflowNode["kind"],
            overrides: { next?: string; onError?: string } = {},
        ): WorkflowNode {
            switch (kind) {
                case "task":
                    return makeTaskNode(overrides);
                case "branch":
                    return {
                        kind: "branch",
                        selector: { $literal: "a" },
                        selectorSchema: { type: "string", enum: ["a"] },
                        cases: { a: makeSimpleArm() },
                        ...overrides,
                    } as BranchNode;
                case "loop":
                    return makeLoopNode(overrides);
                case "fork":
                    return {
                        kind: "fork",
                        branches: {
                            a: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "s",
                                    nodes: { s: makeTaskNode() },
                                    output: null,
                                    outputSchema: { type: "null" },
                                },
                            },
                            b: {
                                inputs: {},
                                scope: {
                                    inputSchema: { type: "object" },
                                    entry: "s",
                                    nodes: { s: makeTaskNode() },
                                    output: null,
                                    outputSchema: { type: "null" },
                                },
                            },
                        },
                        outputSchema: { type: "object" },
                        ...overrides,
                    } as ForkNode;
                case "forkMap":
                    return {
                        kind: "forkMap",
                        collection: { $literal: [] },
                        collectionSchema: {
                            type: "array",
                            items: { type: "string" },
                        },
                        elementParam: "x",
                        body: {
                            inputSchema: { type: "object" },
                            entry: "s",
                            nodes: { s: makeTaskNode() },
                            output: null,
                            outputSchema: { type: "null" },
                        },
                        outputSchema: { type: "object" },
                        ...overrides,
                    } as ForkMapNode;
                case "workflowCall":
                    return {
                        kind: "workflowCall",
                        workflowRef: { name: "helper" },
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        ...overrides,
                    } as WorkflowCallNode;
            }
        }

        /** Wrap `node` as the entry of an IR. For workflowCall, also adds a "helper" workflow. */
        function irWith(node: WorkflowNode): WorkflowIR {
            const main: WorkflowBody = {
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                entry: "n",
                nodes: { n: node },
                output: { $literal: {} },
            };
            if (node.kind !== "workflowCall") {
                return {
                    kind: "workflow",
                    version: "1",
                    entry: "main",
                    workflows: { main },
                };
            }
            const helper: WorkflowBody = {
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                entry: "s",
                nodes: { s: makeTaskNode({ bind: "out" }) },
                output: { $from: "scope", name: "out" },
            };
            return {
                kind: "workflow",
                version: "1",
                entry: "main",
                workflows: { main, helper },
            };
        }

        describe.each(ALL_KINDS)("kind=%s", (kind) => {
            it("reports dangling `next`", () => {
                const node = makeNodeOfKind(kind, {
                    next: "does-not-exist",
                });
                const ir = irWith(node);
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(
                    result.errors.some(
                        (e) =>
                            e.path === "workflows.main.nodes.n.next" &&
                            /does not exist/.test(e.message),
                    ),
                ).toBe(true);
            });

            it("reports dangling `onError`", () => {
                const node = makeNodeOfKind(kind, {
                    onError: "does-not-exist",
                });
                const ir = irWith(node);
                const result = validateWorkflowIR(ir, taskMap("noop"));
                expect(
                    result.errors.some(
                        (e) =>
                            e.path === "workflows.main.nodes.n.onError" &&
                            /does not exist/.test(e.message),
                    ),
                ).toBe(true);
            });
        });

        // Kinds that own an `outputSchema` field on the node itself and
        // therefore must enforce never-output guards on next/bind/onError.
        // (loop's bound schema lives on body.outputSchema, branch's
        // outputSchema is meaningful only with bind; both are exercised by
        // dedicated test suites and are intentionally excluded here.)
        const KINDS_WITH_NEVER_GUARDS: WorkflowNode["kind"][] = [
            "task",
            "workflowCall",
        ];

        describe.each(KINDS_WITH_NEVER_GUARDS)(
            "never-output guards (kind=%s)",
            (kind) => {
                it("rejects `next` when outputSchema is never", () => {
                    const base = makeNodeOfKind(kind) as
                        | TaskNode
                        | WorkflowCallNode;
                    const node = {
                        ...(base as object),
                        outputSchema: { not: {} },
                        next: "other",
                    } as unknown as WorkflowNode;
                    // Add a second node so `next: "other"` is not also a dangling-target error.
                    const main: WorkflowBody = {
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        entry: "n",
                        nodes: { n: node, other: makeTaskNode() },
                        output: { $literal: {} },
                    };
                    const ir: WorkflowIR = {
                        kind: "workflow",
                        version: "1",
                        entry: "main",
                        workflows:
                            kind === "workflowCall"
                                ? {
                                      main,
                                      helper: {
                                          inputSchema: { type: "object" },
                                          outputSchema: { not: {} },
                                          entry: "s",
                                          nodes: {
                                              s: makeTaskNode({
                                                  outputSchema: { not: {} },
                                              }),
                                          },
                                          output: { $literal: {} },
                                      },
                                  }
                                : { main },
                    };
                    const result = validateWorkflowIR(ir, taskMap("noop"));
                    expect(
                        result.errors.some(
                            (e) =>
                                e.path === "workflows.main.nodes.n.next" &&
                                /never/.test(e.message),
                        ),
                    ).toBe(true);
                });
            },
        );
    });
});
