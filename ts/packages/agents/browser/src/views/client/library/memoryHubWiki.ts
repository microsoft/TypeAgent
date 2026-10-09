// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    WikiContent,
    WikiPage,
    ViewCitation,
    ViewRelationshipInput,
} from "@typeagent/memory-service";
import { rbNode, rbButton } from "./memoryHubRunbookUi";

function index(content: WikiContent) {
    content.index = content.sections.map((page) => ({
        pageId: page.id,
        title: page.heading,
        taxonomy: page.details.taxonomy,
    }));
}

function mergePages(
    content: WikiContent,
    edges: ViewRelationshipInput[],
    from: WikiPage,
    to: WikiPage,
) {
    to.body = `${to.body}\n\n## ${from.heading}\n\n${from.body}`;
    to.details.inventoryIds = [
        ...new Set([...to.details.inventoryIds, ...from.details.inventoryIds]),
    ];
    to.details.mergedPageIds = [
        ...new Set([
            ...to.details.mergedPageIds,
            from.id,
            ...from.details.mergedPageIds,
        ]),
    ];
    content.sections = content.sections.filter((page) => page.id !== from.id);
    const remapped = new Map<string, ViewRelationshipInput>();
    for (const original of edges) {
        const edge: ViewRelationshipInput = JSON.parse(
            JSON.stringify(original),
        );
        if (edge.from.sectionId === from.id) edge.from.sectionId = to.id;
        if (edge.to.kind === "section" && edge.to.sectionId === from.id)
            edge.to.sectionId = to.id;
        if (
            edge.to.kind === "section" &&
            edge.from.sectionId === edge.to.sectionId
        )
            continue;
        const key = JSON.stringify([edge.predicate, edge.from, edge.to]);
        const prior = remapped.get(key);
        if (prior) {
            for (const citation of edge.citations)
                if (
                    !prior.citations.some(
                        (entry) =>
                            JSON.stringify(entry) === JSON.stringify(citation),
                    )
                )
                    prior.citations.push(citation);
        } else remapped.set(key, edge);
    }
    index(content);
    return [...remapped.values()];
}

