// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { readFile, readdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { check, identity, sha256, text, unique } from "./quality-contract.mjs";
import { confined, ownershipMarker } from "./quality-view-campaign-cli.mjs";
import { writeJson } from "./harness.mjs";
import {
    campaignSchedule,
    validateCampaignRun,
    validateCampaignOutputs,
    validateExampleRunArtifacts,
} from "./quality-view-campaign.mjs";
import {
    capturedRequestContains,
    capturedConstructionRequests,
    validateRequestCapture,
} from "./quality-request-capture.mjs";

const exec = promisify(execFile);
const implementationRoots = [
    "examples/viewExamples",
    "packages/memory/service",
    "packages/memory/client",
    "packages/memory/conversation",
    "packages/aiclient",
    "packages/config",
    "packages/knowPro",
];

export async function snapshotCampaignImplementation(productRoot) {
    const files = {};
    const visit = async (relative) => {
        const directory = await confined(productRoot, relative);
        for (const entry of (
            await readdir(directory, { withFileTypes: true })
        ).sort((a, b) => a.name.localeCompare(b.name))) {
            check(
                !entry.isSymbolicLink(),
                "Implementation snapshot refuses links",
            );
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(next);
            else if (/\.(?:js|ts|json|txt)$/.test(entry.name))
                files[next] = sha256(
                    await readFile(await confined(productRoot, next)),
                );
        }
    };
    for (const root of implementationRoots)
        for (const directory of ["src", "dist"])
            await visit(path.join(...root.split("/"), directory));
    const { stdout: commit } = await exec("git", ["rev-parse", "HEAD"], {
        cwd: productRoot,
    });
    const { stdout: patch } = await exec(
        "git",
        ["--no-pager", "diff", "--binary", "HEAD", "--", "."],
        { cwd: productRoot, maxBuffer: 64 * 1024 * 1024 },
    );
    const subsetHash = (pattern) =>
        identity(
            Object.fromEntries(
                Object.entries(files).filter(([name]) => pattern.test(name)),
            ),
        );
    return {
        sourceCommit: commit.trim(),
        patchHash: sha256(patch),
        filesHash: identity(files),
        promptHash: subsetHash(
            /(?:viewSynthesis|viewEditorial|topicGeneration|topicCuration)\.js$/,
        ),
        schemaHash: subsetHash(
            /(?:viewSynthesisSchemas|informationalSupport|informationalWiki|informationalProject)\.js$/,
        ),
        files,
    };
}

async function validateExecutionRoot(project, root) {
    const absolute = await confined(project, root);
    check(
        (await lstat(absolute)).isDirectory(),
        "Execution root must be a directory",
    );
    const marker = JSON.parse(
        await readFile(await confined(absolute, ownershipMarker), "utf8"),
    );
    check(
        marker.schemaVersion === 1 &&
            marker.purpose === "quality-view-campaign",
        "Owned campaign root required",
    );
    text(marker.ownerId, "campaign owner");
    return absolute;
}

function validateAuthorization(authorization, campaign, run) {
    check(
        authorization?.approved === true &&
            identity(authorization) === run.permissionRecordHash &&
            authorization.campaignHash === identity(campaign) &&
            identity(authorization.caseIds) === identity(run.caseIds) &&
            identity(authorization.armIds) ===
                identity(run.arms.map((arm) => arm.id)) &&
            authorization.generations === run.generations &&
            identity(authorization.budget) === identity(run.budget),
        "Explicit authorization must bind the entire frozen schedule and budgets",
    );
    text(authorization.identity, "authorization identity");
    check(
        Number.isFinite(Date.parse(authorization.approvedAt)) &&
            Date.parse(authorization.approvedAt) <= Date.parse(run.startedAt),
        "Authorization must precede execution",
    );
    check(
        Number.isFinite(authorization.maxCostPerCall) &&
            authorization.maxCostPerCall > 0,
        "Approved conservative per-call cost reservation required",
    );
}

async function verifyBinding(binding, arm) {
    check(
        binding && path.isAbsolute(binding.productRoot),
        "Absolute frozen product root required",
    );
    const actual = await snapshotCampaignImplementation(binding.productRoot);
    check(
        actual.sourceCommit === arm.sourceCommit &&
            actual.patchHash === arm.patchHash &&
            actual.promptHash === arm.promptHash &&
            actual.schemaHash === arm.schemaHash &&
            identity(actual) === binding.implementationHash,
        "Frozen arm implementation changed",
    );
    check(
        identity(binding.declaredArm) === identity(arm),
        "Frozen arm configuration declaration mismatch",
    );
    return actual;
}

