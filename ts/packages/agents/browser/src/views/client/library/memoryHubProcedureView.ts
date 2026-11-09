// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ExtensionViewContent,
    ViewCitation,
    ViewVersion,
    ViewJsonValue,
    ViewSection,
} from "@typeagent/memory-service";
import { rbButton, rbNode } from "./memoryHubDocumentUi";

export function renderProcedureGuide(
    view: ViewVersion,
    content: ExtensionViewContent,
    openSource: (citation: ViewCitation) => void,
    initialLayoutId?: string,
    onLayoutChange?: (layoutId: string) => void,
): HTMLElement {
    const root = rbNode("div", undefined, "hub-procedure-view");
    root.dataset.viewId = view.viewId;
    root.dataset.revisionId = view.revisionId;
    const referenceNumbers = new Map<string, number>();
    for (const evidence of content.evidence)
        for (const citation of [...evidence.support, ...evidence.opposition]) {
            const key = procedureCitationKey(citation);
            if (!referenceNumbers.has(key))
                referenceNumbers.set(key, referenceNumbers.size + 1);
        }
    const provenance = rbNode("details", undefined, "hub-procedure-metadata");
    provenance.append(rbNode("summary", "Provider and revision metadata"));
    if (content.summary) provenance.append(rbNode("p", content.summary));
    provenance.append(
        rbNode(
            "p",
            "Generated interpretation of retained sources. Human review remains pending; this view does not authorize tools, payments, or collection of sensitive information.",
            "hub-procedure-boundary",
        ),
    );
    const representation =
        content.payload &&
        typeof content.payload === "object" &&
        !Array.isArray(content.payload)
            ? content.payload.agentRepresentation
            : null;
    if (
        representation &&
        typeof representation === "object" &&
        !Array.isArray(representation) &&
        (representation.topology === "guarded-graph" ||
            representation.topology === "partial-order")
    ) {
        root.dataset.topology = representation.topology;
        provenance.append(
            rbNode(
                "p",
                Array.isArray(representation.orderingConflictIds) &&
                    representation.orderingConflictIds.length
                    ? "Ordering is unresolved; review the source limitations. Card position is not execution order."
                    : "Card position is not execution order. Follow the source conditions and review any limitations.",
                "hub-procedure-order-note",
            ),
        );
    }
    const tabs = rbNode("nav", undefined, "hub-procedure-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Procedure view audience");
    const body = rbNode("div");
    body.setAttribute("role", "tabpanel");
    const drawer = createEvidenceDrawer(openSource);
    const buttons = new Map<string, HTMLButtonElement>();
    const render = (id: string) => {
        const layout = content.presentation.layouts.find(
            (entry) => entry.id === id,
        );
        body.replaceChildren();
        for (const [key, button] of buttons) {
            button.setAttribute("aria-selected", String(key === id));
            button.setAttribute("aria-pressed", String(key === id));
            button.tabIndex = key === id ? 0 : -1;
        }
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
        body.setAttribute("aria-labelledby", buttons.get(id)!.id);
        const block = (blockId: string) =>
            renderBlock(
                view,
                content,
                blockId,
                id,
                drawer.open,
                referenceNumbers,
            );
        if (id === "agent") {
            renderAgent(content, body);
            const details = rbNode("details");
            details.append(
                rbNode("summary", "Evidence-bound source qualifications"),
            );
            layout.groups.forEach((group) =>
                details.append(renderGroup(group, block)),
            );
            body.append(details);
        } else if (id === "evidence") {
            layout.groups.forEach((group) =>
                body.append(renderGroup(group, block)),
            );
        } else {
            body.append(renderHumanGuide(content, layout.groups, block));
        }
    };
    content.presentation.layouts.forEach((layout, index, layouts) => {
        const button = rbButton(layout.label, () => {
            render(layout.id);
            onLayoutChange?.(layout.id);
        });
        button.id = `procedure-tab-${encodeURIComponent(view.viewId)}-${layout.id}`;
        button.setAttribute("role", "tab");
        button.addEventListener("keydown", (event) => {
            const next =
                event.key === "ArrowRight"
                    ? (index + 1) % layouts.length
                    : event.key === "ArrowLeft"
                      ? (index + layouts.length - 1) % layouts.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? layouts.length - 1
                          : undefined;
            if (next === undefined) return;
            event.preventDefault();
            buttons.get(layouts[next].id)!.click();
            buttons.get(layouts[next].id)!.focus();
        });
        buttons.set(layout.id, button);
        tabs.append(button);
    });
    provenance.append(
        rbNode(
            "p",
            `Provider ${content.provider.providerId} ${content.provider.version}. Template ${content.presentation.templateId}. Revision ${view.revisionId}.`,
        ),
    );
    root.append(tabs, body, provenance, drawer.dialog);
    render(initialLayoutId ?? content.presentation.layouts[0].id);
    return root;
}

