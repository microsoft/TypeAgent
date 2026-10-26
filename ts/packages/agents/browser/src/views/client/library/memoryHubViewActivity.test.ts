// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inventoryFixture } from "./memoryHubInventoryTestData";

import type { ViewBuildJob, ViewVersion } from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import {
    mountMemoryHubViewActivity,
    viewBuildSummary,
} from "./memoryHubViewActivity";

jest.mock("./viewClient", () => ({ invokeMemory: jest.fn() }));
const invoke = invokeMemory as jest.Mock;

function job(state: ViewBuildJob["state"] = "partial"): ViewBuildJob {
    const definition = {
        kind: "wiki" as const,
        viewId: "wiki",
        selector: { kind: "sources" as const, sources: [] },
    };
    const request = {
        corpusId: "alpha",
        expectedHead: null,
        targets: [{ definition, expectedVersion: 0 }],
    };
    return {
        jobId: "job-1",
        corpusId: "alpha",
        fingerprint: "f",
        request,
        actor: "fixture",
        createdAt: "2026-10-09T12:00:00Z",
        updatedAt: "2026-10-09T12:01:00Z",
        state,
        publication: false,
        results: [
            {
                viewId: "wiki",
                state: state === "running" ? "generating" : "failed",
                reason: "Model configuration rejected",
                snapshot: {
                    corpusId: "alpha",
                    actor: "fixture",
                    definition,
                    expectedVersion: 0,
                    bounds: {},
                    inputs: [],
                    pipeline: "informational-wiki-v1",
                    model: "fixture",
                    fingerprint: "f",
                },
            },
        ],
    };
}

function textButton(host: HTMLElement, text: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find(
        (button) =>
            button.textContent === text ||
            button.getAttribute("aria-label") === text,
    );
    if (!found) throw new Error(`Missing button ${text}`);
    return found;
}

beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            switch (method) {
                case "memoryViewCapabilities":
                    return { derivedViews: { builds: true } };
                case "memoryListCorpora":
                    return [
                        { corpusId: "alpha", name: "Alpha" },
                        { corpusId: "beta", name: "Beta" },
                    ];
                case "memoryListViewBuilds":
                    return [job()];
                case "memoryListViews":
                    return { head: null, views: [] };
                case "memoryGetViewBuild":
                    return job();
                default:
                    throw new Error(`Unexpected method ${method}`);
            }
        }),
    );
});

test("partial builds and failed targets remain explicit in Activity and Inbox", async () => {
    const host = document.createElement("div");
    const attention = document.createElement("div");
    const onOpenBuild = jest.fn();
    const mounted = mountMemoryHubViewActivity(host, attention, {
        scope: () => "alpha",
        onError: jest.fn(),
        onOpenView: jest.fn(),
        onOpenBuild,
    });
    await mounted.show({ corpusId: "alpha", jobId: "job-1" });
    expect(host.textContent).toContain(
        "0 of 1 targets saved; 1 need attention",
    );
    expect(host.textContent).toContain("Model configuration rejected");
    expect(attention.textContent).toContain("Wiki");
    expect(
        invoke.mock.calls.filter(
            ([method]) => method === "memoryListViewBuildSummaries",
        ),
    ).toEqual([
        ["memoryListViewBuildSummaries", { corpusId: "alpha", pageSize: 25 }],
    ]);
    textButton(attention, "Inspect operation").click();
    expect(onOpenBuild).toHaveBeenCalledWith("alpha", "job-1");
    mounted.dispose();
});

test("cancellation is not displayed as acknowledged until the service says so", async () => {
    jest.useFakeTimers();
    const running = job("running");
    invoke.mockImplementation(
        inventoryFixture(async (method: string) => {
            if (method === "memoryViewCapabilities")
                return { derivedViews: { builds: true } };
            if (method === "memoryListCorpora")
                return [{ corpusId: "alpha", name: "Alpha" }];
            if (method === "memoryListViewBuilds") return [running];
            if (method === "memoryGetViewBuild") return running;
            if (method === "memoryListViews") return { head: null, views: [] };
            if (method === "memoryCancelViewBuild") return running;
            throw new Error(method);
        }),
    );
    const host = document.createElement("div");
    const mounted = mountMemoryHubViewActivity(
        host,
        document.createElement("div"),
        {
            scope: () => "alpha",
            onError: jest.fn(),
            onOpenView: jest.fn(),
            onOpenBuild: jest.fn(),
        },
    );
    await mounted.show({ corpusId: "alpha", jobId: "job-1" });
    textButton(host, "Request cancellation").click();
    for (let index = 0; index < 25; index++) await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("memoryCancelViewBuild", {
        corpusId: "alpha",
        jobId: "job-1",
    });
    expect(host.textContent).not.toContain("Cancellation acknowledged");
    expect(host.textContent).toContain("Cancellation requested");
    expect(textButton(host, "Request cancellation").disabled).toBe(true);
    await mounted.refresh();
    expect(host.textContent).toContain("waiting for acknowledgment");
    mounted.dispose();
    jest.useRealTimers();
});

