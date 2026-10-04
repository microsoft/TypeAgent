// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryHubEvidence,
    MemoryHubSearchResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import { mountMemoryHubSearch } from "./memoryHubSearch";
import { invokeView } from "./viewClient";
import { updateMemoryHubViewPreferences } from "./memoryHubViewPreferences";

jest.mock("./memoryHubPhase2.css", () => ({}));
jest.mock("./memoryHubViewPreferences.css", () => ({}));
jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));
const invoke = invokeView as jest.Mock;
let host: HTMLElement;
let mounted: ReturnType<typeof mountMemoryHubSearch>;
let scope: string | undefined;
let onSource: jest.Mock;
let onProcedure: jest.Mock;
let onError: jest.Mock;
let onQueryChanged: jest.Mock;

const source: MemoryHubEvidence = {
    id: "source-citation",
    kind: "source",
    corpusId: "a",
    corpusName: "Alpha",
    objectId: "source",
    sourceId: "source",
    revisionId: "r3",
    title: "<img src=x onerror=bad()> Guide",
    snippet: "Captured evidence",
    score: 0.02,
    rank: 1,
    sourceType: "markdown",
    locator: "lines 3–8",
};
const procedure: MemoryHubEvidence = {
    id: "procedure-citation",
    kind: "procedure",
    corpusId: "b",
    corpusName: "Beta",
    objectId: "procedure",
    procedureVersion: 4,
    procedureState: "stale",
    title: "Restart worker",
    snippet: "Check the queue",
    score: 0.019,
    rank: 2,
};
const conversation: MemoryHubEvidence = {
    id: "conversation-citation",
    kind: "conversation",
    corpusId: "conversation",
    corpusName: "Conversation",
    objectId: "event-7",
    conversationId: "chat-1",
    turnId: "turn-4",
    title: "Last incident",
    snippet: "Incident notes",
    score: 0.018,
    rank: 3,
    eventTime: "2026-10-01T12:00:00Z",
};
function result(
    matches = [source, procedure, conversation],
): MemoryHubSearchResult {
    return {
        query: "worker",
        matches,
        ranking: "reciprocal-rank-fusion",
        warnings: [],
        errors: [],
        answer: {
            text: "Review the guide and last incident.",
            mode: "synthesized",
            citationIds: matches.map((item) => item.id),
            followUps: ["What changed?"],
        },
    };
}
function button(text: string): HTMLButtonElement {
    const value = Array.from(host.querySelectorAll("button")).find(
        (item) => item.textContent === text,
    );
    if (!value) throw new Error(`Button not found: ${text}`);
    return value;
}
function field<T extends HTMLElement>(name: string): T {
    return host.querySelector<T>(`[name="${name}"]`)!;
}
test("empty search hides recent and result controls, and source-type disclosure preserves multiselect filters", async () => {
    expect(
        host.querySelector<HTMLElement>('[aria-label="Recent queries"]')!
            .hidden,
    ).toBe(true);
    expect(
        host.querySelector<HTMLElement>('[aria-label="Search result view"]')!
            .hidden,
    ).toBe(true);
    const types = field<HTMLSelectElement>("sourceTypes");
    expect(types.multiple).toBe(true);
    types.options[0].selected = true;
    types.options[1].selected = true;
    types.dispatchEvent(new Event("change"));
    expect(
        host.querySelector(".phase2-source-types summary")!.textContent,
    ).toBe("web, markdown");
    await mounted.show("worker");
    expect(invoke).toHaveBeenCalledWith(
        "memoryHubSearch",
        expect.objectContaining({ sourceTypes: ["web", "markdown"] }),
    );
    expect(
        host.querySelector<HTMLElement>('[aria-label="Recent queries"]')!
            .hidden,
    ).toBe(false);
    expect(
        host.querySelector<HTMLElement>('[aria-label="Search result view"]')!
            .hidden,
    ).toBe(false);
    expect(button("List").getAttribute("aria-pressed")).toBe("true");
});
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}

beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    scope = undefined;
    onSource = jest.fn();
    onProcedure = jest.fn();
    onError = jest.fn();
    onQueryChanged = jest.fn();
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event("close"));
    };
    mounted = mountMemoryHubSearch(host, {
        scope: () => scope,
        onOpenSource: onSource,
        onOpenProcedure: onProcedure,
        onError,
        onQueryChanged,
    });
    invoke.mockImplementation(
        async (method: string, params: { offset?: number }) =>
            method === "memoryHubSearch"
                ? result()
                : {
                      title: "Evidence",
                      content: params.offset
                          ? "Second page"
                          : "<script>literal original</script>",
                      offset: params.offset ?? 0,
                      totalChars: 40,
                      nextOffset: params.offset ? undefined : 20,
                      provenance: {
                          corpusId: "a",
                          kind: "source",
                          objectId: "source",
                          revisionId: "r3",
                          locator: "lines 3–8",
                      },
                  },
    );
});
afterEach(() => {
    mounted.dispose();
    host.remove();
});

test("healthy bounded retrieval notices are not failed retrieval, and explicit decisions are labelled", async () => {
    invoke.mockResolvedValueOnce({
        ...result([{ ...conversation, authoritative: true }]),
        warnings: ["Bounded evidence selection"],
    });
    await mounted.show("worker");
    expect(host.querySelector(".phase2-warning")!.textContent).toContain(
        "Search limits and notices",
    );
    expect(host.querySelector(".phase2-warning")!.textContent).not.toContain(
        "degraded",
    );
    expect(host.querySelector(".phase2-results")!.textContent).toContain(
        "Explicit conversation decision",
    );
});

test("mixed evidence is answer-first, safely rendered, and exact citations never guess by excerpt", async () => {
    await mounted.show("worker");
    expect(host.querySelector(".phase2-answer")!.textContent).toContain(
        "Derived answer",
    );
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(3);
    expect(host.querySelector("img")).toBeNull();
    button(source.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "a",
        kind: "source",
        objectId: "source",
        revisionId: "r3",
        offset: 0,
    });
    expect(host.querySelector("dialog pre")!.textContent).toBe(
        "<script>literal original</script>",
    );
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("dialog textarea")).toBeNull();
    button("Next evidence").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "a",
        kind: "source",
        objectId: "source",
        revisionId: "r3",
        offset: 20,
    });
    button("Previous evidence").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubEvidence",
        expect.objectContaining({ revisionId: "r3", offset: 0 }),
    );
    button("Close evidence").click();
    button(procedure.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "b",
        kind: "procedure",
        objectId: "procedure",
        procedureVersion: 4,
        offset: 0,
    });
    button("Open latest procedure management (not this cited version)").click();
    expect(onProcedure).toHaveBeenCalledWith("b", "procedure");
    expect(host.querySelector("dialog")!.open).toBe(false);
    button(conversation.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "conversation",
        kind: "conversation",
        objectId: "event-7",
        offset: 0,
    });
});

test("submitted filters include corpus, types, tags, inclusive dates and conversation scope", async () => {
    scope = "a";
    field<HTMLSelectElement>("sourceTypes").options[1].selected = true;
    field<HTMLInputElement>("tags").value = "ops, worker";
    field<HTMLInputElement>("dateFrom").value = "2026-10-01";
    field<HTMLInputElement>("dateTo").value = "2026-10-02";
    field<HTMLSelectElement>("conversationScope").value = "current";
    await mounted.show("worker");
    expect(invoke).toHaveBeenCalledWith(
        "memoryHubSearch",
        expect.objectContaining({
            corpusId: "a",
            sourceTypes: ["markdown"],
            tags: ["ops", "worker"],
            dateFrom: "2026-10-01T00:00:00.000Z",
            dateTo: "2026-10-02T23:59:59.999Z",
            conversationScope: "current",
            generateAnswer: true,
        }),
    );
    expect(host.textContent).toContain("Unknown dates are excluded");
    button("Grid").click();
    button(source.title).click();
    await settle();
    button("Open latest source management (not this cited revision)").click();
    expect(onSource).toHaveBeenCalledWith("a", "source");
    const calls = invoke.mock.calls.length;
    await mounted.show("worker");
    expect(invoke.mock.calls).toHaveLength(calls);
    expect(host.querySelector(".phase2-results.grid")).not.toBeNull();
    expect(field<HTMLInputElement>("tags").value).toBe("ops, worker");
    expect(localStorage.getItem("memoryHub.recentQueries")).toContain("worker");
    button("What changed?").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubSearch",
        expect.objectContaining({
            query: "What changed?",
            tags: ["ops", "worker"],
        }),
    );
});

