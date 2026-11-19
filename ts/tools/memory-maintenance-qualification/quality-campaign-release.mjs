// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { check, hash, identity, text, unique } from "./quality-contract.mjs";
import { clusteredMeanInterval } from "./quality-artifacts.mjs";
import {
    independentReview,
    scoreCampaignMeasurements,
} from "./quality-campaign-measurements.mjs";
import { validateRequestCapture } from "./quality-request-capture.mjs";

const clusterKinds = ["source", "topic", "project", "meeting"];
const retainedProtections = [
    "allSuppliedCitationIds",
    "finalFactualRejection",
    "publicationProof",
    "legacyServing",
    "acceptedRevisionSurvivesFailure",
];

export function validateSplitIsolation(registry) {
    check(
        registry?.contract === "memory-view-split-registry-v1",
        "Split registry required",
    );
    const seen = new Map();
    for (const phase of ["development", "confirmation"]) {
        const entries = unique(registry[phase], "id", `${phase} split`);
        check(entries.size > 0, "Both split inventories required");
        for (const entry of entries.values()) {
            const identities = [`case:${entry.id}`];
            check(
                Array.isArray(entry.sourceHashes) &&
                    entry.sourceHashes.length > 0,
                "Source content hashes required",
            );
            for (const value of entry.sourceHashes)
                identities.push(`content:${hash(value, "source content")}`);
            for (const kind of clusterKinds) {
                check(
                    Array.isArray(entry.clusters?.[kind]),
                    "Complete split clustering required",
                );
                for (const value of entry.clusters[kind])
                    identities.push(
                        `${kind}:${text(value, "cluster identity")}`,
                    );
            }
            for (const key of identities) {
                check(
                    !seen.has(key) || seen.get(key) === phase,
                    `Cross-split leakage: ${key}`,
                );
                seen.set(key, phase);
            }
        }
    }
    return identity(registry);
}

function registrationChecks(registration, input, rubric, registry) {
    check(
        input.run.schemaVersion === 2,
        "Release comparison requires attempt-scoped campaign v2",
    );
    check(
        registration?.contract === "memory-view-release-v1" &&
            registration.status === "preregistered" &&
            registration.runHash === identity(input.run) &&
            registration.campaignHash === identity(input.campaign) &&
            registration.rubricHash === identity(rubric) &&
            registration.splitRegistryHash === validateSplitIsolation(registry),
        "Release preregistration identity mismatch",
    );
    text(registration.registeredBy, "registeredBy");
    check(
        Number.isFinite(registration.maxCostPerCall) &&
            registration.maxCostPerCall > 0,
        "Preregister the approved conservative per-call cost reservation",
    );
    check(
        Number.isFinite(Date.parse(registration.registeredAt)) &&
            Date.parse(registration.registeredAt) <=
                Date.parse(input.run.startedAt),
        "Release gates must be registered before execution",
    );
    const arms = new Map(input.run.arms.map((arm) => [arm.id, arm]));
    const baseline = arms.get(registration.baseline);
    const candidate = arms.get(registration.candidate);
    check(
        baseline && candidate && baseline.id !== candidate.id,
        "Distinct comparison arms required",
    );
    check(
        ["promptHash", "schemaHash", "configurationHash"].some(
            (key) => baseline[key] !== candidate[key],
        ),
        "Identical treatment/control identities cannot establish an improvement",
    );
    for (const key of [
        "providerSettingsHash",
        "indexHash",
        "eligibleSourcesHash",
        "provider",
        "model",
    ])
        check(baseline[key] === candidate[key], `Comparison changed ${key}`);
    const analysis = registration.analysis;
    check(
        clusterKinds.includes(analysis?.clusterKind),
        "Explicit independent cluster unit required",
    );
    check(
        Number.isSafeInteger(analysis.minClusters) && analysis.minClusters >= 2,
        "At least two independent clusters required",
    );
    clusteredMeanInterval([0], analysis);
    const gates = unique(registration.metrics, "metric", "registered metrics");
    check(gates.size > 0, "Registered measurement gates required");
    for (const key of [
        "supportedClaims",
        "selectedWeightedCoverage",
        "preservedWeightedCoverage",
    ])
        check(gates.has(key), `Preregister the ${key} gate`);
    for (const gate of gates.values()) {
        check(
            ["minimum", "maximum"].includes(gate.direction),
            "Metric gate direction required",
        );
        check(
            Number.isFinite(gate.threshold) &&
                gate.threshold >= 0 &&
                gate.threshold <= 1,
            "Metric threshold required",
        );
        check(
            Number.isFinite(gate.nonRegressionMargin) &&
                gate.nonRegressionMargin >= 0 &&
                gate.nonRegressionMargin <= 1,
            "Explicit non-regression margin required",
        );
    }
}

