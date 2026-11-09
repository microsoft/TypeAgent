// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    induceMacroFromTrace,
    getRecordedArgumentDependencies,
    validateMacro,
    type RecordedInteractionTrace,
    type ReplayToolHost,
} from "@typeagent/copilot-macros";

const replayHost: ReplayToolHost = {
    inspectTool: async (mcpServerName, toolName) => ({
        ...(mcpServerName ? { mcpServerName } : {}),
        toolName,
        schemaFingerprint: "v1",
    }),
    callTool: async () => {
        throw new Error("Induction must not execute tools.");
    },
};

function trace(
    call: Omit<
        Partial<RecordedInteractionTrace["toolCalls"][number]>,
        "mcpServerName"
    > & { mcpServerName?: string | null } = {},
): RecordedInteractionTrace {
    const { mcpServerName, ...overrides } = call;
    const toolCall = {
        toolCallId: "call-1",
        name: "read",
        ...(mcpServerName === null
            ? {}
            : { mcpServerName: mcpServerName ?? "typeagent-workspace" }),
        arguments: { path: "package.json" },
        result: { content: "{}" },
        status: "completed" as const,
        ...overrides,
    };
    return {
        schemaVersion: 1,
        sessionId: "session-1",
        cwd: ".",
        prompt: "Read package.json",
        response: "Done",
        startedAt: "2026-08-14T10:00:00.000Z",
        completedAt: "2026-08-14T10:00:01.000Z",
        toolCalls: [toolCall],
    };
}