test("late search and evidence responses are ignored after scope changes", async () => {
    let resolveOld!: (value: MemoryHubSearchResult) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolveOld = resolve;
            }),
    );
    const old = mounted.show("old");
    scope = "b";
    mounted.scopeChanged();
    await mounted.show("new");
    resolveOld({ ...result([source]), query: "old" });
    await old;
    expect(host.querySelector(".phase2-status")!.textContent).not.toContain(
        "old",
    );
    let resolveEvidence!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                resolveEvidence = resolve;
            }),
    );
    button(source.title).click();
    scope = "c";
    mounted.scopeChanged();
    resolveEvidence({
        content: "STALE EVIDENCE",
        offset: 0,
        totalChars: 14,
        provenance: {},
    });
    await settle();
    expect(host.textContent).not.toContain("STALE EVIDENCE");
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(0);
    expect(field<HTMLInputElement>("query").value).toBe("new");
});

test("partial results and unavailable exact revisions remain explicit", async () => {
    invoke.mockResolvedValueOnce({
        ...result([{ ...source, revisionId: undefined }]),
        warnings: ["Conversation dates unavailable"],
        errors: [{ corpusId: "b", operation: "search", message: "offline" }],
    });
    await mounted.show("worker");
    expect(host.querySelector(".phase2-warning")!.textContent).toContain(
        "Partial or degraded",
    );
    expect(host.querySelector(".phase2-warning")!.textContent).toContain(
        "offline",
    );
    const count = invoke.mock.calls.length;
    button(source.title).click();
    await settle();
    expect(invoke.mock.calls).toHaveLength(count);
    expect(host.querySelector("dialog")!.textContent).toContain(
        "latest content is not substituted",
    );
    expect(onError).toHaveBeenCalled();
});

test("search failures are not rendered as a successful empty search", async () => {
    invoke.mockRejectedValueOnce(
        new Error("Browser view service is unavailable"),
    );
    await mounted.show("worker");
    expect(host.querySelector(".phase2-status")!.textContent).toContain(
        "Unavailable",
    );
    expect(host.textContent).not.toContain("No matching evidence.");
    expect(onError).toHaveBeenCalled();
});

test("noAnswer status and bounded evidence counts do not claim successful synthesis or full totals", async () => {
    invoke.mockResolvedValueOnce({
        ...result([source]),
        answer: {
            status: "noAnswer",
            mode: "extractive",
            text: "No grounded answer is available.",
            citationIds: ["source-citation"],
            followUps: [],
        },
        warnings: ["Only responding providers are included."],
    });
    await mounted.show("worker");
    expect(host.querySelector(".phase2-answer h3")!.textContent).toBe(
        "No grounded answer",
    );
    expect(host.querySelector(".phase2-status")!.textContent).toContain(
        "bounded, not a full total",
    );
    expect(host.querySelector(".phase2-warning")!.textContent).toContain(
        "Only responding providers",
    );
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(1);
});

