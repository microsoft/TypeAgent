// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { checkpointExpectationHash, writeJson } from "./harness.mjs";
import { observeProvider } from "./live-stages.mjs";
import { benchmarkFailure } from "./longmemeval-live.mjs";
import { supervise } from "./watchdog.mjs";
import {
    digest,
    encode,
    readJson,
    writeNew,
} from "./longmemeval-indexing-contract.mjs";
import {
    capturePreparation,
    instrumentSettings,
    logicalState,
    openStorage,
    settingsArtifact,
} from "./longmemeval-indexing-storage.mjs";

export async function companionSettings(modules, signal) {
    signal.throwIfAborted();
    const settings = modules.kp.createConversationSettings();
    settings.semanticRefIndexSettings.knowledgeExtractor =
        modules.kp.createKnowledgeExtractor(
            modules.client.openai.createChatModel(),
        );
    await modules.kp.prepareConversationEmbeddings(settings);
    signal.throwIfAborted();
    assert.ok(
        settings.messageTextIndexSettings.embeddingIndexSettings.embeddingModel,
        "Live vector provider unavailable",
    );
    settings.preparedIndexing = { workers: 3, window: 3, signal };
    return settings;
}

export function validateCompanionSpec(spec) {
    assert.equal(spec.mode, "indexing-companion");
    assert.equal(spec.authorizedLiveBenchmark, true);
    assert.equal(spec.startupAllowanceMs, 120000);
    assert.ok(
        spec.workAllowanceMs >= 360000 && spec.workAllowanceMs <= 1200000,
    );
    assert.equal(spec.resume, false);
    assert.ok(path.isAbsolute(spec.pilotDirectory));
    assert.ok(path.isAbsolute(spec.runDirectory));
    assert.match(spec.approvalHash, /^[a-f0-9]{64}$/);
}

export async function superviseCompanion(
    pilot,
    product,
    approvalFile,
    approval,
    worker,
) {
    const directory = path.join(pilot.root, "companion-attempt");
    await mkdir(directory);
    const receiptId = randomUUID();
    await writeNew(path.join(directory, "ownership.json"), {
        receiptId,
        runDirectory: directory,
    });
    const spec = {
        receiptId,
        runDirectory: directory,
        pilotDirectory: pilot.root,
        productRoot: product,
        approvalFile: path.resolve(approvalFile),
        approvalHash: digest(encode(approval)),
        resume: false,
        mode: "indexing-companion",
        authorizedLiveBenchmark: true,
        startupAllowanceMs: 120000,
        workAllowanceMs: (approval.workMinutes + 5) * 60000,
        expectedCheckpoint: {
            name: "indexing-pilot",
            hashes: pilot.manifest.checkpoint.hashes,
        },
    };
    const outcome = await supervise(spec, worker, validateCompanionSpec);
    assert.equal(
        outcome.exit?.code,
        0,
        "Companion incomplete; inspect its owned termination and logs",
    );
    return outcome;
}

export async function admitCompanion(spec, approval) {
    validateCompanionSpec(spec);
    assert.equal(
        spec.approvalHash,
        digest(encode(approval)),
        "Approval changed",
    );
    assert.equal(spec.workAllowanceMs, (approval.workMinutes + 5) * 60000);
    const root = await realpath(spec.runDirectory);
    const owner = await readJson(path.join(root, "ownership.json"));
    assert.equal(
        root,
        path.join(await realpath(spec.pilotDirectory), "companion-attempt"),
    );
    assert.equal(owner.runDirectory, root);
    assert.equal(owner.receiptId, spec.receiptId);
    const admittedEpochMs = Date.now();
    await writeNew(path.join(root, "admitted.json"), {
        receiptId: spec.receiptId,
        workerPid: process.pid,
        admittedEpochMs,
        workDeadlineEpochMs: admittedEpochMs + spec.workAllowanceMs,
        checkpointExpectationHash: checkpointExpectationHash(
            spec.expectedCheckpoint,
        ),
        compiledHashesHash: digest(encode(spec.expectedCheckpoint.hashes)),
    });
    return AbortSignal.timeout(approval.workMinutes * 60000);
}

