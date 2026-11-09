// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    check,
    text,
    hash,
    identity,
    sha256,
    unique,
} from "./quality-contract.mjs";

export const campaignContract = "informational-view-campaign-v1";
export const coverageMetrics = [
    "qualification",
    "wikiReference",
    "briefQuery",
    "briefTypedFact",
];
export const telemetryKeys = [
    "calls",
    "tokens",
    "reservations",
    "latencyMs",
    "cost",
];
const errorKinds = [
    "attribution",
    "status",
    "date",
    "correction",
    "unknownState",
    "citationRevision",
];
const clusterKinds = ["source", "topic", "project", "meeting"];
const roles = [
    "goalsScope",
    "owners",
    "status",
    "milestones",
    "decisions",
    "risks",
    "context",
];
const factStatuses = [
    "observed",
    "proposed",
    "attempted",
    "rejected",
    "deferred",
    "confirmed",
    "unknown",
    "blocked",
    "notApplicable",
];

function keys(value, allowed, name) {
    check(value && typeof value === "object" && !Array.isArray(value), name);
    check(
        Object.keys(value).every((key) => allowed.includes(key)),
        `${name}: unknown field`,
    );
}

function strings(values, name) {
    return unique(
        values?.map((id) => ({ id })),
        "id",
        name,
    );
}

function boolean(value, name) {
    check(typeof value === "boolean", `${name}: boolean required`);
}

function date(value, name) {
    text(value, name);
    check(Number.isFinite(Date.parse(value)), `${name}: invalid date`);
    return Date.parse(value);
}

export function campaignRatio(numerator, denominator) {
    return {
        numerator,
        denominator: denominator === 0 ? null : denominator,
        value: denominator === 0 ? null : numerator / denominator,
    };
}

function validateCanonicalProject(bundle) {
    if (bundle.project === undefined) return;
    keys(bundle.project, ["id", "meetingIds"], "project");
    check(
        bundle.kind === "projectBrief" &&
            bundle.project.id === bundle.id &&
            Array.isArray(bundle.project.meetingIds) &&
            bundle.project.meetingIds.length > 0 &&
            Array.isArray(bundle.sources) &&
            JSON.stringify(bundle.project.meetingIds) ===
                JSON.stringify(bundle.sources.map((source) => source.id)),
        "Canonical project identity and ordered meetings must match the brief sources",
    );
}

export function validateConstructionPacket(packet) {
    keys(
        packet,
        ["schemaVersion", "purpose", "dataset", "release", "bundles"],
        "construction",
    );
    check(
        packet.schemaVersion === 1 && packet.purpose === "construction-only",
        "Construction version/purpose mismatch",
    );
    check(
        ["original", "freshwiki", "qmsum-product"].includes(packet.dataset),
        "Unknown dataset",
    );
    keys(
        packet.release,
        ["repository", "revision", "files", "license"],
        "release",
    );
    for (const key of ["repository", "revision"])
        text(packet.release[key], `release.${key}`);
    if (typeof packet.release.license === "string") {
        text(packet.release.license, "release.license");
    } else {
        const license = packet.release.license;
        keys(license, ["id", "terms", "reviewed", "underlying"], "license");
        for (const key of ["id", "terms"]) text(license[key], `license.${key}`);
        check(license.reviewed === true, "Source license review required");
        if (license.underlying !== undefined) {
            check(
                Array.isArray(license.underlying),
                "Underlying license array required",
            );
            for (const entry of license.underlying) {
                keys(entry, ["id", "terms", "reviewed"], "underlying license");
                text(entry.id, "underlying license id");
                text(entry.terms, "underlying license terms");
                check(
                    entry.reviewed === true,
                    "Underlying source license review required",
                );
            }
        }
    }
    const files = unique(packet.release.files, "path", "release files");
    check(files.size > 0, "Release files required");
    for (const file of files.values()) {
        keys(file, ["path", "sha256"], "release file");
        hash(file.sha256, "release file hash");
    }
    const bundles = unique(packet.bundles, "id", "construction bundles");
    check(bundles.size > 0, "Construction bundles required");
    for (const bundle of bundles.values()) {
        keys(
            bundle,
            ["id", "kind", "query", "aliases", "sources", "project"],
            "bundle",
        );
        check(
            ["wiki", "projectBrief"].includes(bundle.kind),
            "Unknown bundle kind",
        );
        validateCanonicalProject(bundle);
        check(
            text(bundle.query, "query").length <= 200,
            "Query exceeds selector bound",
        );
        const aliases = strings(bundle.aliases, "aliases");
        check(
            aliases.size <= 7 &&
                [...aliases.keys()].every((s) => s.length <= 200),
            "Aliases exceed selector bounds",
        );
        for (const source of unique(bundle.sources, "id", "sources").values()) {
            keys(
                source,
                [
                    "id",
                    "version",
                    "title",
                    "text",
                    "sha256",
                    "authoredAt",
                    "provenance",
                    "coordinateMap",
                ],
                "source",
            );
            for (const key of ["version", "title", "text"])
                text(source[key], `source.${key}`);
            check(
                hash(source.sha256, "source.sha256") === sha256(source.text),
                "Construction source hash mismatch",
            );
            if (source.authoredAt !== undefined)
                date(source.authoredAt, "authoredAt");
            if (source.provenance !== undefined)
                check(
                    source.provenance &&
                        typeof source.provenance === "object" &&
                        !Array.isArray(source.provenance),
                    "Provenance object required",
                );
            if (source.coordinateMap !== undefined)
                check(
                    Array.isArray(source.coordinateMap),
                    "Coordinate map array required",
                );
        }
    }
    return identity(packet);
}

