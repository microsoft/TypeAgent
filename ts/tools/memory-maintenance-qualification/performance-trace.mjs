// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import path from "node:path";

export function unionMs(intervals, start, end) {
    const sorted = intervals
        .map(([a, b]) => [Math.max(a, start), Math.min(b, end)])
        .filter(([a, b]) => b > a)
        .sort((a, b) => a[0] - b[0]);
    let total = 0,
        right = start;
    for (const [a, b] of sorted) {
        total += Math.max(0, b - Math.max(a, right));
        right = Math.max(right, b);
    }
    return total;
}

function viewMetadata(args, input) {
    const first = args[0];
    const definition = input?.definition ?? args[1]?.snapshot?.definition;
    return {
        corpusId: first?.corpusId,
        jobId: first?.jobId ?? (args[1]?.snapshot ? first?.id : undefined),
        viewId: definition?.viewId ?? first?.viewId ?? args[1]?.viewId,
        query: (definition?.wiki ?? definition?.projectSummary)?.query,
        fingerprint:
            typeof input?.inputFingerprint === "string"
                ? input.inputFingerprint
                : undefined,
    };
}

function sourceMetadata(first, input) {
    return {
        sources: first?.sourceIds?.length ?? input?.inputs?.length,
        sourceId: first?.sourceId,
        revisionId: first?.revisionId,
        fragments: input?.inputs?.reduce(
            (n, source) => n + (source.passages?.length ?? 0),
            0,
        ),
    };
}

function metadata(args) {
    const first = args[0];
    const input = first?.snapshot ?? args[1]?.snapshot ?? first;
    return { ...viewMetadata(args, input), ...sourceMetadata(first, input) };
}

function statistics() {
    return {
        calls: 0,
        active: 0,
        maxActive: 0,
        inclusiveMs: 0,
        maxMs: 0,
        errors: 0,
        errorCodes: {},
        returnedBytes: 0,
        returnedChars: 0,
    };
}

