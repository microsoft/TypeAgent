// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ChatModel } from "aiclient";
import { runDistillStep } from "../src/neighborhoods/optimize/runPipeline.js";
import { RUN_STEPS } from "../src/neighborhoods/optimize/runSteps.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-runpipeline-"));
}

function writeJsonl(filePath: string, rows: object[]): void {
    fs.writeFileSync(
        filePath,
        rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
}

function row(isWinner: boolean, overrides: Record<string, unknown> = {}): object {
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
        rescues: isWinner ? 3 : 0,
        regressions: 0,
        netDelta: isWinner ? 3 : 0,
        score: isWinner ? 3 : 0,
        isWinner,
        regressionPhrases: [],
        evaluationPath: "/x",
        ...overrides,
    };
}

/** Mock that returns the same canned JSON for every call. */
function mockModel(jsonOut: string): ChatModel {
    return {
        complete: async () => ({ success: true, data: jsonOut }),
    } as unknown as ChatModel;
}

const CANNED_RESPONSE = JSON.stringify({
    title: "Test candidate",
    extendsSection: "schema-shape-work-with-llm-intent",
    proposedText: "When two actions share a verb, widen the right one.",
});

describe("RUN_STEPS", () => {
    it("has the expected 5-step order", () => {
        expect(RUN_STEPS).toEqual([
            "neighborhoods",
            "explore",
            "validate",
            "patterns",
            "distill",
        ]);
    });
});

describe("runDistillStep", () => {
    let dir: string;
    let patternsFile: string;
    let candidatesFile: string;

    beforeEach(() => {
        dir = tmpdir();
        patternsFile = path.join(dir, "patterns.jsonl");
        candidatesFile = path.join(dir, "schemaGuidelines.candidates.md");
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("returns not-enough-data with placeholder markdown when patterns.jsonl is missing", async () => {
        const result = await runDistillStep({
            patternsFile,
            candidatesFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(CANNED_RESPONSE),
        });
        expect(result).toBe("not-enough-data");
        expect(fs.existsSync(candidatesFile)).toBe(true);
        const content = fs.readFileSync(candidatesFile, "utf-8");
        expect(content).toMatch(/not-enough-data/i);
    });

    it("writes not-enough-data markdown when winners < minAttempts", async () => {
        writeJsonl(patternsFile, [
            row(true),
            row(true),
            row(false),
        ]);
        const result = await runDistillStep({
            patternsFile,
            candidatesFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(CANNED_RESPONSE),
        });
        expect(result).toBe("not-enough-data");
        const content = fs.readFileSync(candidatesFile, "utf-8");
        expect(content).toContain("Status:** not-enough-data");
        expect(content).toContain("2 winner(s)");
    });

    it("produces candidates when winners >= minAttempts AND group is viable", async () => {
        // 12 winners on the same (mechanism, guidelineHook). The
        // distiller will form one group of 12 → call LLM once → 1
        // candidate.
        const winners = [];
        for (let i = 0; i < 12; i++) {
            winners.push(
                row(true, {
                    caseId: `c${i}`,
                    neighborhoodId: `nbh-${i}`,
                    // evaluationPath set to a non-existent dir so
                    // pickSamples falls back to the row data — proposal.json
                    // unavailable.
                    evaluationPath: path.join(dir, `attempt-${i}`),
                }),
            );
        }
        writeJsonl(patternsFile, winners);

        const result = await runDistillStep({
            patternsFile,
            candidatesFile,
            minAttempts: 10,
            schemaGuidelines: "(test guidelines body)",
            createModel: () => mockModel(CANNED_RESPONSE),
        });
        expect(result).toBe("completed");
        const content = fs.readFileSync(candidatesFile, "utf-8");
        expect(content).toContain("Candidate 1");
        expect(content).toContain("Test candidate");
        expect(content).toContain(
            "When two actions share a verb, widen the right one.",
        );
    });

    it("counts isWinner=true rows only", async () => {
        // 3 winners, 12 losers — well below the 10 threshold once
        // filtered.
        const rows = [
            ...Array.from({ length: 3 }, () => row(true)),
            ...Array.from({ length: 12 }, () => row(false)),
        ];
        writeJsonl(patternsFile, rows);
        const result = await runDistillStep({
            patternsFile,
            candidatesFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(CANNED_RESPONSE),
        });
        expect(result).toBe("not-enough-data");
        const content = fs.readFileSync(candidatesFile, "utf-8");
        expect(content).toContain("3 winner(s)");
    });

    it("returns not-enough-data when no group has >= 3 winners", async () => {
        // 15 winners, but all in DIFFERENT (mechanism, guidelineHook)
        // groups — no group passes the per-group threshold.
        const mechanisms = [
            "widen-identity",
            "add-important-line",
            "add-positive-example",
            "rename-action-suggestion",
            "deprecate",
        ];
        const hooks = [
            "schema-shape-work-with-llm-intent",
            "critical-constraint-format",
            "identity-line-closest",
        ];
        const winners = [];
        for (let i = 0; i < 15; i++) {
            winners.push(
                row(true, {
                    caseId: `c${i}`,
                    neighborhoodId: `nbh-${i}`,
                    mechanism: mechanisms[i % mechanisms.length],
                    guidelineHook: hooks[i % hooks.length],
                }),
            );
        }
        writeJsonl(patternsFile, winners);
        const result = await runDistillStep({
            patternsFile,
            candidatesFile,
            minAttempts: 10,
            schemaGuidelines: "(test)",
            createModel: () => mockModel(CANNED_RESPONSE),
        });
        expect(result).toBe("not-enough-data");
        const content = fs.readFileSync(candidatesFile, "utf-8");
        expect(content).toContain("no (mechanism, guidelineHook) group");
    });
});
