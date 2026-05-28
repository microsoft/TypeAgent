// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskDefinition } from "workflow-model";
import { discoverWorkflows } from "../src/workflowDiscovery.js";

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

function validWorkflowJson(name: string, taskName: string): string {
    return JSON.stringify({
        kind: "workflow",
        version: "1",
        entry: name,
        workflows: {
            [name]: {
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                inputs: {},
                nodes: {
                    start: {
                        kind: "task",
                        task: taskName,
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
                entry: "start",
                output: { $from: "scope", name: "out" },
            },
        },
    });
}

describe("discoverWorkflows", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "wf-discovery-"));
    });

    afterEach(() => {
        try {
            rmSync(dir, { recursive: true, force: true });
        } catch {
            // Temp dirs will be cleaned by OS eventually.
        }
    });

    it("returns empty result for non-existent directory", async () => {
        const result = await discoverWorkflows(
            join(dir, "nope"),
            taskMap("noop"),
        );
        expect(result.workflows.size).toBe(0);
        expect(result.errors).toHaveLength(0);
    });

    it("returns empty result for empty directory", async () => {
        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(0);
        expect(result.errors).toHaveLength(0);
    });

    it("skips non-JSON files", async () => {
        writeFileSync(join(dir, "readme.md"), "# hello");
        writeFileSync(join(dir, "data.txt"), "not json");
        writeFileSync(
            join(dir, "valid.json"),
            validWorkflowJson("test-wf", "noop"),
        );

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(1);
        expect(result.workflows.has("test-wf")).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("loads multiple valid workflow files", async () => {
        writeFileSync(join(dir, "a.json"), validWorkflowJson("wf-a", "noop"));
        writeFileSync(join(dir, "b.json"), validWorkflowJson("wf-b", "noop"));

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(2);
        expect(result.workflows.has("wf-a")).toBe(true);
        expect(result.workflows.has("wf-b")).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("reports parse error for invalid JSON", async () => {
        writeFileSync(join(dir, "bad.json"), "{ not valid json }}}");

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].file).toBe(join(dir, "bad.json"));
        expect(typeof result.errors[0].errors).toBe("string");
    });

    it("reports validation errors for structurally invalid workflow", async () => {
        writeFileSync(
            join(dir, "invalid.json"),
            JSON.stringify({
                kind: "workflow",
                name: "bad-wf",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    start: {
                        kind: "task",
                        task: "unregistered.task",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
                entry: "start",
                output: { $from: "scope", name: "out" },
            }),
        );

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].file).toBe(join(dir, "invalid.json"));
        expect(Array.isArray(result.errors[0].errors)).toBe(true);
    });

    it("loads valid files and reports errors for invalid ones", async () => {
        writeFileSync(
            join(dir, "good.json"),
            validWorkflowJson("good-wf", "noop"),
        );
        writeFileSync(join(dir, "bad.json"), "not json");
        writeFileSync(
            join(dir, "invalid.json"),
            JSON.stringify({
                kind: "workflow",
                name: "bad2",
                version: "1",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                nodes: {
                    start: {
                        kind: "task",
                        task: "missing",
                        inputSchema: { type: "object" },
                        outputSchema: { type: "object" },
                        inputs: {},
                        bind: "out",
                    },
                },
                entry: "start",
                output: { $from: "scope", name: "out" },
            }),
        );

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(1);
        expect(result.workflows.has("good-wf")).toBe(true);
        expect(result.errors).toHaveLength(2);
    });

    it("does not recurse into subdirectories", async () => {
        const sub = join(dir, "sub");
        mkdirSync(sub);
        writeFileSync(
            join(sub, "nested.json"),
            validWorkflowJson("nested", "noop"),
        );
        const deeper = join(sub, "deeper");
        mkdirSync(deeper);
        writeFileSync(
            join(deeper, "deep.json"),
            validWorkflowJson("deep", "noop"),
        );

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.size).toBe(0);
        expect(result.workflows.has("nested")).toBe(false);
        expect(result.workflows.has("deep")).toBe(false);
    });

    it("uses workflow name as map key (not filename)", async () => {
        writeFileSync(
            join(dir, "file-a.json"),
            validWorkflowJson("actual-name", "noop"),
        );

        const result = await discoverWorkflows(dir, taskMap("noop"));
        expect(result.workflows.has("actual-name")).toBe(true);
        expect(result.workflows.has("file-a")).toBe(false);
    });
});
