// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJson } from "./harness.mjs";
import {
    completedLiveOperations,
    prepareLiveResume,
    reconcileLiveSource,
    validateLiveResumeSources,
    withLiveRunLock,
} from "./live-resume.mjs";

const entry = {
    phase: "baseline",
    sourceKey: "fixture",
    sha256: "abc",
    canonicalUri: "fixture://one",
};
const retained = (state = "ready", contentHash = "abc") => ({
    sourceId: "source",
    canonicalUri: entry.canonicalUri,
    activeRevisionId: "revision",
    revisions: [{ revisionId: "revision", contentHash, state }],
});
const operation = {
    ...entry,
    fixtureSha256: entry.sha256,
    sourceId: "source",
    revisionId: "revision",
    state: "complete",
};
const receipt = () => ({
    operations: [operation],
    mappings: { fixture: { sourceId: "source", revisionId: "revision" } },
});

test("completed prefix is tied to exact source order, fixture hashes, state and mappings", () => {
    assert.equal(completedLiveOperations([entry], receipt()), 1);
    for (const change of [
        { sourceKey: "other" },
        { phase: "correction" },
        { fixtureSha256: "changed" },
        { state: "failed" },
    ]) {
        const value = receipt();
        value.operations[0] = { ...operation, ...change };
        assert.throws(() => completedLiveOperations([entry], value));
    }
    const value = receipt();
    value.mappings.fixture.revisionId = "changed";
    assert.throws(() => completedLiveOperations([entry], value));
});

test("resume validates actual completed ready revisions and rejects missing, altered, duplicate or extra sources", async () => {
    assert.equal(
        await validateLiveResumeSources(
            { listSources: async () => [retained()] },
            "corpus",
            [entry],
            receipt(),
        ),
        1,
    );
    for (const sources of [
        [],
        [retained("failed")],
        [retained("ready", "changed")],
        [retained(), retained()],
        [retained(), { ...retained(), canonicalUri: "fixture://unexpected" }],
    ])
        await assert.rejects(
            validateLiveResumeSources(
                { listSources: async () => sources },
                "corpus",
                [entry],
                receipt(),
            ),
        );
});

test("a ready commit absent from the ledger is recovered without any ingestion", async () => {
    const value = await reconcileLiveSource(
        { listSources: async () => [retained()] },
        "corpus",
        entry,
        undefined,
        {},
        true,
    );
    assert.equal(value.revisionId, "revision");
    assert.equal(value.state, "complete");
    assert.equal(value.recovery, "ready-commit-without-ledger-acknowledgement");
});

test("an in-flight revision waits for its existing paginated job without duplicating ingestion", async () => {
    const seen = [];
    const value = await reconcileLiveSource(
        {
            listSources: async () => [retained("processing")],
            listJobs: async (request) => {
                seen.push(request.continuationToken);
                return request.continuationToken
                    ? {
                          items: [
                              {
                                  jobId: "owned",
                                  revisionId: "revision",
                                  state: "embedding",
                              },
                          ],
                      }
                    : { items: [], nextContinuationToken: "next" };
            },
        },
        "corpus",
        entry,
        undefined,
        {},
        true,
    );
    assert.equal(value.jobId, "owned");
    assert.deepEqual(seen, [undefined, "next"]);
});

test("an interrupted failed revision is retried explicitly on the same source, retaining history", async () => {
    let request;
    const value = await reconcileLiveSource(
        {
            listSources: async () => [retained("failed")],
            listJobs: async () => ({ items: [] }),
            replaceSource: async (input) => {
                request = input;
                return {
                    sourceId: "source",
                    revisionId: "retry",
                    jobId: "retry-job",
                };
            },
        },
        "corpus",
        entry,
        undefined,
        { text: "retained source" },
        true,
    );
    assert.equal(request.sourceId, "source");
    assert.equal(request.expectedActiveRevisionId, "revision");
    assert.equal(request.retainRevisionHistory, true);
    assert.equal(value.previousRevisionId, "revision");
    assert.equal(value.revisionId, "retry");
});

