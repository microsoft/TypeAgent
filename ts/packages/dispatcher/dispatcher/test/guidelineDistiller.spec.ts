// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChatModel } from "aiclient";
import { distillGuidelineCandidates } from "../src/neighborhoods/optimize/guidelineDistiller.js";
import { buildCandidatesMarkdown } from "../src/neighborhoods/optimize/guidelinesViz.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-distill-"));
}

function writeJsonl(filePath: string, rows: object[]): void {
    fs.writeFileSync(
        filePath,
        rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
}

function row(overrides: Record<string, unknown> = {}): object {
    return {
        runId: "r1",
        caseId: "c1",
        schemaName: "player",
        actionName: "playTrack",
        neighborhoodId: "nbh-a",
        failurePattern: "similar-verb",
        failurePatternHeuristic: "similar-verb",
        lever: "jsdoc",
        mechanism: "widen-identity",
        guidelineHook: "schema-shape-work-with-llm-intent",
        depth: 0,
        rescues: 3,
        regressions: 0,
        netDelta: 3,
        score: 3,
        isWinner: true,
        regressionPhrases: [],
        evaluationPath: "/x",
        ...overrides,
    };
}

function mockModel(jsonOut: string): ChatModel {
    return {
        complete: async () => ({ success: true, data: jsonOut }),
    } as unknown as ChatModel;
}

function failingModel(): ChatModel {
    return {
        complete: async () => ({
            success: false,
            message: "synthetic LLM error",
        }),
    } as unknown as ChatModel;
}

const SAMPLE_CANNED = JSON.stringify({
    title: "Identity widening for similar-verb collisions",
    extendsSection: "schema-shape-work-with-llm-intent",
    proposedText:
        "When two actions share a base verb, the more general action's identity line should name the broader intent it absorbs.",
});

describe("distillGuidelineCandidates", () => {
    let dir: string;
    let patternsFile: string;

    beforeEach(() => {
        dir = tmpdir();
        patternsFile = path.join(dir, "patterns.jsonl");
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("returns not-enough-data when patterns file is missing", async () => {
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(report.status).toBe("not-enough-data");
        expect(report.statusReason).toMatch(/not found/);
    });

    it("returns not-enough-data when winners < minAttempts", async () => {
        writeJsonl(patternsFile, [row(), row(), { ...row(), isWinner: false }]);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(report.status).toBe("not-enough-data");
        expect(report.statusReason).toContain("2 winner(s)");
    });

    it("groups winners by (mechanism, guidelineHook)", async () => {
        // 5 winners on widen-identity, 5 on add-important-line. Both
        // groups should produce a candidate (each ≥ minPerGroup=3).
        const winners = [
            ...Array.from({ length: 5 }, (_, i) =>
                row({
                    caseId: `wi-${i}`,
                    neighborhoodId: `nbh-wi-${i}`,
                    mechanism: "widen-identity",
                }),
            ),
            ...Array.from({ length: 5 }, (_, i) =>
                row({
                    caseId: `ai-${i}`,
                    neighborhoodId: `nbh-ai-${i}`,
                    mechanism: "add-important-line",
                }),
            ),
        ];
        writeJsonl(patternsFile, winners);
        let callCount = 0;
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () =>
                mockModel(
                    JSON.stringify({
                        title: `Candidate #${++callCount}`,
                        extendsSection: "schema-shape-work-with-llm-intent",
                        proposedText: `Text for call ${callCount}`,
                    }),
                ),
        });
        expect(report.status).toBe("completed");
        expect(report.candidates).toHaveLength(2);
        // Both groups produce one candidate each.
        const mechanisms = report.candidates.map((c) => c.mechanism).sort();
        expect(mechanisms).toEqual([
            "add-important-line",
            "widen-identity",
        ]);
    });

    it("drops groups below the per-group threshold", async () => {
        // 8 widen-identity wins (passes) + 2 add-important-line wins
        // (drops). 10 total winners → passes the overall minAttempts.
        const winners = [
            ...Array.from({ length: 8 }, (_, i) =>
                row({
                    caseId: `wi-${i}`,
                    neighborhoodId: `nbh-wi-${i}`,
                    mechanism: "widen-identity",
                }),
            ),
            ...Array.from({ length: 2 }, (_, i) =>
                row({
                    caseId: `ai-${i}`,
                    neighborhoodId: `nbh-ai-${i}`,
                    mechanism: "add-important-line",
                }),
            ),
        ];
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            minPerGroup: 3,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(report.status).toBe("completed");
        expect(report.candidates).toHaveLength(1);
        expect(report.candidates[0]!.mechanism).toBe("widen-identity");
    });

    it("returns not-enough-data when NO group meets minPerGroup", async () => {
        // 12 winners, each in its own (mechanism, guidelineHook) bucket.
        const mechanisms = [
            "widen-identity",
            "add-important-line",
            "add-positive-example",
            "rename-action-suggestion",
            "deprecate",
            "tighten-parameter-type",
        ];
        const hooks = [
            "schema-shape-work-with-llm-intent",
            "critical-constraint-format",
        ];
        const winners = [];
        for (let i = 0; i < 12; i++) {
            winners.push(
                row({
                    caseId: `c${i}`,
                    neighborhoodId: `nbh-${i}`,
                    mechanism: mechanisms[i % mechanisms.length],
                    guidelineHook: hooks[i % hooks.length],
                }),
            );
        }
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            minPerGroup: 3,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(report.status).toBe("not-enough-data");
        expect(report.statusReason).toContain(
            "no (mechanism, guidelineHook) group",
        );
    });

    it("dedups samples by neighborhoodId before passing to the LLM", async () => {
        // 5 winners on the same neighborhood (with distinct evaluation
        // paths so we can tell them apart) + 5 winners on distinct
        // neighborhoods. Dedup by neighborhoodId means at most ONE of
        // the "shared/*" paths makes it into samplePaths.
        const winners = [
            ...Array.from({ length: 5 }, (_, i) =>
                row({
                    caseId: `dup-${i}`,
                    neighborhoodId: "nbh-shared",
                    evaluationPath: `/shared/${i}`,
                }),
            ),
            ...Array.from({ length: 5 }, (_, i) =>
                row({
                    caseId: `uniq-${i}`,
                    neighborhoodId: `nbh-uniq-${i}`,
                    evaluationPath: `/uniq/${i}`,
                }),
            ),
        ];
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            samplesPerGroup: 5,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(report.status).toBe("completed");
        const samplePaths = report.candidates[0]!.evidence.samplePaths;
        // 6 distinct neighborhoods total. Sampling cap = 5, so 5 paths.
        expect(samplePaths.length).toBeLessThanOrEqual(5);
        // At most ONE "/shared/*" path is included — neighborhoodId dedup.
        const sharedCount = samplePaths.filter((p) =>
            p.startsWith("/shared/"),
        ).length;
        expect(sharedCount).toBeLessThanOrEqual(1);
        // Total distinct neighborhoods recorded in evidence = 6.
        expect(
            report.candidates[0]!.evidence.distinctNeighborhoods,
        ).toBe(6);
    });

    it("falls back gracefully when the LLM returns malformed JSON", async () => {
        const winners = Array.from({ length: 10 }, (_, i) =>
            row({
                caseId: `c${i}`,
                neighborhoodId: `nbh-${i}`,
            }),
        );
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel("not valid JSON at all"),
        });
        // Group existed but LLM produced nothing parseable → no candidates.
        expect(report.status).toBe("not-enough-data");
        expect(report.candidates).toEqual([]);
    });

    it("falls back gracefully when the LLM call fails", async () => {
        const winners = Array.from({ length: 10 }, (_, i) =>
            row({
                caseId: `c${i}`,
                neighborhoodId: `nbh-${i}`,
            }),
        );
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => failingModel(),
        });
        expect(report.status).toBe("not-enough-data");
        expect(report.candidates).toEqual([]);
    });

    it("respects maxCandidates cap", async () => {
        // 4 distinct mechanism groups, each with 5 winners (passes
        // minPerGroup=3). With maxCandidates=2, only 2 groups distill.
        const mechs = [
            "widen-identity",
            "add-important-line",
            "add-positive-example",
            "rename-action-suggestion",
        ];
        const winners = [];
        for (const m of mechs) {
            for (let i = 0; i < 5; i++) {
                winners.push(
                    row({
                        caseId: `${m}-${i}`,
                        neighborhoodId: `nbh-${m}-${i}`,
                        mechanism: m,
                    }),
                );
            }
        }
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            maxCandidates: 2,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(report.candidates.length).toBeLessThanOrEqual(2);
    });

    it("records distinctNeighborhoods in evidence", async () => {
        // 5 winners on shared nbh + 5 on distinct → 6 distinct.
        const winners = [
            ...Array.from({ length: 5 }, (_, i) =>
                row({
                    caseId: `s-${i}`,
                    neighborhoodId: "nbh-shared",
                }),
            ),
            ...Array.from({ length: 5 }, (_, i) =>
                row({
                    caseId: `d-${i}`,
                    neighborhoodId: `nbh-d-${i}`,
                }),
            ),
        ];
        writeJsonl(patternsFile, winners);
        const report = await distillGuidelineCandidates({
            patternsFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(SAMPLE_CANNED),
        });
        expect(
            report.candidates[0]!.evidence.distinctNeighborhoods,
        ).toBe(6);
    });
});

