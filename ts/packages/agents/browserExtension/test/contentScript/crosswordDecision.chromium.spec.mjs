// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const tsRoot = resolve(directory, "..", "..", "..", "..", "..");
const require = createRequire(join(tsRoot, "package.json"));
const exampleRequire = createRequire(
    join(tsRoot, "examples", "decision", "package.json"),
);
const { build } = require("esbuild");
const { chromium } = exampleRequire("playwright");
const { startCrosswordFixture } = await import(
    pathToFileURL(
        join(tsRoot, "examples", "decision", "crossword-2", "fixture.mjs"),
    ).href
);
const { puzzleText } = await import(
    pathToFileURL(
        join(tsRoot, "examples", "decision", "crossword-2", "puzzle.mjs"),
    ).href
);

function assertFixtureEvidence(snapshot, audit) {
    const groups = puzzleText.match(
        /exolve-across:\n([\s\S]+?)exolve-down:\n([\s\S]+?)exolve-end/,
    );
    assert.ok(groups, "original fixture must define both clue groups");
    const normalize = (text) =>
        text.replace(/\s+/g, " ").replace(/,\s*/g, ",").trim();
    let expectedCount = 0;
    for (const [direction, source] of [
        ["Across", groups[1]],
        ["Down", groups[2]],
    ]) {
        const opposite = direction === "Across" ? "Down" : "Across";
        for (const line of source.trim().split("\n")) {
            const expected = normalize(line);
            const number = line.match(/^(\d+)\s/)[1];
            const matches = snapshot.candidates.filter(
                (candidate) => normalize(candidate.text) === expected,
            );
            assert.equal(
                matches.length,
                1,
                `fixture ${number} ${direction} has exactly one complete visible row`,
            );
            const candidate = matches[0];
            assert.equal(
                (
                    candidate.context.match(
                        new RegExp(`\\b${direction}\\b`, "g"),
                    ) ?? []
                ).length,
                1,
                `fixture ${number} ${direction} preserves exactly one observed direction heading`,
            );
            assert.doesNotMatch(
                candidate.context,
                new RegExp(`\\b${opposite}\\b`),
                `fixture ${number} ${direction} excludes the opposite group heading`,
            );
            expectedCount++;
        }
    }
    assert.equal(expectedCount, 36);
    assert.equal(snapshot.candidates.length, expectedCount);
    assert.equal(
        new Set(snapshot.candidates.map((candidate) => candidate.id)).size,
        expectedCount,
    );
    assert.equal(audit.uniqueNodes, expectedCount);
    assert.equal(audit.uniqueSelectors, expectedCount);
    assert.equal(audit.connectedUniqueTargets, true);
    assert.equal(audit.visiblePuzzles, 1);
}

