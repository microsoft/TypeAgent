// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import {
    copyFile,
    mkdtemp,
    open,
    readFile,
    realpath,
    unlink,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { alive } from "./watchdog.mjs";
import { writeJson } from "./harness.mjs";

export async function prepareLiveResume(spec) {
    assert.equal(
        spec.sourceScope,
        "baseline19",
        "Only baseline19 live continuation is supported",
    );
    const directory = await realpath(spec.runDirectory);
    const owner = JSON.parse(
        await readFile(path.join(directory, "ownership.json"), "utf8"),
    );
    const termination = JSON.parse(
        await readFile(path.join(directory, "termination.json"), "utf8"),
    );
    const previousSpec = JSON.parse(
        await readFile(
            path.join(directory, `spec-${termination.startedEpochMs}.json`),
            "utf8",
        ),
    );
    const previous = await readLiveReceipt(directory);
    assert.equal(owner.receiptId, termination.receiptId);
    assert.equal(owner.receiptId, previous.receiptId);
    assert.equal(owner.receiptId, previousSpec.receiptId);
    assert.equal(await realpath(owner.runDirectory), directory);
    assert.equal(
        termination.workerExited,
        true,
        "Previous worker has not exited",
    );
    assert.equal(
        alive(termination.workerPid),
        false,
        "Previous worker PID is still present",
    );
    assert.equal(
        alive(termination.watchdogPid),
        false,
        "Previous watchdog PID is still present",
    );
    assert.ok(previous.corpusId, "Previous run never created a corpus");
    assert.equal(
        await realpath(previous.store),
        await realpath(path.join(directory, "isolated-store")),
        "Retained store changed",
    );
    assert.ok(
        previous.outcome === "PARTIAL_BOUNDED_WORK" ||
            termination.outcome === "BOUNDED_WORK_INCOMPLETE",
        "Only interrupted bounded work may resume automatically",
    );
    for (const key of ["productRoot", "fixtureRoot"])
        assert.equal(
            await realpath(previousSpec[key]),
            await realpath(spec[key]),
            `${key} changed`,
        );
    assert.equal(previousSpec.sourceScope, spec.sourceScope);
    assert.deepEqual(
        previousSpec.expectedCheckpoint,
        spec.expectedCheckpoint,
        "Compiled checkpoint changed",
    );
    assert.deepEqual(
        previous.dependencyCheckpoint,
        spec.dependencyCheckpoint,
        "Dependency checkpoint changed",
    );
    const digest = createHash("sha256")
        .update(JSON.stringify(spec.expectedCheckpoint.hashes))
        .digest("hex");
    assert.equal(
        previous.checkpoint.digest,
        digest,
        "Previous compiled checkpoint differs",
    );
    const archive = await mkdtemp(
        path.join(directory, "attempt-before-resume-"),
    );
    for (const name of [
        "live-preflight.json",
        "termination.json",
        "admitted.json",
        "baseline19-synopsis-input.json",
        "baseline19-synopsis-output.json",
        "independent-evaluator-packet.json",
        "baseline19-terminal-jobs.json",
    ]) {
        try {
            await copyFile(
                path.join(directory, name),
                path.join(archive, name),
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            assert.ok(
                !["live-preflight.json", "termination.json"].includes(name),
            );
        }
    }
    await writeJson(path.join(archive, "resume-authorization.json"), {
        authorizedEpochMs: Date.now(),
        previousWorkerPid: termination.workerPid,
        previousWatchdogPid: termination.watchdogPid,
        workAllowanceMs: spec.workAllowanceMs,
    });
    return {
        receiptId: owner.receiptId,
        previousReceiptPath: path.join(archive, "live-preflight.json"),
    };
}

export async function withLiveRunLock(directory, action) {
    const file = path.join(directory, "live-run.lock");
    const lock = await open(file, "wx");
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid }));
        return await action();
    } finally {
        await lock.close();
        await unlink(file);
    }
}

export function completedLiveOperations(plan, receipt) {
    assert.ok(receipt.operations.length <= plan.length);
    const latest = new Map();
    receipt.operations.forEach((operation, index) => {
        const entry = plan[index];
        assert.equal(operation.phase, entry.phase, "Operation order changed");
        assert.equal(
            operation.sourceKey,
            entry.sourceKey,
            "Source order changed",
        );
        assert.equal(
            operation.fixtureSha256,
            entry.sha256,
            "Fixture hash changed",
        );
        assert.equal(
            operation.state,
            "complete",
            "Incomplete operation in completed ledger",
        );
        latest.set(operation.sourceKey, operation);
    });
    for (const [key, operation] of latest) {
        assert.equal(receipt.mappings[key]?.sourceId, operation.sourceId);
        assert.equal(receipt.mappings[key]?.revisionId, operation.revisionId);
    }
    assert.equal(Object.keys(receipt.mappings).length, latest.size);
    return receipt.operations.length;
}

