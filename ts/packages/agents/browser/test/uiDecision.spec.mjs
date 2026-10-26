// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { buildConfig } from "@typeagent/config";
import {
    createDecisionModel,
    getRuntimeConfigGeneration,
} from "@typeagent/aiclient";
import {
    UiDecisionService,
    buildUiSelectionRequest,
} from "../dist/agent/webFlows/uiDecisionService.mjs";
import {
    validateWebFlowScript,
    transpileScript,
} from "../dist/agent/webFlows/scriptValidator.mjs";
import { executeWebFlowScript } from "../dist/agent/webFlows/scriptExecutor.mjs";
import { createFrozenBrowserApi } from "../dist/agent/webFlows/webFlowBrowserApi.mjs";
import { assertUiObservation } from "@typeagent/browser-control-rpc/uiDecisionTypes";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { SchemaDiscoveryAgent } from "../dist/agent/discovery/translator.mjs";

async function loadUiExtensionModule(path) {
    const source = await readFile(
        new URL(
            `../../browserExtension/src/extension/${path}.ts`,
            import.meta.url,
        ),
        "utf8",
    );
    const compiled = ts.transpileModule(
        source.replace(
            '"@typeagent/browser-control-rpc/uiDecisionTypes"',
            JSON.stringify(
                import.meta.resolve(
                    "@typeagent/browser-control-rpc/uiDecisionTypes",
                ),
            ),
        ),
        {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
            },
        },
    ).outputText;
    return import(
        `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
    );
}

async function domBrowser(t) {
    const dom = new JSDOM(
        `
        <input type="search" aria-label="Search products">
        <article><h2>Coffee 12-pack</h2><a id="pack" href="/pack">Details</a></article>
        <article><h2>Coffee single can</h2><a href="/single">Details</a></article>`,
        { url: "https://shop.example/" },
    );
    if (dom.window.document.readyState !== "complete")
        await new Promise((resolve) =>
            dom.window.addEventListener("load", resolve, { once: true }),
        );
    const globals = [
        "document",
        "location",
        "Node",
        "Element",
        "HTMLElement",
        "HTMLInputElement",
        "HTMLTextAreaElement",
        "HTMLSelectElement",
        "HTMLAnchorElement",
        "HTMLButtonElement",
        "Event",
        "getComputedStyle",
        "chrome",
    ];
    const descriptors = new Map(
        globals.map((name) => [
            name,
            Object.getOwnPropertyDescriptor(globalThis, name),
        ]),
    );
    t.after(() => {
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
        dom.window.close();
    });

    for (const name of globals.filter((name) => name !== "chrome"))
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value: dom.window[name],
        });
    dom.window.Element.prototype.getClientRects = () => ({ length: 1 });
    let listener;
    Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: {
            runtime: {
                id: "offline-ui",
                onMessage: {
                    addListener: (callback) => {
                        listener = callback;
                    },
                },
            },
            tabs: {
                onRemoved: { addListener() {} },
                onUpdated: { addListener() {} },
                sendMessage: async (tabId, message, options) => {
                    assert.equal(tabId, 1);
                    assert.deepEqual(options, {
                        documentId: "document-1",
                        frameId: 0,
                    });
                    let response;
                    listener(
                        structuredClone(message),
                        { id: "offline-ui" },
                        (value) => {
                            response = structuredClone(value);
                        },
                    );
                    return response;
                },
            },
            webNavigation: {
                getAllFrames: async () => [
                    {
                        frameId: 0,
                        documentId: "document-1",
                        url: dom.window.location.href,
                    },
                ],
            },
            permissions: { contains: async () => true },
        },
    });
    const [{ initializeUiDecisionHost }, { createUiDecisionBrowser }] =
        await Promise.all([
            loadUiExtensionModule("contentScript/uiDecisionHost"),
            loadUiExtensionModule("serviceWorker/uiDecisionBrowser"),
        ]);
    initializeUiDecisionHost();
    let clicks = 0;
    dom.window.document
        .querySelector("#pack")
        .addEventListener("click", (event) => {
            event.preventDefault();
            clicks++;
        });
    return {
        browser: createUiDecisionBrowser(async () => ({
            id: 1,
            url: dom.window.location.href,
            status: "complete",
        })),
        clicks: () => clicks,
        document: dom.window.document,
    };
}

function observation() {
    return {
        snapshotId: "snapshot",
        url: "https://shop.example/",
        createdAt: Date.now(),
        complete: true,
        content: "Coffee 12-pack. Coffee single can.",
        candidates: [
            {
                id: "c0",
                name: "Search products",
                role: "textbox",
                context: "Search",
                disabled: false,
                capabilities: ["fill"],
            },
            {
                id: "c1",
                name: "Details",
                role: "link",
                context: "Coffee 12-pack",
                disabled: false,
                capabilities: ["activate"],
            },
            {
                id: "c2",
                name: "Details",
                role: "link",
                context: "Coffee single can",
                disabled: false,
                capabilities: ["activate"],
            },
            {
                id: "c3",
                name: "Details",
                role: "link",
                context: "Coffee unavailable",
                disabled: true,
                capabilities: ["activate"],
            },
        ],
    };
}

function harness(answer = "c1") {
    const calls = [];
    let generation = 1;
    const browser = {
        captureUiObservation: async () => observation(),
        validateUiObservation: async (id) => {
            calls.push(["validate", id]);
        },
        executeUiAction: async (...args) => {
            calls.push(["execute", ...args]);
            return { dispatched: true, valueVerified: true };
        },
    };
    const model = {
        provider: "azure",
        model: "decision-1",
        configGeneration: generation,
        decide: async (request) => {
            calls.push(["decide", request]);
            const question = Object.keys(request.questions)[0];
            return {
                success: true,
                data: {
                    provider: "azure",
                    requestedModel: "decision-1",
                    answers: {
                        [question]: {
                            type: "choice",
                            choice: answer,
                            probabilities: {},
                        },
                    },
                },
            };
        },
    };
    const dependencies = {
        createModel: () => ({ success: true, data: model }),
        generation: () => generation,
        now: Date.now,
    };
    return {
        service: new UiDecisionService(browser, dependencies),
        browser,
        model,
        calls,
        changeGeneration: () => {
            generation++;
        },
    };
}

test("selection sends eligible issued IDs with variant context, then executes a one-use opaque handle", async () => {
    const h = harness();
    const target = await h.service.selectElement({
        condition: "Details for the 12-pack",
        capability: "activate",
    });
    assert.notEqual(target.targetId, "c1");
    const criteria = h.calls.find(([kind]) => kind === "decide")[1].questions
        .target.criteria;
    assert.deepEqual(Object.keys(criteria), [
        "c1",
        "c2",
        "no_fit",
        "ambiguous",
    ]);
    assert.match(criteria.c1, /12-pack/);
    await h.service.execute(target.targetId, { type: "activate" });
    assert.deepEqual(
        h.calls.find(([kind]) => kind === "execute"),
        ["execute", "snapshot", "c1", { type: "activate" }],
    );
    await assert.rejects(
        h.service.execute(target.targetId, { type: "activate" }),
        /consumed/,
    );
});

test("selection validates capability and bounded conditions before inference", () => {
    for (const request of [
        { condition: "", capability: "activate" },
        { condition: "x".repeat(2049), capability: "fill" },
        { condition: "Search", capability: "invented" },
    ])
        assert.throws(
            () => buildUiSelectionRequest(observation(), request),
            /invalid_request/,
        );
});

test(
    "bounded selection launches every batch concurrently and handles out-of-order results before dispatch",
    { timeout: 5000 },
    async (t) => {
        const h = harness();
        const observed = observation();
        observed.candidates = Array.from({ length: 200 }, (_, index) => ({
            ...observed.candidates[1],
            id: `c${index}`,
        }));
        h.browser.captureUiObservation = async () => observed;
        const requests = [];
        const responses = [];
        const allStarted = Promise.withResolvers();
        t.after(() => {
            for (const response of responses)
                response.resolve({
                    success: true,
                    data: {
                        answers: {
                            target: { type: "choice", choice: "no_fit" },
                        },
                    },
                });
        });
        h.model.decide = async (request) => {
            requests.push(request);
            const response = Promise.withResolvers();
            responses.push(response);
            if (requests.length === 7) allStarted.resolve();
            return response.promise;
        };
        const selecting = h.service.selectElement({
            condition: "Details",
            capability: "activate",
        });
        await allStarted.promise;
        assert.equal(requests.length, 7);
        assert.equal(h.calls.filter(([kind]) => kind === "execute").length, 0);
        for (let index = responses.length - 1; index >= 0; index--) {
            responses[index].resolve({
                success: true,
                data: {
                    answers: {
                        target: {
                            type: "choice",
                            choice: Object.hasOwn(
                                requests[index].questions.target.criteria,
                                "c199",
                            )
                                ? "c199"
                                : "no_fit",
                        },
                    },
                },
            });
        }
        const target = await selecting;
        assert.deepEqual(
            requests.flatMap((request) =>
                request.state.controls.map((candidate) => candidate.id),
            ),
            observed.candidates.map((candidate) => candidate.id),
        );
        assert.equal(requests.length, 7);
        for (const request of requests) {
            assert.ok(request.state.controls.length <= 32);
            assert.equal(request.state.selectionBatch.eligibleTotal, 200);
            assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 24 * 1024);
        }
        await h.service.execute(target.targetId, { type: "activate" });
        assert.equal(h.calls.find(([kind]) => kind === "execute")[2], "c199");
    },
);

for (const firstOutcome of ["ambiguous", "failure"]) {
    test(
        `concurrent selection drains outstanding batches before reporting ${firstOutcome}`,
        { timeout: 5000 },
        async (t) => {
            const h = harness(
                firstOutcome === "ambiguous" ? "ambiguous" : "no_fit",
            );
            const observed = observation();
            observed.candidates = Array.from({ length: 65 }, (_, index) => ({
                ...observed.candidates[1],
                id: `c${index}`,
            }));
            h.browser.captureUiObservation = async () => observed;
            const release = Promise.withResolvers();
            const allStarted = Promise.withResolvers();
            t.after(() => release.resolve());
            const original = h.model.decide;
            let calls = 0;
            h.model.decide = async (...args) => {
                const index = calls++;
                if (calls === 3) allStarted.resolve();
                if (index === 0 && firstOutcome === "failure")
                    throw new Error("network: batch failed");
                if (index > 0) await release.promise;
                return original(...args);
            };
            let finished = false;
            const selecting = h.service
                .selectElement({ condition: "Details", capability: "activate" })
                .finally(() => {
                    finished = true;
                });
            const rejected = assert.rejects(
                selecting,
                firstOutcome === "failure"
                    ? /network: batch failed/
                    : /ambiguous/,
            );
            await allStarted.promise;
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(finished, false);
            assert.equal(
                h.calls.filter(([kind]) => kind === "execute").length,
                0,
            );
            release.resolve();
            await rejected;
            assert.equal(calls, 3);
            assert.equal(
                h.calls.filter(([kind]) => kind === "execute").length,
                0,
            );
        },
    );
}

test("multiple batch winners require a global decision and ambiguity never dispatches", async () => {
    const h = harness();
    const observed = observation();
    observed.candidates = Array.from({ length: 33 }, (_, index) => ({
        ...observed.candidates[1],
        id: `c${index}`,
    }));
    h.browser.captureUiObservation = async () => observed;
    let calls = 0;
    h.model.decide = async (request) => {
        calls++;
        return {
            success: true,
            data: {
                answers: {
                    target: {
                        type: "choice",
                        choice:
                            calls === 3
                                ? "ambiguous"
                                : request.state.controls[0].id,
                    },
                },
            },
        };
    };
    await assert.rejects(
        h.service.selectElement({
            condition: "Details",
            capability: "activate",
        }),
        /ambiguous/,
    );
    assert.equal(calls, 3);
    assert.equal(h.calls.filter(([kind]) => kind === "execute").length, 0);
});

test("selection byte packing covers every eligible control without truncating page evidence", async () => {
    const h = harness("no_fit");
    const observed = observation();
    observed.content = "Page ".repeat(1000);
    observed.candidates = Array.from({ length: 33 }, (_, index) => ({
        ...observed.candidates[1],
        id: `c${index}`,
        name: "n".repeat(512),
        context: "c".repeat(512),
    }));
    h.browser.captureUiObservation = async () => observed;
    await assert.rejects(
        h.service.selectElement({
            condition: "Details",
            capability: "activate",
        }),
        /no_fit/,
    );
    const requests = h.calls
        .filter(([kind]) => kind === "decide")
        .map(([, request]) => request);
    assert.ok(requests.length > 2);
    assert.deepEqual(
        requests.flatMap((request) =>
            request.state.controls.map((candidate) => candidate.id),
        ),
        observed.candidates.map((candidate) => candidate.id),
    );
    for (const request of requests) {
        assert.equal(request.state.content, observed.content);
        assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 24 * 1024);
    }
});

for (const [contentSize, expectedError] of [
    [18000, /batch count bound/],
    [30000, /byte bound/],
]) {
    test(`selection rejects ${contentSize}-character evidence outside packing bounds before inference`, async () => {
        const h = harness("no_fit");
        const observed = observation();
        observed.content = "p".repeat(contentSize);
        observed.candidates = Array.from({ length: 33 }, (_, index) => ({
            ...observed.candidates[1],
            id: `c${index}`,
            name: "n".repeat(512),
            context: "c".repeat(512),
        }));
        h.browser.captureUiObservation = async () => observed;
        await assert.rejects(
            h.service.selectElement({
                condition: "Details",
                capability: "activate",
            }),
            expectedError,
        );
        assert.equal(h.calls.filter(([kind]) => kind === "decide").length, 0);
        assert.equal(h.calls.filter(([kind]) => kind === "execute").length, 0);
    });
}

test("selection state includes control metadata even when visible text cannot establish input presence", () => {
    const observed = observation();
    observed.content = "Search products";
    const request = buildUiSelectionRequest(observed, {
        condition: "The product search input",
        capability: "fill",
    });
    assert.deepEqual(request.state.controls, [observed.candidates[0]]);
    assert.equal(request.state.controls[0].role, "textbox");
    assert.deepEqual(request.state.controls[0].capabilities, ["fill"]);
    assert.deepEqual(Object.keys(request.questions.target.criteria), [
        "c0",
        "no_fit",
        "ambiguous",
    ]);
});

test("selection repacking retains every control and choice while removing duplicated metadata", () => {
    const observed = observation();
    observed.candidates = Array.from({ length: 200 }, (_, index) => ({
        ...observed.candidates[1],
        id: `c${index}`,
        context: `Product ${index}: Coffee 12-pack`,
    }));
    const request = buildUiSelectionRequest(observed, {
        condition: "Details for Coffee 12-pack",
        capability: "activate",
    });
    const legacy = structuredClone(request);
    for (const candidate of observed.candidates)
        legacy.questions.target.criteria[candidate.id] =
            JSON.stringify(candidate);
    assert.deepEqual(
        request.state.controls,
        observed.candidates.filter(
            (candidate) =>
                !candidate.disabled &&
                candidate.capabilities.includes("activate"),
        ),
    );
    assert.deepEqual(
        Object.keys(request.questions.target.criteria),
        Object.keys(legacy.questions.target.criteria),
    );
    assert.ok(
        Buffer.byteLength(JSON.stringify(request)) <
            Buffer.byteLength(JSON.stringify(legacy)) * 0.85,
    );
    for (const candidate of observed.candidates) {
        const criterion = request.questions.target.criteria[candidate.id];
        assert.ok(criterion.includes(candidate.context));
        assert.ok(
            !criterion.includes('"capabilities"') &&
                !criterion.includes('"disabled"'),
        );
    }
});

test("explicit frame scope reaches capture, native evidence and condition explanation", async () => {
    for (const operation of ["selection", "condition"]) {
        const h = harness(operation === "selection" ? "c1" : "matched");
        const captures = [];
        h.browser.captureUiObservation = async (frameScope) => {
            captures.push(frameScope);
            return { ...observation(), frameScope };
        };
        if (operation === "selection")
            await h.service.selectElement({
                condition: "Main document Details",
                capability: "activate",
                frameScope: "main-document",
            });
        else {
            const result = await h.service.evaluatePageCondition(
                "Main document is ready",
                "main-document",
            );
            assert.match(result.explanation, /frame scope: main-document/);
        }
        assert.deepEqual(captures, ["main-document"]);
        const request = h.calls.find(([kind]) => kind === "decide")[1];
        assert.equal(request.state.frameScope, "main-document");
        assert.match(
            Object.values(request.questions)[0].instructions,
            /excludes all iframe content/,
        );
    }
});

test("mismatched capture scope and invalid scope fail before native inference", async () => {
    const h = harness();
    await assert.rejects(
        h.service.selectElement({
            condition: "Details",
            capability: "activate",
            frameScope: "main-document",
        }),
        /different.*scope/,
    );
    await assert.rejects(
        h.service.evaluatePageCondition("Ready", "website"),
        /frame scope/,
    );
    assert.equal(h.calls.filter(([kind]) => kind === "decide").length, 0);
    assert.throws(
        () =>
            assertUiObservation({
                ...observation(),
                frameScope: "website",
            }),
        /frame scope/,
    );
});

test("observation boundary rejects duplicate IDs, invalid control state and invalid options", () => {
    for (const change of [
        (value) => value.candidates.push(value.candidates[0]),
        (value) => {
            value.candidates[0].checked = "mixed";
        },
        (value) => {
            value.candidates[0].capabilities = ["fill", "fill"];
        },
        (value) => {
            value.candidates[0].id = "no_fit";
        },
        (value) => {
            value.candidates[0].options = [
                { id: "o0", text: "Pickup", disabled: "false" },
            ];
        },
    ]) {
        const value = observation();
        change(value);
        assert.throws(() => assertUiObservation(value), /invalid UI/);
    }
});

test("decision deadline aborts inference and ignores a late answer even when the model ignores abort", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const h = harness();
    const started = Promise.withResolvers();
    const response = Promise.withResolvers();
    let signal;
    h.model.decide = (_request, options) => {
        signal = options.signal;
        started.resolve();
        return response.promise;
    };
    const result = assert.rejects(
        h.service.selectElement({
            condition: "Details",
            capability: "activate",
        }),
        /timeout/,
    );
    await started.promise;
    t.mock.timers.tick(20000);
    await result;
    assert.equal(signal.aborted, true);
    response.resolve({
        success: true,
        data: {
            answers: {
                target: { type: "choice", choice: "c1", probabilities: {} },
            },
        },
    });
    await Promise.resolve();
    assert.equal(
        h.calls.filter(([kind]) => kind === "validate" || kind === "execute")
            .length,
        0,
    );
});

for (const choice of ["no_fit", "ambiguous", "unissued", "c3"]) {
    test(`selection ${choice} never dispatches an action`, async () => {
        const h = harness(choice);
        await assert.rejects(
            h.service.selectElement({
                condition: "Details",
                capability: "activate",
            }),
            /no_fit|ambiguous|invalid_response/,
        );
        assert.equal(h.calls.filter(([kind]) => kind === "execute").length, 0);
    });
}

for (const status of ["matched", "not_matched", "insufficient_evidence"]) {
    test(`condition preserves ${status} and uses a host-generated explanation`, async () => {
        const h = harness(status);
        h.browser.validateUiObservation = async () => {
            throw new Error("stale: dynamic content changed");
        };
        const result = await h.service.evaluatePageCondition(
            "Coffee is displayed",
        );
        assert.equal(result.status, status);
        assert.match(result.explanation, /host-generated/);
        assert.equal(h.calls.filter(([kind]) => kind === "execute").length, 0);
    });
}

test("read-only conditions do not apply action-target snapshot expiry", async () => {
    const h = harness("matched");
    h.browser.captureUiObservation = async () => ({
        ...observation(),
        createdAt: Date.now() - 30001,
    });
    assert.equal(
        (await h.service.evaluatePageCondition("Ready")).status,
        "matched",
    );
    assert.equal(h.calls.filter(([kind]) => kind === "validate").length, 0);
});

test("provider failure, unsupported hosts and stale configuration do not become false or trigger chat", async () => {
    const h = harness();
    h.model.decide = async () => ({
        success: false,
        code: "authorization",
        message: "offline",
    });
    await assert.rejects(
        h.service.evaluatePageCondition("Ready"),
        /authorization/,
    );
    const unsupported = new UiDecisionService(
        {},
        {
            createModel: () => ({ success: true, data: h.model }),
            generation: () => 1,
            now: Date.now,
        },
    );
    await assert.rejects(
        unsupported.selectElement({ condition: "Search", capability: "fill" }),
        /unsupported/,
    );
    h.model.decide = async () => {
        h.changeGeneration();
        return { success: false, code: "network" };
    };
    await assert.rejects(h.service.evaluatePageCondition("Ready"), /stale/);
});

test("late and changed evidence cannot authorize execution, including after a successful selection", async () => {
    const h = harness();
    const target = await h.service.selectElement({
        condition: "Details",
        capability: "activate",
    });
    h.changeGeneration();
    await assert.rejects(
        h.service.execute(target.targetId, { type: "activate" }),
        /stale/,
    );
    assert.equal(h.calls.filter(([kind]) => kind === "execute").length, 0);
    const stale = harness();
    stale.browser.validateUiObservation = async () => {
        throw new Error("stale: changed document");
    };
    await assert.rejects(
        stale.service.selectElement({
            condition: "Details",
            capability: "activate",
        }),
        /stale/,
    );
});

test("expired snapshots and token-heavy evidence are rejected, never truncated", async () => {
    const expired = harness();
    expired.browser.captureUiObservation = async () => ({
        ...observation(),
        createdAt: Date.now() - 30001,
    });
    await assert.rejects(
        expired.service.selectElement({
            condition: "Details",
            capability: "activate",
        }),
        /stale/,
    );
    assert.equal(expired.calls.filter(([kind]) => kind === "decide").length, 0);
    const large = harness();
    large.browser.captureUiObservation = async () => ({
        ...observation(),
        candidates: Array.from({ length: 253 }, (_, id) => ({
            ...observation().candidates[1],
            id: `c${id}`,
            context: "word ".repeat(100),
            name: "words ".repeat(80),
        })),
    });
    await assert.rejects(
        large.service.selectElement({
            condition: "Details",
            capability: "activate",
        }),
        /token bound|byte bound/,
    );
    assert.equal(large.calls.filter(([kind]) => kind === "decide").length, 0);
});

for (const provider of ["azure", "copilot"]) {
    test(`real ${provider} native wire adapter drives private frame transport and bound DOM execution without chat`, async (t) => {
        const originalFetch = globalThis.fetch;
        const config = buildConfig({
            AZURE_OPENAI_ENDPOINT_DECISION_1_EASTUS:
                "https://eastus.example/providers/microsoft/v1/systemone",
            AZURE_OPENAI_API_KEY_DECISION_1_EASTUS: "offline",
            AZURE_OPENAI_MAX_RETRYATTEMPTS: "0",
            COPILOT_MAX_RETRYATTEMPTS: "0",
        });
        const dom = await domBrowser(t);
        const browser = dom.browser;
        const service = new UiDecisionService(browser, {
            createModel: () =>
                createDecisionModel({
                    config,
                    provider,
                    endpointProvider: {
                        getEndpoint: async () => ({
                            baseUrl: "https://copilot.example",
                            model: "gpt-6-luna-decisions",
                            headers: { Authorization: "offline" },
                        }),
                    },
                }),
            generation: getRuntimeConfigGeneration,
            now: Date.now,
        });
        let calls = 0;
        globalThis.fetch = async (url, options) => {
            calls++;
            assert.equal(
                String(url),
                provider === "azure"
                    ? "https://eastus.example/providers/microsoft/v1/systemone"
                    : "https://copilot.example/v1/decisions",
            );
            const body = JSON.parse(options.body);
            const name =
                provider === "azure"
                    ? Object.keys(body.questions)[0]
                    : body.questions[0].name;
            const choices =
                provider === "azure"
                    ? Object.keys(body.questions[name].criteria)
                    : body.questions[0].choices.map((entry) => entry.value);
            const choice =
                name === "target" ? "f0_c1" : "insufficient_evidence";
            if (name === "condition") {
                dom.document.querySelector("h2").textContent =
                    "Dynamically updated offer";
                const button = dom.document.createElement("button");
                button.textContent = "New dynamically loaded control";
                dom.document.body.append(button);
            }
            const answers =
                provider === "azure"
                    ? {
                          [name]: {
                              type: "choice",
                              choice,
                              probabilities: Object.fromEntries(
                                  choices.map((id) => [
                                      id,
                                      id === choice ? 1 : 0,
                                  ]),
                              ),
                          },
                      }
                    : [
                          {
                              name,
                              type: "choice",
                              choice,
                              probabilities: choices.map((value) => ({
                                  value,
                                  probability: value === choice ? 1 : 0,
                              })),
                          },
                      ];
            return new Response(JSON.stringify({ answers }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        };
        try {
            const target = await service.selectElement({
                condition: "12-pack details",
                capability: "activate",
            });
            await service.execute(target.targetId, { type: "activate" });
            assert.equal(dom.clicks(), 1);
            assert.equal(
                (await service.evaluatePageCondition("Cart changed")).status,
                "insufficient_evidence",
            );
            const stale = await service.selectElement({
                condition: "12-pack details",
                capability: "activate",
            });
            dom.document.querySelector("h2").textContent =
                "A different product";
            await assert.rejects(
                service.execute(stale.targetId, { type: "activate" }),
                /stale/,
            );
            assert.equal(dom.clicks(), 1);
            assert.equal(calls, 3);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
}

for (const name of [
    "decisionSearchForProduct",
    "decisionNavigateToProductPage",
]) {
    test(`${name} validates and requires a verified postcondition before reporting success`, async () => {
        const flow = JSON.parse(
            await readFile(
                new URL(
                    `../src/agent/webFlows/samples/${name}.json`,
                    import.meta.url,
                ),
                "utf8",
            ),
        );
        const validation = validateWebFlowScript(
            flow.script,
            Object.keys(flow.parameters),
            flow,
        );
        assert.equal(validation.valid, true, JSON.stringify(validation.errors));
        const script = transpileScript(flow.script);
        let actions = 0;
        const waits = [];
        let status = "insufficient_evidence";
        const browserApi = {
            selectElement: async (request) => {
                assert.equal(request.frameScope, "main-document");
                return { targetId: "issued", name: "Coffee", role: "link" };
            },
            executeUiAction: async () => {
                actions++;
                return { dispatched: true, valueVerified: true };
            },
            awaitPageLoad: async (timeout) => {
                waits.push(timeout);
            },
            evaluatePageCondition: async (_condition, scope) => {
                assert.equal(scope, "main-document");
                return { status, explanation: "Observed" };
            },
        };
        const failed = await executeWebFlowScript(script, browserApi, {
            productName: "Coffee 12-pack",
        });
        assert.equal(failed.success, false);
        assert.match(failed.error, /not verified.*insufficient_evidence/);
        assert.equal(actions, 1);
        status = "matched";
        const passed = await executeWebFlowScript(script, browserApi, {
            productName: "Coffee 12-pack",
            navigationTimeoutMs: 15000,
        });
        assert.equal(passed.success, true);
        assert.match(passed.message, /Verified/);
        assert.deepEqual(waits, [undefined, 15000]);
    });
}

test("legacy extraction still honors its callback and new primitives fail explicitly on unsupported hosts", async () => {
    let calls = 0;
    const api = createFrozenBrowserApi({}, undefined, async (component) => {
        calls++;
        assert.equal(component.schema, "{ custom: string }");
        return { custom: "value" };
    });
    assert.deepEqual(
        await api.extractComponent({
            typeName: "Custom",
            schema: "{ custom: string }",
        }),
        { custom: "value" },
    );
    assert.equal(calls, 1);
    await assert.rejects(
        api.selectElement({ condition: "Search", capability: "fill" }),
        /unsupported/,
    );
    await assert.rejects(api.evaluatePageCondition("Ready"), /unsupported/);
});

test("discovery extraction uses the supplied inline schema and preserves the default catalog when omitted", async () => {
    const schemas = [];
    const agent = {
        getBootstrapTranslator(typeName, schema) {
            schemas.push(schema);
            return {
                translate: async () =>
                    schemas.length < 3
                        ? createTypeScriptJsonValidator(
                              schema,
                              typeName,
                          ).validate({ custom: "value" })
                        : { success: true, data: {} },
            };
        },
        getCssSelectorForElementPrompt: () => [],
    };
    for (const schema of [
        "{ custom: string }",
        "export type Custom = { custom: string };",
        undefined,
    ]) {
        const result =
            await SchemaDiscoveryAgent.prototype.getPageComponentSchema.call(
                agent,
                "Custom",
                "Find a custom component",
                [],
                [],
                schema,
            );
        assert.equal(result.success, true);
    }
    assert.equal(schemas[0], "export type Custom = { custom: string };");
    assert.equal(schemas[1], "export type Custom = { custom: string };");
    assert.match(schemas[2], /export (type|interface) /);
    assert.notEqual(schemas[2], schemas[0]);
});
