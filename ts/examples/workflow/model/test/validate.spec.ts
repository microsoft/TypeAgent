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
});