export function validateCampaign(campaign, packet) {
    const constructionHash = validateConstructionPacket(packet);
    check(
        campaign.schemaVersion === 1 && campaign.contract === campaignContract,
        "Campaign contract mismatch",
    );
    text(campaign.id, "campaign.id");
    check(
        campaign.constructionHash === constructionHash &&
            campaign.dataset === packet.dataset,
        "Campaign construction identity mismatch",
    );
    check(
        ["development", "confirmation"].includes(campaign.phase),
        "Campaign phase required",
    );
    text(campaign.seed, "selection seed");
    strings(campaign.exclusions, "exclusions");
    const inventory = unique(campaign.inventory, "id", "campaign inventory");
    check(
        inventory.size === packet.bundles.length,
        "Campaign inventory must bind every construction bundle",
    );
    for (const bundle of packet.bundles) {
        const entry = inventory.get(bundle.id);
        check(entry, "Missing inventory bundle");
        keys(entry.clusters, clusterKinds, "clusters");
        for (const key of clusterKinds)
            strings(entry.clusters[key], `clusters.${key}`);
        check(
            Object.values(entry.clusters).some((values) => values.length > 0),
            "At least one clustering identity required",
        );
    }
    if (campaign.thresholds !== null) validateThresholds(campaign.thresholds);
    if (packet.dataset !== "original" && campaign.phase === "confirmation")
        check(
            campaign.thresholds !== null,
            "External confirmation thresholds must be preregistered",
        );
    return identity(campaign);
}

const scoreMetricNames = [
    "structural",
    "citations",
    "supportedClaims",
    "selectedQualification",
    "preservedQualification",
    "wikiFullReference",
    "wikiAccessibleReference",
    "briefQueryCoverage",
    "briefTypedAccuracy",
    "renderedDelivery",
    "attemptSuccess",
    "criticalErrors",
];

function validateThresholds(thresholds) {
    check(
        thresholds?.status === "preregistered",
        "Threshold preregistration required",
    );
    date(thresholds.registeredAt, "threshold registration");
    text(thresholds.registeredBy, "threshold registeredBy");
    for (const key of ["rubricHash", "calibrationRecordHash"])
        hash(thresholds[key], key);
    const metrics = unique(thresholds.metrics, "metric", "threshold metrics");
    check(metrics.size > 0, "Explicit threshold metrics required");
    for (const row of metrics.values()) {
        check(
            scoreMetricNames.includes(row.metric),
            "Unknown threshold metric",
        );
        check(
            ["minimum", "maximum"].includes(row.direction),
            "Threshold direction required",
        );
        check(
            Number.isFinite(row.value) &&
                row.value >= 0 &&
                (row.metric === "criticalErrors" || row.value <= 1),
            "Invalid threshold value",
        );
        check(
            Number.isFinite(row.nonRegressionMargin) &&
                row.nonRegressionMargin >= 0,
            "Preregister non-regression margin explicitly",
        );
    }
}

export function validateCampaignRun(run, campaign, packet) {
    check(
        run.schemaVersion === 1 &&
            run.campaignHash === validateCampaign(campaign, packet),
        "Run campaign identity mismatch",
    );
    text(run.id, "run.id");
    const startedAt = date(run.startedAt, "run.startedAt");
    hash(run.permissionRecordHash, "permissionRecordHash");
    check(
        Number.isSafeInteger(run.generations) && run.generations > 0,
        "Positive generation count required",
    );
    const cases = strings(run.caseIds, "run cases");
    check(cases.size > 0, "Run cases required");
    for (const id of cases.keys())
        check(
            campaign.inventory.some((entry) => entry.id === id),
            "Unknown scheduled case",
        );
    const arms = unique(run.arms, "id", "run arms");
    check(arms.size > 0, "Run arms required");
    for (const arm of arms.values()) {
        check(
            /^[a-f0-9]{40}$/.test(arm.sourceCommit),
            "Arm source commit required",
        );
        for (const key of [
            "patchHash",
            "configurationHash",
            "providerSettingsHash",
            "promptHash",
            "schemaHash",
            "indexHash",
            "eligibleSourcesHash",
        ])
            hash(arm[key], `arm.${key}`);
        for (const key of [
            "nodeVersion",
            "provider",
            "model",
            "indexGeneration",
            "configurationIdentity",
        ])
            text(arm[key], `arm.${key}`);
        check(
            arm.execution === "live",
            "Quality evaluation requires live execution; offline-injected arms are regression diagnostics only",
        );
    }
    for (const key of ["calls", "tokens", "cost"])
        check(
            Number.isFinite(run.budget?.[key]) && run.budget[key] >= 0,
            `Run budget.${key} required`,
        );
    if (campaign.thresholds !== null)
        check(
            Date.parse(campaign.thresholds.registeredAt) <= startedAt,
            "Thresholds registered after run started",
        );
    return identity(run);
}

export function campaignSchedule(run) {
    return run.arms.flatMap((arm) =>
        run.caseIds.flatMap((caseId) =>
            Array.from({ length: run.generations }, (_, index) => ({
                id: JSON.stringify([arm.id, caseId, index + 1]),
                arm: arm.id,
                caseId,
                generation: index + 1,
            })),
        ),
    );
}

export function validateIngestionMapping(mapping, packet) {
    check(
        mapping.schemaVersion === 1 &&
            mapping.constructionHash === validateConstructionPacket(packet),
        "Mapping construction identity mismatch",
    );
    const actual = new Map();
    const entries = new Map();
    for (const row of mapping.records) {
        const bundle = packet.bundles.find((b) => b.id === row.caseId);
        const source = bundle?.sources.find(
            (s) => s.id === row.sourceId && s.version === row.sourceVersion,
        );
        check(source, "Unknown construction source/version mapping");
        for (const key of ["corpusId", "ingestedSourceId", "revisionId"])
            text(row[key], `mapping.${key}`);
        check(
            row.contentHash === source.sha256 &&
                row.retainedText === source.text,
            "Mapping retained revision content mismatch",
        );
        const key = JSON.stringify([
            row.caseId,
            row.sourceId,
            row.sourceVersion,
        ]);
        const actualKey = JSON.stringify([
            row.corpusId,
            row.ingestedSourceId,
            row.revisionId,
        ]);
        check(!entries.has(key), "Duplicate ingestion mapping");
        check(
            !actual.has(actualKey) || actual.get(actualKey) === row.contentHash,
            "Actual revision reused with different retained content",
        );
        entries.set(key, row);
        actual.set(actualKey, row.contentHash);
    }
    return entries;
}

