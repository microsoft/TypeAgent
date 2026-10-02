// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    mountMemoryManagement,
    type MemoryManagementHost,
} from "./memoryManagement";
import { invokeMemory, invokeView } from "./viewClient";
import { hubAction, mountMemoryHub } from "./memoryHub";
import * as webExplore from "./memoryHubWebExplore";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
jest.mock("./memoryHubPhase2.css", () => ({}));
jest.mock("./memoryKnowledgeCollection.css", () => ({}));
jest.mock("./memoryHubImports.css", () => ({}));
jest.mock("./memoryHubRunbooks.css", () => ({}));
jest.mock("./memoryHubRunbookImports.css", () => ({}));
jest.mock("./memoryHubViewPreferences.css", () => ({}));
jest.mock("./memoryHubWebExplore.css", () => ({}));
jest.mock(
    "./memoryHubWebExploreAnalytics.html?raw",
    () =>
        require("node:fs").readFileSync(
            `${__dirname}\\memoryHubWebExploreAnalytics.html`,
            "utf8",
        ),
    { virtual: true },
);
jest.mock(
    "./memoryHubWebExploreEntities.html?raw",
    () =>
        require("node:fs").readFileSync(
            `${__dirname}\\memoryHubWebExploreEntities.html`,
            "utf8",
        ),
    { virtual: true },
);
jest.mock(
    "./memoryHubWebExploreTopics.html?raw",
    () =>
        require("node:fs").readFileSync(
            `${__dirname}\\memoryHubWebExploreTopics.html`,
            "utf8",
        ),
    { virtual: true },
);
const invoke = invokeMemory as jest.Mock;
const viewInvoke = invokeView as jest.Mock;
const corpus = {
    corpusId: "a",
    name: "Alpha",
    status: "ready",
    documentCount: 1,
    sourceCount: 1,
    revisionCount: 1,
    readyRevisionCount: 1,
    activeJobCount: 0,
};
const source = {
    sourceId: "source",
    corpusId: "a",
    title: "Source",
    sourceType: "markdown",
    activeRevisionId: "r1",
    revisions: [],
};
const version = {
    corpusId: "a",
    procedureId: "procedure",
    state: "saved",
    version: 3,
    markdown: "# Guide\n\n## Steps\n\n1. Check\n\n## Sources\n\n_None_\n",
    document: { title: "Guide", steps: ["Check"], citations: [] },
};
const candidate = {
    corpusId: "a",
    candidateId: "candidate",
    state: "detected",
    title: "Found guide",
    steps: ["Check"],
    citations: [
        {
            sourceId: "source",
            revisionId: "r1",
            locator: "lines 2-3",
            excerpt: "Check",
        },
    ],
};
let host: MemoryManagementHost;

function value<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}
async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
    document.body.innerHTML = new DOMParser().parseFromString(
        readFileSync(
            resolve(
                process.cwd(),
                "src/views/client/library/memoryManagement.html",
            ),
            "utf8",
        ),
        "text/html",
    ).body.innerHTML;
    document.body.dataset.memoryHub = "true";
    invoke.mockReset();
    invoke.mockImplementation(
        async (method: string, params: { corpusId?: string }) => {
            switch (method) {
                case "memoryGetCorpus":
                    return { ...corpus, corpusId: params.corpusId };
                case "memoryListJobs":
                case "memoryListActivity":
                    return { items: [], total: 0 };
                case "memoryGetHowToSettings":
                    return {
                        revision: 7,
                        enabled: true,
                        detectCandidates: true,
                        preferences: {
                            instructions: "Keep commands",
                            custom: "preserve",
                        },
                    };
                case "memoryListProcedureCandidates":
                    return [candidate];
                case "memoryListProcedures":
                    return [
                        {
                            corpusId: "a",
                            procedureId: "procedure",
                            title: "Guide",
                            state: "saved",
                            latestVersion: 3,
                        },
                    ];
                case "memoryGetProcedure":
                case "memorySaveProcedure":
                    return version;
                case "memoryGetSource":
                    return source;
                case "memoryGetSourceContent":
                    return {
                        content: "Original",
                        offset: 0,
                        totalChars: 8,
                        corpusId: "a",
                        sourceId: "source",
                        revisionId: "r1",
                    };
                case "memoryGetSourceKnowledge":
                    return { entities: [], topics: [], relationships: [] };
                case "memoryListSourceKnowledgeSuppressions":
                    return [];
                case "memoryPreviewForgetSource":
                    return {
                        corpusId: "a",
                        sourceId: "source",
                        confirmationToken: "server-token",
                        expiresAt: "2026-10-03",
                        revisionCount: 1,
                        derivedEntityCount: 0,
                        derivedTopicCount: 0,
                        derivedRelationshipCount: 0,
                    };
                default:
                    return {};
            }
        },
    );
    host = {
        scope: () => "a",
        sources: jest.fn(async () => ({ items: [source], total: 1 })),
        procedures: () => [],
        changed: jest.fn(async () => {}),
        openSource: jest.fn(),
        openProcedure: jest.fn(),
    };
    window.confirm = jest.fn(() => true);
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event("close"));
    };
});

