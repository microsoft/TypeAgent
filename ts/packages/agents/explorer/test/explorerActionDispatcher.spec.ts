// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExplorerActionSession } from "../src/actionHandler.js";
import { createExplorerActionDispatcher } from "../src/reasoning/explorerActionDispatcher.js";

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
                observations: Array<{
                    source: "grep" | "read";
                    path: string;
                    startLine: number;
                    endLine: number;
                }>;
            };
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

    it("grounds a range covered by consecutive visible grep lines only", async () => {
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
                isError: false,
                text: "src/alpha.ts:1-2",
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
            executionTimeoutMs: 5_000,
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
