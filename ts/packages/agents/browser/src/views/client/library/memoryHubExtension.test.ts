// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderExtensionView } from "./memoryHubExtension";
import { renderDerivedViewModule } from "@typeagent/memory-client/derived-view-presentation";
import { parseRoute } from "./memoryHubModel";
import type {
    ViewVersion,
    UnderstandingModuleResult,
    ViewJsonValue,
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
    "procedure-guide-v1",
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

test.each(["action-collection", "guarded-graph", "partial-order"] as const)(
    "procedure %s shares exact claims across human, agent and evidence readers and opens pinned evidence safely",
    async (topology) => {
        HTMLDialogElement.prototype.showModal = function () {
            this.open = true;
        };
        HTMLDialogElement.prototype.close = function () {
            this.open = false;
            this.dispatchEvent(new Event("close"));
        };
        const procedure: ViewVersion = JSON.parse(JSON.stringify(view));
        if (procedure.content.kind !== "extension")
            throw new Error("Fixture must be an extension");
        procedure.content.payload = {
            agentRepresentation: {
                topology,
                orderingConflictIds:
                    topology === "partial-order"
                        ? ["conflicting-source-starts"]
                        : [],
                options: [{ actionId: "test-action", formInstruction: null }],
            },
        };
        procedure.content.presentation.templateId = "procedure-guide-v1";
        const groups = [
            "overview",
            "options",
            "rules",
            "outcomes",
            "gaps",
            "technical",
        ].map((id) => ({
            id,
            label: id,
            blockIds: id === "options" ? ["claim"] : [],
        }));
        procedure.content.presentation.layouts = [
            "guide",
            "agent",
            "evidence",
        ].map((id) => ({ id, label: id, groups }));
        const open = jest.fn(),
            changed = jest.fn();
        const root = renderExtensionView(procedure, open, undefined, changed);
        document.body.replaceChildren(root);
        expect(root.querySelector("script")).toBeNull();
        expect(root.dataset.topology).toBe(
            topology === "action-collection" ? undefined : topology,
        );
        if (topology !== "action-collection")
            expect(
                root.querySelector(".hub-procedure-metadata")!.textContent,
            ).toContain("Card position is not execution order");
        if (topology === "partial-order")
            expect(
                root.querySelector(".hub-procedure-metadata")!.textContent,
            ).toContain("Ordering is unresolved");
        const metadata = root.querySelector<HTMLDetailsElement>(
            ".hub-procedure-metadata",
        )!;
        expect(metadata.open).toBe(false);
        expect(
            metadata.querySelector(".hub-procedure-boundary"),
        ).not.toBeNull();
        expect(root.firstElementChild?.getAttribute("role")).toBe("tablist");
        expect(
            root.querySelector(
                ":scope > .hub-procedure-boundary, :scope > .hub-procedure-order-note",
            ),
        ).toBeNull();

        expect(
            root.querySelector(".hub-procedure-options")?.textContent,
        ).toContain("Qualified claim");
        const sourceButton = [
            ...root.querySelectorAll<HTMLButtonElement>("button"),
        ].find((button) =>
            button
                .getAttribute("aria-label")
                ?.startsWith("Open opposing original source"),
        )!;
        sourceButton.click();
        const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
        expect(dialog.open).toBe(true);
        expect(dialog.querySelector("blockquote")?.textContent).toBe(
            source.excerpt,
        );
        expect(dialog.textContent).toContain(source.revisionId);
        [...dialog.querySelectorAll("button")]
            .find((button) => button.textContent === "Open retained original")!
            .click();
        expect(open).toHaveBeenCalledWith(source);
        expect(dialog.open).toBe(false);
        const agent = [
            ...root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        ].find((button) => button.textContent === "agent")!;
        agent.click();
        expect(JSON.parse(root.querySelector("pre")!.textContent!)).toEqual({
            topology,
            orderingConflictIds:
                topology === "partial-order"
                    ? ["conflicting-source-starts"]
                    : [],
            options: [{ actionId: "test-action", formInstruction: null }],
        });
        const previousClipboard = Object.getOwnPropertyDescriptor(
            navigator,
            "clipboard",
        );
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        try {
            const copy = [...root.querySelectorAll("button")].find(
                (button) => button.textContent === "Copy agent JSON",
            )!;
            copy.click();
            await Promise.resolve();
            expect(writeText).toHaveBeenCalledWith(
                root.querySelector("pre")!.textContent,
            );
            expect(root.querySelector('[role="status"]')?.textContent).toBe(
                "Agent representation copied.",
            );
            writeText.mockRejectedValueOnce(new Error("Test clipboard denial"));
            copy.click();
            await Promise.resolve();
            expect(
                root.querySelector('[role="status"]')?.textContent,
            ).toContain("Could not copy: Test clipboard denial");
        } finally {
            if (previousClipboard)
                Object.defineProperty(
                    navigator,
                    "clipboard",
                    previousClipboard,
                );
            else Reflect.deleteProperty(navigator, "clipboard");
        }
        agent.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        expect(
            root
                .querySelector('[role="tabpanel"]')
                ?.getAttribute("aria-labelledby"),
        ).toContain("evidence");
        expect(changed).toHaveBeenLastCalledWith("evidence");
        expect(
            root
                .querySelector("[data-block-id]")
                ?.getAttribute("data-block-id"),
        ).toBe("claim");
        expect(
            renderExtensionView(procedure, open, "unsupported").textContent,
        ).toContain("Unsupported layout");
    },
);

function readableProcedureFixture(
    rows: ViewJsonValue = [
        ["Blue", "Ask for label", "<img src=x onerror=unsafe()>"],
        ["Amber", "Do not ask for label", "Account ID"],
    ],
) {
    const procedure: ViewVersion = JSON.parse(JSON.stringify(view));
    if (procedure.content.kind !== "extension")
        throw new Error("Expected extension fixture");
    const records: ViewJsonValue[] = [
        {
            kind: "action",
            id: "lookup",
            text: "Look up the account once.",
            title: "Lookup",
            canonicalAction: "lookup",
            selectionCondition: null,
        },
        {
            kind: "decisionTable",
            id: "choices",
            title: "Lookup choices",
            text: "Compare source choices.",
            appliesTo: ["lookup"],
            columns: ["Token", "Request", "Value"],
            rows,
        },
        {
            kind: "action",
            id: "close",
            text: "Ask whether further help is needed.",
            title: "Wrap up",
            canonicalAction: null,
            selectionCondition: null,
        },
        {
            kind: "orderingConstraint",
            id: "before-close",
            before: "lookup",
            after: "close",
            condition: "Wrap up after the flow.",
        },
        {
            kind: "gap",
            id: "ambiguity",
            text: "The source disagrees about the opening order.",
        },
        {
            kind: "outcome",
            id: "unknown",
            text: "Verification is not specified.",
            result: "unknown",
        },
        {
            kind: "description",
            id: "scope",
            text: "Fictional account support.",
        },
    ];
    const ids = [
        "lookup",
        "choices",
        "close",
        "before-close",
        "ambiguity",
        "unknown",
        "scope",
    ];
    procedure.content.sections = ids.map((id, index) => ({
        id,
        heading: [
            "Lookup",
            "Lookup choices",
            "Wrap up",
            "Lookup before Wrap up",
            "Opening ambiguity",
            "Verification",
            "Source scope",
        ][index],
        role: "context",
        body:
            index === 0
                ? "Look up the account once.\nSource action: lookup\nWithin-option ordering: Look up the account once."
                : `Full structured claim ${id}`,
    }));
    procedure.content.evidence = ids.map((blockId) => ({
        blockId,
        support: [source],
        opposition: [],
    }));
    procedure.content.payload = {
        procedures: [
            {
                records: ids.map((blockId, index) => ({
                    blockId,
                    record: records[index],
                })),
            },
        ],
        agentRepresentation: { topology: "partial-order", records },
    };
    const groups = [
        { id: "overview", label: "Scope", blockIds: ["scope"] },
        {
            id: "options",
            label: "Legacy actions and constraints",
            blockIds: ids.slice(0, 4),
        },
        {
            id: "gaps",
            label: "Source limitations",
            blockIds: ["ambiguity"],
        },
        { id: "outcomes", label: "Closure", blockIds: ["unknown"] },
    ];
    procedure.content.presentation = {
        schemaVersion: 1,
        templateId: "procedure-guide-v1",
        templateVersion: 1,
        layouts: ["guide", "agent", "evidence"].map((id) => ({
            id,
            label: id,
            groups,
        })),
    };
    return procedure;
}

test("human guide shows actions once, renders choices safely and collapses legacy ordering without changing saved facts", () => {
    const procedure = readableProcedureFixture();
    const original = JSON.stringify(procedure);
    const root = renderExtensionView(procedure, jest.fn());
    document.body.replaceChildren(root);
    const main = root.querySelector(".hub-procedure-main")!;
    expect(main.querySelectorAll('[data-record-kind="action"]')).toHaveLength(
        2,
    );
    expect(
        main.querySelectorAll('[data-record-kind="orderingConstraint"]'),
    ).toHaveLength(0);
    const instruction = main.querySelector(".hub-procedure-instruction")!;
    expect(instruction.textContent).toBe("Look up the account once.");
    const structured = main.querySelector<HTMLDetailsElement>(
        '[data-block-id="lookup"] .hub-procedure-claim-details',
    )!;
    expect(structured.open).toBe(false);
    expect(structured.textContent).toContain("Within-option ordering");
    const ordering = root.querySelector<HTMLDetailsElement>(
        ".hub-procedure-ordering-details",
    )!;
    expect(ordering.open).toBe(false);
    expect(ordering.textContent).toContain("Lookup before Wrap up");
    expect(root.querySelectorAll("[data-block-id]")).toHaveLength(4);
    expect(
        new Set(
            [...root.querySelectorAll<HTMLElement>("[data-block-id]")].map(
                (node) => node.dataset.blockId,
            ),
        ).size,
    ).toBe(4);
    expect(root.querySelector(".hub-procedure-overview")).toBeNull();
    expect(root.querySelector(".hub-procedure-gaps")).toBeNull();
    expect(root.querySelector(".hub-procedure-outcomes")).toBeNull();
    const table = root.querySelector("table")!;
    expect(table.querySelectorAll("thead th")).toHaveLength(3);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.textContent).toContain("<img src=x onerror=unsafe()>");
    expect(root.querySelector("img")).toBeNull();
    root.querySelector<HTMLButtonElement>(
        '[role="tab"][id$="-agent"]',
    )!.click();
    if (procedure.content.kind !== "extension")
        throw new Error("Expected extension");
    expect(JSON.parse(root.querySelector("pre")!.textContent!)).toEqual(
        procedure.content.payload &&
            typeof procedure.content.payload === "object" &&
            !Array.isArray(procedure.content.payload)
            ? procedure.content.payload.agentRepresentation
            : null,
    );
    root.querySelector<HTMLButtonElement>(
        '[role="tab"][id$="-evidence"]',
    )!.click();
    expect(root.textContent).toContain("Lookup before Wrap up");
    expect(root.querySelectorAll("[data-block-id]")).toHaveLength(7);
    expect(root.querySelector(".hub-procedure-overview")).not.toBeNull();
    expect(root.querySelector(".hub-procedure-gaps")).not.toBeNull();
    expect(root.querySelector(".hub-procedure-outcomes")).not.toBeNull();
    expect(JSON.stringify(procedure)).toBe(original);
});