test("query callback fires only for validated changed submissions, not cached Back navigation", async () => {
    await mounted.show("worker");
    expect(onQueryChanged).toHaveBeenCalledWith("worker");
    const calls = invoke.mock.calls.length;
    field<HTMLInputElement>("query").value = "Unsubmitted draft";
    await mounted.show();
    expect(onQueryChanged).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls).toHaveLength(calls);
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(3);
    field<HTMLInputElement>("query").value = "other";
    field<HTMLInputElement>("dateFrom").value = "2026-10-04";
    field<HTMLInputElement>("dateTo").value = "2026-10-01";
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { cancelable: true }),
    );
    await settle();
    expect(onQueryChanged).toHaveBeenCalledTimes(1);
    field<HTMLInputElement>("dateTo").value = "2026-10-05";
    host.querySelector("form")!.dispatchEvent(
        new Event("submit", { cancelable: true }),
    );
    await settle();
    expect(onQueryChanged.mock.calls).toEqual([["worker"], ["other"]]);
    await mounted.show("other");
    expect(onQueryChanged).toHaveBeenCalledTimes(2);
});

test.each(["{bad JSON", '{"not":"an array"}', '["valid",7]'])(
    "malformed recent preference %s is warned about without breaking search",
    async (stored) => {
        const warning = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        try {
            localStorage.setItem("memoryHub.recentQueries", stored);
            mounted.dispose();
            mounted = mountMemoryHubSearch(host, {
                scope: () => scope,
                onOpenSource: onSource,
                onOpenProcedure: onProcedure,
                onError,
            });
            expect(warning).toHaveBeenCalled();
            await mounted.show("worker");
            expect(
                host.querySelectorAll(".phase2-results article"),
            ).toHaveLength(3);
            expect(localStorage.getItem("memoryHub.recentQueries")).toBe(
                '["worker"]',
            );
        } finally {
            warning.mockRestore();
        }
    },
);

test("source revisions use a document-level preview and do not show unresolved locators", async () => {
    invoke.mockResolvedValueOnce(
        result([{ ...source, locator: "message:12" }]),
    );
    await mounted.show("worker");
    button(source.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "a",
        kind: "source",
        objectId: "source",
        revisionId: "r3",
        offset: 0,
    });

    const dialog = host.querySelector("dialog")!;
    const visibleParagraphs = Array.from(dialog.querySelectorAll("p"))
        .map((value) => value.textContent)
        .join("\n");
    expect(visibleParagraphs).toContain(
        "DOCUMENT-LEVEL original revision preview",
    );
    expect(visibleParagraphs).toContain(
        "precise passage location is unavailable",
    );
    expect(visibleParagraphs).toContain("No snippet guessing");
    expect(visibleParagraphs).not.toContain("message:12");
    expect(visibleParagraphs).not.toContain("lines 3–8");
});

const web: MemoryHubEvidence = {
    ...source,
    id: "web-citation",
    corpusId: "fixedBrowserMemory",
    corpusName: "Browser memory",
    sourceType: "web",
    canonicalUri: "https://EXAMPLE.org/path?q=1",
    eventTime: "2026-10-02T01:00:00+02:00",
    title: "Web reference",
};

test("web timeline uses real UTC event dates, marks missing dates, and keeps mixed evidence navigable", async () => {
    invoke.mockResolvedValueOnce(
        result([
            web,
            {
                ...web,
                id: "missing",
                eventTime: undefined,
                title: "Missing date",
            },
            {
                ...web,
                id: "invalid",
                eventTime: "invalid",
                title: "Invalid date",
            },
            source,
            procedure,
            conversation,
        ]),
    );
    await mounted.show("worker");
    button("Timeline").click();
    const headings = Array.from(
        host.querySelectorAll(".phase2-search-group > h3"),
    ).map((item) => item.textContent);
    expect(headings).toEqual([
        "2026-10-01 (UTC capture date)",
        "Date unavailable",
        "Other memory evidence (List)",
    ]);
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(6);
    button(web.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubEvidence",
        expect.objectContaining({
            corpusId: "fixedBrowserMemory",
            revisionId: "r3",
        }),
    );
    button("Close evidence").click();
    const count = invoke.mock.calls.length;
    await mounted.show("worker");
    expect(invoke.mock.calls).toHaveLength(count);
    expect(button("Timeline").getAttribute("aria-pressed")).toBe("true");
});

