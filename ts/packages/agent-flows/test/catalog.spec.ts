// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    automationId,
    parseAutomationId,
    describeExpression,
    detailForMacro,
    detailForPowerShellFlow,
    detailForWebFlow,
    extractRulePatterns,
    summarizeMacro,
    summarizePowerShellFlow,
    summarizeTaskFlow,
    summarizeWebFlow,
    type FlowIndexEntryLike,
    type MacroLike,
} from "../src/catalog/index.js";

const flowEntry: FlowIndexEntryLike = {
    actionName: "findLargeFiles",
    displayName: "Find large files",
    description: "Lists files over a size",
    grammarRuleText:
        '<findLargeFiles> [spacing=optional] = find large files in $(folder:wildcard) -> { actionName: "findLargeFiles" };',
    parameters: [{ name: "folder", type: "path", required: true }],
    created: "2026-10-01T00:00:00Z",
    updated: "2026-10-02T00:00:00Z",
    source: "reasoning",
    usageCount: 4,
    lastUsed: "2026-10-02T10:00:00Z",
    enabled: true,
};

function macro(overrides: Partial<MacroLike> = {}): MacroLike {
    return {
        macroId: "summarize-prs",
        version: 1,
        name: "Summarize PRs",
        description: "Lists open PRs",
        state: "draft",
        executionClass: "replayable",
        inputs: [
            {
                name: "repo",
                description: "Repository",
                required: true,
                secret: false,
                valueType: "string",
            },
            {
                name: "token",
                description: "Secret",
                required: true,
                secret: true,
            },
        ],
        steps: [
            {
                id: "step-1",
                toolName: "list_pull_requests",
                mcpServerName: "github",
                executionClass: "replayable",
                arguments: {
                    kind: "template",
                    value: { repo: "x", state: "open" },
                    bindings: [
                        {
                            path: ["repo"],
                            expression: { kind: "input", name: "repo" },
                        },
                    ],
                },
            },
            {
                id: "step-2",
                toolName: "get_pull_request",
                mcpServerName: "github",
                executionClass: "replayable",
                arguments: {
                    kind: "stepResult",
                    stepId: "step-1",
                    path: ["items", "0"],
                },
            },
        ],
        sourceTraceId: "trace-1",
        createdAt: "2026-10-02T00:00:00Z",
        warnings: ["step-2 contains a prompt value"],
        ...overrides,
    };
}

describe("automation ids", () => {
    test("round trips kind and native id", () => {
        const id = automationId("powershell", "a:b");
        expect(parseAutomationId(id)).toEqual({
            kind: "powershell",
            nativeId: "a:b",
        });
    });

    test("rejects unknown kinds and malformed ids", () => {
        expect(parseAutomationId("other:x")).toBeUndefined();
        expect(parseAutomationId("nokind")).toBeUndefined();
    });
});