function comparisonClusters(input, analysis) {
    const groups = new Map();
    const membership = new Map();
    for (const caseId of input.run.caseIds) {
        const entry = input.campaign.inventory.find(
            (entry) => entry.id === caseId,
        );
        const ids = entry.clusters[analysis.clusterKind];
        check(
            ids.length === 1,
            "Each case must belong to exactly one registered analysis cluster",
        );
        membership.set(caseId, ids[0]);
        for (const kind of clusterKinds)
            for (const id of entry.clusters[kind]) {
                const key = JSON.stringify([kind, id]);
                check(
                    !groups.has(key) || groups.get(key) === ids[0],
                    "Overlapping source/topic/project/meeting clusters are not independent",
                );
                groups.set(key, ids[0]);
            }
        const bundle = input.packet.bundles.find(
            (bundle) => bundle.id === caseId,
        );
        for (const source of bundle.sources) {
            const key = `content:${source.sha256}`;
            check(
                !groups.has(key) || groups.get(key) === ids[0],
                "Identical source content crosses independent analysis clusters",
            );
            groups.set(key, ids[0]);
        }
    }
    return membership;
}

function compareMetric(details, registration, membership, gate) {
    const baseline = details.filter((row) => row.arm === registration.baseline);
    const candidates = new Map(
        details
            .filter((row) => row.arm === registration.candidate)
            .map((row) => [JSON.stringify([row.caseId, row.generation]), row]),
    );
    const clusters = new Map();
    let unknown = 0;
    for (const row of baseline) {
        const candidate = candidates.get(
            JSON.stringify([row.caseId, row.generation]),
        );
        check(candidate, "Missing comparison pair");
        const left = row.metrics[gate.metric];
        const right = candidate.metrics[gate.metric];
        check(left && right, "Unknown registered measurement metric");
        if (left.value === null || right.value === null) {
            unknown++;
            continue;
        }
        const id = membership.get(row.caseId);
        const values = clusters.get(id) ?? [];
        values.push({ baseline: left.value, candidate: right.value });
        clusters.set(id, values);
    }
    const means = [...clusters.values()].map((values) => ({
        baseline:
            values.reduce((n, value) => n + value.baseline, 0) / values.length,
        candidate:
            values.reduce((n, value) => n + value.candidate, 0) / values.length,
    }));
    if (!means.length)
        return {
            ...gate,
            passed: false,
            unknownPairs: unknown,
            clusters: 0,
            estimate: null,
        };
    const sign = gate.direction === "minimum" ? 1 : -1;
    const estimate = clusteredMeanInterval(
        means.map((value) => sign * (value.candidate - value.baseline)),
        registration.analysis,
    );
    const observed =
        means.reduce((n, value) => n + value.candidate, 0) / means.length;
    return {
        ...gate,
        observed,
        estimate,
        unknownPairs: unknown,
        clusters: means.length,
        passed:
            unknown === 0 &&
            means.length >= registration.analysis.minClusters &&
            estimate.interval !== null &&
            estimate.interval[0] >= -gate.nonRegressionMargin &&
            (gate.direction === "minimum"
                ? observed >= gate.threshold
                : observed <= gate.threshold),
    };
}