test.each(["any-order", "unspecified", "partial-collection"])(
    "operational option-order guidance preserves explicit %s ordering without showing scope cards",
    (order) => {
        const procedure = readableProcedureFixture();
        if (procedure.content.kind !== "extension")
            throw new Error("Expected extension");
        procedure.content.payload = {
            procedures: [
                {
                    records: [
                        {
                            blockId: "lookup",
                            record: {
                                kind: "action",
                                id: "lookup",
                                text: "Look up the account.",
                                title: "Lookup",
                            },
                        },
                        {
                            blockId: "close",
                            record: {
                                kind: "action",
                                id: "close",
                                text: "Ask whether more help is needed.",
                                title: "Wrap up",
                            },
                        },
                        {
                            blockId: "scope",
                            record: {
                                kind: "actionCollection",
                                id: "options",
                                text: "Source-listed options.",
                                order:
                                    order === "partial-collection"
                                        ? "any-order"
                                        : order,
                                actionIds:
                                    order === "partial-collection"
                                        ? ["lookup"]
                                        : ["lookup", "close"],
                            },
                        },
                    ],
                },
            ],
            agentRepresentation: { order },
        };
        const original = JSON.stringify(procedure);
        const root = renderExtensionView(procedure, jest.fn());
        expect(
            root.querySelector(".hub-procedure-option-order")?.textContent,
        ).toBe(
            order === "any-order"
                ? "Try the listed options in any order."
                : undefined,
        );
        expect(root.querySelector(".hub-procedure-overview")).toBeNull();
        expect(JSON.stringify(procedure)).toBe(original);
    },
);

