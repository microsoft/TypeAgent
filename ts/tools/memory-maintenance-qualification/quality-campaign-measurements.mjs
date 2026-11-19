// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    check,
    hash,
    identity,
    sha256,
    text,
    unique,
} from "./quality-contract.mjs";
import {
    campaignRatio,
    scoreCampaignArtifacts,
    validateCampaignWitness,
    validateIngestionMapping,
} from "./quality-view-campaign.mjs";
import { evaluateTopicDecision } from "./topic-decision-study.mjs";

export const measurementContract = "informational-view-measurements-v2";

export function independentReview(review, expectedHash) {
    check(
        review?.status === "approved-independent-human-review" &&
            review.artifactHash === expectedHash,
        "Independent review artifact binding required",
    );
    text(review.author, "review author");
    text(review.reviewer, "review reviewer");
    check(review.author !== review.reviewer, "Review must be independent");
    check(
        Number.isFinite(Date.parse(review.reviewedAt)),
        "Review timestamp required",
    );
    check(review.adjudicated === true, "Review must be adjudicated");
    hash(review.adjudicationRecordHash, "adjudication record");
}

function flag(value, name) {
    check(typeof value === "boolean", `${name}: boolean required`);
}

function reviewedWitness(witness, bundle, mapping) {
    return validateCampaignWitness(witness, bundle, mapping, {
        constructionOnly: witness.corpusId === undefined,
    });
}

function spanQuote(artifact, span) {
    if (span === null) return null;
    check(
        typeof artifact === "string" &&
            Number.isSafeInteger(span?.start) &&
            Number.isSafeInteger(span?.end) &&
            span.start >= 0 &&
            span.end > span.start &&
            artifact.slice(span.start, span.end) === text(span.quote, "quote"),
        "Exact artifact span required",
    );
    return span;
}

function sameInventory(actual, expected, name) {
    const records = unique(actual, "id", name);
    check(
        records.size === expected.length &&
            expected.every((entry) => records.has(entry.id)),
        `${name}: complete inventory required`,
    );
    return records;
}

function validateRubric(rubric, input, mapping) {
    check(
        rubric?.schemaVersion === 2 &&
            rubric.contract === measurementContract &&
            rubric.constructionHash === identity(input.packet) &&
            rubric.goldHash === identity(input.gold),
        "Measurement rubric identity mismatch",
    );
    const cases = sameInventory(rubric.cases, input.gold.cases, "rubric cases");
    for (const bundle of input.packet.bundles) {
        const entry = cases.get(bundle.id);
        const gold = input.gold.cases.find((row) => row.id === bundle.id);
        const weights = sameInventory(
            entry.facts,
            gold.expectations,
            "weighted facts",
        );
        for (const expectation of gold.expectations) {
            const fact = weights.get(expectation.id);
            check(
                Number.isFinite(fact.importance) && fact.importance > 0,
                "Positive reviewer importance required",
            );
            flag(fact.required, "required fact");
            flag(fact.answerable, "answerable fact");
            check(
                !fact.answerable || expectation.accessible,
                "Unavailable evidence cannot be answerable",
            );
        }
        unique(entry.ordering, "id", "ordering constraints");
        for (const order of entry.ordering) {
            check(
                order.before !== order.after &&
                    weights.has(order.before) &&
                    weights.has(order.after),
                "Ordering requires distinct reviewed facts",
            );
            check(
                order.witnesses?.length > 0,
                "Ordering needs original witnesses",
            );
            for (const witness of order.witnesses)
                reviewedWitness(witness, bundle, mapping);
        }
        validateCheckpointRubric(entry.checkpoints, bundle, mapping);
    }
    return cases;
}

const maintenanceKinds = [
    "newFactUptake",
    "staleFactRemoval",
    "unaffectedFactPreservation",
    "protectedEditPreservation",
];