test("domain grouping uses actual URI hostname only and exposes missing or invalid domains", async () => {
    invoke.mockResolvedValueOnce(
        result([
            web,
            {
                ...web,
                id: "other-path",
                canonicalUri: "https://example.org/another",
                title: "Same domain",
            },
            {
                ...web,
                id: "unknown",
                canonicalUri: undefined,
                snippet: "https://fake.example",
                title: "Unknown domain",
            },
            {
                ...web,
                id: "invalid-uri",
                canonicalUri: "not a URI",
                title: "Invalid URI",
            },
            { ...source, canonicalUri: "https://not-web.example" },
        ]),
    );
    await mounted.show("worker");
    button("Domain").click();
    const headings = Array.from(
        host.querySelectorAll(".phase2-search-group > h3"),
    ).map((item) => item.textContent);
    expect(headings).toEqual([
        "example.org",
        "Domain unavailable",
        "Other memory evidence (List)",
    ]);
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(5);
    expect(headings).not.toContain("fake.example");
});

test("web-only defaults are gated for nonweb results and restored for real web results without changing scope", async () => {
    updateMemoryHubViewPreferences({ defaultViewMode: "timeline" });
    scope = "named";
    await mounted.show("worker");
    expect(button("Timeline").hidden).toBe(true);
    expect(button("Domain").hidden).toBe(true);
    expect(button("List").getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("requires web evidence");
    field<HTMLInputElement>("tags").value = "ops";
    invoke.mockResolvedValueOnce(result([{ ...web, corpusId: "named" }]));
    await mounted.show("web worker");
    expect(button("Timeline").hidden).toBe(false);
    expect(button("Timeline").getAttribute("aria-pressed")).toBe("true");
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubSearch",
        expect.objectContaining({ corpusId: "named", tags: ["ops"] }),
    );
    updateMemoryHubViewPreferences({ defaultViewMode: "grid" });
    expect(host.querySelector(".phase2-results.grid")).not.toBeNull();
    const calls = invoke.mock.calls.length;
    mounted.dispose();
    updateMemoryHubViewPreferences({ defaultViewMode: "domain" });
    expect(invoke.mock.calls).toHaveLength(calls);
    expect(host.children).toHaveLength(0);
});

test("optional success notifications honor preferences without suppressing error reporting", async () => {
    mounted.dispose();
    const onNotify = jest.fn();
    mounted = mountMemoryHubSearch(host, {
        scope: () => scope,
        onOpenSource: onSource,
        onOpenProcedure: onProcedure,
        onError,
        onNotify,
    });
    await mounted.show("worker");
    expect(onNotify).toHaveBeenCalledTimes(1);
    updateMemoryHubViewPreferences({ enableNotifications: false });
    invoke.mockRejectedValueOnce(new Error("Service offline"));
    await mounted.show("failure");
    expect(host.querySelector(".phase2-status")!.textContent).toContain(
        "Service offline",
    );
    expect(onError).toHaveBeenCalled();
    await mounted.show("other");
    expect(onNotify).toHaveBeenCalledTimes(1);
});

test("snippets and the answer render as Markdown, not raw text", async () => {
    const rich: MemoryHubEvidence = {
        ...source,
        snippet:
            "## Setup\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n" +
            "```ts\nconst x = 1;\n```\n\n- [x] done",
    };
    invoke.mockResolvedValueOnce({
        ...result([rich]),
        answer: {
            text: "Use **bold** steps.",
            mode: "synthesized",
            citationIds: [],
            followUps: [],
        },
    });
    await mounted.show("worker");
    const card = host.querySelector("article .md-snippet")!;
    expect(card.querySelector("h2")!.textContent).toBe("Setup");
    expect(card.querySelectorAll("table th")).toHaveLength(2);
    expect(card.querySelector("code.language-ts")).not.toBeNull();
    expect(card.querySelector("input[type=checkbox]")).not.toBeNull();
    expect(card.textContent).not.toContain("|---|");
    expect(host.querySelector("strong")!.textContent).toBe("bold");
});

