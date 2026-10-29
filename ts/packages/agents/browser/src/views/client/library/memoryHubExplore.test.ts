// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryHubExploreResult } from "@typeagent/browser-control-rpc/viewRpc";
import { mountMemoryHubExplore } from "./memoryHubExplore";
import { invokeView } from "./viewClient";

jest.mock("./memoryHubPhase2.css", () => ({}));
jest.mock("./memoryKnowledgeCollection.css", () => ({}));
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
const invoke = invokeView as jest.Mock;
let host: HTMLElement;
let mounted: ReturnType<typeof mountMemoryHubExplore>;
let scope: string | undefined;
let onSource: jest.Mock;
let onError: jest.Mock;
function result(
    overrides: Partial<MemoryHubExploreResult> = {},
): MemoryHubExploreResult {
    return {
        corpora: [],
        counts: {
            sources: 120,
            entities: 80,
            topics: 8,
            relationships: 20,
            procedures: 11,
        },
        entities: [
            {
                id: "e1",
                name: "<b>Worker</b>",
                types: ["service"],
                mentionCount: 7,
                sources: [{ corpusId: "a", sourceId: "same" }],
            },
            {
                id: "e2",
                name: "Queue",
                types: [],
                mentionCount: 5,
                sources: [{ corpusId: "b", sourceId: "same" }],
            },
        ],
        topics: [
            {
                id: "t1",
                name: "Operations",
                mentionCount: 4,
                sources: [{ corpusId: "a", sourceId: "same" }],
            },
        ],
        relationships: [
            {
                id: "r1",
                fromId: "e1",
                toId: "e2",
                type: "reads",
                count: 3,
                sources: [{ corpusId: "b", sourceId: "same" }],
            },
        ],
        omittedEntities: 78,
        errors: [],
        ...overrides,
    };
}
function click(label: string) {
    const button = Array.from(host.querySelectorAll("button")).find(
        (value) => value.textContent === label,
    );
    if (!button) throw new Error(`Button not found: ${label}`);
    button.click();
}
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}

test("Overview mounts production topic browsing with the selected corpus RPC scope", async () => {
    invoke.mockResolvedValue({
        generation: null,
        nodes: [],
        parents: [],
        related: [],
        neighborhoods: [],
        totalNodes: 0,
        matchingNodes: 0,
        omittedNodes: 0,
        omittedParents: 0,
        omittedRelated: 0,
        omittedNeighborhoods: 0,
        limits: ["Not yet maintained"],
        io: { stateBytes: 2, snapshotBytes: 4, elapsedMs: 1 },
    });
    click("Browse topics");
    await settle();
    expect(invoke).toHaveBeenCalledWith("memoryQueryTopics", {
        corpusId: "a",
        curated: true,
        search: "",
        pageSize: 24,
    });
    expect(host.textContent).toContain("0 maintained topics");
});
beforeEach(() => {
    invoke.mockReset();
    scope = "a";
    onSource = jest.fn();
    onError = jest.fn();
    host = document.createElement("div");
    document.body.append(host);
    mounted = mountMemoryHubExplore(host, {
        scope: () => scope,
        onOpenSource: onSource,
        onError,
    });
    invoke.mockResolvedValue(result());
});
afterEach(() => {
    mounted.dispose();
    host.remove();
});

test("overview retains counts and corpus-qualified provenance without plotting a combined graph", async () => {
    await mounted.show();
    expect(host.querySelector('[aria-label="Refresh overview"]')).toBeNull();
    expect(invoke).toHaveBeenCalledWith("memoryHubExplore", {
        corpusId: "a",
        maxNodes: 6,
    });

    expect(host.querySelector(".phase2-counts")!.textContent).toContain(
        "120 sources",
    );
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("b")).toBeNull();
    const flyout = host.querySelector<HTMLElement>(".hub-flyout")!;
    expect(flyout.hidden).toBe(true);
    click("<b>Worker</b> · 7 mentions");
    expect(flyout.hidden).toBe(false);
    expect(flyout.querySelector("h2")!.textContent).toBe("<b>Worker</b>");
    flyout
        .querySelector<HTMLButtonElement>(
            '[aria-label="Selected knowledge item sources"] .knowledge-item-title',
        )!
        .click();
    expect(onSource).toHaveBeenCalledWith("a", "same");
    expect(flyout.hidden).toBe(true);
    click("Queue · 5 mentions");
    flyout
        .querySelector<HTMLButtonElement>(
            '[aria-label="Selected knowledge item sources"] .knowledge-item-title',
        )!
        .click();
    expect(onSource).toHaveBeenLastCalledWith("b", "same");
    expect(host.querySelector("a")).toBeNull();
});

