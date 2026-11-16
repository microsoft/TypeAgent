// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check, identity, sha256, unique } from "./quality-contract.mjs";
import {
    validateConstructionPacket,
    validateIngestionMapping,
    validateCampaignWitness,
} from "./quality-view-campaign.mjs";
import {
    captureProviderEvents,
    scheduledCheckpoints,
    validateCitationCapture,
} from "./quality-view-campaign-capture.mjs";
import { validateGroupSplit } from "./quality-view-campaign-review.mjs";

const pending = "pending-independent-human-review";
const unsafe =
    /^(?:quality-fixtures|holdout|heldout|evaluator-only(?:\.json)?|\.npmrc|\.env(?:\..*)?|config\.local\.ya?ml|credentials(?:\..*)?|secrets(?:\..*)?)$/i;

async function safeRoot(filename, existing) {
    const absolute = path.resolve(filename);
    const parsed = path.parse(absolute);
    let current = parsed.root;
    const parts = absolute
        .slice(parsed.root.length)
        .split(path.sep)
        .filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
        check(
            !unsafe.test(parts[index]),
            "Frozen/holdout/credential root refused",
        );
        current = path.join(current, parts[index]);
        try {
            const stat = await lstat(current);
            check(
                !stat.isSymbolicLink() && stat.isDirectory(),
                "Root must use real directories",
            );
            check(
                existing || index !== parts.length - 1,
                "Output already exists",
            );
        } catch (error) {
            if (
                !existing &&
                index === parts.length - 1 &&
                error.code === "ENOENT"
            )
                return absolute;
            throw error;
        }
    }
    return realpath(absolute);
}

function safeId(id) {
    check(
        typeof id === "string" &&
            /^[a-z0-9][a-z0-9._-]*$/i.test(id) &&
            !unsafe.test(id) &&
            !id.endsWith(".") &&
            !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id),
        "Unsafe case/scenario ID",
    );
    return id;
}

async function artifact(root, name, optional = false) {
    let current = root;
    for (const piece of name.split(path.sep)) {
        current = path.join(current, piece);
        try {
            const stat = await lstat(current);
            check(!stat.isSymbolicLink(), "Symlink/junction artifact refused");
        } catch (error) {
            if (optional && error.code === "ENOENT") return null;
            throw error;
        }
    }
    return readFile(current, "utf8");
}

const parse = (raw) => JSON.parse(raw.replace(/^\uFEFF/, ""));
const binding = (raw) =>
    raw === null
        ? null
        : {
              sha256: sha256(raw),
              identity: identity(raw),
          };

async function retain(root, output, name, ledger, optional = false) {
    const raw = await artifact(root, name, optional);
    ledger[name] = binding(raw);
    if (raw !== null) {
        const destination = path.join(output, "custodian", "originals", name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, raw, { flag: "wx" });
    }
    return raw;
}

async function checkpointInputs(root, output, slot, ledger) {
    const prefix = path.join(slot.caseId, `checkpoint-${slot.checkpoint}-`);
    const result = {};
    for (const [key, suffix] of Object.entries({
        saved: "saved.json",
        rendered: "rendered.txt",
        mapping: "source-mapping.json",
        ingestion: "ingestion.json",
        job: "job.json",
        evidence: "evidence.json",
        operations: "operations.json",
    })) {
        result[key] = await retain(root, output, prefix + suffix, ledger, true);
    }
    return result;
}