describe("buildCandidatesMarkdown", () => {
    it("renders a 'not-enough-data' status with reason", () => {
        const md = buildCandidatesMarkdown({
            schemaVersion: 1,
            builtAt: "2026-05-13T00:00:00Z",
            inputs: { patternsFile: "/x/patterns.jsonl" },
            minAttempts: 10,
            totalWinners: 3,
            totalAttempts: 30,
            status: "not-enough-data",
            statusReason: "test reason here",
            candidates: [],
        });
        expect(md).toContain("Status:** not-enough-data");
        expect(md).toContain("test reason here");
    });

    it("renders multi-candidate markdown with evidence sections", () => {
        const md = buildCandidatesMarkdown({
            schemaVersion: 1,
            builtAt: "2026-05-13T00:00:00Z",
            inputs: { patternsFile: "/x" },
            minAttempts: 10,
            totalWinners: 14,
            totalAttempts: 30,
            status: "completed",
            candidates: [
                {
                    title: "Cand A",
                    extendsSection: "schema-shape-work-with-llm-intent",
                    mechanism: "widen-identity",
                    guidelineHook: "schema-shape-work-with-llm-intent",
                    proposedText: "Body A",
                    evidence: {
                        winnerCount: 7,
                        distinctNeighborhoods: 5,
                        samplePaths: ["/a/1", "/a/2", "/a/3"],
                    },
                },
                {
                    title: "Cand B",
                    extendsSection: "new-section",
                    mechanism: "deprecate",
                    guidelineHook: null,
                    proposedText: "Body B\nwith two lines",
                    evidence: {
                        winnerCount: 4,
                        distinctNeighborhoods: 4,
                        samplePaths: ["/b/1"],
                    },
                },
            ],
        });
        expect(md).toContain("## Candidate 1 — Cand A");
        expect(md).toContain("## Candidate 2 — Cand B");
        expect(md).toContain("> Body A");
        expect(md).toContain("> Body B");
        expect(md).toContain("> with two lines");
        expect(md).toContain("`/a/1`");
        expect(md).toContain("7 winner(s) across 5 distinct neighborhood(s)");
        expect(md).toContain("Distilled 2 candidate(s)");
    });
});
