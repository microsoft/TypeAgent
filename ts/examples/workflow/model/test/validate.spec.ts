// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WorkflowIR,
    TaskDefinition,
    validateWorkflowIR,
} from "../src/index.js";

function makeMinimalIR(overrides?: Partial<WorkflowIR>): WorkflowIR {
    return {
        kind: "workflow",
        name: "test-workflow",
        version: "1",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        entry: "start",
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
        output: { $from: "scope", name: "out" },
        ...overrides,
    };
}

function makeTask(name: string): TaskDefinition {
    return {
        name,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
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
                start: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {},
                    next: "nowhere",
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("nowhere");
    });

    it("rejects wrong kind", () => {
        const ir = makeMinimalIR();
        (ir as any).kind = "not-a-workflow";
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
    });

    it("rejects broken onError target", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {},
                    onError: "ghost",
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].message).toContain("ghost");
    });

    it("rejects branch case pointing to non-existent node", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: true,
                    selectorSchema: { type: "boolean" },
                    cases: { true: "missing", false: "start" },
                    default: "start",
                } as any,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("missing"))).toBe(
            true,
        );
    });

    it("rejects branch default pointing to non-existent node", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: true,
                    selectorSchema: { type: "boolean" },
                    cases: { true: "start" },
                    default: "nowhere",
                } as any,
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
                start: {
                    kind: "loop",
                    inputs: {},
                    inputSchema: { type: "object" },
                    state: {
                        i: {
                            schema: { type: "integer" },
                            initial: 0,
                        },
                    },
                    body: {
                        entry: "missing",
                        nodes: {
                            step: {
                                kind: "task",
                                task: "noop",
                                inputSchema: { type: "object" },
                                outputSchema: { type: "object" },
                                inputs: {},
                            },
                        },
                    },
                    iterateState: {},
                    output: { $from: "state", name: "i" },
                    outputSchema: { type: "integer" },
                    maxIterations: 10,
                    bind: "out",
                } as any,
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
                start: {
                    kind: "loop",
                    inputs: {},
                    inputSchema: { type: "object" },
                    state: {
                        i: {
                            schema: { type: "integer" },
                            initial: 0,
                        },
                    },
                    body: {
                        entry: "step",
                        nodes: {
                            step: {
                                kind: "task",
                                task: "noop",
                                inputSchema: { type: "object" },
                                outputSchema: { type: "object" },
                                inputs: {},
                                next: "ghost",
                            },
                        },
                    },
                    iterateState: {},
                    output: { $from: "state", name: "i" },
                    outputSchema: { type: "integer" },
                    maxIterations: 10,
                    bind: "out",
                } as any,
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("ghost"))).toBe(
            true,
        );
    });

    it("allows sentinel @iterate and @exit inside loop body branch", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "loop",
                    inputs: {},
                    inputSchema: { type: "object" },
                    state: {
                        i: {
                            schema: { type: "integer" },
                            initial: 0,
                        },
                    },
                    body: {
                        entry: "decide",
                        nodes: {
                            decide: {
                                kind: "branch",
                                selector: true,
                                selectorSchema: { type: "boolean" },
                                cases: {
                                    true: "@exit",
                                    false: "@iterate",
                                },
                                default: "@iterate",
                            } as any,
                        },
                    },
                    iterateState: {},
                    output: { $from: "state", name: "i" },
                    outputSchema: { type: "integer" },
                    maxIterations: 10,
                    bind: "out",
                } as any,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(true);
    });

    it("rejects sentinel @iterate outside loop body", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "branch",
                    selector: true,
                    selectorSchema: { type: "boolean" },
                    cases: { true: "@iterate" },
                    default: "start",
                } as any,
            },
        });
        const result = validateWorkflowIR(ir);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.message.includes("@iterate"))).toBe(
            true,
        );
    });

    it("rejects loop next pointing to non-existent node", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "loop",
                    inputs: {},
                    inputSchema: { type: "object" },
                    state: {
                        i: {
                            schema: { type: "integer" },
                            initial: 0,
                        },
                    },
                    body: {
                        entry: "step",
                        nodes: {
                            step: {
                                kind: "branch",
                                selector: true,
                                selectorSchema: { type: "boolean" },
                                cases: { true: "@exit" },
                                default: "@iterate",
                            } as any,
                        },
                    },
                    iterateState: {},
                    output: { $from: "state", name: "i" },
                    outputSchema: { type: "integer" },
                    maxIterations: 10,
                    next: "nowhere",
                    bind: "out",
                } as any,
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
        // Should report at least: missing entry, unregistered task, broken next
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it("includes path in error messages", () => {
        const ir = makeMinimalIR({
            nodes: {
                start: {
                    kind: "task",
                    task: "noop",
                    inputSchema: { type: "object" },
                    outputSchema: { type: "object" },
                    inputs: {},
                    next: "ghost",
                    bind: "out",
                },
            },
        });
        const result = validateWorkflowIR(ir, taskMap("noop"));
        expect(result.valid).toBe(false);
        expect(result.errors[0].path).toContain("nodes.start");
    });
});
