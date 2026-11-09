// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConfig } from "@typeagent/config";
import {
    createDecisionModel,
    getRuntimeConfigGeneration,
} from "@typeagent/aiclient";
import {
    CrosswordDecisionHandler,
    countCrosswordDecisionTokens,
} from "../dist/agent/crosswordDecisionHandler.mjs";
import {
    loadServiceWorkerTransport,
    PrivateSocket,
    socketKey,
} from "./crosswordDecisionTransport.fixture.mjs";

function snapshot(candidateId) {
    return {
        origin: { tabId: 999, frameId: 999, documentId: "page-spoof" },
        clueNumber: 7,
        clueDirection: "down",
        snapshot: {
            snapshotId: `snapshot-${candidateId}`,
            documentToken: "collector-token",
            puzzleId: "puzzle",
            revision: 0,
            modeGeneration: 0,
            createdAt: Date.now(),
            complete: true,
            collectorVersion: 2,
            candidates: [
                { id: candidateId, text: "7. Offline clue", context: "Down" },
            ],
        },
    };
}

function inspectNativeRequest(provider, body, candidateId) {
    const state = provider === "azure" ? body.state : JSON.parse(body.input);
    assert.equal(state.clueNumber, 7);
    assert.equal(state.clueDirection, "down");
    assert.equal(state.candidates, undefined);
    assert.match(state.scopeContext, /opaque DOM\/frame boundaries/);
    const criteria = targetCriteria(provider, body);
    assert.equal(JSON.parse(criteria[candidateId]).text, "7. Offline clue");
    assert.equal(state.puzzleId, undefined);
    const expectedIds = [candidateId, "no_fit", "ambiguous"];
    if (provider === "azure") {
        assert.deepEqual(Object.keys(body.questions), ["target"]);
        assert.equal(body.questions.target.type, "choice");
        assert.deepEqual(
            Object.keys(body.questions.target.criteria),
            expectedIds,
        );
        assert.match(body.questions.target.instructions, /7 down/);
        assert.match(
            body.questions.target.criteria[candidateId],
            /7\. Offline clue/,
        );
    } else {
        assert.deepEqual(
            body.questions.map((question) => question.name),
            ["target"],
        );
        assert.match(body.questions[0].instructions, /7 down/);
        assert.equal(body.questions[0].type, "choice");
        assert.deepEqual(
            body.questions[0].choices.map((choice) => choice.value),
            expectedIds,
        );
    }
    assert.equal("messages" in body, false);
    assert.equal(JSON.stringify(body).includes("page-spoof"), false);
}

function targetCriteria(provider, body) {
    return provider === "azure"
        ? (body.questions.target?.criteria ?? {})
        : Object.fromEntries(
              (
                  body.questions.find((question) => question.name === "target")
                      ?.choices ?? []
              ).map(({ value, description }) => [value, description]),
          );
}