export function validateCampaignWitness(witness, bundle, mapping) {
    const source = bundle.sources.find(
        (s) => s.id === witness.sourceId && s.version === witness.sourceVersion,
    );
    check(source, "Unknown source/version witness");
    text(witness.quote, "witness quote");
    check(
        source.text.includes(witness.quote),
        "Witness quote absent from source",
    );
    const retained = mapping.get(
        JSON.stringify([bundle.id, source.id, source.version]),
    );
    check(
        retained &&
            retained.corpusId === witness.corpusId &&
            retained.ingestedSourceId === witness.ingestedSourceId &&
            retained.revisionId === witness.revisionId,
        "Witness actual ingestion revision mismatch",
    );
    return retained;
}

function artifactHashes(row) {
    return Object.fromEntries(
        ["saved", "rendered", "serializedRequest"].map((key) => [
            `${key}Hash`,
            row[key] === null ? null : identity(row[key]),
        ]),
    );
}

function validateTelemetry(telemetry) {
    keys(telemetry, telemetryKeys, "telemetry");
    for (const key of telemetryKeys) {
        const value = telemetry[key];
        check(
            value === null ||
                (Number.isFinite(value) &&
                    value >= 0 &&
                    (!["calls", "tokens", "reservations"].includes(key) ||
                        Number.isSafeInteger(value))),
            `telemetry.${key}: explicit nonnegative value or null required`,
        );
    }
}

export function validateCampaignOutputs(
    packet,
    campaign,
    run,
    outputs,
    mapping,
) {
    const runHash = validateCampaignRun(run, campaign, packet);
    validateIngestionMapping(mapping, packet);
    check(
        outputs.schemaVersion === 1 &&
            outputs.runHash === runHash &&
            outputs.mappingHash === identity(mapping),
        "Output run/mapping identity mismatch",
    );
    const rows = unique(outputs.records, "id", "outputs");
    const plan = campaignSchedule(run);
    check(
        rows.size === plan.length,
        "Absent output rows: record every scheduled slot",
    );
    for (const expected of plan) {
        const row = rows.get(expected.id);
        check(
            row &&
                row.arm === expected.arm &&
                row.caseId === expected.caseId &&
                row.generation === expected.generation,
            "Missing/unknown scheduled output",
        );
        check(
            ["ok", "failed", "missing"].includes(row.status),
            "Invalid attempt status",
        );
        for (const key of ["stage", "component", "reason", "targetDisposition"])
            text(row[key], `output.${key}`);
        text(row.targetViewId, "targetViewId");
        validateTelemetry(row.telemetry);
        for (const key of ["saved", "rendered", "serializedRequest"]) {
            check(
                row[key] === null || typeof row[key] === "string",
                `Artifact ${key} must be exact string or null`,
            );
            if (row.status === "ok") text(row[key], key);
        }
        for (const [key, value] of Object.entries(artifactHashes(row)))
            check(
                row.hashes?.[key] === value,
                "Artifact exact identity mismatch",
            );
        check(
            Array.isArray(row.selectedEvidence) &&
                Array.isArray(row.citationResolutions),
            "Evidence and citation receipts required",
        );
        if (row.serializedRequest === null)
            check(
                row.selectedEvidence.length === 0,
                "Selection cannot be verified without request",
            );
    }
    return runHash;
}

function choice(value, values, name) {
    check(values.includes(value), `Invalid ${name}`);
}

function nullableText(value, name) {
    if (value !== null) text(value, name);
}

function validateBriefDetails(details) {
    const kind = details.kind;
    if (kind === "goalsScope") keys(details, ["kind"], "goalsScope");
    if (kind === "owners") {
        keys(details, ["kind", "assignments"], "owners");
        for (const assignment of unique(
            details.assignments,
            "id",
            "assignments",
        ).values()) {
            keys(
                assignment,
                ["id", "responsibility", "state", "owner"],
                "assignment",
            );
            text(assignment.responsibility, "responsibility");
            choice(
                assignment.state,
                ["known", "unknown", "unassigned"],
                "owner state",
            );
            nullableText(assignment.owner, "owner");
            check(
                (assignment.state === "known") === (assignment.owner !== null),
                "Unknown/unassigned owner must be null",
            );
        }
    }
    if (kind === "status") {
        keys(details, ["kind", "project", "incident", "capacity"], "status");
        choice(
            details.project,
            ["unknown", "active", "blocked", "complete"],
            "project state",
        );
        choice(
            details.incident,
            ["unknown", "open", "closed", "notApplicable"],
            "incident state",
        );
        choice(
            details.capacity,
            ["unknown", "pendingOwnerReview", "validated", "notApplicable"],
            "capacity state",
        );
    }
    if (["milestones", "decisions", "risks"].includes(kind)) {
        keys(
            details,
            ["kind", "items", ...(kind === "risks" ? ["openQuestions"] : [])],
            "items details",
        );
        for (const item of unique(details.items, "id", "items").values()) {
            keys(
                item,
                ["id", "status", ...(kind === "milestones" ? ["date"] : [])],
                "item",
            );
            const states =
                kind === "milestones"
                    ? [
                          "proposed",
                          "confirmed",
                          "blocked",
                          "deferred",
                          "unknown",
                      ]
                    : kind === "decisions"
                      ? factStatuses
                      : ["open", "blocked", "resolved", "unknown"];
            choice(item.status, states, `${kind} status`);
            if (kind === "milestones")
                nullableText(item.date, "milestone date");
        }
        if (details.openQuestions !== undefined)
            strings(details.openQuestions, "openQuestions");
    }
    if (kind === "context") {
        keys(details, ["kind", "asOf", "basis"], "context");
        choice(details.basis, ["recordEvidence", "unknown"], "context basis");
        nullableText(details.asOf, "asOf");
        check(
            (details.basis === "unknown") === (details.asOf === null),
            "Unknown asOf must be null",
        );
    }
}

