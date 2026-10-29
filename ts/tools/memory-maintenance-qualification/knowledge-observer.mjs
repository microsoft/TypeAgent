// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export function abortableObservation(work, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        const finish = (callback, value) => {
            signal.removeEventListener("abort", abort);
            callback(value);
        };
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve(work).then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
        );
        if (signal.aborted) abort();
    });
}

export function knowledgeWaitOutcome(error, signal) {
    if (signal.aborted) return "interrupted";
    return error.message ===
        "Timed out waiting for knowledge checkpoint; work continues"
        ? "timed-out"
        : "failed";
}

function familyProgress(checkpoint, summary) {
    return (checkpoint.families ?? []).map((family) => {
        if (checkpoint.state === "ready")
            return { family, state: "complete", evidence: "checkpoint-ready" };
        const status =
            family === "wiki"
                ? summary?.wikiFamily
                : family === "projects"
                  ? summary?.projectFamily
                  : undefined;
        if (!status)
            return { family, state: "unknown", evidence: "unavailable" };
        return {
            family,
            state:
                status.error || !status.enabled
                    ? "blocked"
                    : status.pending
                      ? "pending"
                      : "complete",
            evidence: "independent-family-status",
            ...(status.error ? { reason: status.error } : {}),
        };
    });
}

// Family completion is independent progress, never a substitute for a ready
// required checkpoint. Public APIs do not expose all per-family debt.
export function checkpointObservation(checkpoint, summary) {
    const families = familyProgress(checkpoint, summary);
    return {
        checkpointId: checkpoint.checkpointId,
        observedEpochMs: Date.now(),
        checkpointUpdatedAt: checkpoint.updatedAt ?? null,
        durableState: checkpoint.state,
        requiredCheckpointSatisfied: checkpoint.state === "ready",
        completedFamilies: families
            .filter((entry) => entry.state === "complete")
            .map((entry) => entry.family),
        remainingFamilyDebt: families.filter(
            (entry) => entry.state !== "complete",
        ),
        families,
    };
}

export function createCheckpointObserver(service, record, controls) {
    const intervalMs = controls.observationIntervalMs ?? 30000;
    assert.ok(intervalMs > 0 && intervalMs <= 60000);
    assert.equal(typeof service.getKnowledgeCheckpoint, "function");
    const controller = new AbortController();
    const signal = AbortSignal.any([controls.signal, controller.signal]);
    const completion = Promise.withResolvers();
    const checkpointId = record.knowledgeCheckpoint.checkpointId;
    const report = (record.knowledgeObservation = {
        ...checkpointObservation(record.knowledgeCheckpoint),
        status: "unknown",
        observedEpochMs: null,
        staleAfterEpochMs: null,
        refreshIntervalMs: intervalMs,
        active: true,
        errors: record.knowledgeObservation?.errors ?? [],
    });
    let timer;
    let tail = Promise.resolve();
    let stopped = false;
    let settled = false;
    let observationFailure;
    const settle = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        report.active = false;
        signal.removeEventListener("abort", abort);
        if (error) completion.reject(error);
        else completion.resolve();
    };
    const abort = () => {
        stopped = true;
        clearTimeout(timer);
        // Join the in-flight read/publication before service close.
        void tail.then(
            () => settle(observationFailure),
            (error) => settle(error),
        );
    };
    signal.addEventListener("abort", abort, { once: true });

    const read = async () => {
        if (stopped || signal.aborted) return;
        let checkpoint;
        let summary;
        let observedEpochMs;
        try {
            checkpoint = await service.getKnowledgeCheckpoint({
                corpusId: record.corpusId,
                checkpointId,
            });
            observedEpochMs = Date.now();
            assert.equal(
                checkpoint?.checkpointId,
                checkpointId,
                "Authoritative knowledge checkpoint is unavailable or changed",
            );
            if (stopped || signal.aborted) return;
            if (service.listViewSummaries)
                summary = await service.listViewSummaries({
                    corpusId: record.corpusId,
                    pageSize: 1,
                });
        } catch (error) {
            report.status =
                report.observedEpochMs === null ? "unknown" : "stale";
            report.active = false;
            report.errors.push({
                stage: "status-read",
                recordedEpochMs: Date.now(),
                error: controls.failure(error),
            });
            try {
                await controls.persist();
            } catch (persistError) {
                report.errors.push({
                    stage: "persistence",
                    recordedEpochMs: Date.now(),
                    error: controls.failure(persistError),
                });
                throw new AggregateError(
                    [error, persistError],
                    "Knowledge status read and observation persistence failed",
                );
            }
            throw error;
        }
        if (stopped || signal.aborted) return;
        record.knowledgeCheckpoint = checkpoint;
        Object.assign(report, checkpointObservation(checkpoint, summary), {
            status: "current",
            observedEpochMs,
            staleAfterEpochMs: observedEpochMs + 60000,
            familyObservedEpochMs: summary ? Date.now() : null,
            active:
                !settled && ["pending", "running"].includes(checkpoint.state),
        });
        try {
            await controls.persist();
        } catch (error) {
            report.status = "stale";
            report.active = false;
            report.errors.push({
                stage: "persistence",
                recordedEpochMs: Date.now(),
                error: controls.failure(error),
            });
            throw error;
        }
        if (!["pending", "running"].includes(checkpoint.state)) settle();
    };
    const refresh = () => {
        tail = tail.then(read);
        void tail.then(undefined, (error) => {
            observationFailure = error;
            settle(error);
        });
        return tail;
    };
    const tick = () => {
        const startedEpochMs = Date.now();
        void refresh().then(
            () => {
                if (!stopped && !settled)
                    timer = setTimeout(
                        tick,
                        Math.max(0, intervalMs - (Date.now() - startedEpochMs)),
                    );
            },
            (error) => {
                observationFailure = error;
                settle(error);
            },
        );
    };
    if (signal.aborted) abort();
    else tick();
    return {
        done: completion.promise,
        refresh,
        stop() {
            stopped = true;
            clearTimeout(timer);
            report.active = false;
            controller.abort(new Error("Knowledge observation stopped"));
            return Promise.all([tail, completion.promise]).then(
                () => undefined,
            );
        },
    };
}