async function optionalText(root, name) {
    try {
        return await readFile(await confined(root, name), "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

async function readCapture(root, caseId) {
    const manifest = await optionalText(root, "request-calls.json");
    if (manifest === null) return null;
    const parsed = JSON.parse(manifest);
    const requests = [];
    const results = [];
    for (const call of parsed.calls) {
        requests.push({
            file: call.requestFile,
            body: await readFile(
                await confined(root, call.requestFile),
                "utf8",
            ),
        });
        if (call.result)
            results.push({
                file: call.result.file,
                body: await readFile(
                    await confined(root, call.result.file),
                    "utf8",
                ),
            });
    }
    const capture = {
        contract: "memory-request-capture-v1",
        manifest,
        requests,
        results,
    };
    validateRequestCapture(capture, caseId);
    return capture;
}

async function checkpointArtifacts(root) {
    const schedule = await optionalText(root, "checkpoints.json");
    if (schedule === null) return null;
    const checkpoints = JSON.parse(schedule).checkpoints;
    const records = [];
    for (const checkpoint of checkpoints) {
        const prefix = path.join(
            "revisions",
            String(checkpoint.sequence).padStart(4, "0"),
        );
        records.push({
            ...checkpoint,
            saved: await optionalText(root, path.join(prefix, "saved.json")),
            rendered: await optionalText(
                root,
                path.join(prefix, "rendered.txt"),
            ),
            evidence: await optionalText(
                root,
                path.join(prefix, "evidence.json"),
            ),
        });
    }
    return {
        contract: "memory-view-checkpoint-artifacts-v1",
        schedule,
        records,
    };
}

function outputHashes(row) {
    return {
        ...Object.fromEntries(
            ["saved", "rendered", "serializedRequest"].map((key) => [
                `${key}Hash`,
                row[key] === null ? null : identity(row[key]),
            ]),
        ),
        ...(row.requestCapture
            ? { requestCaptureHash: identity(row.requestCapture) }
            : {}),
        ...(row.checkpointArtifacts
            ? { checkpointArtifactsHash: identity(row.checkpointArtifacts) }
            : {}),
    };
}

async function collectSlot(slot, root, packet, completed, reason) {
    const capture = await readCapture(root, slot.caseId);
    const requests = capture ? capturedConstructionRequests(capture) : [];
    const evidenceText = await optionalText(root, "evidence.json");
    const evidence = evidenceText
        ? JSON.parse(evidenceText)
        : { selectedEvidence: [], citationResolutions: [] };
    const row = {
        ...slot,
        status: completed ? "ok" : "failed",
        stage: completed ? "complete" : "execution",
        component: "wiki-views",
        reason,
        targetDisposition: completed ? "admitted" : "not-accepted",
        targetViewId: slot.caseId,
        saved: await optionalText(root, "saved.json"),
        rendered: await optionalText(root, "rendered.txt"),
        serializedRequest: requests.at(-1) ?? null,
        selectedEvidence: evidence.selectedEvidence.filter((entry) =>
            requests.some((request) =>
                capturedRequestContains(request, entry.excerpt),
            ),
        ),
        citationResolutions: evidence.citationResolutions,
        telemetry: {
            calls: null,
            tokens: null,
            reservations: null,
            latencyMs: null,
            cost: null,
        },
    };
    if (capture) row.requestCapture = capture;
    if (completed) {
        const receiptText = text(
            await optionalText(root, "receipt.json"),
            "live receipt",
        );
        const receipt = JSON.parse(receiptText);
        check(
            receipt.mode === "live" &&
                receipt.caseId === slot.caseId &&
                receipt.injectedBehavior === null,
            "Completed campaign requires the actual non-injected live runner",
        );
        check(
            capture && requests.length > 0,
            "Completed campaign requires admitted construction dispatches",
        );
        row.runtime = receipt.runtime;
        validateExampleRunArtifacts(packet, {
            receipt: receiptText,
            saved: row.saved,
            rendered: row.rendered,
            sourceMapping: text(
                await optionalText(root, "source-mapping.json"),
                "source mapping",
            ),
            requestEvidence: text(
                await optionalText(root, "request-evidence.json"),
                "indexed input snapshots",
            ),
        });
    }
    const checkpoints = await checkpointArtifacts(root);
    row.checkpointArtifacts =
        checkpoints ??
        emptySlot(slot, "failed", reason, true).checkpointArtifacts;
    const rawMapping = await optionalText(root, "source-mapping.json");
    const bundle = packet.bundles.find((entry) => entry.id === slot.caseId);
    const mapping = (rawMapping ? JSON.parse(rawMapping) : []).map((entry) => {
        const source = bundle.sources.find(
            (source) => source.id === entry.datasetSourceId,
        );
        check(
            source &&
                source.version === entry.sourceVersion &&
                entry.retainedSha256 === source.sha256 &&
                entry.contentHash === source.sha256,
            "Retained source mapping mismatch",
        );
        return {
            attemptId: slot.id,
            caseId: slot.caseId,
            sourceId: source.id,
            sourceVersion: source.version,
            corpusId: entry.corpusId,
            ingestedSourceId: entry.sourceId,
            revisionId: entry.revisionId,
            contentHash: entry.contentHash,
            retainedText: source.text,
        };
    });
    if (capture) {
        const calls = JSON.parse(capture.manifest).calls;
        row.telemetry.calls = calls.length;
        row.telemetry.tokens = calls.every((call) => call.usage !== null)
            ? calls.reduce((sum, call) => sum + call.usage.total_tokens, 0)
            : null;
        row.telemetry.reservations = calls.every(
            (call) => call.reservations.length > 0,
        )
            ? calls.reduce((sum, call) => {
                  const reservation = call.reservations.at(-1);
                  return (
                      sum +
                      reservation.inputTokens +
                      reservation.outputTokens +
                      reservation.safetyTokens
                  );
              }, 0)
            : null;
        row.telemetry.latencyMs = calls.every((call) => call.outcome !== null)
            ? calls.reduce((sum, call) => sum + call.outcome.elapsedMs, 0)
            : null;
        if (completed)
            validateRequestCapture(capture, slot.caseId, {
                requireComplete: true,
            });
    }
    row.hashes = outputHashes(row);
    return { row, mapping };
}

function emptySlot(slot, status, reason, unknownCalls = false) {
    const row = {
        ...slot,
        status,
        reason,
        stage: status === "missing" ? "scheduled" : "reconciliation",
        component: "campaign-coordinator",
        targetDisposition: "not-attempted-or-not-accepted",
        targetViewId: slot.caseId,
        saved: null,
        rendered: null,
        serializedRequest: null,
        selectedEvidence: [],
        citationResolutions: [],
        telemetry: {
            calls: unknownCalls ? null : 0,
            tokens: null,
            reservations: unknownCalls ? null : 0,
            latencyMs: null,
            cost: null,
        },
    };
    const checkpoints = slot.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        ...(unknownCalls
            ? {
                  status: "unknown",
                  reason: "Checkpoint artifacts unavailable after reconciliation failure",
              }
            : {}),
    }));
    row.checkpointArtifacts = {
        contract: "memory-view-checkpoint-artifacts-v1",
        schedule: JSON.stringify({
            schemaVersion: 1,
            contract: "memory-view-checkpoints-v1",
            caseId: slot.caseId,
            checkpoints,
        }),
        records: checkpoints.map((checkpoint) => ({
            ...checkpoint,
            saved: null,
            rendered: null,
            evidence: null,
        })),
    };
    row.hashes = outputHashes(row);
    return row;
}

