// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExplorerActionSession } from "../src/actionHandler.js";
import { createExplorerActionDispatcher } from "../src/reasoning/explorerActionDispatcher.js";
import {
    createDefaultLanguageServers,
    defaultTypeScriptLanguageServerCommand,
} from "../src/script/languageServer.js";

describe("Explorer action dispatcher", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(
            tempDirs
                .splice(0)
                .map((directory) =>
                    rm(directory, { recursive: true, force: true }),
                ),
        );
    });

    it("discovers and executes Explorer actions through the canonical dispatcher", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            const schema = await runtime.discoverActions("explorer");
            expect(schema).toContain('actionName: "discoverRepository"');
            expect(schema).toContain('actionName: "refineRepository"');
            expect(schema).toContain('actionName: "submitExploration"');
            expect(schema).not.toContain("interface RepositoryApi");

            const invalid = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: 42 },
            );
            expect(invalid).toMatchObject({ isError: true });
            expect(invalid.text).toMatch(/program.*string/i);
            expect(session.snapshot().actionAttempts).toEqual([]);

            const program = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: grepProgram() },
            );
            expect(program).toMatchObject({ isError: false });
            const discoveryPayload = JSON.parse(program.text);
            expect(discoveryPayload.remainingProgramExecutions).toBe(1);
            expect(discoveryPayload).not.toHaveProperty("observationRanges");
            expect(discoveryPayload).not.toHaveProperty("citableRanges");
            expect(discoveryPayload).not.toHaveProperty("programResult.data");

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: readProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            const refinementPayload = JSON.parse(refinement.text) as {
                remainingProgramExecutions: number;
                observations: Array<{
                    source: "grep" | "read";
                    path: string;
                    startLine: number;
                    endLine: number;
                }>;
            };
            expect(refinementPayload.remainingProgramExecutions).toBe(0);
            expect(refinementPayload.observations[0]).toMatchObject({
                path: "src/alpha.ts",
                startLine: 1,
                endLine: 3,
            });
            expect(
                refinementPayload.observations.map(
                    (observation) => observation.source,
                ),
            ).toEqual(["read"]);

            const submission = await runtime.executeAction(
                "explorer",
                "submitExploration",
                {
                    locations: [
                        {
                            path: "src/alpha.ts",
                            startLine: 2,
                            endLine: 2,
                        },
                    ],
                },
            );
            expect(submission).toMatchObject({ isError: false });
            expect(submission.text).toMatch(/^src\/alpha[.]ts:2/m);
            expect(session.snapshot()).toMatchObject({
                submitted: true,
                observationCount: 2,
                actionAttempts: [
                    { actionName: "discoverRepository", status: "completed" },
                    { actionName: "refineRepository", status: "completed" },
                    { actionName: "submitExploration", status: "completed" },
                ],
            });
        } finally {
            await runtime.close();
        }
    });

    it("exposes discovery and refinement as separate typed actions", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const schema = await runtime.discoverActions("explorer");
            expect(schema).toContain('actionName: "discoverRepository"');
            expect(schema).toContain('actionName: "refineRepository"');
            expect(schema).not.toContain('phase: "discover" | "refine"');
        } finally {
            await runtime.close();
        }
    });

    it("uses a minimal all-or-nothing grounded localization contract", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            const schema = await runtime.discoverActions("explorer");
            expect(schema).toContain("locations:");
            expect(schema).not.toContain("citations:");
            expect(schema).not.toContain("reason:");

            const discovery = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: grepProgram() },
            );
            expect(discovery).toMatchObject({ isError: false });
            expect(JSON.parse(discovery.text)).not.toHaveProperty(
                "observationRanges",
            );
            expect(JSON.parse(discovery.text)).not.toHaveProperty(
                "citableRanges",
            );
            expect(JSON.parse(discovery.text)).not.toHaveProperty(
                "programResult.data",
            );

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const mixed = await runtime.executeAction(
                "explorer",
                "submitExploration",
                {
                    locations: [
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
                    ],
                },
            );
            expect(mixed).toMatchObject({ isError: true });
            expect(mixed.text).toMatch(/no matching observed range/i);
            expect(mixed.text).not.toMatch(/refineRepository/i);
            expect(session.snapshot().submitted).toBe(false);

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: Array.from({ length: 7 }, () => ({
                        path: "src/alpha.ts",
                        startLine: 1,
                        endLine: 1,
                    })),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/at most 6 locations/i),
            });

            const valid = await runtime.executeAction(
                "explorer",
                "submitExploration",
                {
                    locations: [
                        {
                            path: "src/alpha.ts",
                            startLine: 1,
                            endLine: 3,
                        },
                    ],
                },
            );
            expect(valid).toMatchObject({
                isError: false,
                text: "src/alpha.ts:1-3",
            });
        } finally {
            await runtime.close();
        }
    });

    it("preserves grep evidence from each discovery search", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const result = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: diverseGrepProgram() },
            );
            expect(result).toMatchObject({ isError: false });
            const payload = JSON.parse(result.text) as {
                observations: Array<{ lines: string[] }>;
                repositoryCallResults: Array<{
                    tool: string;
                    input: Record<string, unknown>;
                    resultCount: number;
                    truncated: boolean;
                }>;
            };
            expect(
                payload.observations
                    .flatMap((observation) => observation.lines)
                    .some((line) => line.includes("target-marker")),
            ).toBe(true);
            expect(payload.repositoryCallResults).toEqual([
                expect.objectContaining({
                    tool: "grep",
                    input: expect.objectContaining({
                        pattern: "target-marker",
                        path: "src/large.ts",
                    }),
                    resultCount: 1,
                    truncated: true,
                }),
                expect.objectContaining({
                    tool: "grep",
                    input: expect.objectContaining({
                        pattern: "line-",
                        path: "src/large.ts",
                        maxMatches: 40,
                    }),
                    resultCount: 40,
                    truncated: true,
                }),
            ]);
        } finally {
            await runtime.close();
        }
    });

    it("returns repository call errors with their bounded inputs", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const result = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: caughtGrepErrorProgram() },
            );
            expect(result).toMatchObject({ isError: false });
            expect(JSON.parse(result.text).repositoryCallResults).toEqual([
                expect.objectContaining({
                    tool: "grep",
                    input: expect.objectContaining({
                        pattern: "[",
                        path: "src/large.ts",
                    }),
                    resultCount: 0,
                    truncated: false,
                    error: expect.any(String),
                }),
                expect.objectContaining({
                    tool: "grep",
                    input: expect.objectContaining({
                        pattern: "target-marker",
                        path: "src/large.ts",
                    }),
                    resultCount: 1,
                    truncated: true,
                }),
            ]);
        } finally {
            await runtime.close();
        }
    });

    it("bounds oversized repository call summaries inside the action result", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const result = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: oversizedCaughtReadErrorProgram() },
            );
            expect(result).toMatchObject({ isError: false });
            expect(result.text.length).toBeLessThanOrEqual(40_000);
            const payload = JSON.parse(result.text) as {
                repositoryCallResults: Array<{
                    input: { path?: string };
                    error?: string;
                    inputTruncated?: boolean;
                    errorTruncated?: boolean;
                }>;
            };
            expect(payload.repositoryCallResults[0]).toMatchObject({
                input: { path: expect.any(String) },
                error: expect.any(String),
                inputTruncated: true,
                errorTruncated: true,
            });
            expect(
                payload.repositoryCallResults[0].input.path?.length,
            ).toBeLessThanOrEqual(1_000);
            expect(
                payload.repositoryCallResults[0].error?.length,
            ).toBeLessThanOrEqual(1_000);
        } finally {
            await runtime.close();
        }
    });

    it("keeps a path-diverse discovery frontier larger than twenty matches", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const result = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: manyFileGrepProgram() },
            );
            expect(result).toMatchObject({ isError: false });
            const payload = JSON.parse(result.text) as {
                observations: Array<{ path: string }>;
            };
            expect(
                new Set(payload.observations.map(({ path }) => path)).size,
            ).toBe(25);
        } finally {
            await runtime.close();
        }
    });

    it("rejects ranges covered only by visible grep lines", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: consecutiveGrepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: unrelatedReadProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/alpha.ts",
                            startLine: 1,
                            endLine: 3,
                        },
                    ],
                }),
            ).resolves.toMatchObject({ isError: true });

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/alpha.ts",
                            startLine: 1,
                            endLine: 2,
                        },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /no matching observed range from read/i,
                ),
            });
        } finally {
            await runtime.close();
        }
    });

    it("releases the dispatcher on close", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );

        await runtime.close();

        await expect(runtime.discoverActions("explorer")).rejects.toThrow(
            /closed/i,
        );
    });

    it("allows one four-call refinement before typed submission", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            const earlyRefinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: readProgram() },
            );
            expect(earlyRefinement).toMatchObject({ isError: true });
            expect(earlyRefinement.text).toMatch(/expected the discover/i);

            const earlySubmission = await runtime.executeAction(
                "explorer",
                "submitExploration",
                { locations: [] },
            );
            expect(earlySubmission).toMatchObject({ isError: true });
            expect(earlySubmission.text).toMatch(/discover.*refine/i);

            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: fourCallRefinementProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const repeatedRefinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: readProgram() },
            );
            expect(repeatedRefinement).toMatchObject({ isError: true });
            expect(repeatedRefinement.text).toMatch(/at most 2/i);
            expect(session.snapshot().toolTrace.totalCalls).toBe(5);

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/alpha.ts",
                            startLine: 2,
                            endLine: 2,
                        },
                    ],
                }),
            ).resolves.toMatchObject({ isError: false });
        } finally {
            await runtime.close();
        }
    });

    it("clamps oversized refinement reads to 200 lines", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const broadRefinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: broadReadProgram() },
            );
            expect(broadRefinement).toMatchObject({ isError: false });
            expect(session.snapshot()).toMatchObject({
                programAttempts: 2,
                toolTrace: {
                    totalCalls: 2,
                    calls: [
                        { tool: "grep" },
                        {
                            tool: "read",
                            input: { limit: 200, requestedLimit: 300 },
                        },
                    ],
                },
            });
        } finally {
            await runtime.close();
        }
    });

    it("keeps both allowed broad refinement reads fully visible", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: threeBroadReadsProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            const payload = JSON.parse(refinement.text) as {
                observations: Array<{
                    path: string;
                    startLine: number;
                    endLine: number;
                    lines: string[];
                }>;
            };
            expect(
                payload.observations.flatMap((observation) => observation.lines)
                    .length,
            ).toBe(400);
            expect(payload.observations).toEqual([
                expect.objectContaining({
                    path: "src/wide.ts",
                    startLine: 1,
                    endLine: 200,
                }),
                expect.objectContaining({
                    path: "src/wide.ts",
                    startLine: 201,
                    endLine: 400,
                }),
            ]);
            expect(session.snapshot().toolTrace.totalCalls).toBe(3);
        } finally {
            await runtime.close();
        }
    });

    it("keeps the leading context of every compacted refinement read visible", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: threeCompactedReadsProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            const payload = JSON.parse(refinement.text) as {
                observations: Array<{
                    path: string;
                    startLine: number;
                    endLine: number;
                }>;
            };
            for (const startLine of [1, 201, 401]) {
                expect(payload.observations).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            path: "src/wide.ts",
                            startLine,
                            endLine: expect.any(Number),
                        }),
                    ]),
                );
                const leading = payload.observations.find(
                    (observation) =>
                        observation.path === "src/wide.ts" &&
                        observation.startLine === startLine,
                );
                expect(leading?.endLine).toBeGreaterThanOrEqual(startLine + 31);
            }
        } finally {
            await runtime.close();
        }
    });

    it("preserves returned candidate ranges inside compacted refinement reads", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: candidateCompactedReadsProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            const payload = JSON.parse(refinement.text) as {
                observations: Array<{
                    path: string;
                    startLine: number;
                    endLine: number;
                }>;
            };
            expect(payload.observations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        path: "src/wide.ts",
                        startLine: 100,
                        endLine: 110,
                    }),
                ]),
            );
            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/wide.ts",
                            startLine: 100,
                            endLine: 110,
                        },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: "src/wide.ts:100-110",
            });
        } finally {
            await runtime.close();
        }
    });

    it("rejects partially visible candidates and normalizes a bounded retry", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: oversizedCandidateCompactedReadsProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/fully visible.*smaller exact/i),
            });
            expect(session.snapshot().programAttempts).toBe(1);

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: normalizedCandidateReadProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            expect(JSON.parse(refinement.text).programResult.locations).toEqual(
                [{ path: "src/wide.ts", startLine: 100, endLine: 110 }],
            );
            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/wide.ts",
                            startLine: 100,
                            endLine: 110,
                        },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: "src/wide.ts:100-110",
            });
        } finally {
            await runtime.close();
        }
    });

    it("reserves one repository call after a bounded candidate visibility failure", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: fourCallDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: fourReadOversizedCandidateProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/fully visible.*smaller exact/i),
            });
            expect(session.snapshot().toolTrace.totalCalls).toBe(7);

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: normalizedCandidateReadProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            expect(session.snapshot().toolTrace.totalCalls).toBe(8);
        } finally {
            await runtime.close();
        }
    });

    it("rejects a refinement whose read returns no candidate context", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: emptyReadProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /src\/alpha[.]ts.*zero-based offset 100.*returned zero lines.*6 repository calls remain/i,
                ),
            });
            expect(session.snapshot().programAttempts).toBe(1);

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
        } finally {
            await runtime.close();
        }
    });

    it("requires every refinement to read exact candidate context", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            const grepOnly = await runtime.executeAction(
                "explorer",
                "refineRepository",
                {
                    program: grepOnlyRefinementProgram(),
                },
            );
            expect(grepOnly).toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /must read exact candidate context/i,
                ),
            });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
        } finally {
            await runtime.close();
        }
    });

    it("preflights missing LSP requirements without consuming repository calls", async () => {
        const session = await createSession(8, true);
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: fourCallDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: fourCallMissingLspRequirementsProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /must call repo[.]read before execution/i,
                ),
            });

            const recovered = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: readAndNavigateLspProgram() },
            );
            expect(recovered).toMatchObject({ isError: false });
            expect(JSON.parse(recovered.text).observations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        source: "read",
                        path: "src/lsp.ts",
                        startLine: 1,
                        endLine: 3,
                    }),
                ]),
            );
            expect(session.snapshot().toolTrace).toMatchObject({
                totalCalls: 6,
                calls: [
                    { tool: "grep" },
                    { tool: "grep" },
                    { tool: "glob" },
                    { tool: "ls" },
                    { tool: "read" },
                    { tool: "lsp", resultCount: 1 },
                ],
            });
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("carries exact read evidence across only a missing-navigation recovery", async () => {
        const session = await createSession(8, true);
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: fourCallDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readAndMissLspProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /complete an error-free language-server call/i,
                ),
            });
            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        { path: "src/lsp.ts", startLine: 1, endLine: 3 },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /complete discovery and refinement/i,
                ),
            });

            const recovered = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: navigateLspOnlyProgram() },
            );
            expect(recovered).toMatchObject({ isError: false });
            expect(JSON.parse(recovered.text).observations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        source: "read",
                        path: "src/lsp.ts",
                        startLine: 1,
                        endLine: 3,
                    }),
                ]),
            );
            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        { path: "src/lsp.ts", startLine: 1, endLine: 3 },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: "src/lsp.ts:1-3",
            });
            expect(session.snapshot().toolTrace.totalCalls).toBe(7);
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("preserves host-validated recovery evidence after an advisory program failure", async () => {
        const session = await createSession(8, true);
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: fourCallDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readAndMissLspProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(
                    /complete an error-free language-server call/i,
                ),
            });

            const recovered = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: navigateLspThenReportFailureProgram() },
            );
            expect(recovered).toMatchObject({ isError: false });
            expect(JSON.parse(recovered.text)).toMatchObject({
                programResult: {
                    success: false,
                    error: "Unable to ground lspTarget source",
                },
                observations: [
                    expect.objectContaining({
                        source: "read",
                        path: "src/lsp.ts",
                        startLine: 1,
                        endLine: 3,
                    }),
                ],
            });
            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        { path: "src/lsp.ts", startLine: 1, endLine: 3 },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: "src/lsp.ts:1-3",
            });
            expect(session.snapshot()).toMatchObject({
                programAttempts: 2,
                toolTrace: { totalCalls: 7 },
            });
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("accepts an error-free empty LSP response without inventing locations", async () => {
        const session = await createSession(8, true);
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: fourCallDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readAndEmptyLspProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            const lspCall = session.snapshot().toolTrace.calls.at(-1);
            expect(lspCall).toMatchObject({
                tool: "lsp",
                resultCount: 0,
            });
            expect(lspCall?.error).toBeUndefined();
            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        { path: "src/lsp.ts", startLine: 1, endLine: 6 },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: "src/lsp.ts:1-6",
            });
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("does not carry reads from a runtime-failed refinement", async () => {
        const session = await createSession(8, true);
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: fourCallDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readThenThrowProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/runtime failure/i),
            });
            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/must call repo[.]lsp/i),
            });
            expect(session.snapshot().toolTrace).toMatchObject({
                totalCalls: 6,
                calls: expect.arrayContaining([
                    expect.objectContaining({
                        tool: "lsp",
                        error: expect.stringMatching(/discarded/i),
                    }),
                    expect.objectContaining({
                        tool: "read",
                        error: expect.stringMatching(/discarded/i),
                    }),
                ]),
            });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readAndNavigateLspProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            expect(session.snapshot().toolTrace).toMatchObject({
                totalCalls: 8,
                calls: expect.any(Array),
            });
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("does not accept a language-server call that completes after timeout", async () => {
        const session = await createSession(
            8,
            true,
            20,
            delayedLanguageServerCommand(100),
        );
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: lspOnlyDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/execution timeout/i),
            });
            await new Promise((resolve) => setTimeout(resolve, 500));

            const recovery = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: emptyDiscoveryProgram() },
            );
            expect(recovery).toMatchObject({ isError: false });
            expect(JSON.parse(recovery.text).repositoryCalls).toBe(1);
            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readProgram(),
                }),
            ).resolves.toMatchObject({
                isError: true,
                text: expect.stringMatching(/must call repo[.]lsp/i),
            });
            expect(session.snapshot().toolTrace).toMatchObject({
                totalCalls: 1,
                calls: [
                    {
                        tool: "lsp",
                        error: expect.stringMatching(
                            /completed after script execution ended/i,
                        ),
                    },
                ],
            });
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("handles rejection from an unawaited call after execution ends", async () => {
        const session = await createSession(
            8,
            true,
            1_000,
            delayedLanguageServerCommand(100),
        );
        const runtime = await createExplorerActionDispatcher(session);
        const unhandled: unknown[] = [];
        const recordUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", recordUnhandled);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: unawaitedLspDiscoveryProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            await new Promise((resolve) => setTimeout(resolve, 500));

            expect(unhandled).toEqual([]);
            expect(session.snapshot().toolTrace).toMatchObject({
                totalCalls: 1,
                calls: [
                    {
                        tool: "lsp",
                        error: expect.stringMatching(
                            /completed after script execution ended/i,
                        ),
                    },
                ],
            });
        } finally {
            process.off("unhandledRejection", recordUnhandled);
            await runtime.close();
        }
    }, 30_000);

    it("leaves one global LSP attempt after discovery", async () => {
        const session = await createSession(8, true);
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: twoMissingLspCallsProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: readAndNavigateLspProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            expect(
                session
                    .snapshot()
                    .toolTrace.calls.filter((call) => call.tool === "lsp"),
            ).toEqual([
                expect.objectContaining({ resultCount: 0 }),
                expect.objectContaining({ resultCount: 1 }),
            ]);
        } finally {
            await runtime.close();
        }
    }, 30_000);

    it("grounds a mutation near the middle of a 200-line refinement read", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: broadMutationReadProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            expect(refinement.text).toContain("mutation-marker");
            expect(JSON.parse(refinement.text).observations[0]).toMatchObject({
                path: "src/wide.ts",
                startLine: 111,
                endLine: 310,
            });

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/wide.ts",
                            startLine: 193,
                            endLine: 195,
                        },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: expect.stringMatching(/^src\/wide[.]ts:193-195/m),
            });
        } finally {
            await runtime.close();
        }
    });

    it("allows two targeted greps and two reads in one refinement", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const searchRefinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: searchThenReadProgram() },
            );
            expect(searchRefinement).toMatchObject({ isError: false });
            expect(session.snapshot()).toMatchObject({
                programAttempts: 2,
                toolTrace: {
                    totalCalls: 5,
                    calls: [
                        { tool: "grep" },
                        { tool: "grep" },
                        { tool: "grep" },
                        { tool: "read" },
                        { tool: "read" },
                    ],
                },
            });
        } finally {
            await runtime.close();
        }
    });

    it("grounds bounded context around a path-scoped refinement grep", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: scopedGrepRefinementProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            expect(refinement.text).toContain("mutation-marker");

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/wide.ts",
                            startLine: 188,
                            endLine: 200,
                        },
                    ],
                }),
            ).resolves.toMatchObject({
                isError: false,
                text: "src/wide.ts:188-200",
            });
        } finally {
            await runtime.close();
        }
    });

    it("allows glob discovery during refinement when exact context is read", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            await expect(
                runtime.executeAction("explorer", "refineRepository", {
                    program: globThenReadProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });
            expect(session.snapshot().toolTrace.calls).toEqual([
                expect.objectContaining({ tool: "grep" }),
                expect.objectContaining({ tool: "glob" }),
                expect.objectContaining({ tool: "read" }),
            ]);
        } finally {
            await runtime.close();
        }
    });

    it("returns valid JSON when a program result exceeds the response limit", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const result = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: oversizedProgram() },
            );

            expect(result.isError).toBe(false);
            const payload = JSON.parse(result.text) as {
                programResult: { message: string; truncated: boolean };
            };
            expect(payload.programResult).toMatchObject({ truncated: true });
            expect(payload.programResult.message).toHaveLength(1_000);
        } finally {
            await runtime.close();
        }
    });

    it("grounds only observations that fit in the model-visible response", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            await expect(
                runtime.executeAction("explorer", "discoverRepository", {
                    program: grepProgram(),
                }),
            ).resolves.toMatchObject({ isError: false });

            const refinement = await runtime.executeAction(
                "explorer",
                "refineRepository",
                { program: hugeReadProgram() },
            );
            expect(refinement).toMatchObject({ isError: false });
            const payload = JSON.parse(refinement.text) as {
                observationsTruncated: boolean;
                observations: Array<{
                    path: string;
                    startLine: number;
                    endLine: number;
                }>;
            };
            expect(payload.observationsTruncated).toBe(true);
            const visible = payload.observations.find(
                (observation) => observation.path === "src/huge.ts",
            );
            expect(visible).toBeDefined();
            expect(visible?.endLine).toBeLessThan(200);

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/huge.ts",
                            startLine: (visible?.endLine ?? 0) + 1,
                            endLine: (visible?.endLine ?? 0) + 1,
                        },
                    ],
                }),
            ).resolves.toMatchObject({ isError: true });

            await expect(
                runtime.executeAction("explorer", "submitExploration", {
                    locations: [
                        {
                            path: "src/huge.ts",
                            startLine: visible?.startLine,
                            endLine: visible?.startLine,
                        },
                    ],
                }),
            ).resolves.toMatchObject({ isError: false });
        } finally {
            await runtime.close();
        }
    });

    it("returns bounded structural windows from a discovery read", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const discovery = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: largeFileGrepProgram() },
            );
            expect(discovery).toMatchObject({ isError: false });
            const payload = JSON.parse(discovery.text) as {
                observations: Array<{ lines: string[] }>;
            };
            const lines = payload.observations.flatMap(
                (observation) => observation.lines,
            );
            expect(lines.length).toBeGreaterThan(61);
            expect(lines.length).toBeLessThanOrEqual(121);
            expect(lines.some((line) => line.includes("target-marker"))).toBe(
                true,
            );
        } finally {
            await runtime.close();
        }
    });

    it("preserves a read edge that begins inside a function body", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const discovery = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: midBodyReadProgram() },
            );
            expect(discovery).toMatchObject({ isError: false });
            const payload = JSON.parse(discovery.text) as {
                observations: Array<{ lines: string[] }>;
            };
            expect(
                payload.observations
                    .flatMap((observation) => observation.lines)
                    .some((line) => line.includes("target-marker")),
            ).toBe(true);
        } finally {
            await runtime.close();
        }
    });

    it("preserves the tail of a function body when a read begins mid-body", async () => {
        const runtime = await createExplorerActionDispatcher(
            await createSession(),
        );
        try {
            const discovery = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: midBodyTailReadProgram() },
            );
            expect(discovery).toMatchObject({ isError: false });
            const payload = JSON.parse(discovery.text) as {
                observations: Array<{ lines: string[] }>;
            };
            expect(
                payload.observations
                    .flatMap((observation) => observation.lines)
                    .some((line) => line.includes("target-marker")),
            ).toBe(true);
        } finally {
            await runtime.close();
        }
    });

    it("does not charge failed generated code against valid program executions", async () => {
        const session = await createSession();
        const runtime = await createExplorerActionDispatcher(session);
        try {
            const invalid = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                {
                    program: "not a valid repository program",
                },
            );
            expect(invalid).toMatchObject({ isError: true });
            expect(invalid.text).toMatch(/program validation failed/i);

            const failedExecution = await runtime.executeAction(
                "explorer",
                "discoverRepository",
                { program: failingProgram() },
            );
            expect(failedExecution).toMatchObject({ isError: true });
            expect(failedExecution.text).toMatch(/retry discovery/i);

            for (const [actionName, program] of [
                ["discoverRepository", grepProgram()],
                ["refineRepository", readProgram()],
            ] as const) {
                await expect(
                    runtime.executeAction("explorer", actionName, {
                        program,
                    }),
                ).resolves.toMatchObject({ isError: false });
            }

            expect(session.snapshot()).toMatchObject({
                programAttempts: 2,
                observationCount: 2,
                actionAttempts: [
                    { actionName: "discoverRepository", status: "failed" },
                    { actionName: "discoverRepository", status: "failed" },
                    { actionName: "discoverRepository", status: "completed" },
                    { actionName: "refineRepository", status: "completed" },
                ],
            });
        } finally {
            await runtime.close();
        }
    });

    async function createSession(
        maxToolCalls = 8,
        enableLsp = false,
        executionTimeoutMs = 5_000,
        typescriptLanguageServer = defaultTypeScriptLanguageServerCommand(),
    ): Promise<ExplorerActionSession> {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "typeagent-explorer-dispatcher-test-"),
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
        if (enableLsp) {
            await writeFile(
                path.join(repoRoot, "src", "lsp.ts"),
                [
                    "export function lspTarget() {",
                    "    return 1;",
                    "}",
                    "",
                    "export const result = lspTarget();",
                    "export const external = console.log;",
                ].join("\n"),
            );
        }
        await writeFile(
            path.join(repoRoot, "src", "large.ts"),
            Array.from({ length: 320 }, (_, index) => {
                if (index === 99) return "function target() {";
                if (index === 148) return "    return target-marker;";
                if (index === 149) return "}";
                if (index === 150) return "function other() {";
                if (index === 199) return "}";
                return `line-${index + 1}`;
            }).join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "wide.ts"),
            Array.from({ length: 600 }, (_, index) => {
                if (index === 192) return "function mutationMarker() {";
                if (index === 193) return "    return mutation-marker;";
                if (index === 194) return "}";
                return `wide-line-${index + 1}`;
            }).join("\n"),
        );
        await writeFile(
            path.join(repoRoot, "src", "huge.ts"),
            Array.from(
                { length: 200 },
                (_, index) =>
                    `${String(index + 1).padStart(3, "0")}-${"x".repeat(496)}`,
            ).join("\n"),
        );
        await Promise.all(
            Array.from({ length: 25 }, (_, index) =>
                writeFile(
                    path.join(
                        repoRoot,
                        "src",
                        `candidate-${String(index).padStart(2, "0")}.ts`,
                    ),
                    `export const candidate${index} = "shared-candidate-marker";\n`,
                ),
            ),
        );
        return ExplorerActionSession.create({
            repoRoot: await realpath(repoRoot),
            query: "Find the needle implementation",
            maxResults: 6,
            maxToolCalls,
            maxOutputChars: 8_000,
            executionTimeoutMs,
            ...(enableLsp
                ? {
                      lsp: {
                          servers: createDefaultLanguageServers({
                              typescript: typescriptLanguageServer,
                              python: {
                                  command: process.execPath,
                                  args: ["-e", "process.exit(1)"],
                              },
                          }),
                      },
                  }
                : {}),
        });
    }
});

function grepProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("needle", { literal: true, maxMatches: 1 });
    return { success: true, message: params.query };
}`;
}

function emptyDiscoveryProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    return { success: true, message: params.query, locations: [] };
}`;
}

function fourCallDiscoveryProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("needle", { literal: true, maxMatches: 1 });
    await repo.grep("alpha", { literal: true, maxMatches: 1 });
    await repo.glob("**/*.ts", { maxMatches: 10 });
    await repo.ls("src", { depth: 1, maxEntries: 10 });
    return { success: true, message: params.query };
}`;
}

function lspOnlyDiscoveryProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    return { success: true, message: params.query };
}`;
}

function unawaitedLspDiscoveryProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    void repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    return { success: true, message: params.query };
}`;
}

function fourCallMissingLspRequirementsProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.ls("src", { depth: 1, maxEntries: 10 });
    await repo.glob("**/*.ts", { maxMatches: 10 });
    await repo.grep("needle", { literal: true, maxMatches: 1 });
    await repo.grep("alpha", { literal: true, maxMatches: 1 });
    return { success: true, message: params.query };
}`;
}

function readAndNavigateLspProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/lsp.ts", { offset: 0, limit: 3 });
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    return { success: true, message: params.query };
}`;
}

function readAndMissLspProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/lsp.ts", { offset: 0, limit: 3 });
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "missingSymbol" });
    return { success: true, message: params.query };
}`;
}

function readAndEmptyLspProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/lsp.ts", { offset: 0, limit: 6 });
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 6, symbol: "log" });
    return { success: true, message: params.query };
}`;
}

function navigateLspOnlyProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    return { success: true, message: params.query };
}`;
}

function navigateLspThenReportFailureProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    return { success: false, error: "Unable to ground lspTarget source" };
}`;
}

function readThenThrowProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "lspTarget" });
    await repo.read("src/lsp.ts", { offset: 0, limit: 3 });
    throw new Error("runtime failure");
}`;
}

function twoMissingLspCallsProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "missingSymbol" });
    await repo.lsp({ method: "definition", path: "src/lsp.ts", line: 5, symbol: "anotherMissingSymbol" });
    return { success: true, message: params.query };
}`;
}

function oversizedProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    return { success: true, message: "x".repeat(50000) };
}`;
}

function hugeReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/huge.ts", { offset: 0, limit: 200 });
    return { success: true, message: params.query };
}`;
}

function failingProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    return { success: false, error: "retry discovery", message: params.query };
}`;
}

function readProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function consecutiveGrepProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("function alpha|return", { path: "src/alpha.ts", maxMatches: 2 });
    return { success: true, message: params.query };
}`;
}

function unrelatedReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/wide.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function searchThenReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("needle", { literal: true, maxMatches: 1 });
    await repo.grep("missing-one", { literal: true, maxMatches: 1 });
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    await repo.read("src/wide.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function scopedGrepRefinementProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    await repo.grep("mutation-marker", { path: "src/wide.ts", literal: true, maxMatches: 1 });
    await repo.read("src/wide.ts", { offset: 187, limit: 13 });
    return { success: true, message: params.query };
}`;
}