export function scoreCampaignUsefulness(
    input,
    baseline,
    candidate,
    blinded,
    review,
) {
    independentReview(review, identity(blinded));
    check(
        blinded?.contract === "memory-view-blinded-usefulness-v2" &&
            blinded.outputsHash === identity(input.outputs) &&
            blinded.armsHiddenFromReviewers === true,
        "Blinded artifact review binding required",
    );
    const assignments = unique(
        blinded.assignments,
        "id",
        "blinded assignments",
    );
    const judgments = unique(blinded.judgments, "id", "blinded judgments");
    const baselineRows = input.outputs.records.filter(
        (row) => row.arm === baseline,
    );
    check(
        assignments.size === baselineRows.length &&
            judgments.size === assignments.size,
        "Every scheduled pair requires blinded review",
    );
    const details = [];
    for (const left of baselineRows) {
        const right = input.outputs.records.find(
            (row) =>
                row.arm === candidate &&
                row.caseId === left.caseId &&
                row.generation === left.generation,
        );
        check(right, "Unpaired usefulness output");
        const id = JSON.stringify([left.caseId, left.generation]);
        const assignment = assignments.get(id);
        const judgment = judgments.get(id);
        check(assignment && judgment, "Missing usefulness pair");
        check(
            identity([assignment.first, assignment.second].sort()) ===
                identity(
                    [
                        left.hashes.renderedHash,
                        right.hashes.renderedHash,
                    ].sort(),
                ),
            "Blinded pair must bind exact rendered artifacts",
        );
        check(
            ["first", "second", "tie"].includes(judgment.verdict),
            "Usefulness verdict required",
        );
        if (left.hashes.renderedHash === right.hashes.renderedHash)
            check(
                judgment.verdict === "tie",
                "Identical blinded artifacts require a tie",
            );
        text(judgment.rationale, "usefulness rationale");
        const win =
            judgment.verdict === "tie"
                ? 0.5
                : Number(
                      assignment[judgment.verdict] ===
                          right.hashes.renderedHash,
                  );
        details.push({
            id,
            caseId: left.caseId,
            generation: left.generation,
            value: win,
            complete: left.status === "ok" && right.status === "ok",
        });
    }
    return {
        details,
        reviewHash: identity(review),
        blindingHash: identity(blinded),
    };
}

function releaseEvidence(
    input,
    registration,
    registry,
    confirmation,
    rollback,
) {
    const reasons = [];
    if (
        input.campaign.phase !== "confirmation" ||
        input.packet.dataset === "original"
    )
        reasons.push(
            "Untouched external confirmation, not original protocol fixtures, is required",
        );
    const expected = registry.confirmation;
    for (const bundle of input.packet.bundles) {
        const entry = expected.find((entry) => entry.id === bundle.id);
        const inventory = input.campaign.inventory.find(
            (entry) => entry.id === bundle.id,
        );
        check(
            entry &&
                identity(entry.sourceHashes) ===
                    identity(bundle.sources.map((source) => source.sha256)) &&
                identity(entry.clusters) === identity(inventory.clusters),
            "Confirmation packet differs from frozen split registry",
        );
    }
    if (
        !confirmation ||
        confirmation.status !== "custodian-approved-untouched-confirmation" ||
        confirmation.registrationHash !== identity(registration) ||
        confirmation.runHash !== identity(input.run) ||
        confirmation.custodian === registration.registeredBy ||
        !confirmation.custodian?.trim()
    )
        reasons.push(
            "Independent confirmation custodian attestation is missing",
        );
    if (!rollback)
        reasons.push("Qualified compatible rollback evidence is missing");
    else {
        hash(rollback.recipeHash, "rollback recipe");
        hash(
            rollback.compatibilityTestRecordHash,
            "rollback compatibility tests",
        );
        hash(rollback.qualificationRecordHash, "previous recipe qualification");
        if (
            rollback.status !== "tested-compatible" ||
            retainedProtections.some(
                (key) => rollback.protections?.[key] !== true,
            )
        )
            reasons.push(
                "Rollback must preserve factual/citation/proof protections, legacy serving, and the accepted revision",
            );
    }
    return reasons;
}

function budgetEvidence(input, registration) {
    let calls = 0,
        reservedTokens = 0,
        unknown = 0;
    for (const row of input.outputs.records) {
        if (!row.requestCapture) {
            if (row.status !== "missing" || row.telemetry.calls !== 0)
                unknown++;
            continue;
        }
        for (const call of JSON.parse(row.requestCapture.manifest).calls) {
            calls++;
            const receipt = call.reservations?.at(-1);
            if (
                !receipt ||
                ["inputTokens", "outputTokens", "safetyTokens"].some(
                    (key) =>
                        !Number.isSafeInteger(receipt[key]) || receipt[key] < 0,
                )
            )
                unknown++;
            else
                reservedTokens +=
                    receipt.inputTokens +
                    receipt.outputTokens +
                    receipt.safetyTokens;
        }
    }
    const reservedCost = calls * registration.maxCostPerCall;
    return {
        calls,
        reservedTokens,
        reservedCost,
        unknownReservations: unknown,
        measuredCost: null,
        passed:
            unknown === 0 &&
            calls <= input.run.budget.calls &&
            reservedTokens <= input.run.budget.tokens &&
            reservedCost <= input.run.budget.cost,
        limitation:
            "Cost is the owner-approved conservative reservation, not measured billing or a verified price quote.",
    };
}

