// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type {
    ReasoningEvent,
    ReasoningLoopConfig,
    ReasoningToolDefinition,
} from "agent-dispatcher/reasoning";
import {
    createCodeModeExplorer,
    type ExploreTelemetry,
    type ExploreUsage,
    type ExplorerReasoningSDKAdapter,
} from "../src/exploreAgent.js";
import {
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    createDefaultLanguageServers,
    defaultTypeScriptLanguageServerCommand,
} from "../src/script/languageServer.js";

interface ToolStep {
    tool: "execute_action";
    args: Record<string, unknown>;
}

type ExplorerActionName =
    | "discoverRepository"
    | "refineRepository"
    | "submitExploration";

type SessionScripts =
    | ToolStep[][]
    | Partial<Record<ExplorerActionName, ToolStep[]>>;

describe("agentic Code Mode explorer", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        jest.restoreAllMocks();
        await Promise.all(
            tempDirs
                .splice(0)
                .map((directory) =>
                    rm(directory, { recursive: true, force: true }),
                ),
        );
    });

    async function makeFixture(): Promise<{
        repoRoot: string;
        telemetryFile: string;
    }> {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-agentic-explorer-test-"),
        );
        tempDirs.push(root);
        const repoRoot = path.join(root, "repo");
        await mkdir(path.join(repoRoot, "src"), { recursive: true });
        await writeFile(
            path.join(repoRoot, "src", "alpha.ts"),
            ["export function alpha() {", "    return 'needle';", "}"].join(
                "\n",
            ),
        );
        await writeFile(
            path.join(repoRoot, "src", "zeta.ts"),
            ["export function zeta() {", "    return 'needle';", "}"].join(
                "\n",
            ),
        );
        await writeFile(
            path.join(repoRoot, "src", "unread.ts"),
            "export const unread = true;\n",
        );
        await writeFile(
            path.join(repoRoot, "src", "caller.ts"),
            [
                'import { normalizeValue } from "./helper.js";',
                "export function handleValue(input: string) {",
                "    return normalizeValue(input);",
                "}",
            ].join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "helper.ts"),
            [
                "export function normalizeValue(input: string) {",
                "    return input.trim();",
                "}",
            ].join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "long.ts"),
            Array.from({ length: 80 }, (_, index) =>
                index === 39
                    ? "// unique_middle_marker"
                    : `// filler ${index + 1}`,
            ).join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "lsp.ts"),
            [
                "export function lspTarget() {",
                "    return 1;",
                "}",
                "",
                "export const result = lspTarget();",
            ].join("\n"),
        );
        return {
            repoRoot,
            telemetryFile: path.join(root, "telemetry", "result.json"),
        };
    }

    it("packages the canonical repository declarations beside the runtime", async () => {
        const declarations = await readFile(
            new URL("../script/repositorySandbox.d.ts", import.meta.url),
            "utf8",
        );

        expect(declarations).toContain("interface RepositoryApi");
    });

    it("keeps discovery, refinement, and typed submission in one bounded session", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter(
            [
                [runProgram("discover", grepProgram())],
                [runProgram("refine", readProgram())],
                [
                    submitExploration([
                        {
                            path: "src/alpha.ts",
                            startLine: 2,
                            endLine: 2,
                        },
                    ]),
                ],
            ],
            usage({ requestCount: 3, inputTokens: 120, outputTokens: 30 }),
        );
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
            executionTimeoutMs: 5_000,
        });

        const result = await explorer.explore({
            query: "Find the needle implementation",
        });

        expect(result).toBe("src/alpha.ts:2");
        expect(result).not.toContain("Evidence");
        expect(adapter.configs).toHaveLength(1);
        expect(adapter.configs[0]?.maxTurns).toBe(5);
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /exact lines? or line ranges? most likely needing changes/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /complete behavior-bearing blocks over isolated interior statements/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).not.toMatch(
            /smallest contiguous/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toContain(
            "const matches: GrepMatch[] = []",
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toContain(
            "Never send only the function body",
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /long candidate.*issue-specific.*body matches/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /bare identifiers.*language-specific declaration/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /first grep.*qualified symbol.*quoted error.*named file/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /do not start with generic concept words.*exact clue/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /consecutive non-overlapping.*production function.*before tests/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /refineRepository.*at most 4 repository calls/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /two targeted repo[.]grep.*alternate production files/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /cross-file caller.*behavior-bearing helper.*before tests/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /begin refinement.*read.*caller.*helper.*before.*glob.*tests?/i,
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toMatch(
            /more.*change sites.*max.*locations.*consolidate.*enclosing range.*instead of dropping/i,
        );
        expect(adapter.configs[0]?.tools.map((tool) => tool.name)).toEqual([
            "execute_action",
        ]);
        expect(adapter.configs[0]?.tools[0]?.inputSchema).toHaveProperty(
            "oneOf",
        );
        expect(adapter.configs[0]?.tools[0]?.inputSchema).not.toHaveProperty(
            "properties.action",
        );
        expect(adapter.calls.map((call) => call.tool)).toEqual([
            "execute_action",
            "execute_action",
            "execute_action",
        ]);
        expect(String(adapter.configs[0]?.systemPrompt)).toContain(
            'actionName: "discoverRepository"',
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toContain(
            'actionName: "refineRepository"',
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toContain(
            'actionName: "submitExploration"',
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toContain(
            "interface RepositoryApi",
        );
        expect(String(adapter.configs[0]?.systemPrompt)).toContain("repo.glob");
        expect(String(adapter.configs[0]?.systemPrompt)).not.toContain(
            "repo.lsp",
        );
        expect(JSON.parse(adapter.results[0]?.text ?? "{}")).toMatchObject({
            programResult: { success: true },
            observations: [expect.objectContaining({ source: "grep" })],
        });
        expect(JSON.parse(adapter.results[0]?.text ?? "{}")).not.toHaveProperty(
            "observationRanges",
        );
        expect(JSON.parse(adapter.results[0]?.text ?? "{}")).not.toHaveProperty(
            "citableRanges",
        );
        expect(JSON.parse(adapter.results[0]?.text ?? "{}")).not.toHaveProperty(
            "programResult.data",
        );
        expect(adapter.results[1]?.text).toContain('"source":"read"');
        expect(adapter.results[2]?.text).toMatch(/^src\/alpha[.]ts:2/m);

        const telemetry = await readTelemetry(telemetryFile);
        expect(telemetry).toMatchObject({
            schemaVersion: 4,
            model: "azure/gpt-5.6-luna",
            invocations: [
                {
                    index: 0,
                    status: "completed",
                    usage: {
                        requestCount: 3,
                        inputTokens: 120,
                        outputTokens: 30,
                        totalTokens: 150,
                    },
                    actionTranslationAndCodeGenerationUsage: {
                        requestCount: 3,
                        inputTokens: 120,
                        outputTokens: 30,
                        totalTokens: 150,
                    },
                    toolTrace: { totalCalls: 2 },
                    result: { citationCount: 1, truncated: false },
                },
            ],
        });
    });

    it("requires and records LSP navigation in the LSP treatment", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", lspDiscoveryProgram())],
            [runProgram("refine", lspRefinementProgram())],
            [
                submitExploration([
                    {
                        path: "src/lsp.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
            lsp: {
                servers: createDefaultLanguageServers({
                    typescript: defaultTypeScriptLanguageServerCommand(),
                    python: {
                        command: process.execPath,
                        args: ["-e", "process.exit(1)"],
                    },
                }),
            },
        });

        await expect(
            explorer.explore({ query: "Find lspTarget" }),
        ).resolves.toBe("src/lsp.ts:1-3");
        expect(String(adapter.configs[0]?.systemPrompt)).toContain("repo.lsp");
        const invocation = latestInvocation(await readTelemetry(telemetryFile));
        expect(invocation.toolTrace.calls.map((call) => call.tool)).toEqual([
            "grep",
            "lsp",
            "read",
            "read",
        ]);
        const lspCall = invocation.toolTrace.calls.find(
            (call) => call.tool === "lsp",
        );
        expect(lspCall).toMatchObject({ resultCount: 1 });
        expect(lspCall?.error).toBeUndefined();
    }, 30_000);

    it("keeps refinement open until required LSP navigation completes", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", grepProgram())],
            [runProgram("refine", failedLspRefinementProgram())],
            [runProgram("refine", lspRetryRefinementProgram())],
            [
                submitExploration([
                    {
                        path: "src/lsp.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
            lsp: {
                servers: createDefaultLanguageServers({
                    typescript: defaultTypeScriptLanguageServerCommand(),
                    python: {
                        command: process.execPath,
                        args: ["-e", "process.exit(1)"],
                    },
                }),
            },
        });

        await expect(
            explorer.explore({ query: "Find lspTarget" }),
        ).resolves.toBe("src/lsp.ts:1-3");
        expect(adapter.results[1]).toMatchObject({
            isError: true,
            text: expect.stringMatching(/retry refineRepository.*repo[.]lsp/i),
        });
        const invocation = latestInvocation(await readTelemetry(telemetryFile));
        expect(invocation.actionAttempts).toMatchObject([
            { actionName: "discoverRepository", status: "completed" },
            { actionName: "refineRepository", status: "failed" },
            { actionName: "refineRepository", status: "completed" },
            { actionName: "submitExploration", status: "completed" },
        ]);
        expect(
            invocation.toolTrace.calls
                .filter((call) => call.tool === "lsp")
                .map((call) => call.error),
        ).toEqual([expect.stringMatching(/not present/i), undefined]);
    }, 30_000);

    it("shares observations and one repository-call budget across all phases", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", fourCallProgram())],
            [runProgram("refine", fourReadProgram())],
            [
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-terra",
            telemetryFile,
            maxToolCalls: 8,
            executionTimeoutMs: 5_000,
        });

        await expect(
            explorer.explore({ query: "Find alpha", maxResults: 6 }),
        ).resolves.toMatch(/^src\/alpha[.]ts:1-3/m);

        const invocation = latestInvocation(await readTelemetry(telemetryFile));
        expect(invocation.toolTrace.totalCalls).toBe(8);
        expect(invocation.toolTrace.calls).toHaveLength(8);
        expect(invocation.toolTrace.calls.at(-1)?.tool).toBe("read");
        expect(
            JSON.parse(adapter.results[1]?.text ?? "{}").observations,
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: "src/alpha.ts",
                    startLine: 1,
                    endLine: 3,
                }),
            ]),
        );
        expect(adapter.results[1]?.text).toContain(
            '"remainingRepositoryCalls":0',
        );
        expect(
            JSON.parse(adapter.results[1]?.text ?? "{}").observations,
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    path: "src/zeta.ts",
                    startLine: 1,
                    endLine: 3,
                }),
            ]),
        );
        expect(adapter.results[0]?.text).toContain('"source":"grep"');
        expect(adapter.results[0]?.text).not.toContain("src/alpha.ts:1-3");
        expect(adapter.calls).toHaveLength(3);
    });

    it("uses discovery evidence to refine a behavior-bearing helper", async () => {
        const { repoRoot } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", callerReadProgram())],
            [runProgram("refine", helperRefinementProgram())],
            [
                submitExploration([
                    {
                        path: "src/helper.ts",
                        startLine: 2,
                        endLine: 2,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            maxToolCalls: 8,
        });

        await expect(
            explorer.explore({ query: "Trace the value normalization path" }),
        ).resolves.toBe("src/helper.ts:2");

        expect(adapter.results[0]?.text).toContain("normalizeValue(input)");
        expect(adapter.results[1]?.text).toContain("return input.trim()");
        expect(adapter.calls).toHaveLength(3);
    });

    it("uses exactly one successful refinement before submission", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter(
            [
                [runProgram("discover", grepProgram())],
                [runProgram("refine", readProgram())],
                [
                    submitExploration([
                        {
                            path: "src/alpha.ts",
                            startLine: 1,
                            endLine: 3,
                        },
                    ]),
                ],
            ],
            usage({ requestCount: 3, inputTokens: 120, outputTokens: 30 }),
        );
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
        });

        await expect(
            explorer.explore({ query: "resolve conflicting candidates" }),
        ).resolves.toBe("src/alpha.ts:1-3");

        expect(adapter.configs).toHaveLength(1);
        expect(adapter.calls).toHaveLength(3);
        expect(
            JSON.parse(adapter.results[1]?.text ?? "{}").observations[0],
        ).toMatchObject({
            path: "src/alpha.ts",
            startLine: 1,
            endLine: 3,
        });
        expect(
            latestInvocation(await readTelemetry(telemetryFile)),
        ).toMatchObject({
            usage: {
                requestCount: 3,
                inputTokens: 120,
                outputTokens: 30,
                totalTokens: 150,
            },
            actionTranslationAndCodeGenerationUsage: {
                requestCount: 3,
                inputTokens: 120,
                outputTokens: 30,
                totalTokens: 150,
            },
            toolTrace: { totalCalls: 2 },
            reasoningTrace: [
                {
                    actionName: "discoverRepository",
                    status: "completed",
                },
                { actionName: "refineRepository", status: "completed" },
                { actionName: "submitExploration", status: "completed" },
            ],
            actionAttempts: [
                { actionName: "discoverRepository", status: "completed" },
                { actionName: "refineRepository", status: "completed" },
                { actionName: "submitExploration", status: "completed" },
            ],
        });
    });

    it("hard-stops reasoning after the bounded tool-call budget", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            Array.from({ length: 6 }, () =>
                runProgram("discover", grepProgram()),
            ),
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
        });

        await expect(
            explorer.explore({ query: "repeat discovery forever" }),
        ).rejects.toThrow(/at most 5 reasoning tool calls/i);

        const invocation = latestInvocation(await readTelemetry(telemetryFile));
        expect(invocation.status).toBe("failed");
        expect(invocation.reasoningTrace).toHaveLength(5);
    });

    it("rejects invalid typed actions before the Explorer handler runs", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            [
                runProgramWithParameters("discoverRepository", {
                    program: 42,
                }),
                runProgram("discover", grepProgram()),
            ],
            [runProgram("refine", readProgram())],
            [
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 2,
                        endLine: 2,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
        });

        await expect(
            explorer.explore({ query: "validate typed actions" }),
        ).resolves.toMatch(/^src\/alpha[.]ts:2/m);

        expect(adapter.results[0]).toMatchObject({ isError: true });
        expect(adapter.results[0]?.text).toMatch(/program.*string/i);
        expect(
            latestInvocation(await readTelemetry(telemetryFile)).actionAttempts,
        ).toEqual([
            expect.objectContaining({
                actionName: "discoverRepository",
                status: "completed",
            }),
            expect.objectContaining({
                actionName: "refineRepository",
                status: "completed",
            }),
            expect.objectContaining({
                actionName: "submitExploration",
                status: "completed",
            }),
        ]);
    });

    it("rejects an entire mixed submission and accepts a grounded correction", async () => {
        const { repoRoot } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", grepProgram())],
            [runProgram("refine", readProgram())],
            [
                submitExploration([
                    {
                        path: "src/unread.ts",
                        startLine: 1,
                        endLine: 1,
                    },
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
        });

        const result = await explorer.explore({ query: "ground locations" });

        expect(result).toBe("src/alpha.ts:1-3");
        expect(adapter.results[2]).toMatchObject({ isError: true });
    });

    it("repairs two submissions without repeating refinement", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", grepProgram())],
            [runProgram("refine", readProgram())],
            [
                submitExploration([
                    {
                        path: "src/unread.ts",
                        startLine: 1,
                        endLine: 1,
                    },
                ]),
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 4,
                    },
                ]),
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
        });

        await expect(
            explorer.explore({ query: "repair grounded submission ranges" }),
        ).resolves.toBe("src/alpha.ts:1-3");

        expect(adapter.calls).toHaveLength(5);
        expect(
            latestInvocation(await readTelemetry(telemetryFile)).reasoningTrace,
        ).toEqual([
            expect.objectContaining({
                actionName: "discoverRepository",
                status: "completed",
            }),
            expect.objectContaining({
                actionName: "refineRepository",
                status: "completed",
            }),
            expect.objectContaining({
                actionName: "submitExploration",
                status: "failed",
            }),
            expect.objectContaining({
                actionName: "submitExploration",
                status: "failed",
            }),
            expect.objectContaining({
                actionName: "submitExploration",
                status: "completed",
            }),
        ]);
    });

    it("returns bounded grounding evidence so an invalid submission can repair", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", grepProgram())],
            [runProgram("refine", readProgram())],
            [
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 4,
                    },
                ]),
                submitExploration([
                    {
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 3,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
        });

        await expect(
            explorer.explore({ query: "repair a localization range" }),
        ).resolves.toBe("src/alpha.ts:1-3");

        expect(adapter.results[2]).toMatchObject({ isError: true });
        expect(adapter.results[2]?.text).toContain("src/alpha.ts:1-4");
        expect(adapter.results[2]?.text).toContain("src/alpha.ts:1-3");
        expect(
            latestInvocation(await readTelemetry(telemetryFile)).actionAttempts,
        ).toEqual([
            expect.objectContaining({
                actionName: "discoverRepository",
                status: "completed",
            }),
            expect.objectContaining({
                actionName: "refineRepository",
                status: "completed",
            }),
            expect.objectContaining({
                actionName: "submitExploration",
                status: "failed",
            }),
            expect.objectContaining({
                actionName: "submitExploration",
                status: "completed",
            }),
        ]);
    });

    it("retains exact discovery evidence without repeating a range ledger", async () => {
        const { repoRoot } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", grepZetaProgram())],
            [runProgram("refine", readProgram())],
            [
                submitExploration([
                    {
                        path: "src/zeta.ts",
                        startLine: 1,
                        endLine: 1,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
        });

        await expect(
            explorer.explore({ query: "ground exact grep evidence" }),
        ).resolves.toBe("src/zeta.ts:1");
        expect(adapter.results[1]?.text).not.toContain("citableRanges");
    });

    it("keeps refinement grep context visible in exact evidence", async () => {
        const { repoRoot } = await makeFixture();
        const adapter = scriptedAdapter([
            [runProgram("discover", grepProgram())],
            [runProgram("refine", refinementGrepAndReadProgram())],
            [
                submitExploration([
                    {
                        path: "src/long.ts",
                        startLine: 40,
                        endLine: 40,
                    },
                ]),
            ],
        ]);
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
        });

        await expect(
            explorer.explore({ query: "find the middle marker" }),
        ).resolves.toBe("src/long.ts:40");
        expect(adapter.results[1]?.text).toContain(
            "40\\t// unique_middle_marker",
        );
    });

    it("stops after exact-read recovery exhausts the repository budget", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter(
            [
                [runProgram("discover", grepProgram())],
                [runProgram("refine", emptyReadProgram())],
                [runProgram("refine", readProgram())],
                [
                    submitExploration([
                        {
                            path: "src/alpha.ts",
                            startLine: 2,
                            endLine: 2,
                        },
                    ]),
                ],
            ],
            usage({ requestCount: 2, inputTokens: 80, outputTokens: 20 }),
        );
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
            maxToolCalls: 2,
        });

        await expect(
            explorer.explore({ query: "recover an out-of-range read" }),
        ).rejects.toThrow(/repository call budget exhausted/i);

        expect(adapter.calls).toHaveLength(2);
        expect(adapter.results[1]).toMatchObject({
            isError: true,
            text: expect.stringMatching(/repository call budget exhausted/i),
        });
        expect(
            latestInvocation(await readTelemetry(telemetryFile)),
        ).toMatchObject({
            status: "failed",
            actionAttempts: [
                expect.objectContaining({
                    actionName: "discoverRepository",
                    status: "completed",
                }),
                expect.objectContaining({
                    actionName: "refineRepository",
                    status: "failed",
                    error: expect.stringMatching(
                        /repository call budget exhausted/i,
                    ),
                }),
            ],
        });
    });

    it("records nested reasoning usage when the loop fails", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter(
            [],
            usage({ requestCount: 2, inputTokens: 40, outputTokens: 7 }),
            "reasoning provider failed",
        );
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-sol",
            telemetryFile,
        });

        await expect(
            explorer.explore({ query: "provider failure" }),
        ).rejects.toThrow(/reasoning provider failed/i);

        const invocation = latestInvocation(await readTelemetry(telemetryFile));
        expect(invocation).toMatchObject({
            status: "failed",
            usage: {
                requestCount: 2,
                inputTokens: 40,
                outputTokens: 7,
                totalTokens: 47,
            },
            actionTranslationAndCodeGenerationUsage: { totalTokens: 47 },
            error: "reasoning provider failed",
        });
    });

    it("keeps concurrent telemetry in invocation-start order", async () => {
        const { repoRoot, telemetryFile } = await makeFixture();
        const adapter = scriptedAdapter(
            {
                discoverRepository: [runProgram("discover", grepProgram())],
                refineRepository: [runProgram("refine", readProgram())],
                submitExploration: [
                    submitExploration([
                        {
                            path: "src/alpha.ts",
                            startLine: 2,
                            endLine: 2,
                        },
                    ]),
                ],
            },
            usage({ requestCount: 1, inputTokens: 10, outputTokens: 2 }),
            undefined,
            25,
        );
        const explorer = createCodeModeExplorer({
            repoRoot,
            reasoningAdapter: adapter,
            modelName: "azure/gpt-5.6-luna",
            telemetryFile,
        });

        await Promise.all([
            explorer.explore({ query: "first" }),
            explorer.explore({ query: "second" }),
        ]);

        const telemetry = await readTelemetry(telemetryFile);
        expect(telemetry.invocations.map((item) => item.index)).toEqual([0, 1]);
        expect(
            (await readdir(path.dirname(telemetryFile))).filter((name) =>
                name.includes(".tmp-"),
            ),
        ).toEqual([]);
    });
});