export function createPerformanceTrace(directory, runId, phase) {
    const targetContext = new AsyncLocalStorage();
    const stream = createWriteStream(
        path.join(directory, "performance-events.jsonl"),
    );
    const spans = new Map(),
        active = new Set(),
        groups = {},
        perTarget = {};
    const restores = [],
        filesystems = new WeakSet();
    const loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
    const cpuStart = process.cpuUsage(),
        utilizationStart = performance.eventLoopUtilization();
    const start = performance.now();
    let sequence = 0,
        spanSequence = 0,
        bytes = 0,
        loggerMs = 0,
        backpressure = 0,
        error,
        closed = false;
    stream.on("error", (failure) => {
        error = failure;
        console.error("TRACE_FAILED", failure.name, failure.message);
    });
    function emitSparse(event, edge, data = {}) {
        if (error) return;
        const before = performance.now();
        const line =
            JSON.stringify({
                runId,
                seq: ++sequence,
                pid: process.pid,
                phase: phase(),
                wallEpochMs: Date.now(),
                monoNs: process.hrtime.bigint().toString(),
                monoMs: performance.now(),
                event,
                edge,
                ...data,
            }) + "\n";
        bytes += Buffer.byteLength(line);
        if (
            bytes > 256 * 1024 * 1024 ||
            stream.writableLength > 16 * 1024 * 1024
        ) {
            error = new Error(
                "TRACE_INCOMPLETE: explicit telemetry byte/backlog bound exhausted",
            );
            console.error(error.message);
            return;
        }
        if (!stream.write(line)) backpressure++;
        loggerMs += performance.now() - before;
    }
    function bucket(event, targetId) {
        const key = `${phase()}/${event}`;
        const global = (groups[key] ??= statistics());
        const target = targetId ? (perTarget[targetId] ??= {}) : undefined;
        return [global, target ? (target[event] ??= statistics()) : undefined];
    }
    function finishRollup(buckets, elapsed, failure, result) {
        for (const item of buckets) {
            if (!item) continue;
            item.active--;
            item.inclusiveMs += elapsed;
            item.maxMs = Math.max(item.maxMs, elapsed);
            if (failure) {
                item.errors++;
                const code = failure.code ?? failure.name ?? "unknown";
                item.errorCodes[code] = (item.errorCodes[code] ?? 0) + 1;
            }
            if (Buffer.isBuffer(result) || ArrayBuffer.isView(result))
                item.returnedBytes += result.byteLength;
            else if (typeof result === "string")
                item.returnedChars += result.length;
        }
    }
    function observeRollup(event, original, receiver, args) {
        const current = targetContext.getStore();
        const buckets = bucket(event, current?.id),
            before = performance.now();
        for (const item of buckets)
            if (item) {
                item.calls++;
                item.active++;
                item.maxActive = Math.max(item.maxActive, item.active);
            }
        let value;
        try {
            value = Reflect.apply(original, receiver, args);
        } catch (failure) {
            finishRollup(buckets, performance.now() - before, failure);
            throw failure;
        }
        if (value instanceof Promise)
            void value.then(
                (result) =>
                    finishRollup(
                        buckets,
                        performance.now() - before,
                        undefined,
                        result,
                    ),
                (failure) =>
                    finishRollup(buckets, performance.now() - before, failure),
            );
        else
            finishRollup(buckets, performance.now() - before, undefined, value);
        return value;
    }
    function invoke(event, original, receiver, args, extra = {}) {
        const parent = targetContext.getStore();
        const id = `${process.pid}:${++spanSequence}`;
        const span = {
            id,
            parentId: parent?.id,
            event,
            phase: phase(),
            start: performance.now(),
            ...metadata(args),
            ...extra,
        };
        spans.set(id, span);
        active.add(id);
        const item = (groups[`${span.phase}/${event}`] ??= statistics());
        item.calls++;
        item.active++;
        item.maxActive = Math.max(item.maxActive, item.active);
        emitSparse(event, "ENTER", span);
        const signal = args.find((arg) => arg instanceof AbortSignal);
        const abort = () => {
            span.abortMs = performance.now();
            emitSparse(event, "ABORT", {
                id,
                parentId: parent?.id,
                elapsedMs: span.abortMs - span.start,
                reason: signal.reason?.message ?? String(signal.reason),
            });
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        const settle = (edge, result) => {
            span.end = performance.now();
            span.edge = edge;
            active.delete(id);
            signal?.removeEventListener("abort", abort);
            span.state =
                typeof result?.state === "string" ? result.state : undefined;
            span.reason = edge === "ERROR" ? result?.message : undefined;
            item.active--;
            item.inclusiveMs += span.end - span.start;
            item.maxMs = Math.max(item.maxMs, span.end - span.start);
            item.errors += edge === "ERROR" ? 1 : 0;
            emitSparse(event, edge, {
                id,
                parentId: parent?.id,
                elapsedMs: span.end - span.start,
                state: span.state,
                aborted: signal?.aborted,
                fragments: result?.fragments?.length,
                readChars: result?.readChars,
                error:
                    edge === "ERROR"
                        ? { name: result?.name, message: result?.message }
                        : undefined,
            });
        };
        const call = () => {
            let value;
            try {
                value = Reflect.apply(original, receiver, args);
            } catch (failure) {
                settle("ERROR", failure);
                throw failure;
            }
            if (value instanceof Promise)
                void value.then(
                    (result) => settle("EXIT", result),
                    (failure) => settle("ERROR", failure),
                );
            else settle("EXIT", value);
            return value;
        };
        return event === "runner.target"
            ? targetContext.run(span, call)
            : call();
    }
    const sparse = (event) =>
        event.startsWith("adapter.") ||
        event === "synopsis.complete" ||
        [
            "runner.target",
            "runner.consolidateWikiTarget",
            "service.prepareWikiTargets",
            "service.ingestDocument",
            "service.replaceSource",
            "service.initialize",
            "service.close",
        ].includes(event) ||
        !/^(history|gitfs|index|store|runner|service|synopsis)\./.test(event);
    function wrap(target, method, event = method, before) {
        const original = target[method];
        assert.equal(
            typeof original,
            "function",
            `Missing actual trace hook ${event}`,
        );
        target[method] = function (...args) {
            before?.(this);
            return sparse(event)
                ? invoke(event, original, this, args)
                : observeRollup(event, original, this, args);
        };
        const restore = () => {
            target[method] = original;
        };
        restores.push(restore);
        return restore;
    }
    function filesystem(history) {
        const fs = history.filesystem?.promises;
        if (!fs || filesystems.has(fs)) return;
        filesystems.add(fs);
        assert.ok(
            path
                .resolve(history.directory)
                .startsWith(path.resolve(directory) + path.sep),
        );
        for (const method of ["readFile", "writeFile", "stat", "readdir"]) {
            const original = fs[method];
            if (typeof original !== "function") continue;
            fs[method] = function (...args) {
                const file = typeof args[0] === "string" ? args[0] : "";
                const kind = file.includes(`${path.sep}objects${path.sep}`)
                    ? "object"
                    : file.includes(`${path.sep}refs${path.sep}`)
                      ? "ref"
                      : "other";
                return observeRollup(
                    `gitfs.${method}.${kind}`,
                    original,
                    this,
                    args,
                );
            };
            restores.push(() => {
                fs[method] = original;
            });
        }
    }
    function queue(target, method, event) {
        const original = target[method];
        assert.equal(typeof original, "function");
        target[method] = function (operation, ...args) {
            const parent = targetContext.getStore();
            const queueId = `${process.pid}:queue:${++spanSequence}`;
            const entered = performance.now();
            const callback = function (...values) {
                return invoke(`${event}.callback`, operation, this, values, {
                    queueId,
                    waitMs: performance.now() - entered,
                    parentId: parent?.id,
                });
            };
            return invoke(
                `${event}.queue`,
                original,
                this,
                [callback, ...args],
                { queueId },
            );
        };
        restores.push(() => {
            target[method] = original;
        });
    }
    function health() {
        emitSparse("health", "SAMPLE", {
            cpu: process.cpuUsage(cpuStart),
            memory: process.memoryUsage(),
            utilization: performance.eventLoopUtilization(utilizationStart),
            loopP95Ms: loop.percentile(95) / 1e6,
            loopMaxMs: loop.max / 1e6,
            outstandingSpans: active.size,
            outstandingRollupCalls: Object.values(groups).reduce(
                (n, item) => n + item.active,
                0,
            ),
        });
    }
    emitSparse("clock", "ANCHOR");
    const timer = setInterval(health, 2000);
    timer.unref();
    return {
        invoke,
        wrap,
        queue,
        filesystem,
        event: emitSparse,
        check() {
            if (error) throw error;
        },
        pending() {
            return [...active].map((id) => ({
                ...spans.get(id),
                outstandingMs: performance.now() - spans.get(id).start,
            }));
        },
        async close() {
            if (closed) throw new Error("Trace closed twice");
            closed = true;
            clearInterval(timer);
            health();
            emitSparse("clock", "ANCHOR");
            loop.disable();
            restores.reverse().forEach((restore) => restore());
            stream.end();
            await finished(stream);
            const end = performance.now(),
                children = new Map(),
                targets = [];
            for (const span of spans.values())
                if (span.parentId) {
                    const list = children.get(span.parentId) ?? [];
                    list.push([span.start, span.end ?? end]);
                    children.set(span.parentId, list);
                }
            for (const span of spans.values())
                if (span.event === "runner.target") {
                    const finish = span.end ?? end;
                    targets.push({
                        ...span,
                        inclusiveMs: finish - span.start,
                        exclusiveMs:
                            finish -
                            span.start -
                            unionMs(
                                children.get(span.id) ?? [],
                                span.start,
                                finish,
                            ),
                        rollups: perTarget[span.id] ?? {},
                    });
                }
            return {
                status: error
                    ? "TRACE_FAILED"
                    : "COMPLETE_SPARSE_AND_ROLLUP_COVERAGE",
                error: error?.message,
                mode: "sparse-native-cpu",
                wallMs: end - start,
                events: sequence,
                bytes,
                loggerMs,
                backpressure,
                droppedEvents: error ? "explicit TRACE_FAILED" : 0,
                cpu: process.cpuUsage(cpuStart),
                utilization: performance.eventLoopUtilization(utilizationStart),
                loopP50Ms: loop.percentile(50) / 1e6,
                loopP95Ms: loop.percentile(95) / 1e6,
                loopP99Ms: loop.percentile(99) / 1e6,
                loopMaxMs: loop.max / 1e6,
                groups,
                pendingRollups: Object.entries(groups)
                    .filter(([, item]) => item.active)
                    .map(([operation, item]) => ({
                        operation,
                        active: item.active,
                    })),
                targets,
                pending: this.pending(),
                accounting:
                    "Leaf operations are constant-size counters/latency/bytes, not retained spans/JSONL. ALS runs only once per runner.target. Sparse target exclusive subtracts child interval union; leaf sums overlap and are not critical-path partitions. Queue wait/actual callback intervals are observed; history lock release/held is unknown.",
            };
        },
    };
}

export async function installProductPerformance(
    trace,
    load,
    FileMemoryService,
    TypedViewStore,
) {
    const { ViewHistory } = await load(
        "packages\\memory\\service\\dist\\viewHistory.js",
    );
    const { CorpusAccess } = await load(
        "packages\\memory\\service\\dist\\corpusAccess.js",
    );
    const { ViewBuildRunner } = await load(
        "packages\\memory\\service\\dist\\viewBuilds.js",
    );
    for (const method of ["read", "commit", "head", "lock"])
        trace.wrap(
            ViewHistory.prototype,
            method,
            `history.${method}`,
            trace.filesystem,
        );
    trace.queue(CorpusAccess.prototype, "read", "access.read");
    trace.queue(CorpusAccess.prototype, "write", "access.write");
    for (const method of [
        "target",
        "run",
        "result",
        "prepareInventory",
        "consolidateWikiTarget",
        "verifyEditorialUpdate",
        "verifyContributionRefresh",
        "assessWikiAdmission",
        "skipInformationalTarget",
    ])
        trace.wrap(ViewBuildRunner.prototype, method, `runner.${method}`);
    for (const method of [
        "listViews",
        "listViewBuilds",
        "getViewBuild",
        "getTopicState",
        "getWikiFamily",
        "admitViewBuild",
        "materializeViewBuild",
        "updateViewBuild",
        "acceptWikiConsolidation",
        "activateWikiRedirect",
        "updateViewIndex",
        "saveViewDraft",
        "saveWikiFamily",
        "materializeTopicBuild",
    ])
        trace.wrap(TypedViewStore.prototype, method, `store.${method}`);
    for (const method of [
        "initialize",
        "close",
        "listViews",
        "listViewBuilds",
        "getViewBuild",
        "listSources",
        "getSourceContent",
        "ingestDocument",
        "replaceSource",
        "getJob",
        "maintainViews",
        "buildViews",
        "snapshotInformationalTarget",
        "prepareWikiTargets",
        "enqueueWrite",
        "enqueueDocumentRead",
        "readPreparedIndex",
    ])
        trace.wrap(FileMemoryService.prototype, method, `service.${method}`);
}