function renderGroup(
    group: ExtensionViewContent["presentation"]["layouts"][number]["groups"][number],
    block: (id: string) => HTMLElement,
): HTMLElement {
    const section = rbNode(
        "section",
        undefined,
        `hub-procedure-group hub-procedure-${group.id}`,
    );
    section.append(rbNode("h3", group.label));
    const cards = rbNode("div", undefined, "hub-procedure-cards");
    cards.append(...group.blockIds.map(block));
    section.append(cards);
    if (!group.blockIds.length)
        section.append(
            rbNode(
                "p",
                "No statement represented in this category; do not infer missing instructions.",
                "hub-procedure-missing",
            ),
        );
    return section;
}

function recordForBlock(
    content: ExtensionViewContent,
    blockId: string,
): Record<string, ViewJsonValue> | undefined {
    const payload = content.payload;
    if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !Array.isArray(payload.procedures)
    )
        return undefined;
    for (const procedure of payload.procedures) {
        if (
            !procedure ||
            typeof procedure !== "object" ||
            Array.isArray(procedure) ||
            !Array.isArray(procedure.records)
        )
            throw new Error("Procedure payload has an invalid procedure");
        for (const entry of procedure.records) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry))
                throw new Error(
                    "Procedure payload has an invalid record entry",
                );
            if (entry.blockId !== blockId) continue;
            if (
                !entry.record ||
                typeof entry.record !== "object" ||
                Array.isArray(entry.record)
            )
                throw new Error("Procedure claim has an invalid typed record");
            return entry.record;
        }
    }
    return undefined;
}

function renderHumanGuide(
    content: ExtensionViewContent,
    groups: ExtensionViewContent["presentation"]["layouts"][number]["groups"],
    block: (id: string) => HTMLElement,
): HTMLElement {
    const columns = rbNode("div", undefined, "hub-procedure-columns");
    const main = rbNode("div", undefined, "hub-procedure-main");
    const aside = rbNode("aside", undefined, "hub-procedure-aside");
    aside.setAttribute("aria-label", "Rules and supporting evidence");
    const orderingIds = groups
        .flatMap(({ blockIds }) => blockIds)
        .filter((id) => {
            const kind = recordForBlock(content, id)?.kind;
            return kind === "orderingConstraint" || kind === "transition";
        });
    const ordering = new Set(orderingIds);
    const orderedGroups = [
        ...groups.filter(({ id }) => id === "options"),
        ...groups.filter(
            ({ id }) => id !== "options" && id !== "overview" && id !== "gaps",
        ),
    ];
    for (const group of orderedGroups) {
        const blockIds = group.blockIds.filter((id) => {
            if (ordering.has(id)) return false;
            const record = recordForBlock(content, id);
            return !(record?.kind === "outcome" && record.result === "unknown");
        });
        if (!blockIds.length) continue;
        const section = renderGroup(
            {
                ...group,
                blockIds,
                label:
                    group.id === "options"
                        ? "Actions and choices"
                        : group.id === "outcomes"
                          ? "How to finish"
                          : group.label,
            },
            block,
        );
        if (group.id === "options" && hasAnyOrderOptions(content, blockIds))
            section
                .querySelector(".hub-procedure-cards")!
                .before(
                    rbNode(
                        "p",
                        "Try the listed options in any order.",
                        "hub-procedure-option-order",
                    ),
                );
        if (group.id === "technical" || group.id === "ordering") {
            const details = rbNode("details");
            details.append(rbNode("summary", group.label), section);
            aside.append(details);
        } else if (group.id === "rules") aside.append(section);
        else main.append(section);
    }
    if (orderingIds.length) {
        const details = rbNode(
            "details",
            undefined,
            "hub-procedure-ordering-details",
        );
        details.append(
            rbNode(
                "summary",
                `Ordering and branch evidence (${orderingIds.length} relationships)`,
            ),
            rbNode(
                "p",
                "These relationships constrain actions; they are not additional tasks.",
            ),
            renderGroup(
                {
                    id: "ordering",
                    label: "Source relationships",
                    blockIds: orderingIds,
                },
                block,
            ),
        );
        aside.append(details);
    }
    columns.append(main, aside);
    return columns;
}

