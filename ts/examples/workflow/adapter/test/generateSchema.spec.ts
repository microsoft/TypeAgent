// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { generateDynamicSchema, toTypeName } from "../src/generateSchema.js";
import {
    fromJSONParsedActionSchema,
    ParsedActionSchemaJSON,
} from "@typeagent/action-schema";
import { WorkflowIR } from "workflow-model";

function parsePasContent(content: string) {
    return fromJSONParsedActionSchema(
        JSON.parse(content) as ParsedActionSchemaJSON,
    );
}

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

describe("generateDynamicSchema", () => {
    it("returns undefined for empty map", () => {
        const result = generateDynamicSchema(new Map());
        expect(result).toBeUndefined();
    });

    it("generates pas schema for a workflow with string params", () => {
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
        const result = generateDynamicSchema(workflows)!;

        expect(result.format).toBe("pas");
        const parsed = parsePasContent(result.content);
        expect(parsed.entry.action?.name).toBe("WorkflowAction");
        expect(parsed.actionSchemas.has("d4-commit-summary")).toBe(true);
        const action = parsed.actionSchemas.get("d4-commit-summary")!;
        expect(action.name).toBe("D4CommitSummaryAction");
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
        const result = generateDynamicSchema(workflows)!;

        expect(result.format).toBe("pas");
        const parsed = parsePasContent(result.content);
        const action = parsed.actionSchemas.get("d5-code-review-prep")!;
        expect(action.type.type).toBe("object");
        if (action.type.type === "object") {
            const params = action.type.fields["parameters"];
            expect(params).toBeDefined();
            if (params && params.type.type === "object") {
                expect(params.type.fields["repoPath"].optional).toBeFalsy();
                expect(params.type.fields["baseBranch"].optional).toBe(true);
            }
        }
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
        const result = generateDynamicSchema(workflows)!;

        expect(result.format).toBe("pas");
        const parsed = parsePasContent(result.content);
        const action = parsed.actionSchemas.get("d1-standup-prep")!;
        if (action.type.type === "object") {
            const params = action.type.fields["parameters"];
            if (params && params.type.type === "object") {
                expect(params.type.fields["repos"].type.type).toBe("array");
                expect(params.type.fields["author"].type.type).toBe("string");
            }
        }
    });

    it("generates schema for multiple workflows", () => {
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
        const result = generateDynamicSchema(workflows)!;

        expect(result.format).toBe("pas");
        const parsed = parsePasContent(result.content);
        expect(parsed.actionSchemas.has("wf-a")).toBe(true);
        expect(parsed.actionSchemas.has("wf-b")).toBe(true);
        expect(parsed.actionSchemas.get("wf-a")!.name).toBe("WfAAction");
        expect(parsed.actionSchemas.get("wf-b")!.name).toBe("WfBAction");
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
        const result = generateDynamicSchema(workflows)!;

        expect(result.format).toBe("pas");
        const parsed = parsePasContent(result.content);
        const action = parsed.actionSchemas.get("test-nums")!;
        if (action.type.type === "object") {
            const params = action.type.fields["parameters"];
            if (params && params.type.type === "object") {
                expect(params.type.fields["count"].type.type).toBe("number");
                expect(params.type.fields["count"].optional).toBeFalsy();
                expect(params.type.fields["ratio"].type.type).toBe("number");
                expect(params.type.fields["ratio"].optional).toBe(true);
            }
        }
    });
});