function buildPacket(frozen, frozenRaw, slots, inputs) {
    return {
        schemaVersion: 1,
        purpose: "construction-only",
        dataset: "original",
        release: {
            repository: "retained-synthetic-development-run",
            revision: sha256(frozenRaw),
            files: [{ path: "frozen-cases.json", sha256: sha256(frozenRaw) }],
            license:
                "Original authored synthetic development sources; no external acquisition",
        },
        bundles: slots.map((slot) => {
            const scenario = frozen.scenarios.find(
                (entry) => entry.id === slot.scenario,
            );
            check(scenario, "Unknown scheduled scenario");
            const sources = scenario.sources
                .slice(0, slot.checkpoint + 1)
                .map((text, checkpoint) => {
                    const sourceInput = inputs.find(
                        (_, otherIndex) =>
                            slots[otherIndex].caseId === slot.caseId &&
                            slots[otherIndex].checkpoint === checkpoint,
                    );
                    const ingestion = sourceInput?.ingestion
                        ? parse(sourceInput.ingestion)
                        : null;
                    return {
                        id:
                            ingestion?.sourceId ??
                            `${slot.scenario}-unmapped-${checkpoint}`,
                        version: sha256(text),
                        title: `${slot.scenario} source ${checkpoint}`,
                        text,
                        sha256: sha256(text),
                    };
                });
            check(
                sources.length === slot.checkpoint + 1,
                "Frozen checkpoint sources missing",
            );
            return {
                id: `${slot.caseId}-checkpoint-${slot.checkpoint}`,
                kind: slot.kind,
                query: scenario.query,
                aliases: [],
                sources,
            };
        }),
    };
}

function buildMapping(packet, slots, inputs) {
    const records = [];
    slots.forEach((slot, index) => {
        const input = inputs[index];
        const entries = input.mapping === null ? [] : parse(input.mapping);
        check(Array.isArray(entries), "Source mapping array required");
        const saved = input.saved === null ? null : parse(input.saved);
        const ingestion =
            input.ingestion === null ? null : parse(input.ingestion);
        const corpusId = saved?.corpusId ?? ingestion?.corpusId;
        for (const entry of entries) {
            const source = packet.bundles[index].sources.find(
                (source) => source.id === entry.sourceId,
            );
            check(
                source && corpusId && entry.revisionId,
                "Unbound checkpoint mapping",
            );
            records.push({
                caseId: packet.bundles[index].id,
                sourceId: source.id,
                sourceVersion: source.version,
                corpusId,
                ingestedSourceId: entry.sourceId,
                revisionId: entry.revisionId,
                contentHash: source.sha256,
                retainedText: source.text,
            });
        }
    });
    return { schemaVersion: 1, constructionHash: identity(packet), records };
}

function draftTasks(slot, bundle, witnesses, previous, previousBundle) {
    const shared = {
        status: pending,
        applicability: null,
        critical: null,
        witnesses: [],
        candidateWitnesses: witnesses,
    };
    const tasks = [];
    if (slot.kind === "projectBrief")
        tasks.push({
            ...shared,
            id: "draft-issue-order",
            metric: "issueOrdering",
            requirement:
                "Identify current consequential blockers and supported consequences; define acceptable ordering without inventing formal severity.",
            before: null,
            after: null,
            basis: null,
        });
    if (slot.topics)
        for (const metric of [
            "topicAdmission",
            "topicFalseMerge",
            "topicFalseSplit",
        ])
            tasks.push({
                ...shared,
                id: `draft-${metric}`,
                metric,
                requirement:
                    "Review source-grounded admission and same/different/uncertain occurrence membership; retain acceptable alternative organizations.",
                subject: bundle.query,
                expected: null,
            });
    if (previous !== undefined)
        for (const metric of [
            "correctionUptake",
            "staleClaimRemoval",
            "unaffectedPreservation",
        ])
            tasks.push({
                ...shared,
                id: `draft-${metric}`,
                metric,
                requirement:
                    "Compare this update with the exact preceding saved/rendered checkpoint. Identify material corrections, obsolete current claims and facts that must remain unaffected.",
                previousCheckpointId: previousBundle.id,
                ...(metric === "staleClaimRemoval"
                    ? { obsoleteQuote: null, expected: null }
                    : {}),
            });
    return tasks;
}

