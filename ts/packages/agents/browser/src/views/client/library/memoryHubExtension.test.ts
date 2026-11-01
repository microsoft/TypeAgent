// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderExtensionView } from "./memoryHubExtension";
import { renderDerivedViewModule } from "@typeagent/memory-client/derived-view-presentation";
import { parseRoute } from "./memoryHubModel";
import type {
    ViewVersion,
    UnderstandingModuleResult,
} from "@typeagent/memory-service";

const identity = {
    providerId: "synthetic",
    version: "1",
    implementationDigest: "a".repeat(64),
    inputContract: "input-v1",
    outputContract: "output-v1",
    schemaDigest: "b".repeat(64),
    recipeDigest: "c".repeat(64),
};
const source = {
    sourceId: "original",
    revisionId: "original-revision",
    locator: "chars:0-10",
    excerpt: "Exact text",
};
const layouts = ["story", "roles", "brief", "sources"].map((id) => ({
    id,
    label: id,
    groups: [{ id: `${id}-group`, label: id, blockIds: ["claim"] }],
}));
const view: ViewVersion = {
    corpusId: "private-corpus",
    viewId: "extension:synthetic",
    revisionId: "revision:one",
    version: 1,
    state: "draft",
    createdAt: "2026-10-31T00:00:00Z",
    actor: "synthetic",
    provenance: "generated",
    definition: {
        viewId: "extension:synthetic",
        revisionId: "definition",
        kind: "extension",
        selector: {
            kind: "sources",
            sources: [
                { sourceId: source.sourceId, revisionId: source.revisionId },
            ],
        },
    },
    relationships: [],
    content: {
        kind: "extension",
        construction: "extension-v1",
        provider: identity,
        title: "Synthetic recap",
        sections: [
            {
                id: "claim",
                role: "context",
                heading: "Status",
                body: "<script>untrusted()</script> Qualified claim",
            },
        ],
        citations: [source],
        evidence: [
            { blockId: "claim", support: [source], opposition: [source] },
        ],
        payload: { decisionId: null },
        presentation: {
            schemaVersion: 1,
            templateId: "document-v1",
            templateVersion: 1,
            layouts,
        },
        inputUse: [
            {
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                disposition: "represented",
                reason: "Exact binding",
            },
        ],
        fidelity: {
            supported: true,
            sections: [],
            relationships: [],
            reasons: [],
            missingContext: [],
        },
    },
};

test("native four layouts retain exact claim/source identities and layout-pinned deep links without executable content or regeneration", () => {
    const open = jest.fn(),
        changed = jest.fn();
    const root = renderExtensionView(view, open, "roles", changed);
    document.body.replaceChildren(root);
    expect(
        root.querySelector<HTMLElement>(".hub-view-layout")?.dataset.layoutId,
    ).toBe("roles");
    expect(root.querySelector("script")).toBeNull();
    const link = root.querySelector<HTMLAnchorElement>("a")!;
    expect(parseRoute(link.hash)).toMatchObject({
        corpusId: view.corpusId,
        objectId: view.viewId,
        viewRevisionId: view.revisionId,
        viewPageId: "claim",
        viewLayoutId: "roles",
    });
    for (const label of ["story", "roles", "brief", "sources"]) {
        [...root.querySelectorAll("nav button")]
            .find((button) => button.textContent === label)!
            .dispatchEvent(new MouseEvent("click"));
        expect(
            root.querySelector<HTMLElement>("[data-block-id]")?.dataset.blockId,
        ).toBe("claim");
    }
    expect(changed).toHaveBeenCalledTimes(4);
    [...root.querySelectorAll("button")]
        .find((button) => button.textContent?.startsWith("Opposing original"))!
        .dispatchEvent(new MouseEvent("click"));
    expect(open).toHaveBeenCalledWith(source);
    expect(
        renderExtensionView(view, open, "not-installed").textContent,
    ).toContain("Unsupported layout");
});

test.each([
    "document-v1",
    "grouped-cards-v1",
    "table-v1",
    "sources-v1",
] as const)(
    "shared %s module renderer expands the exact immutable scope and rejects unsupported versions",
    (templateId) => {
        const module: UnderstandingModuleResult = {
            schemaVersion: 1,
            corpusId: view.corpusId,
            snapshotId: "snapshot",
            kind: "derivedViews",
            status: "ready",
            derivedViews: [
                {
                    schemaVersion: 1,
                    viewId: view.viewId,
                    revisionId: view.revisionId,
                    title: "Recap",
                    provider: identity,
                    selectedBlockIds: ["claim"],
                    presentation: {
                        schemaVersion: 1,
                        templateId,
                        templateVersion: 1,
                        layouts: layouts.map(({ id, label }) => ({
                            id,
                            label,
                        })),
                        layout: layouts[0],
                    },
                    blocks: [
                        {
                            id: "claim",
                            heading: "Claim",
                            role: "context",
                            body: "<img onerror=untrusted()>",
                            bodyOffset: 0,
                            bodyTotalChars: 1800,
                            nextBodyOffset: 1600,
                            selectedForAnswer: true,
                            citations: [
                                {
                                    id: "claim.support.0",
                                    role: "support",
                                    source,
                                },
                            ],
                            totalCitations: 10,
                            nextCitationOffset: 8,
                        },
                    ],
                    offset: 0,
                    totalBlocks: 2,
                    omittedBlocks: 1,
                    nextOffset: 1,
                },
            ],
        };
        const slot = document.createElement("div"),
            expand = jest.fn();
        renderDerivedViewModule(module, slot, expand);
        document.body.replaceChildren(slot);
        expect(slot.querySelector("img")).toBeNull();
        expect(slot.querySelector("table td") !== null).toBe(
            templateId === "table-v1",
        );
        [...slot.querySelectorAll("button")]
            .find(
                (button) => button.textContent === "Read remaining claim text",
            )!
            .click();
        expect(expand).toHaveBeenCalledWith({
            viewId: view.viewId,
            revisionId: view.revisionId,
            layoutId: "story",
            blockId: "claim",
            bodyOffset: 1600,
        });
        const select = slot.querySelector("select")!;
        select.value = "roles";
        select.dispatchEvent(new Event("change"));
        expect(expand).toHaveBeenLastCalledWith({
            viewId: view.viewId,
            revisionId: view.revisionId,
            layoutId: "roles",
            offset: 0,
        });
        module.derivedViews![0].presentation.templateVersion = 2 as 1;
        expect(() => renderDerivedViewModule(module, slot, expand)).toThrow(
            "Unsupported",
        );
    },
);
