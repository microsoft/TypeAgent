// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";

export const PLANNING_USER_PROMPT =
    "Create an execution plan for this task using the given logical syntax";

export const AGENT_PLAN_JSON_SCHEMA = {
    type: "object",
    properties: {
        version: { type: "string", const: "1.1" },
        id: { type: "string" },
        goal: { type: "string" },
        bindings: { type: "array" },
        preconditions: { type: "array" },
        invariants: { type: "array" },
        steps: { type: "array" }, // PlanNode[]
        postconditions: { type: "array" },
        cleanup: { type: "array" },
        checkpoints: { type: "array", items: { type: "number" } },
        limits: { type: "object" },
        permissions: { type: "object" },
        metadata: { type: "object" },
    },
    required: [
        "version",
        "id",
        "goal",
        "steps",
        "limits",
        "permissions",
        "metadata",
    ],
};

export function buildPlanningPrompt(task: string, workingDirectory: string) {
    // TODO fix this path so it auto finds in the dist
    const specSchema = readFileSync("./src/specSchema.ts", "utf-8");

    return `
    You are a planning agent. Your job is to create a structured execution plan.

    Task: ${task}

    Working Directory: ${workingDirectory}

    Output a plan using this logical syntax:

    ${specSchema}

    `;
}