test("related entities are cards like the Explore view", async () => {
    scope = "a";
    invoke.mockResolvedValueOnce({
        ...result([source]),
        insights: {
            provider: "canonical",
            status: "available",
            corpusId: "a",
            topTopics: [],
            relatedEntities: [
                { name: "Worker", type: "service", confidence: 0.87 },
                { name: "Queue", type: "system" },
            ],
        },
    });
    await mounted.show("worker");
    const insights = host.querySelector(".phase2-search-insights")!;
    expect(insights.querySelector("ul")).toBeNull();
    const cards = insights.querySelectorAll(
        ".knowledge-collection .knowledge-cards article.knowledge-item",
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".knowledge-item-title")!.textContent).toBe(
        "Worker",
    );
    expect(cards[0].querySelector(".knowledge-item-meta")!.textContent).toBe(
        "service · confidence 87%",
    );
    expect(cards[1].querySelector(".knowledge-item-meta")!.textContent).toBe(
        "system",
    );
});

test("canonical typed insights navigate queries without losing named scope or filters and confidence is preference-driven", async () => {
    scope = "a";
    field<HTMLInputElement>("tags").value = "ops";
    const response = {
        ...result([source]),
        insights: {
            provider: "canonical",
            status: "available",
            corpusId: "a",
            topTopics: ["Queue operations"],
            relatedEntities: [
                { name: "Worker", type: "service", confidence: 0.87 },
                { name: "Untyped confidence", type: "system" },
            ],
        },
    };
    invoke.mockResolvedValueOnce(response);
    await mounted.show("worker");
    const insights = host.querySelector(".phase2-search-insights")!;
    expect(insights.textContent).toContain("Top Topics");
    expect(insights.textContent).toContain("Related Entities");
    expect(insights.textContent).toContain("confidence 87%");
    updateMemoryHubViewPreferences({ showConfidenceScores: false });
    expect(insights.textContent).not.toContain("confidence 87%");
    expect(insights.textContent).toContain("Worker");
    button("Queue operations").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubSearch",
        expect.objectContaining({
            query: "Queue operations",
            corpusId: "a",
            tags: ["ops"],
        }),
    );
    invoke.mockResolvedValueOnce(response);
    await mounted.show("worker");
    button("Worker").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubSearch",
        expect.objectContaining({
            query: "Worker",
            corpusId: "a",
            tags: ["ops"],
        }),
    );
});

test("available canonical insights visibly retain backend revision bounds through view and preference changes", async () => {
    const message =
        "Insights cover at most 20 returned active source revisions, not corpus-wide statistics.";
    invoke.mockResolvedValueOnce({
        ...result([source, procedure, conversation]),
        insights: {
            provider: "canonical",
            status: "available",
            topTopics: ["Bounded topic"],
            relatedEntities: [{ name: "Bounded entity", type: "service" }],
            message,
        },
    });
    await mounted.show("worker");
    const insights = host.querySelector(".phase2-search-insights")!;
    const notice = insights.querySelector<HTMLElement>(
        ".phase2-insight-notice",
    )!;
    expect(notice.textContent).toBe(message);
    expect(notice.hidden).toBe(false);
    expect(notice.closest(".phase2-inspector")).toBeNull();
    expect(insights.textContent).toContain("bounded returned-source selection");
    expect(insights.textContent).not.toContain("complete query metadata");
    expect(insights.textContent).toContain("Bounded topic");
    button("Grid").click();
    updateMemoryHubViewPreferences({ showConfidenceScores: false });
    expect(insights.querySelector(".phase2-insight-notice")!.textContent).toBe(
        message,
    );
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(3);
});

