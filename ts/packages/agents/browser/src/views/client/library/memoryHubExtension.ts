// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewCitation, ViewVersion } from "@typeagent/memory-service";
import { rbButton, rbNode } from "./memoryHubDocumentUi";
import { renderProcedureGuide } from "./memoryHubProcedureView";

export function renderExtensionView(
    view: ViewVersion,
    openSource: (citation: ViewCitation) => void,
    initialLayoutId?: string,
    onLayoutChange?: (layoutId: string) => void,
): HTMLElement {
    const root = rbNode("div", undefined, "hub-view-extension");
    if (view.content.kind !== "extension") return root;
    const content = view.content;
    if (content.presentation.templateId === "procedure-guide-v1")
        return renderProcedureGuide(
            view,
            content,
            openSource,
            initialLayoutId,
            onLayoutChange,
        );
    root.dataset.viewId = view.viewId;
    root.dataset.revisionId = view.revisionId;
    root.append(
        rbNode(
            "p",
            `Provider ${content.provider.providerId} ${content.provider.version}. Template ${content.presentation.templateId}, version ${content.presentation.templateVersion}.`,
        ),
        rbNode(
            "p",
            "Generated interpretation of retained sources, not independent corroboration or human approval.",
        ),
    );
    const layouts = rbNode("nav");
    layouts.setAttribute("aria-label", "View layouts");
    const body = rbNode("div", undefined, "hub-view-layout");
    const buttons = new Map<string, HTMLButtonElement>();
    const render = (id: string) => {
        const layout = content.presentation.layouts.find(
            (entry) => entry.id === id,
        );
        body.replaceChildren();
        for (const [key, button] of buttons)
            button.setAttribute("aria-pressed", String(key === id));
        if (!layout) {
            body.append(
                rbNode(
                    "p",
                    "Unsupported layout. Select an installed readable layout.",
                ),
            );
            return;
        }
        body.dataset.layoutId = id;
        const represented = new Set<string>();
        const block = (blockId: string): HTMLElement => {
            const section = content.sections.find(
                (entry) => entry.id === blockId,
            )!;
            represented.add(blockId);
            const node = rbNode("section", undefined, "hub-view-section");
            node.dataset.page = blockId;
            node.dataset.blockId = blockId;
            node.tabIndex = -1;
            node.append(
                rbNode("h3", section.heading),
                rbNode("p", section.body),
            );
            const evidence = content.evidence.find(
                (entry) => entry.blockId === blockId,
            );
            for (const [label, citations] of [
                ["Supporting original source", evidence?.support ?? []],
                ["Opposing original source", evidence?.opposition ?? []],
            ] as const) {
                for (const citation of citations)
                    node.append(
                        rbButton(`${label}: ${citation.sourceId}`, () =>
                            openSource(citation),
                        ),
                    );
            }
            const link = rbNode("a", "Link to exact claim");
            link.href = `#/views/${encodeURIComponent(view.corpusId)}/${encodeURIComponent(view.viewId)}/revision/${encodeURIComponent(view.revisionId)}/page/${encodeURIComponent(blockId)}/layout/${encodeURIComponent(id)}`;
            node.append(link);
            return node;
        };
        for (const group of layout.groups) {
            const node = rbNode("section", undefined, "hub-view-group");
            node.dataset.groupId = group.id;
            node.append(
                rbNode("h3", group.label),
                ...group.blockIds.map(block),
            );
            body.append(node);
        }
        const remaining = content.sections.filter(
            (section) => !represented.has(section.id),
        );
        if (remaining.length)
            body.append(
                rbNode("h3", "Additional claims and qualifications"),
                ...remaining.map((section) => block(section.id)),
            );
    };
    for (const layout of content.presentation.layouts) {
        const button = rbButton(layout.label, () => {
            render(layout.id);
            onLayoutChange?.(layout.id);
        });
        buttons.set(layout.id, button);
        layouts.append(button);
    }
    root.append(layouts, body);
    render(initialLayoutId ?? content.presentation.layouts[0]?.id ?? "");
    return root;
}
