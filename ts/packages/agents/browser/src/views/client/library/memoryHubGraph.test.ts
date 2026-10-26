// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubGraph } from "./memoryHubGraph";
import { invokeView } from "./viewClient";
import type { MemoryHubGraphResult } from "@typeagent/browser-control-rpc/viewRpc";

jest.mock("./memoryHubGraph.css", () => ({}));
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
jest.mock("./entityGraphVisualizer", () => ({
    EntityGraphVisualizer: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        loadGlobalGraph: jest.fn().mockResolvedValue(undefined),
        onEntityClick: jest.fn(),
        onEdgeClick: jest.fn(),
        fitToView: jest.fn(),
        resize: jest.fn(),
        destroy: jest.fn(),
    })),
}));
jest.mock("./topicGraphVisualizer", () => ({
    TopicGraphVisualizer: jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        onTopicClick: jest.fn(),
        onEdgeClick: jest.fn(),
        fitToView: jest.fn(),
        resize: jest.fn(),
        dispose: jest.fn(),
    })),
}));

const invoke = invokeView as jest.Mock;
const nodeId = `graph:a:entity:${"1".repeat(32)}`;
const sample: MemoryHubGraphResult = {
    corpora: [
        {
            corpusId: "a",
            corpusName: "Alpha",
            graph: {
                corpusId: "a",
                generation: "g1",
                state: "ready",
                nodes: [
                    {
                        id: nodeId,
                        kind: "entity",
                        label: "Casey",
                        types: ["person"],
                        mentionCount: 2,
                        supportCount: 2,
                    },
                ],
                edges: [],
                counts: {
                    nodes: 1,
                    edges: 0,
                    omittedNodes: 0,
                    omittedEdges: 0,
                },
                limits: { maxNodes: 250, maxEdges: 500 },
                coverage: {
                    documents: {
                        state: "ready",
                        total: 1,
                        eligible: 1,
                        indexed: 1,
                    },
                    events: {
                        state: "ready",
                        total: 0,
                        eligible: 0,
                        indexed: 0,
                    },
                    reasons: [],
                },
            },
        },
    ],
    errors: [],
    omittedCorpora: 0,
    presetLayout: { elements: [] },
};
let host: HTMLElement;
let scope: string | undefined;
let mounted: ReturnType<typeof mountMemoryHubGraph>;
let onError: jest.Mock;
let onOpenSource: jest.Mock;
let onRouteChanged: jest.Mock;

async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
}
function button(label: string) {
    const value = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.textContent === label,
    );
    if (!value) throw new Error(`Missing button: ${label}`);
    return value;
}
function select(label: string) {
    return host.querySelector<HTMLSelectElement>(
        `select[aria-label="${label}"]`,
    )!;
}

beforeEach(() => {
    host = document.createElement("div");
    document.body.replaceChildren(host);
    scope = undefined;
    onError = jest.fn();
    onOpenSource = jest.fn();
    onRouteChanged = jest.fn();
    invoke.mockReset();
    invoke.mockImplementation((method) => {
        if (method === "memoryHubGraph") return Promise.resolve(sample);
        if (method === "memoryHubGraphSupport")
            return Promise.resolve({
                generation: "g1",
                items: [],
                total: 0,
            });
        throw new Error(`Unexpected graph call: ${method}`);
    });
    mounted = mountMemoryHubGraph(host, {
        scope: () => scope,
        onError,
        onOpenSource,
        onRouteChanged,
    });
});
afterEach(() => mounted.dispose());

test("uses bounded corpus-neutral graph calls and never fetches browser analytics", async () => {
    await mounted.show({ view: "entities" });
    expect(invoke).toHaveBeenCalledWith(
        "memoryHubGraph",
        expect.objectContaining({
            kind: "entities",
            maxNodes: 250,
            maxEdges: 500,
            evidenceKinds: ["document", "event"],
        }),
    );
    expect(invoke.mock.calls).toHaveLength(1);
    expect(invoke.mock.calls[0][1]).not.toHaveProperty("corpusId");
    expect(host.textContent).toContain("1 of 1 matching nodes");
    expect(onError).not.toHaveBeenCalled();
});

test("opaque graph routes retain node identity instead of becoming label searches", async () => {
    scope = "a";
    await mounted.show({ view: "entities", selection: nodeId });
    expect(invoke.mock.calls[0]).toEqual([
        "memoryHubGraph",
        expect.objectContaining({ corpusId: "a", nodeId }),
    ]);
    expect(invoke.mock.calls[0][1]).not.toHaveProperty("search");
    expect(onRouteChanged).toHaveBeenCalledWith("entities", nodeId);
});

