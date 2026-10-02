// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountKnowledgeCollection } from "./memoryKnowledgeCollection";
import type {
    MemoryHubKnowledgeItem,
    MemoryHubKnowledgePage,
} from "@typeagent/browser-control-rpc/viewRpc";
jest.mock("./memoryKnowledgeCollection.css", () => ({}));
const items: MemoryHubKnowledgeItem[] = Array.from(
    { length: 3000 },
    (_, index) => ({
        id: String(index),
        title: `Entity ${String(index).padStart(4, "0")}`,
        mentions: 3000 - index,
        sources: [],
    }),
);
let host: HTMLElement;
let mounted: ReturnType<typeof mountKnowledgeCollection>;
let onError: jest.Mock;
function click(label: string) {
    const node = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
    );
    if (!node) throw new Error(`Missing button ${label}`);
    node.click();
}
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}
beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    onError = jest.fn();
});
afterEach(() => {
    mounted.dispose();
    host.remove();
});

test("thousands of local items render only six preview or 24 paged cards, with filtering across all items", async () => {
    mounted = mountKnowledgeCollection(host, {
        title: "Entities",
        items,
        onError,
    });
    expect(host.querySelectorAll(".knowledge-item")).toHaveLength(6);
    click("View all entities");
    await settle();
    expect(host.querySelectorAll(".knowledge-item")).toHaveLength(24);
    expect(host.textContent).toContain("1–24 of 3000");
    host.querySelector<HTMLElement>(".knowledge-cards")!.scrollTop = 100;
    click("Next");
    await settle();
    expect(host.querySelector<HTMLElement>(".knowledge-cards")!.scrollTop).toBe(
        0,
    );
    expect(host.textContent).toContain("25–48 of 3000");
    host.querySelector<HTMLInputElement>("input")!.value = "2999";
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(host.querySelectorAll(".knowledge-item")).toHaveLength(1);
    expect(host.textContent).toContain("1–1 of 1");
    expect(host.textContent).toContain("Entity 2999");
    click("Back to preview");
    expect(host.querySelectorAll(".knowledge-item")).toHaveLength(6);
});

test("remote pages receive server filtering, sorting and offsets; bounded previews never fetch", async () => {
    const loadPage = jest.fn(async (request) => ({
        items: items.slice(request.offset, request.offset + request.pageSize),
        total: 3000,
        errors: [],
    }));
    mounted = mountKnowledgeCollection(host, {
        title: "Entities",
        items: items.slice(0, 6),
        total: 3000,
        loadPage,
        onError,
    });
    expect(loadPage).not.toHaveBeenCalled();
    click("View all entities");
    await settle();
    click("Next");
    await settle();
    expect(loadPage).toHaveBeenLastCalledWith({
        offset: 24,
        pageSize: 24,
        query: "",
        sort: "mentions",
    });
    host.querySelector<HTMLInputElement>("input")!.value = "worker";
    host.querySelector<HTMLSelectElement>("select")!.value = "name";
    click("Apply filter");
    await settle();
    expect(loadPage).toHaveBeenLastCalledWith({
        offset: 0,
        pageSize: 24,
        query: "worker",
        sort: "name",
    });
});

test("late page responses and detached card actions cannot replace preview or act after disposal", async () => {
    let resolve!: (page: MemoryHubKnowledgePage) => void;
    const onSelect = jest.fn();
    mounted = mountKnowledgeCollection(host, {
        title: "Entities",
        items,
        onError,
        onSelect,
        loadPage: () =>
            new Promise((done) => {
                resolve = done;
            }),
    });
    const detached = host.querySelector<HTMLButtonElement>(
        ".knowledge-item-title",
    )!;
    click("View all entities");
    click("Back to preview");
    resolve({ items: items.slice(100, 124), total: 3000, errors: [] });
    await settle();
    expect(host.querySelectorAll(".knowledge-item")).toHaveLength(6);
    expect(host.textContent).not.toContain("Entity 0100");
    detached.click();
    expect(onSelect).not.toHaveBeenCalled();
    mounted.dispose();
    expect(host.children).toHaveLength(0);
});

test("a shrinking collection returns to a valid page rather than displaying an impossible range", async () => {
    const loadPage = jest
        .fn()
        .mockResolvedValueOnce({
            items: items.slice(0, 24),
            total: 50,
            errors: [],
        })
        .mockResolvedValueOnce({ items: [], total: 10, errors: [] })
        .mockResolvedValueOnce({
            items: items.slice(0, 10),
            total: 10,
            errors: [],
        });
    mounted = mountKnowledgeCollection(host, {
        title: "Entities",
        items,
        loadPage,
        onError,
    });
    click("View all entities");
    await settle();
    click("Next");
    await settle();
    expect(loadPage).toHaveBeenLastCalledWith({
        offset: 0,
        pageSize: 24,
        query: "",
        sort: "mentions",
    });
    expect(host.textContent).toContain("1–10 of 10");
    expect(host.textContent).not.toContain("25–24");
});

test("partial results, healthy no matches and transport failure stay distinct and text is escaped", async () => {
    const loadPage = jest
        .fn()
        .mockResolvedValueOnce({
            items: [{ id: "unsafe", title: "<img src=x>", sources: [] }],
            total: 1,
            errors: [{ corpusId: "a", operation: "graph", message: "offline" }],
        })
        .mockResolvedValueOnce({ items: [], total: 0, errors: [] })
        .mockRejectedValueOnce(new Error("disconnected"));
    mounted = mountKnowledgeCollection(host, {
        title: "Entities",
        items: [],
        loadPage,
        onError,
    });
    click("View all entities");
    await settle();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Partial results");
    click("Apply filter");
    await settle();
    expect(host.textContent).toContain("No matching items");
    expect(
        host.querySelector<HTMLElement>(".knowledge-collection-warning")!
            .hidden,
    ).toBe(true);
    click("Apply filter");
    await settle();
    expect(host.textContent).toContain("Knowledge unavailable: disconnected");
    expect(onError).toHaveBeenCalled();
});