function completedOperation(receipt) {
    const required = {
        "source-removal": [
            "sourceRemoved",
            "currentViewPurged",
            "sourceIndexEmpty",
        ],
        "human-edit": ["protectedTextRetained", "retainedAfterRestart"],
        "confirmed-separation": [
            "noChildBeforeConfirmation",
            "allChildrenIndexReady",
            "overviewContentUnchanged",
        ],
    }[receipt.kind];
    return (
        receipt.state === "complete" &&
        required?.every((name) => receipt.checks?.[name] === true) &&
        Object.values(receipt.checks).every((value) => value === true)
    );
}

function draftGold(packet, mapping, frozen, slots, inputs) {
    const retained = validateIngestionMapping(mapping, packet);
    return {
        schemaVersion: 1,
        constructionHash: identity(packet),
        status: pending,
        cases: packet.bundles.map((bundle, index) => {
            const slot = slots[index];
            const scenario = frozen.scenarios.find(
                (entry) => entry.id === slot.scenario,
            );
            const witnesses = mapping.records
                .filter((row) => row.caseId === bundle.id)
                .map((row) => ({
                    sourceId: row.sourceId,
                    sourceVersion: row.sourceVersion,
                    corpusId: row.corpusId,
                    ingestedSourceId: row.ingestedSourceId,
                    revisionId: row.revisionId,
                    quote: row.retainedText,
                }));
            for (const witness of witnesses)
                validateCampaignWitness(witness, bundle, retained);
            const previousIndex = slots.findIndex(
                (previous) =>
                    previous.caseId === slot.caseId &&
                    previous.checkpoint === slot.checkpoint - 1,
            );
            return {
                id: bundle.id,
                expectations: (
                    scenario.expectations?.[slot.checkpoint] ?? []
                ).map((requirement, number) => ({
                    id: `draft-${number + 1}`,
                    metric:
                        slot.kind === "wiki"
                            ? "wikiReference"
                            : "briefTypedFact",
                    requirement,
                    critical: null,
                    accessible: null,
                    witnesses: [],
                    candidateWitnesses: witnesses,
                    status: "draft-requires-atomic-grounding-and-answerability-review",
                })),
                tasks: draftTasks(
                    slot,
                    bundle,
                    witnesses,
                    previousIndex < 0 ? undefined : inputs[previousIndex],
                    packet.bundles[previousIndex],
                ),
                taskReview: {
                    ordering: "domain-review-required",
                    topic: slot.topics
                        ? "admission-and-scope-review-required"
                        : "not-annotated",
                    maintenance:
                        slot.checkpoint > 0
                            ? "correction-and-preservation-review-required"
                            : "initial-build",
                    sourceForgetting:
                        inputs[index].operations !== null &&
                        parse(inputs[index].operations).some(
                            (receipt) => receipt.kind === "source-removal",
                        )
                            ? "operation-only-purge-review-required-not-construction-credit"
                            : "not-exercised",
                    humanEditGuard:
                        inputs[index].operations !== null &&
                        parse(inputs[index].operations).some(
                            (receipt) => receipt.kind === "human-edit",
                        )
                            ? "execution-receipts-require-independent-review"
                            : "not-exercised",
                },
            };
        }),
    };
}

