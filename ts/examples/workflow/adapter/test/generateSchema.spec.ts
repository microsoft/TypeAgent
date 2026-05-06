// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    generateDynamicSchemaText,
    toTypeName,
} from "../src/generateSchema.js";
import { WorkflowIR } from "workflow-model";

describe("toTypeName", () => {
    it("converts hyphenated names to PascalCase + Action", () => {
        expect(toTypeName("d1-standup-prep")).toBe("D1StandupPrepAction");
        expect(toTypeName("d8-summarize-url")).toBe("D8SummarizeUrlAction");
    });

    it("handles single-segment names", () => {
        expect(toTypeName("hello")).toBe("HelloAction");
    });

    it("handles underscores", () => {
        expect(toTypeName("my_cool_workflow")).toBe("MyCoolWorkflowAction");
    });
});

describe("generateDynamicSchemaText", () => {
    it("returns placeholder for empty map", () => {
        const result = generateDynamicSchemaText(new Map());
        expect(result).toContain("noWorkflowsLoaded");
        expect(result).toContain("export type WorkflowAction");
    });

    it("generates typed action for a workflow with string params", () => {
        const ir: WorkflowIR = {
            kind: "workflow",
            name: "d4-commit-summary",
            description: "Generate a commit message from staged changes.",
            version: "1.0",
            inputSchema: {
                type: "object",
                required: ["repoPath"],
                properties: {
                    repoPath: {
                        type: "string",
                        description: "Absolute path to the git repo.",
                    },
                },
            },
            outputSchema: { type: "object" },
            nodes: {},
            entry: "start",
            output: {},
        };

        const workflows = new Map([["d4-commit-summary", ir]]);
        const result = generateDynamicSchemaText(workflows);

        expect(result).toContain("export type D4CommitSummaryAction");
        expect(result).toContain('actionName: "d4-commit-summary"');
        expect(result).toContain("repoPath: string;");
        expect(result).toContain("// Absolute path to the git repo.");
        expect(result).toContain("// Generate a commit message");
        expect(result).toContain("export type WorkflowAction =");
        expect(result).toContain("| D4CommitSummaryAction;");
    });

    it("marks optional parameters correctly", () => {
        const ir: WorkflowIR = {
            kind: "workflow",
            name: "d5-code-review-prep",
            version: "1.0",
            inputSchema: {
                type: "object",
                required: ["repoPath"],
                properties: {
                    repoPath: {
                        type: "string",
                        description: "Repo path.",
                    },
                    baseBranch: {
                        type: "string",
                        description: "Branch to diff against.",
                    },
                },
            },
            outputSchema: { type: "object" },
            nodes: {},
            entry: "start",
            output: {},
        };

        const workflows = new Map([["d5-code-review-prep", ir]]);
        const result = generateDynamicSchemaText(workflows);

        expect(result).toContain("repoPath: string;");
        expect(result).toContain("baseBranch?: string;");
    });

    it("handles array types", () => {
        const ir: WorkflowIR = {
            kind: "workflow",
            name: "d1-standup-prep",
            version: "1.0",
            inputSchema: {
                type: "object",
                required: ["repos", "author"],
                properties: {
                    repos: {
                        type: "array",
                        items: { type: "string" },
                        description: "Git repos.",
                    },
                    author: {
                        type: "string",
                        description: "Author.",
                    },
                },
            },
            outputSchema: { type: "object" },
            nodes: {},
            entry: "start",
            output: {},
        };

        const workflows = new Map([["d1-standup-prep", ir]]);
        const result = generateDynamicSchemaText(workflows);

        expect(result).toContain("repos: string[];");
        expect(result).toContain("author: string;");
    });

    it("generates union for multiple workflows", () => {
        const ir1: WorkflowIR = {
            kind: "workflow",
            name: "wf-a",
            version: "1.0",
            inputSchema: {
                type: "object",
                properties: { x: { type: "number" } },
            },
            outputSchema: { type: "object" },
            nodes: {},
            entry: "start",
            output: {},
        };
        const ir2: WorkflowIR = {
            kind: "workflow",
            name: "wf-b",
            version: "1.0",
            inputSchema: {
                type: "object",
                properties: { y: { type: "boolean" } },
            },
            outputSchema: { type: "object" },
            nodes: {},
            entry: "start",
            output: {},
        };

        const workflows = new Map([
            ["wf-a", ir1],
            ["wf-b", ir2],
        ]);
        const result = generateDynamicSchemaText(workflows);

        expect(result).toContain("| WfAAction");
        expect(result).toContain("| WfBAction;");
        expect(result).toContain("x?: number;");
        expect(result).toContain("y?: boolean;");
    });

    it("handles number and integer types", () => {
        const ir: WorkflowIR = {
            kind: "workflow",
            name: "test-nums",
            version: "1.0",
            inputSchema: {
                type: "object",
                required: ["count"],
                properties: {
                    count: { type: "integer" },
                    ratio: { type: "number" },
                },
            },
            outputSchema: { type: "object" },
            nodes: {},
            entry: "start",
            output: {},
        };

        const workflows = new Map([["test-nums", ir]]);
        const result = generateDynamicSchemaText(workflows);

        expect(result).toContain("count: number;");
        expect(result).toContain("ratio?: number;");
    });
});