function hasAnyOrderOptions(
    content: ExtensionViewContent,
    blockIds: string[],
): boolean {
    const actions = blockIds.flatMap((id) => {
        const record = recordForBlock(content, id);
        return (record?.kind === "action" || record?.kind === "step") &&
            typeof record.id === "string"
            ? [record.id]
            : [];
    });
    return (
        actions.length > 0 &&
        content.sections.some((section) => {
            const record = recordForBlock(content, section.id);
            const actionIds = record?.actionIds;
            return (
                record?.kind === "actionCollection" &&
                record.order === "any-order" &&
                Array.isArray(actionIds) &&
                actions.every((id) => actionIds.includes(id))
            );
        })
    );
}

function tableStrings(value: ViewJsonValue | undefined): string[] {
    if (!Array.isArray(value)) throw new Error("Invalid procedure table array");
    return value.map((cell) => {
        if (typeof cell !== "string" || !cell.trim())
            throw new Error("Invalid procedure table text");
        return cell;
    });
}

function renderDecisionTable(
    record: Record<string, ViewJsonValue>,
    headingId: string,
): HTMLElement {
    const columns = tableStrings(record.columns);
    if (
        columns.length < 2 ||
        columns.length > 4 ||
        !Array.isArray(record.rows) ||
        !record.rows.length ||
        record.rows.length > 8
    )
        throw new Error("Invalid procedure decision table shape");
    const container = rbNode("div", undefined, "hub-procedure-table-container");
    const table = rbNode("table", undefined, "hub-procedure-decision-table");
    table.setAttribute("aria-labelledby", headingId);
    const head = rbNode("thead");
    const header = rbNode("tr");
    for (const column of columns) {
        const cell = rbNode("th", column);
        cell.scope = "col";
        header.append(cell);
    }
    head.append(header);
    const body = rbNode("tbody");
    for (const row of record.rows) {
        const cells = tableStrings(row);
        if (cells.length !== columns.length)
            throw new Error("Procedure table row does not match its columns");
        const node = rbNode("tr");
        node.append(...cells.map((cell) => rbNode("td", cell)));
        body.append(node);
    }
    table.append(head, body);
    container.append(table);
    return container;
}

function renderHumanInstruction(
    node: HTMLElement,
    section: ViewSection,
    record: Record<string, ViewJsonValue> | undefined,
    headingId: string,
): boolean {
    if (
        !record ||
        (record.kind !== "action" &&
            record.kind !== "step" &&
            record.kind !== "decisionTable" &&
            record.kind !== "outcome")
    ) {
        node.append(rbNode("p", section.body));
        return false;
    }
    if (typeof record.text !== "string")
        throw new Error("Procedure instruction text is missing");
    if (typeof record.selectionCondition === "string")
        node.append(
            rbNode(
                "p",
                `Applies when: ${record.selectionCondition}`,
                "hub-procedure-condition",
            ),
        );
    node.append(rbNode("p", record.text, "hub-procedure-instruction"));
    if (record.kind === "decisionTable")
        node.append(renderDecisionTable(record, headingId));
    return record.kind !== "decisionTable";
}