function validateCheckpointRubric(checkpoints, bundle, mapping) {
    check(Array.isArray(checkpoints), "Checkpoint rubric required");
    const count = bundle.project ? bundle.sources.length : 1;
    check(
        checkpoints.length === count,
        "Every source-update checkpoint needs a rubric",
    );
    for (const [index, checkpoint] of checkpoints.entries()) {
        check(checkpoint.sequence === index + 1, "Checkpoint order mismatch");
        unique(checkpoint.expectations, "id", "maintenance expectations");
        const available = bundle.project
            ? bundle.sources.slice(0, index + 1)
            : bundle.sources;
        for (const expected of checkpoint.expectations) {
            check(
                maintenanceKinds.includes(expected.kind),
                "Unknown maintenance metric",
            );
            check(
                expected.witnesses?.length > 0,
                "Maintenance needs original witnesses",
            );
            for (const witness of expected.witnesses)
                reviewedWitness(
                    witness,
                    { ...bundle, sources: available },
                    mapping,
                );
            text(expected.requirement, "maintenance requirement");
        }
    }
}

function weightedCoverage(rubric, annotation, field) {
    const facts = rubric.facts.filter(
        (fact) => fact.required && fact.answerable,
    );
    const labels = new Map(
        (annotation?.expectations ?? []).map((label) => [label.id, label]),
    );
    const denominator = facts.reduce((sum, fact) => sum + fact.importance, 0);
    const numerator = facts.reduce((sum, fact) => {
        const label = labels.get(fact.id);
        const correct = field === "selected" || label?.correct;
        return sum + (label?.[field] && correct ? fact.importance : 0);
    }, 0);
    return campaignRatio(numerator, denominator);
}

function orderMetrics(rubric, record, rendered) {
    const labels = sameInventory(
        record.ordering,
        rubric.ordering,
        "ordering verdicts",
    );
    let correct = 0;
    for (const expected of rubric.ordering) {
        const label = labels.get(expected.id);
        const before = spanQuote(rendered, label.before);
        const after = spanQuote(rendered, label.after);
        const pass =
            before !== null && after !== null && before.end <= after.start;
        correct += Number(pass);
    }
    return campaignRatio(correct, rubric.ordering.length);
}

function caveatMetrics(record, rendered) {
    check(
        record.allCaveatsReviewed === true,
        "Complete caveat review required",
    );
    unique(record.caveats, "id", "caveats");
    for (const caveat of record.caveats) {
        check(spanQuote(rendered, caveat.span), "Caveat span required");
        flag(caveat.relevant, "caveat relevance");
        flag(caveat.redundant, "caveat redundancy");
        text(caveat.rationale, "caveat rationale");
    }
    return {
        caveatRelevance: campaignRatio(
            record.caveats.filter((row) => row.relevant).length,
            record.caveats.length,
        ),
        caveatNonRedundancy: campaignRatio(
            record.caveats.filter((row) => !row.redundant).length,
            record.caveats.length,
        ),
    };
}

function executionMetrics(row, checkpoints) {
    if (!row.requestCapture)
        return {
            observed: false,
            constructionAttempts: null,
            repairAttempts: null,
            providerFailures: null,
            completionFailures: null,
            firstPassCheckpoints: campaignRatio(0, 0),
        };
    const calls = JSON.parse(row.requestCapture.manifest).calls;
    const construction = (call) =>
        /^informational_(?:wiki|project_summary):(?:normal|contract-repair)$/.test(
            call.operation,
        );
    const repair = (call) =>
        construction(call) && call.operation.endsWith(":contract-repair");
    const results = new Map(
        (row.requestCapture.results ?? []).map((result) => [
            result.file,
            JSON.parse(result.body),
        ]),
    );
    return {
        observed: true,
        constructionAttempts: calls.filter(construction).length,
        repairAttempts: calls.filter(repair).length,
        providerFailures: calls.filter(
            (call) =>
                call.outcome?.state === "failed" ||
                (call.outcome?.status !== undefined &&
                    call.outcome.status >= 400),
        ).length,
        completionFailures: calls.filter(
            (call) =>
                call.result && results.get(call.result.file).success === false,
        ).length,
        terminalCheckpoints: checkpoints.filter(
            (checkpoint) => checkpoint.status === "failed",
        ).length,
        unattemptedCheckpoints: checkpoints.filter(
            (checkpoint) => checkpoint.status === "not-attempted",
        ).length,
        firstPassCheckpoints: campaignRatio(
            checkpoints.filter((checkpoint) => {
                const attempts = calls.filter(
                    (call) => call.checkpoint === checkpoint.sequence,
                );
                return (
                    checkpoint.status === "accepted" &&
                    attempts.some(construction) &&
                    !attempts.some(repair)
                );
            }).length,
            checkpoints.length,
        ),
        limitation:
            "Returned transport is not semantic acceptance; completion failures and terminal checkpoint outcomes are reported separately.",
    };
}