function blindedRecord(slot, bundle, input, gold, label) {
    return {
        id: label,
        status: pending,
        kind: slot.kind,
        checkpoint: slot.checkpoint,
        // Content is projected for blinding; originals and exact hashes remain in custody.
        savedContent: input.saved === null ? null : parse(input.saved).content,
        rendered: input.rendered,
        sources: bundle.sources.map(({ title, text, sha256 }) => ({
            title,
            text,
            sha256,
        })),
        draftRequirements: gold.expectations.map(({ id, requirement }) => ({
            id,
            requirement,
        })),
        operationObservations: (input.operations === null
            ? []
            : parse(input.operations)
        ).map((receipt) => ({
            kind: receipt.kind,
            state: receipt.state,
            checks: receipt.checks,
            protectedQuote: receipt.protectedQuote ?? null,
            editedContent:
                receipt.kind === "human-edit"
                    ? (receipt.response?.version?.content ?? null)
                    : null,
            childContents: (receipt.childViews ?? []).map(
                (view) => view.content,
            ),
            retainedOverview: receipt.originalView?.content ?? null,
            provenance:
                "automated-synthetic-service-execution-not-independent-semantic-judgment",
            independentVerdict: null,
        })),
        claims: [],
        expectations: gold.expectations.map(({ id }) => ({
            id,
            selected: null,
            preserved: null,
            correct: null,
            requestQuote: null,
            outputQuote: null,
            savedQuote: null,
            rationale: null,
        })),
        tasks: gold.tasks.map((task) => ({
            id: task.id,
            metric: task.metric,
            requirement: task.requirement,
            applicability: null,
            correct: null,
            rationale: null,
            evidence: [],
        })),
        editorial: {
            clarity: null,
            caveatRelevance: null,
            usefulness: null,
            rationale: null,
        },
        allVerifiableClaimsReviewed: null,
    };
}

function frozenIdentityEncoding(expected, raw, frozen) {
    const encodings = [
        ["sha256-exact-utf8", sha256(raw)],
        ["identity-parsed-object", identity(frozen)],
        [
            "identity-scenarios-and-schedule",
            identity({
                scenarios: frozen.scenarios,
                schedule: frozen.schedule,
            }),
        ],
    ];
    const match = encodings.find(([, hash]) => hash === expected);
    check(match, "Frozen cases byte identity mismatch");
    return match[0];
}

function captureCompleteness(caseId, tapeRaw, records) {
    const expected =
        tapeRaw === null ? null : (parse(tapeRaw).providerCalls ?? null);
    check(
        expected === null || (Number.isSafeInteger(expected) && expected >= 0),
        "Invalid recorded provider call count",
    );
    return {
        caseId,
        recordedProviderCalls: expected,
        retainedEvents: records?.length ?? null,
        completeEventCount:
            expected === null || records === null
                ? null
                : expected === records.length,
        actualRequests:
            records?.filter((call) => call.actualSerializedRequest !== null)
                .length ?? null,
        unknownUsageEvents:
            records?.filter((call) => call.telemetry.tokens === null).length ??
            null,
        unassignedEvents:
            records?.filter((call) => call.checkpoint === null).length ?? null,
    };
}

async function captureCaseCalls(root, output, slots, inputs, ledger) {
    const calls = {};
    const completeness = [];
    for (const caseId of new Set(slots.map((slot) => slot.caseId))) {
        const eventsRaw = await retain(
            root,
            output,
            path.join(caseId, "provider-events.json"),
            ledger,
            true,
        );
        const tapeRaw = await retain(
            root,
            output,
            path.join(caseId, "model-tape.json"),
            ledger,
            true,
        );
        for (const name of ["explicit-review.json", "final-inventory.json"])
            await retain(root, output, path.join(caseId, name), ledger, true);
        const jobs = slots.flatMap((slot, index) =>
            slot.caseId === caseId && inputs[index].job !== null
                ? [{ ...parse(inputs[index].job), checkpoint: slot.checkpoint }]
                : [],
        );
        calls[caseId] =
            eventsRaw === null
                ? null
                : captureProviderEvents(parse(eventsRaw), jobs);
        completeness.push(captureCompleteness(caseId, tapeRaw, calls[caseId]));
    }
    return { calls, completeness };
}

