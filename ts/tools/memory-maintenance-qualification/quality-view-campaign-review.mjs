// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { check, hash, identity, text, unique } from "./quality-contract.mjs";

export function validateGroupSplit(inventory, split) {
    unique(inventory, "id", "cluster inventory");
    const members = unique(split, "id", "split inventory");
    check(
        members.size === inventory.length,
        "Split must cover inventory exactly",
    );
    const groups = new Map();
    for (const entry of inventory) {
        const phase = members.get(entry.id)?.phase;
        check(
            ["development", "confirmation"].includes(phase),
            "Split phase required",
        );
        for (const kind of ["source", "project", "topic", "meeting"]) {
            check(
                Array.isArray(entry.clusters?.[kind]),
                "Explicit cluster arrays required",
            );
            for (const id of entry.clusters[kind]) {
                text(id, "cluster identity");
                const key = JSON.stringify([kind, id]);
                check(
                    !groups.has(key) || groups.get(key) === phase,
                    "Related source/project/topic/meeting crosses split",
                );
                groups.set(key, phase);
            }
        }
    }
    return identity(split);
}

export function validateCampaignSplit(campaign) {
    if (campaign.split !== undefined) {
        validateGroupSplit(campaign.inventory, campaign.split);
        for (const member of campaign.split)
            check(
                member.phase === campaign.phase,
                "Construction packet crosses phase custody",
            );
    }
    if (
        campaign.phase !== "confirmation" &&
        campaign.splitCustody === undefined
    )
        return;
    const custody = campaign.splitCustody;
    check(custody, "Evaluator-custodied group split required");
    validateGroupSplit(custody.inventory, custody.assignments);
    for (const entry of campaign.inventory) {
        const custodied = custody.inventory.find((row) => row.id === entry.id);
        check(
            custodied &&
                identity(custodied.clusters) === identity(entry.clusters) &&
                custody.assignments.find((row) => row.id === entry.id)
                    ?.phase === campaign.phase,
            "Campaign cluster/phase differs from frozen split custody",
        );
    }
}

export function validateReviewProtocol(protocol, campaign, run) {
    check(protocol?.schemaVersion === 1, "Review protocol required");
    check(
        protocol.status === "approved-independent-human-review",
        "Independent review protocol approval pending",
    );
    for (const key of ["author", "reviewer"])
        text(protocol[key], `protocol ${key}`);
    check(
        protocol.author !== protocol.reviewer,
        "Protocol review must be independent",
    );
    hash(protocol.rubricHash, "rubric hash");
    const calibration = protocol.calibration;
    check(
        calibration?.status === "approved-independent-human-review",
        "Independent calibration approval pending",
    );
    check(
        calibration.rubricHash === protocol.rubricHash,
        "Calibration rubric mismatch",
    );
    check(
        Array.isArray(calibration.reviewers),
        "Calibration reviewers required",
    );
    const reviewers = new Set(calibration.reviewers);
    check(
        reviewers.size >= 2 &&
            !reviewers.has(protocol.author) &&
            [...reviewers].every((id) => typeof id === "string" && id.trim()),
        "Calibration requires two independent reviewers",
    );
    const judgments = unique(
        calibration.judgments,
        "id",
        "calibration judgments",
    );
    check(judgments.size > 0, "Real calibration judgments required");
    let agreements = 0;
    for (const judgment of judgments.values()) {
        hash(judgment.artifactHash, "calibration artifact");
        const votes = judgment.votes;
        check(
            votes?.length === reviewers.size &&
                new Set(votes.map((vote) => vote.reviewer)).size ===
                    reviewers.size &&
                votes.every((vote) => reviewers.has(vote.reviewer)),
            "Calibration must retain each independent judgment",
        );
        for (const vote of votes) text(vote.verdict, "calibration verdict");
        if (new Set(votes.map((vote) => vote.verdict)).size === 1) agreements++;
        text(judgment.resolution, "calibration disagreement resolution");
    }
    const agreement = agreements / judgments.size;
    check(
        Number.isFinite(calibration.minimumAgreement) &&
            calibration.minimumAgreement > 0 &&
            calibration.minimumAgreement <= 1 &&
            agreement >= calibration.minimumAgreement,
        "Calibration does not meet explicit agreement criterion",
    );
    const reviewedAt = Date.parse(protocol.reviewedAt);
    const calibratedAt = Date.parse(calibration.reviewedAt);
    check(
        Number.isFinite(reviewedAt) &&
            Number.isFinite(calibratedAt) &&
            calibratedAt <= reviewedAt,
        "Review/calibration timestamps required",
    );
    if (campaign.phase === "confirmation") {
        const thresholds = campaign.thresholds;
        check(
            thresholds &&
                thresholds.rubricHash === protocol.rubricHash &&
                thresholds.calibrationRecordHash === identity(calibration) &&
                reviewedAt <= Date.parse(thresholds.registeredAt) &&
                Date.parse(thresholds.registeredAt) < Date.parse(run.startedAt),
            "Freeze calibrated rubric and thresholds before confirmation",
        );
        check(
            Array.isArray(protocol.candidateHashes) &&
                protocol.candidateHashes.length === run.arms.length &&
                new Set(protocol.candidateHashes).size === run.arms.length &&
                run.arms.every((arm) =>
                    protocol.candidateHashes.includes(identity(arm)),
                ),
            "Confirmation candidates differ from preregistered identities",
        );
    }
    return {
        protocolHash: identity(protocol),
        agreement,
        judgments: judgments.size,
    };
}