function checkpointClaims(checkpoint, bundle, mapping) {
    if (checkpoint.saved === null && checkpoint.rendered === null) {
        check(
            Array.isArray(checkpoint.claims) && checkpoint.claims.length === 0,
            "Unavailable checkpoint artifacts cannot have reviewed claims",
        );
        return {
            supportedClaims: campaignRatio(0, 0),
            criticalErrors: 0,
            unknownClaimReview: true,
        };
    }
    check(
        checkpoint.allVerifiableClaimsReviewed === true,
        "Complete checkpoint claim review required",
    );
    unique(checkpoint.claims, "id", "checkpoint claims");
    for (const claim of checkpoint.claims) {
        check(
            ["saved", "rendered"].includes(claim.artifact),
            "Claim artifact required",
        );
        check(
            spanQuote(checkpoint[claim.artifact], claim.span),
            "Claim span required",
        );
        flag(claim.supported, "checkpoint supported");
        flag(claim.critical, "checkpoint critical");
        text(claim.rationale, "checkpoint rationale");
        check(
            Array.isArray(claim.witnesses) &&
                (!claim.supported || claim.witnesses.length > 0),
            "Supported checkpoint claim needs witnesses",
        );
        for (const witness of claim.witnesses)
            validateCampaignWitness(witness, bundle, mapping);
    }
    return {
        supportedClaims: campaignRatio(
            checkpoint.claims.filter((claim) => claim.supported).length,
            checkpoint.claims.length,
        ),
        criticalErrors: checkpoint.claims.filter(
            (claim) => claim.critical && !claim.supported,
        ).length,
    };
}

function reconciledCheckpoints(artifacts) {
    const result = new Map();
    const reconciliation = artifacts.reconciliation;
    if (reconciliation === undefined) return result;
    const interrupted = artifacts.records.filter(
        (checkpoint) => checkpoint.status === "running",
    );
    check(
        reconciliation?.contract ===
            "memory-view-checkpoint-reconciliation-v1" &&
            reconciliation.scheduleHash === sha256(artifacts.schedule) &&
            Array.isArray(reconciliation.checkpoints) &&
            reconciliation.checkpoints.length === interrupted.length,
        "Interrupted checkpoint reconciliation must bind the original schedule",
    );
    for (const checkpoint of reconciliation.checkpoints) {
        check(
            interrupted.some(
                (captured) => captured.sequence === checkpoint.sequence,
            ) &&
                !result.has(checkpoint.sequence) &&
                checkpoint.status === "failed" &&
                checkpoint.stage === "reconciliation",
            "Reconciliation may only fail interrupted checkpoints",
        );
        text(checkpoint.reason, "checkpoint interruption reason");
        result.set(checkpoint.sequence, checkpoint);
    }
    return result;
}

