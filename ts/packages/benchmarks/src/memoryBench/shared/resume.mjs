// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { open, unlink } from "node:fs/promises";
import path from "node:path";

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
