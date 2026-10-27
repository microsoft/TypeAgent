// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getEventListeners } from "node:events";
import {
    classifyStoppedRun,
    observeProvider,
    observedRoles,
    unexpectedTargets,
    loadLiveContract,
    livePhases,
    liveAllowances,
    maintainLiveFamily,
} from "./live-stages.mjs";

test("baseline19 permits thirty minutes from spawn plus five minutes for cleanup without extending other scopes", () => {
    const baseline = liveAllowances({ sourceScope: "baseline19" });
    assert.equal(baseline.workAllowanceMs, 35 * 60 * 1000);
    assert.equal(baseline.cleanupReserveMs, 5 * 60 * 1000);
    assert.equal(
        baseline.workAllowanceMs - baseline.cleanupReserveMs,
        30 * 60 * 1000,
    );
    assert.deepEqual(liveAllowances({}), {
        workAllowanceMs: 1200000,
        cleanupReserveMs: 120000,
    });
});

test("baseline19 qualification excludes temporal extensions and uses all three original delta batches", () => {
    assert.deepEqual(livePhases({ sourceScope: "baseline19" }), [
        "baseline",
        "meeting-orders",
        "correction",
    ]);
    assert.deepEqual(livePhases({}), [
        "baseline",
        "meeting-orders",
        "correction",
        "initial",
        "t1",
        "t2",
    ]);
    assert.throws(
        () => livePhases({ sourceScope: "unknown" }),
        /Unsupported live source scope/,
    );
});

test("actual fresh compiled live imports/public APIs and production job handle completion are available", async () => {
    const productRoot = fileURLToPath(new URL("../../", import.meta.url));
    const loaded = [];
    const contract = await loadLiveContract(async (relative) => {
        loaded.push(relative);
        return import(pathToFileURL(path.join(productRoot, relative)).href);
    });

    assert.ok(loaded.includes("packages\\memory\\service\\dist\\rpcFacade.js"));
    assert.ok(!loaded.includes("packages\\memory\\client\\dist\\index.js"));
    const status = {
        jobId: "compiled-job-handle-control",
        state: "complete",
        progress: {},
    };
    const reads = [];
    assert.equal(
        await contract.waitForMemoryJob(
            {
                async getJob(jobId) {
                    reads.push(jobId);
                    return status;
                },
                async cancelJob() {
                    assert.fail("Completed handle must not cancel");
                },
            },
            status.jobId,
        ),
        status,
    );
    assert.deepEqual(reads, [status.jobId]);
});

test("polling cancellation cancels the actual ingestion job before rejecting", async () => {
    const { waitForMemoryJob } = await import(
        "../../packages/memory/service/dist/rpcFacade.js"
    );
    const controller = new AbortController();
    const reason = new Error("controlled work boundary");
    const cancelled = [];
    const waiting = waitForMemoryJob(
        {
            async getJob() {
                setTimeout(() => controller.abort(reason), 5);
                return { state: "extracting", progress: {} };
            },
            async cancelJob(id) {
                cancelled.push(id);
            },
        },
        "owned-job",
        { signal: controller.signal, pollIntervalMs: 1000 },
    );
    await assert.rejects(waiting, (error) => error === reason);
    assert.deepEqual(cancelled, ["owned-job"]);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("polling completion removes abort listeners after every successful delay", async () => {
    const { waitForMemoryJob } = await import(
        "../../packages/memory/service/dist/rpcFacade.js"
    );
    const controller = new AbortController();
    let reads = 0;
    const result = await waitForMemoryJob(
        {
            async getJob() {
                return {
                    state: ++reads === 4 ? "complete" : "extracting",
                    progress: {},
                };
            },
            async cancelJob() {
                assert.fail("Completed ingestion must not be cancelled");
            },
        },
        "owned-job",
        { signal: controller.signal, pollIntervalMs: 1 },
    );
    assert.equal(result.state, "complete");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("family activation refreshes the optimistic head only for recognized stale-head errors", async () => {
    class StaleHead extends Error {}
    const requests = [];
    const diagnostics = [];
    const proofs = [];
    let head = 0;
    const hooks = {
        checkDeadline() {},
        isStale: (error) => error instanceof StaleHead,
        onDiagnostic: (value) => diagnostics.push(value),
        onSuccessfulReturn: (value) => proofs.push(value),
        wait: async () => {},
    };
    const service = {
        async listViews() {
            return { head: `head-${++head}` };
        },
        async maintainViews(request) {
            requests.push(request);
            if (requests.length === 1)
                throw new StaleHead("Concurrent family write");
            return { accepted: true };
        },
    };
    assert.deepEqual(
        await maintainLiveFamily(
            service,
            { corpusId: "owned", family: "projects", operation: "resume" },
            hooks,
        ),
        { accepted: true },
    );
    assert.deepEqual(
        requests.map((request) => request.expectedHead),
        ["head-1", "head-2"],
    );
    assert.equal(diagnostics.length, 1);
    assert.equal(proofs.length, 1);
    const failure = new Error("Real product failure");
    service.maintainViews = async () => {
        throw failure;
    };
    await assert.rejects(
        maintainLiveFamily(
            service,
            { corpusId: "owned", family: "wiki", operation: "resume" },
            hooks,
        ),
        (error) => error === failure,
    );
    assert.equal(head, 3);
});

test("live observer returns unchanged responses and records only model/usage/admission metadata", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                model: "gpt-6-luna-test",
                usage: { total_tokens: 19 },
                choices: [{ message: { content: "private-body" } }],
            }),
            { headers: { "content-type": "application/json" } },
        );
    const events = [];
    const restore = observeProvider(events, () => "synopsis");
    try {
        const response = await fetch(
            "https://example.invalid/openai/deployments/gpt-6-luna/chat/completions",
            {
                body: JSON.stringify({
                    messages: [{ content: "private-prompt" }],
                }),
            },
        );
        assert.equal(
            (await response.json()).choices[0].message.content,
            "private-body",
        );
        assert.equal(events[0].model, "gpt-6-luna-test");
        assert.equal(events[0].requestedOutputTokens, undefined);
        assert.ok(!JSON.stringify(events).includes("private-"));
        assert.ok(!JSON.stringify(events).includes("example.invalid"));
    } finally {
        restore();
        globalThis.fetch = original;
    }
});