function savedContent(row, bundle) {
    const saved = JSON.parse(row.saved);
    const content = saved.content === undefined ? saved : saved.content;
    if (saved.content !== undefined) {
        check(
            saved.viewId === row.targetViewId,
            "Saved ViewVersion identity mismatch",
        );
        for (const key of ["corpusId", "viewId", "revisionId"])
            text(saved[key], `ViewVersion.${key}`);
        check(
            Number.isSafeInteger(saved.version) && saved.version > 0,
            "Saved ViewVersion number required",
        );
    }
    keys(
        content,
        [
            "kind",
            "construction",
            "status",
            "coverageNote",
            "title",
            "summary",
            "sections",
            "citations",
            ...(bundle.kind === "wiki" ? ["index"] : []),
        ],
        "saved content",
    );
    check(content.kind === bundle.kind, "Saved content kind mismatch");
    check(
        content.construction ===
            (bundle.kind === "wiki"
                ? "informational-wiki-v1"
                : "informational-project-summary-v1"),
        "Saved construction mismatch",
    );
    text(content.title, "title");
    check(
        text(content.summary, "summary").length <= 4000,
        "Summary exceeds limit",
    );
    if (content.status !== undefined)
        choice(content.status, ["partial", "sufficient"], "completeness");
    if (content.coverageNote !== undefined)
        check(
            typeof content.coverageNote === "string" &&
                content.coverageNote.length <= 4000,
            "Invalid coverage note",
        );
    const sections = unique(content.sections, "id", "sections");
    check(sections.size > 0, "Sections required");
    check(
        Array.isArray(content.citations) && content.citations.length > 0,
        "Citations required",
    );
    for (const section of sections.values()) {
        keys(section, ["id", "role", "heading", "body", "details"], "section");
        text(section.heading, "section heading");
        text(section.body, "section body");
        check(section.role === section.details?.kind, "Role/details mismatch");
        if (bundle.kind === "wiki") {
            check(section.role === "page", "Wiki requires page role");
            keys(
                section.details,
                ["kind", "construction", "taxonomy", "note", "mergedPageIds"],
                "page details",
            );
            check(
                section.details.construction === content.construction,
                "Page construction mismatch",
            );
            choice(
                section.details.taxonomy,
                ["concept", "system", "project"],
                "taxonomy",
            );
            check(
                typeof section.details.note === "string" &&
                    section.details.note.length <= 4000,
                "Page note required",
            );
            strings(section.details.mergedPageIds, "merged page IDs");
        } else {
            choice(section.role, roles, "brief role");
            validateBriefDetails(section.details);
        }
    }
    if (bundle.kind === "wiki") {
        check(
            content.sections[0].id === row.targetViewId,
            "Stable page identity mismatch",
        );
        const expected = content.sections.map((page) => ({
            pageId: page.id,
            title: page.heading,
            taxonomy: page.details.taxonomy,
        }));
        check(
            identity(content.index) === identity(expected),
            "Exact wiki index mismatch",
        );
        const children = content.sections.slice(1).map((page) => page.id);
        check(
            identity([...content.sections[0].details.mergedPageIds].sort()) ===
                identity([...children].sort()) &&
                content.sections
                    .slice(1)
                    .every((page) => page.details.mergedPageIds.length === 0),
            "Accepted consolidation index mismatch",
        );
    } else {
        check(
            sections.size === roles.length &&
                new Set(content.sections.map((s) => s.role)).size ===
                    roles.length,
            "Every brief role required exactly once",
        );
    }
    return content;
}

function actualEvidence(evidence, bundle, mapping) {
    const retained = [...mapping.values()].find(
        (m) =>
            m.caseId === bundle.id &&
            m.corpusId === evidence.corpusId &&
            m.ingestedSourceId === evidence.sourceId &&
            m.revisionId === evidence.revisionId,
    );
    check(retained, "Unknown actual evidence source/revision");
    text(evidence.excerpt, "evidence excerpt");
    check(
        retained.retainedText.includes(evidence.excerpt),
        "Evidence excerpt absent from retained text",
    );
    const match = /^indexed:(\d+):([a-f0-9]{64}):(\d+)-(\d+)$/.exec(
        evidence.locator,
    );
    check(match, "Invalid indexed citation locator");
    const [ordinal, start, end] = [match[1], match[3], match[4]].map(Number);
    check(
        [ordinal, start, end].every(Number.isSafeInteger) &&
            end > start &&
            end - start <= 2000,
        "Invalid indexed UTF-16 bounds",
    );
    check(
        typeof evidence.blockText === "string" &&
            sha256(evidence.blockText) === match[2] &&
            evidence.blockText.slice(start, end) === evidence.excerpt &&
            retained.retainedText.includes(evidence.blockText),
        "Indexed block hash/excerpt mismatch",
    );
}

function citationResult(row, content, bundle, mapping) {
    const diagnostics = [];
    for (const citation of content?.citations ?? []) {
        try {
            const receipt = row.citationResolutions.find(
                (r) =>
                    r.sourceId === citation.sourceId &&
                    r.revisionId === citation.revisionId &&
                    r.locator === citation.locator &&
                    r.excerpt === citation.excerpt,
            );
            check(receipt, "Missing exact citation resolution receipt");
            actualEvidence(receipt, bundle, mapping);
            check(
                receipt.resolvedText === citation.excerpt,
                "Service citation excerpt mismatch",
            );
            check(
                row.selectedEvidence.some(
                    (e) =>
                        e.sourceId === citation.sourceId &&
                        e.revisionId === citation.revisionId &&
                        e.locator === citation.locator &&
                        e.excerpt === citation.excerpt,
                ),
                "Citation absent from selected request evidence",
            );
        } catch (error) {
            diagnostics.push(error.message);
        }
    }
    return {
        passed: content !== null && diagnostics.length === 0,
        diagnostics,
    };
}

