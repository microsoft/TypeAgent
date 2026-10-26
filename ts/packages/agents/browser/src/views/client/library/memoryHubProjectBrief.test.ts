// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryFixture } from "./memoryHubInventoryTestData";

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
    construction: "informational-project-summary-v1",
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
            details: { kind: "goalsScope" },
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
                        id: "owner",
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
                        id: "milestone",
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
                items: [{ id: "decision", status: "rejected" }],
            },
        },
        {
            id: "risks",
            role: "risks",
            heading: "Risks",
            body: "Workload memory/headroom warning",
            details: {
                kind: "risks",
                items: [{ id: "risk", status: "open" }],
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
        projectSummary: {
            construction: "informational-project-summary-v1",
            query: "Payments",
            aliases: [],
            excludedSourceIds: [],
        },
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

test("project summary input omits blank values and preserves nonblank text", () => {
    const changed = jest.fn();
    const editor = createProjectBriefEditor(content, changed, jest.fn());
    change(editor.element, "Project brief summary", "");
    expect(editor.read()).not.toHaveProperty("summary");
    change(editor.element, "Project brief summary", " \t\n ");
    expect(editor.read()).not.toHaveProperty("summary");
    change(editor.element, "Project brief summary", "  Updated summary\n ");
    expect(editor.read().summary).toBe("  Updated summary\n ");
    expect(content.summary).toBe("Project active; incident closed");
    expect(changed).toHaveBeenCalledTimes(3);
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
        invoke.mockImplementation(
            inventoryFixture(async (method) => {
                switch (method) {
                    case "memoryViewCapabilities":
                        return {
                            derivedViews: {
                                builds: true,
                                kinds: ["troubleshootingGuide", "projectBrief"],
                            },
                        };
                    case "memoryListCorpora":
                        return [{ corpusId: "payments", name: "Payments" }];
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
                                        {
                                            revisionId: "current",
                                            state: "ready",
                                        },
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
                        throw new Error(
                            `Unexpected project operation ${method}`,
                        );
                }
            }),
        );
        panel = mountMemoryHubViews(host, {
            scope: () => scope,
            onError: (error) => errors.push(error),
        });
    });
    afterEach(() => {
        panel.dispose();
        jest.restoreAllMocks();
    });
    test("kind picker builds indexed project summaries and fixed-template edits retain the query selector", async () => {
        await panel.refresh();
        click(host, "Build views");
        await settle();
        host.querySelector<HTMLInputElement>(
            'input[aria-label="Project brief"]',
        )!.click();
        change(host, "Indexed project summary query", "Payments");
        click(host, "Continue to confirmation");
        await settle();
        click(host, "Start build");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({
                corpusId: "payments",
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId: expect.stringMatching(/^projectBrief-/),
                            kind: "projectBrief",
                            selector: { kind: "sources", sources: [] },
                            projectSummary: view.definition.projectSummary,
                        },
                    },
                ],
            }),
        );
        click(host, "Payments reliability");
        await settle();
        click(host, "Edit");
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
    test.each(["", " \t\n ", "  Updated summary\n "])(
        "saving project summary %j omits blank values and preserves nonblank text",
        async (summary) => {
            await panel.refresh();
            click(host, "Payments reliability");
            await settle();
            click(host, "Edit");
            change(host, "Project brief summary", summary);
            click(host, "Save explicit edits");
            await settle();
            const request = invoke.mock.calls.find(
                ([method]) => method === "memorySaveViewDraft",
            )?.[1];
            expect(request).toEqual(
                expect.objectContaining({
                    definition: view.definition,
                    content: expect.objectContaining({ kind: "projectBrief" }),
                }),
            );
            if (summary.trim()) {
                expect(request).toHaveProperty("content.summary", summary);
            } else {
                expect(request).not.toHaveProperty("content.summary");
            }
            expect(errors).toEqual([]);
        },
    );
    test("dirty project editor blocks builds without losing changes", async () => {
        await panel.refresh();
        click(host, "Payments reliability");
        await settle();
        click(host, "Edit");
        change(host, "Project brief title", "Unsaved project brief");
        jest.spyOn(window, "confirm").mockReturnValue(false);
        await panel.buildFromSources("payments");
        expect(errors).toHaveLength(0);
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
        click(host, "Payments reliability");
        await settle();
        click(host, "Edit");
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
        expect(host.textContent).toContain("across your collections");
        expect(host.querySelector('[aria-label="View kind"]')).toBeNull();
    });
    test("older capabilities do not advertise or open an unsupported project kind", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation(
            inventoryFixture((method, params) =>
                method === "memoryViewCapabilities"
                    ? Promise.resolve({
                          derivedViews: {
                              builds: true,
                              kinds: ["troubleshootingGuide"],
                          },
                      })
                    : original(method, params),
            ),
        );
        await panel.refresh();
        expect(host.textContent).not.toContain("Payments reliability");
        click(host, "Build views");
        await settle();
        expect(host.querySelectorAll(".hub-view-kind")).toHaveLength(1);
    });
});