test.each(["resolved", "escalated", "unresolved"])(
    "human guide retains %s closing instructions without exposing outcome metadata",
    (result) => {
        const procedure = readableProcedureFixture();
        if (procedure.content.kind !== "extension")
            throw new Error("Expected extension");
        const payload = procedure.content.payload;
        if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload) ||
            !Array.isArray(payload.procedures)
        )
            throw new Error("Expected procedures");
        const procedureRecord = payload.procedures[0];
        if (
            !procedureRecord ||
            typeof procedureRecord !== "object" ||
            Array.isArray(procedureRecord) ||
            !Array.isArray(procedureRecord.records)
        )
            throw new Error("Expected records");
        procedureRecord.records[5] = {
            blockId: "unknown",
            record: {
                kind: "outcome",
                id: "unknown",
                result,
                text: "Explain the result and end the conversation.",
            },
        };
        procedure.content.sections[5].body = `Explain the result and end the conversation.\nTerminal outcome: ${result}`;
        const original = JSON.stringify(procedure);
        const root = renderExtensionView(procedure, jest.fn());
        const closure = root.querySelector(".hub-procedure-outcomes")!;
        expect(closure.querySelector("h3")!.textContent).toBe("How to finish");
        expect(
            closure.querySelector(".hub-procedure-instruction")!.textContent,
        ).toBe("Explain the result and end the conversation.");
        const details = closure.querySelector<HTMLDetailsElement>(
            ".hub-procedure-claim-details",
        )!;
        expect(details.open).toBe(false);
        expect(details.textContent).toContain(`Terminal outcome: ${result}`);
        expect(JSON.stringify(procedure)).toBe(original);
    },
);