function fourCallRefinementProgram(): string {
    return searchThenReadProgram();
}

function globThenReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.glob("**/alpha.ts", { maxMatches: 10 });
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    return { success: true, message: params.query };
}`;
}

function broadReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/wide.ts", { offset: 0, limit: 300 });
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

function grepOnlyRefinementProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("needle", { literal: true, maxMatches: 1 });
    return { success: true, message: params.query };
}`;
}

function threeBroadReadsProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    for (let offset = 0; offset < 400; offset += 200) {
        await repo.read("src/wide.ts", { offset, limit: 200 });
    }
    return { success: true, message: params.query };
}`;
}

function threeCompactedReadsProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    for (let offset = 0; offset < 600; offset += 200) {
        await repo.read("src/wide.ts", { offset, limit: 200 });
    }
    return { success: true, message: params.query };
}`;
}

function candidateCompactedReadsProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    const first = await repo.read("src/wide.ts", { offset: 0, limit: 200 });
    await repo.read("src/wide.ts", { offset: 200, limit: 200 });
    await repo.read("src/wide.ts", { offset: 400, limit: 200 });
    return {
        success: true,
        locations: first.location ? [{ path: first.location.path, startLine: 100, endLine: 110 }] : [],
    };
}`;
}

function oversizedCandidateCompactedReadsProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    const first = await repo.read("src/wide.ts", { offset: 0, limit: 200 });
    await repo.read("src/wide.ts", { offset: 200, limit: 200 });
    await repo.read("src/wide.ts", { offset: 400, limit: 200 });
    return {
        success: true,
        locations: first.location ? [{ path: first.location.path, startLine: 1, endLine: 200 }] : [],
    };
}`;
}

function fourReadOversizedCandidateProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    const first = await repo.read("src/wide.ts", { offset: 0, limit: 200 });
    await repo.read("src/wide.ts", { offset: 200, limit: 200 });
    await repo.read("src/wide.ts", { offset: 400, limit: 200 });
    await repo.read("src/alpha.ts", { offset: 0, limit: 3 });
    return {
        success: true,
        locations: first.location ? [{ path: first.location.path, startLine: 1, endLine: 200 }] : [],
    };
}`;
}

function normalizedCandidateReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/wide.ts", { offset: 99, limit: 11 });
    return {
        success: true,
        locations: [{ path: "./src/wide.ts", startLine: 100, endLine: 110 }],
    };
}`;
}

function caughtGrepErrorProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    try {
        await repo.grep("[", { path: "src/large.ts" });
    } catch {}
    await repo.grep("target-marker", { path: "src/large.ts", literal: true, maxMatches: 1 });
    return { success: true, message: params.query, locations: [] };
}`;
}

function oversizedCaughtReadErrorProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    try {
        await repo.read("x".repeat(50000), { limit: 1 });
    } catch {}
    await repo.grep("target-marker", { path: "src/large.ts", literal: true, maxMatches: 1 });
    return { success: true, message: params.query, locations: [] };
}`;
}

function broadMutationReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/wide.ts", { offset: 110, limit: 200 });
    return { success: true, message: params.query };
}`;
}

function largeFileGrepProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("function target", { path: "src/large.ts", literal: true, maxMatches: 1 });
    await repo.read("src/large.ts", { offset: 49, limit: 200 });
    return { success: true, message: params.query };
}`;
}

function midBodyReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/large.ts", { offset: 145, limit: 80 });
    return { success: true, message: params.query };
}`;
}

function midBodyTailReadProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.read("src/large.ts", { offset: 110, limit: 80 });
    return { success: true, message: params.query };
}`;
}

function diverseGrepProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("target-marker", { path: "src/large.ts", literal: true, maxMatches: 1 });
    await repo.grep("line-", { path: "src/large.ts", literal: true, maxMatches: 40 });
    return { success: true, message: params.query };
}`;
}

function manyFileGrepProgram(): string {
    return `
async function execute(repo: RepositoryApi, params: ExploreParams): Promise<ExploreProgramResult> {
    await repo.grep("shared-candidate-marker", { literal: true, maxMatches: 30 });
    return { success: true, message: params.query };
}`;
}

function delayedLanguageServerCommand(delayMs: number): {
    command: string;
    args: string[];
} {
    const source = String.raw`
let buffer = Buffer.alloc(0);
function send(value) {
    const body = JSON.stringify(value);
    process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\r\n\r\n" + body);
}
function respond(id, result) {
    send({ jsonrpc: "2.0", id, result });
}
function handle(message) {
    if (message.method === "initialize") {
        respond(message.id, { capabilities: {} });
    } else if (message.method === "textDocument/definition") {
        setTimeout(() => respond(message.id, []), ${delayMs});
    } else if (message.method === "shutdown") {
        respond(message.id, null);
    } else if (message.method === "exit") {
        process.exit(0);
    } else if (message.id !== undefined) {
        respond(message.id, null);
    }
}
process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) process.exit(2);
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd) return;
        const message = JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
        buffer = buffer.subarray(bodyEnd);
        handle(message);
    }
});`;
    return { command: process.execPath, args: ["-e", source] };
}
