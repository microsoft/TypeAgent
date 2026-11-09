// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { macroProtocolVersion } from "./macro-eval-plan.mjs";

function median(values) {
    if (!values.length) return null;
    const ordered = [...values].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
        ? ordered[middle]
        : (ordered[middle - 1] + ordered[middle]) / 2;
}

function measuredCorrect(row) {
    return (
        row.grade?.status === "passed" &&
        row.grade.taskCorrect === true &&
        Number.isFinite(row.timing?.elapsedMs) &&
        row.timing.elapsedMs >= 0
    );
}

function validateRows(plan, rows) {
    if (plan.protocolVersion !== macroProtocolVersion)
        throw new Error("Cannot relabel or combine macro evaluation protocols");
    if (!Array.isArray(plan.schedule) || !Array.isArray(rows))
        throw new Error("An explicit schedule and result array are required");
    const expected = new Map(plan.schedule.map((item) => [item.trialId, item]));
    if (expected.size !== plan.schedule.length)
        throw new Error("The campaign schedule contains duplicate trial IDs");
    const observed = new Set();
    for (const row of rows) {
        const scheduled = expected.get(row.trialId);
        if (!scheduled || observed.has(row.trialId))
            throw new Error(`Unknown or duplicate trial: ${row.trialId}`);
        if (
            row.condition !== scheduled.condition ||
            row.scenarioId !== scheduled.scenarioId ||
            row.familyId !== scheduled.familyId ||
            row.repetition !== scheduled.repetition ||
            row.pairId !== scheduled.pairId ||
            row.timing?.boundary !== plan.timingBoundary
        )
            throw new Error(`Trial identity/timing mismatch: ${row.trialId}`);
        if (plan.corpusHash && row.corpusHash !== plan.corpusHash)
            throw new Error(`Corpus/oracle hash mismatch: ${row.trialId}`);
        if (
            !["passed", "failed", "blocked", "harness-invalid"].includes(
                row.grade?.status,
            )
        )
            throw new Error(`Missing explicit verdict: ${row.trialId}`);
        observed.add(row.trialId);
    }
    return expected.size - observed.size;
}

function pairedMeasurements(rows) {
    const pairs = new Map();
    for (const row of rows) {
        if (!row.pairId) continue;
        const pair = pairs.get(row.pairId) ?? {};
        pair[row.condition] = row;
        pairs.set(row.pairId, pair);
    }
    return [...pairs.values()]
        .filter(
            (pair) =>
                pair.baseline &&
                pair.reuse &&
                measuredCorrect(pair.baseline) &&
                measuredCorrect(pair.reuse) &&
                pair.reuse.grade.grammarHit === true,
        )
        .map((pair) => ({
            baselineMs: pair.baseline.timing.elapsedMs,
            reuseMs: pair.reuse.timing.elapsedMs,
            savingsMs:
                pair.baseline.timing.elapsedMs - pair.reuse.timing.elapsedMs,
            ratio:
                pair.baseline.timing.elapsedMs > 0
                    ? pair.reuse.timing.elapsedMs /
                      pair.baseline.timing.elapsedMs
                    : null,
        }));
}

export function summarizeCampaign(plan, rows, preparation = null) {
    const missing = validateRows(plan, rows);
    const pairs = pairedMeasurements(rows);
    const savingsMs = median(pairs.map((pair) => pair.savingsMs));
    const preparationMs = preparation?.elapsedMs;
    const breakEvenKnown = Number.isFinite(preparationMs) && preparationMs >= 0;
    const breakEven =
        savingsMs === null
            ? { status: "unknown", reuseCount: null }
            : savingsMs <= 0
              ? { status: "no-observed-break-even", reuseCount: null }
              : !breakEvenKnown
                ? { status: "unknown", reuseCount: null }
                : {
                      status: "observed-estimate",
                      reuseCount: Math.ceil(preparationMs / savingsMs),
                  };
    return {
        protocolVersion: plan.protocolVersion,
        mode: plan.mode,
        planned: plan.schedule.length,
        observed: rows.length,
        missing,
        complete: missing === 0,
        outcomes: Object.fromEntries(
            ["passed", "failed", "blocked", "harness-invalid"].map((status) => [
                status,
                rows.filter((row) => row.grade.status === status).length,
            ]),
        ),
        grammar: {
            hits: rows.filter((row) => row.grade.grammarHit === true).length,
            misses: rows.filter((row) => row.grade.grammarHit === false).length,
            unknown: rows.filter((row) => row.grade.grammarHit == null).length,
        },
        explicitMcp: {
            reuse: rows.filter((row) => row.grade.explicitMcpReuse === true)
                .length,
            note: "Explicit MCP reuse is not a grammar hit or a matched grammar performance pair.",
        },
        performance: {
            matchedCorrectGrammarPairs: pairs.length,
            medianBaselineMs: median(pairs.map((pair) => pair.baselineMs)),
            medianReuseMs: median(pairs.map((pair) => pair.reuseMs)),
            medianPairedRatio: median(
                pairs
                    .map((pair) => pair.ratio)
                    .filter((value) => value !== null),
            ),
            medianPairedSavingsMs: savingsMs,
            timingBoundary: plan.timingBoundary,
            breakEven,
            scope: "Fixed-artifact observations; not independent capture reliability.",
        },
        preparation,
        usage: {
            rootModelTokens: null,
            authorModelTokens: null,
            verifierModelTokens: null,
            semanticModelTokens: null,
            serviceModelTokens: null,
            costSavings: null,
            status: "unknown-until-complete-provider-accounting",
        },
    };
}
