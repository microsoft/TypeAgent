// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    TimelineContent,
    ViewRelationshipInput,
} from "@typeagent/memory-service";
import { createTimelineEditor } from "./memoryHubTimeline";
import { mountMemoryHubViews } from "./memoryHubViews";
import { invokeMemory, invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const evidence = invokeView as jest.Mock<Promise<unknown>, [string, unknown]>;
const head = "a".repeat(40);
const citation = {
    sourceId: "event-1",
    revisionId: "b".repeat(64),
    evidence: { kind: "event" as const, eventId: "event-1" },
    locator: "chars:0-6",
    excerpt: "record",
};
const content: TimelineContent = {
    kind: "timeline",
    title: "Incident timeline",
    summary: "Evidence chronology",
    generatedAt: "2026-10-08T12:00:00.000Z",
    citations: [citation],
    sections: [
        {
            id: "event-1",
            role: "event",
            heading: "Correction",
            body: "Original recorded narrative",
            details: {
                kind: "event",
                identity: { kind: "canonicalEvent", eventId: "event-1" },
                eventType: "correction",
                state: "confirmed",
                outcome: null,
                occurredAt: "2026-10-05T08:45:00.000Z",
                learnedAt: "2026-10-06T08:05:00.000Z",
                capturedAt: "2026-10-08T11:00:00.000Z",
                inventoryIds: ["fact"],
            },
        },
    ],
};
const edges: ViewRelationshipInput[] = [
    {
        id: "support",
        predicate: "supportedBy",
        from: { kind: "section", viewId: "timeline", sectionId: "event-1" },
        to: {
            kind: "source",
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            evidence: citation.evidence,
        },
        citations: [citation],
    },
];
async function settle() {
    for (let index = 0; index < 40; index++) await Promise.resolve();
}
function click(host: HTMLElement, label: string) {
    const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
    );
    if (!button) throw new Error(`Missing timeline button ${label}`);
    button.click();
}
function input(host: HTMLElement, label: string, value: string) {
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `[aria-label="${label}"]`,
    );
    if (!field) throw new Error(`Missing timeline field ${label}`);
    field.value = value;
    field.dispatchEvent(new Event("input"));
}

test("fixed timeline reader separates four times, keeps identity and metadata read-only, edits narrative and opens exact event evidence", () => {
    const changed = jest.fn();
    const show = jest.fn();
    const editor = createTimelineEditor(content, edges, changed, show);
    expect(editor.element.querySelector("table")!.textContent).toContain(
        "2026-10-05T08:45",
    );
    expect(editor.element.textContent).toContain("2026-10-06T08:05");
    expect(editor.element.textContent).toContain("Generated: 2026-10-08T12:00");
    expect(editor.element.querySelectorAll("select")).toHaveLength(3);
    expect(editor.element.querySelector('[aria-label="Occurred"]')).toBeNull();
    input(editor.element, "Narrative event-1", "Human narrative clarification");
    expect(editor.read().sections[0].details).toEqual(
        content.sections[0].details,
    );
    expect(editor.read().sections[0].body).toBe(
        "Human narrative clarification",
    );
    click(editor.element, "Open exact event evidence event-1");
    expect(show).toHaveBeenCalledWith(citation);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(content.sections[0].body).toBe("Original recorded narrative");
});

test("record removal is an explicit typed edit with dangling relationships removed", () => {
    const editor = createTimelineEditor(content, edges, jest.fn(), jest.fn());
    click(editor.element, "Remove record event-1");
    expect(editor.read().sections).toHaveLength(0);
    expect(editor.relationships()).toHaveLength(0);
});