async function runChromiumScenario(lane) {
    const fixture = await startCrosswordFixture();
    const profile = join(directory, `.crossword-chromium-${randomUUID()}`);
    let context;
    let live;
    try {
        const executablePath = [
            chromium.executablePath(),
            join(
                process.env["ProgramFiles(x86)"] ?? "",
                "Microsoft",
                "Edge",
                "Application",
                "msedge.exe",
            ),
            join(
                process.env.ProgramFiles ?? "",
                "Google",
                "Chrome",
                "Application",
                "chrome.exe",
            ),
        ].find(existsSync);
        assert.ok(executablePath, "existing Chromium/Edge/Chrome is required");
        context = await chromium.launchPersistentContext(profile, {
            executablePath,
            headless: true,
            viewport: null,
            args: ["--disable-background-networking", "--no-first-run"],
        });
        const page = context.pages()[0] ?? (await context.newPage());
        await page.setViewportSize({ width: 1100, height: 800 });
        await page.goto(fixture.url);
        await page.locator(".xlv-clues-table tr").first().waitFor();
        const output = await build({
            stdin: {
                contents: `
                    import { initializeCrosswordBridge } from "./bridge";
                    import { collect, isVisible } from "./collector";
                    const state = globalThis.__crosswordIsolatedTest = {
                        matches: 0, snapshots: [], messages: [], listeners: [], liveCallbacks: new Map(),
                        collect: () => collect("test-document", 0, 0).snapshot,
                        audit: () => {
                            const current = collect("audit-document", 0, 0);
                            const entries = [...current.registry.values()];
                            return {
                                uniqueNodes: new Set(entries.map(entry => entry.node)).size,
                                uniqueSelectors: new Set(entries.map(entry => entry.selector)).size,
                                connectedUniqueTargets: entries.every(entry => entry.node.isConnected &&
                                    document.querySelectorAll(entry.selector).length === 1 &&
                                    document.querySelector(entry.selector) === entry.node),
                                visiblePuzzles: [...document.querySelectorAll(".xlv-frame")].filter(isVisible).length,
                            };
                        },
                    };
                    globalThis.chrome = { runtime: {
                        sendMessage: async (message) => {
                            state.messages.push(message);
                            if (message.method === "resolveCrosswordClue") {
                                state.matches++;
                                state.snapshots.push(message.params.snapshot);
                            }
                            if (${Boolean(lane)}) return new Promise((resolve,reject) => {
                                const id = crypto.randomUUID();
                                state.liveCallbacks.set(id,{resolve,reject});
                                globalThis.__crosswordLiveRuntime(JSON.stringify({id,message}));
                            });
                            if (message.type === "getCrosswordMode") return {mode:"decision"};
                            if (message.type === "cancelCrosswordDecisionRpc") return {};
                            if (message.method === "getCrosswordDecisionCapabilities")
                                return {available:true,configGeneration:"chromium-fixture"};
                            if (message.method !== "resolveCrosswordClue") throw Error("unexpected runtime method");
                            const {snapshot,clueNumber,clueDirection} = message.params;
                            const matches = snapshot.candidates.filter(candidate =>
                                new RegExp("^" + clueNumber + "(?:\\\\s|\\\\.)").test(candidate.text) &&
                                candidate.context.toLowerCase().includes(clueDirection));
                            const {snapshotId,documentToken,puzzleId,revision,modeGeneration} = snapshot;
                            return {snapshotId,documentToken,puzzleId,revision,modeGeneration,
                                configGeneration:"chromium-fixture",fit:0.99,
                                status: matches.length === 1 ? "resolved" : matches.length ? "ambiguous" : "no_fit",
                                ...(matches.length === 1 ? {candidateId:matches[0].id} : {})};
                        },
                        onMessage: {addListener: listener => state.listeners.push(listener),
                            removeListener: listener => state.listeners = state.listeners.filter(item => item !== listener)},
                    }};
                    state.dispose = initializeCrosswordBridge();
                `,
                resolveDir: resolve(
                    directory,
                    "..",
                    "..",
                    "src",
                    "extension",
                    "contentScript",
                    "crossword",
                ),
                sourcefile: "isolated-crossword-fixture.ts",
                loader: "ts",
            },
            bundle: true,
            write: false,
            format: "iife",
            platform: "browser",
            target: "chrome120",
        });
        const cdp = await context.newCDPSession(page);
        const { frameTree } = await cdp.send("Page.getFrameTree");
        const { executionContextId } = await cdp.send(
            "Page.createIsolatedWorld",
            {
                frameId: frameTree.frame.id,
                worldName: "typeagent-crossword-regression",
            },
        );
        async function isolated(expression) {
            const response = await cdp.send("Runtime.evaluate", {
                contextId: executionContextId,
                expression,
                returnByValue: true,
                awaitPromise: true,
            });
            assert.equal(
                response.exceptionDetails,
                undefined,
                JSON.stringify(response.exceptionDetails),
            );
            return response.result.value;
        }
        if (lane) {
            live = await liveRuntime(lane, fixture.url, frameTree.frame.id);
            await cdp.send("Runtime.addBinding", {
                name: "__crosswordLiveRuntime",
                executionContextId,
            });
            cdp.on("Runtime.bindingCalled", async (event) => {
                if (
                    event.name !== "__crosswordLiveRuntime" ||
                    event.executionContextId !== executionContextId
                )
                    return;
                const { id, message } = JSON.parse(event.payload);
                let result;
                let error;
                try {
                    result = await live.runtime(message);
                } catch {
                    error = "provider_error: joined fixture runtime";
                }
                await cdp
                    .send("Runtime.evaluate", {
                        contextId: executionContextId,
                        expression: `(() => {
                        const callback = __crosswordIsolatedTest.liveCallbacks.get(${JSON.stringify(id)});
                        if (!callback) return;
                        __crosswordIsolatedTest.liveCallbacks.delete(${JSON.stringify(id)});
                        ${
                            error
                                ? `callback.reject(new Error(${JSON.stringify(error)}))`
                                : `callback.resolve(${JSON.stringify(result ?? null)})`
                        };
                    })()`,
                    })
                    .catch(() => {});
            });
        }
        await isolated(output.outputFiles[0].text);
        const snapshot = await isolated("__crosswordIsolatedTest.collect()");
        assert.equal(snapshot.candidates.length, 36);
        assert.equal(snapshot.complete, true);
        assertFixtureEvidence(
            snapshot,
            await isolated("__crosswordIsolatedTest.audit()"),
        );
        assert.ok(
            snapshot.candidates.every(
                (candidate) =>
                    !Object.hasOwn(candidate, "clueNumber") &&
                    !Object.hasOwn(candidate, "direction") &&
                    !Object.hasOwn(candidate, "selector"),
            ),
        );
        assert.equal(
            await page.evaluate(
                () => globalThis.__crosswordIsolatedTest === undefined,
            ),
            true,
            "page cannot access isolated test/controller registry",
        );
        const call = (method, params) =>
            page.evaluate(
                ({ method, params }) =>
                    new Promise((resolve, reject) => {
                        const requestId = crypto.randomUUID();
                        const timeout = setTimeout(() => {
                            window.removeEventListener("message", listener);
                            reject(new Error("fixture_bridge_timeout"));
                        }, 65_000);
                        const listener = (event) => {
                            if (
                                event.source !== window ||
                                event.origin !== location.origin ||
                                event.data?.type !==
                                    "typeagent-crossword-response" ||
                                event.data.requestId !== requestId
                            )
                                return;
                            clearTimeout(timeout);
                            window.removeEventListener("message", listener);
                            if (event.data.error)
                                reject(new Error(event.data.error));
                            else resolve(event.data.result);
                        };
                        window.addEventListener("message", listener);
                        window.postMessage(
                            {
                                type: "typeagent-crossword-request",
                                requestId,
                                method,
                                params,
                            },
                            location.origin,
                        );
                    }),
                { method, params },
            );
        const across = { clueNumber: 1, clueDirection: "across" };
        const down = { clueNumber: 1, clueDirection: "down" };
        assert.deepEqual(await call("getMode"), { mode: "decision" });
        assert.deepEqual(await call("readClue", across), {
            text: "Device producing a concentrated beam of light (5)",
        });
        await call("readClue", across);
        assert.equal(await isolated("__crosswordIsolatedTest.matches"), 1);
        assert.deepEqual(
            await call("enterText", { ...across, value: "laser" }),
            {
                entered: 5,
                verified: true,
            },
        );
        assert.equal(await isolated("__crosswordIsolatedTest.matches"), 1);
        assert.deepEqual(await call("enterText", { ...down, value: "later" }), {
            entered: 5,
            verified: true,
        });
        const beforeConflict = await page
            .locator("svg text.xlv-cell-text")
            .allTextContents();
        const beforeMatches = await isolated("__crosswordIsolatedTest.matches");
        await assert.rejects(
            call("enterText", { ...down, value: "water" }),
            /crossing_conflict/,
        );
        assert.deepEqual(
            await page.locator("svg text.xlv-cell-text").allTextContents(),
            beforeConflict,
        );
        assert.equal(
            await isolated("__crosswordIsolatedTest.matches"),
            beforeMatches,
            "conflicting warm fill must not invoke inference",
        );
        assert.equal(beforeMatches, 2);
        if (live) {
            assert.equal(
                live.nativeCalls(),
                2,
                "exactly two real native decisions; warm read/fills require none",
            );
            assert.ok(
                live
                    .requests()
                    .every(
                        (request) => request.snapshot.candidates.length === 36,
                    ),
            );
        }
        await isolated("__crosswordIsolatedTest.dispose()");
    } catch (error) {
        if (live) {
            throw new Error(
                `${lane.name} joined scenario failed; ${JSON.stringify(live.diagnostics())}; ${error.message.split("\n")[0]}`,
            );
        }
        throw error;
    } finally {
        await context?.close();
        await fixture.close();
        await rm(profile, { recursive: true, force: true });
        await live?.dispose();
    }
}

