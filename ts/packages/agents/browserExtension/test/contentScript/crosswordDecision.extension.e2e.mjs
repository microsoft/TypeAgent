// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const directory = dirname(fileURLToPath(import.meta.url));
const ts = resolve(directory, "..", "..", "..", "..", "..");
const browserRequire = createRequire(
    join(ts, "packages", "agents", "browser", "package.json"),
);
const extensionRequire = createRequire(
    join(ts, "packages", "agents", "browserExtension", "package.json"),
);
const importFile = (path) => import(pathToFileURL(path).href);
const { chromium } = extensionRequire("playwright");
const { WebSocketServer } = browserRequire("ws");
const { createChannelProviderAdapter, createChannelAdapter } = await importFile(
    extensionRequire.resolve("@typeagent/agent-rpc/channel"),
);
const { createRpc } = await importFile(
    extensionRequire.resolve("@typeagent/agent-rpc/rpc"),
);
const { buildConfig, loadRuntimeConfigSync } = await importFile(
    browserRequire.resolve("@typeagent/config"),
);
const ai = await importFile(browserRequire.resolve("@typeagent/aiclient"));
const { CROSSWORD_DECISION_LIMITS } = await importFile(
    extensionRequire.resolve(
        "@typeagent/browser-control-rpc/crosswordDecisionTypes",
    ),
);
const { CrosswordDecisionHandler } = await importFile(
    join(
        ts,
        "packages",
        "agents",
        "browser",
        "dist",
        "agent",
        "crosswordDecisionHandler.mjs",
    ),
);
const { AgentWebSocketServer } = await importFile(
    join(
        ts,
        "packages",
        "agents",
        "browser",
        "dist",
        "agent",
        "agentWebSocketServer.mjs",
    ),
);
const { startCrosswordFixture } = await import(
    "../fixtures/crossword/fixture.mjs"
);
const { extractCrosswordSchema } = await importFile(
    join(
        ts,
        "packages",
        "agents",
        "browser",
        "dist",
        "agent",
        "crosswordSchemaExtractor.mjs",
    ),
);
const azureCli = join(
    process.env.ProgramFiles ?? "",
    "Microsoft SDKs",
    "Azure",
    "CLI2",
    "wbin",
);
if (existsSync(join(azureCli, "az.cmd")))
    process.env.PATH = azureCli + delimiter + process.env.PATH;
const output = resolve(process.argv[2]);
const preflight = process.argv.includes("--preflight");
const demo = process.argv.includes("--demo");
const reads = process.argv.includes("--reads");
const mode =
    process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7) ??
    "decision";
const site =
    process.argv.find((arg) => arg.startsWith("--site="))?.slice(7) ?? "exolve";
assert.ok(["generative", "decision"].includes(mode), "Unknown crossword mode");
assert.ok(
    ["exolve", "seattle", "universal"].includes(site),
    "Unknown demo site",
);
assert.ok(
    demo || (mode === "decision" && site === "exolve"),
    "Site/mode selection requires --demo",
);
assert.ok(
    !preflight || mode === "decision",
    "Zero-inference preflight requires Decision mode",
);
assert.ok(
    !reads || (demo && mode === "decision"),
    "Recorded clue reads require a Decision demo",
);
await mkdir(output, { recursive: true });
const results = {
    scope: demo
        ? "Built unpacked TypeAgent extension; actual registered AppAgent, production Generative schema extraction or native Decision resolution, and shipped UI execution; not natural-language dispatcher"
        : "Built unpacked TypeAgent extension, actual Chrome runtime/SW/frame/WS path and native Decision model; typed crossword bridge, not natural-language dispatcher",
    startedAt: new Date().toISOString(),
    native: [],
    actions: [],
    reads: [],
    schemas: [],
    notifications: [],
    mode,
    site,
    demo,
    policyVersion: CROSSWORD_DECISION_LIMITS.policyVersion,
};
const persist = () =>
    writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
await writeFile(join(output, "results.json"), JSON.stringify(results), {
    flag: "wx",
});
const config = preflight
    ? buildConfig({})
    : loadRuntimeConfigSync({
          workspaceRoot: ts,
          populateProcessEnv: false,
      }).config;
