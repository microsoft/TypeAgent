// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubViews } from "./memoryHubViews";
import { viewRevisionTime, viewTimestamp } from "./memoryHubViewUi";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const head = "a".repeat(40);
const fingerprint = "b".repeat(64);
const content = {
    kind: "troubleshootingGuide",
    title: "Guide",
    sections: [
        {
            id: "description",
            role: "description",
            heading: "Goal",
            body: "Original **body** <script>alert(1)</script> ![asset](https://example.test/private.png)",
        },
    ],
    citations: [],
};
const definition = {
    viewId: "guide",
    kind: "troubleshootingGuide",
    selector: {
        kind: "sources",
        sources: [{ sourceId: "s", revisionId: "r" }],
    },
};
const view = {
    corpusId: "c",
    viewId: "guide",
    revisionId: "v1",
    version: 1,
    state: "draft",
    content,
    definition,
    relationships: [],
    actor: "local-user",
    provenance: "generated",
};
const snapshot = { head, views: [view] };
const job = {
    jobId: "c8f28c3f-f068-44d3-a2e6-5c4f8719bbcc",
    corpusId: "c",
    state: "partial",
    results: [
        {
            viewId: "guide",
            state: "conflicted",
            reason: "Overlap retained",
            conflictId: "ce162015-10df-4d88-b43c-d556fdfcf5b1",
            snapshot: {
                fingerprint,
                inputs: [{ sourceId: "s", revisionId: "r" }],
            },
        },
    ],
};
async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}
function click(host: HTMLElement, label: string) {
    const button = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === label,
    );
    if (!button) throw new Error(`Missing button ${label}`);
    for (
        let parent = button.parentElement;
        parent;
        parent = parent.parentElement
    )
        if (parent instanceof HTMLDetailsElement) parent.open = true;
    button.click();
}
function check(host: HTMLElement, label: string) {
    const control = host.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`,
    );
    if (!control) throw new Error(`Missing checkbox ${label}`);
    control.click();
}

describe("Memory Center preview-first views", () => {
    let host: HTMLElement;
    let panel: ReturnType<typeof mountMemoryHubViews>;
    let scope: string | undefined;
    let enabled: boolean;
    let errors: unknown[];
    let navigate: jest.Mock;
    let openView: jest.Mock;
    let buildStarted: jest.Mock;
    beforeEach(() => {
        host = document.createElement("div");
        document.body.replaceChildren(host);
        scope = "c";
        enabled = true;
        errors = [];
        navigate = jest.fn();
        openView = jest.fn();
        buildStarted = jest.fn();
        jest.spyOn(window, "confirm").mockReturnValue(true);
        invoke.mockReset();
        invoke.mockImplementation(async (method) => {
            switch (method) {
                case "memoryViewCapabilities":
                    return {
                        derivedViews: enabled
                            ? {
                                  builds: true,
                                  kinds: [
                                      "wiki",
                                      "projectBrief",
                                      "timeline",
                                      "troubleshootingGuide",
                                  ],
                                  maintenance: true,
                              }
                            : undefined,
                    };
                case "memoryListCorpora":
                    return [{ corpusId: "c", name: "My collection" }];
                case "memoryListViews":
                    return snapshot;
                case "memoryListViewBuilds":
                    return [];
                case "memoryGetViewPublicationPolicy":
                    return { revision: 7, autoPublish: true, views: {} };
                case "memoryGetViewPublication":
                    return {
                        viewId: "guide",
                        publishedRevisionId: "v1",
                        indexState: "failed",
                        reason: "Index failed",
                    };
                case "memoryListSources":
                    return {
                        items: [
                            {
                                sourceId: "s",
                                title: "Evidence",
                                activeRevisionId: "r",
                                revisions: [
                                    { revisionId: "r", state: "ready" },
                                ],
                            },
                            {
                                sourceId: "pending",
                                title: "Not ready",
                                activeRevisionId: "rp",
                                revisions: [
                                    { revisionId: "rp", state: "pending" },
                                ],
                            },
                        ],
                        total: 2,
                    };
                case "memoryListEvents":
                    return {
                        items: [
                            {
                                eventId: "event-1",
                                eventType: "decision",
                                eventTime: "2026-10-09T12:00:00Z",
                                observedAt: "2026-10-09T13:00:00Z",
                                createdAt: "2026-10-09T14:00:00Z",
                            },
                        ],
                        total: 1,
                    };
                case "memoryGetSourceContent":
                    return {
                        revisionId: "r",
                        content:
                            "## Record record-1\nOccurred at: 2026-10-09T12:00:00Z\nRecorded / known at: 2026-10-09T13:00:00Z\nState: confirmed\n",
                        truncated: false,
                    };
                case "memoryBuildViews":
                    return job;
                case "memoryGetViewConflict":
                    return {
                        conflictId: job.results[0].conflictId,
                        corpusId: "c",
                        viewId: "guide",
                        state: "pending",
                        expectedRevisionId: "v1",
                        targets: ["section:description"],
                        input: { fingerprint },
                        base: {
                            content: { ...content, title: "Generated base" },
                        },
                        human: {
                            ...view,
                            content: { ...content, title: "Human draft" },
                        },
                        candidate: {
                            content: { ...content, title: "New candidate" },
                            relationships: [],
                            outcome: "diagnosticOnly",
                            missingEvidence: ["Recovery"],
                        },
                    };
                case "memorySaveViewDraft":
                case "memoryResolveViewConflict":
                    return { commitId: head, version: view };
                default:
                    throw new Error(`Unexpected method ${method}`);
            }
        });
        panel = mountMemoryHubViews(host, {
            scope: () => scope,
            onError: (error) => errors.push(error),
            onNavigate: navigate,
            onOpenView: openView,
            onBuildStarted: buildStarted,
        });
    });
    afterEach(() => {
        panel.dispose();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    async function startBuild(kinds = ["Troubleshooting guide"]) {
        await panel.refresh();
        click(host, "Build views");
        await settle();
        for (const kind of kinds) check(host, kind);
        if (kinds.includes("Project brief")) {
            const query = host.querySelector<HTMLInputElement>(
                '[aria-label="Indexed project summary query"]',
            )!;
            query.value = "Project";
            query.dispatchEvent(new Event("input"));
        }
        check(host, "Use Evidence");
    }
    async function build(kinds?: string[]) {
        await startBuild(kinds);
        click(host, "Continue to confirmation");
        await settle();
        click(host, "Start build");
        await settle();
    }
    async function openEditor() {
        await panel.refresh();
        click(host, "Guide");
        await settle();
        click(host, "Edit");
    }
    async function openConflict() {
        await build();
        click(host, "Compare and resolve conflict");
        await settle();
    }
    test("disabled capability is informative and visible, never an empty vanished destination", async () => {
        enabled = false;
        await panel.refresh();
        expect(host.querySelector("section")!.hidden).toBe(false);
        expect(host.textContent).toContain("does not provide view building");
        expect(host.textContent).toContain("explicitly disabled by the host");
        expect(host.textContent).toContain(
            "No setting in Memory needs to be enabled",
        );
        expect(host.querySelector("button")).toBeNull();
    });
    test("list and detail are preview-first, sanitized and do not fetch remote assets", async () => {
        await panel.refresh();
        expect(host.querySelector("textarea")).toBeNull();
        expect(
            host.querySelector('[aria-label="View auto-publish after build"]'),
        ).toBeNull();
        click(host, "Guide");
        await settle();
        expect(
            host.querySelector(".hub-view-document strong")!.textContent,
        ).toBe("body");
        expect(host.querySelector(".hub-view-document script")).toBeNull();
        expect(host.querySelector(".hub-view-document img")).toBeNull();
        expect(host.querySelector("textarea")).toBeNull();
        expect(navigate).toHaveBeenCalledWith("#/views/c/guide");
        expect(host.querySelector("h2")!.textContent).toBe("Guide");
        click(host, "Edit");
        expect(
            host.querySelector('[aria-label="Troubleshooting guide editor"]'),
        ).not.toBeNull();
    });

    test("detail displays the selected revision timestamp outside unchanged summary", async () => {
        const original = invoke.getMockImplementation()!;
        const summary = "Substantive scope warning, not a host clock";
        invoke.mockImplementation((method, params) =>
            method === "memoryListViews"
                ? Promise.resolve({
                      ...snapshot,
                      views: [
                          {
                              ...view,
                              createdAt: "2026-10-13T16:00:00Z",
                              content: { ...content, summary },
                          },
                      ],
                  })
                : original(method, params),
        );
        await panel.refresh();
        click(host, "Guide");
        await settle();
        expect(host.querySelector("time")?.dateTime).toBe(
            "2026-10-13T16:00:00.000Z",
        );
        expect(host.textContent).toContain(summary);
        expect(content).not.toHaveProperty("summary");
    });
    test("reader keeps only Back and Edit direct and disclosure actions retain keyboard and dialog focus", async () => {
        await panel.refresh();
        click(host, "Guide");
        await settle();
        const toolbar = host.querySelector<HTMLElement>(".hub-view-actions")!;
        expect(
            [...toolbar.children]
                .filter((child) => child.tagName === "BUTTON")
                .map((button) => button.textContent),
        ).toEqual(["Back to views", "Edit"]);
        const more = toolbar.querySelector<HTMLDetailsElement>(
            ".hub-view-more-actions",
        )!;
        const summary = more.querySelector("summary")!;
        expect(summary.textContent).toBe("More actions");
        expect(more.open).toBe(false);
        expect(
            [...more.querySelectorAll("button")].map(
                (button) => button.textContent,
            ),
        ).toEqual([
            "Rebuild from evidence",
            "Publication and search",
            "History",
            "Update view",
        ]);
        summary.focus();
        summary.click();
        expect(more.open).toBe(true);
        const publication = [...more.querySelectorAll("button")].find(
            (button) => button.textContent === "Publication and search",
        )!;
        publication.focus();
        publication.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(more.open).toBe(false);
        expect(document.activeElement).toBe(summary);
        summary.click();
        publication.focus();
        publication.click();
        expect(document.activeElement?.tagName).toBe("DIALOG");
        click(host, "Close");
        expect(document.activeElement).toBe(publication);
        expect(more.open).toBe(true);
    });
    test("All memory browsing isolates identical IDs by collection and build collection choice stays in the flow", async () => {
        scope = undefined;
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) => {
            if (method === "memoryListCorpora")
                return Promise.resolve([
                    { corpusId: "c", name: "One" },
                    { corpusId: "d", name: "Two" },
                ]);
            if (
                method === "memoryListViews" &&
                (params as { corpusId: string }).corpusId === "d"
            )
                return Promise.resolve({
                    head,
                    views: [
                        {
                            ...view,
                            corpusId: "d",
                            content: { ...content, title: "Other guide" },
                        },
                    ],
                });
            return original(method, params);
        });
        await panel.refresh();
        expect(host.textContent).toContain("Other guide");
        const cards = [...host.querySelectorAll<HTMLElement>(".hub-view-card")];
        expect(
            cards[0].querySelector(":scope > p:last-of-type")!.textContent,
        ).toBe("Collection: One");
        expect(
            cards[1].querySelector(":scope > p:last-of-type")!.textContent,
        ).toBe("Collection: Two");
        expect(cards[1].querySelector("details")!.open).toBe(false);
        expect(cards[1].querySelector("details")!.textContent).toContain(
            "Corpus ID: d",
        );
        expect(cards[1].textContent).not.toContain("Collection: d");
        click(host, "Other guide");
        await settle();
        expect(navigate).toHaveBeenCalledWith("#/views/d/guide");
        click(host, "Back to views");
        await settle();
        click(host, "Build views");
        await settle();
        expect(
            host.querySelector<HTMLSelectElement>(
                '[aria-label="Build collection"]',
            )!.value,
        ).toBe("");
        expect(host.textContent).toContain(
            "Builds use one explicit collection",
        );
    });
    test.each([undefined, "old"])(
        "direct reader revision %s loads corpus names before returning to the complete All-memory list",
        async (revisionId) => {
            scope = undefined;
            const original = invoke.getMockImplementation()!;
            invoke.mockImplementation((method, params) => {
                if (method === "memoryListCorpora")
                    return Promise.resolve([
                        { corpusId: "c", name: "Engineering demo" },
                        { corpusId: "d", name: "Research notes" },
                    ]);
                if (method === "memoryGetView")
                    return Promise.resolve({
                        ...view,
                        revisionId: "old",
                        content: { ...content, title: "Historical guide" },
                    });
                if (
                    method === "memoryListViews" &&
                    (params as { corpusId: string }).corpusId === "d"
                )
                    return Promise.resolve({
                        head,
                        views: [
                            {
                                ...view,
                                corpusId: "d",
                                content: {
                                    ...content,
                                    title: "Research guide",
                                },
                            },
                        ],
                    });
                return original(method, params);
            });
            await panel.show({ corpusId: "c", viewId: "guide", revisionId });
            const initialCard = host.querySelector(".hub-view-card")!;
            expect(initialCard.textContent).toContain(
                "Collection: Engineering demo",
            );
            expect(initialCard.textContent).not.toContain(
                "Collection name unavailable",
            );
            expect(
                invoke.mock.calls.findIndex(
                    ([method]) => method === "memoryListCorpora",
                ),
            ).toBeLessThan(
                invoke.mock.calls.findIndex(
                    ([method]) => method === "memoryListViews",
                ),
            );
            click(host, "Back to views");
            await settle();
            const cards = [...host.querySelectorAll(".hub-view-card")];
            expect(cards).toHaveLength(2);
            expect(cards[0].textContent).toContain(
                "Collection: Engineering demo",
            );
            expect(cards[1].textContent).toContain(
                "Collection: Research notes",
            );
            expect(
                host.querySelector(".hub-view-list")!.textContent,
            ).not.toContain("Collection name unavailable");
            expect(navigate).toHaveBeenCalledWith("#/views");
            expect(errors).toEqual([]);
        },
    );
    test("multiple friendly kinds produce exact explicit targets only after confirmation, generated IDs and real policy", async () => {
        await startBuild(["Troubleshooting guide", "Project brief"]);
        expect(
            host.querySelector('input[aria-label="Knowledge wiki"]'),
        ).toBeNull();
        expect(host.textContent).not.toContain("Not ready");
        expect(host.querySelector('[aria-label="Stable view ID"]')).toBeNull();
        click(host, "Continue to confirmation");
        await settle();
        expect(
            invoke.mock.calls.some(([method]) => method === "memoryBuildViews"),
        ).toBe(false);
        expect(host.textContent).toContain("On (corpus setting)");
        click(host, "Start build");
        await settle();
        const request = invoke.mock.calls.find(
            ([method]) => method === "memoryBuildViews",
        )![1] as {
            targets: Array<{
                expectedVersion: number;
                definition: { viewId: string; kind: string; selector: unknown };
            }>;
        };
        expect(request.targets.map((target) => target.definition.kind)).toEqual(
            ["troubleshootingGuide", "projectBrief"],
        );
        expect(request.targets[0].definition.viewId).toMatch(
            /^troubleshootingGuide-/,
        );
        expect(
            new Set(request.targets.map((target) => target.definition.viewId))
                .size,
        ).toBe(2);
        for (const target of request.targets) {
            expect(target.expectedVersion).toBe(0);
            expect(target.definition.selector).toEqual(definition.selector);
        }
        expect(request).not.toHaveProperty("name");
        expect(request).not.toHaveProperty("publication");
        expect(buildStarted).toHaveBeenCalledWith("c", job.jobId);
        expect(errors).toEqual([]);
    });
    test("Select all uses every ready source, remains visible while filtering and supports partial deselection", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryListSources"
                ? Promise.resolve({
                      items: ["s", "s2"].map((sourceId) => ({
                          sourceId,
                          title:
                              sourceId === "s" ? "Evidence" : "Other evidence",
                          activeRevisionId: "r",
                          revisions: [{ revisionId: "r", state: "ready" }],
                      })),
                      total: 2,
                  })
                : original(method, params),
        );
        await startBuild(["Project brief"]);
        const all = host.querySelector<HTMLInputElement>(
            '[aria-label="Select all sources"]',
        )!;
        all.click();
        expect(all.checked).toBe(true);
        check(host, "Use Other evidence");
        expect(all.indeterminate).toBe(true);
        all.click();
        const filter = host.querySelector<HTMLInputElement>(
            '[aria-label="Find ready sources"]',
        )!;
        filter.value = "Evidence";
        filter.dispatchEvent(new Event("input"));
        expect(all.parentElement!.hidden).toBe(false);
        click(host, "Continue to confirmation");
        await settle();
        click(host, "Start build");
        await settle();
        expect(
            invoke.mock.calls.find(
                ([method]) => method === "memoryBuildViews",
            )![1],
        ).toMatchObject({
            targets: [
                {
                    definition: {
                        selector: {
                            sources: [
                                { sourceId: "s", revisionId: "r" },
                                { sourceId: "s2", revisionId: "r" },
                            ],
                        },
                    },
                },
            ],
        });
        expect(errors).toEqual([]);
    });
    test("Select all never silently drops sources exceeding the 32-source target limit", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryListSources"
                ? Promise.resolve({
                      items: Array.from({ length: 33 }, (_, index) => ({
                          sourceId: index ? `s${index}` : "s",
                          title: index ? `Evidence ${index}` : "Evidence",
                          activeRevisionId: "r",
                          revisions: [{ revisionId: "r", state: "ready" }],
                      })),
                      total: 33,
                  })
                : original(method, params),
        );
        await startBuild(["Project brief"]);
        check(host, "Select all sources");
        expect(host.textContent).toContain("33 of 33 sources selected");
        click(host, "Continue to confirmation");
        await settle();
        expect(String(errors[0])).toContain("at most 32");
        expect(
            invoke.mock.calls.some(([method]) => method === "memoryBuildViews"),
        ).toBe(false);
    });
    test("one-build override sends false without changing saved policy", async () => {
        await startBuild();
        const policy = host.querySelector<HTMLSelectElement>(
            '[aria-label="Build auto-publish after build"]',
        )!;
        policy.value = "off";
        policy.dispatchEvent(new Event("change"));
        click(host, "Continue to confirmation");
        await settle();
        expect(host.textContent).toContain("Off (build override)");
        click(host, "Start build");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({ publication: false }),
        );
        expect(
            invoke.mock.calls.some(
                ([method]) => method === "memoryUpdateViewPublicationPolicy",
            ),
        ).toBe(false);
    });
    test("rebuild keeps stable identity, exact version and effective per-view publication override", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryGetViewPublicationPolicy"
                ? Promise.resolve({
                      revision: 7,
                      autoPublish: true,
                      views: { guide: { revision: 3, autoPublish: false } },
                  })
                : original(method, params),
        );
        await panel.refresh();
        click(host, "Guide");
        await settle();
        click(host, "Rebuild from evidence");
        await settle();
        expect(
            host.querySelector<HTMLSelectElement>(
                '[aria-label="Build collection"]',
            )!.disabled,
        ).toBe(true);
        expect(host.textContent).toContain("Off (view override)");
        click(host, "Continue to confirmation");
        await settle();
        click(host, "Start build");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({
                expectedHead: head,
                targets: [{ expectedVersion: 1, definition }],
            }),
        );
        expect(errors).toEqual([]);
    });
    test("timeline excludes non-record documents and normalizes explicit timezone bounds", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryGetSourceContent"
                ? Promise.resolve({
                      revisionId: "r",
                      content: "A reference with no explicit records",
                      truncated: false,
                  })
                : original(method, params),
        );
        await startBuild(["Evidence-linked timeline", "Troubleshooting guide"]);
        const event = host.querySelector<HTMLInputElement>(
            "fieldset[hidden] input",
        );
        expect(event).toBeNull();
        const eventBox = [
            ...host.querySelectorAll<HTMLInputElement>(
                'input[type="checkbox"]',
            ),
        ].find((control) =>
            control.parentElement?.textContent?.includes("event-1"),
        )!;
        eventBox.click();
        const start = host.querySelector<HTMLInputElement>(
            '[aria-label="Occurred from ISO timestamp"]',
        )!;
        start.value = "2026-10-09T09:00:00-07:00";
        click(host, "Continue to confirmation");
        await settle();
        expect(host.textContent).toContain("1 non-record documents excluded");
        click(host, "Start build");
        await settle();
        const request = invoke.mock.calls.find(
            ([method]) => method === "memoryBuildViews",
        )![1] as {
            targets: Array<{ definition: { kind: string; selector: unknown } }>;
            bounds: unknown;
        };
        expect(
            request.targets.find(
                (target) => target.definition.kind === "timeline",
            )!.definition.selector,
        ).toEqual({
            kind: "timelineEvidence",
            sources: [],
            events: [{ eventId: "event-1" }],
        });
        expect(request.bounds).toEqual(
            expect.objectContaining({
                occurredFrom: "2026-10-09T16:00:00.000Z",
            }),
        );
    });
    test.each([31, 32])(
        "timeline accepts one source plus %i events only within the combined32 bound",
        async (count) => {
            const original = invoke.getMockImplementation()!;
            invoke.mockImplementation((method, params) =>
                method === "memoryListEvents"
                    ? Promise.resolve({
                          items: Array.from({ length: count }, (_, i) => ({
                              eventId: `event-${i}`,
                              eventType: "decision",
                              eventTime: "2026-10-09T12:00:00Z",
                          })),
                      })
                    : original(method, params),
            );
            await startBuild(["Evidence-linked timeline"]);
            for (const control of host.querySelectorAll<HTMLInputElement>(
                'input[type="checkbox"]',
            ))
                if (control.parentElement?.textContent?.includes("occurred"))
                    control.click();
            click(host, "Continue to confirmation");
            await settle();
            if (count === 32) {
                expect(host.textContent).toContain("at most 32 combined");
                expect(
                    invoke.mock.calls.some(
                        ([method]) => method === "memoryBuildViews",
                    ),
                ).toBe(false);
            } else {
                click(host, "Start build");
                await settle();
                expect(
                    invoke.mock.calls.some(
                        ([method]) => method === "memoryBuildViews",
                    ),
                ).toBe(true);
                expect(errors).toEqual([]);
            }
        },
    );
    test("dirty guard refuses navigation, preserves text, and beforeunload guards unsaved edits", async () => {
        await openEditor();
        const editor = host.querySelector<HTMLTextAreaElement>(
            '[aria-label="Narrative description"]',
        )!;
        editor.value = "Unsaved human edit";
        editor.dispatchEvent(new Event("input"));
        jest.mocked(window.confirm).mockReturnValue(false);
        expect(panel.discardChanges()).toBe(false);
        await panel.showView("c", "guide");
        expect(editor.isConnected).toBe(true);
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        invoke.mockRejectedValueOnce(new Error("Evidence changed"));
        click(host, "Save explicit edits");
        await settle();
        expect(editor.value).toBe("Unsaved human edit");
        expect(host.textContent).toContain("No success or overwrite");
    });
    test("explicit edits retain stable identities, relationships, and captured head/version", async () => {
        await openEditor();
        const editor = host.querySelector<HTMLTextAreaElement>(
            '[aria-label="Narrative description"]',
        )!;
        editor.value = "Supported edit";
        editor.dispatchEvent(new Event("input"));
        click(host, "Save explicit edits");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memorySaveViewDraft",
            expect.objectContaining({
                corpusId: "c",
                viewId: "guide",
                expectedHead: head,
                expectedVersion: 1,
                definition,
                relationships: [],
                content: expect.objectContaining({
                    sections: [
                        expect.objectContaining({
                            id: "description",
                            body: "Supported edit",
                        }),
                    ],
                }),
            }),
        );
    });
    test("publication sheet preserves exact revisions and optimistic policy revisions, errors are explicit", async () => {
        await panel.refresh();
        click(host, "Guide");
        await settle();
        click(host, "Publication and search");
        expect(document.activeElement?.tagName).toBe("DIALOG");
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryPublishView" || method === "memoryRetryViewIndex"
                ? Promise.reject(
                      new Error("Exact artifact validation required"),
                  )
                : original(method, params),
        );
        click(host, "Publish exact revision");
        await settle();
        click(host, "Retry index");
        await settle();
        for (const method of ["memoryPublishView", "memoryRetryViewIndex"])
            expect(invoke).toHaveBeenCalledWith(method, {
                corpusId: "c",
                viewId: "guide",
                revisionId: "v1",
                expectedHead: head,
                expectedVersion: 1,
            });
        expect(errors).toHaveLength(2);
    });
    test("conflict comparison retains exact three versions and guarded explicit resolution", async () => {
        await openConflict();
        expect(host.textContent).toContain("Generated base");
        expect(host.textContent).toContain("Human draft");
        expect(host.textContent).toContain("New candidate");
        expect(
            host.querySelector('[aria-label="Explicit combined resolution"]'),
        ).toBeNull();
        expect(
            host.querySelector('[aria-label="Troubleshooting guide editor"]'),
        ).not.toBeNull();
        click(host, "Resolve explicitly and save draft");
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryResolveViewConflict", {
            corpusId: "c",
            conflictId: job.results[0].conflictId,
            expectedHead: head,
            expectedVersion: 1,
            expectedRevisionId: "v1",
            inputFingerprint: fingerprint,
            choice: "human",
        });
        expect(errors).toEqual([]);
    });
    test("changed conflict targets remain inspectable but cannot overwrite", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryListViews"
                ? Promise.resolve({
                      head,
                      views: [{ ...view, version: 2, revisionId: "v2" }],
                  })
                : original(method, params),
        );
        await openConflict();
        expect(host.textContent).toContain("current draft changed");
        expect(
            host.querySelector('[aria-label="Conflict resolution choice"]'),
        ).toBeNull();
    });
    test("latest-view routes locate their pending conflict even when the newest receipt belongs to another view", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryListViewBuilds"
                ? Promise.resolve([
                      {
                          ...job,
                          jobId: "unrelated",
                          createdAt: "2026-10-09T14:00:00Z",
                          results: [
                              {
                                  ...job.results[0],
                                  viewId: "other",
                                  conflictId: undefined,
                                  state: "draft",
                              },
                          ],
                      },
                      { ...job, createdAt: "2026-10-09T13:00:00Z" },
                  ])
                : original(method, params),
        );
        await panel.show({ corpusId: "c", viewId: "guide" });
        expect(host.querySelector("textarea")).toBeNull();
        expect(host.textContent).toContain("Review pending conflict");
        expect(invoke).toHaveBeenCalledWith("memoryGetViewConflict", {
            corpusId: "c",
            conflictId: job.results[0].conflictId,
        });
        click(host, "Review pending conflict");
        await settle();
        expect(host.textContent).toContain("Generated base");
        expect(host.textContent).toContain("Human draft");
        expect(
            host.querySelector('[aria-label="Conflict resolution choice"]'),
        ).not.toBeNull();
        expect(errors).toEqual([]);
    });
    test("a resolved historical build conflict is not exposed as pending on the latest reader", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation(async (method, params) => {
            if (method === "memoryListViewBuilds") return [job];
            const result = await original(method, params);
            return method === "memoryGetViewConflict"
                ? {
                      ...(result as Record<string, unknown>),
                      state: "resolved",
                      resolutionRevisionId: "resolved",
                  }
                : result;
        });
        await panel.show({ corpusId: "c", viewId: "guide" });
        expect(
            [...host.querySelectorAll("button")].some(
                (button) => button.textContent === "Review pending conflict",
            ),
        ).toBe(false);
        expect(host.querySelector("textarea")).toBeNull();
        expect(errors).toEqual([]);
    });
    test("late source response cannot render after scope switch or disposal", async () => {
        await panel.refresh();
        const original = invoke.getMockImplementation()!;
        let finish!: (value: unknown) => void;
        invoke.mockImplementation((method, params) =>
            method === "memoryListSources"
                ? new Promise((resolve) => {
                      finish = resolve;
                  })
                : original(method, params),
        );
        click(host, "Build views");
        await settle();
        scope = undefined;
        panel.scopeChanged();
        panel.dispose();
        finish({
            items: [
                {
                    sourceId: "old",
                    title: "Old source",
                    activeRevisionId: "r",
                    revisions: [{ revisionId: "r", state: "ready" }],
                },
            ],
        });
        await settle();
        expect(host.children).toHaveLength(0);
        expect(errors).toEqual([]);
    });
    test("source action carries exact revisions and rejects a changed ready revision", async () => {
        await panel.refresh();
        await panel.buildFromSources("c", [
            { sourceId: "s", revisionId: "outdated" },
        ]);
        expect(host.textContent).toContain("no longer ready and current");
        expect(
            invoke.mock.calls.some(([method]) => method === "memoryBuildViews"),
        ).toBe(false);
    });
    test("historical deep links read the exact revision and do not expose editable or publication controls", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryGetView"
                ? Promise.resolve({
                      ...view,
                      revisionId: "old",
                      version: 0,
                      content: { ...content, title: "Historical guide" },
                  })
                : original(method, params),
        );
        await panel.show({ corpusId: "c", viewId: "guide", revisionId: "old" });
        expect(invoke).toHaveBeenCalledWith("memoryGetView", {
            corpusId: "c",
            viewId: "guide",
            revisionId: "old",
        });
        expect(host.textContent).toContain("Historical revision (read-only)");
        expect(host.querySelector("textarea")).toBeNull();
        expect(
            [...host.querySelectorAll("button")].some(
                (button) => button.textContent === "Edit",
            ),
        ).toBe(false);
        expect(errors).toEqual([]);
        await panel.refresh();
        expect(host.querySelector(".hub-view-document h2")!.textContent).toBe(
            "Historical guide",
        );
        expect(host.textContent).toContain("Historical revision (read-only)");
        expect(
            invoke.mock.calls.filter(([method]) => method === "memoryGetView"),
        ).toHaveLength(2);
        await panel.showView("c", "guide", "old");
        expect(openView).toHaveBeenCalledWith("c", "guide", "old");
        expect(navigate).toHaveBeenCalledWith("#/views/c/guide/revision/old");
    });
    test("even an exact link to the current revision is read-only until Open current view", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryGetView"
                ? Promise.resolve(view)
                : original(method, params),
        );
        await panel.show({ corpusId: "c", viewId: "guide", revisionId: "v1" });
        expect(host.textContent).toContain("Exact revision (read-only)");
        expect(
            [...host.querySelectorAll("button")].some(
                (button) => button.textContent === "Edit",
            ),
        ).toBe(false);
        click(host, "Open current view");
        await settle();
        expect(navigate).toHaveBeenCalledWith("#/views/c/guide");
        expect(
            [...host.querySelectorAll("button")].some(
                (button) => button.textContent === "Edit",
            ),
        ).toBe(true);
    });
    test("unsupported service cannot open exact revision routes", async () => {
        enabled = false;
        await panel.show({ corpusId: "c", viewId: "guide", revisionId: "v1" });
        expect(host.textContent).toContain("does not provide view building");
        expect(
            invoke.mock.calls.some(
                ([method]) =>
                    method === "memoryGetView" || method === "memoryBuildViews",
            ),
        ).toBe(false);
    });
    test("cancellation is requested but only acknowledged target results establish cancellation", async () => {
        jest.useFakeTimers();
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) => {
            if (method === "memoryBuildViews")
                return Promise.resolve({ ...job, state: "running" });
            if (method === "memoryCancelViewBuild")
                return Promise.resolve({
                    ...job,
                    state: "partial",
                    results: [
                        {
                            ...job.results[0],
                            state: "cancelled",
                            reason: "Cancellation acknowledged",
                        },
                        {
                            ...job.results[0],
                            viewId: "completed",
                            state: "draft",
                            reason: "Already materialized",
                        },
                    ],
                });
            return original(method, params);
        });
        await build();
        click(host, "Cancel pending materialization");
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryCancelViewBuild", {
            corpusId: "c",
            jobId: job.jobId,
        });
        expect(host.textContent).toContain("Cancellation acknowledged");
        expect(host.textContent).toContain("Already materialized");
        expect(host.textContent).toContain("completed targets are retained");
    });
    test("hiding the Views destination is preserved across a scope refresh", async () => {
        await panel.refresh();
        panel.hide();
        panel.scopeChanged();
        await settle();
        expect(host.querySelector("section")!.hidden).toBe(true);
        await panel.show();
        expect(host.querySelector("section")!.hidden).toBe(false);
    });
});

describe("timeline timezone validation", () => {
    test.each([
        "2026-02-30T12:00:00Z",
        "2026-10-09T25:00:00Z",
        "2026-10-09T12:00",
        "not a time",
    ])("rejects %s", (value) => {
        expect(() => viewTimestamp(value)).toThrow();
    });

    describe("revision freshness is separate from semantic summary", () => {
        test("uses actual version metadata and does not invent a legacy timestamp", () => {
            const [time] = viewRevisionTime("2026-10-13T09:00:00-07:00");
            expect(time.dateTime).toBe("2026-10-13T16:00:00.000Z");
            expect(time.textContent).toBe(
                "Revision created: 2026-10-13T16:00:00.000Z",
            );
            expect(viewRevisionTime(undefined)).toEqual([]);
        });
        test.each(["", " ", "not a time", "2026-02-30T00:00:00Z"])(
            "rejects invalid stored metadata %j rather than replacing it with now",
            (value) => expect(() => viewRevisionTime(value)).toThrow(),
        );
    });
    test("normalizes explicit offsets and allows unbounded empty input", () => {
        expect(viewTimestamp("2026-10-09T09:30:00-07:00")).toBe(
            "2026-10-09T16:30:00.000Z",
        );
        expect(viewTimestamp(" ")).toBeUndefined();
    });
});