async function dispatchSlot(
    spec,
    slot,
    root,
    index,
    inputFile,
    approvalFile,
    remaining,
    binding,
) {
    const arm = spec.run.arms.find((arm) => arm.id === slot.arm);
    try {
        await verifyBinding(binding, arm);
        const budgetFile = await confined(root, `budget-${index}.json`, true);
        const armFile = await confined(root, `arm-${index}.json`, true);
        await writeFile(armFile, JSON.stringify(arm), { flag: "wx" });
        await writeFile(
            budgetFile,
            JSON.stringify({
                ...spec.requestBudget,
                calls: remaining.calls,
                reservedTokens: remaining.tokens,
                cost: remaining.cost,
                maxCostPerCall: spec.authorization.maxCostPerCall,
            }),
            { flag: "wx" },
        );
        await exec(
            process.execPath,
            [
                path.join(
                    binding.productRoot,
                    "examples",
                    "viewExamples",
                    "dist",
                    "cli.js",
                ),
                "--mode",
                "live",
                "--case",
                slot.caseId,
                "--root",
                slot.root,
                "--input",
                inputFile,
                "--authorization",
                approvalFile,
                "--capture-requests",
                "--request-budget",
                budgetFile,
                "--expected-runtime",
                armFile,
            ],
            {
                cwd: binding.productRoot,
                timeout: spec.timeoutMs,
                maxBuffer: 1024 * 1024,
            },
        );
        await verifyBinding(binding, arm);
        const collected = await collectSlot(
            slot,
            slot.root,
            spec.packet,
            true,
            "Completed authorized frozen execution",
        );
        check(
            collected.row.runtime.nodeVersion === arm.nodeVersion &&
                collected.row.runtime.synthesisIdentity ===
                    arm.configurationIdentity &&
                collected.row.runtime.configurationHash ===
                    arm.configurationHash &&
                collected.row.runtime.providerSettingsHash ===
                    arm.providerSettingsHash &&
                collected.row.runtime.providers?.length > 0 &&
                collected.row.runtime.providers.every(
                    (provider) => provider === arm.provider,
                ) &&
                collected.row.runtime.models?.length > 0 &&
                collected.row.runtime.models.every(
                    (model) => model === arm.model,
                ),
            "Executed runtime differs from frozen arm",
        );
        return collected;
    } catch (error) {
        const reason = `Execution/reconciliation failed: ${error.message}`;
        try {
            return await collectSlot(
                slot,
                slot.root,
                spec.packet,
                false,
                reason,
            );
        } catch (collectionError) {
            return {
                row: emptySlot(
                    slot,
                    "failed",
                    `${reason}; artifact reconciliation failed: ${collectionError.message}`,
                    true,
                ),
                mapping: [],
            };
        }
    }
}