function nativeResponse(provider, body, selected) {
    const key =
        provider === "azure"
            ? Object.keys(body.questions)[0]
            : body.questions[0].name;
    const choices =
        provider === "azure"
            ? Object.keys(body.questions[key].criteria)
            : body.questions[0].choices.map((choice) => choice.value);
    const probabilities = Object.fromEntries(
        choices.map((id) => [id, id === selected ? 1 : 0]),
    );
    const answers =
        provider === "azure"
            ? {
                  [key]: {
                      type: "choice",
                      choice: selected,
                      probabilities,
                  },
              }
            : [
                  {
                      name: key,
                      type: "choice",
                      choice: selected,
                      probabilities: Object.entries(probabilities).map(
                          ([value, probability]) => ({ value, probability }),
                      ),
                  },
              ];
    return new Response(JSON.stringify({ answers }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

async function waitForCalls(calls, count) {
    for (let attempt = 0; calls.length < count && attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(
        calls.length,
        count,
        "Native HTTP calls reached expected count",
    );
}

test("real Azure native adapter preserves HTTP 422 for 16K evidence repacking", async () => {
    const originalFetch = globalThis.fetch;
    const observed = [];
    const config = buildConfig({
        AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
            "https://eastus.example/providers/microsoft/v1/systemone",
        AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "offline-test",
        AZURE_OPENAI_MAX_RETRYATTEMPTS: "0",
    });
    const input = snapshot("c0");
    input.snapshot.candidates = Array.from({ length: 36 }, (_, i) => ({
        id: `c${i}`,
        text: " x".repeat(256),
        context: " y".repeat(256),
        regionId: `region-${i % 3}`,
    }));
    const handler = new CrosswordDecisionHandler({
        createModel: () => createDecisionModel({ config, provider: "azure" }),
        generation: getRuntimeConfigGeneration,
        now: Date.now,
        timeoutMs: 5000,
        telemetry: () => {},
    });
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        const request = { state: body.state, questions: body.questions };
        observed.push(request);
        if (countCrosswordDecisionTokens(request) > 16 * 1024)
            return new Response(
                JSON.stringify({
                    detail: "Question prompt exceeds the 32768-token context limit including the decision token",
                }),
                {
                    status: 422,
                    headers: { "content-type": "application/json" },
                },
            );
        const answers = Object.fromEntries(
            Object.entries(request.questions).map(([key, question]) => {
                const choice =
                    key === "target"
                        ? Object.hasOwn(question.criteria, "c17")
                            ? "c17"
                            : "no_fit"
                        : "clues";
                return [
                    key,
                    {
                        type: "choice",
                        choice,
                        probabilities: Object.fromEntries(
                            Object.keys(question.criteria).map((id) => [
                                id,
                                id === choice ? 1 : 0,
                            ]),
                        ),
                    },
                ];
            }),
        );
        return new Response(JSON.stringify({ answers }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    try {
        const result = await handler.resolve(
            "offline-422",
            "native-repack",
            input,
        );
        assert.equal(result.status, "resolved");
        assert.equal(result.candidateId, "c17");
        assert.ok(countCrosswordDecisionTokens(observed[0]) > 16 * 1024);
        assert.ok(
            observed
                .slice(1)
                .every(
                    (request) =>
                        countCrosswordDecisionTokens(request) <= 16 * 1024,
                ),
        );
        assert.equal(
            observed.filter((request) => request.questions.target).length,
            3,
        );
    } finally {
        globalThis.fetch = originalFetch;
        handler.disconnect("offline-422");
    }
});

for (const provider of ["azure", "copilot"]) {
    test(
        `isolated SW private transport -> real handler -> real ${provider} native HTTP adapter`,
        { timeout: 5000 },
        async () => {
            const originalFetch = globalThis.fetch;
            const originalChrome = globalThis.chrome;
            const originalSocket = globalThis[socketKey];
            const calls = [];
            let mode = "hold";
            let endpointAcquisitions = 0;
            let activeTabLookups = 0;
            let broadcasts = 0;
            const config = buildConfig({
                AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
                    "https://eastus.example/providers/microsoft/v1/systemone",
                AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "offline-test",
                AZURE_OPENAI_MAX_RETRYATTEMPTS: "0",
                COPILOT_MAX_RETRYATTEMPTS: "0",
            });
            const endpointProvider = {
                async getEndpoint() {
                    endpointAcquisitions++;
                    return {
                        baseUrl: "https://copilot.example",
                        model: "gpt-6-luna-decisions",
                        headers: { Authorization: "offline-test" },
                    };
                },
            };
            const handler = new CrosswordDecisionHandler({
                createModel: () =>
                    createDecisionModel({ config, provider, endpointProvider }),
                generation: getRuntimeConfigGeneration,
                now: Date.now,
                timeoutMs: 1000,
                telemetry: () => {},
            });
            const socket = new PrivateSocket(handler);
            globalThis[socketKey] = socket;
            globalThis.chrome = {
                runtime: { id: "offline-extension" },
                permissions: { contains: async () => true },
                tabs: {
                    query() {
                        activeTabLookups++;
                        throw new Error("No active-tab lookup is permitted");
                    },
                    sendMessage() {
                        broadcasts++;
                        throw new Error("No broadcast is permitted");
                    },
                },
            };
            globalThis.fetch = async (url, options) => {
                assert.equal(
                    String(url),
                    provider === "azure"
                        ? "https://eastus.example/providers/microsoft/v1/systemone"
                        : "https://copilot.example/v1/decisions",
                );
                const body = JSON.parse(options.body);
                const key =
                    provider === "azure"
                        ? Object.keys(body.questions)[0]
                        : body.questions[0].name;
                assert.equal(
                    key,
                    "target",
                    "Only target selection reaches native HTTP",
                );
                if (mode === "error") {
                    calls.push({ body });
                    return new Response(
                        JSON.stringify({
                            error: { message: "offline failure" },
                        }),
                        { status: 503 },
                    );
                }
                if (mode === "no_fit") {
                    calls.push({ body });
                    return nativeResponse(provider, body, "no_fit");
                }
                return new Promise((resolve) =>
                    calls.push({ body, release: resolve }),
                );
            };
            try {
                const rpc = await loadServiceWorkerTransport();
                const capabilities = await rpc.forwardCrosswordDecisionRpc(
                    "getCrosswordDecisionCapabilities",
                );
                assert.equal(capabilities.available, true);
                assert.equal(capabilities.provider, provider);
                assert.equal(calls.length, 0);
                assert.equal(endpointAcquisitions, 0);
                const sender = {
                    id: "offline-extension",
                    tab: { id: 7 },
                    frameId: 0,
                    documentId: "top-document",
                    documentLifecycle: "active",
                    url: "https://crossword.example/puzzle",
                };
                const topOrigin = await rpc.getCrosswordRpcOrigin(sender);
                const frameOrigin = await rpc.getCrosswordRpcOrigin({
                    ...sender,
                    frameId: 2,
                    documentId: "iframe-document",
                });
                assert.ok(topOrigin);
                assert.ok(frameOrigin);
                const topRequest = snapshot("c-top");
                const frameRequest = snapshot("c-frame");
                let topDelivered = false;
                const top = rpc
                    .forwardCrosswordDecisionRpc(
                        "resolveCrosswordClue",
                        topRequest,
                        topOrigin,
                    )
                    .then((value) => {
                        topDelivered = true;
                        return value;
                    });
                const frame = rpc.forwardCrosswordDecisionRpc(
                    "resolveCrosswordClue",
                    frameRequest,
                    frameOrigin,
                );
                await waitForCalls(calls, 2);
                const callFor = (id) =>
                    calls.find(({ body }) =>
                        Object.hasOwn(targetCriteria(provider, body), id),
                    );
                const topCall = callFor("c-top");
                const frameCall = callFor("c-frame");
                assert.ok(topCall);
                assert.ok(frameCall);
                inspectNativeRequest(provider, topCall.body, "c-top");
                inspectNativeRequest(provider, frameCall.body, "c-frame");
                assert.deepEqual(
                    socket.sent[1].params.params.origin,
                    topOrigin,
                );
                assert.deepEqual(
                    socket.sent[2].params.params.origin,
                    frameOrigin,
                );
                frameCall.release(
                    nativeResponse(provider, frameCall.body, "c-frame"),
                );
                const frameResult = await frame;
                assert.equal(frameResult.status, "resolved");
                assert.equal(frameResult.candidateId, "c-frame");
                assert.equal("verified" in frameResult, false);
                assert.equal(
                    frameResult.snapshotId,
                    frameRequest.snapshot.snapshotId,
                );
                assert.equal(topDelivered, false);
                topCall.release(
                    nativeResponse(provider, topCall.body, "c-top"),
                );
                const topResult = await top;
                assert.equal(topResult.status, "resolved");
                assert.equal(topResult.candidateId, "c-top");
                assert.equal("verified" in topResult, false);
                assert.equal(
                    topResult.snapshotId,
                    topRequest.snapshot.snapshotId,
                );
                assert.equal("answers" in topResult, false);
                assert.equal("selector" in topResult, false);

                mode = "no_fit";
                const noFit = await rpc.forwardCrosswordDecisionRpc(
                    "resolveCrosswordClue",
                    topRequest,
                    topOrigin,
                );
                assert.equal(noFit.status, "no_fit");
                assert.equal(noFit.candidateId, undefined);

                mode = "error";
                const error = await rpc.forwardCrosswordDecisionRpc(
                    "resolveCrosswordClue",
                    topRequest,
                    topOrigin,
                );
                assert.equal(error.status, "provider_error");
                assert.notEqual(error.status, noFit.status);
                assert.equal(error.candidateId, undefined);
                assert.equal(
                    JSON.stringify(error).includes("offline failure"),
                    false,
                );
                assert.equal(calls.length, 4);

                mode = "hold";
                const cancelled = rpc.forwardCrosswordDecisionRpc(
                    "resolveCrosswordClue",
                    topRequest,
                    topOrigin,
                );
                await waitForCalls(calls, 5);
                rpc.cancelCrosswordDecisionRpc(
                    topOrigin,
                    topRequest.snapshot.snapshotId,
                );
                assert.equal((await cancelled).status, "cancelled");
                calls[4].release(
                    nativeResponse(provider, calls[4].body, "c-top"),
                );
                await Promise.all(socket.completed);
                assert.equal(activeTabLookups, 0);
                assert.equal(broadcasts, 0);
            } finally {
                socket.close();
                globalThis.fetch = originalFetch;
                globalThis.chrome = originalChrome;
                if (originalSocket === undefined) delete globalThis[socketKey];
                else globalThis[socketKey] = originalSocket;
            }
        },
    );
}