describe("flow summaries", () => {
    test("extracts trigger patterns from stored grammar text", () => {
        expect(extractRulePatterns(flowEntry.grammarRuleText)).toEqual([
            "find large files in $(folder:wildcard)",
        ]);
        expect(extractRulePatterns(undefined)).toEqual([]);
    });

    test("PowerShell flow maps enabled to active and carries usage", () => {
        const summary = summarizePowerShellFlow(flowEntry);
        expect(summary).toMatchObject({
            id: "powershell:findLargeFiles",
            kind: "powershell",
            name: "Find large files",
            status: "active",
            triggers: 1,
            runCount: 4,
            lastRunAt: "2026-10-02T10:00:00Z",
            capabilities: [],
        });
        expect(
            summarizePowerShellFlow({ ...flowEntry, enabled: false }).status,
        ).toBe("disabled");
    });

    test("PowerShell detail lists stored sandbox policy as facts", () => {
        const detail = detailForPowerShellFlow(
            flowEntry,
            {
                sandbox: {
                    allowedCmdlets: ["Get-ChildItem"],
                    allowedPaths: [],
                    networkAccess: false,
                    maxExecutionTime: 30,
                },
            },
            "Get-ChildItem",
        );
        expect(detail.body).toEqual({
            language: "powershell",
            text: "Get-ChildItem",
        });
        expect(detail.safety).toEqual(
            expect.arrayContaining([
                { label: "Allowed cmdlets", value: "Get-ChildItem" },
                { label: "Allowed paths", value: "none" },
                { label: "Network access", value: "no" },
                { label: "Max run time", value: "30 s" },
            ]),
        );
    });

    test("TaskFlow summary uses explicit patterns when present", () => {
        const summary = summarizeTaskFlow(flowEntry, {
            grammarPatterns: ["a", "b"],
        });
        expect(summary.kind).toBe("taskflow");
        expect(summary.triggers).toBe(2);
    });

    test("WebFlow scope shows domains or any site", () => {
        expect(
            summarizeWebFlow({
                name: "searchAmazon",
                scope: { type: "site", domains: ["amazon.com"] },
                source: { type: "recording", timestamp: "2026-03-14" },
            }),
        ).toMatchObject({
            id: "webflow:searchAmazon",
            scope: "amazon.com",
            origin: "recording",
            status: "active",
            capabilities: ["delete"],
        });
        expect(
            summarizeWebFlow({ name: "g", scope: { type: "global" } }).scope,
        ).toBe("Any site");
    });

    test("WebFlow detail maps parameters and script", () => {
        const detail = detailForWebFlow({
            name: "g",
            parameters: { q: { type: "string", required: true } },
            script: "return 1;",
        });
        expect(detail.parameters).toEqual([
            { name: "q", type: "string", required: true },
        ]);
        expect(detail.body?.language).toBe("javascript");
    });
});

describe("macro summaries", () => {
    test("maps lifecycle state to status and verbs", () => {
        expect(summarizeMacro(macro())).toMatchObject({
            status: "needsReview",
            capabilities: ["validate", "approve", "delete"],
            version: 1,
            origin: "trace",
            scope: "Copilot tools",
        });
        expect(summarizeMacro(macro({ state: "approved" }))).toMatchObject({
            status: "active",
            capabilities: ["disable", "delete"],
        });
        expect(summarizeMacro(macro({ state: "disabled" }))).toMatchObject({
            status: "disabled",
            capabilities: ["delete"],
        });
    });

    test("uses learning directory and rules when present", () => {
        const summary = summarizeMacro(
            macro({
                learning: {
                    cwd: "C:\\src",
                    grammarRules: ["a", "b"],
                    mode: "prepare",
                },
            }),
        );
        expect(summary.scope).toBe("C:\\src");
        expect(summary.triggers).toBe(2);
    });

    test("identifies candidate and procedure origins", () => {
        expect(summarizeMacro(macro({ candidateProvenance: {} })).origin).toBe(
            "candidate",
        );
        expect(
            summarizeMacro(macro({ sourceTraceId: "procedure:abc" })).origin,
        ).toBe("procedure");
    });

    test("detail describes steps and marks secret inputs without values", () => {
        const detail = detailForMacro(macro());
        expect(detail.steps).toEqual([
            {
                id: "step-1",
                title: "github / list_pull_requests",
                lines: ["repo <- input: repo"],
            },
            {
                id: "step-2",
                title: "github / get_pull_request",
                lines: ["result of step-1: items.0"],
            },
        ]);
        expect(detail.parameters.find((p) => p.name === "token")).toMatchObject(
            { secret: true },
        );
        expect(detail.safety).toEqual(
            expect.arrayContaining([
                { label: "Secret inputs", value: "token" },
                {
                    label: "Schema fingerprints",
                    value: "not recorded for every step",
                },
            ]),
        );
    });

    test("describeExpression truncates long literals", () => {
        const [line] = describeExpression({
            kind: "literal",
            value: "x".repeat(500),
        });
        expect(line.length).toBeLessThan(160);
        expect(line.endsWith("...")).toBe(true);
    });
});