function procedureCitationKey(citation: ViewCitation): string {
    return JSON.stringify([
        citation.sourceId,
        citation.revisionId,
        citation.locator,
        citation.excerpt,
    ]);
}

function procedureClaimHref(
    view: ViewVersion,
    blockId: string,
    layoutId: string,
): string {
    return `#/views/${encodeURIComponent(view.corpusId)}/${encodeURIComponent(view.viewId)}/revision/${encodeURIComponent(view.revisionId)}/page/${encodeURIComponent(blockId)}/layout/${encodeURIComponent(layoutId)}`;
}

function appendRelatedGaps(
    node: HTMLElement,
    view: ViewVersion,
    content: ExtensionViewContent,
    blockId: string,
): void {
    const kind = recordForBlock(content, blockId)?.kind;
    if (kind !== "action" && kind !== "step" && kind !== "decisionTable")
        return;
    const evidence = content.evidence.find(
        (entry) => entry.blockId === blockId,
    );
    const bindings = new Set(
        [...(evidence?.support ?? []), ...(evidence?.opposition ?? [])].map(
            procedureCitationKey,
        ),
    );
    for (const gap of content.sections) {
        const record = recordForBlock(content, gap.id);
        if (record?.kind !== "gap") continue;
        const gapEvidence = content.evidence.find(
            (entry) => entry.blockId === gap.id,
        );
        if (
            ![
                ...(gapEvidence?.support ?? []),
                ...(gapEvidence?.opposition ?? []),
            ].some((citation) => bindings.has(procedureCitationKey(citation)))
        )
            continue;
        if (typeof record.text !== "string")
            throw new Error("Procedure gap text is missing");
        const warning = rbNode(
            "details",
            undefined,
            "hub-procedure-action-gap",
        );
        warning.append(
            rbNode(
                "summary",
                "Related source gap: review before using this action",
            ),
            rbNode("p", record.text),
        );
        const link = rbNode("a", "Review gap in Evidence & gaps");
        link.href = procedureClaimHref(view, gap.id, "evidence");
        warning.append(link);
        node.append(warning);
    }
}

