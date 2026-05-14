// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    _clearRegistryForTest,
    registerLever,
    type ApplyContext,
    type LeverPlugin,
    type ProposeContext,
} from "../src/neighborhoods/optimize/registry.js";
import {
    rankAttempts,
    runCaseLoop,
} from "../src/neighborhoods/optimize/caseLoop.js";
import type {
    AttemptRecord,
    CaseDescription,
    Hypothesis,
} from "../src/neighborhoods/optimize/types.js";
import { pmap } from "../src/neighborhoods/optimize/util.js";

function tmpdir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "typeagent-caseloop-"));
}

function stubHypothesis(lever: string, suffix = "01"): Hypothesis {
    return {
        id: `h${suffix}-${lever}`,
        lever,
        depth: 0,
        rationale: { free: "test" },
        mechanism: "widen-identity",
        guidelineHook: null,
        diffSummary: {
            addedLines: 0,
            removedLines: 0,
            touchesIdentityLine: false,
            addsAntiExample: false,
        },
        payload: null,
    };
}

function makeAttempt(
    score: number,
    regressions: number = 0,
    id: string = "h01-x",
): AttemptRecord {
    return {
        hypothesis: { ...stubHypothesis("x"), id },
        evaluation: {
            schemaVersion: 1,
            probeType: "translator",
            rescues: score + regressions,
            regressions,
            netDelta: score,
            score,
            regressionPhrases: [],
        },
        artifactPath: `/tmp/${id}`,
    };
}

const STUB_CASE: CaseDescription = {
    schemaVersion: 1,
    neighborhoodId: "nbh-test",
    members: [{ schemaName: "player", actionName: "playTrack" }],
    severityTier: "leaky",
    failurePattern: "similar-verb",
    failurePatternHeuristic: "similar-verb",
    misroutePhrases: [],
    cleanPhrases: [],
    reverseDirectionPhrases: [],
    currentJSDoc: {},
    currentManifestDescriptions: {},
    currentPasDescriptions: {},
    originalChecksum: { "player:schema": "abc" },
};

const STUB_PROPOSE_CTX: ProposeContext = {
    createModel: () => ({} as any),
    pmap,
    workdir: "",
    outDir: "",
    schemaGuidelines: "(test)",
};

const STUB_APPLY_CTX: ApplyContext = {
    originalProvider: {} as any,
    sandboxDir: "",
    schemaSourceLookup: () => ({ manifestPath: "" }),
    checksums: STUB_CASE.originalChecksum,
};

describe("rankAttempts", () => {
    it("sorts by score desc", () => {
        const a = makeAttempt(2, 0, "h01-x");
        const b = makeAttempt(5, 0, "h02-x");
        const c = makeAttempt(1, 0, "h03-x");
        const ranked = rankAttempts([a, b, c]);
        expect(ranked.map((r) => r.hypothesis.id)).toEqual([
            "h02-x",
            "h01-x",
            "h03-x",
        ]);
    });

    it("tie-breaks on smaller regression set when scores are equal", () => {
        const a = makeAttempt(3, 2, "h01-x");
        const b = makeAttempt(3, 0, "h02-x");
        const ranked = rankAttempts([a, b]);
        expect(ranked.map((r) => r.hypothesis.id)).toEqual([
            "h02-x",
            "h01-x",
        ]);
    });

    it("tie-breaks on id when score and regressions match", () => {
        const a = makeAttempt(3, 1, "h02-x");
        const b = makeAttempt(3, 1, "h01-x");
        const ranked = rankAttempts([a, b]);
        expect(ranked.map((r) => r.hypothesis.id)).toEqual([
            "h01-x",
            "h02-x",
        ]);
    });
});