test("inventory pages preserve the original query and effective limits, with honest last-page omissions", async () => {
    invoke.mockImplementation((method, request) => {
        if (method !== "memoryHubGraph")
            throw new Error(`Unexpected graph call: ${method}`);
        const last = request.continuationToken !== undefined;
        return Promise.resolve({
            ...sample,
            corpora: [
                {
                    ...sample.corpora[0],
                    graph: {
                        ...sample.corpora[0].graph,
                        counts: {
                            nodes: 2,
                            edges: 0,
                            omittedNodes: 1,
                            omittedEdges: 0,
                        },
                        limits: { maxNodes: 1, maxEdges: 1 },
                        ...(last ? {} : { nextContinuationToken: "next-page" }),
                    },
                },
            ],
        });
    });
    await mounted.show({ view: "entities" });
    expect(host.textContent).toContain("1 of 2 matching nodes");
    host.querySelector<HTMLInputElement>(
        'input[aria-label="Find graph nodes"]',
    )!.value = "An unapplied search";
    select("Graph evidence kinds").value = "event";
    button("Next nodes in Alpha").click();
    await settle();
    const request = invoke.mock.calls[invoke.mock.calls.length - 1][1];
    expect(request).toEqual(
        expect.objectContaining({
            corpusId: "a",
            kind: "entities",
            maxNodes: 1,
            maxEdges: 1,
            evidenceKinds: ["document", "event"],
            eventFilter: {},
            expectedGeneration: "g1",
            continuationToken: "next-page",
        }),
    );
    expect(request).not.toHaveProperty("search");
    expect(button("Next nodes in Alpha").disabled).toBe(true);
    expect(button("First nodes in Alpha").disabled).toBe(false);
    expect(host.textContent).toContain("1 not on this page");
    button("First nodes in Alpha").click();
    await settle();
    expect(
        invoke.mock.calls[invoke.mock.calls.length - 1][1],
    ).not.toHaveProperty("continuationToken");
});

test("opens a loading shell before the graph resolves and rejects stale scope results", async () => {
    let finish!: (value: typeof sample) => void;
    invoke.mockImplementation(
        () => new Promise((resolve) => (finish = resolve)),
    );
    const pending = mounted.show({ view: "entities" });
    expect(host.textContent).toContain("Loading scoped memory graph...");
    mounted.scopeChanged();
    finish(sample);
    await pending;
    expect(
        host.querySelector(".hub-scoped-graph")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(host.textContent).not.toContain("Alpha · Casey");
});

test("preserves selected corpus and qualified node identity in support reads", async () => {
    scope = "a";
    await mounted.show({ view: "entities" });
    button("Alpha · Casey · 2 mentions").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubGraphSupport",
        expect.objectContaining({
            corpusId: "a",
            generation: "g1",
            nodeId,
            pageSize: 50,
        }),
    );
    expect(onRouteChanged).toHaveBeenCalledWith("entities", nodeId);
});

test("topic hierarchy and co-occurrence remain explicitly distinct", async () => {
    await mounted.show({ view: "topics" });
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubGraph",
        expect.objectContaining({ kind: "hierarchy" }),
    );
    select("Topic graph meaning").value = "topics";
    select("Topic graph meaning").dispatchEvent(new Event("change"));
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubGraph",
        expect.objectContaining({ kind: "topics" }),
    );
    expect(host.textContent).toContain("not a topic hierarchy");
    expect(onRouteChanged).toHaveBeenCalledWith("topics");
});

test("event filters preserve conversation, producer and authority semantics", async () => {
    await mounted.show({ view: "entities" });
    host.querySelector<HTMLInputElement>(
        'input[aria-label="Conversation ID"]',
    )!.value = "conversation-1";
    host.querySelector<HTMLInputElement>(
        'input[aria-label="Event producer ID"]',
    )!.value = "producer-1";
    select("Event authority").value = "verified-observation";
    select("Graph evidence kinds").value = "event";
    button("Apply graph filters").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubGraph",
        expect.objectContaining({
            evidenceKinds: ["event"],
            eventFilter: {
                conversationIds: ["conversation-1"],
                producerIds: ["producer-1"],
                authorities: ["verified-observation"],
            },
        }),
    );
});

test("reports partial and building coverage rather than claiming complete empty memory", async () => {
    invoke.mockResolvedValue({
        ...sample,
        corpora: [
            {
                ...sample.corpora[0],
                graph: {
                    ...sample.corpora[0].graph,
                    state: "building",
                    coverage: {
                        ...sample.corpora[0].graph.coverage,
                        reasons: ["Event projection is not ready."],
                    },
                    nodes: [],
                },
            },
        ],
        errors: [{ corpusId: "b", message: "Unavailable" }],
        omittedCorpora: 2,
    });
    await mounted.show({ view: "entities" });
    expect(host.textContent).toContain("Alpha: building");
    expect(host.textContent).toContain("Event projection is not ready.");
    expect(host.textContent).toContain("b: Unavailable");
    expect(host.textContent).toContain("2 corpora omitted");
});