test("resume does not adopt unknown content or fresh-run duplicates", async () => {
    await assert.rejects(
        reconcileLiveSource(
            { listSources: async () => [retained("ready", "wrong")] },
            "corpus",
            entry,
            undefined,
            {},
            true,
        ),
        /unexpected content/,
    );
    await assert.rejects(
        reconcileLiveSource(
            { listSources: async () => [retained()] },
            "corpus",
            entry,
            undefined,
            {},
            false,
        ),
        /fresh run/,
    );
});

test("normal new imports and replacements use the production public APIs", async () => {
    let inserted = 0;
    await reconcileLiveSource(
        {
            listSources: async () => [],
            ingestDocument: async () => {
                inserted++;
                return { jobId: "new" };
            },
        },
        "corpus",
        entry,
        undefined,
        {},
        false,
    );
    assert.equal(inserted, 1);
    let replaced = 0;
    await reconcileLiveSource(
        {
            listSources: async () => [retained("ready", "old")],
            replaceSource: async (request) => {
                replaced++;
                assert.equal(request.expectedActiveRevisionId, "revision");
                return { jobId: "replacement" };
            },
        },
        "corpus",
        entry,
        { sourceId: "source", revisionId: "revision" },
        {},
        false,
    );
    assert.equal(replaced, 1);
});

test("exclusive run ownership rejects a concurrent invocation and releases after failure", async (t) => {
    const directory = await mkdtemp(
        path.join(process.cwd(), "live-resume-lock-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    await withLiveRunLock(directory, async () => {
        await assert.rejects(
            withLiveRunLock(directory, async () => {}),
            { code: "EEXIST" },
        );
    });
    await assert.rejects(
        withLiveRunLock(directory, async () => {
            throw new Error("controlled");
        }),
    );
    await withLiveRunLock(directory, async () => {});
});

test("resume freezes prior attempt artifacts and rejects changed provenance or present process IDs", async (t) => {
    const directory = await mkdtemp(
        path.join(process.cwd(), "live-resume-provenance-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const expectedCheckpoint = { name: "frozen", hashes: { file: "hash" } };
    const spec = {
        runDirectory: directory,
        productRoot: directory,
        fixtureRoot: directory,
        sourceScope: "baseline19",
        expectedCheckpoint,
        dependencyCheckpoint: { file: "hash" },
        workAllowanceMs: 2100000,
    };
    const old = {
        store: path.join(directory, "isolated-store"),
        receiptId: "owned",
        corpusId: "corpus",
        outcome: "PARTIAL_BOUNDED_WORK",
        checkpoint: {
            digest: createHash("sha256")
                .update(JSON.stringify(expectedCheckpoint.hashes))
                .digest("hex"),
        },
        dependencyCheckpoint: spec.dependencyCheckpoint,
    };
    await mkdir(old.store);
    const termination = {
        receiptId: "owned",
        workerExited: true,
        workerPid: 99999999,
        watchdogPid: 99999998,
        startedEpochMs: 100,
    };
    await writeJson(path.join(directory, "ownership.json"), {
        receiptId: "owned",
        runDirectory: directory,
    });
    await writeJson(path.join(directory, "spec-100.json"), {
        ...spec,
        receiptId: "owned",
    });
    await writeJson(path.join(directory, "termination.json"), termination);
    await writeJson(path.join(directory, "live-preflight.json"), old);
    const result = await prepareLiveResume(spec);
    assert.equal(result.receiptId, "owned");
    assert.deepEqual(
        JSON.parse(await readFile(result.previousReceiptPath, "utf8")),
        old,
    );
    await assert.rejects(
        prepareLiveResume({
            ...spec,
            expectedCheckpoint: { ...expectedCheckpoint, name: "changed" },
        }),
    );
    await assert.rejects(
        prepareLiveResume({ ...spec, dependencyCheckpoint: {} }),
    );
    await writeJson(path.join(directory, "termination.json"), {
        ...termination,
        workerPid: process.pid,
    });
    await assert.rejects(prepareLiveResume(spec), /still present/);
});