function validateGold(gold, review, packet, mapping) {
    const constructionHash = validateConstructionPacket(packet);
    check(
        gold.schemaVersion === 1 && gold.constructionHash === constructionHash,
        "Gold construction identity mismatch",
    );
    check(
        review?.status === "approved-independent-human-review" &&
            review.constructionHash === constructionHash &&
            review.goldHash === identity(gold),
        "Gold independent review identity mismatch",
    );
    for (const key of ["author", "reviewer"])
        text(review[key], `gold review ${key}`);
    check(review.author !== review.reviewer, "Gold review must be independent");
    date(review.reviewedAt, "gold reviewedAt");
    const cases = unique(gold.cases, "id", "gold cases");
    check(cases.size === packet.bundles.length, "Gold inventory mismatch");
    for (const bundle of packet.bundles) {
        const entry = cases.get(bundle.id);
        check(entry, "Missing gold case");
        for (const expected of unique(
            entry.expectations,
            "id",
            "gold expectations",
        ).values()) {
            choice(expected.metric, coverageMetrics, "coverage metric");
            check(
                !expected.metric.startsWith("wiki") || bundle.kind === "wiki",
                "Wiki expectation on brief",
            );
            check(
                !expected.metric.startsWith("brief") ||
                    bundle.kind === "projectBrief",
                "Brief expectation on wiki",
            );
            text(expected.requirement, "expectation requirement");
            boolean(expected.critical, "expectation critical");
            boolean(expected.accessible, "expectation accessible");
            check(
                expected.accessible || expected.metric === "wikiReference",
                "Only full wiki reference targets may be unavailable",
            );
            check(
                Array.isArray(expected.witnesses) &&
                    (!expected.accessible || expected.witnesses.length > 0),
                "Accessible gold needs source witnesses",
            );
            for (const witness of expected.witnesses)
                validateCampaignWitness(witness, bundle, mapping);
        }
    }
    return cases;
}

function validateAnnotation(
    annotation,
    row,
    expected,
    bundle,
    mapping,
    goldHash,
    mappingHash,
) {
    check(annotation, `Missing human annotation: ${row.id}`);
    check(
        annotation.status === "approved-independent-human-review" &&
            annotation.goldHash === goldHash &&
            annotation.mappingHash === mappingHash,
        "Annotation gold/mapping binding mismatch",
    );
    text(annotation.author, "annotation author");
    text(annotation.reviewer, "annotation reviewer");
    check(
        annotation.author !== annotation.reviewer,
        "Annotation review must be independent",
    );
    date(annotation.reviewedAt, "annotation reviewedAt");
    check(
        identity(annotation.hashes) === identity(artifactHashes(row)),
        "Annotation output/request identity mismatch",
    );
    boolean(annotation.allVerifiableClaimsReviewed, "complete claim review");
    check(
        annotation.allVerifiableClaimsReviewed,
        "Every verifiable claim requires human review",
    );
    boolean(annotation.savedConsistent, "savedConsistent");
    const claims = unique(annotation.claims, "id", "claims");
    for (const claim of claims.values()) {
        choice(claim.artifact, ["saved", "rendered"], "claim artifact");
        check(
            row[claim.artifact]?.includes(text(claim.quote, "claim quote")),
            "Claim absent from actual artifact",
        );
        boolean(claim.supported, "claim supported");
        boolean(claim.critical, "claim critical");
        text(claim.rationale, "claim rationale");
        strings(claim.errors, "claim errors");
        check(
            claim.errors.every((e) => errorKinds.includes(e)),
            "Unknown factual error category",
        );
        check(
            Array.isArray(claim.witnesses) &&
                (!claim.supported || claim.witnesses.length > 0),
            "Supported claim requires witness",
        );
        for (const witness of claim.witnesses)
            validateCampaignWitness(witness, bundle, mapping);
        if (claim.supported)
            check(
                claim.errors.length === 0,
                "Supported claim cannot contain factual errors",
            );
    }
    const labels = unique(annotation.expectations, "id", "expectation labels");
    check(
        labels.size === expected.expectations.length,
        "Missing/unknown expectation annotation",
    );
    for (const expectation of expected.expectations) {
        const label = labels.get(expectation.id);
        check(label, "Missing expected label");
        for (const key of ["selected", "preserved", "correct"])
            boolean(label[key], `expectation ${key}`);
        text(label.rationale, "expectation rationale");
        check(
            identity(label.witnesses) === identity(expectation.witnesses),
            "Expectation gold witness binding mismatch",
        );
        if (!expectation.accessible)
            check(
                !label.selected && !label.preserved && !label.correct,
                "Unavailable reference cannot be scored supported",
            );
        if (label.selected) {
            text(label.requestQuote, "selected quote");
            check(
                row.serializedRequest?.includes(label.requestQuote) &&
                    expectation.witnesses.some(
                        (w) =>
                            w.quote.includes(label.requestQuote) &&
                            row.selectedEvidence.some(
                                (e) =>
                                    e.sourceId === w.ingestedSourceId &&
                                    e.revisionId === w.revisionId &&
                                    e.corpusId === w.corpusId &&
                                    e.excerpt.includes(label.requestQuote),
                            ),
                    ),
                "Selected gold quote absent from actual selected revision/request",
            );
        }
        if (label.preserved) {
            text(label.outputQuote, "preserved quote");
            check(
                row.rendered?.includes(label.outputQuote),
                "Preservation quote absent from rendered output",
            );
        }
        if (label.correct) {
            check(
                label.preserved,
                "Correct fact requires rendered preservation",
            );
            text(label.savedQuote, "saved fact quote");
            check(
                row.saved?.includes(label.savedQuote),
                "Correct fact quote absent from saved artifact",
            );
        }
    }
    return annotation;
}

function coverage(expected, annotation, metric, field, accessibleOnly = false) {
    const targets = expected.expectations.filter(
        (e) => e.metric === metric && (!accessibleOnly || e.accessible),
    );
    return campaignRatio(
        targets.filter((e) => {
            const label = annotation?.expectations.find(
                (entry) => entry.id === e.id,
            );
            return label?.[field] && (field !== "preserved" || label.correct);
        }).length,
        targets.length,
    );
}

