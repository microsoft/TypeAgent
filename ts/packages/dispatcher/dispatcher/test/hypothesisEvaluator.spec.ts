// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Hypothesis } from "../src/neighborhoods/optimize/types.js";
import {
    evaluateHypothesis,
    scoreFromDiff,
    writeEvaluation,
    writeProposal,
    type DiffPayload,
} from "../src/neighborhoods/optimize/hypothesisEvaluator.js";
import type { LeverPlugin } from "../src/neighborhoods/optimize/registry.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-evaluator-"));
}

function stubHypothesis(): Hypothesis {
    return {
        id: "h01-jsdoc",
        lever: "jsdoc",
        depth: 0,
        rationale: { free: "test" },
        mechanism: "widen-identity",
        guidelineHook: "schema-shape-work-with-llm-intent",
        diffSummary: {
            addedLines: 1,
            removedLines: 0,
            touchesIdentityLine: false,
            addsAntiExample: false,
        },
        payload: { test: true },
    };
}

describe("scoreFromDiff", () => {
    it("computes netDelta = rescues - regressions", () => {
        const result = scoreFromDiff({
            rescues: 5,
            regressions: 2,
            regressionPhrases: ["phrase a", "phrase b"],
        });
        expect(result.rescues).toBe(5);
        expect(result.regressions).toBe(2);
        expect(result.netDelta).toBe(3);
        expect(result.score).toBe(3);
        expect(result.regressionPhrases).toEqual(["phrase a", "phrase b"]);
        expect(result.probeType).toBe("translator");
        expect(result.schemaVersion).toBe(1);
    });

    it("handles zero rescues and zero regressions cleanly", () => {
        const result = scoreFromDiff({
            rescues: 0,
            regressions: 0,
            regressionPhrases: [],
        });
        expect(result.netDelta).toBe(0);
        expect(result.score).toBe(0);
    });

    it("produces a negative score when regressions exceed rescues", () => {
        const result = scoreFromDiff({
            rescues: 1,
            regressions: 4,
            regressionPhrases: ["a", "b", "c", "d"],
        });
        expect(result.score).toBe(-3);
    });
});

