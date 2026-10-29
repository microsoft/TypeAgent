// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hubNotifications } from "./memoryHubNotifications";
import { mountMemoryHubGraph } from "./memoryHubGraph";
import { invokeView } from "./viewClient";
import type { MemoryHubGraphResult } from "@typeagent/browser-control-rpc/viewRpc";

jest.mock("./memoryHubGraph.css", () => ({}));
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
jest.mock("./entityGraphVisualizer", () => ({
    EntityGraphVisualizer: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        loadGlobalGraph: jest.fn().mockResolvedValue(undefined),
        onEntityClick: mockEntityClick,
        onEdgeClick: mockEdgeClick,
        fitToView: mockFitToView,
        resize: jest.fn(),
        destroy: jest.fn(),
    })),
}));
jest.mock("./topicGraphVisualizer", () => ({
    TopicGraphVisualizer: jest.fn().mockImplementation(() => ({
        init: jest.fn().mockResolvedValue(undefined),
        onTopicClick: mockTopicClick,
        onEdgeClick: mockEdgeClick,
        fitToView: mockFitToView,
        resize: jest.fn(),
        dispose: jest.fn(),
    })),
}));

const invoke = invokeView as jest.Mock;
const mockEntityClick = jest.fn();
const mockTopicClick = jest.fn();
const mockEdgeClick = jest.fn();
const mockFitToView = jest.fn();
const nodeId = `graph:a:entity:${"1".repeat(32)}`;
const sample: MemoryHubGraphResult = {
    corpora: [
        {
            corpusId: "a",
            corpusName: "Alpha",
            graph: {
                generation: "g1",
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
        (element) =>
            element.getAttribute("aria-label") === label ||
            element.textContent === label,
    );
    if (!value) throw new Error(`Missing button: ${label}`);
    return value;
}
function select(label: string) {
    return host.querySelector<HTMLSelectElement>(
        `select[aria-label="${label}"]`,
    )!;
}
function clickNode(view: "entities" | "topics" = "entities") {
    const listener = view === "entities" ? mockEntityClick : mockTopicClick;
    listener.mock.calls[0][0]({ id: nodeId });
}

beforeEach(() => {
    host = document.createElement("div");
    document.body.replaceChildren(host);
    scope = undefined;
    onError = jest.fn();
    onOpenSource = jest.fn();
    onRouteChanged = jest.fn();
    invoke.mockReset();
    mockEntityClick.mockClear();
    mockTopicClick.mockClear();
    mockEdgeClick.mockClear();
    mockFitToView.mockClear();
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
    expect(host.querySelector(".hub-scoped-graph-canvas")).not.toBeNull();
    expect(onError).not.toHaveBeenCalled();
});

test.each(["entities", "topics"] as const)(
    "%s keeps accessible icon controls inside the graph viewport across refreshes",
    async (view) => {
        await mounted.show({ view });
        const toolbar = host.querySelector('[aria-label="Graph controls"]')!;
        expect(toolbar.getAttribute("role")).toBe("group");
        expect(toolbar.parentElement?.className).toBe("hub-graph-viewport");
        expect(
            toolbar.parentElement?.querySelector(".hub-scoped-graph-canvas"),
        ).not.toBeNull();
        for (const [label, glyph] of [
            ["Refresh graph", "fa-rotate"],
            ["Global graph", "fa-globe"],
            ["Fit graph", "fa-expand"],
            ["Browse graph items", "fa-list"],
        ]) {
            const control = button(label);
            expect(control.title).toBe(label);
            expect(control.type).toBe("button");
            expect(control.classList.contains("icon-btn")).toBe(true);
            expect(control.textContent).toBe("");
            expect(
                control
                    .querySelector(`.fa-solid.${glyph}`)
                    ?.getAttribute("aria-hidden"),
            ).toBe("true");
            expect(toolbar.contains(control)).toBe(true);
        }
        button("Fit graph").click();
        expect(mockFitToView).toHaveBeenCalledTimes(1);
        expect(invoke.mock.calls).toHaveLength(1);
        button("Global graph").click();
        await settle();
        expect(onRouteChanged).toHaveBeenLastCalledWith(
            view === "entities" ? "entities" : "hierarchy",
        );
        expect(invoke.mock.calls).toHaveLength(2);
        expect(invoke.mock.calls[1][1]).not.toHaveProperty("nodeId");
        button("Refresh graph").click();
        await settle();
        expect(invoke.mock.calls).toHaveLength(3);
        expect(host.querySelector('[aria-label="Graph controls"]')).toBe(
            toolbar,
        );
        expect(toolbar.querySelectorAll("button")).toHaveLength(4);
        expect(onError).not.toHaveBeenCalled();
    },
);

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
test.each(["entities", "topics"] as const)(
    "%s offers lazy keyboard-accessible node and relationship selection from the displayed projection",
    async (view) => {
        const edgeId = "graph:a:edge:one";
        invoke.mockResolvedValueOnce({
            ...sample,
            corpora: [
                {
                    ...sample.corpora[0],
                    graph: {
                        ...sample.corpora[0].graph,
                        edges: [
                            {
                                id: edgeId,
                                source: nodeId,
                                target: nodeId,
                                type: "related",
                                count: 1,
                                supportCount: 1,
                            },
                        ],
                    },
                },
            ],
        });
        await mounted.show({ view });
        expect(
            host.querySelector('[aria-label="Graph nodes and relationships"]'),
        ).toBeNull();
        button("Browse graph items").focus();
        button("Browse graph items").click();
        const search = host.querySelector<HTMLInputElement>(
            '[aria-label="Find graph items"]',
        )!;
        const items = select("Graph nodes and relationships");
        expect(document.activeElement).toBe(search);
        expect(items.options).toHaveLength(2);
        expect(items.options[0].textContent).toContain("Node · Alpha · Casey");
        expect(items.options[1].textContent).toContain(
            "Relationship · Alpha · Casey",
        );
        expect(items.value).toBe(nodeId);
        expect(invoke.mock.calls).toHaveLength(1);
        search.value = "not in graph";
        search.dispatchEvent(new Event("input"));
        expect(button("Inspect graph item").disabled).toBe(true);
        expect(host.textContent).toContain("No graph items match");
        search.value = "relationship";
        search.dispatchEvent(new Event("input"));
        expect(items.options).toHaveLength(1);
        expect(items.value).toBe(edgeId);
        button("Inspect graph item").click();
        await settle();
        expect(
            host.querySelector('dialog[aria-label="Graph items"]'),
        ).toBeNull();
        expect(invoke).toHaveBeenLastCalledWith(
            "memoryHubGraphSupport",
            expect.objectContaining({
                corpusId: "a",
                generation: "g1",
                edgeId,
            }),
        );
        button("Browse graph items").click();
        mounted.scopeChanged();
        expect(
            host.querySelector('dialog[aria-label="Graph items"]'),
        ).toBeNull();
        expect(button("Browse graph items").disabled).toBe(true);
    },
);

test.each(["entities", "topics"] as const)(
    "%s shows the graph without coverage, collection inventory or browse disclosures",
    async (view) => {
        await mounted.show({ view });
        const root = host.querySelector(".hub-scoped-graph")!;
        expect(root.textContent).not.toContain("Graph coverage");
        expect(root.textContent).not.toContain(
            "Browse graph nodes and relationships",
        );
        expect(root.textContent).not.toContain("Alpha");
        expect(root.textContent).not.toContain("matching nodes");
        expect(root.textContent).not.toContain("responding corpora");
        expect(
            root.querySelector('[aria-label="Graph inventory pages"]'),
        ).toBeNull();
        expect(root.querySelector(".hub-graph-items")).toBeNull();
        expect(
            [...root.querySelectorAll<HTMLElement>('[role="status"]')].every(
                (element) => element.hidden,
            ),
        ).toBe(true);
        expect(invoke.mock.calls).toHaveLength(1);
        clickNode(view);
        await settle();
        expect(host.textContent).toContain("Alpha · Casey");
        expect(invoke).toHaveBeenLastCalledWith(
            "memoryHubGraphSupport",
            expect.objectContaining({
                corpusId: "a",
                generation: "g1",
                nodeId,
            }),
        );
    },
);

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
    clickNode();
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

test("graph edge selection still loads exact generation-bound evidence", async () => {
    const edgeId = "graph:a:edge:one";
    invoke.mockResolvedValueOnce({
        ...sample,
        corpora: [
            {
                ...sample.corpora[0],
                graph: {
                    ...sample.corpora[0].graph,
                    edges: [
                        {
                            id: edgeId,
                            source: nodeId,
                            target: nodeId,
                            type: "related",
                            count: 1,
                            supportCount: 1,
                        },
                    ],
                },
            },
        ],
    });
    await mounted.show({ view: "entities" });
    expect(invoke.mock.calls).toHaveLength(1);
    mockEdgeClick.mock.calls[0][0](edgeId);
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubGraphSupport",
        expect.objectContaining({
            corpusId: "a",
            generation: "g1",
            edgeId,
            pageSize: 50,
        }),
    );
    expect(onError).not.toHaveBeenCalled();
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
    expect(select("Topic graph meaning").selectedOptions[0].textContent).toBe(
        "Source co-occurrence",
    );
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

test("keeps actual collection failures and omitted collections visible without coverage status", async () => {
    invoke.mockResolvedValue({
        ...sample,
        corpora: [
            {
                ...sample.corpora[0],
                graph: {
                    ...sample.corpora[0].graph,
                    nodes: [],
                },
            },
        ],
        errors: [{ corpusId: "b", message: "Unavailable" }],
        omittedCorpora: 2,
    });
    await mounted.show({ view: "entities" });
    expect(host.textContent).toContain("No nodes in the available projection.");
    expect(host.textContent).not.toContain("b: Unavailable");
    expect(host.textContent).not.toContain("2 corpora omitted");
    const notices = hubNotifications
        .list()
        .flatMap((entry) => entry.messages)
        .join(" ");
    expect(notices).toContain("b: Unavailable");
    expect(notices).toContain("2 corpora omitted");
});

test.each(["entities", "topics"] as const)(
    "%s ignores routine coverage/build messages from older responses",
    async (view) => {
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
                            topics: {
                                state: "building",
                                generation: "topics-v1",
                            },
                            reasons: [
                                "Rebuild topics to populate the hierarchy.",
                            ],
                        },
                    },
                },
            ],
        });
        await mounted.show({ view });
        expect(host.textContent).not.toContain("building");
        expect(host.textContent).not.toContain("eligible indexed");
        expect(host.textContent).not.toContain("Rebuild topics");
        expect(onError).not.toHaveBeenCalled();
    },
);

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
    clickNode();
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
    clickNode();
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
    expect(
        host.querySelector(".hub-scoped-graph")?.getAttribute("aria-busy"),
    ).toBe("false");
    expect(host.textContent).not.toContain("Projection unavailable");
    expect(host.textContent).not.toContain("Graph could not be loaded");
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
    clickNode();
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
    clickNode();
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
                                topicGeneration: "topic-g1",
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
        clickNode("topics");
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
    clickNode();
    mounted.hide();
    finish({ items: [{ title: "Stale secret" }], total: 1 });
    await settle();
    expect(host.textContent).not.toContain("Stale secret");
    expect(onError).not.toHaveBeenCalled();
});