test("coverage distinguishes eligible and indexed documents and events from inventory totals", async () => {
    invoke.mockResolvedValue({
        ...sample,
        corpora: [
            {
                ...sample.corpora[0],
                graph: {
                    ...sample.corpora[0].graph,
                    state: "building",
                    coverage: {
                        documents: {
                            state: "building",
                            total: 10,
                            eligible: 4,
                            indexed: 2,
                        },
                        events: {
                            state: "stale",
                            total: 12,
                            eligible: 8,
                            indexed: 7,
                        },
                        topics: { state: "building", generation: "topics-v1" },
                        reasons: [],
                    },
                },
            },
        ],
    });
    await mounted.show({ view: "entities" });
    expect(host.textContent).toContain(
        "documents building: 2 of 4 eligible indexed (10 total)",
    );
    expect(host.textContent).toContain(
        "events stale: 7 of 8 eligible indexed (12 total)",
    );
    expect(host.textContent).toContain("topics building");
});

test("loads exact event evidence without document reads or timeline capability calls", async () => {
    invoke.mockImplementation((method) => {
        if (method === "memoryHubGraph") return Promise.resolve(sample);
        if (method === "memoryHubGraphSupport")
            return Promise.resolve({
                generation: "g1",
                total: 1,
                items: [
                    {
                        kind: "event",
                        corpusId: "a",
                        eventId: "e1",
                        title: "Original turn",
                        eventTime: "2026-10-24T00:00:00Z",
                        sender: "assistant",
                        authority: "evidence-only",
                    },
                ],
            });
        if (method === "memoryHubGraphEvent")
            return Promise.resolve({
                title: "Original turn",
                content: '{"content":"Event evidence"}',
                offset: 0,
                totalChars: 28,
            });
        throw new Error(`Unexpected event evidence call: ${method}`);
    });
    await mounted.show({ view: "entities" });
    button("Alpha · Casey · 2 mentions").click();
    await settle();
    expect(host.textContent).toContain("evidence-only");
    button("Original turn").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubGraphEvent", {
        corpusId: "a",
        eventId: "e1",
        offset: 0,
    });
    expect(host.textContent).toContain("Event evidence");
});

test("support from a different generation is rejected before rendering", async () => {
    invoke.mockImplementation((method) => {
        if (method === "memoryHubGraph") return Promise.resolve(sample);
        if (method === "memoryHubGraphSupport")
            return Promise.resolve({
                generation: "g2",
                total: 1,
                items: [
                    {
                        kind: "document",
                        corpusId: "a",
                        sourceId: "source",
                        revisionId: "revision",
                        title: "Unexpected support",
                    },
                ],
            });
        throw new Error(`Unexpected graph call: ${method}`);
    });
    await mounted.show({ view: "entities" });
    button("Alpha · Casey · 2 mentions").click();
    await settle();
    expect(host.textContent).toContain("Graph generation changed");
    expect(host.textContent).not.toContain("Unexpected support");
    expect(onError).toHaveBeenCalled();
});

test("failed graph reads have an explicit error and retry control", async () => {
    invoke.mockRejectedValueOnce(new Error("Projection unavailable"));
    await mounted.show({ view: "entities" });
    expect(host.textContent).toContain("Projection unavailable");
    expect(host.textContent).toContain("Retry with Refresh graph");
    expect(onError).toHaveBeenCalledTimes(1);
    button("Refresh graph").click();
    await settle();
    expect(host.textContent).toContain("Alpha · Casey");
});

test("support paging stays generation-bound and failed pages can be retried", async () => {
    let supportCalls = 0;
    invoke.mockImplementation((method) => {
        if (method === "memoryHubGraph") return Promise.resolve(sample);
        if (method === "memoryHubGraphSupport") {
            supportCalls++;
            if (supportCalls === 2)
                return Promise.reject(
                    new Error("Evidence temporarily unavailable"),
                );
            return Promise.resolve({
                generation: "g1",
                items: [],
                total: 51,
                ...(supportCalls === 1
                    ? { nextContinuationToken: "page-2" }
                    : {}),
            });
        }
        throw new Error(`Unexpected support call: ${method}`);
    });
    await mounted.show({ view: "entities" });
    button("Alpha · Casey · 2 mentions").click();
    await settle();
    button("Next support page").click();
    await settle();
    expect(host.textContent).toContain("Evidence temporarily unavailable");
    button("Retry evidence").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubGraphSupport",
        expect.objectContaining({
            corpusId: "a",
            generation: "g1",
            nodeId,
            continuationToken: "page-2",
            pageSize: 50,
        }),
    );
    expect(host.textContent).not.toContain("Evidence temporarily unavailable");
});