export async function liveCancellation(modules, directory, prepared, settings) {
    assert.deepEqual(
        settingsArtifact(settings, modules.client.embeddingModelForRole)
            .identities,
        prepared.artifact.identities,
    );
    const file = path.join(directory, "live-cancellation.db");
    await copyFile(path.join(directory, "baseline.db"), file);
    const controller = new AbortController();
    const reason = new Error("Approved live cancellation during preparation");
    let activeCalls = 0;
    let completed = 0;
    let started = 0;
    let abortedEpochMs;
    const calls = {
        async invoke(_method, _identity, _args, work) {
            settings.preparedIndexing.signal.throwIfAborted();
            started++;
            activeCalls++;
            try {
                const pending = work();
                if (!controller.signal.aborted) {
                    abortedEpochMs = Date.now();
                    controller.abort(reason);
                }
                const result = await pending;
                completed++;
                return result;
            } finally {
                activeCalls--;
            }
        },
    };
    const active = { commit: false };
    instrumentSettings(
        settings,
        calls,
        active,
        modules.client.embeddingModelForRole,
    );
    const admissionSignal = settings.preparedIndexing.signal;
    settings.preparedIndexing.signal = AbortSignal.any([
        controller.signal,
        admissionSignal,
    ]);
    const opened = openStorage(modules, file, settings, { active });
    try {
        assert.equal(
            await modules.kp.restorePreparedConversationIndex(
                opened.conversation,
                settings,
            ),
            1,
        );
        const mirror = encode(opened.conversation.semanticRefIndex.serialize());
        const before = encode(logicalState(opened));
        await assert.rejects(
            modules.kp.addToConversationIndex(
                opened.conversation,
                settings,
                1,
                opened.conversation.semanticRefs.length,
            ),
            (error) => error === reason,
        );
        assert.ok(completed > 0, "No live model invocation completed");
        assert.equal(
            activeCalls,
            0,
            "Outstanding provider work was not drained",
        );
        assert.equal(
            encode(logicalState(opened)),
            before,
            "Cancelled generation was accepted",
        );
        assert.equal(
            encode(opened.conversation.semanticRefIndex.serialize()),
            mirror,
            "Cancelled mirrors changed",
        );
        return {
            status: "passed",
            mode: "live-provider",
            startedModelInvocations: started,
            completedModelInvocations: completed,
            outstanding: activeCalls,
            drainMs: Date.now() - abortedEpochMs,
            boundary:
                "Model promises started before cancellation; no provider abort signal injected",
        };
    } finally {
        opened.close();
    }
}

export async function recordCompanionWork(
    modules,
    directory,
    construction,
    createSettings,
    tape,
    qualify,
    liveSettings,
    verifyCheckpoint,
) {
    const events = [];
    const restore = observeProvider(events, () => "indexing-companion");
    const metrics = {
        schemaVersion: 1,
        status: "running",
        startedEpochMs: Date.now(),
        providerRequests: events,
    };
    let settings;
    try {
        settings = await createSettings();
        const prepared = await capturePreparation(
            modules,
            directory,
            construction,
            settings,
            tape,
        );
        settings.preparedIndexing.signal.throwIfAborted();
        const result = await qualify(prepared);
        settings.preparedIndexing.signal.throwIfAborted();
        result.liveCancellation = liveSettings
            ? await liveCancellation(
                  modules,
                  directory,
                  prepared,
                  await liveSettings(),
              )
            : "not-run-requires-separate-approval";
        await verifyCheckpoint();
        metrics.status = "complete";
        await writeNew(path.join(directory, "qualification.json"), result);
    } catch (error) {
        metrics.status = settings?.preparedIndexing.signal?.aborted
            ? "interrupted"
            : "failed";
        metrics.failure = benchmarkFailure(error);
        throw error;
    } finally {
        restore();
        metrics.finishedEpochMs = Date.now();
        metrics.recordedModelInvocations = tape.calls;
        metrics.httpAccounting =
            "Observed responses only; transport failures may have unobserved request/usage cost";
        await writeJson(
            path.join(
                path.dirname(directory),
                "companion-attempt",
                "work.json",
            ),
            metrics,
        );
    }
}