function draftAttempts(slots, packet, inputs, gold, calls, seed) {
    const custody = [];
    const reviewer = [];
    slots.forEach((slot, index) => {
        const label = `sample-${sha256(`${seed}:${packet.bundles[index].id}`).slice(0, 20)}`;
        const input = inputs[index];
        const evidence = input.evidence === null ? null : parse(input.evidence);
        if (evidence) validateCitationCapture(evidence, input.saved);
        const callRecords =
            calls[slot.caseId]?.filter(
                (call) => call.checkpoint === slot.checkpoint,
            ) ?? [];
        custody.push({
            id: label,
            caseId: packet.bundles[index].id,
            scenario: slot.scenario,
            checkpoint: slot.checkpoint,
            status: slot.status,
            stage: slot.stage,
            reason: slot.reason,
            originalResult: slot.result,
            hashes: {
                savedHash: input.saved === null ? null : identity(input.saved),
                renderedHash:
                    input.rendered === null ? null : identity(input.rendered),
            },
            providerEventOrdinals: callRecords.map((call) => call.ordinal),
            requestAssociation:
                "retained-job-time-window-not-authoritative-phase-receipt",
            qualityMatrixEligible: false,
            evidenceCapture: evidence,
            taskBindings: gold.cases[index].tasks
                .filter((task) => task.previousCheckpointId !== undefined)
                .map((task) => {
                    const previous =
                        inputs[
                            packet.bundles.findIndex(
                                (bundle) =>
                                    bundle.id === task.previousCheckpointId,
                            )
                        ];
                    return {
                        id: task.id,
                        previousSavedHash:
                            previous.saved === null
                                ? null
                                : identity(previous.saved),
                        previousRenderedHash:
                            previous.rendered === null
                                ? null
                                : identity(previous.rendered),
                    };
                }),
            operationReceipts:
                input.operations === null ? [] : parse(input.operations),
            blockers: [
                "independent-gold-and-annotations-pending",
                ...(evidence
                    ? []
                    : ["citation-resolution-receipts-not-retained"]),
                ...(callRecords.length === 0
                    ? ["checkpoint-request-association-unavailable"]
                    : []),
            ],
        });
        reviewer.push(
            blindedRecord(
                slot,
                packet.bundles[index],
                input,
                gold.cases[index],
                label,
            ),
        );
    });
    reviewer.sort((a, b) => a.id.localeCompare(b.id));
    return { custody, reviewer };
}

async function pilotInventory(filename) {
    if (filename === undefined) return null;
    check(
        path.basename(filename) === "manifest.json",
        "Only pilot manifest metadata may be read",
    );
    check(
        !(await lstat(filename)).isSymbolicLink(),
        "Pilot manifest symlink refused",
    );
    const manifest = parse(await readFile(filename, "utf8"));
    return {
        id: manifest.id,
        frozenAt: manifest.frozenAt,
        goldReviewStatus: manifest.goldReviewStatus,
        caseCount: Object.values(manifest.splits).flat().length,
        developmentIds: [
            ...manifest.splits.wikiDevelopment,
            ...manifest.splits.briefDevelopment,
        ],
        holdoutCount:
            manifest.splits.wikiHoldout.length +
            manifest.splits.briefHoldout.length,
        evaluatorLabelsRead: false,
        acquisitionInventory: "No acquired source/reference files inspected",
    };
}