test("provider observation preserves request classification precedence and endpoint matching", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 204 });
    const events = [];
    const restore = observeProvider(events);
    try {
        for (const [endpoint, body, type, questionCount] of [
            ["/decision", { questions: { fit: {} } }, "decision", 1],
            ["/chat/completions", { questions: {} }, "decision", 0],
            ["/chat/completions", {}, "chat", undefined],
            ["/embeddings", { questions: null }, "embedding", undefined],
            ["/responses", {}, "other-production-request", undefined],
            ["/chat/completions/", {}, "other-production-request", undefined],
        ]) {
            await fetch(`https://example.invalid${endpoint}`, {
                body: JSON.stringify(body),
            });
            assert.equal(events.at(-1).type, type);
            assert.equal(events.at(-1).decisionQuestionCount, questionCount);
            assert.equal(events.at(-1).status, 204);
        }
        assert.equal(events.length, 6);
    } finally {
        restore();
        globalThis.fetch = original;
    }
});

test("production role observation delegates exact arguments and output without validation substitutes", async () => {
    const sentinel = {};
    const signal = new AbortController().signal;
    const receipt = { roleCalls: [] };
    const model = {
        async synthesize(...args) {
            assert.deepEqual(args, ["original", signal]);
            return sentinel;
        },
        fits: () => false,
    };
    const wrapped = observedRoles(model, "view", receipt);
    assert.equal(await wrapped.synthesize("original", signal), sentinel);
    assert.equal(wrapped.fits, model.fits);
    assert.equal(receipt.roleCalls[0].role, "view.synthesize");
});

test("first actual failed target stops even while its containing job is still running", () => {
    const jobs = [
        {
            jobId: "a",
            state: "running",
            results: [{ viewId: "view", state: "failed" }],
        },
    ];
    assert.equal(unexpectedTargets(jobs).length, 1);
    assert.equal(unexpectedTargets(jobs, "a").length, 0);
});

test("recovered earlier429 does not relabel a later product failure as throttle", () => {
    assert.equal(
        classifyStoppedRun(new Error("Unexpected target"), [
            { status: 429 },
            { status: 200 },
        ]),
        "STOPPED_FIRST_UNEXPECTED_PRODUCT_OR_ROLE_FAILURE",
    );
    assert.equal(
        classifyStoppedRun(new Error("429 exhausted"), [{ status: 429 }]),
        "PARTIAL_CONFIGURED_PROVIDER_THROTTLE",
    );
    assert.equal(
        classifyStoppedRun(
            Object.assign(new Error("budget"), { name: "TimeoutError" }),
            [],
        ),
        "PARTIAL_BOUNDED_WORK",
    );
    assert.equal(
        classifyStoppedRun(new Error("failed request"), [{ status: 400 }]),
        "STOPPED_PROVIDER_REQUEST_FAILURE",
    );
});