test("event-aware Overview cards open lazy graph support instead of fake document sources", async () => {
    const data = result();
    const support = {
        corpusId: "a",
        generation: "g1",
        nodeId: "graph:a:entity:1",
    };
    data.entities[0]!.sources = [];
    data.entities[0]!.graphSupport = support;
    data.sourceInventory = "documents";
    invoke.mockImplementation((method) => {
        if (method === "memoryHubExplore") return Promise.resolve(data);
        if (method === "memoryHubGraphSupport")
            return Promise.resolve({ generation: "g1", total: 0, items: [] });
        throw new Error(`Unexpected event overview call: ${method}`);
    });
    await mounted.show();
    click("<b>Worker</b> · 7 mentions");
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubGraphSupport", {
        ...support,
        pageSize: 50,
    });
    expect(onSource).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Document sources");
    expect(onError).not.toHaveBeenCalled();
});

test("bounded previews retain real totals and cached navigation avoids refetch", async () => {
    await mounted.show();
    expect(host.querySelector(".phase2-counts")!.textContent).toContain(
        "80 entities",
    );
    const calls = invoke.mock.calls.length;
    await mounted.show();
    expect(invoke.mock.calls).toHaveLength(calls);
    expect(host.querySelectorAll("li")).toHaveLength(0);
});

test("View all browses the complete selected scope rather than expanding a graph limit", async () => {
    await mounted.show();
    invoke.mockResolvedValueOnce({ items: [], total: 6000, errors: [] });
    click("View all derived entities");
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubKnowledge", {
        corpusId: "a",
        kind: "entities",
        offset: 0,
        pageSize: 24,
        query: "",
        sort: "mentions",
    });
    const flyout = host.querySelector<HTMLElement>(".hub-flyout")!;
    expect(flyout.hidden).toBe(false);
    expect(flyout.textContent).toContain("6000 matching items");
    expect(flyout.querySelector("h2")!.textContent).toBe("Derived entities");
    flyout.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
    expect(flyout.hidden).toBe(true);
    expect(host.querySelector("svg")).toBeNull();
});

test("partial overview counts and transport failures are distinguished from healthy empty knowledge", async () => {
    invoke.mockResolvedValueOnce(
        result({
            entities: [],
            topics: [],
            relationships: [],
            errors: [
                { corpusId: "b", operation: "graph", message: "unavailable" },
            ],
        }),
    );
    await mounted.show();
    expect(host.querySelector(".phase2-warning")!.textContent).toContain(
        "only responding corpora",
    );
    expect(host.textContent).toContain("not a complete empty result");
    mounted.scopeChanged();
    invoke.mockRejectedValueOnce(new Error("offline"));
    await mounted.show();
    expect(host.querySelector(".phase2-status")!.textContent).toContain(
        "Explore unavailable: offline",
    );
    expect(onError).toHaveBeenCalled();
});

test("scope changes invalidate late overview responses and reset progressive limits", async () => {
    let resolveOld!: (value: MemoryHubExploreResult) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolveOld = resolve;
            }),
    );
    const pending = mounted.show();
    scope = "b";
    mounted.scopeChanged();
    invoke.mockResolvedValueOnce(
        result({
            entities: [],
            topics: [],
            relationships: [],
            omittedEntities: 0,
        }),
    );
    await mounted.show();
    resolveOld(result());
    await pending;
    expect(invoke).toHaveBeenLastCalledWith("memoryHubExplore", {
        corpusId: "b",
        maxNodes: 6,
    });
    expect(host.querySelector("svg")).toBeNull();
    expect(host.textContent).toContain("No derived knowledge in this scope");
});

test("dispose detaches the view and ignores outstanding responses", async () => {
    let resolve!: (value: MemoryHubExploreResult) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const pending = mounted.show();
    mounted.dispose();
    resolve(result());
    await pending;
    expect(host.children).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
});
