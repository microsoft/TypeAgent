// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewVersion } from "@typeagent/memory-service";
import { mountMemoryHubViews } from "./memoryHubViews";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;

function click(host: HTMLElement, text: string) {
    const button = [...host.querySelectorAll("button")].find(
        (entry) => entry.textContent === text,
    );
    if (!button) throw new Error(`Missing editorial control ${text}`);
    button.click();
}
async function settle() {
    for (let index = 0; index < 40; index++) await Promise.resolve();
}

test("explicit authenticated unit unlock and current related navigation use existing guarded routes", async () => {
    const content: ViewVersion["content"] = {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: "Deliberate human title",
        summary: "Selected original indexed evidence only",
        citations: [],
        index: [
            {
                pageId: "article",
                title: "Current article",
                taxonomy: "concept",
            },
        ],
        sections: [
            {
                id: "article",
                role: "page",
                heading: "Current article",
                body: "Current original-source explanation",
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "Personal annotation",
                    mergedPageIds: [],
                },
            },
        ],
    };
    const view: ViewVersion = {
        corpusId: "c",
        viewId: "wiki",
        revisionId: "revision",
        version: 2,
        state: "draft",
        actor: "authenticated-owner",
        createdAt: "2026-10-13T16:00:00Z",
        provenance: "human",
        content,
        relationships: [],
        definition: {
            viewId: "wiki",
            revisionId: "definition",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
            wiki: {
                construction: "informational-wiki-v1",
                query: "current article",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        generation: {
            candidateId: "base",
            fingerprint: "a".repeat(64),
            content: { ...content, title: "Generated article" },
        },
        edits: [
            {
                id: "edit",
                target: "title",
                actor: "authenticated-owner",
                createdAt: "2026-10-13T16:00:00Z",
                oldHash: "b".repeat(64),
                operation: "set",
                status: "active",
            },
        ],
        relatedArticles: [
            {
                viewId: "related",
                revisionId: "current-related",
                title: "Related original-source article",
            },
        ],
        protectedTargets: ["title", "section:article:note"],
    };
    const related = {
        ...view,
        viewId: "related",
        revisionId: "current-related",
        content: { ...content, title: "Related original-source article" },
        relatedArticles: [],
    };
    invoke.mockImplementation(async (method) => {
        if (method === "memoryViewCapabilities")
            return {
                derivedViews: {
                    kinds: ["wiki"],
                    builds: true,
                    informationalWiki: true,
                },
            };
        if (method === "memoryListCorpora")
            return [{ corpusId: "c", name: "Offline" }];
        if (method === "memoryListViews")
            return { head: "c".repeat(40), views: [view, related] };
        if (method === "memoryListViewBuilds") return [];
        if (method === "memoryGetViewPublicationPolicy")
            return { revision: 0, autoPublish: true, views: {} };
        if (method === "memoryGetViewPublication")
            return { indexState: "absent", reason: "Draft" };
        if (method === "memorySaveViewDraft") return {};
        throw new Error(`Unexpected editorial client call ${method}`);
    });
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const onError = jest.fn();
    const onOpenView = jest.fn();
    const mounted = mountMemoryHubViews(host, {
        scope: () => "c",
        onError,
        onOpenView,
    });
    try {
        await mounted.refresh();
        await settle();
        click(host, "Deliberate human title");
        expect(
            [...host.querySelectorAll("button")].some(
                (entry) =>
                    entry.textContent ===
                    "Unlock generated updates: section:article:note",
            ),
        ).toBe(true);
        click(host, "Unlock generated updates: title");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memorySaveViewDraft",
            expect.objectContaining({
                corpusId: "c",
                viewId: "wiki",
                expectedVersion: 2,
                expectedHead: "c".repeat(40),
                content,
                relationships: [],
                unlockProtection: ["title"],
            }),
        );
        const sent = invoke.mock.calls.find(
            ([method]) => method === "memorySaveViewDraft",
        )![1];
        expect(sent).not.toHaveProperty("actor");
        click(host, "Related original-source article");
        await settle();
        expect(onOpenView).toHaveBeenCalledWith("c", "related", undefined);
        expect(onError).not.toHaveBeenCalled();
    } finally {
        mounted.dispose();
        invoke.mockReset();
    }
});