describe("runCaseLoop", () => {
    let dir: string;

    beforeEach(() => {
        dir = tmpdir();
        _clearRegistryForTest();
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        _clearRegistryForTest();
    });

    function reverbLever(
        rescues: number,
        regressions: number = 0,
    ): LeverPlugin {
        return {
            name: "reverb",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [stubHypothesis("reverb")];
            },
            async applyToSandbox() {
                return { filesWritten: [] };
            },
        };
    }

    it("writes case.json before running attempts", async () => {
        registerLever(reverbLever(1));
        await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 0,
            runProbe: async () => ({
                rescues: 1,
                regressions: 0,
                regressionPhrases: [],
            }),
            revertSandbox: () => {},
        });
        const caseJson = JSON.parse(
            fs.readFileSync(path.join(dir, "case.json"), "utf-8"),
        );
        expect(caseJson.neighborhoodId).toBe("nbh-test");
    });

    it("writes per-attempt proposal.json and evaluation.json", async () => {
        registerLever(reverbLever(1));
        await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 0,
            runProbe: async () => ({
                rescues: 1,
                regressions: 0,
                regressionPhrases: [],
            }),
            revertSandbox: () => {},
        });
        const attemptDirs = fs.readdirSync(path.join(dir, "attempts"));
        expect(attemptDirs).toHaveLength(1);
        const adir = path.join(dir, "attempts", attemptDirs[0]!);
        expect(fs.existsSync(path.join(adir, "proposal.json"))).toBe(true);
        expect(fs.existsSync(path.join(adir, "evaluation.json"))).toBe(true);
    });

    it("picks winner when score > 0", async () => {
        registerLever(reverbLever(2));
        const result = await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 0,
            runProbe: async () => ({
                rescues: 2,
                regressions: 0,
                regressionPhrases: [],
            }),
            revertSandbox: () => {},
        });
        expect(result.winner).not.toBeNull();
        expect(result.winner!.evaluation.score).toBe(2);
        const winnerJson = JSON.parse(
            fs.readFileSync(path.join(dir, "winner.json"), "utf-8"),
        );
        // winner.json carries the AttemptRecord shape (or {attemptId:null}).
        expect(winnerJson.evaluation.score).toBe(2);
    });

    it("returns null winner with rationale when no positive-score attempt", async () => {
        registerLever(reverbLever(0));
        const result = await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 0,
            runProbe: async () => ({
                rescues: 0,
                regressions: 0,
                regressionPhrases: [],
            }),
            revertSandbox: () => {},
        });
        expect(result.winner).toBeNull();
        const winnerJson = JSON.parse(
            fs.readFileSync(path.join(dir, "winner.json"), "utf-8"),
        );
        expect(winnerJson.attemptId).toBeNull();
        expect(winnerJson.rationale).toMatch(/no positive-score/);
    });

    it("recurses through depth budget when score never goes positive", async () => {
        registerLever(reverbLever(0));
        const result = await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 2,
            runProbe: async () => ({
                rescues: 0,
                regressions: 1,
                regressionPhrases: ["bad"],
            }),
            revertSandbox: () => {},
        });
        // 1 lever, 1 hypothesis per round, 3 rounds (depth 0, 1, 2).
        expect(result.attempts).toHaveLength(3);
        const depths = result.attempts.map((a) => a.hypothesis.depth);
        expect(depths).toEqual([0, 1, 2]);
        const ids = result.attempts.map((a) => a.hypothesis.id);
        expect(ids[0]).toMatch(/^h01-reverb$/);
        expect(ids[1]).toMatch(/-r1$/);
        expect(ids[2]).toMatch(/-r2$/);
    });

    it("threads priorAttempts (with mechanism) to the lever at depth > 0", async () => {
        // Lever records what it received as priorAttempts each call.
        const recordedPriorAttempts: AttemptRecord[][] = [];
        let callIdx = 0;
        registerLever({
            name: "reverb",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses(_caseDesc, priorAttempts) {
                recordedPriorAttempts.push([...priorAttempts]);
                const h = stubHypothesis("reverb");
                // Tag mechanism so we can verify it propagates.
                h.mechanism =
                    callIdx === 0
                        ? "widen-identity"
                        : "add-important-line";
                callIdx++;
                return [h];
            },
            async applyToSandbox() {
                return { filesWritten: [] };
            },
        });
        await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 1,
            runProbe: async () => ({
                rescues: 0,
                regressions: 1,
                regressionPhrases: ["bad phrase"],
            }),
            revertSandbox: () => {},
        });
        // Two rounds. Depth 0: priorAttempts empty. Depth 1: priorAttempts
        // contains the depth-0 attempt with mechanism="widen-identity".
        expect(recordedPriorAttempts).toHaveLength(2);
        expect(recordedPriorAttempts[0]).toHaveLength(0);
        expect(recordedPriorAttempts[1]).toHaveLength(1);
        expect(recordedPriorAttempts[1]![0]!.hypothesis.mechanism).toBe(
            "widen-identity",
        );
        expect(
            recordedPriorAttempts[1]![0]!.evaluation.regressions,
        ).toBe(1);
        expect(
            recordedPriorAttempts[1]![0]!.evaluation.regressionPhrases,
        ).toEqual(["bad phrase"]);
    });

    it("persists priorAttempts summary in depth-N proposal.json", async () => {
        let callIdx = 0;
        registerLever({
            name: "reverb",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                const h = stubHypothesis("reverb");
                h.mechanism =
                    callIdx === 0 ? "widen-identity" : "add-positive-example";
                callIdx++;
                return [h];
            },
            async applyToSandbox() {
                return { filesWritten: [] };
            },
        });
        await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 1,
            runProbe: async () => ({
                rescues: 0,
                regressions: 1,
                regressionPhrases: ["bad"],
            }),
            revertSandbox: () => {},
        });
        const attemptDirs = fs
            .readdirSync(path.join(dir, "attempts"))
            .sort();
        // 2 attempts: h01-reverb (depth 0) and h02-reverb-r1 (depth 1).
        expect(attemptDirs).toHaveLength(2);
        const depth0 = JSON.parse(
            fs.readFileSync(
                path.join(dir, "attempts", attemptDirs[0]!, "proposal.json"),
                "utf-8",
            ),
        );
        const depth1 = JSON.parse(
            fs.readFileSync(
                path.join(dir, "attempts", attemptDirs[1]!, "proposal.json"),
                "utf-8",
            ),
        );
        expect(depth0.priorAttempts).toBeUndefined();
        expect(depth1.priorAttempts).toBeDefined();
        expect(depth1.priorAttempts).toHaveLength(1);
        expect(depth1.priorAttempts[0].mechanism).toBe("widen-identity");
        expect(depth1.priorAttempts[0].regressions).toBe(1);
        expect(depth1.priorAttempts[0].regressionPhrases).toEqual(["bad"]);
        // depth-1 attempt has its own mechanism set, distinct from prior.
        expect(depth1.mechanism).toBe("add-positive-example");
        expect(depth1.depth).toBe(1);
    });

    it("breaks out of recursion as soon as a positive-score round appears", async () => {
        let callCount = 0;
        registerLever({
            name: "reverb",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [stubHypothesis("reverb")];
            },
            async applyToSandbox() {
                return { filesWritten: [] };
            },
        });
        const runProbe = async () => {
            callCount++;
            return {
                rescues: callCount >= 2 ? 1 : 0,
                regressions: 0,
                regressionPhrases: [] as string[],
            };
        };
        const result = await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 5,
            runProbe,
            revertSandbox: () => {},
        });
        // Two rounds: depth-0 (score 0, recurse), depth-1 (score 1, win).
        expect(result.attempts).toHaveLength(2);
        expect(result.winner).not.toBeNull();
        expect(result.winner!.hypothesis.depth).toBe(1);
    });

    it("calls revertSandbox before every apply", async () => {
        const trace: string[] = [];
        const lever: LeverPlugin = {
            name: "reverb",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                return [
                    stubHypothesis("reverb", "01"),
                    stubHypothesis("reverb", "02"),
                ];
            },
            async applyToSandbox() {
                trace.push("apply");
                return { filesWritten: [] };
            },
        };
        registerLever(lever);
        await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 0,
            runProbe: async () => ({
                rescues: 0,
                regressions: 0,
                regressionPhrases: [],
            }),
            revertSandbox: () => {
                trace.push("revert");
            },
        });
        // 2 hypotheses → revert/apply/revert/apply
        expect(trace).toEqual(["revert", "apply", "revert", "apply"]);
    });

    it("dry-run writes scaffolding for every lever without LLM or apply", async () => {
        let leverCalls = 0;
        const lever: LeverPlugin = {
            name: "reverb",
            description: "stub",
            consumes: ["neighborhoods"],
            probeType: "translator",
            async proposeHypotheses() {
                leverCalls++;
                return [stubHypothesis("reverb")];
            },
            async applyToSandbox() {
                leverCalls++;
                return { filesWritten: [] };
            },
        };
        registerLever(lever);
        const result = await runCaseLoop({
            caseDesc: STUB_CASE,
            caseDir: dir,
            buildProposeCtx: () => STUB_PROPOSE_CTX,
            buildApplyCtx: () => STUB_APPLY_CTX,
            maxDepth: 0,
            runProbe: async () => {
                throw new Error("probe should not be called in dry-run");
            },
            revertSandbox: () => {
                throw new Error("revert should not be called in dry-run");
            },
            dryRun: true,
        });
        expect(leverCalls).toBe(0);
        // One placeholder attempt per registered lever.
        expect(result.attempts).toHaveLength(1);
        const attemptDirs = fs.readdirSync(path.join(dir, "attempts"));
        expect(attemptDirs).toHaveLength(1);
        const adir = path.join(dir, "attempts", attemptDirs[0]!);
        const proposal = JSON.parse(
            fs.readFileSync(path.join(adir, "proposal.json"), "utf-8"),
        );
        expect(proposal.dryRun).toBe(true);
    });
});