describe("Memory Hub timeline controls", () => {
    let host: HTMLElement;
    let panel: ReturnType<typeof mountMemoryHubViews>;
    let errors: unknown[];
    let scope: string | undefined;
    const view = {
        corpusId: "c",
        viewId: "timeline",
        revisionId: "current",
        version: 1,
        state: "draft",
        content,
        definition: {
            viewId: "timeline",
            kind: "timeline",
            selector: {
                kind: "timelineEvidence",
                sources: [],
                events: [{ eventId: "event-1" }],
            },
        },
        relationships: edges.map((edge) => ({
            ...edge,
            schemaVersion: 1,
            family: "evidence",
            origin: "generator",
            reviewState: "unreviewed",
        })),
    };
    beforeEach(() => {
        host = document.createElement("div");
        document.body.replaceChildren(host);
        errors = [];
        scope = "c";
        invoke.mockReset();
        evidence.mockReset();
        invoke.mockImplementation(async (method) => {
            switch (method) {
                case "memoryViewCapabilities":
                    return {
                        derivedViews: { builds: true, kinds: ["timeline"] },
                    };
                case "memoryListViews":
                    return { head, views: [view] };
                case "memoryListViewBuilds":
                    return [];
                case "memoryGetViewPublicationPolicy":
                    return { revision: 0, autoPublish: false, views: {} };
                case "memoryGetViewPublication":
                    return {
                        viewId: "timeline",
                        indexState: "absent",
                        reason: "Not published",
                    };
                case "memoryListSources":
                    return { items: [], total: 0 };
                case "memoryListEvents":
                    return {
                        items: [
                            {
                                eventId: "event-1",
                                eventType: "correction",
                                eventTime: "2026-10-05T08:45:00Z",
                                observedAt: "2026-10-06T08:05:00Z",
                                createdAt: "2026-10-08T11:00:00Z",
                            },
                        ],
                        total: 1,
                    };
                case "memoryBuildViews":
                    return {
                        jobId: "job",
                        corpusId: "c",
                        state: "complete",
                        results: [
                            {
                                viewId: "timeline",
                                state: "skipped",
                                reason: "Empty eligible checkpoint",
                                snapshot: {
                                    inputs: [],
                                    fingerprint: "b".repeat(64),
                                },
                            },
                        ],
                    };
                case "memorySaveViewDraft":
                    return { version: view };
                default:
                    throw new Error(`Unexpected timeline operation ${method}`);
            }
        });
        evidence.mockResolvedValue({
            title: "Canonical correction",
            content: "exact canonical record",
            offset: 0,
            totalChars: 22,
        });
        panel = mountMemoryHubViews(host, {
            scope: () => scope,
            onError: (error) => errors.push(error),
        });
    });
    afterEach(() => panel.dispose());
    test("event-only build sends discriminated selector and explicit knowledge/occurrence bounds", async () => {
        await panel.refresh();
        const checkbox = host.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
        )!;
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change"));
        input(host, "Stable view ID", "timeline");
        input(host, "Learned before ISO timestamp", "2026-10-05T12:00:00Z");
        input(host, "Occurred from ISO timestamp", "2026-10-05T00:00:00Z");
        input(host, "Occurred to ISO timestamp", "2026-10-06T00:00:00Z");
        click(host, "Build views");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({
                targets: [
                    {
                        expectedVersion: 1,
                        definition: {
                            viewId: "timeline",
                            kind: "timeline",
                            selector: {
                                kind: "timelineEvidence",
                                sources: [],
                                events: [{ eventId: "event-1" }],
                            },
                        },
                    },
                ],
                bounds: {
                    learnedBefore: "2026-10-05T12:00:00Z",
                    occurredFrom: "2026-10-05T00:00:00Z",
                    occurredTo: "2026-10-06T00:00:00Z",
                },
            }),
        );
        expect(host.textContent).toContain("Empty eligible checkpoint");
        expect(errors).toEqual([]);
    });
    test("fixed timeline editor saves attributed shape and reads event evidence without nonexistent source lookup", async () => {
        await panel.refresh();
        click(host, "Incident timeline (draft, v1)");
        expect(
            host.querySelector(
                '[aria-label="Draft content with stable section IDs"]',
            ),
        ).toBeNull();
        input(
            host,
            "Narrative event-1",
            "Human clarification\nOriginal recorded narrative",
        );
        click(host, "Open exact event evidence event-1");
        await settle();
        expect(evidence).toHaveBeenCalledWith("memoryHubEvidence", {
            corpusId: "c",
            kind: "event",
            objectId: "event-1",
            revisionId: citation.revisionId,
        });
        click(host, "Save explicit edits");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memorySaveViewDraft",
            expect.objectContaining({
                content: expect.objectContaining({
                    kind: "timeline",
                    sections: [
                        expect.objectContaining({
                            body: "Human clarification\nOriginal recorded narrative",
                            details: content.sections[0].details,
                        }),
                    ],
                }),
            }),
        );
        expect(errors).toEqual([]);
    });
    test("late event evidence cannot render after corpus scope changes", async () => {
        let complete: (value: unknown) => void = () => {
            throw new Error("No deferred timeline evidence");
        };
        evidence.mockImplementation(
            () =>
                new Promise((resolve) => {
                    complete = resolve;
                }),
        );
        await panel.refresh();
        click(host, "Incident timeline (draft, v1)");
        click(host, "Open exact event evidence event-1");
        await settle();
        scope = undefined;
        panel.scopeChanged();
        complete({ title: "Late private event", content: "Must not render" });
        await settle();
        expect(host.textContent).not.toContain("Must not render");
    });
});
