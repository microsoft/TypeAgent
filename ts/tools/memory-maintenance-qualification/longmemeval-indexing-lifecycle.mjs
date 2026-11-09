// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { cp, mkdtemp } from "node:fs/promises";
import path from "node:path";

const keys = (result) =>
    result.matches
        .map((match) =>
            JSON.stringify([match.sourceId, match.revisionId, match.locator]),
        )
        .sort();

export async function measureIndexingCase(record, enabled, work) {
    if (!enabled) return work();
    const start = performance.now();
    const cpu = process.cpuUsage();
    const memoryBefore = process.memoryUsage();
    try {
        return await work();
    } finally {
        record.indexingMetrics = {
            elapsedMs: performance.now() - start,
            cpuMicroseconds: process.cpuUsage(cpu),
            memoryBefore,
            memoryAfter: process.memoryUsage(),
            processLifetimeMaxRssKiB: process.resourceUsage().maxRSS,
            boundary:
                "executeMemoryCase: ingestion, knowledge readiness, answer and judge; excludes restart/clone",
            gcPauseMs: null,
            allocationCount: null,
        };
    }
}

export async function startIndexingCase(service, context) {
    if (!context.enabled) return { service, store: context.store };
    await service.close();
    const store = await mkdtemp(
        path.join(context.runDirectory, "indexing-case-"),
    );
    const current = await context.open(store);
    try {
        await current.initialize();
        return { service: current, store };
    } catch (error) {
        await current.close();
        throw error;
    }
}

export async function finishIndexingCase(service, context) {
    if (!context.enabled) return service;
    const lifecycle = await verifyIndexingLifecycle(
        service,
        () => context.open(context.store),
        async () => {
            const copy = await mkdtemp(
                path.join(context.runDirectory, "indexing-recovery-"),
            );
            const destination = path.join(copy, "store");
            await cp(context.store, destination, {
                recursive: true,
                force: false,
                errorOnExist: true,
            });
            return {
                service: await context.open(destination),
                reopen: () => context.open(destination),
            };
        },
        context.record.corpusId,
        context.question,
        context.signal,
    );
    context.record.indexingLifecycle = lifecycle.result;
    await context.persist();
    return lifecycle.service;
}

export async function verifyIndexingLifecycle(
    service,
    reopen,
    clone,
    corpusId,
    question,
    signal,
) {
    const request = {
        corpusId,
        query: question,
        limit: 10,
        indexedFragments: true,
        retrievalPolicy: "sourcesOnly",
    };
    const before = await service.search(request);
    await service.close();
    let destructive;
    let current;
    try {
        const copy = await clone();
        destructive = copy.service;
        const start = performance.now();
        current = await reopen();
        await current.initialize();
        signal.throwIfAborted();
        const after = await current.search(request);
        const reloadAndQueryMs = performance.now() - start;
        assert.deepEqual(
            keys(after),
            keys(before),
            "Restart changed source retrieval",
        );
        for (const match of after.matches) {
            const source = await current.getSource(corpusId, match.sourceId);
            assert.equal(
                source?.activeRevisionId,
                match.revisionId,
                "Ineligible revision returned",
            );
        }
        const result = {
            restart: after.matches.length
                ? "passed"
                : "not-exercised-no-retrieval",
            matches: keys(after),
            reloadAndQueryMs,
            forget: "not-exercised-no-retrieval",
            clear: "not-run",
        };
        await destructive.initialize();
        if (after.matches.length) {
            const sourceId = after.matches[0].sourceId;
            const preview = await destructive.previewForgetSource(
                corpusId,
                sourceId,
            );
            await destructive.forgetSource({
                corpusId,
                sourceId,
                confirmationToken: preview.confirmationToken,
            });
            await destructive.close();
            destructive = await copy.reopen();
            await destructive.initialize();
            assert.equal(
                await destructive.getSource(corpusId, sourceId),
                undefined,
            );
            assert.deepEqual(
                (
                    await destructive.search({
                        ...request,
                        sourceIds: [sourceId],
                    })
                ).matches,
                [],
            );
            result.forget = "passed";
        }
        await destructive.clearCorpus(corpusId);
        await destructive.close();
        destructive = await copy.reopen();
        await destructive.initialize();
        assert.deepEqual((await destructive.search(request)).matches, []);
        result.clear = "passed";
        return { service: current, result };
    } catch (error) {
        await current?.close();
        throw error;
    } finally {
        await destructive?.close();
    }
}