function checkpointMetrics(rubric, record, bundle, mapping, artifacts) {
    check(
        artifacts?.contract === "memory-view-checkpoint-artifacts-v1" &&
            Array.isArray(artifacts.records) &&
            artifacts.records.length === rubric.checkpoints.length &&
            identity(JSON.parse(artifacts.schedule).checkpoints) ===
                identity(
                    artifacts.records.map(
                        ({
                            saved: _saved,
                            rendered: _rendered,
                            evidence: _evidence,
                            ...entry
                        }) => entry,
                    ),
                ),
        "Original checkpoint schedule/artifact binding required",
    );
    const reconciled = reconciledCheckpoints(artifacts);
    check(
        Array.isArray(record.checkpoints) &&
            record.checkpoints.length === rubric.checkpoints.length,
        "Every scheduled checkpoint requires an outcome",
    );
    return rubric.checkpoints.map((expected, index) => {
        const actual = record.checkpoints[index];
        const captured = artifacts.records[index];
        const outcome = reconciled.get(captured?.sequence) ?? captured;
        check(
            captured &&
                actual.status === outcome.status &&
                actual.sequence === captured.sequence &&
                actual.saved === captured.saved &&
                actual.rendered === captured.rendered &&
                actual.stage === outcome.stage,
            "Checkpoint review must bind captured execution artifacts",
        );
        check(
            actual.sequence === expected.sequence,
            "Checkpoint sequence mismatch",
        );
        check(
            ["accepted", "failed", "not-attempted", "unknown"].includes(
                actual.status,
            ),
            "Terminal checkpoint status required",
        );
        text(actual.stage, "checkpoint stage");
        for (const key of ["saved", "rendered"]) {
            check(
                actual[key] === null || typeof actual[key] === "string",
                "Checkpoint artifact must be exact or null",
            );
            check(
                actual.hashes?.[key] ===
                    (actual[key] === null ? null : identity(actual[key])),
                "Checkpoint artifact identity mismatch",
            );
        }
        const labels = sameInventory(
            actual.expectations,
            expected.expectations,
            "maintenance labels",
        );
        for (const target of expected.expectations) {
            const label = labels.get(target.id);
            flag(label.satisfied, "maintenance satisfied");
            text(label.rationale, "maintenance rationale");
            if (label.satisfied && target.kind !== "staleFactRemoval")
                check(
                    spanQuote(actual.rendered, label.span),
                    "Preservation needs exact rendered span",
                );
            if (
                actual.status !== "accepted" ||
                actual.saved === null ||
                actual.rendered === null
            )
                check(
                    !label.satisfied,
                    "Failed checkpoint cannot satisfy maintenance",
                );
        }
        const available = bundle.project
            ? bundle.sources.slice(0, index + 1)
            : bundle.sources;
        const claims = checkpointClaims(
            actual,
            { ...bundle, sources: available },
            mapping,
        );
        return {
            sequence: expected.sequence,
            status: actual.status,
            artifactsAvailable:
                actual.saved !== null && actual.rendered !== null,
            ...claims,
            metrics: Object.fromEntries(
                maintenanceKinds.map((kind) => {
                    const targets = expected.expectations.filter(
                        (row) => row.kind === kind,
                    );
                    return [
                        kind,
                        campaignRatio(
                            targets.filter(
                                (target) => labels.get(target.id).satisfied,
                            ).length,
                            targets.length,
                        ),
                    ];
                }),
            ),
        };
    });
}

export function scoreCampaignMeasurements(
    input,
    rubric,
    rubricReview,
    measurements,
) {
    const base = scoreCampaignArtifacts(
        input.packet,
        input.campaign,
        input.run,
        input.outputs,
        input.annotations,
        input.gold,
        input.review,
        input.mapping,
    );
    independentReview(rubricReview, identity(rubric));
    const mapping = validateIngestionMapping(input.mapping, input.packet);
    const cases = validateRubric(rubric, input, mapping);
    check(
        measurements?.schemaVersion === 2 &&
            measurements.contract === measurementContract &&
            measurements.outputsHash === identity(input.outputs) &&
            measurements.rubricHash === identity(rubric),
        "Measurement output/rubric binding mismatch",
    );
    const records = sameInventory(
        measurements.records,
        base.details,
        "measurement slots",
    );
    const details = base.details.map((slot) => {
        const record = records.get(slot.id);
        const { review, ...judgment } = record;
        independentReview(review, identity(judgment));
        const row = input.outputs.records.find((entry) => entry.id === slot.id);
        check(
            identity(record.hashes) === identity(row.hashes),
            "Measurement artifact hashes mismatch",
        );
        const rubricCase = cases.get(slot.caseId);
        const annotation = input.annotations.records.find(
            (entry) => entry.id === slot.id,
        );
        const bundle = input.packet.bundles.find(
            (entry) => entry.id === slot.caseId,
        );
        const checkpointMapping =
            input.run.schemaVersion === 2
                ? new Map(
                      [...mapping].filter(
                          ([, entry]) => entry.attemptId === row.id,
                      ),
                  )
                : mapping;
        const checkpoints = checkpointMetrics(
            rubricCase,
            record,
            bundle,
            checkpointMapping,
            row.checkpointArtifacts,
        );
        if (row.status === "ok") {
            const last = row.checkpointArtifacts.records.at(-1);
            check(
                last.saved === row.saved && last.rendered === row.rendered,
                "Final checkpoint must match delivered artifacts",
            );
        }
        return {
            ...slot,
            metrics: {
                ...slot.metrics,
                selectedWeightedCoverage: weightedCoverage(
                    rubricCase,
                    annotation,
                    "selected",
                ),
                preservedWeightedCoverage: weightedCoverage(
                    rubricCase,
                    slot.status === "ok" ? annotation : null,
                    "preserved",
                ),
                issueOrdering: orderMetrics(rubricCase, record, row.rendered),
                ...caveatMetrics(record, row.rendered),
                ...Object.fromEntries(
                    maintenanceKinds.map((kind) => [
                        kind,
                        campaignRatio(
                            checkpoints.reduce(
                                (n, checkpoint) =>
                                    n + checkpoint.metrics[kind].numerator,
                                0,
                            ),
                            checkpoints.reduce(
                                (n, checkpoint) =>
                                    n +
                                    (checkpoint.metrics[kind].denominator ?? 0),
                                0,
                            ),
                        ),
                    ]),
                ),
            },
            checkpoints,
            execution: executionMetrics(row, checkpoints),
        };
    });
    return {
        schemaVersion: 2,
        contract: measurementContract,
        base,
        rubricHash: identity(rubric),
        rubricReviewHash: identity(rubricReview),
        measurementsHash: identity(measurements),
        details,
        qualityQualified: false,
        limitation:
            "Reviewed descriptive measurements; comparison and confirmation gates are separate.",
    };
}