function scriptedAdapter(
    scripts: SessionScripts,
    sessionUsage = usage({}),
    failure?: string,
    delayMs = 0,
): ExplorerReasoningSDKAdapter & {
    configs: ReasoningLoopConfig[];
    calls: ToolStep[];
    results: Array<{ text: string; isError: boolean }>;
    prompts: Array<{ system: string; user: string }>;
} {
    const configs: ReasoningLoopConfig[] = [];
    const calls: ToolStep[] = [];
    const results: Array<{ text: string; isError: boolean }> = [];
    const prompts: Array<{ system: string; user: string }> = [];
    let sessionIndex = 0;
    return {
        configs,
        calls,
        results,
        prompts,
        async createSession(config) {
            configs.push(config);
            const currentSession = sessionIndex++;
            const steps = Array.isArray(scripts)
                ? scripts.flat()
                : [
                      ...(scripts.discoverRepository ?? []),
                      ...(scripts.refineRepository ?? []),
                      ...(scripts.submitExploration ?? []),
                  ];
            return {
                async *execute(
                    userMessage: string,
                ): AsyncIterable<ReasoningEvent> {
                    prompts.push({
                        system: String(config.systemPrompt),
                        user: userMessage,
                    });
                    if (delayMs > 0 && currentSession === 0) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, delayMs),
                        );
                    }
                    for (const [index, step] of steps.entries()) {
                        const tool = requiredTool(config.tools, step.tool);
                        calls.push(step);
                        yield {
                            type: "tool_call",
                            tool: step.tool,
                            args: step.args,
                            id: `tool-${currentSession}-${index}`,
                        };
                        const result = await tool.handler(step.args);
                        const text = result.content
                            .map((item) => item.text)
                            .join("\n");
                        results.push({
                            text,
                            isError: result.isError === true,
                        });
                        yield {
                            type: "tool_result",
                            id: `tool-${currentSession}-${index}`,
                            tool: step.tool,
                            result: text,
                            isError: result.isError === true,
                        };
                        if (tool.isTerminal?.(step.args, result)) {
                            yield result.isError
                                ? {
                                      type: "done",
                                      result: {
                                          success: false,
                                          error: text,
                                      },
                                  }
                                : {
                                      type: "done",
                                      result: {
                                          success: true,
                                          output: text,
                                      },
                                  };
                            return;
                        }
                    }
                    yield failure
                        ? {
                              type: "done",
                              result: { success: false, error: failure },
                          }
                        : {
                              type: "done",
                              result: { success: true, output: "submitted" },
                          };
                },
                getSessionId: () => `session-${currentSession}`,
                getUsage: () => ({ ...sessionUsage }),
            };
        },
    };
}