ai.setRuntimeConfig(config);
const handler = new CrosswordDecisionHandler({
    createModel: () => {
        const result = ai.createDecisionModel({ provider: "copilot" });
        if (!result.success) return result;
        return {
            ...result,
            data: {
                ...result.data,
                async decide(request, options) {
                    assert.equal(
                        preflight,
                        false,
                        "Preflight must not run inference",
                    );
                    assert.ok(
                        results.native.length < 32,
                        "recording run native-call ceiling",
                    );
                    if (request.questions.target) {
                        assert.equal(
                            request.state.scopeContext,
                            "Scope IDs are opaque DOM/frame boundaries, not catalog identifiers. Decide clue identity and semantic ambiguity from the supplied evidence.",
                        );
                        assert.equal("candidates" in request.state, false);
                    } else {
                        assert.deepEqual(request.state, {});
                    }
                    const started = performance.now();
                    const row = { request };
                    results.native.push(row);
                    const response = await result.data.decide(request, options);
                    Object.assign(row, {
                        response,
                        durationMs: performance.now() - started,
                    });
                    await persist();
                    return response;
                },
            },
        };
    },
    generation: ai.getRuntimeConfigGeneration,
    now: Date.now,
    timeoutMs: 60_000,
    telemetry: () => {},
});
const backend = await AgentWebSocketServer.start(0);
const discovery = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise((resolve, reject) => {
    discovery.once("listening", resolve);
    discovery.once("error", reject);
});
discovery.on("connection", (socket) => {
    const provider = createChannelProviderAdapter(
        "recorded-discovery",
        (message) => socket.send(JSON.stringify(message)),
    );
    createRpc("recorded-discovery", provider.createChannel("discovery"), {
        lookupPort: () => ({ port: backend.port }),
    });
    socket.on("message", (data) =>
        provider.notifyMessage(JSON.parse(data.toString())),
    );
    socket.on("close", () => provider.notifyDisconnected());
});
const registrations = new Map();
backend.registerSession("default", {
    onWebAgentMessage: async (client, data) => {
        if (data.method === "webAgent/register" && demo) {
            let channel = registrations.get(client.id);
            if (!channel) {
                channel = createChannelAdapter((params) =>
                    client.socket.send(
                        JSON.stringify({
                            source: "dispatcher",
                            method: "webAgent/register",
                            params,
                        }),
                    ),
                );
                createRpc("recorded-registration", channel.channel, {
                    addTypeAgent: async () => {},
                });
                registrations.set(client.id, channel);
            }
            channel.notifyMessage(data.params);
            return;
        }
        if (
            data.method !== "webAgent/message" ||
            data.params?.type !== "builtInRpc"
        )
            return;
        const { id, method, params } = data.params;
        if (demo && method === "notify") {
            results.notifications.push({
                at: new Date().toISOString(),
                message: params.message,
            });
            client.socket.send(
                JSON.stringify({
                    source: "dispatcher",
                    method: "webAgent/message",
                    type: "builtInRpcResponse",
                    id,
                    success: true,
                }),
            );
            await persist();
            return;
        }
        if (demo && method === "extractCrosswordSchema") {
            assert.equal(
                mode,
                "generative",
                "Decision demo must never extract a schema",
            );
            assert.ok(results.schemas.length < 2, "Schema extraction ceiling");
            const row = {
                startedAt: new Date().toISOString(),
                status: "pending",
            };
            results.schemas.push(row);
            const started = performance.now();
            try {
                const schema = await extractCrosswordSchema(
                    {
                        agentContext: {
                            browserControl: {
                                getHtmlFragments: async () => {
                                    const fragments =
                                        await client.browserControlRpc.invoke(
                                            "getHtmlFragments",
                                        );
                                    row.fragments = fragments.map(
                                        (fragment) => ({
                                            frameId: fragment.frameId,
                                            characters:
                                                fragment.content?.length,
                                        }),
                                    );
                                    await writeFile(
                                        join(
                                            output,
                                            `schema-fragments-${results.schemas.length}.json`,
                                        ),
                                        JSON.stringify(fragments, null, 2),
                                    );
                                    await persist();
                                    return fragments;
                                },
                            },
                        },
                    },
                    client.id,
                );
                assert.ok(
                    schema,
                    "Generative extraction did not find a crossword",
                );
                row.schema = schema;
                row.durationMs = performance.now() - started;
                row.status = "passed";
                const clues = Object.fromEntries(
                    ["across", "down"].map((direction) => [
                        direction,
                        Object.fromEntries(
                            schema[direction].map((clue) => [
                                clue.number,
                                { text: clue.text, selector: clue.cssSelector },
                            ]),
                        ),
                    ]),
                );
                client.socket.send(
                    JSON.stringify({
                        source: "dispatcher",
                        method: "webAgent/message",
                        type: "builtInRpcResponse",
                        id,
                        success: true,
                        data: { boardId: params.url, cells: {}, clues },
                    }),
                );
            } catch (error) {
                row.status = "failed";
                row.error = String(error);
                client.socket.send(
                    JSON.stringify({
                        source: "dispatcher",
                        method: "webAgent/message",
                        type: "builtInRpcResponse",
                        id,
                        success: false,
                        error: String(error),
                    }),
                );
            }
            await persist();
            return;
        }
        if (method === "cancelCrosswordDecision") {
            handler.cancel(client.id, params);
            return;
        }
        if (
            ![
                "getCrosswordDecisionCapabilities",
                "resolveCrosswordClue",
            ].includes(method)
        )
            return;
        const result =
            method === "getCrosswordDecisionCapabilities"
                ? handler.capabilities()
                : await handler.resolve(client.id, id, params);
        if (client.socket.readyState === 1)
            client.socket.send(
                JSON.stringify({
                    source: "dispatcher",
                    method: "crosswordDecision/response",
                    type: "builtInRpcResponse",
                    id,
                    result,
                }),
            );
    },
});
const fixture = await startCrosswordFixture();
let context;
let video;
let worker;
try {
    const extension = join(
        ts,
        "packages",
        "agents",
        "browserExtension",
        "dist",
        "extension",
    );
    await readFile(join(extension, "manifest.json"));
    context = await chromium.launchPersistentContext(join(output, "profile"), {
        executablePath: [
            chromium.executablePath(),
            join(
                process.env["ProgramFiles(x86)"] ?? "",
                "Microsoft",
                "Edge",
                "Application",
                "msedge.exe",
            ),
        ].find(existsSync),
        headless: !process.argv.includes("--headed"),
        ignoreDefaultArgs: ["--disable-extensions"],
        offline: true,
        viewport: null,
        ...(preflight
            ? {}
            : {
                  recordVideo: {
                      dir: join(output, "videos"),
                      size: { width: 1280, height: 900 },
                  },
              }),
        args: [
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
            "--host-resolver-rules=MAP localhost ~NOTFOUND",
            "--no-first-run",
        ],
    });
    const isExtensionWorker = (worker) =>
        worker.url().startsWith("chrome-extension://") &&
        worker.url().endsWith("/serviceWorker.js");
    worker =
        context.serviceWorkers().find(isExtensionWorker) ??
        (await context.waitForEvent("serviceworker", {
            predicate: isExtensionWorker,
            timeout: 15_000,
        }));
    results.extensionUrl = worker.url();
    await worker.evaluate(
        async ({ host, mode }) => {
            await chrome.storage.sync.set({
                agentServerHost: host,
                crosswordMode: mode,
                crosswordDecisionStrategy: "hybrid2",
            });
        },
        { host: `ws://127.0.0.1:${discovery.address().port}`, mode },
    );
    await context.setOffline(false);
    const restarted = context.waitForEvent("serviceworker", {
        predicate: isExtensionWorker,
        timeout: 15_000,
    });
    await worker.evaluate(() => {
        setTimeout(() => chrome.runtime.reload(), 100);
    });
    worker = await restarted;
    await worker.evaluate(() => {
        globalThis.__crosswordSenderAudit = [];
        chrome.runtime.onMessage.addListener((message, sender) => {
            if (message?.type === "crosswordFrameAction")
                globalThis.__crosswordSenderAudit.push({
                    runtimeId: chrome.runtime.id,
                    id: sender.id,
                    frameId: sender.frameId,
                    documentId: sender.documentId,
                    documentLifecycle: sender.documentLifecycle,
                    url: sender.url,
                    tabId: sender.tab?.id,
                });
        });
    });
    await context.route(
        "https://crossword.typeagent.test/**",
        async (route) => {
            const source = new URL(route.request().url());
            const response = await context.request.get(
                fixture.url + source.pathname,
            );
            await route.fulfill({ response });
        },
    );
    if (demo)
        await context.addInitScript(
            ({ mode }) => {
                window.__demoAgents = new Map();
                window.__demoNotifications = [];
                let original = window.registerTypeAgent;
                const recordAgent = async (...args) => {
                    window.__demoAgents.set(args[0], args[2]);
                    return original(...args);
                };
                Object.defineProperty(window, "registerTypeAgent", {
                    configurable: true,
                    get: () => (original ? recordAgent : undefined),
                    set: (value) => {
                        original = value;
                    },
                });
                const show = (message) => {
                    const panel = document.getElementById(
                        "recorded-crossword-status",
                    );
                    if (panel)
                        panel.textContent = `${mode.toUpperCase()} | ${message}`;
                };
                document.addEventListener("DOMContentLoaded", () => {
                    const panel = document.createElement("pre");
                    panel.id = "recorded-crossword-status";
                    panel.setAttribute("role", "status");
                    panel.style.cssText =
                        "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#102030;color:white;padding:16px;margin:0;font:16px monospace;white-space:pre-wrap";
                    document.body.append(panel);
                    show(
                        mode === "generative"
                            ? "Page loaded | getting crossword schema..."
                            : "Page loaded | ready for on-demand selection",
                    );
                });
                window.addEventListener("message", (event) => {
                    if (
                        event.source !== window ||
                        event.data?.params?.type !== "builtInRpc"
                    )
                        return;
                    if (event.data.params.method === "extractCrosswordSchema") {
                        show(
                            "Get schema | Generative model extraction running...",
                        );
                        return;
                    }
                    if (event.data.params.method !== "notify") return;
                    const message = event.data.params.params.message;
                    window.__demoNotifications.push(message);
                    show(message);
                });
            },
            { mode },
        );
    const [page] = await Promise.all([
        context.waitForEvent("page", { timeout: 15_000 }),
        worker.evaluate(() =>
            chrome.windows.create({
                url: "about:blank",
                type: "normal",
                focused: true,
            }),
        ),
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    video = page.video();
    results.videoStartedAt = new Date().toISOString();
    const urls = {
        exolve: "https://crossword.typeagent.test/",
        seattle: "https://nytsyn.pzzl.com/cwd_seattle/",
        universal:
            "https://embed.universaluclick.com/iwin/fcx?iframe=iframe&clientId=95&featureId=iwfcx&sda=n&title=y&chat=n&signin=n&data=https%3A%2F%2Fuclick.iwin.com&ref=//www.denverpost.com/puzzles/",
    };
    results.requestedUrl = urls[site];
    results.navigationStartedAt = new Date().toISOString();
    await page.goto(urls[site], {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
    });
    await page
        .locator(
            {
                exolve: ".xlv-clue-text",
                seattle: ".xwordjs-clue",
                universal: "#across_clues .clue",
            }[site],
        )
        .first()
        .waitFor({ timeout: 30_000 });
    results.loadedUrl = page.url();
    if (demo && site === "universal") {
        const regular = page.locator("#regular");
        await regular.waitFor({ state: "visible", timeout: 15_000 });
        await regular.click();
        await regular.waitFor({ state: "hidden", timeout: 10_000 });
        results.startupActions = [
            "Selected Regular skill level using the site's visible startup control",
        ];
    }
    if (!demo)
        await page.evaluate(() => {
            const panel = document.createElement("pre");
            panel.id = "recorded-crossword-status";
            panel.setAttribute("role", "status");
            panel.style.cssText =
                "position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#102030;color:white;padding:16px;margin:0;font:16px monospace;white-space:pre-wrap";
            panel.textContent =
                "Actual unpacked TypeAgent extension | Native Decision | getClue + enterText";
            document.body.append(panel);
        });
    const call = (method, params) =>
        page.evaluate(
            ({ method, params }) =>
                new Promise((resolve, reject) => {
                    const requestId = crypto.randomUUID();
                    const listener = (event) => {
                        if (
                            event.source !== window ||
                            event.origin !== location.origin ||
                            event.data?.type !==
                                "typeagent-crossword-response" ||
                            event.data.requestId !== requestId
                        )
                            return;
                        clearTimeout(timer);
                        window.removeEventListener("message", listener);
                        if (event.data.error)
                            reject(new Error(event.data.error));
                        else resolve(event.data.result);
                    };
                    const timer = setTimeout(() => {
                        window.removeEventListener("message", listener);
                        reject(new Error("extension_bridge_deadline"));
                    }, 65_000);
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
    assert.deepEqual(await call("getMode"), { mode });
    if (mode === "decision") {
        const capability = await call("status");
        assert.equal(capability.available, true);
        assert.equal(capability.strategy, "hybrid2");
    }
    await page.screenshot({ path: join(output, "source.png") });
    if (preflight) {
        if (demo)
            await writeFile(
                join(output, "dom.json"),
                JSON.stringify(
                    await page.evaluate(() => ({
                        inputs: [
                            ...document.querySelectorAll("input,textarea"),
                        ].map((node) => ({
                            id: node.id,
                            class: node.className,
                            type: node.type,
                        })),
                        clues: [
                            ...document.querySelectorAll(
                                ".xwordjs-clue,#across_clues .clue,.xlv-clue-text",
                            ),
                        ]
                            .slice(0, 8)
                            .map((node) => node.outerHTML),
                        grids: [
                            ...document.querySelectorAll(
                                "svg,canvas,[role=grid],.xwordjs-grid-row,.box",
                            ),
                        ]
                            .slice(0, 3)
                            .map((node) => node.outerHTML.slice(0, 24_000)),
                        classCounts: Object.entries(
                            [...document.querySelectorAll("[class]")]
                                .flatMap((node) => [...node.classList])
                                .reduce((counts, name) => {
                                    counts[name] = (counts[name] ?? 0) + 1;
                                    return counts;
                                }, {}),
                        )
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 35),
                    })),
                    null,
                    2,
                ),
            );
        assert.equal(results.native.length, 0);
        results.status = "preflight-passed";
    } else if (demo) {
        await page.waitForFunction(
            (mode) =>
                window.__demoAgents?.has("crossword") &&
                window.__demoNotifications?.some((message) =>
                    mode === "generative"
                        ? message.includes("fully loaded and ready") ||
                          message.includes("error when initializing")
                        : message.includes("Decision mode is ready"),
                ),
            mode,
            { timeout: 95_000 },
        );
        assert.ok(
            !results.notifications.some((row) =>
                row.message.includes("error when initializing"),
            ),
            "Production Generative initialization failed; see schema evidence",
        );
        if (site === "seattle")
            assert.ok(
                page.url().endsWith("#/s/261025"),
                "Demo answers/oracle require the October 25 Seattle edition",
            );
        if (site === "universal")
            assert.ok(
                await page
                    .locator("body")
                    .evaluate((body) =>
                        body.innerText.includes("Universal Freestyle 244"),
                    ),
                "Demo answers/oracle require Universal Freestyle 244",
            );
        const entries =
            site === "exolve"
                ? [
                      {
                          value: "LASER",
                          clueNumber: 1,
                          clueDirection: "across",
                      },
                      { value: "LATER", clueNumber: 1, clueDirection: "down" },
                  ]
                : site === "seattle"
                  ? [
                        {
                            value: "CUSTOM",
                            clueNumber: 1,
                            clueDirection: "across",
                        },
                        {
                            value: "ARCS",
                            clueNumber: 7,
                            clueDirection: "across",
                        },
                    ]
                  : [
                        {
                            value: "ALAS",
                            clueNumber: 1,
                            clueDirection: "across",
                        },
                        {
                            value: "RINDS",
                            clueNumber: 5,
                            clueDirection: "across",
                        },
                    ];
        const liveCells = () =>
            page
                .locator(
                    site === "seattle" ? ".xwordjs-cell" : "td.box,td.black",
                )
                .evaluateAll(
                    (nodes, site) =>
                        nodes.map(
                            (node) =>
                                node
                                    .querySelector(
                                        site === "seattle"
                                            ? ".xwordjs-cell-text"
                                            : ":scope > div",
                                    )
                                    ?.textContent?.trim() ?? "",
                        ),
                    site,
                );
        let expectedLive;
        if (site !== "exolve") {
            expectedLive = Array(site === "seattle" ? 441 : 225).fill("");
            assert.deepEqual(
                await liveCells(),
                expectedLive,
                "A demo must start with a fresh empty grid",
            );
        }
        for (const params of entries) {
            await page
                .locator("#recorded-crossword-status")
                .evaluate((panel, message) => {
                    panel.textContent = message;
                }, `${mode.toUpperCase()} | enterText ${params.clueNumber} ${params.clueDirection}: ${params.value} | running`);
            const before = results.native.length;
            const started = performance.now();
            const actual = await page.evaluate(
                async (params) =>
                    window.__demoAgents.get("crossword").executeAction({
                        actionName: "enterText",
                        parameters: params,
                    }),
                params,
            );
            const durationMs = performance.now() - started;
            const row = {
                params,
                actual,
                durationMs,
                nativeCalls: results.native.length - before,
            };
            results.actions.push(row);
            await persist();
            if (site !== "exolve") {
                const start =
                    params.clueNumber === 1 ? 0 : site === "seattle" ? 8 : 5;
                [...params.value].forEach((letter, offset) => {
                    expectedLive[start + offset] = letter;
                });
                assert.deepEqual(
                    await liveCells(),
                    expectedLive,
                    "Entry reported success without exact target-cell letters and protected other cells",
                );
            } else {
                const expected = params.clueDirection === "across" ? 5 : 9;
                const occupied = await page
                    .locator("svg text.xlv-cell-text")
                    .evaluateAll((nodes) =>
                        nodes
                            .filter((node) => node.textContent?.trim())
                            .map((node) => ({
                                letter: node.textContent.trim(),
                                x: Number(
                                    node.parentElement
                                        .querySelector("rect")
                                        .getAttribute("x"),
                                ),
                                y: Number(
                                    node.parentElement
                                        .querySelector("rect")
                                        .getAttribute("y"),
                                ),
                            })),
                    );
                assert.equal(
                    occupied.length,
                    expected,
                    "Entry reported success without the expected rendered cells",
                );
                const x = Math.min(...occupied.map((cell) => cell.x));
                const y = Math.min(...occupied.map((cell) => cell.y));
                assert.equal(
                    occupied
                        .filter((cell) => cell.y === y)
                        .sort((a, b) => a.x - b.x)
                        .map((cell) => cell.letter)
                        .join(""),
                    "LASER",
                );
                if (params.clueDirection === "down")
                    assert.equal(
                        occupied
                            .filter((cell) => cell.x === x)
                            .sort((a, b) => a.y - b.y)
                            .map((cell) => cell.letter)
                            .join(""),
                        "LATER",
                    );
            }
            row.gridVerified = true;
            row.completedAt = new Date().toISOString();
            assert.ok(
                results.native
                    .slice(before)
                    .every((call) => !call.request.questions.body),
                "enterText must not ask body questions",
            );
            await page.locator("#recorded-crossword-status").evaluate(
                (panel, message) => {
                    panel.textContent = message;
                },
                `${mode.toUpperCase()} | enterText ${params.clueNumber} ${params.clueDirection}: ${params.value}\nGrid verified | ${Math.round(durationMs)} ms | ${row.nativeCalls} Decision calls`,
            );
            await delay(2200);
            if (reads) {
                const expected = await page.evaluate(
                    ({ site, number, direction }) => {
                        const normalize = (text) =>
                            text.replace(/\s+/g, " ").trim();
                        if (site === "exolve") {
                            const rows = document.querySelectorAll(
                                `[id$="-${direction}"] tr`,
                            );
                            const matches = [...rows].filter(
                                (node) =>
                                    node
                                        .querySelector(".xlv-clue-label")
                                        ?.textContent?.trim() ===
                                    String(number),
                            );
                            if (matches.length !== 1)
                                throw new Error(
                                    "Exolve body oracle is not unique",
                                );
                            return normalize(
                                matches[0].querySelector(".xlv-clue-text")
                                    .textContent,
                            );
                        }
                        if (site === "universal") {
                            const node = document.getElementById(
                                `${direction}${number}`,
                            );
                            if (!node)
                                throw new Error(
                                    "Universal body oracle missing",
                                );
                            return normalize(node.textContent).replace(
                                /^\d+\.?\s*/,
                                "",
                            );
                        }
                        const matches = [
                            ...document.querySelectorAll(".xwordjs-clue"),
                        ].filter(
                            (node) =>
                                node
                                    .closest(".xwordjs-cluelist")
                                    ?.previousElementSibling?.textContent?.trim()
                                    .toLowerCase() === direction &&
                                normalize(node.textContent).match(
                                    /^\d+\./,
                                )?.[0] === `${number}.`,
                        );
                        if (matches.length !== 1)
                            throw new Error(
                                "Seattle body oracle is not unique",
                            );
                        return normalize(matches[0].textContent).replace(
                            /^\d+\.\s*/,
                            "",
                        );
                    },
                    {
                        site,
                        number: params.clueNumber,
                        direction: params.clueDirection,
                    },
                );
                const readParams = {
                    clueNumber: params.clueNumber,
                    clueDirection: params.clueDirection,
                };
                for (const cached of [false, true]) {
                    const beforeRead = results.native.length;
                    const started = performance.now();
                    await page.locator("#recorded-crossword-status").evaluate(
                        (panel, message) => {
                            panel.textContent = message;
                        },
                        `DECISION | getClue ${readParams.clueNumber} ${readParams.clueDirection}${cached ? " | cached" : ""} | running`,
                    );
                    const actual = await page.evaluate(
                        async (parameters) =>
                            window.__demoAgents.get("crossword").executeAction({
                                actionName: "getClueValue",
                                parameters,
                            }),
                        readParams,
                    );
                    const durationMs = performance.now() - started;
                    assert.equal(
                        actual?.displayContent,
                        `The clue is: ${expected}`,
                        "getClue must return the exact independently observed body",
                    );
                    const calls = results.native.slice(beforeRead);
                    assert.equal(calls.length, cached ? 0 : 1);
                    assert.ok(
                        calls.every((call) => call.request.questions.body),
                        "An entry binding must upgrade with a body-only call",
                    );
                    const read = {
                        params: readParams,
                        expected,
                        actual,
                        cached,
                        durationMs,
                        nativeCalls: calls.length,
                        bodyVerified: true,
                        completedAt: new Date().toISOString(),
                    };
                    results.reads.push(read);
                    await persist();
                    await page.locator("#recorded-crossword-status").evaluate(
                        (panel, message) => {
                            panel.textContent = message;
                        },
                        `DECISION | getClue ${readParams.clueNumber} ${readParams.clueDirection}${cached ? " | cached" : ""}\n${expected}\nBody verified | ${Math.round(durationMs)} ms | ${calls.length} Decision calls`,
                    );
                    if (!cached) await delay(2200);
                }
            }
        }
        assert.ok(
            reads || results.native.every((row) => !row.request.questions.body),
            "Entry-only demos must not ask body questions",
        );
        assert.equal(results.reads.length, reads ? 4 : 0);
        assert.equal(results.schemas.length, mode === "generative" ? 1 : 0);
        await page.screenshot({ path: join(output, "success.png") });
        results.status = "passed";
    } else {
        const oracle = await page.locator(".xlv-clue-text").allTextContents();
        assert.ok(oracle.length >= 36);
        const perform = async (method, params, expected, addedCalls) => {
            await page.locator("#recorded-crossword-status").evaluate(
                (element, value) => {
                    element.textContent = value;
                },
                `${method === "readClue" ? "getClue" : method} ${params.clueNumber} ${params.clueDirection}${params.value ? `: ${params.value}` : ""} | running`,
            );
            const before = results.native.length;
            const started = performance.now();
            const actual = await call(method, params);
            const durationMs = performance.now() - started;
            assert.deepEqual(actual, expected);
            assert.equal(results.native.length - before, addedCalls);
            const row = {
                method,
                params,
                actual,
                durationMs,
                nativeCalls: addedCalls,
            };
            results.actions.push(row);
            await persist();
            await page.locator("#recorded-crossword-status").evaluate(
                (element, value) => {
                    element.textContent = value;
                },
                `${method === "readClue" ? "getClue" : method} ${params.clueNumber} ${params.clueDirection}: ${JSON.stringify(actual)}\nVerified | ${Math.round(durationMs)} ms | ${addedCalls} native calls`,
            );
            await delay(1800);
        };
        const across = { clueNumber: 1, clueDirection: "across" };
        const down = { clueNumber: 1, clueDirection: "down" };
        const acrossBody = "Device producing a concentrated beam of light (5)";
        await perform("readClue", across, { text: acrossBody }, 3);
        await perform("readClue", across, { text: acrossBody }, 0);
        await perform(
            "enterText",
            { ...across, value: "LASER" },
            { entered: 5, verified: true },
            0,
        );
        const activeAcross = await page
            .locator(".xlv-active-clue .xlv-clue-label")
            .allTextContents();
        assert.ok(activeAcross.some((label) => label.trim() === "1"));
        const beforeDown = await page
            .locator("svg text.xlv-cell-text")
            .allTextContents();
        assert.equal(beforeDown.filter((letter) => letter.trim()).length, 5);
        await perform(
            "enterText",
            { ...down, value: "LATER" },
            { entered: 5, verified: true },
            1,
        );
        const downBody = await page
            .locator("[id$='-down'] tr")
            .filter({
                has: page.locator(".xlv-clue-label", { hasText: /^1$/ }),
            })
            .locator(".xlv-clue-text")
            .textContent();
        assert.ok(downBody);
        await perform(
            "readClue",
            down,
            { text: downBody.replace(/\s+/g, " ").trim() },
            1,
        );
        await perform(
            "readClue",
            down,
            { text: downBody.replace(/\s+/g, " ").trim() },
            0,
        );
        const filled = await page
            .locator("svg text.xlv-cell-text")
            .allTextContents();
        assert.equal(filled.filter((letter) => letter.trim()).length, 9);
        const cells = await page
            .locator("svg text.xlv-cell-text")
            .evaluateAll((nodes) =>
                nodes.map((node) => ({
                    letter: node.textContent?.trim(),
                    x: Number(
                        node.parentElement
                            .querySelector("rect")
                            .getAttribute("x"),
                    ),
                    y: Number(
                        node.parentElement
                            .querySelector("rect")
                            .getAttribute("y"),
                    ),
                })),
            );
        const occupied = cells.filter((cell) => cell.letter);
        const x = Math.min(...occupied.map((cell) => cell.x));
        const y = Math.min(...occupied.map((cell) => cell.y));
        assert.equal(
            cells
                .filter((cell) => cell.y === y && cell.letter)
                .sort((a, b) => a.x - b.x)
                .map((cell) => cell.letter)
                .join(""),
            "LASER",
        );
        assert.equal(
            cells
                .filter((cell) => cell.x === x && cell.letter)
                .sort((a, b) => a.y - b.y)
                .map((cell) => cell.letter)
                .join(""),
            "LATER",
        );
        await page.screenshot({ path: join(output, "success.png") });
        results.status = "passed";
    }
} catch (error) {
    results.status = "failed";
    results.error = error instanceof Error ? error.message : String(error);
    if (worker) {
        try {
            results.senderAudit = await worker.evaluate(async () => ({
                messages: globalThis.__crosswordSenderAudit,
                permissions: await chrome.permissions.contains({
                    origins: ["https://crossword.typeagent.test/*"],
                }),
            }));
        } catch (diagnosticError) {
            results.diagnosticError = String(diagnosticError);
        }
    }
    await persist();
    throw error;
} finally {
    try {
        const clips = new Set([
            video,
            ...(context?.pages().map((page) => page.video()) ?? []),
        ]);
        await context?.close();
        for (const clip of clips) {
            if (!clip) continue;
            const path = await clip.path();
            assert.ok(resolve(path).startsWith(join(output, "videos") + sep));
            if (results.status === "passed" && clip === video)
                results.video = path;
            else await rm(path, { force: true });
        }
    } finally {
        results.completedAt = new Date().toISOString();
        await persist();
        await backend.close();
        for (const client of discovery.clients) client.close();
        await new Promise((resolve, reject) =>
            discovery.close((error) => (error ? reject(error) : resolve())),
        );
        await fixture.close();
        await ai.stopCopilotClient();
    }
}
console.log(
    JSON.stringify({
        status: results.status,
        nativeCalls: results.native.length,
        actions: results.actions,
        video: results.video,
        output,
    }),
);
