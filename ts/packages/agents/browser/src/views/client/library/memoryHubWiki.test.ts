// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    WikiContent,
    ViewRelationshipInput,
} from "@typeagent/memory-service";
import { createWikiEditor } from "./memoryHubWiki";
import { mountMemoryHubViews } from "./memoryHubViews";
import { invokeMemory, invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const citation = {
    sourceId: "s",
    revisionId: "r",
    locator: "chars:0-12",
    excerpt: "Pool blocked",
};
const content: WikiContent = {
    kind: "wiki",
    title: "Payments wiki",
    summary: "Unresolved explanations",
    citations: [citation],
    index: [
        { pageId: "pool", title: "Pool pressure", taxonomy: "concept" },
        { pageId: "system", title: "Payments", taxonomy: "system" },
    ],
    sections: [
        {
            id: "pool",
            role: "page",
            heading: "Pool pressure",
            body: "Pool blocked; reporting explanation rejected; contradictions unresolved. [[not-an-edge]]",
            details: {
                kind: "page",
                taxonomy: "concept",
                inventoryIds: ["fact"],
                mergedPageIds: [],
            },
        },
        {
            id: "system",
            role: "page",
            heading: "Payments",
            body: "Capacity owner review is blocked.",
            details: {
                kind: "page",
                taxonomy: "system",
                inventoryIds: ["owner"],
                mergedPageIds: [],
            },
        },
    ],
};
const edges: ViewRelationshipInput[] = [
    ...["pool", "system"].map(
        (sectionId): ViewRelationshipInput => ({
            id: `proof-${sectionId}`,
            predicate: "supportedBy",
            from: { kind: "section", viewId: "wiki", sectionId },
            to: { kind: "source", sourceId: "s", revisionId: "r" },
            citations: [citation],
        }),
    ),
    {
        id: "contradiction",
        predicate: "contradicts",
        from: { kind: "section", viewId: "wiki", sectionId: "pool" },
        to: { kind: "section", viewId: "wiki", sectionId: "system" },
        citations: [citation],
    },
];
function click(host: HTMLElement, label: string) {
    const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
    );
    if (!button) throw new Error(`Missing wiki control ${label}`);
    button.click();
}
async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}

test("typed index navigation, reader, named editor, exact proof and focus retain identities without raw-link authority", () => {
    const changed = jest.fn();
    const evidence = jest.fn();
    const editor = createWikiEditor(content, edges, changed, evidence);
    document.body.replaceChildren(editor.element);
    expect(editor.element.querySelector("fieldset")!.hidden).toBe(true);
    expect(
        editor.element.querySelector('nav[aria-label="Wiki page index"]'),
    ).not.toBeNull();
    expect(editor.element.textContent).toContain("contradictions unresolved");
    expect(editor.element.querySelectorAll("a")).toHaveLength(0);
    click(editor.element, "contradicts: Payments");
    expect(document.activeElement?.textContent).toBe("Payments");
    click(editor.element, "Pool pressure (concept)");
    click(editor.element, "Edit selected wiki page");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Wiki title",
    );
    const title = editor.element.querySelector<HTMLInputElement>(
        '[aria-label="Page title pool"]',
    )!;
    title.value = "Renamed pressure";
    title.dispatchEvent(new Event("input"));
    expect(editor.read().index[0]).toEqual({
        pageId: "pool",
        title: "Renamed pressure",
        taxonomy: "concept",
    });
    expect(
        editor.relationships().find((edge) => edge.id === "contradiction")!.from
            .sectionId,
    ).toBe("pool");
    click(editor.element, "s @ r chars:0-12");
    expect(evidence).toHaveBeenCalledWith(citation);
    expect(content.sections[0].heading).toBe("Pool pressure");
    expect(editor.element.textContent).not.toContain("Activate skill");
});

test("merge retains facts, citation union, target identity and retired IDs; no dangling or self edge remains", () => {
    const editor = createWikiEditor(content, edges, jest.fn(), jest.fn());
    document.body.replaceChildren(editor.element);
    click(editor.element, "Edit selected wiki page");
    click(editor.element, "Merge selected page into target");
    const merged = editor.read();
    expect(merged.sections).toHaveLength(1);
    expect(merged.index).toEqual([
        { pageId: "system", title: "Payments", taxonomy: "system" },
    ]);
    expect(merged.sections[0].details).toMatchObject({
        inventoryIds: ["owner", "fact"],
        mergedPageIds: ["pool"],
    });
    expect(merged.sections[0].body).toContain("reporting explanation rejected");
    expect(merged.sections[0].body).toContain("owner review is blocked");
    expect(editor.relationships()).toHaveLength(1);
    expect(editor.relationships()[0]).toMatchObject({
        from: { sectionId: "system" },
        citations: [citation],
    });
    expect(document.activeElement?.textContent).toBe("Payments");
});

test("Memory Hub creates and saves wiki through real typed client methods, not raw JSON or execution controls", async () => {
    invoke.mockImplementation(async (method) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { builds: true, kinds: ["wiki"] } };
        if (method === "memoryListViews")
            return {
                head: "a".repeat(40),
                views: [
                    {
                        corpusId: "c",
                        viewId: "wiki",
                        revisionId: "v",
                        version: 1,
                        state: "draft",
                        provenance: "generated",
                        content,
                        relationships: edges.map((edge) => ({
                            ...edge,
                            origin: "generator",
                        })),
                        definition: {
                            viewId: "wiki",
                            kind: "wiki",
                            selector: {
                                kind: "sources",
                                sources: [{ sourceId: "s", revisionId: "r" }],
                            },
                        },
                    },
                ],
            };
        if (method === "memoryListViewBuilds") return [];
        if (method === "memoryGetViewPublicationPolicy")
            return { revision: 0, autoPublish: true, views: {} };
        if (method === "memoryGetViewPublication")
            return { viewId: "wiki", indexState: "absent", reason: "Draft" };
        if (method === "memoryListSources") return { items: [], total: 0 };
        if (method === "memorySaveViewDraft") return {};
        throw new Error(`Unexpected wiki client call ${method}`);
    });
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const error = jest.fn();
    const mounted = mountMemoryHubViews(host, {
        scope: () => "c",
        onError: error,
    });
    await mounted.refresh();
    await settle();
    expect(
        host.querySelector<HTMLOptionElement>('option[value="wiki"]')!
            .textContent,
    ).toBe("Knowledge wiki");
    click(host, "Payments wiki (draft, v1)");
    expect(host.querySelector('[aria-label="Typed relationships"]')).toBeNull();
    click(host, "Edit selected wiki page");
    const title = host.querySelector<HTMLInputElement>(
        '[aria-label="Page title pool"]',
    )!;
    title.value = "Named human page";
    title.dispatchEvent(new Event("input"));
    click(host, "Save explicit edits");
    await settle();
    expect(invoke).toHaveBeenCalledWith(
        "memorySaveViewDraft",
        expect.objectContaining({
            content: expect.objectContaining({
                kind: "wiki",
                index: expect.arrayContaining([
                    {
                        pageId: "pool",
                        title: "Named human page",
                        taxonomy: "concept",
                    },
                ]),
            }),
            relationships: edges,
        }),
    );
    expect(error).not.toHaveBeenCalled();
    mounted.dispose();
    (invokeView as jest.Mock).mockReset();
});
