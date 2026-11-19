// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { arms, families } from "./wiki-schema-contract.mjs";

function timings(rows) {
    const sorted = rows.map((row) => row.durationMs).sort((a, b) => a - b);
    if (!sorted.length) return { count: 0, medianMs: null, p95Ms: null };
    const middle = Math.floor(sorted.length / 2);
    return {
        count: sorted.length,
        medianMs:
            sorted.length % 2
                ? sorted[middle]
                : (sorted[middle - 1] + sorted[middle]) / 2,
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
}

function observedMetadata(rows) {
    const models = {},
        usage = {};
    for (const row of rows) {
        const model =
            row.result?.reportedModel ??
            row.result?.nativeReceipt?.reportedModel;
        const name = model ?? "unavailable";
        models[name] = (models[name] ?? 0) + 1;
        const reported =
            row.result?.usage ??
            row.result?.nativeReceipt?.decisionUsage ??
            row.result?.nativeReceipt?.usage;
        for (const [field, value] of Object.entries(reported ?? {})) {
            if (typeof value !== "number" || !Number.isFinite(value)) continue;
            usage[field] ??= { sum: 0, reportingCalls: 0 };
            usage[field].sum += value;
            usage[field].reportingCalls++;
        }
    }
    return {
        reportedModels: models,
        reportedUsage: usage,
        cost: null,
        costStatus: "No pricing supplied; missing usage is not zero.",
    };
}

function distributionDifferences(left, right) {
    const probabilities = [],
        confidences = [];
    for (const [id, a] of Object.entries(left.payload?.answers ?? {})) {
        const b = right.payload?.answers?.[id];
        if (!a.probabilities || !b?.probabilities) continue;
        for (const [key, probability] of Object.entries(a.probabilities))
            probabilities.push(Math.abs(probability - b.probabilities[key]));
        if (
            typeof a.confidence === "number" &&
            typeof b.confidence === "number"
        )
            confidences.push(Math.abs(a.confidence - b.confidence));
    }
    return { probabilities, confidences };
}

function pairScore(rows, left, right, packets) {
    const groups = new Map();
    for (const row of rows) {
        const key = JSON.stringify([row.phase, row.id, row.repetition]);
        if (!groups.has(key)) groups.set(key, {});
        groups.get(key)[row.arm] = row;
    }
    const score = {
        attemptedPairs: 0,
        validPairs: 0,
        attemptedQuestions: 0,
        validQuestions: 0,
        agreements: 0,
        transitions: {},
    };
    const ratios = [],
        allRatios = [];
    const probabilityDifferences = [],
        confidenceDifferences = [];
    for (const group of groups.values()) {
        const a = group[left],
            b = group[right];
        if (!a || !b) continue;
        score.attemptedPairs++;
        if (a.durationMs > 0)
            allRatios.push({ durationMs: b.durationMs / a.durationMs });
        const questions = Object.keys(
            JSON.parse(packets.get(a.id).requestJson).questions,
        );
        score.attemptedQuestions += questions.length;
        if (a.status !== "valid" || b.status !== "valid") continue;
        score.validPairs++;
        score.validQuestions += questions.length;
        const differences = distributionDifferences(a, b);
        probabilityDifferences.push(...differences.probabilities);
        confidenceDifferences.push(...differences.confidences);
        if (a.durationMs > 0)
            ratios.push({ durationMs: b.durationMs / a.durationMs });
        for (const id of questions) {
            if (a.choices[id] === b.choices[id]) score.agreements++;
            const transition = JSON.stringify([a.choices[id], b.choices[id]]);
            score.transitions[transition] =
                (score.transitions[transition] ?? 0) + 1;
        }
    }
    return {
        ...score,
        allAttemptLatencyRatio: timings(allRatios).medianMs,
        validPairLatencyRatio: timings(ratios).medianMs,
        meanAbsoluteProbabilityDifference: probabilityDifferences.length
            ? probabilityDifferences.reduce((sum, value) => sum + value, 0) /
              probabilityDifferences.length
            : null,
        meanAbsoluteConfidenceDifference: confidenceDifferences.length
            ? confidenceDifferences.reduce((sum, value) => sum + value, 0) /
              confidenceDifferences.length
            : null,
        scoreInterpretation:
            "Descriptive only: native reported scores and generated self-reports are not calibrated or interchangeable.",
    };
}

function repeatability(rows, arm) {
    const groups = new Map();
    for (const row of rows.filter(
        (r) => r.arm === arm && r.phase !== "preflight",
    )) {
        const key = JSON.stringify([row.phase, row.id]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    let stable = 0,
        completeValid = 0;
    for (const group of groups.values()) {
        if (group.length !== 3 || group.some((row) => row.status !== "valid"))
            continue;
        completeValid++;
        const serialized = (row) =>
            JSON.stringify(Object.entries(row.choices).sort());
        if (group.every((row) => serialized(row) === serialized(group[0])))
            stable++;
    }
    return {
        attemptedPackets: groups.size,
        completeValidPackets: completeValid,
        stablePackets: stable,
    };
}

export function scorecard(inventory, protocol, rows) {
    const packets = new Map(
        inventory.packets.map((packet) => [packet.id, packet]),
    );
    const scored = rows.filter((row) => row.phase !== "preflight");
    const panels = Object.fromEntries(
        ["all", ...families].map((family) => {
            const selected = scored.filter(
                (row) =>
                    family === "all" || packets.get(row.id).family === family,
            );
            return [
                family,
                {
                    arms: Object.fromEntries(
                        arms.map((arm) => {
                            const attempts = selected.filter(
                                (row) => row.arm === arm,
                            );
                            const valid = attempts.filter(
                                (row) => row.status === "valid",
                            );
                            const labels = [];
                            for (const row of valid)
                                for (const [id, label] of Object.entries(
                                    packets.get(row.id).labels ?? {},
                                ))
                                    labels.push({
                                        packetId: row.id,
                                        questionId: id,
                                        phase: row.phase,
                                        repetition: row.repetition,
                                        kind: label.kind,
                                        provenance: label.provenance,
                                        critical: label.critical,
                                        matches:
                                            row.choices[id] === label.choice,
                                    });
                            return [
                                arm,
                                {
                                    attemptedPackets: attempts.length,
                                    validPackets: valid.length,
                                    jsonValidPackets: attempts.filter(
                                        (row) => row.validation?.jsonValid,
                                    ).length,
                                    schemaValidPackets: attempts.filter(
                                        (row) => row.validation?.schemaValid,
                                    ).length,
                                    nativeContractValidPackets:
                                        arm === "luna-choice"
                                            ? null
                                            : attempts.filter(
                                                  (row) =>
                                                      row.validation
                                                          ?.nativeContractValid,
                                              ).length,
                                    attemptedQuestions: attempts.reduce(
                                        (n, row) =>
                                            n +
                                            Object.keys(
                                                JSON.parse(
                                                    packets.get(row.id)
                                                        .requestJson,
                                                ).questions,
                                            ).length,
                                        0,
                                    ),
                                    validQuestions: valid.reduce(
                                        (n, row) =>
                                            n + Object.keys(row.choices).length,
                                        0,
                                    ),
                                    failures: attempts
                                        .filter((row) => row.status !== "valid")
                                        .map(
                                            ({
                                                id,
                                                phase,
                                                repetition,
                                                status,
                                                failureStage,
                                            }) => ({
                                                id,
                                                phase,
                                                repetition,
                                                status,
                                                failureStage,
                                            }),
                                        ),
                                    allAttemptTiming: timings(attempts),
                                    validTiming: timings(valid),
                                    observedMetadata:
                                        observedMetadata(attempts),
                                    repeatability: repeatability(selected, arm),
                                    labelComparisons: labels,
                                },
                            ];
                        }),
                    ),
                    nativeVsFull: pairScore(
                        selected,
                        "native",
                        "luna-full",
                        packets,
                    ),
                    schemaOnly: pairScore(
                        selected,
                        "luna-choice",
                        "luna-full",
                        packets,
                    ),
                },
            ];
        }),
    );
    const required =
        (protocol.pilot.length + protocol.confirmation.length) *
        3 *
        arms.length;
    return {
        state:
            scored.length === required ? "diagnostic-complete" : "incomplete",
        plannedScoredCalls: required,
        completedScoredCalls: scored.length,
        preflightCalls: rows.length - scored.length,
        panels,
        confirmationKind: protocol.confirmationKind,
        hostConsequences: {
            state: "unavailable",
            reason: "Original experimental reducers and saved host context are not supplied by this runner.",
        },
        candidateQualified: false,
        productionActivated: false,
        interpretation:
            "Agreement is not correctness; model-review labels are not human gold. Timings are component calls, not Wiki readiness. No population confidence interval is inferred from this small clustered panel.",
    };
}