test("actual isolated controller: pinned Chromium Exolve recall, guarded crossings, warm cache", () =>
    runChromiumScenario());

for (const lane of [
    { name: "copilot", provider: "copilot" },
    { name: "azure-eastus", provider: "azure", region: "eastus" },
    { name: "azure-swedencentral", provider: "azure", region: "swedencentral" },
]) {
    test(
        `LIVE joined isolated Chromium -> SW private forward -> handler -> native ${lane.name}`,
        {
            skip: process.env.TYPEAGENT_CROSSWORD_LIVE !== "1",
            timeout: 180_000,
        },
        () => runChromiumScenario(lane),
    );
}

async function liveRuntime(lane, url, documentId) {
    const browserRequire = createRequire(
        join(tsRoot, "packages", "agents", "browser", "package.json"),
    );
    const { loadRuntimeConfigSync } = await import(
        pathToFileURL(browserRequire.resolve("@typeagent/config")).href
    );
    const {
        createDecisionModel,
        getRuntimeConfigGeneration,
        stopCopilotClient,
    } = await import(
        pathToFileURL(browserRequire.resolve("@typeagent/aiclient")).href
    );
    const { CrosswordDecisionHandler } = await import(
        pathToFileURL(
            join(
                tsRoot,
                "packages",
                "agents",
                "browser",
                "dist",
                "agent",
                "crosswordDecisionHandler.mjs",
            ),
        ).href
    );
    const { loadServiceWorkerTransport, PrivateSocket, socketKey } =
        await import(
            pathToFileURL(
                join(
                    tsRoot,
                    "packages",
                    "agents",
                    "browser",
                    "test",
                    "crosswordDecisionTransport.fixture.mjs",
                ),
            ).href
        );
    const { config: loaded } = loadRuntimeConfigSync({
        workspaceRoot: tsRoot,
        populateProcessEnv: false,
    });
    let config = loaded;
    if (lane.region) {
        const key = loaded.decision?.azure?.deploymentKey ?? "decision_1";
        const deployment = loaded.azureOpenAI.deployments.get(key);
        const endpoints =
            deployment?.endpoints.filter(
                (endpoint) => endpoint.region === lane.region,
            ) ?? [];
        assert.ok(
            endpoints.length,
            `configured deployment for ${lane.name} is required`,
        );
        const deployments = new Map(loaded.azureOpenAI.deployments);
        deployments.set(key, { ...deployment, endpoints });
        config = {
            ...loaded,
            azureOpenAI: { ...loaded.azureOpenAI, deployments },
        };
    }
    let nativeCalls = 0;
    const requests = [];
    const diagnostics = [];
    const handler = new CrosswordDecisionHandler({
        createModel: () => {
            const model = createDecisionModel({
                config,
                provider: lane.provider,
            });
            assert.equal(
                model.success,
                true,
                `native ${lane.name} model must be configured`,
            );
            if (!model.success) return model;
            return {
                ...model,
                data: {
                    ...model.data,
                    async decide(request, options) {
                        nativeCalls++;
                        assert.deepEqual(Object.keys(request.questions), [
                            "target",
                            "unique_fit",
                        ]);
                        assert.equal(request.questions.target.type, "choice");
                        assert.equal(request.questions.unique_fit.type, "noul");
                        const result = await model.data.decide(
                            request,
                            options,
                        );
                        diagnostics.push(
                            result.success
                                ? {
                                      success: true,
                                      fit: result.data.answers.unique_fit?.noul,
                                      choiceAbstained: [
                                          "no_fit",
                                          "ambiguous",
                                      ].includes(
                                          result.data.answers.target?.choice,
                                      ),
                                      chosenIssuedCandidate:
                                          Object.hasOwn(
                                              request.questions.target.criteria,
                                              result.data.answers.target
                                                  ?.choice,
                                          ) &&
                                          !["no_fit", "ambiguous"].includes(
                                              result.data.answers.target
                                                  ?.choice,
                                          ),
                                  }
                                : { success: false, code: result.code },
                        );
                        return result;
                    },
                },
            };
        },
        generation: getRuntimeConfigGeneration,
        now: Date.now,
        timeoutMs: 60_000,
        telemetry: () => {},
    });
    const originalChrome = globalThis.chrome;
    const originalSocket = globalThis[socketKey];
    const socket = new PrivateSocket(handler, "chromium-live-fixture");
    globalThis[socketKey] = socket;
    globalThis.chrome = {
        runtime: { id: "chromium-joined-fixture" },
        permissions: {
            contains: async ({ origins }) =>
                origins.every(
                    (origin) => origin === `${new URL(url).origin}/*`,
                ),
        },
    };
    const transport = await loadServiceWorkerTransport();
    const origin = await transport.getCrosswordRpcOrigin({
        id: "chromium-joined-fixture",
        tab: { id: 1 },
        frameId: 0,
        documentId,
        documentLifecycle: "active",
        url,
    });
    assert.ok(
        origin,
        "simulated extension sender is validated by real SW helper",
    );
    return {
        nativeCalls: () => nativeCalls,
        requests: () => requests,
        diagnostics: () => diagnostics,
        async runtime(message) {
            if (message.type === "getCrosswordMode")
                return { mode: "decision" };
            if (message.type === "cancelCrosswordDecisionRpc") {
                transport.cancelCrosswordDecisionRpc(
                    origin,
                    message.snapshotId,
                );
                return {};
            }
            assert.equal(message.type, "crosswordDecisionRpc");
            if (message.method === "resolveCrosswordClue")
                requests.push(message.params);
            return transport.forwardCrosswordDecisionRpc(
                message.method,
                message.params,
                origin,
            );
        },
        async dispose() {
            socket.close();
            await Promise.all(socket.completed);
            globalThis.chrome = originalChrome;
            globalThis[socketKey] = originalSocket;
            if (lane.provider === "copilot") await stopCopilotClient?.();
        },
    };
}