afterEach(() => {
    document.body.innerHTML = "";
    delete document.body.dataset.memoryHub;
});

test("source links are corpus-qualified and Knowledge is loaded only on demand", async () => {
    const manager = mountMemoryManagement(host);
    await manager.selectCorpus("a");
    value("sourceList").querySelector<HTMLButtonElement>("button")!.click();
    expect(host.openSource).toHaveBeenCalledWith("a", "source");
    await manager.selectSource("source");
    expect(
        invoke.mock.calls.some(
            ([method]) => method === "memoryGetSourceKnowledge",
        ),
    ).toBe(false);
    await manager.loadSourceKnowledge();
    expect(invoke).toHaveBeenCalledWith("memoryGetSourceKnowledge", {
        corpusId: "a",
        sourceId: "source",
    });
});

test("All-memory selection and restored focus use corpus plus source identity", async () => {
    host.sources = jest.fn(async () => ({
        items: [source, { ...source, corpusId: "b" }],
        total: 2,
    }));
    const manager = mountMemoryManagement(host);
    await manager.selectCorpus("a");
    await manager.selectSource("source");
    const selected =
        value("sourceList").querySelectorAll<HTMLButtonElement>(
            "button.selected",
        );
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.corpusId).toBe("a");
    const oldRow = selected[0];
    await manager.selectCorpus("");
    expect(oldRow.isConnected).toBe(false);
    expect(manager.focusSource("b", "source")).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.corpusId).toBe("b");
    expect(document.activeElement?.isConnected).toBe(true);
    expect(manager.focusSource("missing", "source")).toBe(false);
});

test("replacement retains revision/history checks and forget retains server token", async () => {
    const manager = mountMemoryManagement(host);
    await manager.selectCorpus("a");
    await manager.selectSource("source");
    value<HTMLTextAreaElement>("contentEditor").value = "Replacement";
    value("replaceSourceButton").click();
    await settle();
    value<HTMLInputElement>("retainHistory").checked = false;
    value("confirmReplaceButton").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "memoryReplaceSource",
        expect.objectContaining({
            corpusId: "a",
            sourceId: "source",
            expectedActiveRevisionId: "r1",
            retainRevisionHistory: false,
            text: "Replacement",
        }),
    );
    value("forgetSourceButton").click();
    await settle();
    expect(value("forgetPreview").textContent).toContain(
        "dependency lookup is unavailable",
    );
    value("confirmForgetButton").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryForgetSource", {
        corpusId: "a",
        sourceId: "source",
        confirmationToken: "server-token",
    });
});

test("candidate review/save retains citations and candidate identity", async () => {
    const manager = mountMemoryManagement(host);
    await manager.reviewCandidate("a", "candidate");
    expect(value<HTMLTextAreaElement>("procedureEditor").value).toContain(
        JSON.stringify(candidate.citations[0]),
    );
    value("saveProcedureButton").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "memorySaveProcedure",
        expect.objectContaining({
            corpusId: "a",
            candidateId: "candidate",
            markdown: expect.stringContaining('"revisionId":"r1"'),
        }),
    );
    expect(host.changed).toHaveBeenCalled();
});