test("the fixed Browser web insight lens is explicitly labelled and never stands in for All or named memory", async () => {
    const response = {
        ...result([web, procedure]),
        insights: {
            provider: "fixedBrowserMemory",
            status: "available",
            corpusId: "fixedBrowserMemory",
            topTopics: ["Web topic"],
            relatedEntities: [
                {
                    name: "Browser entity",
                    type: "application",
                    confidence: 0.9,
                },
            ],
        },
    };
    scope = "fixedBrowserMemory";
    invoke.mockResolvedValueOnce(response);
    await mounted.show("browser");
    expect(
        host.querySelector(".phase2-search-insights")!.textContent,
    ).toContain("fixed Browser memory only");
    for (const nextScope of [undefined, "named"]) {
        scope = nextScope;
        mounted.scopeChanged();
        invoke.mockResolvedValueOnce(response);
        await mounted.show(`scope-${nextScope}`);
        const insights = host.querySelector(".phase2-search-insights")!;
        expect(insights.textContent).toContain("scope does not match");
        expect(insights.textContent).not.toContain("Web topic");
    }
    expect(onError).toHaveBeenCalledTimes(2);
});

test.each(["unsupported", "unavailable"])(
    "insight %s is explicit and never hides search errors or invents metadata",
    async (status) => {
        updateMemoryHubViewPreferences({
            enableNotifications: false,
            showConfidenceScores: false,
        });
        invoke.mockResolvedValueOnce({
            ...result([source]),
            errors: [
                {
                    corpusId: "b",
                    operation: "search",
                    message: "Search offline",
                },
            ],
            insights: {
                provider: "canonical",
                status,
                topTopics: [],
                relatedEntities: [],
                message: "Knowledge unavailable for this scope",
            },
        });
        await mounted.show("worker");
        expect(
            host.querySelector(".phase2-search-insights")!.textContent,
        ).toContain(`Insights ${status}`);
        expect(
            host.querySelector(".phase2-search-insights")!.textContent,
        ).toContain("Knowledge unavailable");
        expect(host.querySelector(".phase2-warning")!.textContent).toContain(
            "Search offline",
        );
        expect(host.querySelectorAll(".phase2-results article")).toHaveLength(
            1,
        );
    },
);

test("missing or malformed insights are explicit and no snippets become topics", async () => {
    await mounted.show("worker");
    expect(
        host.querySelector(".phase2-search-insights")!.textContent,
    ).toContain("not inferred from snippets");
    invoke.mockResolvedValueOnce({
        ...result([source]),
        insights: {
            provider: "canonical",
            status: "available",
            topTopics: ["Invalid metadata"],
            relatedEntities: [
                { name: "Entity", type: "service", confidence: 7 },
            ],
        },
    });
    await mounted.show("malformed");
    const insights = host.querySelector(".phase2-search-insights")!;
    expect(insights.textContent).toContain("invalid typed metadata response");
    expect(insights.textContent).not.toContain("Invalid metadata");
    expect(onError).toHaveBeenCalled();
});

test("web insights cannot be shown for a nonweb result even in fixed Browser scope", async () => {
    scope = "fixedBrowserMemory";
    invoke.mockResolvedValueOnce({
        ...result([procedure]),
        insights: {
            provider: "fixedBrowserMemory",
            corpusId: scope,
            status: "available",
            topTopics: ["Wrong topic"],
            relatedEntities: [],
        },
    });
    await mounted.show("how to");
    expect(
        host.querySelector(".phase2-search-insights")!.textContent,
    ).toContain("require actual returned web evidence");
    expect(
        host.querySelector(".phase2-search-insights")!.textContent,
    ).not.toContain("Wrong topic");
    expect(button("Timeline").hidden).toBe(true);
    expect(onError).toHaveBeenCalled();
});

test("late web results and insights do not reappear after scope change or disposal", async () => {
    let resolve!: (value: unknown) => void;
    invoke.mockImplementationOnce(
        () =>
            new Promise((complete) => {
                resolve = complete;
            }),
    );
    scope = "fixedBrowserMemory";
    const pending = mounted.show("browser");
    scope = "named";
    mounted.scopeChanged();
    mounted.dispose();
    resolve({
        ...result([web]),
        insights: {
            provider: "fixedBrowserMemory",
            status: "available",
            corpusId: "fixedBrowserMemory",
            topTopics: ["Late topic"],
            relatedEntities: [],
        },
    });
    await pending;
    expect(host.children).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
});