function aggregate(rows) {
    const metrics = Object.fromEntries(
        scoreMetricNames
            .filter((key) => key !== "criticalErrors")
            .map((key) => [
                key,
                campaignRatio(
                    rows.reduce((n, row) => n + row.metrics[key].numerator, 0),
                    rows.reduce(
                        (n, row) => n + (row.metrics[key].denominator ?? 0),
                        0,
                    ),
                ),
            ]),
    );
    return {
        attempts: rows.length,
        failures: campaignRatio(
            rows.filter((r) => r.status !== "ok").length,
            rows.length,
        ),
        metrics,
        criticalErrors: rows.reduce((n, row) => n + row.criticalErrors, 0),
        errors: Object.fromEntries(
            errorKinds.map((key) => [
                key,
                rows.reduce((n, row) => n + row.errors[key], 0),
            ]),
        ),
        unknownClaimAttempts: rows.filter(
            (r) => r.metrics.supportedClaims.denominator === null,
        ).length,
        telemetry: Object.fromEntries(
            telemetryKeys.map((key) => {
                const values = rows.map((r) => r.telemetry[key]);
                const known = values.filter((value) => value !== null);
                return [
                    key,
                    {
                        knownTotal: known.length
                            ? known.reduce((a, b) => a + b, 0)
                            : null,
                        knownAttempts: known.length,
                        unknownAttempts: values.length - known.length,
                    },
                ];
            }),
        ),
    };
}

function gates(summary, campaign, live) {
    const mandatory =
        summary.metrics.attemptSuccess.value === 1 &&
        summary.metrics.structural.value === 1 &&
        summary.metrics.citations.value === 1 &&
        summary.metrics.renderedDelivery.value === 1 &&
        summary.criticalErrors === 0;
    if (campaign.dataset === "original")
        return {
            status: mandatory
                ? "passed-structural-citation-critical-gate"
                : "failed",
            qualityQualified: false,
        };
    if (campaign.thresholds === null)
        return { status: "not-preregistered", qualityQualified: false };
    const thresholds = campaign.thresholds.metrics.map((threshold) => {
        const value =
            threshold.metric === "criticalErrors"
                ? summary.criticalErrors
                : summary.metrics[threshold.metric].value;
        return {
            ...threshold,
            observed: value,
            passed:
                value !== null &&
                (threshold.direction === "minimum"
                    ? value >= threshold.value
                    : value <= threshold.value),
        };
    });
    const passed = mandatory && thresholds.every((t) => t.passed);
    return {
        status: passed ? "passed-preregistered-gates" : "failed",
        qualityQualified: passed && live && summary.unknownClaimAttempts === 0,
        thresholds,
    };
}

