// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConfig } from "@typeagent/config";
import {
    createDecisionModel,
    getRuntimeConfigGeneration,
} from "@typeagent/aiclient";
import { CrosswordDecisionHandler } from "../dist/agent/crosswordDecisionHandler.mjs";
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
            collectorVersion: 1,
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
    assert.equal(state.candidates[0].id, candidateId);
    const expectedIds = [candidateId, "no_fit", "ambiguous"];
    if (provider === "azure") {
        assert.deepEqual(Object.keys(body.questions), ["target", "unique_fit"]);
        assert.equal(body.questions.target.type, "choice");
        assert.deepEqual(
            Object.keys(body.questions.target.criteria),
            expectedIds,
        );
        assert.equal(body.questions.unique_fit.type, "noul");
        assert.match(body.questions.unique_fit.instructions, /Independently/);
    } else {
        assert.deepEqual(
            body.questions.map((question) => question.name),
            ["target", "unique_fit"],
        );
        assert.equal(body.questions[0].type, "choice");
        assert.deepEqual(
            body.questions[0].choices.map((choice) => choice.value),
            expectedIds,
        );
        assert.equal(body.questions[1].type, "predicate");
        assert.match(body.questions[1].instructions, /Independently/);
    }
    assert.equal("messages" in body, false);
    assert.equal(JSON.stringify(body).includes("page-spoof"), false);
}

function nativeResponse(provider, body, selected) {
    const choices =
        provider === "azure"
            ? Object.keys(body.questions.target.criteria)
            : body.questions[0].choices.map((choice) => choice.value);
    const probabilities = Object.fromEntries(
        choices.map((id) => [id, id === selected ? 1 : 0]),
    );
    const fit = selected === "no_fit" ? 0 : 0.95;
    const answers =
        provider === "azure"
            ? {
                  target: {
                      type: "choice",
                      choice: selected,
                      probabilities,
                  },
                  unique_fit: { type: "noul", noul: fit },
              }
            : [
                  {
                      name: "target",
                      type: "choice",
                      choice: selected,
                      probabilities: Object.entries(probabilities).map(
                          ([value, probability]) => ({ value, probability }),
                      ),
                  },
                  {
                      name: "unique_fit",
                      type: "predicate",
                      probability: fit,
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
                    calls.find(({ body }) => {
                        const state =
                            provider === "azure"
                                ? body.state
                                : JSON.parse(body.input);
                        return state.candidates[0].id === id;
                    });
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