export async function validateLiveResumeSources(
    service,
    corpusId,
    plan,
    receipt,
) {
    const completed = completedLiveOperations(plan, receipt);
    const next = plan[completed];
    const sources = await service.listSources(corpusId);
    const allowedUris = new Set(
        plan.slice(0, completed + 1).map((entry) => entry.canonicalUri),
    );
    for (const source of sources) {
        assert.ok(
            allowedUris.has(source.canonicalUri),
            "Unexpected retained source",
        );
        assert.equal(
            sources.filter((item) => item.canonicalUri === source.canonicalUri)
                .length,
            1,
            "Canonical source identity is not unique",
        );
    }
    for (const [key, mapping] of Object.entries(receipt.mappings)) {
        const source = sources.find(
            (item) => item.sourceId === mapping.sourceId,
        );
        assert.ok(source, "Completed source is missing");
        const active = source.revisions.find(
            (revision) => revision.revisionId === source.activeRevisionId,
        );
        const entry = [...plan.slice(0, completed)]
            .reverse()
            .find((item) => item.sourceKey === key);
        assert.equal(source.canonicalUri, entry.canonicalUri);
        const unacknowledgedReplacement =
            next?.sourceKey === key && active?.contentHash === next.sha256;
        if (!unacknowledgedReplacement) {
            assert.equal(
                active?.revisionId,
                mapping.revisionId,
                "Completed revision changed",
            );
            assert.equal(
                active?.contentHash,
                entry.sha256,
                "Completed content changed",
            );
            assert.equal(
                active?.state,
                "ready",
                "Completed revision is not ready",
            );
        }
    }
    return completed;
}

export async function reconcileLiveSource(
    service,
    corpusId,
    entry,
    prior,
    source,
    resuming,
) {
    const matches = (await service.listSources(corpusId)).filter(
        (item) => item.canonicalUri === entry.canonicalUri,
    );
    assert.ok(matches.length <= 1, "Canonical source identity is not unique");
    const actual = matches[0];
    if (prior)
        assert.equal(actual?.sourceId, prior.sourceId, "Mapped source changed");
    if (actual) {
        const revision = actual.revisions.find(
            (item) => item.revisionId === actual.activeRevisionId,
        );
        assert.ok(revision, "Retained active revision is missing");
        if (revision.contentHash === entry.sha256) {
            assert.ok(resuming, "Unexpected existing source in fresh run");
            if (revision.state === "ready")
                return {
                    sourceId: actual.sourceId,
                    revisionId: revision.revisionId,
                    state: "complete",
                    recovery: "ready-commit-without-ledger-acknowledgement",
                };
            let continuationToken;
            do {
                const page = await service.listJobs({
                    corpusId,
                    sourceId: actual.sourceId,
                    pageSize: 200,
                    ...(continuationToken ? { continuationToken } : {}),
                });
                const pending = page.items.find(
                    (job) =>
                        job.revisionId === revision.revisionId &&
                        ![
                            "complete",
                            "failed",
                            "cancelled",
                            "partial",
                        ].includes(job.state),
                );
                if (pending)
                    return {
                        sourceId: actual.sourceId,
                        revisionId: revision.revisionId,
                        jobId: pending.jobId,
                        recovery: "waiting-for-existing-ingestion",
                    };
                continuationToken = page.nextContinuationToken;
            } while (continuationToken);
            assert.ok(
                ["failed", "accepted", "processing"].includes(revision.state),
                "Interrupted revision cannot be recovered",
            );
            return {
                ...(await service.replaceSource({
                    corpusId,
                    sourceId: actual.sourceId,
                    expectedActiveRevisionId: revision.revisionId,
                    retainRevisionHistory: true,
                    source,
                })),
                recovery: "retry-interrupted-source-with-explicit-new-revision",
                previousRevisionId: revision.revisionId,
            };
        }
        assert.ok(prior, "Untracked retained source has unexpected content");
        assert.equal(
            actual.activeRevisionId,
            prior.revisionId,
            "Replacement base changed",
        );
    } else assert.ok(!prior, "Mapped source is missing");
    return prior
        ? service.replaceSource({
              corpusId,
              sourceId: prior.sourceId,
              expectedActiveRevisionId: prior.revisionId,
              source,
          })
        : service.ingestDocument({ corpusId, source });
}

export async function readLiveReceipt(directory) {
    return JSON.parse(
        await readFile(path.join(directory, "live-preflight.json"), "utf8"),
    );
}