export function scoreCampaignArtifacts(
    packet,
    campaign,
    run,
    outputs,
    annotations,
    gold,
    review,
    mapping,
) {
    check(
        outputs.requestEvidenceKind !== "indexed-build-snapshot",
        "Indexed build snapshots are not wire requests; use validateExampleRunArtifacts for diagnostic validation",
    );
    check(
        outputs.qualityBaseline !== false,
        "Example artifacts cannot be scored as production quality",
    );
    const runHash = validateCampaignOutputs(
        packet,
        campaign,
        run,
        outputs,
        mapping,
    );
    const retained = validateIngestionMapping(mapping, packet);
    const expectedCases = validateGold(gold, review, packet, retained);
    check(
        annotations.schemaVersion === 1 &&
            annotations.runHash === runHash &&
            annotations.goldHash === identity(gold),
        "Annotations run/gold identity mismatch",
    );
    const labels = unique(annotations.records, "id", "annotations");
    const rows = unique(outputs.records, "id", "outputs");
    for (const id of labels.keys())
        check(rows.has(id), "Unknown annotation slot");
    const details = campaignSchedule(run).map((slot) => {
        const row = rows.get(slot.id);
        const bundle = packet.bundles.find((b) => b.id === slot.caseId);
        const expected = expectedCases.get(slot.caseId);
        for (const evidence of row.selectedEvidence) {
            actualEvidence(evidence, bundle, retained);
            check(
                row.serializedRequest?.includes(evidence.excerpt),
                "Selected excerpt absent from serialized request",
            );
        }

        const needsLabel = ["saved", "rendered", "serializedRequest"].some(
            (key) => row[key] !== null,
        );
        const annotation = needsLabel
            ? validateAnnotation(
                  labels.get(slot.id),
                  row,
                  expected,
                  bundle,
                  retained,
                  identity(gold),
                  identity(mapping),
              )
            : null;
        if (!needsLabel)
            check(
                !labels.has(slot.id),
                "Annotation for attempt without artifacts",
            );
        let content = null;
        const diagnostics = [];
        if (row.saved !== null) {
            try {
                content = savedContent(row, bundle);
            } catch (error) {
                diagnostics.push(error.message);
            }
        }
        const citations = citationResult(row, content, bundle, retained);
        diagnostics.push(...citations.diagnostics);
        const delivery =
            content !== null &&
            row.rendered !== null &&
            [
                content.title,
                content.summary,
                ...content.sections.map((s) => s.body),
            ].every((s) => row.rendered.includes(s)) &&
            annotation?.savedConsistent;
        const criticalClaims =
            annotation?.claims.filter((c) => c.critical && !c.supported)
                .length ?? 0;
        const criticalFacts = expected.expectations.filter(
            (e) =>
                e.critical &&
                annotation?.expectations.find((label) => label.id === e.id)
                    ?.preserved &&
                !annotation.expectations.find((label) => label.id === e.id)
                    .correct,
        ).length;
        const successful = row.status === "ok";
        const preservation = successful ? annotation : null;
        return {
            ...slot,
            status: row.status,
            stage: row.stage,
            component: row.component,
            reason: row.reason,
            targetDisposition: row.targetDisposition,
            hashes: row.hashes,
            diagnostics,
            criticalErrors: criticalClaims + criticalFacts,
            errors: Object.fromEntries(
                errorKinds.map((key) => [
                    key,
                    annotation?.claims.filter((claim) =>
                        claim.errors.includes(key),
                    ).length ?? 0,
                ]),
            ),
            telemetry: row.telemetry,
            metrics: {
                structural: campaignRatio(
                    Number(successful && content !== null),
                    1,
                ),
                citations: campaignRatio(
                    Number(successful && citations.passed),
                    1,
                ),
                supportedClaims: campaignRatio(
                    annotation?.claims.filter((c) => c.supported).length ?? 0,
                    annotation?.claims.length ?? 0,
                ),
                selectedQualification: coverage(
                    expected,
                    annotation,
                    "qualification",
                    "selected",
                ),
                preservedQualification: coverage(
                    expected,
                    preservation,
                    "qualification",
                    "preserved",
                ),
                wikiFullReference: coverage(
                    expected,
                    preservation,
                    "wikiReference",
                    "preserved",
                ),
                wikiAccessibleReference: coverage(
                    expected,
                    preservation,
                    "wikiReference",
                    "preserved",
                    true,
                ),
                briefQueryCoverage: coverage(
                    expected,
                    preservation,
                    "briefQuery",
                    "preserved",
                ),
                briefTypedAccuracy: coverage(
                    expected,
                    preservation,
                    "briefTypedFact",
                    "correct",
                ),
                renderedDelivery: campaignRatio(
                    Number(successful && delivery),
                    1,
                ),
                attemptSuccess: campaignRatio(Number(successful), 1),
            },
        };
    });
    const arms = Object.fromEntries(
        run.arms.map((arm) => {
            const summary = aggregate(details.filter((r) => r.arm === arm.id));
            return [
                arm.id,
                {
                    ...summary,
                    execution: arm.execution,
                    gate: gates(summary, campaign, arm.execution === "live"),
                },
            ];
        }),
    );
    const clusters = Object.fromEntries(
        clusterKinds.map((kind) => {
            const ids = new Set(
                campaign.inventory.flatMap((entry) => entry.clusters[kind]),
            );
            return [
                kind,
                [...ids].sort().map((id) => {
                    const caseIds = campaign.inventory
                        .filter((entry) => entry.clusters[kind].includes(id))
                        .map((entry) => entry.id);
                    return {
                        id,
                        caseIds,
                        arms: Object.fromEntries(
                            run.arms.map((arm) => [
                                arm.id,
                                aggregate(
                                    details.filter(
                                        (r) =>
                                            r.arm === arm.id &&
                                            caseIds.includes(r.caseId),
                                    ),
                                ),
                            ]),
                        ),
                    };
                }),
            ];
        }),
    );
    return {
        schemaVersion: 1,
        contract: campaignContract,
        campaignHash: identity(campaign),
        runHash,
        constructionHash: identity(packet),
        goldHash: identity(gold),
        reviewHash: identity(review),
        mappingHash: identity(mapping),
        annotationsHash: identity(annotations),
        outputsHash: identity(outputs),
        kind: "traceable-human-reviewed-scorecard",
        uncertainty:
            "Descriptive cluster summaries only; repeated generations and overlapping source clusters are not independent samples. No confidence interval or causal comparison is inferred.",
        arms,
        clusters,
        details,
    };
}

function parseArtifact(raw, name) {
    text(raw, `${name} exact artifact string`);
    return JSON.parse(raw);
}

function verifyExampleReceiptHash(raw, expected, name) {
    hash(expected, `receipt.${name}Hash`);
    check(sha256(raw) === expected, `Example ${name} receipt hash mismatch`);
    return {
        exactStringIdentity: identity(raw),
        fileSha256: sha256(raw),
        receiptFileSha256: expected,
    };
}

function exampleMapping(packet, bundle, entries, corpusId) {
    check(Array.isArray(entries), "Example source-mapping array required");
    const records = entries.map((entry) => {
        const source = bundle.sources.find(
            (s) =>
                s.id === entry.datasetSourceId &&
                s.version === entry.sourceVersion,
        );
        check(
            source &&
                entry.caseId === bundle.id &&
                entry.dataset === packet.dataset,
            "Example dataset/source mapping mismatch",
        );
        check(
            entry.corpusId === corpusId &&
                entry.retainedSha256 === source.sha256 &&
                entry.contentHash === source.sha256,
            "Example retained source/revision hash mismatch",
        );
        if (entry.datasetRelease !== undefined)
            check(
                identity(entry.datasetRelease) === identity(packet.release),
                "Example dataset release mismatch",
            );
        check(
            entry.receipt?.state === "complete",
            "Example ingestion receipt is not complete",
        );
        return {
            caseId: bundle.id,
            sourceId: source.id,
            sourceVersion: source.version,
            corpusId,
            ingestedSourceId: entry.sourceId,
            revisionId: entry.revisionId,
            contentHash: entry.contentHash,
            retainedText: source.text,
        };
    });
    check(
        records.length === bundle.sources.length,
        "Example mapping must retain every construction source",
    );
    const mapping = {
        schemaVersion: 1,
        constructionHash: identity(packet),
        records,
    };
    validateIngestionMapping(mapping, packet);
    return mapping;
}

