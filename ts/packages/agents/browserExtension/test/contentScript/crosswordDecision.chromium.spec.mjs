// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
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

async function recordLiveEvidence(lane, event) {
    const output = process.env.TYPEAGENT_CROSSWORD_EVIDENCE_DIR;
    if (!output) return;
    await mkdir(output, { recursive: true });
    await appendFile(
        join(output, `${lane.name}.jsonl`),
        JSON.stringify({ timestamp: new Date().toISOString(), ...event }) +
            "\n",
    );
}

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
    assert.ok(snapshot.candidates.length >= expectedCount);
    assert.equal(
        new Set(snapshot.candidates.map((candidate) => candidate.id)).size,
        snapshot.candidates.length,
    );
    assert.equal(audit.uniqueNodes, snapshot.candidates.length);
    assert.equal(audit.uniqueSelectors, snapshot.candidates.length);
    assert.equal(audit.connectedUniqueTargets, true);
    assert.equal(audit.visiblePuzzles, 1);
}

async function startEmbeddedParent(childUrl) {
    const server = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><main>${"<p>Unrelated article and navigation</p>".repeat(80)}</main>
            <iframe src="${childUrl}" width="1100" height="1000"></iframe>`);
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    return {
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

async function runChromiumScenario(
    lane,
    embedded = false,
    strategy = lane?.strategy ?? "hybrid",
) {
    const large = strategy === "hybrid2" || lane?.large === true;
    const fixture = await startCrosswordFixture();
    const parentFixture = embedded
        ? await startEmbeddedParent(fixture.url)
        : undefined;
    const profile = join(directory, `.crossword-chromium-${randomUUID()}`);
    let context;
    let live;
    let auditChanges;
    let auditFrames;
    const browserErrors = [];
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
        auditFrames = () =>
            Promise.all(
                page.frames().map(async (frame) => ({
                    url: frame.url(),
                    evidence: await frame.evaluate(() => ({
                        state: document.readyState,
                        text: document.body?.innerText.slice(0, 300),
                        rows: document.querySelectorAll(".xlv-clues-table tr")
                            .length,
                    })),
                })),
            );
        page.on("pageerror", (error) => browserErrors.push(error.message));
        page.on("console", (message) => {
            if (message.type() === "error") browserErrors.push(message.text());
        });
        await page.setViewportSize({ width: 1100, height: 800 });
        const ownerUrl = new URL(fixture.url).href;
        await page.goto(parentFixture?.url ?? fixture.url);
        if (embedded) {
            await page
                .frameLocator("iframe")
                .locator(".xlv-clues-table tr")
                .first()
                .waitFor();
            assert.equal(await page.locator(".xlv-clue-text").count(), 0);
            assert.notEqual(
                new URL(page.url()).origin,
                new URL(fixture.url).origin,
            );
        }
        const puzzle = page.frames().find((frame) => frame.url() === ownerUrl);
        assert.ok(puzzle, "the owning puzzle frame must be available");
        await puzzle.locator(".xlv-clues-table tr").first().waitFor();
        if (large)
            await puzzle.evaluate(() => {
                const news = document.createElement("div");
                for (let region = 0; region < 6; region++) {
                    const section = document.createElement("section");
                    const heading = document.createElement("h2");
                    heading.textContent =
                        "Publisher news and subscription information";
                    section.append(heading);
                    for (let index = 0; index < 16; index++) {
                        const paragraph = document.createElement("p");
                        paragraph.textContent = `Publisher article paragraph ${region * 16 + index + 1}: Local weather, news and subscription information.`;
                        section.append(paragraph);
                    }
                    news.append(section);
                }
                document.body.prepend(news);
            });
        const output = await build({
            stdin: {
                contents: `
                    import { initializeCrosswordBridge } from "./bridge";
                    import { CrosswordDecisionHost } from "./decisionHost";
                    import { collect, isVisible, validateNode, candidateText } from "./collector";
                    const initial = collect("audit-initial", 0, 0);
                    const state = globalThis.__crosswordIsolatedTest = {
                        matches: 0, snapshots: [], messages: [], listeners: [], liveCallbacks: new Map(),
                        collect: () => collect("test-document", 0, 0).snapshot,
                        changes: () => [
                            ...[...collect("audit-fresh",0,0).registry.values()]
                                .filter(entry => ![...initial.registry.values()].some(old => old.node === entry.node))
                                .map(entry => ({added:entry.selector,text:entry.text,context:entry.context})),
                            ...[...initial.registry.values()].flatMap(entry => {
                            try { validateNode(initial, entry); return []; }
                            catch { return [{selector:entry.selector,before:entry.text,after:candidateText(entry)}]; }
                        })],
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
                            if (message.type === "crosswordFrameAction") {
                                const {clueNumber,clueDirection,value} = message.params;
                                const result = await (message.method === "readClue" ?
                                    host.readClue(clueNumber,clueDirection) :
                                    host.enterText(value,clueNumber,clueDirection));
                                return {result};
                            }
                            if (message.method === "resolveCrosswordClue") {
                                state.matches++;
                                state.snapshots.push(message.params.snapshot);
                            }
                            if (${Boolean(lane)}) return new Promise((resolve,reject) => {
                                const id = crypto.randomUUID();
                                state.liveCallbacks.set(id,{resolve,reject});
                                globalThis.__crosswordLiveRuntime(JSON.stringify({id,message}));
                            });
                            if (message.type === "getCrosswordMode") return {mode:"decision",strategy:${JSON.stringify(strategy)}};
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
                                configGeneration:"chromium-fixture",
                                status: matches.length === 1 ? "resolved" : matches.length ? "ambiguous" : "no_fit",
                                ...(matches.length === 1 ? {candidateId:matches[0].id} : {})};
                        },
                        onMessage: {addListener: listener => state.listeners.push(listener),
                            removeListener: listener => state.listeners = state.listeners.filter(item => item !== listener)},
                    }};
                    const host = new CrosswordDecisionHost(message => chrome.runtime.sendMessage(message));
                    const disposeBridge = initializeCrosswordBridge();
                    state.dispose = () => { host.dispose(); disposeBridge(); };
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
        const ownerFrame = embedded
            ? frameTree.childFrames.find(
                  (child) => child.frame.url === ownerUrl,
              ).frame
            : frameTree.frame;
        const { executionContextId } = await cdp.send(
            "Page.createIsolatedWorld",
            {
                frameId: ownerFrame.id,
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
        auditChanges = () => isolated("__crosswordIsolatedTest.changes()");
        if (lane) {
            live = await liveRuntime(lane, fixture.url, ownerFrame.id);
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
        if (large) assert.equal(snapshot.candidates.length, 144);
        assert.ok(snapshot.candidates.length >= 36);
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
            await puzzle.evaluate(
                () => globalThis.__crosswordIsolatedTest === undefined,
            ),
            true,
            "page cannot access isolated test/controller registry",
        );
        const call = (method, params) =>
            puzzle.evaluate(
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
        if (live)
            assert.equal(live.nativeCalls(), strategy === "hybrid2" ? 2 : 1);
        await puzzle.evaluate(() => {
            const publisher = document.createElement("aside");
            publisher.textContent = "Progressively loaded publisher content";
            document.body.prepend(publisher);
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
        const beforeConflict = await puzzle
            .locator("svg text.xlv-cell-text")
            .allTextContents();
        const beforeMatches = await isolated("__crosswordIsolatedTest.matches");
        await assert.rejects(
            call("enterText", { ...down, value: "water" }),
            /crossing_conflict/,
        );
        assert.deepEqual(
            await puzzle.locator("svg text.xlv-cell-text").allTextContents(),
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
                strategy === "hybrid2" ? 3 : 2,
                "Hybrid2 discovers once; each different clue uses one target call and warm bindings require none",
            );
            if (strategy === "hybrid2")
                assert.equal(
                    live.requests()[0].snapshot.snapshotId,
                    live.requests()[1].snapshot.snapshotId,
                );
            assert.ok(
                live
                    .requests()
                    .every(
                        (request) => request.snapshot.candidates.length >= 36,
                    ),
            );
        }
        if (!live) {
            const originalSnapshot = await isolated(
                "__crosswordIsolatedTest.snapshots[0].snapshotId",
            );
            await puzzle.evaluate(() => {
                document.querySelector(".xlv-clue-text").textContent =
                    "Replacement puzzle sentinel (5)";
            });
            assert.deepEqual(await call("readClue", across), {
                text: "Replacement puzzle sentinel (5)",
            });
            assert.equal(await isolated("__crosswordIsolatedTest.matches"), 3);
            assert.notEqual(
                await isolated(
                    "__crosswordIsolatedTest.snapshots.at(-1).snapshotId",
                ),
                originalSnapshot,
                "a changed clue sentinel must publish a fresh inventory",
            );
        }
        await isolated("__crosswordIsolatedTest.dispose()");
        if (live)
            await recordLiveEvidence(lane, {
                kind: "scenario",
                status: "passed",
                nativeCalls: live.nativeCalls(),
                scope: "isolated Chromium with private SW transport; not a loaded-extension test",
            });
    } catch (error) {
        if (live) {
            await recordLiveEvidence(lane, {
                kind: "scenario",
                status: "failed",
                nativeCalls: live.nativeCalls(),
                diagnostics: live.diagnostics(),
            });
            throw new Error(
                `${lane.name} joined scenario failed; ${JSON.stringify(live.diagnostics())}; ${error.message.split("\n")[0]}`,
            );
        }
        const changes = await auditChanges?.();
        throw new Error(
            `${error.message}; page audit=${JSON.stringify(changes)}; frames=${JSON.stringify(await auditFrames?.())}; browser errors=${JSON.stringify(browserErrors)}`,
        );
    } finally {
        await context?.close();
        await fixture.close();
        await parentFixture?.close();
        await rm(profile, { recursive: true, force: true });
        await live?.dispose();
    }
}

test("actual isolated controller: pinned Chromium Exolve recall, guarded crossings, warm cache", () =>
    runChromiumScenario());
test("actual isolated owner: cross-origin iframe surrounded by unrelated parent content", () =>
    runChromiumScenario(undefined, true));
test("Hybrid2 actual isolated iframe owner: larger inventory, cached bindings and guarded entry", () =>
    runChromiumScenario(undefined, true, "hybrid2"));

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
    const cachedLane = {
        ...lane,
        name: `${lane.name}-hybrid2`,
        strategy: "hybrid2",
    };
    test(
        `LIVE Hybrid2: discover once then reuse regions across read and entry -> native ${lane.name}`,
        {
            skip: process.env.TYPEAGENT_CROSSWORD_LIVE !== "1",
            timeout: 180_000,
        },
        () => runChromiumScenario(cachedLane),
    );
    const largeLane = {
        ...lane,
        name: `${lane.name}-hybrid-large`,
        large: true,
    };
    test(
        `LIVE larger inventory baseline Hybrid -> native ${lane.name}`,
        {
            skip: process.env.TYPEAGENT_CROSSWORD_LIVE !== "1",
            timeout: 180_000,
        },
        () => runChromiumScenario(largeLane),
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
                        const started = performance.now();
                        assert.ok(
                            !Object.hasOwn(request.questions, "unique_fit"),
                        );
                        for (const question of Object.values(request.questions))
                            assert.equal(question.type, "choice");
                        const result = await model.data.decide(
                            request,
                            options,
                        );
                        await recordLiveEvidence(lane, {
                            kind: "native",
                            call: nativeCalls,
                            durationMs: performance.now() - started,
                            provider: model.data.provider,
                            model: model.data.model,
                            request,
                            result: result.success
                                ? result
                                : { success: false, code: result.code },
                        });
                        diagnostics.push(
                            result.success
                                ? {
                                      success: true,
                                      stage: Object.keys(request.questions),
                                      answers: result.data.answers,
                                      choiceAbstained: [
                                          "no_fit",
                                          "ambiguous",
                                      ].includes(
                                          result.data.answers.target?.choice,
                                      ),
                                      chosenIssuedCandidate:
                                          Object.hasOwn(
                                              request.questions.target
                                                  ?.criteria ?? {},
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
                return {
                    mode: "decision",
                    strategy: lane.strategy ?? "hybrid",
                };
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
            const started = performance.now();
            const before = nativeCalls;
            const result = await transport.forwardCrosswordDecisionRpc(
                message.method,
                message.params,
                origin,
            );
            if (message.method === "resolveCrosswordClue")
                await recordLiveEvidence(lane, {
                    kind: "resolution",
                    strategy: lane.strategy ?? "hybrid",
                    durationMs: performance.now() - started,
                    nativeCalls: nativeCalls - before,
                    clueNumber: message.params.clueNumber,
                    clueDirection: message.params.clueDirection,
                    snapshot: message.params.snapshot,
                    result,
                });
            return result;
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
