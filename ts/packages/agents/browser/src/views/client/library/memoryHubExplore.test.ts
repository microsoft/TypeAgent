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
    expect(invoke).toHaveBeenCalledWith("memoryHubExplore", {
        corpusId: "a",
        maxNodes: 6,
    });
    expect(host.querySelector(".phase2-counts")!.textContent).toContain(
        "120 sources",
    );
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector("b")).toBeNull();
    click("<b>Worker</b> · 7 mentions");
    const selected = host.querySelector(
        '[aria-label="Selected knowledge item sources"]',
    )!;
    selected.querySelector<HTMLButtonElement>(".knowledge-item-title")!.click();
    expect(onSource).toHaveBeenCalledWith("a", "same");
    click("Queue · 5 mentions");
    selected.querySelector<HTMLButtonElement>(".knowledge-item-title")!.click();
    expect(onSource).toHaveBeenLastCalledWith("b", "same");
    expect(host.querySelector("a")).toBeNull();
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
    expect(host.textContent).toContain("6000 matching items");
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
