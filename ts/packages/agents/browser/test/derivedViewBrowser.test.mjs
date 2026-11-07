// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import puppeteer from "puppeteer";
import { createServer } from "vite";
import {
    FileMemoryService,
    extensionViewId,
    viewExtensionDigest,
} from "@typeagent/memory-service";
import { McpMemoryServiceClient } from "@typeagent/memory-client";
import { createMemoryViewFunctions } from "../dist/agent/memoryViews.mjs";

const browserRoot = fileURLToPath(new URL("..", import.meta.url));
const memoryRequire = createRequire(
    path.resolve(
        browserRoot,
        "..",
        "..",
        "memory",
        "mcp-server",
        "package.json",
    ),
);
const { MemoryServiceHost } = await import(
    new URL("../../../memory/mcp-server/dist/index.js", import.meta.url)
);
const { FakeSemanticCorpusIndex } = await import(
    new URL(
        "../../../memory/service/dist/test/fakeSemanticCorpusIndex.js",
        import.meta.url,
    )
);
const importMemory = (name) =>
    import(pathToFileURL(memoryRequire.resolve(name)).href);
const { Client } = await importMemory(
    "@modelcontextprotocol/sdk/client/index.js",
);
const { StreamableHTTPClientTransport } = await importMemory(
    "@modelcontextprotocol/sdk/client/streamableHttp.js",
);
const { EXTENSION_ID, RESOURCE_MIME_TYPE } = await importMemory(
    "@modelcontextprotocol/ext-apps/server",
);
const { previewResourceUri } = await import(
    new URL("../../../memory/mcp-server/dist/previewTypes.js", import.meta.url)
);
class QueryIndex extends FakeSemanticCorpusIndex {
    async readFragments(input) {
        const fragments = this.documents
            .filter((document) =>
                input.sourceIds.includes(document.source.sourceId),
            )
            .map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                locator: `chars:0-${document.content.length}`,
                snippet: document.content,
                score: 1,
            }));
        return {
            fragments,
            readChars: fragments.reduce(
                (sum, item) => sum + item.snippet.length,
                0,
            ),
            limited: false,
        };
    }
}

async function executable() {
    const candidates = [
        process.env.TYPEAGENT_BROWSER_EXECUTABLE,
        puppeteer.executablePath(),
        process.env.ProgramFiles &&
            path.join(
                process.env.ProgramFiles,
                "Microsoft",
                "Edge",
                "Application",
                "msedge.exe",
            ),
        process.env["ProgramFiles(x86)"] &&
            path.join(
                process.env["ProgramFiles(x86)"],
                "Microsoft",
                "Edge",
                "Application",
                "msedge.exe",
            ),
    ];
    for (const candidate of candidates.filter(Boolean)) {
        try {
            await access(candidate);
            return candidate;
        } catch {}
    }
    throw new Error(
        "A local Chromium executable is required; set TYPEAGENT_BROWSER_EXECUTABLE",
    );
}

