// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Per-case orchestrator. Analyze the case (or accept an already-analyzed
// CaseDescription from the corpus loop), generate K hypotheses per lever,
// evaluate each, rank, and pick a winner. At depth > 0 (Phase 8), pass
// prior attempts back into generate so the LLM can vary its mechanism.
//
// Phase 3 ships depth-0 only — `--depth 0` is the default. Phase 8 raises
// the default to 2 and wires the recursion loop. The recursion shape is
// already sketched here (the loop body exits after one pass at depth 0).
//
// `runProbe` is injected so the corpus loop can wire it to a real
// translator-probe-against-sandbox call, and tests can pass a stub.

import * as fs from "node:fs";
import * as path from "node:path";

import type {
    AttemptRecord,
    CaseDescription,
    CaseResult,
    Hypothesis,
} from "./types.js";
import type { ApplyContext, ProposeContext } from "./registry.js";
import {
    evaluateHypothesis,
    type DiffPayload,
} from "./hypothesisEvaluator.js";
import { generateHypotheses } from "./hypothesisGenerator.js";
import { getLever } from "./registry.js";
import { ensureDir } from "./util.js";

export interface CaseLoopOpts {
    /** A fully-populated CaseDescription. The corpus loop produces this
     *  via caseAnalyzer before calling. */
    caseDesc: CaseDescription;
    /** Directory for this case's outputs:
     *  `<runDir>/cases/case-NNN-<schema.action>/`. */
    caseDir: string;
    /** Per-lever ProposeContext factory. Different attempts may want
     *  different `outDir`s; the case loop calls this once per hypothesis. */
    buildProposeCtx: (caseDir: string) => ProposeContext;
    /** Per-lever ApplyContext factory. The case loop calls this once per
     *  hypothesis, passing the resolved sandbox dir and checksum map. */
    buildApplyCtx: (caseDesc: CaseDescription) => ApplyContext;
    /** Lever-name filter. Forwarded to `generateHypotheses`. */
    leverFilter?: string[];
    /** Maximum recursion depth. Phase 3 default: 0 (one round only).
     *  Phase 8 raises default to 2. */
    maxDepth: number;
    /** Per-attempt probe runner. Called AFTER apply has written sandbox
     *  edits. Returns the rescue/regression counts vs. baseline. */
    runProbe: (
        hypothesis: Hypothesis,
        caseDesc: CaseDescription,
    ) => Promise<DiffPayload>;
    /** Per-attempt sandbox revert. Called BEFORE apply so each attempt
     *  starts from the snapshot. The case loop wires this to
     *  `revertSandboxFromOriginal(<schemaName>, sandboxDir)` for every
     *  member schema. */
    revertSandbox: () => void;
    /** Dry-run mode: write proposal/evaluation scaffolding per lever but
     *  skip LLM generation, apply, and probe. */
    dryRun?: boolean;
}

/**
 * Run one case to completion. Writes `case.json`, then per-attempt
 * proposal/evaluation, then `winner.json`. Returns the `CaseResult` shape
 * the corpus loop indexes.
 */
export async function runCaseLoop(opts: CaseLoopOpts): Promise<CaseResult> {
    ensureDir(opts.caseDir);
    // Persist the case description so the attempts archive is
    // self-contained on disk.
    fs.writeFileSync(
        path.join(opts.caseDir, "case.json"),
        JSON.stringify(opts.caseDesc, undefined, 2),
    );

    const attempts: AttemptRecord[] = [];
    const attemptsDir = path.join(opts.caseDir, "attempts");
    ensureDir(attemptsDir);

    if (opts.dryRun) {
        const dryAttempts = await writeDryRunScaffolding(
            opts.caseDesc,
            attemptsDir,
            opts.leverFilter,
        );
        attempts.push(...dryAttempts);
    } else {
        let depth = 0;
        let priorAttempts: AttemptRecord[] = [];
        let idOffset = 0;
        while (true) {
            const proposeCtx = opts.buildProposeCtx(opts.caseDir);
            const hypotheses = await generateHypotheses({
                caseDesc: opts.caseDesc,
                priorAttempts,
                ...(opts.leverFilter && { leverFilter: opts.leverFilter }),
                ctx: proposeCtx,
                idOffset,
            });

            // At depth N > 0, the case loop appends `-rN` to each id so
            // attempt dirs don't clash with depth-0 attempts.
            const depthSuffix = depth === 0 ? "" : `-r${depth}`;

            const roundAttempts: AttemptRecord[] = [];
            for (const hypothesis of hypotheses) {
                const finalId = `${hypothesis.id}${depthSuffix}`;
                const attemptDir = path.join(attemptsDir, finalId);
                const lever = getLever(hypothesis.lever);
                if (!lever) {
                    // Lever was unregistered between propose and evaluate.
                    // Should not happen in practice; fail loud.
                    throw new Error(
                        `Lever '${hypothesis.lever}' not registered at evaluation time.`,
                    );
                }
                const fixedHypothesis: Hypothesis = {
                    ...hypothesis,
                    id: finalId,
                    depth,
                };
                const attempt = await evaluateHypothesis({
                    hypothesis: fixedHypothesis,
                    caseDesc: opts.caseDesc,
                    attemptDir,
                    lever,
                    applyCtx: opts.buildApplyCtx(opts.caseDesc),
                    runProbe: opts.runProbe,
                    revertSandbox: opts.revertSandbox,
                    ...(depth > 0 && { priorAttempts }),
                });
                roundAttempts.push(attempt);
            }
            attempts.push(...roundAttempts);

            const bestThisRound = rankAttempts(roundAttempts)[0];
            const bestScore = bestThisRound
                ? bestThisRound.evaluation.score
                : -Infinity;
            if (bestScore > 0) break;
            if (depth >= opts.maxDepth) break;
            // Recurse: feed this round's attempts back in to vary
            // mechanisms.
            priorAttempts = roundAttempts;
            idOffset += roundAttempts.length;
            depth++;
        }
    }

    const ranked = rankAttempts(attempts);
    const winner = pickWinner(ranked);

    fs.writeFileSync(
        path.join(opts.caseDir, "winner.json"),
        JSON.stringify(
            winner ?? {
                attemptId: null,
                score: null,
                rationale:
                    "no positive-score hypothesis found within depth budget",
            },
            undefined,
            2,
        ),
    );

    return {
        case: opts.caseDesc,
        attempts,
        winner,
    };
}

