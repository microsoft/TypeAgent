// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountMemoryHubViews } from "./memoryHubViews";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock<Promise<unknown>, [string, unknown]>;
const head = "a".repeat(40);
const fingerprint = "b".repeat(64);
const definition = {
    viewId: "guide",
    kind: "troubleshootingGuide",
    selector: {
        kind: "sources",
        sources: [{ sourceId: "s", revisionId: "r" }],
    },
};
const content = {
    kind: "troubleshootingGuide",
    title: "Guide",
    sections: [
        {
            id: "description",
            role: "description",
            heading: "Goal",
            body: "Original body",
        },
    ],
    citations: [],
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

async function settle(): Promise<void> {
    for (let index = 0; index < 15; index++) await Promise.resolve();
}
function click(host: HTMLElement, label: string): void {
    const button = [...host.querySelectorAll("button")].find(
        (entry) => entry.textContent === label,
    );
    if (!button) throw new Error(`Missing button ${label}`);
    button.click();
}

describe("Memory Hub draft build and conflict controls", () => {
    let host: HTMLElement;
    let panel: ReturnType<typeof mountMemoryHubViews>;
    let scope: string | undefined;
    let enabled: boolean;
    let errors: unknown[];
    beforeEach(() => {
        host = document.createElement("div");
        document.body.replaceChildren(host);
        scope = "c";
        enabled = true;
        errors = [];
        invoke.mockReset();
        invoke.mockImplementation(async (method) => {
            switch (method) {
                case "memoryViewCapabilities":
                    return {
                        derivedViews: enabled ? { builds: true } : undefined,
                    };
                case "memoryListViews":
                    return snapshot;
                case "memoryListViewBuilds":
                    return [];
                case "memoryGetViewPublicationPolicy":
                    return { revision: 0, autoPublish: true, views: {} };
                case "memoryGetViewPublication":
                    return {
                        viewId: "guide",
                        indexState: "absent",
                        reason: "No published revision",
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
                        ],
                        total: 1,
                    };
                case "memoryBuildViews":
                    return job;
                case "memoryGetViewConflict":
                    return {
                        conflictId: job.results[0].conflictId,
                        corpusId: "c",
                        viewId: "guide",
                        state: "pending",
                        expectedRevisionId: view.revisionId,
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
                case "memoryResolveViewConflict":
                    return { commitId: head, version: view };
                case "memorySaveViewDraft":
                    return { commitId: head, version: view };
                default:
                    throw new Error(`Unexpected method ${method}`);
            }
        });
        panel = mountMemoryHubViews(host, {
            scope: () => scope,
            onError: (error) => errors.push(error),
        });
    });
    afterEach(() => {
        panel.dispose();
        jest.useRealTimers();
    });
    test("corpus, view inheritance and build override controls send optimistic settings without spoofed actors", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryUpdateViewPublicationPolicy"
                ? Promise.resolve({
                      revision: 1,
                      autoPublish: false,
                      views: {},
                  })
                : original(method, params),
        );
        await panel.refresh();
        const corpus = host.querySelector<HTMLSelectElement>(
            '[aria-label="Corpus auto-publish after build"]',
        )!;
        corpus.value = "off";
        click(host, "Save corpus publication setting");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryUpdateViewPublicationPolicy",
            {
                corpusId: "c",
                expectedHead: head,
                expectedRevision: 0,
                autoPublish: false,
            },
        );
        click(host, "Guide (draft, v1)");
        const viewPolicy = host.querySelector<HTMLSelectElement>(
            '[aria-label="View auto-publish after build"]',
        )!;
        viewPolicy.value = "inherit";
        click(host, "Save view publication override");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryUpdateViewPublicationPolicy",
            {
                corpusId: "c",
                viewId: "guide",
                expectedHead: head,
                expectedRevision: 0,
                autoPublish: null,
            },
        );
        const buildPolicy = host.querySelector<HTMLSelectElement>(
            '[aria-label="Build auto-publish after build"]',
        )!;
        buildPolicy.value = "off";
        buildPolicy.dispatchEvent(new Event("change"));
        expect(host.textContent).toContain("Off (build override)");
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        host.querySelector<HTMLInputElement>(
            '[aria-label="Stable view ID"]',
        )!.value = "new-guide";
        click(host, "Build views");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({ publication: false }),
        );
    });
    test("Publish and Retry index use exact revision/head guards and preserve explicit failures", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) => {
            if (method === "memoryGetViewPublication")
                return Promise.resolve({
                    viewId: "guide",
                    publishedRevisionId: "v1",
                    indexState: "failed",
                    reason: "Index failed",
                });
            if (
                method === "memoryPublishView" ||
                method === "memoryRetryViewIndex"
            )
                return Promise.reject(
                    new Error("Exact artifact validation required"),
                );
            return original(method, params);
        });
        await panel.refresh();
        click(host, "Guide (draft, v1)");
        click(host, "Publish exact revision");
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryPublishView", {
            corpusId: "c",
            viewId: "guide",
            revisionId: "v1",
            expectedHead: head,
            expectedVersion: 1,
        });
        expect(host.textContent).toContain(
            "Exact artifact validation required",
        );
        click(host, "Retry index");
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryRetryViewIndex", {
            corpusId: "c",
            viewId: "guide",
            revisionId: "v1",
            expectedHead: head,
            expectedVersion: 1,
        });
        expect(errors).toHaveLength(2);
    });
    async function openConflict(): Promise<void> {
        await panel.refresh();
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        host.querySelector<HTMLInputElement>(
            '[aria-label="Stable view ID"]',
        )!.value = "guide";
        click(host, "Build views");
        await settle();
        click(host, "Compare and resolve conflict");
        await settle();
    }
    test("receipt inspection exposes source-first inventory, independent check and actual artifact coverage without claiming qualification", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryListViewBuilds"
                ? Promise.resolve([
                      {
                          ...job,
                          state: "failed",
                          results: [
                              {
                                  ...job.results[0],
                                  state: "blocked",
                                  inventory: {
                                      fingerprint,
                                      items: [
                                          {
                                              id: "fact:capacity",
                                              statement:
                                                  "Capacity blocked pending owner review",
                                          },
                                      ],
                                  },
                                  inventoryAudit: {
                                      supported: false,
                                      reasons: ["Headroom omitted"],
                                  },
                                  coverage: {
                                      inventoryFingerprint: fingerprint,
                                      reuseEligibility: "diagnosticOnly",
                                      items: [],
                                  },
                              },
                          ],
                      },
                  ])
                : original(method, params),
        );
        await panel.refresh();
        expect(host.querySelector("details summary")!.textContent).toContain(
            "source-first inventory",
        );
        const inspection = JSON.parse(
            host.querySelector("details pre")!.textContent!,
        );
        expect(inspection.inventory.items[0].statement).toContain(
            "pending owner review",
        );
        expect(inspection.sourceCheck.supported).toBe(false);
        expect(inspection.finalCoverage.reuseEligibility).toBe(
            "diagnosticOnly",
        );
        expect(host.textContent).toContain(
            "not guarantees of semantic completeness",
        );
        expect(host.textContent).toContain("not reusable recovery");
        expect(errors).toEqual([]);
    });
    test("resolved conflicts retain their exact comparison but cannot be resolved again", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation(async (method, params) => {
            const value = await original(method, params);
            return method === "memoryGetViewConflict"
                ? {
                      ...(value as Record<string, unknown>),
                      state: "resolved",
                      resolutionRevisionId: "resolved-v2",
                  }
                : value;
        });
        await openConflict();
        expect(host.textContent).toContain("Generated base");
        expect(host.textContent).toContain("Human draft");
        expect(host.textContent).toContain("New candidate");
        expect(host.textContent).toContain(
            "Resolved in draft revision resolved-v2",
        );
        expect(host.textContent).toContain(
            "historical comparison is read-only",
        );
        expect(
            host.querySelector('[aria-label="Conflict resolution choice"]'),
        ).toBeNull();
        expect(
            host.querySelector('[aria-label="Explicit combined resolution"]'),
        ).toBeNull();
        expect(host.textContent).not.toContain(
            "Resolve explicitly and save draft",
        );
        expect(
            invoke.mock.calls.some(
                ([method]) => method === "memoryResolveViewConflict",
            ),
        ).toBe(false);
        expect(errors).toEqual([]);
    });
    test("a pending conflict whose target changed is inspectable but cannot send stale resolution", async () => {
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) =>
            method === "memoryListViews"
                ? Promise.resolve({
                      ...snapshot,
                      views: [{ ...view, revisionId: "newer-v2", version: 2 }],
                  })
                : original(method, params),
        );
        await openConflict();
        expect(host.textContent).toContain(
            "current draft changed after this conflict",
        );
        expect(host.textContent).toContain("read-only");
        expect(
            host.querySelector('[aria-label="Conflict resolution choice"]'),
        ).toBeNull();
        expect(host.textContent).not.toContain(
            "Resolve explicitly and save draft",
        );
        expect(
            invoke.mock.calls.some(
                ([method]) => method === "memoryResolveViewConflict",
            ),
        ).toBe(false);
        expect(errors).toEqual([]);
    });
    test("a late build receipt cannot render after switching to All memory", async () => {
        await panel.refresh();
        const original = invoke.getMockImplementation()!;
        let finish!: (value: unknown) => void;
        const pending = new Promise<unknown>((resolve) => {
            finish = resolve;
        });
        invoke.mockImplementation((method, params) =>
            method === "memoryBuildViews" ? pending : original(method, params),
        );
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        host.querySelector<HTMLInputElement>(
            '[aria-label="Stable view ID"]',
        )!.value = "guide";
        click(host, "Build views");
        await settle();
        expect(invoke).toHaveBeenCalledWith(
            "memoryBuildViews",
            expect.objectContaining({ corpusId: "c" }),
        );
        scope = undefined;
        panel.scopeChanged();
        expect(host.querySelector("section")!.hidden).toBe(true);
        expect(host.querySelector("fieldset")).toBeNull();
        finish(job);
        await settle();
        expect(host.textContent).toContain("Choose a named corpus");
        expect(host.textContent).not.toContain("Overlap retained");
        expect(host.querySelector("fieldset")).toBeNull();
        expect(errors).toEqual([]);
    });
    test("late source enumeration cannot enable the old corpus after a scope change", async () => {
        const original = invoke.getMockImplementation()!;
        let finish!: (value: unknown) => void;
        const pending = new Promise<unknown>((resolve) => {
            finish = resolve;
        });
        invoke.mockImplementation((method, params) => {
            const corpusId = (params as { corpusId?: string })?.corpusId;
            if (method === "memoryListSources")
                return corpusId === "c"
                    ? pending
                    : Promise.resolve({
                          items: [
                              {
                                  sourceId: "new-source",
                                  title: "New corpus evidence",
                                  activeRevisionId: "new-revision",
                                  revisions: [
                                      {
                                          revisionId: "new-revision",
                                          state: "ready",
                                      },
                                  ],
                              },
                          ],
                          total: 1,
                      });
            if (method === "memoryListViews" && corpusId === "new")
                return Promise.resolve({ head, views: [] });
            return original(method, params);
        });
        const initial = panel.refresh();
        await settle();
        scope = "new";
        panel.scopeChanged();
        finish({
            items: [
                {
                    sourceId: "old-source",
                    title: "Old corpus evidence",
                    activeRevisionId: "old-revision",
                    revisions: [{ revisionId: "old-revision", state: "ready" }],
                },
            ],
            total: 1,
        });
        await initial;
        await settle();
        expect(host.textContent).toContain("New corpus evidence");
        expect(host.textContent).not.toContain("Old corpus evidence");
        expect(host.textContent).not.toContain("Guide (draft, v1)");
        expect(errors).toEqual([]);
    });
    test("terminal polling does not replace a dirty human editor", async () => {
        jest.useFakeTimers();
        const original = invoke.getMockImplementation()!;
        invoke.mockImplementation((method, params) => {
            if (method === "memoryBuildViews")
                return Promise.resolve({ ...job, state: "running" });
            if (method === "memoryGetViewBuild")
                return Promise.resolve({ ...job, state: "complete" });
            return original(method, params);
        });
        await panel.refresh();
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        host.querySelector<HTMLInputElement>(
            '[aria-label="Stable view ID"]',
        )!.value = "guide";
        click(host, "Build views");
        await settle();
        click(host, "Guide (draft, v1)");
        const editor = host.querySelector<HTMLTextAreaElement>(
            '[aria-label="Draft content with stable section IDs"]',
        )!;
        editor.value = JSON.stringify({
            ...content,
            title: "Unsaved explicit edit",
        });
        editor.dispatchEvent(new Event("input"));
        const lists = invoke.mock.calls.filter(
            ([method]) => method === "memoryListViews",
        ).length;
        await jest.advanceTimersByTimeAsync(501);
        await settle();
        expect(
            host.querySelector(
                '[aria-label="Draft content with stable section IDs"]',
            ),
        ).toBe(editor);
        expect(editor.value).toContain("Unsaved explicit edit");
        expect(
            invoke.mock.calls.filter(
                ([method]) => method === "memoryListViews",
            ),
        ).toHaveLength(lists);
        expect(errors).toEqual([]);
    });
    test("disposal prevents a queued scope refresh after a pending operation completes", async () => {
        await panel.refresh();
        const original = invoke.getMockImplementation()!;
        let finish!: (value: unknown) => void;
        const pending = new Promise<unknown>((resolve) => {
            finish = resolve;
        });
        invoke.mockImplementation((method, params) =>
            method === "memoryBuildViews" ? pending : original(method, params),
        );
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        host.querySelector<HTMLInputElement>(
            '[aria-label="Stable view ID"]',
        )!.value = "guide";
        click(host, "Build views");
        await settle();
        scope = "new";
        panel.scopeChanged();
        panel.dispose();
        const calls = invoke.mock.calls.length;
        finish(job);
        await settle();
        expect(invoke.mock.calls).toHaveLength(calls);
        expect(host.children).toHaveLength(0);
    });
    test("hidden by default, named-corpus boundary, and explicit exact source build", async () => {
        enabled = false;
        await panel.refresh();
        expect(host.querySelector("section")!.hidden).toBe(true);
        enabled = true;
        scope = undefined;
        await panel.refresh();
        expect(host.textContent).toContain("Choose a named corpus");
        expect(host.querySelector("fieldset")).toBeNull();
        scope = "c";
        await panel.refresh();
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        host.querySelector<HTMLInputElement>(
            '[aria-label="Stable view ID"]',
        )!.value = "new-guide";
        click(host, "Build views");
        await settle();
        expect(invoke).toHaveBeenCalledWith("memoryBuildViews", {
            corpusId: "c",
            expectedHead: head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: { ...definition, viewId: "new-guide" },
                },
            ],
        });
        expect(host.textContent).toContain("partial");
        expect(host.textContent).toContain("conflicted");
        expect(host.textContent).not.toContain("published");
    });
    test("comparison exposes exact three inputs and sends explicit guarded resolution without actor", async () => {
        await openConflict();
        expect(host.textContent).toContain("Generated base");
        expect(host.textContent).toContain("Human draft");
        expect(host.textContent).toContain("New candidate");
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
        expect(host.textContent).toContain(
            "Conflict resolved explicitly; saved draft version 1",
        );
    });
    test("errors keep human editor content and never imply a saved result", async () => {
        await panel.refresh();
        click(host, "Guide (draft, v1)");
        const editor = host.querySelector<HTMLTextAreaElement>(
            '[aria-label="Draft content with stable section IDs"]',
        )!;
        editor.value = JSON.stringify({
            ...content,
            title: "Edited human title",
        });
        editor.dispatchEvent(new Event("input"));
        invoke.mockRejectedValueOnce(new Error("Evidence changed"));
        click(host, "Save explicit edits");
        await settle();
        expect(editor.value).toContain("Edited human title");
        expect(host.textContent).toContain("No success or overwrite");
        expect(errors).toHaveLength(1);
    });
});