function requiredTool(
    tools: ReasoningToolDefinition[],
    name: string,
): ReasoningToolDefinition {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
        throw new Error(`Missing reasoning tool ${name}`);
    }
    return tool;
}

function runProgram(phase: "discover" | "refine", program: string): ToolStep {
    return runProgramWithParameters(
        phase === "discover" ? "discoverRepository" : "refineRepository",
        { program },
    );
}

function runProgramWithParameters(
    actionName: "discoverRepository" | "refineRepository",
    parameters: Record<string, unknown>,
): ToolStep {
    return {
        tool: "execute_action",
        args: {
            actionName,
            parameters,
        },
    };
}

function submitExploration(locations: unknown[]): ToolStep {
    return {
        tool: "execute_action",
        args: {
            actionName: "submitExploration",
            parameters: { locations },
        },
    };
}

function grepProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("needle", { literal: true, maxMatches: 1 });
    return { success: true, message: params.query };
}`;
}

function grepZetaProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("function zeta", { literal: true, maxMatches: 1 });
    return { success: true, message: params.query };
}`;
}

function readProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function emptyReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/alpha.ts", { offset: 100, limit: 10 });
    return { success: true, message: params.query };
}`;
}

function callerReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/caller.ts", { offset: 0, limit: 4 });
    return { success: true, message: params.query };
}`;
}

function helperRefinementProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("normalizeValue", { literal: true, path: "src/helper.ts", maxMatches: 1 });
    await repo.read("src/helper.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function lspDiscoveryProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("lspTarget", { literal: true, path: "src/lsp.ts", maxMatches: 2 });
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    await repo.read("src/lsp.ts", { offset: 0, limit: 5 });
    return { success: true, message: params.query };
}`;
}

function lspRefinementProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/lsp.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function failedLspRefinementProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "missingSymbol" });
    await repo.read("src/lsp.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function lspRetryRefinementProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    await repo.read("src/lsp.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function refinementGrepAndReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("unique_middle_marker", { literal: true, path: "src/long.ts", maxMatches: 1 });
    await repo.read("src/long.ts", { offset: 0, limit: 80 });
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function fourCallProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    for (let index = 0; index < 4; index += 1) {
        await repo.grep("needle", { literal: true, maxMatches: 1 });
    }
    return { success: true, message: params.query };
}`;
}

function fourReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    await repo.read("src/zeta.ts", { offset: 0, limit: 3 });
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    const fourth = await repo.read("src/zeta.ts", { offset: 0, limit: 3 });
    return { success: true, message: fourth || "TOOL_BUDGET_EXHAUSTED" };
}`;
}

function usage(
    values: Partial<ExploreUsage> & {
        inputTokens?: number;
        outputTokens?: number;
    },
): ExploreUsage {
    const inputTokens = values.inputTokens ?? 0;
    const outputTokens = values.outputTokens ?? 0;
    return {
        requestCount: values.requestCount ?? 0,
        inputTokens,
        cachedInputTokens: values.cachedInputTokens ?? 0,
        outputTokens,
        reasoningOutputTokens: values.reasoningOutputTokens ?? 0,
        totalTokens: values.totalTokens ?? inputTokens + outputTokens,
    };
}

async function readTelemetry(fileName: string): Promise<ExploreTelemetry> {
    return JSON.parse(await readFile(fileName, "utf8")) as ExploreTelemetry;
}

function latestInvocation(
    telemetry: ExploreTelemetry,
): ExploreTelemetry["invocations"][number] {
    const invocation = telemetry.invocations.at(-1);
    if (!invocation) {
        throw new Error("Expected telemetry invocation");
    }
    return invocation;
}
