// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProjectBriefContent } from "@typeagent/memory-service";
import { createProjectBriefEditor } from "./memoryHubProjectBrief";
import { mountMemoryHubViews } from "./memoryHubViews";
import { invokeMemory, invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const evidence = invokeView as jest.Mock<Promise<unknown>, [string, unknown]>;
const content: ProjectBriefContent = {
    kind: "projectBrief",
    title: "Payments reliability",
    summary: "Project active; incident closed",
    citations: [
        {
            sourceId: "status",
            revisionId: "current",
            locator: "chars:0-12",
            excerpt: "Project open",
        },
    ],
    sections: [
        {
            id: "goals",
            role: "goalsScope",
            heading: "Goals",
            body: "Preserve headroom",
            details: { kind: "goalsScope", inventoryIds: ["goal"] },
        },
        {
            id: "owners",
            role: "owners",
            heading: "Owners",
            body: "Capacity validation owner unknown",
            details: {
                kind: "owners",
                assignments: [
                    {
                        inventoryId: "owner",
                        responsibility: "Capacity validation",
                        state: "unknown",
                        owner: null,
                    },
                ],
            },
        },
        {
            id: "status",
            role: "status",
            heading: "Status",
            body: "Capacity BLOCKED pending owner review",
            details: {
                kind: "status",
                project: "active",
                incident: "closed",
                capacity: "pendingOwnerReview",
                inventoryIds: ["status"],
            },
        },
        {
            id: "milestones",
            role: "milestones",
            heading: "Milestones",
            body: "Peak-load rehearsal proposed",
            details: {
                kind: "milestones",
                items: [
                    {
                        inventoryId: "milestone",
                        status: "proposed",
                        date: null,
                    },
                ],
            },
        },
        {
            id: "decisions",
            role: "decisions",
            heading: "Decisions",
            body: "Query explanation rejected",
            details: {
                kind: "decisions",
                items: [{ inventoryId: "decision", status: "rejected" }],
            },
        },
        {
            id: "risks",
            role: "risks",
            heading: "Risks",
            body: "Workload memory/headroom warning",
            details: {
                kind: "risks",
                items: [{ inventoryId: "risk", status: "open" }],
            },
        },
        {
            id: "context",
            role: "context",
            heading: "Context",
            body: "Project knowledge as-of unknown",
            details: {
                kind: "context",
                asOf: null,
                basis: "unknown",
                inventoryIds: ["context"],
            },
        },
    ],
};
const view = {
    corpusId: "payments",
    viewId: "payments-brief",
    revisionId: "brief-revision",
    version: 1,
    state: "draft",
    provenance: "generated",
    content,
    actor: "generator",
    relationships: [],
    definition: {
        viewId: "payments-brief",
        kind: "projectBrief",
        selector: {
            kind: "sources",
            sources: [{ sourceId: "status", revisionId: "current" }],
        },
    },
};
const head = "a".repeat(40);
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}
function click(host: HTMLElement, label: string) {
    const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
    );
    if (!button) throw new Error(`Missing project control: ${label}`);
    button.click();
}
function change(host: HTMLElement, label: string, value: string) {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[aria-label="${label}"]`,
    );
    if (!input) throw new Error(`Missing project field: ${label}`);
    input.value = value;
    input.dispatchEvent(new Event("input"));
}

test("fixed project template uses human-readable fields, honest unknowns and exact evidence, without execution controls", () => {
    const changed = jest.fn();
    const original = jest.fn();
    const editor = createProjectBriefEditor(content, changed, original);
    document.body.replaceChildren(editor.element);
    expect(editor.element.querySelectorAll("fieldset")).toHaveLength(7);
    expect(editor.element.textContent).toContain(
        "Project knowledge as-of: Unknown",
    );
    expect(editor.element.textContent).toContain("not executable guides");
    expect(editor.element.textContent).not.toContain('"inventoryIds"');
    expect(editor.element.textContent).not.toContain("Activate skill");
    change(editor.element, "Project brief title", "Edited project brief");
    change(
        editor.element,
        "Goals and scope narrative and checked facts",
        "Human context note",
    );
    expect(editor.read().title).toBe("Edited project brief");
    expect(editor.read().sections[0].body).toBe("Human context note");
    expect(content.title).toBe("Payments reliability");
    expect(content.sections[0].body).toBe("Preserve headroom");
    expect(changed).toHaveBeenCalledTimes(2);
    click(editor.element, "status @ current chars:0-12");
    expect(original).toHaveBeenCalledWith("status", "current", "chars:0-12");
});

describe("Memory Hub project brief selector, editor and scope safety", () => {
    let host: HTMLElement;
    let panel: ReturnType<typeof mountMemoryHubViews>;
    let scope: string | undefined;
    let errors: unknown[];
    beforeEach(() => {
        host = document.createElement("div");
        document.body.replaceChildren(host);
        scope = "payments";
        errors = [];
        invoke.mockReset();
        evidence.mockReset();
        invoke.mockImplementation(async (method) => {
            switch (method) {
                case "memoryViewCapabilities":
                    return {
                        derivedViews: {
                            builds: true,
                            kinds: ["troubleshootingGuide", "projectBrief"],
                        },
                    };
                case "memoryListViews":
                    return { head, views: [view] };
                case "memoryListViewBuilds":
                    return [];
                case "memoryGetViewPublicationPolicy":
                    return { revision: 0, autoPublish: true, views: {} };
                case "memoryGetViewPublication":
                    return {
                        viewId: view.viewId,
                        indexState: "absent",
                        reason: "Draft only",
                    };
                case "memoryListSources":
                    return {
                        items: [
                            {
                                sourceId: "status",
                                title: "Status evidence",
                                activeRevisionId: "current",
                                revisions: [
                                    { revisionId: "current", state: "ready" },
                                ],
                            },
                        ],
                        total: 1,
                    };
                case "memoryBuildViews":
                    return {
                        corpusId: "payments",
                        jobId: "build",
                        state: "complete",
                        results: [],
                    };
                case "memorySaveViewDraft":
                    return { commitId: head, version: view };
                default:
                    throw new Error(`Unexpected project operation ${method}`);
            }
        });
        panel = mountMemoryHubViews(host, {
            scope: () => scope,
            onError: (error) => errors.push(error),
        });
    });
    afterEach(() => panel.dispose());
    test("kind picker builds exact sources and fixed-template edits retain project kind and source selector", async () => {
        await panel.refresh();
        const picker = host.querySelector<HTMLSelectElement>(
            '[aria-label="View kind"]',
        )!;
        expect([...picker.options].map((option) => option.textContent)).toEqual(
            ["Troubleshooting guide", "Project brief"],
        );
        picker.value = "projectBrief";
        change(host, "Stable view ID", "new-project-brief");
        const checkbox = host.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
        click(host, "Build views");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({
                corpusId: "payments",
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: "new-project-brief",
                            kind: "projectBrief",
                            selector: view.definition.selector,
                        },
                    },
                ],
            }),
        );
        click(host, "Payments reliability (draft, v1)");
        expect(
            host.querySelector('[aria-label="Project brief fixed template"]'),
        ).not.toBeNull();
        expect(
            host.querySelector(
                '[aria-label="Draft content with stable section IDs"]',
            ),
        ).toBeNull();
        change(host, "Project brief title", "Human project brief");
        click(host, "Save explicit edits");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memorySaveViewDraft",
            expect.objectContaining({
                definition: view.definition,
                content: expect.objectContaining({
                    kind: "projectBrief",
                    title: "Human project brief",
                }),
            }),
        );
        expect(errors).toEqual([]);
    });
    test("dirty project editor blocks builds without losing changes", async () => {
        await panel.refresh();
        click(host, "Payments reliability (draft, v1)");
        change(host, "Project brief title", "Unsaved project brief");
        click(host, "Build views");
        await settle();
        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toContain("Save or explicitly discard");
        expect(
            host.querySelector<HTMLInputElement>(
                '[aria-label="Project brief title"]',
            )?.value,
        ).toBe("Unsaved project brief");
        expect(
            invoke.mock.calls.some(([method]) => method === "memoryBuildViews"),
        ).toBe(false);
    });
    test("late original evidence cannot appear after a scope change; All memory grants no build authority", async () => {
        let resolve!: (value: unknown) => void;
        evidence.mockImplementation(
            () =>
                new Promise((result) => {
                    resolve = result;
                }),
        );
        await panel.refresh();
        click(host, "Payments reliability (draft, v1)");
        click(host, "status @ current chars:0-12");
        await settle();
        scope = undefined;
        panel.scopeChanged();
        resolve({
            title: "Old corpus evidence",
            content: "Do not leak across scope",
            available: true,
        });
        await settle();
        expect(host.textContent).not.toContain("Do not leak across scope");
        expect(host.textContent).toContain("Choose a named corpus");
        expect(host.querySelector('[aria-label="View kind"]')).toBeNull();
    });
    test("older capabilities do not advertise or open an unsupported project kind", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryViewCapabilities"
                ? Promise.resolve({
                      derivedViews: {
                          builds: true,
                          kinds: ["troubleshootingGuide"],
                      },
                  })
                : original(method, params),
        );
        await panel.refresh();
        expect(host.textContent).not.toContain(
            "Payments reliability (draft, v1)",
        );
        expect(
            host.querySelector<HTMLSelectElement>('[aria-label="View kind"]')!
                .options,
        ).toHaveLength(1);
    });
});