test("saved how-tos and settings retain optimistic checks and preferences", async () => {
    const manager = mountMemoryManagement(host);
    await manager.selectCorpus("a");
    await manager.selectProcedure("procedure");
    value("saveProcedureButton").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "memorySaveProcedure",
        expect.objectContaining({
            expectedVersion: 3,
            procedureId: "procedure",
        }),
    );
    value<HTMLTextAreaElement>("howToInstructions").value = "New guidance";
    value("saveHowToSettings").click();
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "memoryUpdateHowToSettings",
        expect.objectContaining({
            expectedRevision: 7,
            preferences: { instructions: "New guidance", custom: "preserve" },
        }),
    );
});

test("All memory cannot send a corpus-wide mutation to last inspected corpus", async () => {
    const manager = mountMemoryManagement({ ...host, scope: () => undefined });
    await manager.selectCorpus("a");
    value("reindexCorpusButton").click();
    await settle();
    expect(
        invoke.mock.calls.some(([method]) => method === "memoryReindexCorpus"),
    ).toBe(false);
    expect(value("errorBanner").textContent).toContain("named target corpus");
});

test("unsaved edits block navigation and failures preserve editable drafts", async () => {
    const manager = mountMemoryManagement(host);
    await manager.selectCorpus("a");
    await manager.selectProcedure("procedure");
    value<HTMLTextAreaElement>("procedureEditor").value += "draft";
    window.confirm = jest.fn(() => false);
    expect(manager.discardChanges()).toBe(false);
    await manager.selectCorpus("b");
    expect(invoke).not.toHaveBeenCalledWith("memoryGetCorpus", {
        corpusId: "b",
    });
    invoke.mockImplementationOnce(async () => {
        throw new Error("Version conflict");
    });
    value("saveProcedureButton").click();
    await settle();
    expect(value("errorBanner").textContent).toContain("Version conflict");
    expect(value<HTMLTextAreaElement>("procedureEditor").value).toContain(
        "draft",
    );
    expect(value("connectionState").textContent).toContain("operation failed");
});

test("hub errors distinguish offline transport from operation failure", async () => {
    document.body.innerHTML =
        '<div id="hubError"></div><div id="hubStatus"></div>';
    await hubAction(async () => {
        throw new Error("Browser view service is unavailable");
    });
    expect(value("hubStatus").textContent).toBe("Offline");
    await hubAction(async () => {
        throw new Error("Revision conflict");
    });
    expect(value("hubStatus").textContent).toBe("Connected · operation failed");
});

test("late corpus responses cannot replace a newer corpus or enable its old settings", async () => {
    const implementation = invoke.getMockImplementation()!;
    let resolveOld!: (value: unknown) => void;
    invoke.mockImplementation(
        (method: string, params: { corpusId?: string }) => {
            if (method === "memoryGetCorpus" && params.corpusId === "old") {
                return new Promise((resolveValue) => {
                    resolveOld = resolveValue;
                });
            }
            return implementation(method, params);
        },
    );
    const manager = mountMemoryManagement(host);
    const old = manager.selectCorpus("old");
    expect(value<HTMLButtonElement>("saveHowToSettings").disabled).toBe(true);
    await manager.selectCorpus("a");
    resolveOld({ ...corpus, corpusId: "old" });
    await expect(old).rejects.toThrow("Superseded request");
    await manager.selectSource("source");
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryGetSourceContent",
        expect.objectContaining({ corpusId: "a" }),
    );
});