export function scoreReviewedTopicSnapshot(snapshot, annotations, review) {
    independentReview(review, identity({ snapshot, annotations }));
    unique(snapshot.nodes, "id", "topic nodes");
    const concepts = unique(snapshot.curation.concepts, "id", "topic concepts");
    const nodes = new Set(snapshot.nodes.map((node) => node.id));
    const admitted = new Set();
    for (const concept of concepts.values())
        for (const id of concept.memberIds) {
            check(
                nodes.has(id) && !admitted.has(id),
                "Unknown or multiply assigned topic member",
            );
            admitted.add(id);
        }
    const deferred = unique(
        snapshot.curation.deferred,
        "nodeId",
        "deferred nodes",
    );
    for (const id of deferred.keys())
        check(
            nodes.has(id) && !admitted.has(id),
            "Deferred/admitted overlap or unknown node",
        );
    check(
        admitted.size + deferred.size === nodes.size,
        "Every topic node requires admission or deferral",
    );
    check(
        annotations.items.length === nodes.size,
        "Full topic annotation required",
    );
    const result = evaluateTopicDecision(snapshot, annotations);
    check(
        Array.isArray(snapshot.parents),
        "Actual topic parent edges required",
    );
    check(
        Array.isArray(annotations.hierarchy),
        "Full hierarchy review required",
    );
    const edgeId = ({ parentId, childId }) => identity([parentId, childId]);
    const hierarchy = snapshot.parents.map((edge) => ({
        ...edge,
        id: edgeId(edge),
    }));
    const judgments = annotations.hierarchy.map((edge) => ({
        ...edge,
        id: edgeId(edge),
    }));
    const edges = unique(hierarchy, "id", "actual hierarchy edges");
    sameInventory(judgments, hierarchy, "hierarchy judgments");
    for (const edge of judgments) {
        const actual = edges.get(edge.id);
        check(
            nodes.has(edge.childId) &&
                nodes.has(edge.parentId) &&
                edge.childId !== edge.parentId &&
                edge.childId === actual.childId &&
                edge.parentId === actual.parentId,
            "Hierarchy edge needs distinct actual topic nodes",
        );
        flag(edge.acceptable, "hierarchy acceptability");
        text(edge.rationale, "hierarchy rationale");
    }
    return {
        ...result,
        falseMerges: result.annotationMetrics.merge.falsePositive,
        falseSplits: result.annotationMetrics.merge.falseNegative,
        hierarchyAcceptability: campaignRatio(
            annotations.hierarchy.filter((edge) => edge.acceptable).length,
            annotations.hierarchy.length,
        ),
        reviewHash: identity(review),
        qualityQualified: false,
    };
}
