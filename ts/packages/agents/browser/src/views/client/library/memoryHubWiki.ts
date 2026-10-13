// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    WikiContent,
    ViewCitation,
    ViewRelationshipInput,
    ViewDefinitionInput,
} from "@typeagent/memory-service";
import { rbNode, rbButton } from "./memoryHubDocumentUi";

export function createWikiEditor(
    original: WikiContent,
    originalEdges: ViewRelationshipInput[],
    changed: () => void,
    showEvidence: (citation: ViewCitation) => void,
    retrieval?: ViewDefinitionInput["wiki"],
) {
    if (
        original.construction !== "informational-wiki-v1" ||
        original.sections.length !== 1 ||
        original.sections[0].details.construction !== "informational-wiki-v1"
    )
        throw new Error("Wiki editor requires an indexed informational page");
    const wiki: ViewDefinitionInput["wiki"] = retrieval
        ? JSON.parse(JSON.stringify(retrieval))
        : undefined;
    const content: WikiContent = JSON.parse(JSON.stringify(original));
    const edges: ViewRelationshipInput[] = JSON.parse(
        JSON.stringify(originalEdges),
    );
    const page = content.sections[0];
    const details = page.details;
    const root = rbNode("section");
    root.className = "hub-wiki";
    root.setAttribute("aria-label", "Knowledge wiki");
    const navigation = rbNode("nav");
    navigation.setAttribute("aria-label", "Wiki page index");
    const reader = rbNode("article");
    const editor = rbNode("fieldset");
    editor.hidden = true;

    function updateIndex() {
        content.index = [
            {
                pageId: page.id,
                title: page.heading,
                taxonomy: details.taxonomy,
            },
        ];
        navigation.replaceChildren(
            rbNode("h4", "Knowledge index"),
            rbButton(`${page.heading} (${details.taxonomy})`, () => {
                reader.querySelector<HTMLElement>("h4")?.focus();
            }),
        );
        navigation
            .querySelector("button")
            ?.setAttribute("aria-current", "page");
        const heading = rbNode("h4", page.heading);
        heading.tabIndex = -1;
        reader.replaceChildren(
            heading,
            rbNode("p", `Stable page: ${page.id}; ${details.taxonomy}`),
            rbNode("pre", page.body),
            rbNode("p", content.summary),
            rbNode("p", details.note),
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
    }

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
            updateIndex();
        };
        wrapper.append(input);
        return wrapper;
    }
    editor.append(
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
        field(
            "Personal note",
            details.note,
            (value) => {
                details.note = value;
            },
            true,
        ),
    );
    const category = document.createElement("select");
    category.setAttribute("aria-label", "Page category");
    for (const taxonomy of ["concept", "system", "project"] as const) {
        const option = document.createElement("option");
        option.value = taxonomy;
        option.textContent = taxonomy;
        option.selected = taxonomy === details.taxonomy;
        category.append(option);
    }
    category.onchange = () => {
        const value = category.value;
        if (value !== "concept" && value !== "system" && value !== "project")
            throw new Error("Unsupported wiki category");
        details.taxonomy = value;
        changed();
        updateIndex();
    };
    editor.append(category);
    if (wiki) {
        const exclusions = rbNode("fieldset");
        exclusions.append(
            rbNode("legend", "Excluded sources (applies on refresh)"),
        );
        for (const sourceId of [
            ...new Set([
                ...content.citations.map((citation) => citation.sourceId),
                ...wiki.excludedSourceIds,
            ]),
        ]) {
            const label = rbNode("label", sourceId);
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.setAttribute("aria-label", `Exclude source ${sourceId}`);
            checkbox.checked = wiki.excludedSourceIds.includes(sourceId);
            checkbox.onchange = () => {
                wiki.excludedSourceIds = checkbox.checked
                    ? [...new Set([...wiki.excludedSourceIds, sourceId])]
                    : wiki.excludedSourceIds.filter((id) => id !== sourceId);
                changed();
            };
            label.prepend(checkbox);
            exclusions.append(label);
        }
        editor.append(exclusions);
    }
    root.append(
        rbNode(
            "p",
            "Source-grounded definitions, scope, competing explanations and unresolved contradictions. Raw wikilinks are text, not semantic authority. Renames retain IDs. Each page is independently stored and published. No execution or skill activation.",
        ),
        navigation,
        reader,
        rbButton("Edit selected wiki page", () => {
            editor.hidden = !editor.hidden;
            if (!editor.hidden)
                editor.querySelector<HTMLInputElement>("input")?.focus();
        }),
        editor,
    );
    updateIndex();
    return {
        element: root,
        read: (): WikiContent => JSON.parse(JSON.stringify(content)),
        relationships: (): ViewRelationshipInput[] =>
            JSON.parse(JSON.stringify(edges)),
        retrieval: (): ViewDefinitionInput["wiki"] =>
            wiki ? JSON.parse(JSON.stringify(wiki)) : undefined,
    };
}
