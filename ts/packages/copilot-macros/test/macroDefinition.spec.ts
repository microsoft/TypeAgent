// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    induceMacroFromTrace,
    validateMacro,
    type RecordedInteractionTrace,
} from "@typeagent/copilot-macros";

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
    it("induces a replayable linear workspace draft", () => {
        const source = trace();
        const macro = induceMacroFromTrace(
            "trace-1",
            source,
            "macro-1",
            "Read package",
            "Reads package metadata",
            "2026-08-14T10:01:00.000Z",
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

    it("classifies unknown tools as agent required", () => {
        const macro = induceMacroFromTrace(
            "trace-1",
            trace({ name: "shell", mcpServerName: null }),
            "macro-1",
            "Run command",
            "",
            "2026-08-14T10:01:00.000Z",
        );

        expect(macro.executionClass).toBe("agentRequired");
        expect(macro.warnings).toContainEqual(
            expect.stringContaining("agent-guided execution"),
        );
    });

    it("classifies captured MCP tools as replayable", () => {
        const macro = induceMacroFromTrace(
            "trace-1",
            trace({ name: "create_item", mcpServerName: "example-server" }),
            "macro-1",
            "Create item",
            "",
            "2026-08-14T10:01:00.000Z",
        );

        expect(macro.executionClass).toBe("replayable");
        expect(macro.warnings).not.toContainEqual(
            expect.stringContaining("agent-guided execution"),
        );
    });

    it("turns redacted arguments into required secret inputs", () => {
        const macro = induceMacroFromTrace(
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

    it("binds a later argument to an earlier captured result", () => {
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

        const macro = induceMacroFromTrace(
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

    it("canonicalizes omitted tool arguments as an empty object", () => {
        const source = trace();
        delete source.toolCalls[0].arguments;
        const macro = induceMacroFromTrace(
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

    it("rejects a draft induced from a failed tool call", () => {
        const source = trace({ status: "failed" });
        const macro = induceMacroFromTrace(
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