export function createWikiEditor(
    original: WikiContent,
    originalEdges: ViewRelationshipInput[],
    changed: () => void,
    showEvidence: (citation: ViewCitation) => void,
) {
    const content: WikiContent = JSON.parse(JSON.stringify(original));
    let edges: ViewRelationshipInput[] = JSON.parse(
        JSON.stringify(originalEdges),
    );
    const root = rbNode("section");
    root.className = "hub-wiki";
    root.setAttribute("aria-label", "Knowledge wiki");
    const navigation = rbNode("nav");
    navigation.setAttribute("aria-label", "Wiki page index");
    const reader = rbNode("article");
    const editor = rbNode("fieldset");
    editor.hidden = true;
    let selected = content.sections[0]?.id;
    const status = rbNode("p");
    status.setAttribute("role", "status");

    function field(
        label: string,
        value: string,
        update: (value: string) => void,
        multiline = false,
    ) {
        const wrapper = rbNode("label", label);
        const input = multiline
            ? document.createElement("textarea")
            : document.createElement("input");
        input.setAttribute("aria-label", label);
        input.value = value;
        if (input instanceof HTMLTextAreaElement) input.rows = 12;
        input.oninput = () => {
            update(input.value);
            changed();
            index(content);
            renderNavigation();
        };
        wrapper.append(input);
        return wrapper;
    }
    function choose(id: string, focus = true) {
        selected = id;
        render();
        if (focus) reader.querySelector<HTMLElement>("h4")?.focus();
    }
    function renderNavigation() {
        navigation.replaceChildren(rbNode("h4", "Knowledge index"));
        for (const entry of content.index) {
            const button = rbButton(`${entry.title} (${entry.taxonomy})`, () =>
                choose(entry.pageId),
            );
            if (entry.pageId === selected)
                button.setAttribute("aria-current", "page");
            navigation.append(button);
        }
    }
    function renderRelationships(page: WikiPage) {
        const links = rbNode("section");
        links.setAttribute("aria-label", "Typed page relationships");
        for (const edge of edges.filter(
            (edge) =>
                edge.from.sectionId === page.id && edge.to.kind === "section",
        )) {
            if (edge.to.kind !== "section") continue;
            const targetId = edge.to.sectionId;
            const target = content.sections.find(
                (entry) => entry.id === targetId,
            );
            if (!target) continue;
            links.append(
                rbButton(`${edge.predicate}: ${target.heading}`, () =>
                    choose(target.id),
                ),
            );
            links.append(
                rbButton(`Remove ${edge.predicate} ${target.heading}`, () => {
                    edges = edges.filter((entry) => entry.id !== edge.id);
                    changed();
                    render();
                }),
            );
        }
        return links;
    }
    function addRelationship(
        page: WikiPage,
        targetId: string,
        predicate: "relatedTo" | "contradicts",
    ) {
        const target = content.sections.find((entry) => entry.id === targetId);
        const proof = edges.filter(
            (edge) =>
                edge.predicate === "supportedBy" &&
                [page.id, targetId].includes(edge.from.sectionId),
        );
        if (
            !target ||
            target.id === page.id ||
            ![page.id, targetId].every((id) =>
                proof.some((edge) => edge.from.sectionId === id),
            ) ||
            edges.some(
                (edge) =>
                    edge.predicate === predicate &&
                    edge.from.sectionId === page.id &&
                    edge.to.kind === "section" &&
                    edge.to.sectionId === targetId,
            )
        ) {
            status.textContent =
                "Choose distinct existing pages with exact retained proof and no duplicate assertion.";
            return;
        }
        edges.push({
            id: crypto.randomUUID(),
            predicate,
            from: {
                kind: "section",
                viewId: proof[0].from.viewId,
                sectionId: page.id,
            },
            to: {
                kind: "section",
                viewId: proof[0].from.viewId,
                sectionId: targetId,
            },
            citations: proof.flatMap((edge) => edge.citations),
        });
        changed();
        render();
        status.textContent =
            "Human relationship added locally. Saving requires exact endpoint proof and independent semantic support.";
    }
    function renderPageEditor(page: WikiPage) {
        editor.replaceChildren(
            rbNode("legend", "Explicit human page edits"),
            field("Wiki title", content.title, (value) => {
                content.title = value;
            }),
            field("Wiki summary", content.summary ?? "", (value) => {
                content.summary = value;
            }),
            field(`Page title ${page.id}`, page.heading, (value) => {
                page.heading = value;
            }),
            field(
                `Page narrative and checked facts ${page.id}`,
                page.body,
                (value) => {
                    page.body = value;
                },
                true,
            ),
        );
        const target = document.createElement("select");
        target.setAttribute("aria-label", "Merge into wiki page");
        for (const other of content.sections.filter(
            (entry) => entry.id !== page.id,
        )) {
            const option = document.createElement("option");
            option.value = other.id;
            option.textContent = other.heading;
            target.append(option);
        }
        const merge = rbButton("Merge selected page into target", () => {
            const destination = content.sections.find(
                (entry) => entry.id === target.value,
            );
            if (!destination || destination.id === page.id) {
                status.textContent = "Choose a distinct existing target page.";
                return;
            }
            edges = mergePages(content, edges, page, destination);
            changed();
            choose(destination.id);
            status.textContent =
                "Merged locally with retained facts and citations. Save validates the complete artifact; incompatible regeneration conflicts.";
        });
        merge.disabled = !target.options.length;
        const predicate = document.createElement("select");
        predicate.setAttribute("aria-label", "Wiki relationship predicate");
        for (const value of ["relatedTo", "contradicts"]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            predicate.append(option);
        }
        editor.append(
            rbNode(
                "p",
                "The target below is used for merge or a directed typed relationship; no wikilink inference.",
            ),
            target,
            merge,
            predicate,
            rbButton("Add supported page relationship", () =>
                addRelationship(
                    page,
                    target.value,
                    predicate.value === "contradicts"
                        ? "contradicts"
                        : "relatedTo",
                ),
            ),
            rbButton("Omit selected wiki page", () => {
                if (content.sections.length === 1) {
                    status.textContent = "A wiki needs at least one page.";
                    return;
                }
                content.sections = content.sections.filter(
                    (entry) => entry.id !== page.id,
                );
                edges = edges.filter(
                    (edge) =>
                        edge.from.sectionId !== page.id &&
                        (edge.to.kind !== "section" ||
                            edge.to.sectionId !== page.id),
                );
                index(content);
                changed();
                choose(content.sections[0].id);
                status.textContent =
                    "Page omitted locally. Saving remains blocked if required facts are no longer represented.";
            }),
        );
    }
    function render() {
        index(content);
        renderNavigation();
        const page = content.sections.find((entry) => entry.id === selected);
        if (!page) {
            reader.replaceChildren(rbNode("p", "No selected page"));
            return;
        }
        const heading = rbNode("h4", page.heading);
        heading.tabIndex = -1;
        reader.replaceChildren(
            heading,
            rbNode("p", `Stable page: ${page.id}; ${page.details.taxonomy}`),
            rbNode("pre", page.body),
            rbNode(
                "p",
                page.details.mergedPageIds.length
                    ? `Merged identities: ${page.details.mergedPageIds.join(", ")}`
                    : "No merged pages",
            ),
            renderRelationships(page),
        );
        for (const edge of edges.filter(
            (edge) =>
                edge.predicate === "supportedBy" &&
                edge.from.sectionId === page.id,
        ))
            for (const citation of edge.citations)
                reader.append(
                    rbButton(
                        `${citation.sourceId} @ ${citation.revisionId} ${citation.locator}`,
                        () => showEvidence(citation),
                    ),
                );
        renderPageEditor(page);
    }
    root.append(
        rbNode(
            "p",
            "Source-grounded definitions, scope, competing explanations and unresolved contradictions. Raw wikilinks are text, not semantic authority. Renames retain IDs; merges retain checked facts and source proof. No execution or skill activation.",
        ),
        navigation,
        reader,
        rbButton("Edit selected wiki page", () => {
            editor.hidden = !editor.hidden;
            if (!editor.hidden)
                editor.querySelector<HTMLInputElement>("input")?.focus();
        }),
        editor,
        status,
    );
    render();
    return {
        element: root,
        read: () => {
            index(content);
            return JSON.parse(JSON.stringify(content)) as WikiContent;
        },
        relationships: () =>
            JSON.parse(JSON.stringify(edges)) as ViewRelationshipInput[],
    };
}
