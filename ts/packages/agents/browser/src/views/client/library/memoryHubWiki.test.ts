// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    WikiContent,
    ViewRelationshipInput,
} from "@typeagent/memory-service";
import { createWikiEditor } from "./memoryHubWiki";
import { mountMemoryHubViews } from "./memoryHubViews";
import { createViewBuildTargets } from "./memoryHubViewBuild";
import { invokeMemory, invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const citation = {
    sourceId: "s",
    revisionId: "r",
    locator: `indexed:0:${"a".repeat(64)}:0-12`,
    excerpt: "Pool blocked",
};
const content: WikiContent = {
    kind: "wiki",
    construction: "informational-wiki-v1",
    status: "partial",
    coverageNote: "Only selected indexed evidence",
    title: "Payments wiki",
    summary:
        "Limited summary: selected indexed fragments only; unresolved explanations",
    citations: [citation],
    index: [{ pageId: "pool", title: "Pool pressure", taxonomy: "concept" }],
    sections: [
        {
            id: "pool",
            role: "page",
            heading: "Pool pressure",
            body: "Pool blocked; reporting explanation rejected; contradictions unresolved. [[not-an-edge]]",
            details: {
                kind: "page",
                construction: "informational-wiki-v1",
                taxonomy: "concept",
                note: "",
                mergedPageIds: [],
            },
        },
    ],
};
const edges: ViewRelationshipInput[] = [
    {
        id: "source-link",
        predicate: "supportedBy",
        from: { kind: "section", viewId: "wiki", sectionId: "pool" },
        to: { kind: "source", sourceId: "s", revisionId: "r" },
        citations: [citation],
    },
];
const retrieval = {
    construction: "informational-wiki-v1" as const,
    query: "pool pressure",
    aliases: ["pool"],
    excludedSourceIds: [],
};
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

test("indexed reader/editor retains identity, title, category, note, citations and exclusions without bundle controls", () => {
    const changed = jest.fn();
    const evidence = jest.fn();
    const editor = createWikiEditor(
        content,
        edges,
        changed,
        evidence,
        retrieval,
    );
    document.body.replaceChildren(editor.element);
    expect(editor.element.textContent).toContain("Completeness: partial");
    expect(editor.element.textContent).toContain(
        "Coverage: Only selected indexed evidence",
    );
    expect(editor.element.querySelector("fieldset")!.hidden).toBe(true);
    expect(editor.element.textContent).toContain("contradictions unresolved");
    expect(editor.element.querySelectorAll("a")).toHaveLength(0);
    click(editor.element, "Pool pressure (concept)");
    expect(document.activeElement?.textContent).toBe("Pool pressure");
    click(editor.element, "Edit selected wiki page");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
        "Wiki title",
    );
    const title = editor.element.querySelector<HTMLInputElement>(
        '[aria-label="Page title pool"]',
    )!;
    title.value = "Renamed pressure";
    title.dispatchEvent(new Event("input"));
    const note = editor.element.querySelector<HTMLTextAreaElement>(
        '[aria-label="Personal note"]',
    )!;
    note.value = "Personal qualification";
    note.dispatchEvent(new Event("input"));
    const category = editor.element.querySelector<HTMLSelectElement>(
        '[aria-label="Page category"]',
    )!;
    category.value = "system";
    category.dispatchEvent(new Event("change"));
    const exclude = editor.element.querySelector<HTMLInputElement>(
        '[aria-label="Exclude source s"]',
    )!;
    exclude.checked = true;
    exclude.dispatchEvent(new Event("change"));
    expect(editor.read().index).toEqual([
        { pageId: "pool", title: "Renamed pressure", taxonomy: "system" },
    ]);
    expect(editor.read().sections[0].details.note).toBe(
        "Personal qualification",
    );
    expect(editor.retrieval()).toEqual({
        ...retrieval,
        excludedSourceIds: ["s"],
    });
    click(editor.element, `s @ r ${citation.locator}`);
    expect(evidence).toHaveBeenCalledWith(citation);
    expect(editor.relationships()).toEqual(edges);
    expect(content.sections[0].heading).toBe("Pool pressure");
    expect(retrieval.excludedSourceIds).toEqual([]);
    expect(editor.element.textContent).not.toContain("Merge selected");
    expect(editor.element.textContent).not.toContain("Omit selected");
});

test("obsolete content and unindexed creation reject explicitly", () => {
    const old = JSON.parse(JSON.stringify(content));
    delete old.construction;
    expect(() => createWikiEditor(old, edges, jest.fn(), jest.fn())).toThrow(
        "indexed informational page",
    );
    expect(() =>
        createViewBuildTargets(
            ["wiki"],
            new Map([["wiki", "wiki"]]),
            [{ sourceId: "s", revisionId: "r" }],
            [],
            [],
        ),
    ).toThrow("indexed informational family");
});

test("Memory Hub saves source exclusions with the indexed definition and exposes family creation instead of full-source wiki creation", async () => {
    invoke.mockReset();
    invoke.mockImplementation(async (method) => {
        if (method === "memoryListCorpora")
            return [{ corpusId: "c", name: "Synthetic collection" }];
        if (method === "memoryViewCapabilities")
            return {
                derivedViews: {
                    builds: true,
                    kinds: ["wiki"],
                    informationalWiki: true,
                },
            };
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
                        relationships: edges,
                        definition: {
                            viewId: "wiki",
                            kind: "wiki",
                            selector: {
                                kind: "sources",
                                sources: [{ sourceId: "s", revisionId: "r" }],
                            },
                            wiki: retrieval,
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
        throw new Error(`Unexpected informational client call ${method}`);
    });
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const onError = jest.fn();
    const mounted = mountMemoryHubViews(host, { scope: () => "c", onError });
    try {
        await mounted.refresh();
        await settle();
        click(host, "Payments wiki");
        click(host, "Edit");
        click(host, "Edit selected wiki page");
        const excluded = host.querySelector<HTMLInputElement>(
            '[aria-label="Exclude source s"]',
        )!;
        excluded.checked = true;
        excluded.dispatchEvent(new Event("change"));
        click(host, "Save explicit edits");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memorySaveViewDraft",
            expect.objectContaining({
                definition: expect.objectContaining({
                    wiki: { ...retrieval, excludedSourceIds: ["s"] },
                }),
            }),
        );
        expect(onError).not.toHaveBeenCalled();
    } finally {
        mounted.dispose();
        (invokeView as jest.Mock).mockReset();
    }
});