export async function executeCampaign(spec) {
    const { packet, campaign, run, authorization } = spec;
    const runHash = validateCampaignRun(run, campaign, packet);
    check(
        run.schemaVersion === 2,
        "Isolated multi-arm execution requires campaign v2",
    );
    validateAuthorization(authorization, campaign, run);
    check(
        authorization.bindingsHash === identity(spec.bindings) &&
            authorization.requestBudgetHash === identity(spec.requestBudget) &&
            authorization.timeoutMs === spec.timeoutMs,
        "Authorization must bind frozen deployments and request limits",
    );
    check(
        Number.isSafeInteger(spec.timeoutMs) && spec.timeoutMs > 0,
        "Positive execution timeout required",
    );
    const root = await validateExecutionRoot(spec.project, spec.root);
    for (const name of [
        "execution.json",
        "outputs.json",
        "mapping.json",
        "execution-construction.json",
        "execution-authorization.json",
    ])
        await confined(root, name, true);
    const bindings = unique(spec.bindings, "id", "execution bindings");
    check(
        bindings.size === run.arms.length,
        "Every arm needs an isolated frozen binding",
    );
    for (const arm of run.arms) {
        check(
            arm.eligibleSourcesHash === identity(packet),
            "Arm evidence pool differs from construction packet",
        );
        await verifyBinding(bindings.get(arm.id), arm);
    }

    const schedule = campaignSchedule(run).map((slot) => ({
        ...slot,
        status: "not-attempted",
        root: null,
        reason: "Scheduled, not dispatched",
        checkpoints: (() => {
            const bundle = packet.bundles.find(
                (bundle) => bundle.id === slot.caseId,
            );
            const batches = bundle.project
                ? bundle.sources.map((source) => [source])
                : [bundle.sources];
            return batches.map((batch, index) => ({
                sequence: index + 1,
                sourceIds: batch.map((source) => source.id),
                status: "not-attempted",
                stage: "scheduled",
                reason: "",
                revisionId: null,
            }));
        })(),
    }));
    await writeFile(
        await confined(root, "execution.json", true),
        JSON.stringify(
            { contract: "memory-view-execution-v1", runHash, schedule },
            null,
            2,
        ),
        { flag: "wx" },
    );
    const inputFile = await confined(root, "execution-construction.json", true);
    await writeFile(inputFile, JSON.stringify(packet), { flag: "wx" });
    const approvalFile = await confined(
        root,
        "execution-authorization.json",
        true,
    );
    await writeFile(approvalFile, JSON.stringify(authorization), {
        flag: "wx",
    });
    const outputs = { schemaVersion: 2, runHash, records: [] };
    const mapping = {
        schemaVersion: 2,
        contract: "informational-view-ingestion-v2",
        constructionHash: identity(packet),
        records: [],
    };
    let remainingCalls = run.budget.calls;
    let remainingTokens = run.budget.tokens;
    let remainingCost = run.budget.cost;
    let stop = false;
    const persist = () =>
        writeJson(path.join(root, "execution.json"), {
            contract: "memory-view-execution-v1",
            runHash,
            schedule,
        });
    for (const [index, slot] of schedule.entries()) {
        if (
            stop ||
            remainingCalls < 1 ||
            remainingTokens < 1 ||
            remainingCost < authorization.maxCostPerCall
        ) {
            slot.reason = stop
                ? "Stopped after failure or unknown accounting"
                : "Approved reservation budget exhausted";
            continue;
        }
        const binding = bindings.get(slot.arm);
        slot.root = path.join(
            binding.productRoot,
            "examples",
            "viewExamples",
            ".runs",
            `campaign-${sha256(runHash + slot.id)}`,
        );
        slot.status = "running";
        await persist();
        const collected = await dispatchSlot(
            spec,
            slot,
            root,
            index,
            inputFile,
            approvalFile,
            {
                calls: remainingCalls,
                tokens: remainingTokens,
                cost: remainingCost,
            },
            binding,
        );
        outputs.records.push(collected.row);
        mapping.records.push(...collected.mapping);
        slot.status = collected.row.status;
        slot.reason = collected.row.reason;
        if (collected.row.checkpointArtifacts)
            slot.checkpoints = JSON.parse(
                collected.row.checkpointArtifacts.schedule,
            ).checkpoints;
        await persist();
        await writeJson(path.join(root, "partial-artifacts.json"), {
            runHash,
            outputs,
            mapping,
        });
        const telemetry = collected.row.telemetry;
        if (telemetry.calls === null || telemetry.reservations === null)
            stop = true;
        else {
            remainingCalls -= telemetry.calls;
            remainingTokens -= telemetry.reservations;
            remainingCost -= telemetry.calls * authorization.maxCostPerCall;
        }
        if (collected.row.status !== "ok") stop = true;
    }
    for (const slot of schedule.filter(
        (slot) => slot.status === "not-attempted",
    )) {
        const row = emptySlot(slot, "missing", slot.reason);
        outputs.records.push(row);
    }
    outputs.mappingHash = identity(mapping);
    validateCampaignOutputs(packet, campaign, run, outputs, mapping);
    await persist();
    for (const [name, data] of Object.entries({
        "outputs.json": outputs,
        "mapping.json": mapping,
    }))
        await writeFile(
            await confined(root, name, true),
            JSON.stringify(data, null, 2),
            { flag: "wx" },
        );
    return { outputs, mapping, execution: schedule, qualityQualified: false };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    if (process.argv.length === 3 && process.argv[2] === "--help")
        process.stdout.write(
            "Authorized execution only: node quality-campaign-execution.mjs --spec <project-relative-owned-spec.json>\nNo execution occurs with --help. See quality-view-campaign-README.md for approval and freeze contracts.\n",
        );
    else {
        try {
            check(
                process.argv.length === 4 && process.argv[2] === "--spec",
                "Expected --spec <project-relative-owned-spec.json>",
            );
            const project = process.cwd();
            const specFile = await confined(project, process.argv[3]);
            const spec = JSON.parse(await readFile(specFile, "utf8"));
            const result = await executeCampaign({ ...spec, project });
            process.stdout.write(
                JSON.stringify({
                    qualityQualified: false,
                    attempts: result.outputs.records.length,
                    failedOrMissing: result.outputs.records.filter(
                        (row) => row.status !== "ok",
                    ).length,
                }) + "\n",
            );
        } catch (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    }
}