test("related gap warnings use exact evidence bindings, not text guesses, and link to the pinned evidence claim", () => {
    const procedure = readableProcedureFixture();
    if (procedure.content.kind !== "extension")
        throw new Error("Expected extension");
    procedure.content.evidence[2].support = [
        { ...source, revisionId: "another-revision" },
    ];
    procedure.content.evidence[0].support = [];
    procedure.content.evidence[0].opposition = [source];
    const original = JSON.stringify(procedure);
    const root = renderExtensionView(procedure, jest.fn());
    document.body.replaceChildren(root);
    const warning = root.querySelector<HTMLDetailsElement>(
        '[data-block-id="lookup"] .hub-procedure-action-gap',
    )!;
    expect(warning.open).toBe(false);
    expect(warning.querySelector("summary")!.textContent).toBe(
        "Related source gap: review before using this action",
    );
    expect(warning.textContent).toContain(
        "The source disagrees about the opening order.",
    );
    expect(warning.querySelector("a")!.getAttribute("href")).toBe(
        `#/views/${encodeURIComponent(procedure.corpusId)}/${encodeURIComponent(procedure.viewId)}/revision/${encodeURIComponent(procedure.revisionId)}/page/ambiguity/layout/evidence`,
    );
    expect(
        root.querySelector(
            '[data-block-id="choices"] .hub-procedure-action-gap',
        ),
    ).not.toBeNull();
    expect(
        root.querySelector('[data-block-id="close"] .hub-procedure-action-gap'),
    ).toBeNull();
    root.querySelector<HTMLButtonElement>(
        '[role="tab"][id$="-evidence"]',
    )!.click();
    expect(root.querySelectorAll(".hub-procedure-action-gap")).toHaveLength(0);
    expect(root.querySelectorAll('[data-block-id="ambiguity"]')).toHaveLength(
        1,
    );
    expect(JSON.stringify(procedure)).toBe(original);
});

