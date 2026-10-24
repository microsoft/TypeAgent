// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ViewVersion, ViewBuildJob } from "@typeagent/memory-service";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mountMemoryHubViews } from "./memoryHubViews";
import { mountMemoryHubViewActivity } from "./memoryHubViewActivity";
import { parseRoute, routeHash } from "./memoryHubModel";
import { invokeMemory } from "./viewClient";

jest.mock("./viewClient", () => ({
    invokeMemory: jest.fn(),
    invokeView: jest.fn(),
}));
const invoke = invokeMemory as jest.Mock<
    Promise<unknown>,
    [string, { viewId?: string }]
>;
const canonical: ViewVersion = {
    corpusId: "c",
    viewId: "canonical",
    revisionId: "current",
    version: 3,
    actor: "memory-view-generator",
    createdAt: "2026-10-13T16:00:00Z",
    state: "draft",
    provenance: "generated",
    definition: {
        viewId: "canonical",
        revisionId: "definition",
        kind: "wiki",
        selector: { kind: "sources", sources: [] },
        wiki: {
            construction: "informational-wiki-v1",
            query: "Payments capacity review",
            aliases: ["old review"],
            excludedSourceIds: [],
        },
    },
    content: {
        kind: "wiki",
        construction: "informational-wiki-v1",
        title: "Current canonical",
        summary: "Limited summary: selected indexed fragments only; offline",
        citations: [],
        index: [
            {
                pageId: "canonical-page",
                title: "Current scope",
                taxonomy: "concept",
            },
        ],
        sections: [
            {
                id: "canonical-page",
                role: "page",
                heading: "Current scope",
                body: "Review open; command and lease statistics remain distinct.",
                details: {
                    kind: "page",
                    construction: "informational-wiki-v1",
                    taxonomy: "concept",
                    note: "",
                    mergedPageIds: [],
                },
            },
        ],
    },
    relationships: [],
};
function configureReads(alias: ViewVersion, current = canonical) {
    invoke.mockReset();
    invoke.mockImplementation(async (method, request) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { kinds: ["wiki"], builds: true } };
        if (method === "memoryListCorpora")
            return [{ corpusId: current.corpusId, name: "Offline" }];
        if (method === "memoryListViews")
            return { head: "c".repeat(40), views: [current] };
        if (method === "memoryListViewBuilds") return [];
        if (method === "memoryGetViewPublicationPolicy")
            return { revision: 0, autoPublish: true, views: {} };
        if (method === "memoryGetViewPublication")
            return { indexState: "absent", reason: "Offline" };
        if (method === "memoryGetView")
            return request.viewId === alias.viewId ? alias : current;
        throw new Error(`Unexpected consolidation method ${method}`);
    });
}
function aliasView(): ViewVersion {
    return {
        ...canonical,
        viewId: "old",
        revisionId: "alias",
        state: "archived",
        redirect: {
            viewId: canonical.viewId,
            acceptedRevisionId: canonical.revisionId,
            anchors: [{ from: "old-page", to: "canonical-page" }],
        },
    };
}
async function settle() {
    for (let tick = 0; tick < 40; tick++) await Promise.resolve();
}
function button(host: HTMLElement, text: string) {
    const found = [...host.querySelectorAll("button")].find(
        (entry) =>
            entry.textContent === text ||
            entry.getAttribute("aria-label") === text,
    );
    if (!found) throw new Error(`Missing consolidation button ${text}`);
    return found;
}
test("old Wiki ID and page anchor navigate to a current canonical section, never retired prose", async () => {
    configureReads(aliasView());
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const onNavigate = jest.fn();
    const onError = jest.fn();
    const mounted = mountMemoryHubViews(host, {
        scope: () => "c",
        onNavigate,
        onError,
    });
    try {
        await mounted.show({
            corpusId: "c",
            viewId: "old",
            pageId: "old-page",
        });
        await settle();
        expect(onNavigate).toHaveBeenCalledWith(
            "#/views/c/canonical/page/canonical-page",
        );
        expect(host.textContent).toContain(
            "Review open; command and lease statistics remain distinct.",
        );
        expect(document.activeElement?.getAttribute("data-page")).toBe(
            "canonical-page",
        );
        expect(onError).not.toHaveBeenCalled();
    } finally {
        mounted.dispose();
    }
});
test("actual indexed P0 registered canonical renders both retained pages after old-ID/anchor navigation", async () => {
    const recorded: {
        canonical: ViewVersion;
        alias: Pick<
            ViewVersion,
            "viewId" | "revisionId" | "version" | "redirect"
        >;
    } = JSON.parse(
        readFileSync(
            path.resolve(
                __dirname,
                "..",
                "..",
                "..",
                "..",
                "..",
                "..",
                "memory",
                "mcp-server",
                "test",
                "fixtures",
                "p6Canonical.json",
            ),
            "utf8",
        ),
    );
    const current = recorded.canonical;
    const alias: ViewVersion = {
        ...current,
        ...recorded.alias,
        state: "archived",
    };
    const anchor = alias.redirect?.anchors[0];
    if (!anchor)
        throw new Error("Recorded production redirect anchor is required");
    expect(current.content.sections).toHaveLength(2);
    configureReads(alias, current);
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const onNavigate = jest.fn();
    const onError = jest.fn();
    const mounted = mountMemoryHubViews(host, {
        scope: () => current.corpusId,
        onNavigate,
        onError,
    });
    try {
        await mounted.show({
            corpusId: alias.corpusId,
            viewId: alias.viewId,
            pageId: anchor.from,
        });
        await settle();
        expect(onNavigate).toHaveBeenCalledWith(
            `#/views/${current.corpusId}/${current.viewId}/page/${anchor.to}`,
        );
        expect(host.querySelectorAll("[data-page]")).toHaveLength(2);
        for (const page of current.content.sections)
            expect(host.textContent).toContain(page.heading);
        expect(document.activeElement?.getAttribute("data-page")).toBe(
            anchor.to,
        );
        expect(onError).not.toHaveBeenCalled();
    } finally {
        mounted.dispose();
    }
});
test("historical alias page focus preserves the exact readonly revision; current navigation explicitly follows canonical", async () => {
    const alias = aliasView();
    alias.content = {
        ...alias.content,
        title: "Accepted historical canonical",
    };
    configureReads(alias);
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const onNavigate = jest.fn();
    const onError = jest.fn();
    const mounted = mountMemoryHubViews(host, {
        scope: () => "c",
        onNavigate,
        onError,
    });
    try {
        await mounted.show({
            corpusId: "c",
            viewId: "old",
            revisionId: "alias",
            pageId: "old-page",
        });
        await settle();
        expect(host.textContent).toContain("Historical revision (read-only)");
        expect(document.activeElement?.getAttribute("data-page")).toBe(
            "canonical-page",
        );
        expect(onNavigate).not.toHaveBeenCalled();
        button(host, "Current scope").click();
        expect(onNavigate).toHaveBeenCalledWith(
            "#/views/c/old/revision/alias/page/canonical-page",
        );
        button(host, "Open current view").click();
        await settle();
        expect(onNavigate).toHaveBeenLastCalledWith("#/views/c/canonical");
        expect(host.textContent).not.toContain(
            "Historical revision (read-only)",
        );
        expect(onError).not.toHaveBeenCalled();
    } finally {
        mounted.dispose();
    }
});
test("Activity distinguishes accepted canonical effects from derivative readiness and exposes both safe navigation links", async () => {
    const snapshot = {
        corpusId: canonical.corpusId,
        actor: canonical.actor,
        definition: {
            viewId: "canonical",
            kind: "wiki" as const,
            selector: canonical.definition.selector,
            wiki: canonical.definition.wiki!,
        },
        expectedVersion: 2,
        bounds: {},
        inputs: [],
        pipeline: "informational-wiki-v1" as const,
        model: "offline",
        fingerprint: "a".repeat(64),
    };
    const job: ViewBuildJob = {
        jobId: "job",
        corpusId: "c",
        fingerprint: "b".repeat(64),
        actor: canonical.actor,
        createdAt: "2026-10-12T12:00:00Z",
        updatedAt: "2026-10-12T12:01:00Z",
        state: "partial",
        publication: true,
        request: {
            corpusId: "c",
            expectedHead: null,
            targets: [{ definition: snapshot.definition, expectedVersion: 2 }],
        },
        results: [
            {
                viewId: "old",
                state: "failed",
                reason: "Exact derivative index awaiting repair",
                snapshot,
                wikiConsolidation: {
                    identity: "d".repeat(64),
                    stage: "accepted",
                    survivorViewId: "canonical",
                    retiringViewId: "old",
                    retiringRevisionId: "retired",
                    retiringVersion: 1,
                    input: snapshot,
                    output: {
                        content: canonical.content,
                        relationships: [],
                        outcome: "knowledgePages",
                        missingEvidence: [],
                    },
                    anchors: [],
                    assessment: {
                        relation: "samePurpose",
                        reason: "same-scoped-purpose",
                        scope: {
                            system: "Payments",
                            initiative: "Capacity",
                            purpose: "Review",
                        },
                        criticalDistinctions: [],
                    },
                    verification: { safe: true, failures: [] },
                    acceptedRevisionId: "current",
                },
            },
        ],
    };
    invoke.mockReset();
    invoke.mockImplementation(async (method) => {
        if (method === "memoryViewCapabilities")
            return { derivedViews: { builds: true } };
        if (method === "memoryListCorpora")
            return [{ corpusId: "c", name: "Offline" }];
        if (method === "memoryListViewBuilds") return [job];
        if (method === "memoryGetViewBuild") return job;
        if (method === "memoryListViews") return { head: null, views: [] };
        throw new Error(`Unexpected consolidation activity method ${method}`);
    });
    const host = document.createElement("div");
    const onOpenView = jest.fn();
    const mounted = mountMemoryHubViewActivity(
        host,
        document.createElement("div"),
        {
            scope: () => "c",
            onError: jest.fn(),
            onOpenView,
            onOpenBuild: jest.fn(),
        },
    );
    try {
        await mounted.show({ corpusId: "c", jobId: "job" });
        expect(host.textContent).toContain("Consolidation: accepted");
        expect(host.textContent).toContain(
            "Exact derivative index awaiting repair",
        );
        button(host, "Open canonical article").click();
        button(host, "Open original article link").click();
        expect(onOpenView.mock.calls).toEqual([
            ["c", "canonical"],
            ["c", "old"],
        ]);
    } finally {
        mounted.dispose();
    }
});
test.each([
    "#/views/c/old/page/old-page",
    "#/views/c/old/revision/r2/page/old-page",
])("current and historical old-anchor routes round trip: %s", (hash) => {
    const route = parseRoute(hash);
    expect(route.viewPageId).toBe("old-page");
    expect(routeHash(route)).toBe(hash);
});