test("document evidence retains exact revision and locator rather than reading current source", async () => {
    invoke.mockImplementation((method) => {
        if (method === "memoryHubGraph") return Promise.resolve(sample);
        if (method === "memoryHubGraphSupport")
            return Promise.resolve({
                generation: "g1",
                total: 1,
                items: [
                    {
                        kind: "document",
                        corpusId: "a",
                        sourceId: "doc",
                        revisionId: "revision-2",
                        locator: "lines:2-4",
                        title: "Document evidence",
                    },
                ],
            });
        if (method === "memoryHubSourceOriginal")
            return Promise.resolve({
                available: true,
                content: "Exact supported passage",
                offset: 0,
                totalChars: 23,
            });
        throw new Error(`Unexpected document call: ${method}`);
    });
    await mounted.show({ view: "entities" });
    button("Alpha · Casey · 2 mentions").click();
    await settle();
    button("Document evidence").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubSourceOriginal", {
        corpusId: "a",
        sourceId: "doc",
        revisionId: "revision-2",
        locator: "lines:2-4",
        offset: 0,
    });
    expect(host.textContent).toContain("Exact supported passage");
    button("Manage source").click();
    expect(onOpenSource).toHaveBeenCalledWith("a", "doc");
});

test.each([
    { current: true, curated: false },
    { current: false, curated: false },
    { current: true, curated: true },
    { current: false, curated: true },
])(
    "maintained summaries load lazily and reject changed snapshots (current=$current, curated=$curated)",
    async ({ current, curated }) => {
        const topicId = curated ? "concept:one" : "topic-1";
        invoke.mockImplementation((method) => {
            if (method === "memoryHubGraph")
                return Promise.resolve({
                    ...sample,
                    corpora: [
                        {
                            ...sample.corpora[0],
                            graph: {
                                ...sample.corpora[0].graph,
                                nodes: [
                                    {
                                        ...sample.corpora[0].graph.nodes[0],
                                        kind: "topic",
                                        topicId,
                                        summaryState: "pending",
                                    },
                                ],
                                coverage: {
                                    ...sample.corpora[0].graph.coverage,
                                    topics: {
                                        state: "ready",
                                        generation: "topic-g1",
                                    },
                                },
                            },
                        },
                    ],
                });
            if (method === "memoryHubGraphSupport")
                return Promise.resolve({
                    generation: "g1",
                    items: [],
                    total: 0,
                });
            if (method === "memoryQueryTopics")
                return Promise.resolve({
                    generation: current ? "topic-g1" : "topic-g2",
                    nodes: curated
                        ? []
                        : [
                              {
                                  id: "topic-1",
                                  summary: "Maintained summary content",
                                  summaryState: "ready",
                                  scope: "project",
                                  limits: [],
                              },
                          ],
                    concepts: curated
                        ? [
                              {
                                  id: topicId,
                                  summary: "Maintained summary content",
                                  summaryState: "ready",
                                  scope: "project",
                              },
                          ]
                        : undefined,
                    limits: [],
                });
            throw new Error(`Unexpected maintained topic call: ${method}`);
        });
        await mounted.show({ view: "topics" });
        expect(invoke).not.toHaveBeenCalledWith(
            "memoryQueryTopics",
            expect.anything(),
        );
        button("Alpha · Casey · 2 mentions · summary pending").click();
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryQueryTopics", {
            corpusId: "a",
            topicId,
            ...(curated ? { curated: true, summarize: true } : { depth: 0 }),
            pageSize: 1,
        });
        if (current) {
            expect(host.textContent).toContain("Maintained summary content");
            expect(host.textContent).toContain("Generated summary · ready");
            expect(onError).not.toHaveBeenCalled();
        } else {
            expect(host.textContent).toContain("Topic snapshot changed");
            expect(host.textContent).not.toContain(
                "Maintained summary content",
            );
            expect(onError).toHaveBeenCalledTimes(1);
        }
    },
);

test("closing the graph invalidates outstanding evidence reads", async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementation((method) =>
        method === "memoryHubGraph"
            ? Promise.resolve(sample)
            : new Promise((resolve) => (finish = resolve)),
    );
    await mounted.show({ view: "entities" });
    button("Alpha · Casey · 2 mentions").click();
    mounted.hide();
    finish({ items: [{ title: "Stale secret" }], total: 1 });
    await settle();
    expect(host.textContent).not.toContain("Stale secret");
    expect(onError).not.toHaveBeenCalled();
});
