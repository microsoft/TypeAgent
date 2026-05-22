// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Per-attempt evaluation. The case loop:
//   1. Builds the attempt dir.
//   2. Writes `proposal.json` IMMEDIATELY (before the probe). A crash
//      between propose and probe still leaves a trace of what was tried.
//   3. Reverts sandbox to .original/.
//   4. Calls `lever.applyToSandbox(hypothesis, ctx)`.
//   5. Runs the translator probe scoped to this neighborhood's phrases
//      (bidirectional filter).
//   6. Compares probe results to baseline → scores → writes
//      `evaluation.json`.
//
// Phase 2 lands the scoring math, proposal/evaluation writers, and the
// orchestration shape with the probe step injectable. Phase 3 wires the
// real translator probe through `sandboxTranslate`.

import * as fs from "node:fs";
import * as path from "node:path";

import type {
    AttemptRecord,
    CaseDescription,
    EvaluationResult,
    Hypothesis,
} from "./types.js";
import type { LeverPlugin, ApplyContext } from "./registry.js";
import { ensureDir } from "./util.js";

/**
 * Outcome of a per-attempt probe vs. baseline diff. Produced by callers
 * that run the translator probe and compare; consumed by `scoreFromDiff`.
 */
export interface DiffPayload {
    /** Phrases where the baseline routed wrong but the candidate routed
     *  right. */
    rescues: number;
    /** Phrases where the baseline routed right but the candidate routed
     *  wrong. */
    regressions: number;
    /** The actual phrase texts that regressed — fed to recursive
     *  refinement at depth > 0. */
    regressionPhrases: string[];
}

/**
 * Pure scoring math. Score = rescues - regressions (phrase-count
 * weighted — currently 1:1; weighting hooks land in Phase 3+). Tie-break
 * by smaller regression set is handled by the case loop ranker, not here.
 */
export function scoreFromDiff(diff: DiffPayload): EvaluationResult {
    const netDelta = diff.rescues - diff.regressions;
    return {
        schemaVersion: 1,
        probeType: "translator",
        rescues: diff.rescues,
        regressions: diff.regressions,
        netDelta,
        score: netDelta,
        regressionPhrases: diff.regressionPhrases,
    };
}

/** Write `proposal.json` to the attempt directory. Called BEFORE the
 *  probe so a crash leaves a trace. When `priorAttempts` is supplied
 *  (depth > 0 retries), a summary is included so the artifact records
 *  what the LLM was told to avoid. */
export function writeProposal(
    attemptDir: string,
    hypothesis: Hypothesis,
    priorAttempts?: AttemptRecord[],
): void {
    ensureDir(attemptDir);
    const payload: Record<string, unknown> = {
        schemaVersion: 1,
        ...hypothesis,
    };
    if (priorAttempts && priorAttempts.length > 0) {
        payload.priorAttempts = priorAttempts.map((a) => ({
            id: a.hypothesis.id,
            lever: a.hypothesis.lever,
            depth: a.hypothesis.depth,
            mechanism: a.hypothesis.mechanism,
            guidelineHook: a.hypothesis.guidelineHook,
            rescues: a.evaluation.rescues,
            regressions: a.evaluation.regressions,
            score: a.evaluation.score,
            regressionPhrases: a.evaluation.regressionPhrases,
        }));
    }
    fs.writeFileSync(
        path.join(attemptDir, "proposal.json"),
        JSON.stringify(payload, undefined, 2),
    );
}

/** Write `evaluation.json` to the attempt directory. Called AFTER the
 *  probe; the directory must already exist from `writeProposal`. */
export function writeEvaluation(
    attemptDir: string,
    evaluation: EvaluationResult,
): void {
    ensureDir(attemptDir);
    fs.writeFileSync(
        path.join(attemptDir, "evaluation.json"),
        JSON.stringify(evaluation, undefined, 2),
    );
}

// =============================================================================
// Orchestration
// =============================================================================

export interface EvaluateHypothesisOpts {
    hypothesis: Hypothesis;
    caseDesc: CaseDescription;
    attemptDir: string;
    lever: LeverPlugin;
    applyCtx: ApplyContext;
    /** Injects the actual probe run. The case loop wires this to a real
     *  translator-probe-against-sandbox call; tests pass a stub that
     *  returns canned counts. The function is called AFTER apply has
     *  written sandbox edits. */
    runProbe: (
        hypothesis: Hypothesis,
        caseDesc: CaseDescription,
    ) => Promise<DiffPayload>;
    /** Called before apply so the case loop can revert the sandbox to
     *  .original/. Omitted by tests that don't exercise sandbox state. */
    revertSandbox?: (hypothesis: Hypothesis) => void;
    /** At depth > 0, the prior round's attempts. Written into
     *  proposal.json so the archive records what the LLM was told to
     *  avoid. */
    priorAttempts?: AttemptRecord[];
}

/** Full per-attempt pipeline: writeProposal → revert → apply → probe →
 *  writeEvaluation. Returns an `AttemptRecord`.
 *
 *  Apply failures (e.g. a lever targeting a schema whose checksum
 *  couldn't be computed) are caught here and recorded as a zero-rescue
 *  attempt with an `applyError` field on `evaluation.json`. The case
 *  loop continues with the next hypothesis. Without this catch, a
 *  single bad hypothesis crashes the whole run — and the operator
 *  loses all the prior LLM work. */
export async function evaluateHypothesis(
    opts: EvaluateHypothesisOpts,
): Promise<AttemptRecord> {
    writeProposal(opts.attemptDir, opts.hypothesis, opts.priorAttempts);

    opts.revertSandbox?.(opts.hypothesis);

    try {
        await opts.lever.applyToSandbox(opts.hypothesis, opts.applyCtx);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const evaluation: EvaluationResult = {
            schemaVersion: 1,
            probeType: "translator",
            rescues: 0,
            regressions: 0,
            netDelta: 0,
            score: 0,
            regressionPhrases: [],
        };
        // Augment the on-disk evaluation with the apply error so the
        // archive captures why this attempt produced no signal.
        ensureDir(opts.attemptDir);
        fs.writeFileSync(
            path.join(opts.attemptDir, "evaluation.json"),
            JSON.stringify(
                { ...evaluation, applyError: message },
                undefined,
                2,
            ),
        );
        return {
            hypothesis: opts.hypothesis,
            evaluation,
            artifactPath: opts.attemptDir,
        };
    }

    const diff = await opts.runProbe(opts.hypothesis, opts.caseDesc);
    const evaluation = scoreFromDiff(diff);
    writeEvaluation(opts.attemptDir, evaluation);

    return {
        hypothesis: opts.hypothesis,
        evaluation,
        artifactPath: opts.attemptDir,
    };
}