async function writeDocuments(output, documents) {
    for (const [name, value] of Object.entries(documents)) {
        const destination = path.join(output, ...name.split("\\"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, JSON.stringify(value, null, 2) + "\n", {
            flag: "wx",
        });
    }
}

export async function prepareReviewPackage({
    inputRoot,
    outputRoot,
    seed,
    pilotManifest,
}) {
    check(
        typeof seed === "string" && seed.trim(),
        "Explicit blinding seed required",
    );
    const root = await safeRoot(inputRoot, true);
    const output = await safeRoot(outputRoot, false);
    check(
        !output.startsWith(root + path.sep) && root !== output,
        "Output must be outside input root",
    );
    const marker = parse(await artifact(root, ".wiki-views-owned.json"));
    check(
        marker.schemaVersion === 1 && marker.owner === "wiki-views",
        "Owned example root required",
    );
    const raw = {};
    for (const name of ["frozen-cases.json", "identity.json", "results.json"])
        raw[name] = await artifact(root, name);
    const frozen = parse(raw["frozen-cases.json"]);
    const runIdentity = parse(raw["identity.json"]);
    check(
        runIdentity.live === true && runIdentity.confirmation === false,
        "Only retained live development capture is accepted",
    );
    const frozenHashEncoding = frozenIdentityEncoding(
        runIdentity.frozenCasesHash,
        raw["frozen-cases.json"],
        frozen,
    );
    const slots = scheduledCheckpoints(frozen, parse(raw["results.json"]));
    for (const slot of slots) {
        safeId(slot.caseId);
        safeId(slot.scenario);
    }
    unique(frozen.scenarios, "id", "scenarios");
    await mkdir(output);
    const ledger = {};
    for (const name of Object.keys(raw))
        await retain(root, output, name, ledger);
    for (const name of [
        "authorization.json",
        "telemetry-summary.json",
        "summary.json",
        "evaluation-report.json",
        "final-topics.json",
        "last-checks.json",
        "citation-resolution-execution.json",
        "topics-review-snapshot.json",
        "operation-execution.json",
        "forgetting-recovery.json",
    ])
        await retain(root, output, name, ledger, true);
    const inputs = [];
    for (const slot of slots)
        inputs.push(await checkpointInputs(root, output, slot, ledger));
    const packet = buildPacket(frozen, raw["frozen-cases.json"], slots, inputs);
    validateConstructionPacket(packet);
    const mapping = buildMapping(packet, slots, inputs);
    const gold = draftGold(packet, mapping, frozen, slots, inputs);
    const inventory = slots.map((slot, index) => ({
        id: packet.bundles[index].id,
        clusters: {
            source: [slot.scenario],
            project: [slot.scenario],
            topic: [slot.scenario],
            meeting: [],
        },
    }));
    const split = inventory.map(({ id }) => ({ id, phase: "development" }));
    validateGroupSplit(inventory, split);
    const { calls, completeness } = await captureCaseCalls(
        root,
        output,
        slots,
        inputs,
        ledger,
    );
    const { custody, reviewer } = draftAttempts(
        slots,
        packet,
        inputs,
        gold,
        calls,
        seed,
    );
    const pilot = await pilotInventory(pilotManifest);
    const protocol = {
        schemaVersion: 1,
        status: pending,
        author: null,
        reviewer: null,
        reviewedAt: null,
        rubricHash: null,
        candidateHashes: [],
        calibration: {
            status: pending,
            rubricHash: null,
            reviewers: [],
            judgments: [],
            minimumAgreement: null,
            reviewedAt: null,
        },
        thresholds: null,
    };
    const report = {
        schemaVersion: 1,
        status: pending,
        semanticQualityEvaluated: false,
        qualityMatrixEligible: false,
        confirmation: false,
        constructionHash: identity(packet),
        mappingHash: identity(mapping),
        goldHash: identity(gold),
        frozenHashEncoding,
        runIdentityHash: identity(runIdentity),
        artifactLedgerHash: identity(ledger),
        providerCapture: completeness,
        scheduledAttempts: slots.length,
        savedAttempts: slots.filter((slot) => slot.status === "saved").length,
        independentScenarioClusters: new Set(slots.map((slot) => slot.scenario))
            .size,
        split: "All exposed scenario clusters are development; no confirmation cases prepared",
        pilot,
        humanApproval: pending,
        calibration: pending,
        thresholds: "not-preregistered",
        missingExperiments: [
            ...[
                ["source-removal", "source-removal"],
                ["human-edit", "protected-human-edits"],
                ["confirmed-separation", "confirmed-separation"],
            ]
                .filter(
                    ([kind]) =>
                        !custody.some((attempt) =>
                            attempt.operationReceipts.some(
                                (receipt) =>
                                    receipt.kind === kind &&
                                    completedOperation(receipt),
                            ),
                        ),
                )
                .map(([, experiment]) => experiment),
            "untouched-confirmation",
        ],
    };
    await writeDocuments(output, {
        "package.json": report,
        "custodian\\artifact-ledger.json": ledger,
        "custodian\\construction.json": packet,
        "custodian\\mapping.json": mapping,
        "custodian\\gold-draft.json": gold,
        "custodian\\attempts.json": custody,
        "custodian\\provider-capture.json": calls,
        "custodian\\split.json": { inventory, split },
        "custodian\\review-protocol-draft.json": protocol,
        "custodian\\annotations-draft.json": {
            schemaVersion: 1,
            status: pending,
            goldHash: identity(gold),
            mappingHash: identity(mapping),
            records: custody.map((attempt) => ({
                id: attempt.caseId,
                blindId: attempt.id,
                status: pending,
                author: null,
                reviewer: null,
                reviewedAt: null,
                hashes: attempt.hashes,
                providerEventOrdinals: attempt.providerEventOrdinals,
                allVerifiableClaimsReviewed: null,
                savedConsistent: null,
                claims: [],
                expectations: [],
                tasks: [],
            })),
        },
        "reviewer\\annotations-draft.json": {
            schemaVersion: 1,
            status: pending,
            records: reviewer,
        },
    });
    await writeFile(
        path.join(output, "reviewer", "HANDOFF.txt"),
        "INDEPENDENT HUMAN REVIEW PENDING\n" +
            "Receive only the reviewer directory, not custodian files, model identities or the blinding seed.\n" +
            "Draft requirements are authored hints, not approved gold. Atomize and ground them in original sources; " +
            "mark unavailable information unknown, never supported. Review all verifiable saved/rendered claims, not only hints.\n" +
            "Annotate material qualifications, issue order (source-stated severity, supported consequences, or reader order), " +
            "topic same/different/uncertain and admission/defer, correction uptake, stale removal and unaffected preservation.\n" +
            "Operation observations, when supplied, are automated service receipts, not human or semantic approval. " +
            "Review their evidence separately; an absent post-forgetting view is not a successful constructed article.\n" +
            "Selection review is a separate unblinded request audit after independent output judgments are frozen. " +
            "Selection and rendered preservation must receive separate verdicts.\n" +
            "Use two independent reviewers for calibration. Retain individual votes, disagreements, adjudication, " +
            "explicit agreement criterion and timestamps. Freeze rubric and thresholds before any new confirmation run.\n" +
            "No reviewer is assigned. No approval, calibration or quality score is implied by these drafts.\n" +
            "Checkpoint revisions and wiki/brief variants share whole scenario/source clusters; they are not independent samples.\n",
        { flag: "wx" },
    );
    return report;
}

export async function main(args) {
    if (args.length === 1 && args[0] === "--help") {
        console.log(
            "Offline review preparation: --input <owned-live-development-root> --output <new-directory> --seed <custodian-seed> [--pilot-manifest <manifest.json>]\nExplicit roots may be absolute. No models, acquisition, holdout labels, scores or approvals. Output is exclusive; distribute reviewer/ only.",
        );
        return 0;
    }
    const options = {};
    try {
        for (let index = 0; index < args.length; index += 2) {
            const key = args[index];
            check(
                ["--input", "--output", "--seed", "--pilot-manifest"].includes(
                    key,
                ) &&
                    options[key] === undefined &&
                    args[index + 1] &&
                    !args[index + 1].startsWith("--"),
                "Unknown/duplicate/missing flag",
            );
            options[key] = args[index + 1];
        }
        for (const key of ["--input", "--output", "--seed"])
            check(options[key], `Missing ${key}`);
        const report = await prepareReviewPackage({
            inputRoot: options["--input"],
            outputRoot: options["--output"],
            seed: options["--seed"],
            pilotManifest: options["--pilot-manifest"],
        });
        console.log(JSON.stringify(report, null, 2));
        return 0;
    } catch (error) {
        console.error(error.message);
        return 1;
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    process.exitCode = await main(process.argv.slice(2));