/**
 * Rank attempts by score desc, tie-breaking on smaller regression set,
 * then on lexically-earlier hypothesis id (for stability). Exported for
 * unit tests. Returns a new array; does not mutate.
 */
export function rankAttempts(attempts: AttemptRecord[]): AttemptRecord[] {
    return [...attempts].sort((a, b) => {
        if (b.evaluation.score !== a.evaluation.score) {
            return b.evaluation.score - a.evaluation.score;
        }
        if (a.evaluation.regressions !== b.evaluation.regressions) {
            return a.evaluation.regressions - b.evaluation.regressions;
        }
        return a.hypothesis.id.localeCompare(b.hypothesis.id);
    });
}

function pickWinner(ranked: AttemptRecord[]): AttemptRecord | null {
    const top = ranked[0];
    if (!top) return null;
    // Per plan: winner only if score > 0. Score 0 means no net change —
    // not worth surfacing as a winner.
    if (top.evaluation.score <= 0) return null;
    return top;
}

/**
 * Write dry-run scaffolding. One placeholder attempt per registered (or
 * filtered) lever, with `proposal.json` marked `dryRun: true` and a
 * zero-score `evaluation.json`. No LLM calls, no apply, no probe.
 */
async function writeDryRunScaffolding(
    caseDesc: CaseDescription,
    attemptsDir: string,
    leverFilter: string[] | undefined,
): Promise<AttemptRecord[]> {
    const { selectLevers } = await import("./hypothesisGenerator.js");
    const levers = selectLevers(leverFilter);
    const out: AttemptRecord[] = [];
    for (let i = 0; i < levers.length; i++) {
        const lever = levers[i]!;
        const id = `h${String(i + 1).padStart(2, "0")}-${lever.name}-dryrun`;
        const attemptDir = path.join(attemptsDir, id);
        ensureDir(attemptDir);
        const proposal = {
            schemaVersion: 1,
            id,
            lever: lever.name,
            depth: 0,
            dryRun: true,
            rationale: { free: "dry-run scaffolding" },
            mechanism: "other",
            guidelineHook: null,
            diffSummary: {
                addedLines: 0,
                removedLines: 0,
                touchesIdentityLine: false,
                addsAntiExample: false,
            },
            payload: null,
        };
        fs.writeFileSync(
            path.join(attemptDir, "proposal.json"),
            JSON.stringify(proposal, undefined, 2),
        );
        const evaluation = {
            schemaVersion: 1,
            probeType: "translator" as const,
            rescues: 0,
            regressions: 0,
            netDelta: 0,
            score: 0,
            regressionPhrases: [] as string[],
            dryRun: true,
        };
        fs.writeFileSync(
            path.join(attemptDir, "evaluation.json"),
            JSON.stringify(evaluation, undefined, 2),
        );
        out.push({
            hypothesis: {
                id,
                lever: lever.name,
                depth: 0,
                rationale: { free: "dry-run scaffolding" },
                mechanism: "other",
                guidelineHook: null,
                diffSummary: {
                    addedLines: 0,
                    removedLines: 0,
                    touchesIdentityLine: false,
                    addsAntiExample: false,
                },
                payload: null,
            },
            evaluation: {
                schemaVersion: 1,
                probeType: "translator",
                rescues: 0,
                regressions: 0,
                netDelta: 0,
                score: 0,
                regressionPhrases: [],
            },
            artifactPath: attemptDir,
        });
    }
    // Silence unused arg lint when typing matures.
    void caseDesc;
    return out;
}