test(
    "actual native Hub and official Apps bridge use one published corpus artifact, exact revisions, four layouts and original expansion",
    { timeout: 90000 },
    async () => {
        const root = path.resolve(
            ".derived-view-browser-fixtures",
            randomUUID(),
        );
        await mkdir(root, { recursive: true });
        let approved = true,
            constructions = 0;
        const outputSchema = {
            type: "object",
            properties: {
                decisionId: {
                    type: "union",
                    variants: [
                        { type: "string", maxLength: 100 },
                        { type: "null" },
                    ],
                },
            },
            required: ["decisionId"],
        };
        const provider = {
            descriptor: {
                apiVersion: 1,
                label: "Synthetic browser provider",
                identity: {
                    providerId: "browser-synthetic",
                    version: "1",
                    implementationDigest: viewExtensionDigest("implementation"),
                    inputContract: "input-v1",
                    outputContract: "story-v1",
                    schemaDigest: viewExtensionDigest(outputSchema),
                    recipeDigest: viewExtensionDigest("recipe"),
                },
                outputSchema,
                definitions: [
                    { id: "recap", eligibilityVersion: "1", mode: "static" },
                ],
                limits: {
                    maxSources: 64,
                    maxInputChars: 240000,
                    maxOutputChars: 120000,
                    maxModelCalls: 6,
                    timeoutMs: 30000,
                },
            },
            authorize: async () => approved,
            evaluateEligibility: async () => ({
                disposition: "eligible",
                reason: "Installed synthetic complete source group",
            }),
            prepare: async () => ({}),
            generate: async (input) => {
                constructions++;
                const source = input.inputs[0];
                const citation = {
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    locator: `chars:0-${source.content.length}`,
                    excerpt: source.content,
                };
                return {
                    kind: "extension",
                    construction: "extension-v1",
                    provider: provider.descriptor.identity,
                    title: "Lantern recap",
                    sections: [
                        {
                            id: "claim",
                            role: "context",
                            heading: "Qualified status",
                            body:
                                "Lantern qualification. ".repeat(100) +
                                "<script>window.untrustedExecuted=true</script>",
                        },
                    ],
                    citations: [citation],
                    evidence: [
                        {
                            blockId: "claim",
                            support: [citation],
                            opposition: [],
                        },
                    ],
                    payload: { decisionId: null },
                    presentation: {
                        schemaVersion: 1,
                        templateId: "document-v1",
                        templateVersion: 1,
                        layouts: ["story", "roles", "brief", "sources"].map(
                            (id) => ({
                                id,
                                label: id,
                                groups: [
                                    {
                                        id: `${id}-group`,
                                        label: id,
                                        blockIds: ["claim"],
                                    },
                                ],
                            }),
                        ),
                    },
                    inputUse: [
                        {
                            sourceId: source.sourceId,
                            revisionId: source.revisionId,
                            disposition: "represented",
                            reason: "Exact retained source",
                        },
                    ],
                    fidelity: {
                        supported: true,
                        reasons: [],
                        missingContext: [],
                        sections: [
                            {
                                sectionId: "claim",
                                supported: true,
                                reason: "Synthetic",
                            },
                        ],
                        relationships: [
                            {
                                edgeId: "claim.support.0",
                                supported: true,
                                reason: "Synthetic",
                            },
                        ],
                    },
                };
            },
        };
        const service = new FileMemoryService(path.join(root, "corpus"), {
            viewDrafts: false,
            informationalViews: false,
            sourceSynopses: false,
            discoveryPolicy: "off",
            maintenanceMode: "manual",
            extensionBuilds: true,
            extensionProviders: [provider],
            sourceAuthorization: async () => approved,
            understanding: true,
            indexedAnswerModel: {
                completionSettings: {},
                complete: async () => {
                    throw new Error(
                        "Offline module-only fixture must not invoke a reader",
                    );
                },
            },
            indexFactory: (_id, directory) => new QueryIndex(directory),
        });
        let host, client, sdk, vite, browser;
        try {
            host = await MemoryServiceHost.start(service, { previews: true });
            client = await McpMemoryServiceClient.create({
                kind: "http",
                url: host.endpoint,
                headers: { authorization: `Bearer ${host.bearerToken}` },
            });
            const corpus = await client.createCorpus("Synthetic private Hub");
            const source = await client.ingestDocument({
                corpusId: corpus.corpusId,
                pipeline: { mode: "content" },
                source: {
                    sourceId: "approved-original",
                    sourceType: "text",
                    title: "Lantern original",
                    text: "Lantern original qualification retained exactly.",
                },
            });
            await client.waitForJob(source.jobId);
            const viewId = extensionViewId(
                provider.descriptor.identity.providerId,
                "recap",
                "case-group",
            );
            const job = await client.buildViews({
                corpusId: corpus.corpusId,
                expectedHead: (await client.listViews(corpus.corpusId)).head,
                publication: false,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId,
                            kind: "extension",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: source.sourceId,
                                        revisionId: source.revisionId,
                                    },
                                ],
                            },
                            extension: {
                                ...provider.descriptor.identity,
                                definitionId: "recap",
                                targetKey: "case-group",
                                eligibilityVersion: "1",
                                policyDigest: viewExtensionDigest("approved"),
                                parameters: {},
                            },
                        },
                    },
                ],
            });
            let receipt = job;
            while (receipt.state === "running") {
                await new Promise((resolve) => setTimeout(resolve, 20));
                receipt = await client.getViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: job.jobId,
                });
            }
            assert.equal(
                receipt.state,
                "complete",
                JSON.stringify(
                    receipt.results.map(({ state, reason }) => ({
                        state,
                        reason,
                    })),
                ),
            );
            const view = await client.getView({
                corpusId: corpus.corpusId,
                viewId,
            });
            await client.publishView({
                corpusId: corpus.corpusId,
                viewId,
                revisionId: view.revisionId,
                expectedVersion: view.version,
                expectedHead: (await client.listViews(corpus.corpusId)).head,
            });
            const rpc = {
                ...createMemoryViewFunctions(() => client),
                memoryListCorpora: () => client.listCorpora(),
                memoryListSources: (request) => client.listSourcesPage(request),
            };
            const readDetail = rpc.memoryGetView;
            let detailReads = 0;
            rpc.memoryGetView = async (request) => {
                detailReads++;
                return readDetail(request);
            };
            const bridgePath = memoryRequire.resolve(
                "@modelcontextprotocol/ext-apps/app-bridge",
            );
            const virtual = `
import { mountMemoryHubViews } from "/src/views/client/library/memoryHubViews.ts";
import { parseRoute } from "/src/views/client/library/memoryHubModel.ts";
import { AppBridge, PostMessageTransport } from ${JSON.stringify(`/@fs/${bridgePath.replaceAll("\\", "/")}`)};
window.panel = mountMemoryHubViews(document.getElementById("hub"), {
scope: () => window.fixture.corpusId, onError: (error) => document.getElementById("error").textContent = String(error),
onNavigate: (route) => window.location.hash = route,
});
window.addEventListener("hashchange", () => {
const destination = window.location.hash;
const route = parseRoute(window.location.hash);
if (route.objectId) void window.panel.show({ corpusId: route.corpusId, viewId: route.objectId, revisionId: route.viewRevisionId, pageId: route.viewPageId, layoutId: route.viewLayoutId }).then(() => {if(window.location.hash === destination) window.settledRoute = destination});
});
await window.panel.show();
window.hubReady = true;
window.openApp = async (html, result, args) => {
const iframe = document.createElement("iframe"); iframe.setAttribute("sandbox", "allow-scripts"); document.body.append(iframe);
const bridge = new AppBridge(null, { name: "Synthetic official host", version: "1" }, { serverTools: {}, logging: {} });
bridge.oncalltool = (request) => window.officialTool(request);
bridge.oninitialized = async () => { await bridge.sendToolInput({ arguments: args }); await bridge.sendToolResult(result); window.appReady = true; };
await bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow));
iframe.srcdoc = html; window.appBridge = bridge;
};`;
            vite = await createServer({
                root: browserRoot,
                configFile: false,
                cacheDir: path.join(root, "vite-cache"),
                server: {
                    host: "127.0.0.1",
                    port: 0,
                    watch: {
                        ignored: ["**/.derived-view-browser-fixtures/**"],
                    },
                    fs: {
                        allow: [path.resolve(browserRoot, "..", "..", "..")],
                    },
                },
                plugins: [
                    {
                        name: "owned-offline-rpc-bridge",
                        resolveId(id) {
                            if (id === "virtual:derived-acceptance")
                                return "\0derived-acceptance";
                        },
                        load(id) {
                            if (id === "\0derived-acceptance") return virtual;
                        },
                        configureServer(server) {
                            server.middlewares.use(
                                "/api/views/invoke",
                                async (request, response) => {
                                    response.setHeader(
                                        "content-type",
                                        "application/json",
                                    );
                                    try {
                                        let body = "";
                                        for await (const chunk of request) {
                                            body += chunk;
                                            if (body.length > 64 * 1024)
                                                throw new Error(
                                                    "Oversized fixture RPC",
                                                );
                                        }
                                        const { method, params } =
                                            JSON.parse(body);
                                        assert.equal(
                                            typeof rpc[method],
                                            "function",
                                            `Unsupported native method ${method}`,
                                        );
                                        response.end(
                                            JSON.stringify({
                                                success: true,
                                                data: await rpc[method](params),
                                            }),
                                        );
                                    } catch (error) {
                                        response.statusCode = 400;
                                        response.end(
                                            JSON.stringify({
                                                success: false,
                                                error: String(error),
                                            }),
                                        );
                                    }
                                },
                            );
                            server.middlewares.use(
                                "/acceptance",
                                (_request, response) => {
                                    response.setHeader(
                                        "content-type",
                                        "text/html",
                                    );
                                    response.end(
                                        '<div id="error"></div><div id="hub"></div><script type="module" src="/@id/virtual:derived-acceptance"></script>',
                                    );
                                },
                            );
                        },
                    },
                ],
                logLevel: "error",
            });
            await vite.listen();
            browser = await puppeteer.launch({
                headless: true,
                executablePath: await executable(),
                userDataDir: path.join(root, "browser-profile"),
                env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
            });
            const page = await browser.newPage();
            await page.evaluateOnNewDocument(
                (fixture) => {
                    window.fixture = fixture;
                },
                { corpusId: corpus.corpusId },
            );
            await page.goto(
                `http://127.0.0.1:${vite.httpServer.address().port}/acceptance`,
            );
            await page.waitForFunction(() => window.hubReady, {
                timeout: 30000,
            });
            assert.equal(
                await page.$eval("#error", (node) => node.textContent),
                "",
            );
            assert.ok(
                await page.evaluate(() =>
                    [...document.querySelectorAll("button")].some(
                        (button) => button.textContent === "Lantern recap",
                    ),
                ),
                await page.$eval("#hub", (node) => node.textContent),
            );
            assert.equal(
                await page.evaluate(() =>
                    [...document.querySelectorAll("button")].some(
                        (button) => button.textContent === "Build views",
                    ),
                ),
                false,
            );
            assert.ok(
                await page.evaluate(() =>
                    [...document.querySelectorAll("button")].some(
                        (button) =>
                            button.textContent === "Qualify provider views",
                    ),
                ),
            );
            await page.evaluate(() =>
                [...document.querySelectorAll("button")]
                    .find((button) => button.textContent === "Lantern recap")
                    .click(),
            );
            await page.waitForSelector(".hub-view-extension");
            assert.equal(
                await page.evaluate(() => window.untrustedExecuted),
                undefined,
            );
            for (const layout of ["story", "roles", "brief", "sources"]) {
                await page.evaluate(
                    (label) =>
                        [
                            ...document.querySelectorAll(
                                '[aria-label="View layouts"] button',
                            ),
                        ]
                            .find((button) => button.textContent === label)
                            .click(),
                    layout,
                );
                await page.waitForFunction(
                    (id) =>
                        document.querySelector(".hub-view-layout")?.dataset
                            .layoutId === id,
                    {},
                    layout,
                );
                await page.waitForFunction(
                    () => window.settledRoute === window.location.hash,
                );
                assert.equal(
                    detailReads,
                    1,
                    "A local layout switch must not refetch the displayed revision",
                );
            }
            const link = await page.$eval(".hub-view-extension a", (anchor) =>
                anchor.getAttribute("href"),
            );
            assert.match(link, /\/revision\/.+\/page\/claim\/layout\/sources$/);
            await page.evaluate((hash) => {
                window.location.hash = hash;
            }, link);
            await page.waitForFunction(
                () => window.settledRoute === window.location.hash,
            );
            assert.equal(
                detailReads,
                2,
                "A direct exact-claim link must still fetch an authorized revision",
            );
            await page.waitForFunction(
                () =>
                    document.querySelector(".hub-view-layout")?.dataset
                        .layoutId === "sources",
            );
            assert.equal(
                await page.$eval(
                    ".hub-view-extension",
                    (node) => node.dataset.revisionId,
                ),
                view.revisionId,
            );
            await page.evaluate(
                async (view) => {
                    [
                        ...document.querySelectorAll(
                            '[aria-label="View layouts"] button',
                        ),
                    ]
                        .find((button) => button.textContent === "sources")
                        .click();
                    await window.panel.show({
                        corpusId: view.corpusId,
                        viewId: view.viewId,
                        revisionId: view.revisionId,
                        pageId: "claim",
                        layoutId: "sources",
                    });
                },
                {
                    corpusId: view.corpusId,
                    viewId: view.viewId,
                    revisionId: view.revisionId,
                },
            );
            assert.equal(
                detailReads,
                3,
                "Explicit reopen must not reuse a consumed local layout handoff",
            );
            sdk = new Client(
                { name: "official-browser-fixture", version: "1" },
                {
                    capabilities: {
                        extensions: {
                            [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] },
                        },
                    },
                },
            );
            await sdk.connect(
                new StreamableHTTPClientTransport(new URL(host.endpoint), {
                    requestInit: {
                        headers: {
                            authorization: `Bearer ${host.bearerToken}`,
                        },
                    },
                }),
            );
            const args = {
                corpusId: corpus.corpusId,
                question: "Lantern",
                retrievalPolicy: "sourcesAndViews",
                selection: { mode: "only", modules: ["derivedViews"] },
            };
            const preview = await sdk.callTool({
                name: "memory_preview",
                arguments: args,
            });
            assert.notEqual(preview.isError, true);
            const resource = await sdk.readResource({
                uri: previewResourceUri,
            });
            await page.exposeFunction("officialTool", (request) =>
                sdk.callTool(request),
            );
            await page.evaluate(
                (html, result, input) => window.openApp(html, result, input),
                resource.contents[0].text,
                preview,
                args,
            );
            await page.waitForFunction(() => window.appReady);
            const frame = page
                .frames()
                .find((frame) => frame.parentFrame() === page.mainFrame());
            await frame.waitForFunction(() =>
                [...document.querySelectorAll("button")].some(
                    (button) => button.textContent === "Show derivedViews",
                ),
            );
            await frame.evaluate(() =>
                [...document.querySelectorAll("button")]
                    .find(
                        (button) => button.textContent === "Show derivedViews",
                    )
                    .click(),
            );
            await frame.waitForSelector(
                'select[aria-label="Derived view layout"]',
            );
            await frame.select(
                'select[aria-label="Derived view layout"]',
                "roles",
            );
            await frame.waitForFunction(
                () => document.querySelector("select")?.value === "roles",
            );
            await frame.evaluate(() =>
                [...document.querySelectorAll("button")]
                    .find(
                        (button) =>
                            button.textContent === "Read remaining claim text",
                    )
                    .click(),
            );
            await frame.waitForFunction(() =>
                document.body.textContent.includes("Text 1601"),
            );
            await frame.evaluate(() =>
                [...document.querySelectorAll("button")]
                    .find((button) =>
                        button.textContent.includes("[claim.support.0]"),
                    )
                    .click(),
            );
            await frame.waitForFunction(() =>
                document.body.textContent.includes(
                    "Lantern original qualification retained exactly.",
                ),
            );
            assert.equal(constructions, 1);
            assert.equal(
                await frame.evaluate(() => window.untrustedExecuted),
                undefined,
            );
            approved = false;
            await frame.evaluate(() =>
                [...document.querySelectorAll("button")]
                    .find((button) =>
                        button.textContent.includes("[claim.support.0]"),
                    )
                    .click(),
            );
            await frame.waitForFunction(
                () =>
                    !document.body.textContent.includes(
                        "Lantern original qualification retained exactly.",
                    ),
            );
            await page.evaluate((target) => window.panel.show(target), {
                corpusId: corpus.corpusId,
                viewId,
            });
            assert.equal(await page.$(".hub-view-extension"), null);
            assert.match(
                await page.$eval("#error", (node) => node.textContent),
                /unavailable|authorized|allowed/i,
            );
            assert.equal(constructions, 1);
        } finally {
            await browser?.close();
            await vite?.close();
            await sdk?.close();
            await client?.close();
            await host?.close();
            await rm(root, { recursive: true, force: true });
        }
    },
);