export function assessCampaignRelease({
    input,
    rubric,
    rubricReview,
    measurements,
    registration,
    registry,
    confirmation,
    rollback,
    blinded,
    usefulnessReview,
}) {
    const scored = scoreCampaignMeasurements(
        input,
        rubric,
        rubricReview,
        measurements,
    );
    registrationChecks(registration, input, rubric, registry);
    const membership = comparisonClusters(input, registration.analysis);
    const reasons = releaseEvidence(
        input,
        registration,
        registry,
        confirmation,
        rollback,
    );
    const accounting = budgetEvidence(input, registration);
    if (!accounting.passed)
        reasons.push(
            "Approved execution budgets exceeded or reservation accounting is unknown",
        );
    const details = scored.details.filter((row) =>
        [registration.baseline, registration.candidate].includes(row.arm),
    );
    for (const row of details) {
        const raw = input.outputs.records.find((entry) => entry.id === row.id);
        if (!raw.requestCapture)
            reasons.push(`Missing admitted dispatch capture: ${row.id}`);
        else
            validateRequestCapture(raw.requestCapture, row.caseId, {
                requireComplete: true,
            });
        if (
            row.status !== "ok" ||
            row.criticalErrors > 0 ||
            row.metrics.supportedClaims.value === null ||
            ["structural", "citations", "renderedDelivery"].some(
                (key) => row.metrics[key].value !== 1,
            ) ||
            row.checkpoints.some(
                (checkpoint) =>
                    checkpoint.status !== "accepted" ||
                    checkpoint.criticalErrors > 0 ||
                    checkpoint.supportedClaims.value === null,
            )
        )
            reasons.push(
                `Attempt/checkpoint factual or delivery gate failed: ${row.id}`,
            );
    }
    const comparisons = registration.metrics.map((gate) =>
        compareMetric(details, registration, membership, gate),
    );
    if (comparisons.some((gate) => !gate.passed))
        reasons.push(
            "Registered paired cluster thresholds or non-regression gates failed",
        );
    let usefulness = null;
    if (!blinded || !usefulnessReview)
        reasons.push(
            "Independent blinded paired usefulness evidence is missing",
        );
    else {
        usefulness = scoreCampaignUsefulness(
            input,
            registration.baseline,
            registration.candidate,
            blinded,
            usefulnessReview,
        );
        const minimum = registration.usefulnessMinimum;
        check(
            Number.isFinite(minimum) && minimum >= 0 && minimum <= 1,
            "Registered usefulness minimum required",
        );
        const groups = new Map();
        for (const pair of usefulness.details) {
            const id = membership.get(pair.caseId);
            const values = groups.get(id) ?? [];
            values.push(pair.value);
            groups.set(id, values);
        }
        const means = [...groups.values()].map(
            (values) => values.reduce((a, b) => a + b, 0) / values.length,
        );
        const estimate = clusteredMeanInterval(means, registration.analysis);
        usefulness.estimate = estimate;
        if (
            usefulness.details.some((pair) => !pair.complete) ||
            groups.size < registration.analysis.minClusters ||
            estimate.interval === null ||
            estimate.interval[0] < minimum
        )
            reasons.push("Blinded usefulness gate failed");
    }
    return {
        contract: "memory-view-release-assessment-v1",
        qualityQualified: reasons.length === 0,
        status: reasons.length
            ? "not-qualified"
            : "qualified-for-owner-rollout-decision",
        reasons,
        accounting,
        comparisons,
        usefulness,
        identities: {
            registration: identity(registration),
            scorecard: identity(scored),
            registry: identity(registry),
            confirmation: confirmation ? identity(confirmation) : null,
            rollback: rollback ? identity(rollback) : null,
        },
        publicationPerformed: false,
        limitation:
            "Human review, custody and deployment attestations are hash-bound declarations, not independently authenticated by this tool.",
    };
}