describe("writeProposal / writeEvaluation", () => {
    let dir: string;

    beforeEach(() => {
        dir = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes proposal.json with the hypothesis fields", () => {
        const hypothesis = stubHypothesis();
        writeProposal(dir, hypothesis);

        const proposalPath = path.join(dir, "proposal.json");
        expect(fs.existsSync(proposalPath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(proposalPath, "utf-8"));
        expect(parsed.id).toBe("h01-jsdoc");
        expect(parsed.lever).toBe("jsdoc");
        expect(parsed.mechanism).toBe("widen-identity");
        expect(parsed.schemaVersion).toBe(1);
    });

    it("writes evaluation.json with all scoring fields", () => {
        const evaluation = scoreFromDiff({
            rescues: 3,
            regressions: 1,
            regressionPhrases: ["bad"],
        });
        writeEvaluation(dir, evaluation);
        const parsed = JSON.parse(
            fs.readFileSync(path.join(dir, "evaluation.json"), "utf-8"),
        );
        expect(parsed.rescues).toBe(3);
        expect(parsed.regressions).toBe(1);
        expect(parsed.netDelta).toBe(2);
        expect(parsed.regressionPhrases).toEqual(["bad"]);
    });

    it("creates the attempt dir if missing", () => {
        const nested = path.join(dir, "case-001", "attempts", "h01-jsdoc");
        // nested doesn't exist yet — writer should mkdir -p.
        writeProposal(nested, stubHypothesis());
        expect(fs.existsSync(path.join(nested, "proposal.json"))).toBe(true);
    });
});

describe("evaluateHypothesis orchestration", () => {
    let dir: string;

    beforeEach(() => {
        dir = tmpdir();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function stubLever(): LeverPlugin {
        return {
            name: "test",
            description: "test",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [];
            },
            async applyToSandbox() {
                return { filesWritten: [] };
            },
        };
    }

    const STUB_CASE = {
        schemaVersion: 1 as const,
        neighborhoodId: "nbh-test",
        members: [],
        severityTier: "leaky" as const,
        failurePattern: "unclassified" as const,
        failurePatternHeuristic: "unclassified" as const,
        misroutePhrases: [],
        cleanPhrases: [],
        reverseDirectionPhrases: [],
        currentJSDoc: {},
        currentManifestDescriptions: {},
        currentPasDescriptions: {},
        originalChecksum: {},
    };

    it("writes proposal.json BEFORE running the probe", async () => {
        let probeRan = false;
        let proposalExistedAtProbeTime = false;
        const attemptDir = path.join(dir, "h01-jsdoc");
        const runProbe = async (): Promise<DiffPayload> => {
            probeRan = true;
            proposalExistedAtProbeTime = fs.existsSync(
                path.join(attemptDir, "proposal.json"),
            );
            return { rescues: 0, regressions: 0, regressionPhrases: [] };
        };

        await evaluateHypothesis({
            hypothesis: stubHypothesis(),
            caseDesc: STUB_CASE,
            attemptDir,
            lever: stubLever(),
            applyCtx: {
                originalProvider: {} as any,
                sandboxDir: dir,
                schemaSourceLookup: () => ({ manifestPath: "" }),
                checksums: {},
            },
            runProbe,
        });

        expect(probeRan).toBe(true);
        expect(proposalExistedAtProbeTime).toBe(true);
    });

    it("creates archive folder with both proposal.json and evaluation.json even when 0 rescues", async () => {
        const attemptDir = path.join(dir, "h01-jsdoc");
        await evaluateHypothesis({
            hypothesis: stubHypothesis(),
            caseDesc: STUB_CASE,
            attemptDir,
            lever: stubLever(),
            applyCtx: {
                originalProvider: {} as any,
                sandboxDir: dir,
                schemaSourceLookup: () => ({ manifestPath: "" }),
                checksums: {},
            },
            runProbe: async () => ({
                rescues: 0,
                regressions: 0,
                regressionPhrases: [],
            }),
        });
        expect(fs.existsSync(path.join(attemptDir, "proposal.json"))).toBe(
            true,
        );
        expect(fs.existsSync(path.join(attemptDir, "evaluation.json"))).toBe(
            true,
        );
    });

    it("calls revertSandbox before applyToSandbox", async () => {
        const attemptDir = path.join(dir, "h01-jsdoc");
        const trace: string[] = [];
        let appliedHypothesis: Hypothesis | undefined;
        const lever: LeverPlugin = {
            name: "test",
            description: "test",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [];
            },
            async applyToSandbox(h) {
                trace.push("apply");
                appliedHypothesis = h;
                return { filesWritten: [] };
            },
        };
        await evaluateHypothesis({
            hypothesis: stubHypothesis(),
            caseDesc: STUB_CASE,
            attemptDir,
            lever,
            applyCtx: {
                originalProvider: {} as any,
                sandboxDir: dir,
                schemaSourceLookup: () => ({ manifestPath: "" }),
                checksums: {},
            },
            runProbe: async () => ({
                rescues: 1,
                regressions: 0,
                regressionPhrases: [],
            }),
            revertSandbox: () => {
                trace.push("revert");
            },
        });
        expect(trace).toEqual(["revert", "apply"]);
        expect(appliedHypothesis?.id).toBe("h01-jsdoc");
    });

    it("returns an AttemptRecord with the evaluation result", async () => {
        const attemptDir = path.join(dir, "h01-jsdoc");
        const record = await evaluateHypothesis({
            hypothesis: stubHypothesis(),
            caseDesc: STUB_CASE,
            attemptDir,
            lever: stubLever(),
            applyCtx: {
                originalProvider: {} as any,
                sandboxDir: dir,
                schemaSourceLookup: () => ({ manifestPath: "" }),
                checksums: {},
            },
            runProbe: async () => ({
                rescues: 4,
                regressions: 1,
                regressionPhrases: ["phrase x"],
            }),
        });
        expect(record.hypothesis.id).toBe("h01-jsdoc");
        expect(record.evaluation.score).toBe(3);
        expect(record.evaluation.regressionPhrases).toEqual(["phrase x"]);
        expect(record.artifactPath).toBe(attemptDir);
    });
});