describe("macro induction and validation", () => {
    it("projects only argument paths and source call identities from existing binding inference", () => {
        const source = trace({
            result: { secretResultKey: "raw-only" },
            modelResult: { id: "generated-id", content: "private-body" },
        });
        source.toolCalls.push({
            toolCallId: "call-2",
            name: "fetch",
            arguments: { id: "generated-id" },
            status: "completed",
            result: { content: "private-answer" },
        });
        const projection = getRecordedArgumentDependencies(source);
        expect(projection).toEqual([
            { toolCallId: "call-1", dependencies: [] },
            {
                toolCallId: "call-2",
                dependencies: [
                    {
                        argumentPath: ["id"],
                        sourceToolCallId: "call-1",
                        expressionKind: "stepResult",
                    },
                ],
            },
        ]);
        const encoded = JSON.stringify(projection);
        for (const value of [
            "generated-id",
            "private-body",
            "private-answer",
            "secretResultKey",
        ])
            expect(encoded).not.toContain(value);
    });
    it.each([
        "missing",
        "failed",
        "different",
        "redacted",
        "raw-only",
        "future",
    ])("does not invent an earlier-result dependency (%s)", (condition) => {
        const source = trace({
            result: { id: "generated-id" },
            modelResult: { id: "generated-id" },
        });
        source.toolCalls.push({
            toolCallId: "call-2",
            name: "fetch",
            arguments: { id: "generated-id" },
            status: "completed",
            result: {},
        });
        if (condition === "missing") {
            delete source.toolCalls[0].result;
            delete source.toolCalls[0].modelResult;
        }
        if (condition === "failed") source.toolCalls[0].status = "failed";
        if (condition === "different")
            source.toolCalls[1].arguments = { id: "different-id" };
        if (condition === "redacted") {
            source.toolCalls[0].modelResult = { id: "[REDACTED]" };
            source.toolCalls[1].arguments = { id: "[REDACTED]" };
        }
        if (condition === "raw-only")
            source.toolCalls[0].modelResult = { id: "different-model-id" };
        if (condition === "future") source.toolCalls.reverse();
        expect(
            getRecordedArgumentDependencies(source).every(
                (call) => call.dependencies.length === 0,
            ),
        ).toBe(true);
    });
    it("validates template target paths before nested expressions without changing first-error messages", async () => {
        const macro = await induceMacroFromTrace(
            "trace-order",
            trace(),
            "macro-order",
            "Template ordering",
            "",
            "2026-10-12T00:00:00Z",
            replayHost,
        );
        const expression = {
            kind: "template" as const,
            value: { path: "package.json" },
            bindings: [
                {
                    path: ["missing"],
                    expression: { kind: "input" as const, name: "unknown" },
                },
            ],
        };
        macro.steps[0].arguments = expression;
        expect(
            validateMacro(macro).issues.find(
                (issue) => issue.code === "invalidExpression",
            )?.message,
        ).toBe("Template binding path is unavailable: missing");
        expression.bindings[0].path = ["path"];
        expect(
            validateMacro(macro).issues.find(
                (issue) => issue.code === "invalidExpression",
            )?.message,
        ).toBe("Unknown input: unknown");
        expression.bindings[0].path = [];
        expect(
            validateMacro(macro).issues.find(
                (issue) => issue.code === "invalidExpression",
            )?.message,
        ).toBe("A template binding requires a non-empty path.");
        expression.bindings = [];
        expect(
            validateMacro(macro).issues.find(
                (issue) => issue.code === "invalidExpression",
            )?.message,
        ).toBe("A template expression requires at least one binding.");
    });

    it("uses model-facing guards and references throughout a mixed agent procedure", async () => {
        const source = trace({
            result: {
                content: '{"item":{"id":"item-123"}}',
                detailedContent: "UI-only result",
            },
            modelResult: { item: { id: "item-123" } },
        });
        source.toolCalls.push({
            toolCallId: "call-2",
            name: "native_tool",
            arguments: { itemId: "item-123" },
            result: { content: '{"ok":true}', detailedContent: "UI-only" },
            modelResult: { ok: true },
            status: "completed",
        });
        const before = structuredClone(source);
        const macro = await induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Mixed result views",
            "",
            "2026-09-29T08:00:00.000Z",
            replayHost,
        );

        expect(source).toEqual(before);
        expect(macro.executionClass).toBe("agentRequired");
        expect(macro.steps[0].executionClass).toBe("replayable");
        expect(macro.steps[0].postconditions).toEqual([
            { kind: "resultType", valueType: "object" },
            { kind: "resultPathExists", path: ["item", "id"] },
        ]);
        expect(macro.steps[1]).toMatchObject({
            executionClass: "agentRequired",
            arguments: {
                kind: "template",
                bindings: [
                    {
                        path: ["itemId"],
                        expression: {
                            kind: "stepResult",
                            stepId: "step-1",
                            path: ["item", "id"],
                        },
                    },
                ],
            },
            postconditions: [
                { kind: "resultType", valueType: "object" },
                { kind: "resultPathExists", path: ["ok"] },
            ],
        });
        expect(validateMacro(macro, source).valid).toBe(true);
    });

    it.each([
        [null, "null"],
        [false, "boolean"],
        [0, "number"],
        ["", "string"],
    ])(
        "retains the model-facing primitive %s",
        async (modelResult, valueType) => {
            const macro = await induceMacroFromTrace(
                "trace-1",
                trace({ mcpServerName: null, modelResult }),
                "macro-1",
                "Primitive result",
                "",
                "2026-09-29T08:00:00.000Z",
            );
            expect(macro.steps[0].postconditions).toEqual([
                { kind: "resultType", valueType },
            ]);
            expect(macro.warnings).not.toContainEqual(
                expect.stringContaining("no captured model-facing result"),
            );
        },
    );

    it("keeps deterministic replay guards on raw results", async () => {
        const macro = await induceMacroFromTrace(
            "trace-1",
            trace({
                result: { raw: "value" },
                modelResult: { visible: "value" },
            }),
            "macro-1",
            "Replay result",
            "",
            "2026-09-29T08:00:00.000Z",
            replayHost,
        );
        expect(macro.executionClass).toBe("replayable");
        expect(macro.steps[0].postconditions).toEqual([
            { kind: "resultType", valueType: "object" },
            { kind: "resultPathExists", path: ["raw"] },
        ]);
    });

    it("preserves legacy guards and warns when model-facing evidence was not captured", async () => {
        const macro = await induceMacroFromTrace(
            "trace-1",
            trace({ mcpServerName: null, result: { content: "legacy" } }),
            "macro-1",
            "Legacy result",
            "",
            "2026-09-29T08:00:00.000Z",
        );
        expect(macro.steps[0].postconditions).toContainEqual({
            kind: "resultPathExists",
            path: ["content"],
        });
        expect(macro.warnings).toContainEqual(
            expect.stringContaining("no captured model-facing result"),
        );
    });

    it("induces a replayable linear workspace draft", async () => {
        const source = trace();
        const macro = await induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Read package",
            "Reads package metadata",
            "2026-08-14T10:01:00.000Z",
            replayHost,
        );

        expect(macro).toMatchObject({
            macroId: "macro-1",
            version: 1,
            state: "draft",
            executionClass: "replayable",
            inputs: [
                expect.objectContaining({
                    name: "step_1_path",
                    valueType: "string",
                }),
            ],
            steps: [
                {
                    id: "step-1",
                    toolName: "read",
                    mcpServerName: "typeagent-workspace",
                    arguments: {
                        kind: "template",
                        value: { path: "package.json" },
                        bindings: [
                            {
                                path: ["path"],
                                expression: {
                                    kind: "input",
                                    name: "step_1_path",
                                },
                            },
                        ],
                    },
                    postconditions: [
                        { kind: "resultType", valueType: "object" },
                        {
                            kind: "resultPathExists",
                            path: ["content"],
                        },
                    ],
                },
            ],
        });
        expect(validateMacro(macro, source).valid).toBe(true);
    });

    it("classifies native tools as agent required without inspecting them", async () => {
        const macro = await induceMacroFromTrace(
            "trace-1",
            trace({ name: "shell", mcpServerName: null }),
            "macro-1",
            "Run command",
            "",
            "2026-08-14T10:01:00.000Z",
            {
                ...replayHost,
                inspectTool: async () => {
                    throw new Error("Native tools must not be inspected.");
                },
            },
        );

        expect(macro.executionClass).toBe("agentRequired");
        expect(macro.warnings).toContainEqual(
            expect.stringContaining("agent-guided execution"),
        );
    });

    it.each(["example-server", "github-mcp-server"])(
        "classifies available MCP tools on %s as replayable",
        async (mcpServerName) => {
            const macro = await induceMacroFromTrace(
                "trace-1",
                trace({ name: "create_item", mcpServerName }),
                "macro-1",
                "Create item",
                "",
                "2026-08-14T10:01:00.000Z",
                replayHost,
            );

            expect(macro.executionClass).toBe("replayable");
            expect(macro.warnings).not.toContainEqual(
                expect.stringContaining("agent-guided execution"),
            );
        },
    );

    it.each(["github-mcp-server", "unconfigured-server"])(
        "requires an agent for unavailable MCP tools on %s",
        async (mcpServerName) => {
            const inspections: unknown[] = [];
            const macro = await induceMacroFromTrace(
                "trace-1",
                trace({ name: "web_search", mcpServerName }),
                "macro-1",
                "Search",
                "",
                "2026-08-14T10:01:00.000Z",
                {
                    ...replayHost,
                    inspectTool: async (...args) => {
                        inspections.push(args);
                        return undefined;
                    },
                },
            );

            expect(inspections).toEqual([
                [mcpServerName, "web_search", { cwd: "." }],
            ]);
            expect(macro.executionClass).toBe("agentRequired");
            expect(macro.steps[0]).toMatchObject({
                toolName: "web_search",
                mcpServerName,
                executionClass: "agentRequired",
            });
            expect(macro.warnings).toContainEqual(
                expect.stringContaining(`${mcpServerName}/web_search`),
            );
            expect(validateMacro(macro).valid).toBe(true);
        },
    );

    it("requires an agent when no replay host is configured", async () => {
        const macro = await induceMacroFromTrace(
            "trace-1",
            trace(),
            "macro-1",
            "Read",
            "",
            "2026-08-14T10:01:00.000Z",
        );
        expect(macro.executionClass).toBe("agentRequired");
        expect(macro.steps[0].executionClass).toBe("agentRequired");
    });

    it("propagates inspection failures instead of treating them as unavailable tools", async () => {
        await expect(
            induceMacroFromTrace(
                "trace-1",
                trace(),
                "macro-1",
                "Read",
                "",
                "2026-08-14T10:01:00.000Z",
                {
                    ...replayHost,
                    inspectTool: async () => {
                        throw new Error("Authentication failed");
                    },
                },
            ),
        ).rejects.toThrow("Authentication failed");
    });

    it("turns redacted arguments into required secret inputs", async () => {
        const macro = await induceMacroFromTrace(
            "trace-1",
            trace({ arguments: { authorization: "[REDACTED]" } }),
            "macro-1",
            "Read secure data",
            "",
            "2026-08-14T10:01:00.000Z",
        );

        expect(macro.inputs).toEqual([
            {
                name: "step_1_authorization",
                description: "Secret value required by step-1 at authorization",
                required: true,
                secret: true,
            },
        ]);
        expect(macro.steps[0].arguments).toEqual({
            kind: "template",
            value: { authorization: "[REDACTED]" },
            bindings: [
                {
                    path: ["authorization"],
                    expression: {
                        kind: "input",
                        name: "step_1_authorization",
                    },
                },
            ],
        });
    });

    it("binds a later argument to an earlier captured result", async () => {
        const source = trace();
        source.prompt = "Find package.json and inspect it";
        source.toolCalls[0].result = { match: { path: "src/package.json" } };
        source.toolCalls.push({
            toolCallId: "call-2",
            name: "read",
            mcpServerName: "typeagent-workspace",
            arguments: { path: "src/package.json", encoding: "utf8" },
            result: { content: "{}" },
            status: "completed",
        });

        const macro = await induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Find and read package",
            "",
            "2026-08-14T10:01:00.000Z",
        );

        expect(macro.steps[1].arguments).toEqual({
            kind: "template",
            value: { path: "src/package.json", encoding: "utf8" },
            bindings: [
                {
                    path: ["path"],
                    expression: {
                        kind: "stepResult",
                        stepId: "step-1",
                        path: ["match", "path"],
                    },
                },
            ],
        });
    });

    it("canonicalizes omitted tool arguments as an empty object", async () => {
        const source = trace();
        delete source.toolCalls[0].arguments;
        const macro = await induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Read defaults",
            "",
            "2026-08-14T10:01:00.000Z",
        );

        expect(macro.steps[0].arguments).toEqual({
            kind: "literal",
            value: {},
        });
        expect(JSON.parse(JSON.stringify(macro))).toEqual(macro);
    });

    it("rejects a draft induced from a failed tool call", async () => {
        const source = trace({ status: "failed" });
        const macro = await induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Read package",
            "",
            "2026-08-14T10:01:00.000Z",
        );

        expect(validateMacro(macro, source)).toMatchObject({
            valid: false,
            issues: expect.arrayContaining([
                expect.objectContaining({ code: "unsuccessfulSourceStep" }),
            ]),
        });
    });
});