function examplePassages(snapshots, bundle, version, mapping) {
    check(
        Array.isArray(snapshots) && snapshots.length > 0,
        "Example indexed build snapshots required",
    );
    const passages = [];
    for (const snapshot of snapshots) {
        check(
            snapshot.corpusId === version.corpusId &&
                snapshot.definition?.viewId === version.viewId &&
                snapshot.definition.kind === bundle.kind,
            "Example build snapshot target identity mismatch",
        );
        const pipeline =
            bundle.kind === "wiki"
                ? "informational-wiki-v1"
                : "informational-project-summary-v1";
        check(
            snapshot.pipeline === pipeline,
            "Example build snapshot pipeline mismatch",
        );
        check(
            Array.isArray(snapshot.inputs),
            "Example snapshot inputs required",
        );
        for (const input of snapshot.inputs) {
            const source = mapping.records.find(
                (r) =>
                    r.ingestedSourceId === input.sourceId &&
                    r.revisionId === input.revisionId &&
                    r.corpusId === snapshot.corpusId,
            );
            check(source, "Example snapshot source/revision mapping mismatch");
            hash(input.contentHash, "snapshot contentHash");
            check(
                Array.isArray(input.passages),
                "Example selected indexed passages required",
            );
            for (const passage of input.passages) {
                check(
                    passage.sourceId === input.sourceId &&
                        passage.revisionId === input.revisionId,
                    "Example passage source/revision mismatch",
                );
                text(passage.excerpt, "example passage excerpt");
                check(
                    source.retainedText.includes(passage.excerpt),
                    "Example selected excerpt absent from retained construction source",
                );
                check(
                    /^indexed:\d+:[a-f0-9]{64}:\d+-\d+$/.test(passage.locator),
                    "Example indexed locator required",
                );
                const [, ordinal, , start, end] =
                    /^indexed:(\d+):([a-f0-9]{64}):(\d+)-(\d+)$/.exec(
                        passage.locator,
                    );
                check(
                    [ordinal, start, end]
                        .map(Number)
                        .every(Number.isSafeInteger) &&
                        Number(end) > Number(start) &&
                        Number(end) - Number(start) ===
                            passage.excerpt.length &&
                        passage.excerpt.length <= 2000,
                    "Example indexed UTF-16 bounds mismatch",
                );
                passages.push({
                    corpusId: snapshot.corpusId,
                    snapshotContentHash: input.contentHash,
                    ...passage,
                });
            }
        }
    }
    return passages;
}

export function validateExampleRunArtifacts(packet, artifacts) {
    const constructionHash = validateConstructionPacket(packet);
    const receipt = parseArtifact(artifacts.receipt, "receipt");
    check(
        receipt.schemaVersion === 1 && receipt.status === "ok",
        "Successful example receipt required; failed/missing attempts remain separate campaign slots",
    );
    check(
        ["offline", "live"].includes(receipt.mode) &&
            receipt.qualityBaseline === false &&
            receipt.requestEvidenceKind === "indexed-build-snapshot",
        "Example receipt evidence/custody declaration required",
    );
    const bundle = packet.bundles.find((b) => b.id === receipt.caseId);
    check(
        bundle && receipt.inputHash === identity(bundle),
        "Example construction bundle identity mismatch",
    );
    const version = parseArtifact(artifacts.saved, "saved ViewVersion");
    check(
        version.content &&
            version.corpusId === receipt.corpusId &&
            version.revisionId === receipt.revisionId,
        "Example saved revision/receipt mismatch",
    );
    const hashes = {
        saved: verifyExampleReceiptHash(
            artifacts.saved,
            receipt.savedHash,
            "saved",
        ),
        rendered: verifyExampleReceiptHash(
            artifacts.rendered,
            receipt.renderedHash,
            "rendered",
        ),
        requestEvidence: verifyExampleReceiptHash(
            artifacts.requestEvidence,
            receipt.requestHash,
            "request",
        ),
        sourceMapping: {
            exactStringIdentity: identity(artifacts.sourceMapping),
            fileSha256: sha256(artifacts.sourceMapping),
        },
        receipt: {
            exactStringIdentity: identity(artifacts.receipt),
            fileSha256: sha256(artifacts.receipt),
        },
    };
    const mapping = exampleMapping(
        packet,
        bundle,
        parseArtifact(artifacts.sourceMapping, "source-mapping"),
        version.corpusId,
    );
    const snapshots = parseArtifact(
        artifacts.requestEvidence,
        "request-evidence",
    );
    const passages = examplePassages(snapshots, bundle, version, mapping);
    const content = savedContent(
        { saved: artifacts.saved, targetViewId: version.viewId },
        bundle,
    );
    check(
        [
            content.title,
            content.summary,
            ...content.sections.map((s) => s.body),
        ].every((s) => artifacts.rendered.includes(s)),
        "Example readable title/summary/body delivery mismatch",
    );
    for (const citation of content.citations)
        check(
            passages.some(
                (p) =>
                    p.sourceId === citation.sourceId &&
                    p.revisionId === citation.revisionId &&
                    p.locator === citation.locator &&
                    p.excerpt === citation.excerpt,
            ),
            "Example saved citation differs from indexed snapshot selection",
        );
    return {
        schemaVersion: 1,
        contract: "informational-example-artifact-bridge-v1",
        status: "validated-structural-and-selection-consistency",
        constructionHash,
        caseId: bundle.id,
        corpusId: version.corpusId,
        viewId: version.viewId,
        revisionId: version.revisionId,
        qualityBaseline: false,
        productionQualityEligible: false,
        semanticQualityEvaluated: false,
        offlineInjected:
            receipt.mode === "offline" || receipt.injectedBehavior != null,
        requestEvidenceKind: "indexed-build-snapshot",
        serializedRequest: null,
        hashes,
        mapping,
        mappingHash: identity(mapping),
        selectedPassages: passages,
        citationChecks: {
            sourceAndSelectionConsistent: content.citations.length,
            serviceResolutionEvidence: "not-retained",
            indexedBlockHashVerification: "not-retained",
            snapshotSourceContentHashVerification: "not-retained",
        },
        telemetry: {
            calls: null,
            tokens: null,
            reservations: null,
            latencyMs: null,
            cost: null,
        },
        runnerElapsedMs:
            Number.isFinite(receipt.latencyMs) && receipt.latencyMs >= 0
                ? receipt.latencyMs
                : null,
        limitations:
            "Diagnostic only. Indexed snapshots are not wire prompts; elapsed runner time is not provider latency; absent usage and service citation-resolution receipts are unknown. Do not score these artifacts as production quality.",
    };
}