function renderBlock(
    view: ViewVersion,
    content: ExtensionViewContent,
    blockId: string,
    layoutId: string,
    open: (
        citation: ViewCitation,
        role: string,
        trigger: HTMLButtonElement,
    ) => void,
    referenceNumbers: ReadonlyMap<string, number>,
): HTMLElement {
    const section = content.sections.find((entry) => entry.id === blockId);
    if (!section)
        throw new Error("Procedure layout references an unavailable claim");
    const node = rbNode(
        "article",
        undefined,
        "hub-procedure-card hub-view-section",
    );
    node.dataset.blockId = blockId;
    node.dataset.page = blockId;
    node.tabIndex = -1;
    const record = recordForBlock(content, blockId);
    if (record && typeof record.kind === "string")
        node.dataset.recordKind = record.kind;
    const heading = rbNode(
        "h4",
        layoutId === "guide" && record?.kind === "outcome"
            ? "Outcome and next steps"
            : section.heading,
    );
    heading.id = `procedure-${encodeURIComponent(view.viewId)}-${blockId}-${layoutId}`;
    node.append(heading);
    let instruction = false;
    if (layoutId === "guide") {
        instruction = renderHumanInstruction(node, section, record, heading.id);
        appendRelatedGaps(node, view, content, blockId);
    } else node.append(rbNode("p", section.body));
    const evidence = content.evidence.find(
        (entry) => entry.blockId === blockId,
    );
    const sourceHost =
        layoutId === "guide"
            ? rbNode("details", undefined, "hub-procedure-claim-details")
            : node;
    if (layoutId === "guide") {
        const count =
            (evidence?.support.length ?? 0) +
            (evidence?.opposition.length ?? 0);
        sourceHost.append(rbNode("summary", `Details and sources (${count})`));
        if (instruction)
            sourceHost.append(
                rbNode("p", section.body, "hub-procedure-structured-details"),
            );
        node.append(sourceHost);
    }
    for (const [role, citations] of [
        ["Supporting original source", evidence?.support ?? []],
        ["Opposing original source", evidence?.opposition ?? []],
    ] as const) {
        for (const citation of citations) {
            const reference = referenceNumbers.get(
                procedureCitationKey(citation),
            );
            if (reference === undefined)
                throw new Error("Procedure citation has no reference number");
            const label = `Open ${role.toLowerCase()} [${reference}]: ${citation.sourceId} @ ${citation.revisionId} (${citation.locator})`;
            const button = rbButton(`[${reference}]`, () =>
                open(citation, role, button),
            );
            button.setAttribute("aria-label", label);
            button.title = label;
            button.classList.add("hub-procedure-source");
            sourceHost.append(button);
        }
    }
    const link = rbNode("a", "Link to exact claim");
    link.href = procedureClaimHref(view, blockId, layoutId);
    sourceHost.append(link);
    return node;
}

function renderAgent(content: ExtensionViewContent, body: HTMLElement): void {
    const payload = content.payload;
    if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        !payload.agentRepresentation
    )
        throw new Error(
            "Procedure guide has no validated agent representation",
        );
    const serialized = JSON.stringify(payload.agentRepresentation, null, 2);
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const copy = rbButton("Copy agent JSON", async () => {
        try {
            if (!navigator.clipboard)
                throw new Error(
                    "Clipboard unavailable in this browser context",
                );
            await navigator.clipboard.writeText(serialized);
            status.textContent = "Agent representation copied.";
        } catch (error) {
            status.textContent = `Could not copy: ${error instanceof Error ? error.message : String(error)}. Select the JSON text instead.`;
        }
    });
    body.append(
        rbNode("h3", "Action-level source representation"),
        rbNode(
            "p",
            "Options are individually typed and evidence-bound. Null means unspecified, not unnecessary or authorized. Interface parameter inventories are not scenario-required inputs. This is guidance, not an execution plan.",
        ),
        copy,
        status,
        rbNode("pre", serialized, "hub-procedure-json"),
    );
}

function createEvidenceDrawer(openSource: (citation: ViewCitation) => void) {
    const dialog = rbNode("dialog", undefined, "hub-procedure-drawer");
    dialog.setAttribute("aria-label", "Original retained evidence");
    const title = rbNode("h3");
    const locator = rbNode("p", undefined, "hub-procedure-locator");
    const quote = rbNode("blockquote");
    let selected: ViewCitation | undefined;
    let trigger: HTMLButtonElement | undefined;
    const close = rbButton("Close evidence", () => dialog.close());
    const full = rbButton("Open retained original", () => {
        if (!selected) throw new Error("No selected original evidence");
        dialog.close();
        openSource(selected);
    });
    dialog.append(
        close,
        title,
        locator,
        quote,
        full,
        rbNode(
            "p",
            "Original evidence supports a generated interpretation; it is not independent corroboration or operational approval.",
        ),
    );
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            dialog.close();
        }
    });
    dialog.addEventListener("close", () => trigger?.focus());
    return {
        dialog,
        open(citation: ViewCitation, role: string, button: HTMLButtonElement) {
            selected = citation;
            trigger = button;
            title.textContent = role;
            locator.textContent = `${citation.sourceId} @ ${citation.revisionId} · ${citation.locator}`;
            quote.textContent = citation.excerpt;
            dialog.showModal();
        },
    };
}