test("the complete shell mounts reused panels, global Add and reversible triage", async () => {
    jest.useFakeTimers();
    localStorage.clear();
    const mountWeb = webExplore.mountMemoryHubWebExplore;
    const showWeb = jest.fn(
        async (
            _request?: Parameters<ReturnType<typeof mountWeb>["show"]>[0],
        ) => {},
    );
    const mountedWeb = jest
        .spyOn(webExplore, "mountMemoryHubWebExplore")
        .mockImplementation((host, options) => ({
            ...mountWeb(host, options),
            show: showWeb,
        }));
    history.replaceState({}, "", "#/inbox");
    const hubHtml = readFileSync(
        resolve(process.cwd(), "src/views/client/library/memoryHub.html"),
        "utf8",
    );
    const centerHtml = readFileSync(
        resolve(
            process.cwd(),
            "src/views/client/library/memoryManagement.html",
        ),
        "utf8",
    );
    document.body.innerHTML = new DOMParser().parseFromString(
        hubHtml,
        "text/html",
    ).body.innerHTML;
    globalThis.fetch = jest.fn(async () => ({
        ok: true,
        text: async () => centerHtml,
    })) as unknown as typeof fetch;
    const inboxItem = {
        id: "candidate:a:c",
        fingerprint: "candidate:v1",
        kind: "candidate",
        corpusId: "a",
        corpusName: "Alpha",
        objectId: "candidate",
        title: "Found guide",
        reason: "Review",
        updatedAt: "2026-10-01",
        severity: "info",
        sourceId: "source",
    };
    const searchEvidence = {
        id: "source:a:r1",
        kind: "source",
        corpusId: "a",
        corpusName: "Alpha",
        objectId: "source",
        sourceId: "source",
        revisionId: "r1",
        title: "Worker evidence",
        snippet: "Check worker",
        score: 1,
        rank: 1,
    };
    viewInvoke.mockImplementation(
        async (method: string, params: { query?: string } = {}) => {
            if (method === "memoryHubSnapshot")
                return {
                    corpora: [corpus],
                    inbox: [inboxItem],
                    procedures: [],
                    errors: [],
                };
            if (method === "memoryHubSearch")
                return {
                    query: params.query,
                    matches: [searchEvidence],
                    warnings: [],
                    errors: [],
                    ranking: "reciprocal-rank-fusion",
                    answer: {
                        text: "Check worker [1]",
                        mode: "synthesized",
                        citationIds: [searchEvidence.id],
                        followUps: [],
                    },
                };
            if (method === "memoryHubEvidence")
                return {
                    title: "Original",
                    content: "Retained original",
                    offset: 0,
                    totalChars: 17,
                    provenance: {
                        corpusId: "a",
                        kind: "source",
                        objectId: "source",
                        revisionId: "r1",
                    },
                };
            if (method === "memoryHubChanges")
                return { items: [], total: 0, errors: [] };
            return { items: [source], total: 1, errors: [] };
        },
    );
    await mountMemoryHub();
    expect(value<HTMLSelectElement>("hubCorpus").value).toBe("");
    expect(value("inboxBadge").textContent).toBe("1");
    expect(value("hubSources").querySelector("#sourceList")).not.toBeNull();
    expect(value("drawer-content").textContent).toContain("Source text");
    expect(value("drawer-knowledge").textContent).toContain(
        "Derived knowledge",
    );
    expect(
        value("hubSettings").querySelector("#saveHowToSettings"),
    ).not.toBeNull();
    expect(value("createCorpusDialog").parentElement).toBe(document.body);
    const dismiss = Array.from(
        value("hubInbox").querySelectorAll("button"),
    ).find((node) => node.textContent === "Dismiss")!;
    dismiss.click();
    expect(value("inboxBadge").textContent).toBe("0");
    value<HTMLInputElement>("inboxDismissed").checked = true;
    value("inboxDismissed").dispatchEvent(new Event("change"));
    const restore = Array.from(
        value("hubInbox").querySelectorAll("button"),
    ).find((node) => node.textContent === "Restore")!;
    restore.click();
    expect(value("inboxBadge").textContent).toBe("1");
    history.replaceState({}, "", "#/library/a/source");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    expect({
        visible: !value("hubDrawer").classList.contains("hidden"),
        error: value("hubError").textContent,
    }).toEqual({ visible: true, error: "" });
    expect(value("drawerCorpus").textContent).toBe("Source corpus: Alpha");
    history.replaceState({}, "", location.href);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    jest.advanceTimersByTime(1);
    await settle();
    expect(value("hubDrawer").classList.contains("hidden")).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.corpusId).toBe("a");
    expect((document.activeElement as HTMLElement).dataset.sourceId).toBe(
        "source",
    );
    expect(document.activeElement?.isConnected).toBe(true);
    history.replaceState({}, "", "#/library/a/source");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    const viewImplementation = viewInvoke.getMockImplementation()!;
    viewInvoke.mockImplementation((method: string, params: unknown) =>
        method === "memoryHubSources"
            ? Promise.resolve({ items: [], total: 0, errors: [] })
            : viewImplementation(method, params),
    );
    history.replaceState({}, "", location.href);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    jest.advanceTimersByTime(1);
    await settle();
    expect(document.activeElement).toBe(
        value("page-library").querySelector("h2"),
    );
    const memoryImplementation = invoke.getMockImplementation()!;
    invoke.mockImplementation((method: string, params: unknown) =>
        method === "memoryListJobs"
            ? Promise.resolve({
                  items: [],
                  total: 1,
                  nextContinuationToken: "repeated",
              })
            : memoryImplementation(method, params),
    );
    history.replaceState({}, "", "#/activity/a/missing-job");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    await settle();
    expect(value("hubError").textContent).toContain(
        "Memory jobs returned a repeated page token.",
    );
    expect(value("hubError").classList.contains("hidden")).toBe(false);
    invoke.mockImplementation(memoryImplementation);
    history.replaceState({}, "", "#/library");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    value<HTMLInputElement>("hubAsk").value = "worker";
    value("hubAskForm").dispatchEvent(
        new Event("submit", { cancelable: true }),
    );
    jest.advanceTimersByTime(1);
    await settle();
    await settle();
    expect(location.hash).toBe("#/search");
    expect(value("hubSearch").textContent).toContain("Check worker [1]");
    expect(new URL(location.href).searchParams.get("query")).toBe("worker");
    const searches = viewInvoke.mock.calls.filter(
        ([method]) => method === "memoryHubSearch",
    ).length;
    history.replaceState({}, "", "#/library/a/source");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    history.replaceState({}, "", "#/search");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    expect(value("hubSearch").textContent).toContain("Check worker [1]");
    expect(
        viewInvoke.mock.calls.filter(
            ([method]) => method === "memoryHubSearch",
        ),
    ).toHaveLength(searches);
    value("hubAdd").click();
    expect(value<HTMLDialogElement>("hubAddDialog").open).toBe(true);
    expect(value<HTMLButtonElement>("addMarkdown").disabled).toBe(true);
    value("addBrowser").click();
    const browserImport =
        document.querySelector<HTMLDialogElement>(".hub-import-dialog")!;
    expect(browserImport.open).toBe(true);
    expect(browserImport.textContent).toContain("TypeAgent Browser Memory");
    expect(browserImport.textContent).toContain("Cancellation unavailable");
    browserImport.close();
    value("hubAdd").click();
    value("addCreate").click();
    await settle();
    expect(value<HTMLDialogElement>("createCorpusDialog").open).toBe(true);
    value<HTMLDialogElement>("createCorpusDialog").close();
    const beforeInboxRefresh = viewInvoke.getMockImplementation()!;
    viewInvoke.mockImplementation((method: string, params: unknown) =>
        method === "memoryHubSnapshot"
            ? Promise.resolve({
                  corpora: [corpus],
                  inbox: [
                      {
                          ...inboxItem,
                          id: "candidate:a:imported",
                          objectId: "imported",
                          title: "Newly completed imported guide",
                      },
                  ],
                  procedures: [],
                  errors: [],
              })
            : beforeInboxRefresh(method, params),
    );
    value<HTMLInputElement>("inboxDismissed").checked = false;
    value("inboxDismissed").dispatchEvent(new Event("change"));
    history.replaceState({}, "", "#/inbox");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    expect(value("hubInbox").textContent).toContain(
        "Newly completed imported guide",
    );
    expect(value("hubInbox").textContent).not.toContain("Found guide");
    viewInvoke.mockImplementation(beforeInboxRefresh);
    const selector = value<HTMLSelectElement>("hubCorpus");
    selector.value = "a";
    selector.dispatchEvent(new Event("change"));
    await settle();
    const currentView = viewInvoke.getMockImplementation()!;
    viewInvoke.mockImplementation((method: string, params: unknown) =>
        method === "memoryHubSnapshot"
            ? Promise.resolve({
                  corpora: [],
                  inbox: [],
                  procedures: [],
                  errors: [],
              })
            : currentView(method, params),
    );
    value("hubRefresh").click();
    await settle();
    await settle();
    expect(selector.value).toBe("a");
    expect(selector.selectedOptions[0].textContent).toBe(
        "Selected corpus is unavailable",
    );
    expect(value("hubDegraded").textContent).toContain(
        "not been broadened to All memory",
    );
    expect(value<HTMLButtonElement>("addMarkdown").disabled).toBe(true);
    selector.value = "";
    selector.dispatchEvent(new Event("change"));
    await settle();
    expect(value("hubDegraded").classList.contains("hidden")).toBe(true);
    const corpusReads = invoke.mock.calls.filter(
        ([method]) => method === "memoryGetCorpus",
    ).length;
    history.replaceState({}, "", "#/explore");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    const webCalls = showWeb.mock.calls.length;
    expect(value("hubExplore").hidden).toBe(false);
    expect(value("hubExplore").querySelector("svg")).toBeNull();
    expect(
        document.querySelector('#hubExploreNavigation a[aria-current="page"]')
            ?.textContent,
    ).toBe("Overview");
    expect(
        value("hubWebExplore").querySelector<HTMLElement>(
            ".memory-web-explore",
        )!.hidden,
    ).toBe(true);
    const overviewCorpusReads = invoke.mock.calls.filter(
        ([method]) => method === "memoryGetCorpus",
    ).length;
    const overviewCalls = viewInvoke.mock.calls.filter(
        ([method]) => method === "memoryHubExplore",
    ).length;
    for (const [view, selection] of [
        ["entities", "Worker / service"],
        ["topics", "Queues & flows"],
    ] as const) {
        history.replaceState(
            {},
            "",
            `#/explore/web/${view}/${encodeURIComponent(selection)}`,
        );
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        await settle();
        expect(showWeb).toHaveBeenLastCalledWith(
            view === "entities"
                ? { view, entity: selection }
                : { view, topic: selection },
        );
        expect(value("hubExplore").hidden).toBe(true);
        expect(
            document
                .querySelector('#hubExploreNavigation a[aria-current="page"]')
                ?.getAttribute("data-explore-view"),
        ).toBe(view);
        expect(new URL(location.href).searchParams.get("query")).toBe("worker");
    }
    expect(
        invoke.mock.calls.filter(([method]) => method === "memoryGetCorpus"),
    ).toHaveLength(overviewCorpusReads);
    expect(overviewCorpusReads).toBeGreaterThanOrEqual(corpusReads);
    expect(showWeb.mock.calls.length).toBe(webCalls + 2);
    expect(
        viewInvoke.mock.calls.filter(
            ([method]) => method === "memoryHubExplore",
        ),
    ).toHaveLength(overviewCalls);
    history.replaceState({}, "", "#/settings");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    const defaultView = value("hubSettings").querySelector<HTMLSelectElement>(
        '[name="defaultViewMode"]',
    )!;
    defaultView.value = "grid";
    defaultView.dispatchEvent(new Event("change"));
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
    history.replaceState({}, "", "#/library");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(location.hash).toBe("#/settings");
    expect(defaultView.value).toBe("grid");
    confirm.mockRestore();
    window.dispatchEvent(new Event("pagehide"));
    mountedWeb.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
});
