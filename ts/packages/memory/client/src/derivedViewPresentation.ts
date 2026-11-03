// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
/// <reference lib="dom" />

import type {
    UnderstandingDerivedView,
    UnderstandingModuleRequest,
    UnderstandingModuleResult,
} from "@typeagent/memory-service";

type Expand = (request: Partial<UnderstandingModuleRequest>) => void;
type Scope = Pick<
    UnderstandingModuleRequest,
    "viewId" | "revisionId" | "layoutId"
>;

function node<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
}

export function renderDerivedViewModule(
    value: UnderstandingModuleResult,
    slot: HTMLElement,
    expand: Expand,
): void {
    slot.replaceChildren(node("h3", "Derived views"));
    for (const view of value.derivedViews ?? [])
        slot.append(renderView(view, expand));
    if (value.omittedViews)
        slot.append(
            node(
                "p",
                `${value.omittedViews} additional selected views exceed this compact page; request their exact view IDs.`,
            ),
        );
}

function renderView(
    view: UnderstandingDerivedView,
    expand: Expand,
): HTMLElement {
    if (
        view.schemaVersion !== 1 ||
        view.presentation.schemaVersion !== 1 ||
        view.presentation.templateVersion !== 1 ||
        !["document-v1", "grouped-cards-v1", "table-v1", "sources-v1"].includes(
            view.presentation.templateId,
        )
    )
        throw new Error("Unsupported derived-view presentation version");
    const scope = {
        viewId: view.viewId,
        revisionId: view.revisionId,
        layoutId: view.presentation.layout.id,
    };
    const section = node("section");
    section.append(
        node("h3", view.title),
        node(
            "small",
            `${view.provider.providerId} · ${view.viewId} @ ${view.revisionId}. Derived interpretation, not independent corroboration.`,
        ),
    );
    const layouts = node("select");
    layouts.setAttribute("aria-label", "Derived view layout");
    for (const layout of view.presentation.layouts) {
        const option = node("option", layout.label);
        option.value = layout.id;
        option.selected = layout.id === view.presentation.layout.id;
        layouts.append(option);
    }
    layouts.addEventListener("change", () =>
        expand({ ...scope, layoutId: layouts.value, offset: 0 }),
    );
    section.append(layouts);
    for (const group of view.presentation.layout.groups)
        section.append(renderGroup(view, group, scope, expand));
    if (view.sourceFragment)
        section.append(
            renderOriginalSource(view.sourceFragment, scope, expand),
        );
    if (view.nextOffset !== undefined) {
        const more = node("button", "Show more stored claims");
        more.addEventListener("click", () =>
            expand({ ...scope, offset: view.nextOffset }),
        );
        section.append(more);
    }
    section.append(
        node(
            "small",
            `${view.blocks.length} of ${view.totalBlocks} blocks in this exact revision. Layout and expansion do not regenerate it.`,
        ),
    );
    return section;
}

function renderGroup(
    view: UnderstandingDerivedView,
    group: UnderstandingDerivedView["presentation"]["layout"]["groups"][number],
    scope: Scope,
    expand: Expand,
): HTMLElement {
    const container = node(
        view.presentation.templateId === "table-v1" ? "table" : "section",
    );
    container.append(
        node(
            view.presentation.templateId === "table-v1" ? "caption" : "h4",
            group.label,
        ),
    );
    for (const id of group.blockIds) {
        const block = view.blocks.find((block) => block.id === id);
        if (!block) continue;
        const row =
            view.presentation.templateId === "table-v1"
                ? node("tr")
                : undefined;
        const card = node(row ? "td" : "article");
        card.append(
            node("h4", block.heading),
            node(
                "small",
                block.selectedForAnswer
                    ? "Selected for answer"
                    : "Additional stored claim",
            ),
            node("p", block.body),
        );
        if (block.body.length !== block.bodyTotalChars)
            card.append(
                node(
                    "small",
                    `Text ${block.bodyOffset + 1}–${block.bodyOffset + block.body.length} of ${block.bodyTotalChars} characters; this is a fragment of the same claim.`,
                ),
            );
        for (const citation of block.citations) {
            const original = node(
                "button",
                `[${citation.id}] ${citation.role}: ${citation.source.sourceId} @ ${citation.source.revisionId} · ${citation.source.locator}`,
            );
            original.addEventListener("click", () =>
                expand({
                    ...scope,
                    blockId: block.id,
                    citationId: citation.id,
                }),
            );
            card.append(original);
        }
        if (block.nextBodyOffset !== undefined) {
            const more = node("button", "Read remaining claim text");
            more.addEventListener("click", () =>
                expand({
                    ...scope,
                    blockId: block.id,
                    bodyOffset: block.nextBodyOffset,
                }),
            );
            card.append(more);
        }
        if (block.nextCitationOffset !== undefined) {
            const more = node("button", "Show more original citations");
            more.addEventListener("click", () =>
                expand({
                    ...scope,
                    blockId: block.id,
                    citationOffset: block.nextCitationOffset,
                }),
            );
            card.append(more);
        }
        if (row) {
            row.append(card);
            container.append(row);
        } else container.append(card);
    }
    return container;
}

function renderOriginalSource(
    fragment: NonNullable<UnderstandingDerivedView["sourceFragment"]>,
    scope: Scope,
    expand: Expand,
): HTMLElement {
    const original = node("aside");
    original.setAttribute("aria-label", "Pinned original source");
    original.append(
        node(
            "h4",
            `${fragment.role} · ${fragment.source.sourceId} @ ${fragment.source.revisionId}`,
        ),
        node("p", fragment.text),
        node(
            "small",
            `Original source text ${fragment.offset + 1}–${fragment.offset + fragment.text.length} of ${fragment.totalChars} characters · ${fragment.source.locator}`,
        ),
    );
    if (fragment.nextOffset !== undefined) {
        const more = node("button", "Read remaining original source");
        more.addEventListener("click", () =>
            expand({
                ...scope,
                blockId: fragment.blockId,
                citationId: fragment.citationId,
                citationBodyOffset: fragment.nextOffset,
            }),
        );
        original.append(more);
    }
    return original;
}
