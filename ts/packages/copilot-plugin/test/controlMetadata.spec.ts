// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    rmSync,
    readFileSync,
    readdirSync,
    unwatchFile,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
    publishControlMetadata,
    readControlledMode,
    monitorControlMetadata,
} from "../src/shared/control-metadata.js";
import { routePrompt } from "../src/hooks/hook-router.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createExtensionCommands } from "../src/extension/commands.js";
import { jest } from "@jest/globals";
import {
    runControlDiagnostic,
    observeSyntheticToolOriginals,
} from "../src/extension/control-diagnostic.js";
import type { SessionEvent, SessionEventHandler } from "@github/copilot-sdk";

describe("owned control metadata", () => {
    let root: string;
    let saved: NodeJS.ProcessEnv;
    beforeEach(() => {
        saved = { ...process.env };
        root = mkdtempSync(join(process.cwd(), ".control-metadata-test-"));
        mkdirSync(join(root, "data"));
        mkdirSync(join(root, "plugin-data"));
        writeFileSync(
            join(root, "evaluation-owner.json"),
            JSON.stringify({ owner: "test-owner" }),
        );
        writeFileSync(
            join(root, "data", "native-control-admission.json"),
            JSON.stringify({
                owner: "test-owner",
                ownedRoot: root,
                configPath: join(root, "plugin-data", "config.json"),
                diagnosticCatalogReady: true,
                diagnosticCatalogSessionId: "metadata-session",
            }),
        );
        process.env.TYPEAGENT_USER_DATA_DIR = join(root, "data");
        process.env.CLAUDE_PLUGIN_DATA = join(root, "plugin-data");
        delete process.env.TYPEAGENT_PLUGIN_DATA;
        delete process.env.TYPEAGENT_MODE;
        delete process.env.TYPEAGENT_RECIPE_OWNER;
    });
    afterEach(() => {
        unwatchFile(join(root, "plugin-data", "config.json"));
        process.env = saved;
        rmSync(root, { recursive: true, force: true });
    });
    it("rejects the retired WorkIQ backend recording admission", () => {
        const file = join(root, "data", "native-control-admission.json");
        const admission = JSON.parse(readFileSync(file, "utf8"));
        writeFileSync(
            file,
            JSON.stringify({
                ...admission,
                workiqOriginals: { schemaVersion: 1 },
            }),
        );
        expect(() => publishControlMetadata("test")).toThrow(
            "Backend WorkIQ original-retention recording was removed",
        );
    });
    it("observes complete original synthetic SDK events only through the public session subscription", () => {
        writeFileSync(
            join(root, "plugin-data", "config.json"),
            JSON.stringify({ mode: "bypass" }),
        );
        const admissionFile = join(
            root,
            "data",
            "native-control-admission.json",
        );
        writeFileSync(
            admissionFile,
            JSON.stringify({
                ...JSON.parse(readFileSync(admissionFile, "utf8")),
                nativeSyntheticOriginals: true,
            }),
        );
        const control = publishControlMetadata("unit-originals")!;
        let handler: SessionEventHandler | undefined;
        const installed = observeSyntheticToolOriginals(
            control,
            "unit-source-session",
            (callback) => {
                handler = callback;
                return () => {
                    handler = undefined;
                };
            },
        )!;
        const emit = (event: Record<string, unknown>) =>
            handler?.(event as unknown as SessionEvent);
        const start = {
            id: "unit-start",
            parentId: null,
            timestamp: new Date().toISOString(),
            type: "tool.execution_start",
            data: {
                toolCallId: "unit-call",
                toolName: "macro-eval-docs-lookup_document",
                mcpServerName: "macro-eval-docs",
                arguments: { title: "Synthetic only" },
            },
        };
        const completion = {
            id: "unit-end",
            parentId: start.id,
            timestamp: new Date().toISOString(),
            type: "tool.execution_complete",
            data: {
                toolCallId: "unit-call",
                success: true,
                result: {
                    content: '{"id":"synthetic-only"}',
                    detailedContent: '{"id":"synthetic-only"}',
                    contents: [
                        { type: "text", text: '{"id":"synthetic-only"}' },
                    ],
                },
            },
        };
        emit({ ...start, agentId: "child" });
        emit({
            ...start,
            data: {
                ...start.data,
                mcpServerName: "foreign",
                toolCallId: "foreign",
            },
        });
        emit({
            type: "model.message",
            data: { content: "NOT A TOOL ORIGINAL" },
        });
        emit(start);
        emit(completion);
        const rows = readFileSync(installed.file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(rows).toHaveLength(2);
        expect(rows[1].event).toEqual(completion);
        expect(rows[1].event.data.result.contents).toEqual(
            completion.data.result.contents,
        );
        expect(rows[1].source.pid).toBe(process.pid);
        expect(rows[1].owner).toBe("test-owner");
        expect(rows[1].sessionId).toBe("unit-source-session");
    });
    it("never installs a synthetic original observer without the owned explicit opt-in", () => {
        writeFileSync(
            join(root, "plugin-data", "config.json"),
            JSON.stringify({ mode: "bypass" }),
        );
        const subscribe = jest.fn(() => () => {});
        expect(
            observeSyntheticToolOriginals(
                publishControlMetadata("unit-originals-off")!,
                "unit-source-session",
                subscribe,
            ),
        ).toBeUndefined();
        expect(subscribe).not.toHaveBeenCalled();
    });
    it("reports public effective mode, exact path, root and digest without copying settings/secrets", () => {
        const file = join(root, "plugin-data", "config.json");
        writeFileSync(
            file,
            JSON.stringify({ mode: "bypass", apiKey: "not-for-metadata" }),
        );
        const first = publishControlMetadata("test");
        expect(first?.effectiveMode).toBe("bypass");
        expect(first?.configPath).toBe(file);
        expect(first?.dataRoot).toBe(join(root, "data"));
        expect(first?.source.config).toBe("CLAUDE_PLUGIN_DATA");
        expect(JSON.stringify(first)).not.toContain("not-for-metadata");
        writeFileSync(
            file,
            JSON.stringify({ mode: "bypass", apiKey: "changed-secret" }),
        );
        expect(publishControlMetadata("test")?.digest).toBe(first?.digest);
        writeFileSync(file, JSON.stringify({ mode: "direct" }));
        expect(publishControlMetadata("test")?.digest).not.toBe(first?.digest);
    });
    it("proves highest priority plugin root and mode environment precedence", () => {
        mkdirSync(join(root, "alternate"));
        writeFileSync(
            join(root, "alternate", "config.json"),
            JSON.stringify({ mode: "mcp" }),
        );
        writeFileSync(
            join(root, "plugin-data", "config.json"),
            JSON.stringify({ mode: "bypass" }),
        );
        process.env.CLAUDE_PLUGIN_DATA = join(root, "alternate");
        process.env.TYPEAGENT_PLUGIN_DATA = join(root, "plugin-data");
        expect(publishControlMetadata("test")?.effectiveMode).toBe("bypass");
        expect(publishControlMetadata("test")?.source.config).toBe(
            "TYPEAGENT_PLUGIN_DATA",
        );
        process.env.TYPEAGENT_MODE = "direct";
        expect(publishControlMetadata("test")?.source.mode).toBe(
            "TYPEAGENT_MODE",
        );
    });
    it("does not read an unowned/global-fallback config", () => {
        delete process.env.CLAUDE_PLUGIN_DATA;
        const value = publishControlMetadata("test");
        expect(value?.effectiveMode).toBeNull();
        expect(value?.source.mode).toBe("unowned-unread");
        expect(value?.digest).toBeNull();
    });
    it("keeps mode defaults and mixed MCP routing authoritative without exposing arbitrary settings", () => {
        const file = join(root, "plugin-data", "config.json");
        writeFileSync(
            file,
            JSON.stringify({ mode: "invalid", privateSettings: "not-public" }),
        );
        expect(publishControlMetadata("test")?.source.mode).toBe("default");
        expect(publishControlMetadata("test")?.effectiveMode).toBe("direct");
        writeFileSync(
            file,
            JSON.stringify({ mode: "mcp", mcpRouting: "mixed" }),
        );
        const mixed = publishControlMetadata("test");
        expect(mixed?.effectiveMode).toBe("mcp");
        expect(mixed?.source.routing).toBe("mixed");
        writeFileSync(
            file,
            JSON.stringify({ mode: "mcp", mcpRouting: "delegate" }),
        );
        expect(publishControlMetadata("test")?.digest).not.toBe(mixed?.digest);
    });
    it("rejects an admission that does not match the generated owner marker", () => {
        writeFileSync(
            join(root, "evaluation-owner.json"),
            JSON.stringify({ owner: "another-owner" }),
        );
        expect(() => publishControlMetadata("test")).toThrow(
            "Control metadata admission ownership mismatch",
        );
    });
    it("reads current mode on every execution rather than capturing startup mode", async () => {
        const file = join(root, "plugin-data", "config.json");
        const request = {
            sessionId: "test-session",
            timestamp: 1,
            cwd: root,
            prompt: "Read an exact synthetic document",
        };
        const dependencies = {
            claimRecording: jest.fn(async () => false),
            localRecipes: jest.fn(async () => ({})),
        };
        writeFileSync(file, JSON.stringify({ mode: "bypass" }));
        await expect(
            routePrompt(
                request,
                readControlledMode("test"),
                new AbortController().signal,
                dependencies,
            ),
        ).resolves.toEqual({});
        expect(dependencies.claimRecording).not.toHaveBeenCalled();
        expect(dependencies.localRecipes).not.toHaveBeenCalled();
        writeFileSync(
            file,
            JSON.stringify({
                mode: "mcp",
                mcpRouting: "mixed",
                powershell: { enabled: false },
            }),
        );
        const mixed = await routePrompt(
            request,
            readControlledMode("test"),
            new AbortController().signal,
            dependencies,
        );
        expect(mixed.modifiedPrompt).toBeUndefined();
        expect(mixed.handled).not.toBe(true);
        expect(dependencies.localRecipes).toHaveBeenCalledTimes(1);
        dependencies.claimRecording.mockResolvedValueOnce(true);
        await expect(
            routePrompt(
                request,
                readControlledMode("test"),
                new AbortController().signal,
                dependencies,
            ),
        ).resolves.toEqual({});
        writeFileSync(file, JSON.stringify({ mode: "direct" }));
        await routePrompt(
            request,
            readControlledMode("test"),
            new AbortController().signal,
            dependencies,
        );
        expect(dependencies.localRecipes).toHaveBeenCalledTimes(2);
        expect(dependencies.localRecipes).toHaveBeenCalledWith(
            request,
            expect.any(AbortSignal),
        );
    });
    it("actual compiled user-prompt router honors bypass and rejects mode/path mismatch before translation", () => {
        const admission = join(root, "data", "native-control-admission.json");
        writeFileSync(
            admission,
            JSON.stringify({
                owner: "test-owner",
                ownedRoot: root,
                configPath: join(root, "plugin-data", "config.json"),
                expectedMode: "bypass",
            }),
        );
        const file = join(root, "plugin-data", "config.json");
        const invoke = () =>
            spawnSync(
                "node",
                [
                    fileURLToPath(
                        new URL("../hooks/hook-router.js", import.meta.url),
                    ),
                ],
                {
                    env: process.env,
                    encoding: "utf8",
                    timeout: 5000,
                    input: JSON.stringify({
                        sessionId: "test-session",
                        timestamp: 1,
                        cwd: root,
                        prompt: "Read the synthetic document",
                    }),
                },
            );
        writeFileSync(file, JSON.stringify({ mode: "bypass" }));
        const bypass = invoke();
        expect(bypass.stderr).toBe("");
        expect(bypass.status).toBe(0);
        expect(JSON.parse(bypass.stdout)).toEqual({});
        const receipt = JSON.parse(
            readFileSync(
                join(
                    root,
                    "data",
                    "native-control",
                    readdirSync(join(root, "data", "native-control"))[0],
                ),
                "utf8",
            ),
        );
        expect(receipt.source.request).toEqual({
            sessionId: "test-session",
            timestamp: 1,
            cwd: root,
        });
        expect(JSON.stringify(receipt)).not.toContain(
            "Read the synthetic document",
        );
        writeFileSync(file, JSON.stringify({ mode: "direct" }));
        const mismatch = invoke();
        expect(mismatch.status).toBe(1);
        expect(mismatch.stderr).toContain(
            "Native control mode mismatch; no translation admitted",
        );
        mkdirSync(join(root, "other"));
        process.env.CLAUDE_PLUGIN_DATA = join(root, "other");
        const wrongPath = invoke();
        expect(wrongPath.status).toBe(1);
        expect(wrongPath.stderr).toContain(
            "Native control config binding mismatch; no translation admitted",
        );
    });
    it("registered status control getter never calls sendTask", async () => {
        writeFileSync(
            join(root, "plugin-data", "config.json"),
            JSON.stringify({ mode: "bypass" }),
        );
        const messages: string[] = [];
        const sendTask = jest.fn(async (_task: string): Promise<void> => {});
        const command = createExtensionCommands(async (message) => {
            messages.push(message);
        }, sendTask).find((command) => command.name === "typeagent-status");
        const executable = Object.getOwnPropertyDescriptor(process, "execPath");
        if (!executable)
            throw new Error("Missing runtime executable descriptor");
        Object.defineProperty(process, "execPath", {
            ...executable,
            value: "copilot.exe",
        });
        try {
            await command?.handler({ args: "--control" } as never);
        } finally {
            Object.defineProperty(process, "execPath", executable);
        }
        expect(JSON.parse(messages[0]).extension.effectiveMode).toBe("bypass");
        expect(JSON.parse(messages[0]).hook.configPath).toBe(
            join(root, "plugin-data", "config.json"),
        );
        expect(sendTask).not.toHaveBeenCalled();
        expect(JSON.parse(messages[0]).extension.source.executable).toBe(
            "copilot.exe",
        );
        expect(JSON.parse(messages[0]).hook.source.executable).not.toBe(
            "copilot.exe",
        );
        expect(JSON.parse(messages[0]).hook.source.request).toBeNull();
        expect(JSON.parse(messages[0]).getter.ProcessId).toBe(
            JSON.parse(messages[0]).hook.source.pid,
        );
        expect(JSON.parse(messages[0]).getter.scriptHash).toMatch(
            /^[a-f0-9]{64}$/u,
        );
    });
    it("diagnostic watcher republishes actual current mode only for admitted owned diagnostics", async () => {
        writeFileSync(
            join(root, "data", "native-control-admission.json"),
            JSON.stringify({
                owner: "test-owner",
                ownedRoot: root,
                configPath: join(root, "plugin-data", "config.json"),
                diagnosticTransitions: true,
            }),
        );
        writeFileSync(
            join(root, "plugin-data", "config.json"),
            JSON.stringify({ mode: "bypass" }),
        );
        monitorControlMetadata("mcp-agent");
        writeFileSync(
            join(root, "plugin-data", "config.json"),
            JSON.stringify({ mode: "mcp", mcpRouting: "mixed" }),
        );
        const receiptFile = join(
            root,
            "data",
            "native-control",
            `mcp-agent-${process.pid}.json`,
        );
        const readReceipt = () => JSON.parse(readFileSync(receiptFile, "utf8"));
        const deadline = Date.now() + 5000;
        let receipt = readReceipt();
        while (receipt.effectiveMode !== "mcp" && Date.now() < deadline) {
            await delay(20);
            receipt = readReceipt();
        }
        expect(receipt.effectiveMode).toBe("mcp");
        expect(receipt.source.routing).toBe("mixed");
        expect(receipt.source.request).toBeNull();
    });
    it.each([
        "exact-docs",
        "pending-workflow-catalog",
        "actual-cli-extension-management-catalog",
        "native-restriction-warning-capture",
        "duplicate-current-actor",
    ])(
        "uses initial guarded Node getter and four metadata-only transitions for %s without send or tool execution",
        async (inventory) => {
            writeFileSync(
                join(root, "plugin-data", "config.json"),
                JSON.stringify({ mode: "bypass", mcpRouting: "delegate" }),
            );
            const sendTask = jest.fn(async () => {});
            const commands = createExtensionCommands(async () => {}, sendTask);
            const calls: string[] = [];
            const rpc = {
                commands: {
                    list: async () => ({
                        commands: commands.map((command) => ({
                            name: command.name,
                        })),
                    }),
                    invoke: async ({
                        name,
                        input,
                    }: {
                        name: string;
                        input?: string;
                    }) => {
                        calls.push(`${name} ${input}`);
                        await commands
                            .find((command) => command.name === name)
                            ?.handler({
                                args: input,
                                sessionId: "metadata-session",
                            } as never);
                        if (name === "typeagent-mode")
                            for (const component of [
                                "mcp-agent",
                                "mcp-workspace",
                                "mcp-macros",
                                "mcp-skills",
                            ])
                                publishControlMetadata(component);
                        return { kind: "completed" };
                    },
                },
                tools: {
                    initializeAndValidate: jest.fn(async () => ({})),
                    getCurrentMetadata: async () => ({
                        tools: [
                            ...["lookup_document", "fetch_document"].map(
                                (name) => ({
                                    name: `macro-eval-docs-${name}`,
                                    mcpServerName: "macro-eval-docs",
                                    mcpToolName: name,
                                    input_schema: {
                                        type: "object",
                                        required: [
                                            name === "lookup_document"
                                                ? "title"
                                                : "id",
                                        ],
                                        additionalProperties: false,
                                        properties: {
                                            [name === "lookup_document"
                                                ? "title"
                                                : "id"]: {
                                                type: "string",
                                                minLength: 1,
                                            },
                                        },
                                    },
                                }),
                            ),
                            ...(inventory === "pending-workflow-catalog"
                                ? [{ name: "shell" }]
                                : inventory ===
                                    "actual-cli-extension-management-catalog"
                                  ? [
                                        { name: "task" },
                                        { name: "extensions_reload" },
                                        { name: "extensions_manage" },
                                    ]
                                  : []),
                        ],
                    }),
                },
            };
            const control = publishControlMetadata("test");
            if (!control) throw new Error("Missing test admission");
            const admissionFile = join(
                root,
                "data",
                "native-control-admission.json",
            );
            const admission = JSON.parse(readFileSync(admissionFile, "utf8"));
            admission.expectedMode = "bypass";
            if (inventory === "native-restriction-warning-capture")
                admission.diagnosticRestrictionWarnings = [
                    { list: "excludedlist", selector: "extensions_manage" },
                ];
            admission.diagnosticActorIdentities = [
                {
                    ProcessId: process.pid,
                    ParentProcessId: process.ppid,
                    ExecutablePath: process.execPath,
                    StartedMs: 0,
                },
            ];
            for (const component of [
                "mcp-agent",
                "mcp-workspace",
                "mcp-macros",
                "mcp-skills",
            ]) {
                writeFileSync(admissionFile, JSON.stringify(admission));
                publishControlMetadata(component);
            }
            const historical = publishControlMetadata("mcp-agent");
            if (!historical) throw new Error("Missing historical test record");
            writeFileSync(
                join(root, "data", "native-control", "mcp-agent-stale.json"),
                JSON.stringify({
                    ...historical,
                    source: {
                        ...historical.source,
                        pid: 999999,
                        parentPid: 999999,
                    },
                }),
            );
            if (inventory === "duplicate-current-actor")
                writeFileSync(
                    join(
                        root,
                        "data",
                        "native-control",
                        "mcp-agent-ambiguous.json",
                    ),
                    JSON.stringify(historical),
                );
            writeFileSync(
                admissionFile,
                JSON.stringify({ ...admission, diagnosticCatalogReady: false }),
            );
            const diagnostic = runControlDiagnostic(
                rpc as unknown as Parameters<typeof runControlDiagnostic>[0],
                control,
                "metadata-session",
            );
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(calls).toEqual([]);
            writeFileSync(
                admissionFile,
                JSON.stringify({ ...admission, diagnosticCatalogReady: true }),
            );
            await diagnostic;
            const result = JSON.parse(
                readFileSync(
                    join(root, "data", "native-control-diagnostic-result.json"),
                    "utf8",
                ),
            );
            expect(rpc.tools.initializeAndValidate).toHaveBeenCalledTimes(1);
            expect(result.toolInitialization).toMatchObject({
                method: "session.tools.initializeAndValidate",
                sessionId: "metadata-session",
                returnedKeys: [],
            });
            if (inventory === "duplicate-current-actor") {
                expect(result.status).toBe("blocked");
                expect(result.transitions).toEqual([]);
                expect(calls).toEqual(["typeagent-status --control"]);
                expect(sendTask).not.toHaveBeenCalled();
                return;
            }
            expect(result.status).toBe(
                inventory === "exact-docs" ? "passed-metadata-only" : "blocked",
            );
            expect(
                result.transitions.map((entry: { mode: string }) => entry.mode),
            ).toEqual(["bypass", "mcp", "direct", "bypass"]);
            expect(
                result.transitions.every(
                    (entry: { control: { source: { request: unknown } }[] }) =>
                        entry.control.every(
                            (receipt) => receipt.source.request === null,
                        ),
                ),
            ).toBe(true);
            expect(calls).toEqual([
                "typeagent-status --control",
                "typeagent-mode bypass",
                "typeagent-status --control",
                "typeagent-mode mcp mixed",
                "typeagent-status --control",
                "typeagent-mode direct",
                "typeagent-status --control",
                "typeagent-mode bypass",
                "typeagent-status --control",
            ]);
            expect(result.callback).toBeNull();
            expect(result.capture).toBeNull();
            expect(sendTask).not.toHaveBeenCalled();
            if (inventory === "actual-cli-extension-management-catalog") {
                expect(
                    result.workflowGates.every(
                        (gate: { unexpectedTools: string[] }) =>
                            JSON.stringify(gate.unexpectedTools) ===
                            JSON.stringify([
                                "extensions_reload",
                                "extensions_manage",
                            ]),
                    ),
                ).toBe(true);
                expect(
                    result.tools.map((tool: { name: string }) => tool.name),
                ).toContain("extensions_manage");
            }
            if (inventory === "native-restriction-warning-capture") {
                expect(result.error).toMatch(
                    /restriction warnings remain unresolved/,
                );
                expect(
                    result.workflowGates.every(
                        (gate: { passed: boolean }) => gate.passed,
                    ),
                ).toBe(true);
            }
        },
    );
    it.each([
        "missing-command",
        "unrelated-tool",
        "mcp-task",
        "agent-prompt",
        "wrong-session",
        "wrong-root",
        "tool-initialization",
    ])(
        "blocks %s without submitting a prompt or executing a tool",
        async (failure) => {
            writeFileSync(
                join(root, "plugin-data", "config.json"),
                JSON.stringify({ mode: "bypass" }),
            );
            const invoke = jest.fn(async () => ({
                kind: "agent-prompt",
                prompt: "must-not-submit",
            }));
            const docs = ["lookup_document", "fetch_document"].map((name) => ({
                name: `macro-eval-docs-${name}`,
                mcpServerName: "macro-eval-docs",
                mcpToolName: name,
            }));
            const rpc = {
                commands: {
                    list: async () => ({
                        commands: (failure === "missing-command"
                            ? []
                            : ["typeagent-status", "typeagent-mode"]
                        ).map((name) => ({ name })),
                    }),
                    invoke,
                },
                tools: {
                    initializeAndValidate: async () => {
                        if (failure === "tool-initialization")
                            throw new Error(
                                "Actual tool initialization unavailable",
                            );
                        return {};
                    },
                    getCurrentMetadata: async () => ({
                        tools:
                            failure === "unrelated-tool"
                                ? [...docs, { name: "shell" }]
                                : failure === "mcp-task"
                                  ? [
                                        ...docs,
                                        {
                                            name: "task",
                                            mcpServerName: "unrelated",
                                        },
                                    ]
                                  : docs,
                    }),
                },
            };
            const control = publishControlMetadata("test");
            if (!control) throw new Error("Missing test admission");
            if (failure === "wrong-root") {
                mkdirSync(join(root, "alternate"));
                writeFileSync(
                    join(root, "alternate", "config.json"),
                    JSON.stringify({ mode: "bypass" }),
                );
                process.env.CLAUDE_PLUGIN_DATA = join(root, "alternate");
            }
            await runControlDiagnostic(
                rpc as unknown as Parameters<typeof runControlDiagnostic>[0],
                control,
                failure === "wrong-session"
                    ? "other-session"
                    : "metadata-session",
            );
            const result = JSON.parse(
                readFileSync(
                    join(root, "data", "native-control-diagnostic-result.json"),
                    "utf8",
                ),
            );
            expect(result.status).toBe("blocked");
            expect(result.transitions).toEqual([]);
            expect(invoke).toHaveBeenCalledTimes(
                [
                    "missing-command",
                    "wrong-session",
                    "wrong-root",
                    "tool-initialization",
                ].includes(failure)
                    ? 0
                    : 1,
            );
            expect(JSON.stringify(result)).not.toContain("must-not-submit");
            if (failure === "unrelated-tool")
                expect(
                    result.tools.some(
                        (tool: { name: string }) => tool.name === "shell",
                    ),
                ).toBe(true);
        },
    );
});