test("successful draft counts do not imply publication or search readiness", () => {
    const value = job();
    value.results[0].state = "draft";
    expect(viewBuildSummary(value)).toBe("1 of 1 targets saved");
});

test("topic generations are not presented as openable Wiki article revisions", async () => {
    const value = job("complete");
    value.results[0].snapshot.pipeline = "topics-v1";
    value.results[0].state = "draft";
    value.results[0].topicGeneration = "topic-generation";
    value.results[0].reason = "Complete topic snapshot, not an article";
    const previous = invoke.getMockImplementation()!;
    invoke.mockImplementation(
        inventoryFixture((method: string, request: unknown) =>
            method === "memoryGetViewBuild"
                ? Promise.resolve(value)
                : previous(method, request),
        ),
    );
    const host = document.createElement("div");
    const onOpenView = jest.fn();
    const mounted = mountMemoryHubViewActivity(
        host,
        document.createElement("div"),
        {
            scope: () => "alpha",
            onError: jest.fn(),
            onOpenView,
            onOpenBuild: jest.fn(),
        },
    );
    try {
        await mounted.show({ corpusId: "alpha", jobId: "job-1" });
        expect(host.textContent).toContain("Maintained topics");
        expect(host.textContent).toContain("Topic generation topic-generation");
        expect(
            [...host.querySelectorAll("button")].some(
                (button) => button.textContent === "Open view",
            ),
        ).toBe(false);
        expect(onOpenView).not.toHaveBeenCalled();
    } finally {
        mounted.dispose();
    }
});

test("current indexing attention is counted once and maintenance plans respect the 32-view bound", async () => {
    const views: ViewVersion[] = Array.from({ length: 33 }, (_, index) => ({
        corpusId: "alpha",
        viewId: `guide-${index}`,
        revisionId: `r-${index}`,
        version: 1,
        state: "draft",
        actor: "fixture",
        createdAt: "2026-10-10T00:00:00Z",
        definition: {
            viewId: `guide-${index}`,
            revisionId: "definition",
            kind: "troubleshootingGuide",
            selector: { kind: "sources", sources: [] },
            maintenance: { schemaVersion: 1, scope: { mode: "pinned" } },
        },
        content: {
            kind: "troubleshootingGuide",
            title: `Guide ${index}`,
            sections: [],
            citations: [],
        },
        relationships: [],
        provenance: "generated",
    }));
    invoke.mockImplementation(
        inventoryFixture(
            async (
                method: string,
                params: { viewIds?: string[]; viewId?: string },
            ) => {
                if (method === "memoryViewCapabilities")
                    return {
                        derivedViews: { builds: true, maintenance: true },
                    };
                if (method === "memoryListCorpora")
                    return [{ corpusId: "alpha", name: "Alpha" }];
                if (method === "memoryListViewBuilds") return [];
                if (method === "memoryListViews")
                    return { head: "head", views };
                if (method === "memoryPlanViewMaintenance")
                    return {
                        corpusId: "alpha",
                        expectedHead: "head",
                        targets: params.viewIds!.map((viewId) => ({
                            viewId,
                            expectedVersion: 1,
                            state: "pinned",
                            reason: "Pinned",
                        })),
                    };
                if (method === "memoryGetViewPublication")
                    return {
                        viewId: params.viewId,
                        indexState:
                            params.viewId === "guide-0" ? "failed" : "absent",
                        reason: "Indexer unavailable",
                    };
                throw new Error(method);
            },
        ),
    );
    const attention = document.createElement("div");
    const onAttentionCount = jest.fn();
    const onOpenView = jest.fn();
    const mounted = mountMemoryHubViewActivity(
        document.createElement("div"),
        attention,
        {
            scope: () => "alpha",
            onError: jest.fn(),
            onOpenView,
            onOpenBuild: jest.fn(),
            onAttentionCount,
        },
    );
    await mounted.refresh();
    const plans = invoke.mock.calls.filter(
        ([method]) => method === "memoryPlanViewMaintenance",
    );
    expect(plans.map(([, params]) => params.viewIds.length)).toEqual([25]);
    expect(onAttentionCount).toHaveBeenLastCalledWith(2);
    expect(attention.textContent).toContain(
        "Indexing failed: Indexer unavailable",
    );
    textButton(attention, "Retry indexing").click();
    expect(onOpenView).toHaveBeenCalledWith("alpha", "guide-0");
    mounted.scopeChanged();
    expect(attention.textContent).toBe("");
    expect(onAttentionCount).toHaveBeenLastCalledWith(0);
    mounted.dispose();
});