test("procedure reference numbers preserve exact excerpts and roles across cards and layouts", () => {
    const procedure = readableProcedureFixture();
    if (procedure.content.kind !== "extension")
        throw new Error("Expected extension");
    const other = { ...source, locator: "chars:11-20", excerpt: "More text" };
    procedure.content.citations.push(other);
    procedure.content.evidence[0].support.push(other);
    procedure.content.evidence[1].opposition.push(other);
    const original = JSON.stringify(procedure);
    const open = jest.fn();
    const root = renderExtensionView(procedure, open);
    document.body.replaceChildren(root);
    const references = root.querySelectorAll<HTMLButtonElement>(
        ".hub-procedure-source",
    );
    expect(
        [...references].every((button) =>
            /^\[\d+\]$/.test(button.textContent!),
        ),
    ).toBe(true);
    const lookup = root.querySelector('[data-block-id="lookup"]')!;
    expect(
        [...lookup.querySelectorAll(".hub-procedure-source")].map(
            (button) => button.textContent,
        ),
    ).toEqual(["[1]", "[2]"]);
    expect(
        root.querySelector('[data-block-id="close"] .hub-procedure-source')!
            .textContent,
    ).toBe("[1]");
    const opposing = root.querySelector<HTMLButtonElement>(
        '[data-block-id="choices"] button[aria-label^="Open opposing"]',
    )!;
    expect(opposing.textContent).toBe("[2]");
    expect(opposing.title).toContain(other.locator);
    expect(opposing.getAttribute("aria-label")).toContain(other.revisionId);
    root.querySelector<HTMLDetailsElement>(
        '[data-block-id="choices"] .hub-procedure-claim-details',
    )!.open = true;
    opposing.click();
    const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
    expect(dialog.querySelector("blockquote")!.textContent).toBe(other.excerpt);
    expect(dialog.textContent).toContain("Opposing original source");
    [...dialog.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open retained original")!
        .click();
    expect(open).toHaveBeenCalledWith(other);
    expect(document.activeElement).toBe(opposing);
    root.querySelector<HTMLButtonElement>(
        '[role="tab"][id$="-evidence"]',
    )!.click();
    expect(
        [
            ...root.querySelectorAll(
                '[data-block-id="lookup"] .hub-procedure-source',
            ),
        ].map((button) => button.textContent),
    ).toEqual(["[1]", "[2]"]);
    expect(
        root.querySelector(
            '[data-block-id="choices"] button[aria-label^="Open opposing"]',
        )!.textContent,
    ).toBe("[2]");
    root.querySelector<HTMLButtonElement>(
        '[role="tab"][id$="-agent"]',
    )!.click();
    expect(JSON.parse(root.querySelector("pre")!.textContent!)).toEqual(
        procedure.content.payload &&
            typeof procedure.content.payload === "object" &&
            !Array.isArray(procedure.content.payload)
            ? procedure.content.payload.agentRepresentation
            : null,
    );
    expect(JSON.stringify(procedure)).toBe(original);
});

test.each([[], [["Too", "Few"]], "not-an-array"])(
    "malformed decision table is reported rather than silently discarded (%j)",
    (rows) => {
        expect(() =>
            renderExtensionView(readableProcedureFixture(rows), jest.fn()),
        ).toThrow();
    },
);
