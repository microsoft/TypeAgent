// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { hubNotifications } from "./memoryHubNotifications";
import type { UnderstandingResult } from "@typeagent/memory-service";
import type {
    MemoryHubEvidence,
    MemoryHubSearchResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import { mountMemoryHubSearch } from "./memoryHubSearch";
import { invokeView, streamUnderstanding } from "./viewClient";
import { updateMemoryHubViewPreferences } from "./memoryHubViewPreferences";

jest.mock("./memoryHubPhase2.css", () => ({}));
jest.mock("./memoryHubUnderstanding.css", () => ({}));
jest.mock("./memoryHubViewPreferences.css", () => ({}));
jest.mock("./viewClient", () => ({
    invokeView: jest.fn(),
    streamUnderstanding: jest.fn(),
}));
const invoke = invokeView as jest.Mock;
const stream = streamUnderstanding as jest.Mock;
let host: HTMLElement;
let queryInput: HTMLTextAreaElement;
let mounted: ReturnType<typeof mountMemoryHubSearch>;
let scope: string | undefined;
let onSource: jest.Mock;
let onError: jest.Mock;
let onQueryChanged: jest.Mock;
let onView: jest.Mock;

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
const derivedView: MemoryHubEvidence = {
    id: "derivedView-citation",
    kind: "view",
    corpusId: "b",
    corpusName: "Beta",
    objectId: "derivedView",
    revisionId: "view-r4",
    viewKind: "troubleshootingGuide",
    viewVersion: 4,
    viewProvenance: "generated",
    review: "unreviewed",
    freshness: "stale",
    sourceRevisionIds: ["r3"],
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
    matches = [source, derivedView, conversation],
): MemoryHubSearchResult {
    return {
        query: "worker",
        matches,
        ranking: "reciprocal-rank-fusion",
        resolvedIntent: "ask",
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
        (item) =>
            item.textContent?.trim() === text ||
            item.getAttribute("aria-label") === text ||
            item.getAttribute("aria-label") === `${text} view`,
    );
    if (!value) throw new Error(`Button not found: ${text}`);
    return value;
}
function field<T extends HTMLElement>(name: string): T {
    return (name === "query" ? document : host).querySelector<T>(
        `[name="${name}"]`,
    )!;
}
function clickQuery(text: string) {
    const link = Array.from(host.querySelectorAll("a")).find(
        (item) => item.textContent === text,
    );
    if (!link) throw new Error(`Query link not found: ${text}`);
    link.click();
}
test("uses the external header query and does not create a duplicate composer", () => {
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe(
        "Ask or Explain",
    );
    expect(host.querySelector(".phase2-query")).toBeNull();
    expect(host.querySelector('[name="query"]')).toBeNull();
    expect(field<HTMLInputElement>("query").placeholder).toBe("Ask or Explain");
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe(
        "Apply filters",
    );
    expect(field<HTMLSelectElement>("intent").getAttribute("aria-label")).toBe(
        "Response mode",
    );
});
test.each([26, 49, 50])(
    "paginates %i returned results in exact groups of 25 and resets on a new search",
    async (count) => {
        const matches = Array.from({ length: count }, (_, index) => ({
            ...source,
            id: `cite-${index}`,
            objectId: `source-${index}`,
            title: `Document ${index}`,
        }));
        invoke.mockResolvedValue(result(matches));
        await mounted.show("worker");
        expect(host.querySelectorAll(".phase2-results > article")).toHaveLength(
            25,
        );
        expect(
            host.querySelector(".phase2-results")!.textContent,
        ).not.toContain("Document 25");
        expect(button("Previous page").disabled).toBe(true);
        button("Next page").click();
        expect(host.querySelectorAll(".phase2-results > article")).toHaveLength(
            count - 25,
        );
        expect(
            host.querySelector(".phase2-result-pager")!.textContent,
        ).toContain(`26-${count} of ${count} returned`);
        expect(button("Next page").disabled).toBe(true);
        expect(
            host.querySelector(".phase2-results h3 button")!.textContent,
        ).toBe("Document 25");
        const card = host.querySelector(".phase2-results article")!;
        (card.querySelector("button") as HTMLButtonElement).click();
        await settle();
        expect(invoke).toHaveBeenLastCalledWith(
            "memoryHubEvidence",
            expect.objectContaining({
                objectId: "source-25",
                revisionId: "r3",
            }),
        );
        button("Close evidence").click();
        await mounted.show("another query");
        expect(
            host.querySelector(".phase2-results h3 button")!.textContent,
        ).toBe("Document 0");
        expect(button("Previous page").disabled).toBe(true);
    },
);

test.each(["Timeline", "Domain"])(
    "%s grouping paginates the same bounded evidence selection",
    async (mode) => {
        const matches = Array.from({ length: 26 }, (_, index) => ({
            ...source,
            id: `web-${index}`,
            sourceType: "web" as const,
            title: `Web document ${index}`,
            canonicalUri: "https://example.invalid/page",
            eventTime: "2026-10-01T00:00:00Z",
        }));
        invoke.mockResolvedValue(result(matches));
        await mounted.show("worker");
        button(mode).click();
        expect(host.querySelectorAll(".phase2-results article")).toHaveLength(
            25,
        );
        button("Next page").click();
        expect(host.querySelectorAll(".phase2-results article")).toHaveLength(
            1,
        );
        expect(host.querySelector(".phase2-results")!.textContent).toContain(
            "Web document 25",
        );
    },
);

test("manual response modes stay under Filters and the automatically chosen mode is visible", async () => {
    expect(field("intent").closest(".hub-filters")).not.toBeNull();
    invoke.mockResolvedValue({ ...result([source]), resolvedIntent: "ask" });
    await mounted.show("worker");
    expect(host.textContent).toContain(
        "Answer and sources (chosen automatically)",
    );
    field<HTMLSelectElement>("intent").value = "find";
    await mounted.show("find worker docs");
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubSearch",
        expect.objectContaining({ intent: "find" }),
    );
    expect(
        invoke.mock.calls[invoke.mock.calls.length - 1][1].generateAnswer,
    ).toBe(false);
});

test("an older host cannot silently downgrade Auto into a source-only success", async () => {
    const { resolvedIntent: _intent, ...legacy } = result();
    invoke.mockResolvedValue(legacy);
    await mounted.show("worker");
    expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
            message: expect.stringContaining("does not support automatic"),
        }),
    );
    expect(host.querySelectorAll(".phase2-results article")).toHaveLength(0);
});

test("only eligible exact document evidence offers Explain this", async () => {
    mounted.dispose();
    mounted = mountMemoryHubSearch(host, {
        queryInput,
        scope: () => scope,
        onError,
        onOpenSource: onSource,
        onUnderstand: jest.fn(),
    });
    mounted.setUnderstandingEnabled(true);
    invoke.mockResolvedValue(
        result([
            source,
            derivedView,
            conversation,
            { ...source, id: "missing", revisionId: undefined },
            { ...source, id: "browser", corpusId: "fixedBrowserMemory" },
        ]),
    );
    await mounted.show("worker");
    expect(
        [...host.querySelectorAll("button")].filter(
            (item) => item.textContent === "Explain this",
        ),
    ).toHaveLength(1);
});

test("Explain opens an in-place source overlay, streams real prose and cancels cleanly on close", async () => {
    mounted.dispose();
    host.replaceChildren();
    const onUnderstand = jest.fn();
    mounted = mountMemoryHubSearch(host, {
        queryInput,
        scope: () => scope,
        onError,
        onOpenSource: onSource,
        onUnderstand,
    });
    mounted.setUnderstandingEnabled(true);
    let publish!: (value: UnderstandingResult) => void;
    let signal!: AbortSignal;
    let finish!: () => void;
    stream.mockImplementation((_request, callback, abort) => {
        publish = callback;
        signal = abort;
        return new Promise<void>((resolve) => {
            finish = resolve;
        });
    });
    await mounted.show("worker");
    const opener = button("Explain this");
    opener.focus();
    const originalHash = location.hash;
    opener.click();
    const dialog = host.querySelector<HTMLDialogElement>(
        ".phase2-source-dialog",
    )!;
    expect(dialog.open).toBe(true);
    expect(host.querySelector(".understanding-loading")?.textContent).toBe(
        "Loading...",
    );
    expect(onUnderstand).not.toHaveBeenCalled();
    expect(location.hash).toBe(originalHash);
    expect(dialog.querySelector("input,textarea")).toBeNull();
    const response: UnderstandingResult = {
        schemaVersion: 1,
        snapshotId: "explanation",
        turnId: "turn",
        corpusId: "a",
        question: "worker",
        expiresAt: "2099-01-01T00:00:00Z",
        citations: [],
        modules: [],
        warnings: [],
    };
    publish(response);
    expect(host.querySelector(".understanding-loading")).not.toBeNull();
    publish({
        ...response,
        answer: {
            status: "noAnswer",
            title: "Not established in this source",
            summary: {
                text: "The source does not establish that claim.",
                evidenceIds: [],
                role: "memory",
            },
            sections: [],
            unknowns: [],
            followUps: [],
        },
    });
    expect(host.querySelector(".understanding-loading")).toBeNull();
    expect(dialog.textContent).toContain("Not established in this source");
    button("Close evidence").click();
    expect(signal.aborted).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(dialog.open).toBe(false);
    finish();
    await settle();
});

test("answer citations are inline numbered footnotes, skip code and retain exact evidence actions", async () => {
    const value = result([source, derivedView]);
    value.answer!.text =
        "First claim [1]. Second claim [2]. Literal code `[1]`.";
    invoke.mockResolvedValueOnce(value);
    await mounted.show("worker");
    const answer = host.querySelector(".phase2-answer")!;
    expect(answer.querySelector("h3")?.textContent).toBe("From your memory");
    expect(answer.querySelector("code")?.textContent).toBe("[1]");
    const notes = answer.querySelectorAll<HTMLButtonElement>(
        ".phase2-citation button",
    );
    expect([...notes].map((note) => note.textContent)).toEqual(["[1]", "[2]"]);
    expect(notes[0].getAttribute("aria-label")).toContain(source.title);
    expect(answer.textContent).not.toContain(source.title);
    notes[1].click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubEvidence",
        expect.objectContaining({
            objectId: "derivedView",
            revisionId: "view-r4",
        }),
    );
    expect(
        [...host.querySelectorAll(".phase2-source-index")].map(
            (node) => node.textContent,
        ),
    ).toEqual(["[1]", "[2]"]);
});

test("History opens a query-link dialog and Filters dismisses without losing selected values", async () => {
    localStorage.setItem(
        "memoryHub.recentQueries",
        JSON.stringify(["worker", "Earlier question"]),
    );
    await mounted.show("worker");
    button("History").click();
    const history = host.querySelector<HTMLDialogElement>(
        ".phase2-history-dialog",
    )!;
    expect(history.open).toBe(true);
    expect(
        [...history.querySelectorAll("a")].map((link) => link.textContent),
    ).toEqual(["Earlier question"]);
    history.querySelector<HTMLAnchorElement>("a")!.click();
    await settle();
    expect(history.open).toBe(false);
    expect(queryInput.value).toBe("Earlier question");
    const filters = host.querySelector<HTMLDetailsElement>(".hub-filters")!;
    filters.open = true;
    field<HTMLInputElement>("tags").value = "keep";
    document.body.click();
    expect(filters.open).toBe(false);
    filters.open = true;
    filters.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(filters.open).toBe(false);
    expect(field<HTMLInputElement>("tags").value).toBe("keep");
});

test("answer and supporting evidence stay together while typed insights use the supporting rail", async () => {
    invoke.mockResolvedValue(result([source]));
    await mounted.show("worker");
    const reading = host.querySelector(".phase2-search-reading")!;
    expect(reading.querySelector(".phase2-answer")).not.toBeNull();
    expect(reading.querySelector(".phase2-results")).not.toBeNull();
    expect(
        host
            .querySelector(".phase2-result-layout > aside")
            ?.getAttribute("aria-label"),
    ).toBe("Related context");
    expect(
        reading.querySelector(".phase2-evidence-meta")?.textContent,
    ).toContain("Captured source revision");
});

test("Ask forwards explicit retrieval/checkpoint policy and shows exact derived and user assertion references", async () => {
    field<HTMLSelectElement>("intent").value = "ask";
    const reference = {
        corpusId: "a",
        viewId: "knowledge",
        revisionId: "view-revision",
        sectionId: "slot",
        state: "selected" as const,
    };
    const response = result([source]);
    response.answer!.derivedReferences = [reference];
    response.answer!.assertionReferences = [
        { ...reference, candidateId: "candidate", assertionOrigin: "user" },
    ];
    invoke.mockResolvedValue(response);
    host.querySelector<HTMLSelectElement>(
        '[aria-label="Answer retrieval policy"]',
    )!.value = "sourcesAndViews";
    host.querySelector<HTMLInputElement>(
        '[aria-label="Required knowledge checkpoint"]',
    )!.value = "checkpoint";
    await mounted.show("worker");
    expect(invoke).toHaveBeenCalledWith(
        "memoryHubSearch",
        expect.objectContaining({
            retrievalPolicy: "sourcesAndViews",
            knowledgeCheckpointId: "checkpoint",
        }),
    );
    button(
        "Maintained knowledge · knowledge @ view-revision · slot · selected",
    ).click();
    expect(onView).toHaveBeenCalledWith("a", "knowledge", "view-revision");
    expect(host.textContent).toContain(
        "candidate candidate (not independent source evidence)",
    );
});
test("Auto is default and Explain this uses the exact document, never a collection-wide prepared search", async () => {
    mounted.dispose();
    host.replaceChildren();
    const onUnderstand = jest.fn();
    mounted = mountMemoryHubSearch(host, {
        queryInput,
        scope: () => scope,
        onError,
        onOpenSource: onSource,
        onUnderstand,
    });
    mounted.setUnderstandingEnabled(true);
    invoke.mockResolvedValue({
        ...result([source]),
        answer: undefined,
        evidenceSnapshotId: "prepared",
    });
    await mounted.show("worker");
    expect(invoke).toHaveBeenCalledWith(
        "memoryHubSearch",
        expect.objectContaining({
            intent: "auto",
        }),
    );
    expect(host.querySelector("form")!.textContent).not.toContain("Understand");
    button("Explain this").click();
    expect(stream).toHaveBeenLastCalledWith(
        expect.objectContaining({
            corpusId: "a",
            question: "worker",
            source: { sourceId: "source", revisionId: "r3" },
            retrievalPolicy: "sourcesOnly",
        }),
        expect.any(Function),
        expect.any(AbortSignal),
    );
    field<HTMLInputElement>("tags").value = "different";
    button("Explain this").click();
    expect(stream).toHaveBeenLastCalledWith(
        expect.objectContaining({
            source: { sourceId: "source", revisionId: "r3" },
        }),
        expect.any(Function),
        expect.any(AbortSignal),
    );
    expect(stream.mock.calls[0][0]).not.toHaveProperty("evidenceSnapshotId");
    expect(onUnderstand).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLDialogElement>("dialog")?.open).toBe(true);
    button("Open full explanation").click();
    expect(onUnderstand).toHaveBeenCalledWith(
        expect.objectContaining({
            source: { sourceId: "source", revisionId: "r3" },
        }),
    );
    expect(scope).toBeUndefined();
});

test("empty search hides recent and result controls, and source-type disclosure preserves multiselect filters", async () => {
    expect(
        host.querySelector<HTMLElement>('[aria-label="Past queries"]')!.hidden,
    ).toBe(true);
    expect(
        host.querySelector<HTMLElement>('[aria-label="Evidence view"]')!.hidden,
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
        host.querySelector<HTMLElement>('[aria-label="Past queries"]')!.hidden,
    ).toBe(true);
    expect(
        host.querySelector<HTMLElement>('[aria-label="Evidence view"]')!.hidden,
    ).toBe(false);
    expect(button("List").getAttribute("aria-pressed")).toBe("true");
});
async function settle() {
    for (let index = 0; index < 20; index++) await Promise.resolve();
}

beforeEach(() => {
    localStorage.clear();
    invoke.mockReset();
    stream.mockReset();
    stream.mockResolvedValue(undefined);
    host = document.createElement("div");
    queryInput = document.createElement("textarea");
    queryInput.name = "query";
    queryInput.placeholder = "Ask or Explain";
    document.body.append(queryInput, host);
    scope = undefined;
    onSource = jest.fn();
    onError = jest.fn();
    onQueryChanged = jest.fn();
    onView = jest.fn();
    HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new Event("close"));
    };
    mounted = mountMemoryHubSearch(host, {
        queryInput,
        scope: () => scope,
        onOpenSource: onSource,
        onError,
        onQueryChanged,
        onOpenView: onView,
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
    queryInput.remove();
});

test("past queries are navigation links and exclude both the active question and its normalized duplicates", async () => {
    localStorage.setItem(
        "memoryHub.recentQueries",
        JSON.stringify(["worker", " WORKER  ", "Earlier question"]),
    );
    await mounted.show("worker");
    const links = Array.from(
        host.querySelectorAll<HTMLAnchorElement>(
            '[aria-label="Past queries"] a',
        ),
    );
    expect(links.map((link) => link.textContent)).toEqual(["Earlier question"]);
    expect(links.every((link) => link.classList.contains("phase2-link"))).toBe(
        true,
    );
    expect(new URL(links[0].href).searchParams.get("query")).toBe(
        "Earlier question",
    );
    expect(new URL(links[0].href).hash).toBe("#/search");
    queryInput.value = " Earlier   question ";
    queryInput.dispatchEvent(new Event("input"));
    expect(host.querySelectorAll('[aria-label="Past queries"] a')).toHaveLength(
        0,
    );
    queryInput.value = "worker";
    queryInput.dispatchEvent(new Event("input"));
    const historyLink = host.querySelector<HTMLAnchorElement>(
        '[aria-label="Past queries"] a',
    )!;
    const calls = invoke.mock.calls.length;
    historyLink.addEventListener(
        "click",
        (event) => {
            expect(event.defaultPrevented).toBe(false);
            event.preventDefault();
        },
        { once: true },
    );
    historyLink.dispatchEvent(
        new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
        }),
    );
    expect(invoke).toHaveBeenCalledTimes(calls);
    expect(queryInput.value).toBe("worker");
    historyLink.click();
    await settle();
    expect(queryInput.value).toBe("Earlier question");
    expect(invoke).toHaveBeenLastCalledWith(
        "memoryHubSearch",
        expect.objectContaining({ query: "Earlier question" }),
    );
    expect(host.querySelector(".phase2-status")?.textContent).not.toContain(
        "Earlier question",
    );
});

test("List and Grid are accessible icon buttons without visible text labels", async () => {
    await mounted.show("worker");
    for (const mode of ["List", "Grid"]) {
        expect(button(mode).textContent).toBe("");
        expect(button(mode).title).toBe(`${mode} view`);
    }
    button("Grid").click();
    expect(button("Grid").getAttribute("aria-pressed")).toBe("true");
    expect(button("List").getAttribute("aria-pressed")).toBe("false");
});

test("stale generated descriptions move to notifications without replacing the captured passage", async () => {
    invoke.mockResolvedValue(
        result([
            {
                ...source,
                synopsis: {
                    status: "ready",
                    freshness: "stale",
                    preview: "Obsolete generated description",
                    generatedVersion: 1,
                    recipe: "source-synopsis-v1",
                    inputHash: "semantic",
                },
            },
        ]),
    );
    await mounted.show("worker");
    expect(host.querySelector(".phase2-source-passage")?.textContent).toContain(
        "Captured evidence",
    );
    expect(host.querySelector(".phase2-source-summary")).toBeNull();
    expect(host.querySelector(".phase2-results")?.textContent).not.toContain(
        "Obsolete generated description",
    );
    expect(hubNotifications.list()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                title: "Ask or Explain",
                messages: expect.arrayContaining([
                    expect.stringContaining(
                        "generated description ready · stale",
                    ),
                ]),
            }),
        ]),
    );
});

test("healthy bounded retrieval notices are not failed retrieval, and explicit decisions are labelled", async () => {
    invoke.mockResolvedValueOnce({
        ...result([{ ...conversation, authoritative: true }]),
        warnings: ["Bounded evidence selection"],
    });
    await mounted.show("worker");
    expect(host.querySelector(".phase2-warning")).toBeNull();
    expect(hubNotifications.list()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                title: "Ask or Explain",
                messages: ["Bounded evidence selection"],
            }),
        ]),
    );
    expect(host.querySelector(".phase2-results")!.textContent).toContain(
        "Explicit conversation decision",
    );
});

test("Search/Ask evidence preserves exact indexed locators", async () => {
    const locator = `indexed:0:${"a".repeat(64)}:12000-13000`;
    invoke.mockImplementation(async (method: string) =>
        method === "memoryHubSearch"
            ? result([{ ...source, locator }])
            : { title: "Indexed", content: "Exact excerpt", truncated: false },
    );
    await mounted.show("worker");
    button(source.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "a",
        kind: "source",
        objectId: "source",
        revisionId: "r3",
        locator,
        offset: 0,
    });
});

test("citation cards show generated source navigation without substituting synopsis for exact evidence", async () => {
    invoke.mockImplementation(async (method: string) =>
        method === "memoryHubSearch"
            ? result([
                  {
                      ...source,
                      synopsis: {
                          status: "ready",
                          freshness: "fresh",
                          preview: "<img src=x> Local review only.",
                          generatedVersion: 1,
                          recipe: "source-synopsis-v1",
                          inputHash: "semantic",
                      },
                  },
              ])
            : {
                  title: "Exact source",
                  content: "Original evidence",
                  truncated: false,
              },
    );
    await mounted.show("worker");
    expect(host.querySelector(".phase2-results")!.textContent).toContain(
        "Local review only.",
    );
    expect(
        host
            .querySelector(".phase2-source-summary")
            ?.getAttribute("aria-label"),
    ).toContain("not citation evidence");
    expect(host.querySelector(".phase2-source-passage")?.textContent).toContain(
        "Captured evidence",
    );
    expect(
        host.querySelector(".phase2-source-passage")?.textContent,
    ).not.toContain("Local review only.");
    expect(
        host.querySelector(".phase2-source-header .phase2-source-actions")
            ?.textContent,
    ).toContain("Preview");
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
});

test("mixed evidence is answer-first, safely rendered, and exact citations never guess by excerpt", async () => {
    await mounted.show("worker");
    expect(host.querySelector(".phase2-answer")!.textContent).toContain(
        "From your memory",
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
    button(derivedView.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "b",
        kind: "view",
        objectId: "derivedView",
        revisionId: "view-r4",
        offset: 0,
    });
    button("Open this exact view revision").click();
    expect(onView).toHaveBeenCalledWith("b", "derivedView", "view-r4");
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

test("published derived results disclose their exact revision and drill through to original evidence", async () => {
    const guide: MemoryHubEvidence = {
        id: "view-citation",
        kind: "view",
        corpusId: "a",
        corpusName: "Alpha",
        objectId: "guide",
        revisionId: "published-r2",
        title: "Published troubleshooting guide",
        snippet: "Inspect pressure carefully.",
        score: 0.02,
        rank: 1,
        viewKind: "troubleshootingGuide",
        viewVersion: 2,
        viewProvenance: "merged",
        review: "unreviewed",
        freshness: "current",
        evidenceSources: [
            {
                sourceId: "source",
                revisionId: "source-r1",
                locator: "chars:0-8",
                excerpt: "Pressure",
            },
        ],
    };
    invoke.mockResolvedValueOnce(result([guide]));
    await mounted.show("pressure");
    expect(host.querySelector(".phase2-results")!.textContent).toContain(
        "published-r2",
    );
    expect(host.querySelector(".phase2-results")!.textContent).toContain(
        "merged",
    );
    expect(host.querySelector(".phase2-results")!.textContent).toContain(
        "not independent corroboration",
    );
    button(guide.title).click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "a",
        kind: "view",
        objectId: "guide",
        revisionId: "published-r2",
        offset: 0,
    });
    button("Open this exact view revision").click();
    expect(onView).toHaveBeenCalledWith("a", "guide", "published-r2");
    button("Inspect original evidence source @ source-r1 (chars:0-8)").click();
    await settle();
    expect(invoke).toHaveBeenLastCalledWith("memoryHubEvidence", {
        corpusId: "a",
        kind: "source",
        objectId: "source",
        revisionId: "source-r1",
        locator: "chars:0-8",
        offset: 0,
    });
});

test("submitted filters include corpus, types, tags, inclusive dates and conversation scope", async () => {
    field<HTMLSelectElement>("intent").value = "ask";
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
            intent: "ask",
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
    clickQuery("What changed?");
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
    expect(host.querySelector(".phase2-warning")).toBeNull();
    expect(hubNotifications.list()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                title: "Ask or Explain: partial results",
                messages: [
                    "Conversation dates unavailable",
                    "b · search: offline",
                ],
            }),
        ]),
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
    expect(host.textContent).not.toContain("Only responding providers");
    expect(
        hubNotifications
            .list()
            .flatMap((entry) => entry.messages)
            .join(" "),
    ).toContain("Only responding providers");
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
                queryInput,
                scope: () => scope,
                onOpenSource: onSource,
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
            derivedView,
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
    expect(host.textContent).not.toContain("requires web evidence");
    expect(
        hubNotifications
            .list()
            .flatMap((entry) => entry.messages)
            .join(" "),
    ).toContain("requires web evidence");
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
        queryInput,
        scope: () => scope,
        onOpenSource: onSource,
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

test("related entities use compact mock-aligned sidecards", async () => {
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
        ".phase2-sidecard .phase2-context-entity",
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".phase2-context-item")!.textContent).toBe(
        "Worker",
    );
    expect(cards[0].querySelector("small")!.textContent).toBe(
        "service · confidence 87%",
    );
    expect(cards[1].querySelector("small")!.textContent).toBe("system");
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
    clickQuery("Queue operations");
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
    clickQuery("Worker");
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
        ...result([source, derivedView, conversation]),
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
        ...result([web, derivedView]),
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
        expect(host.querySelector(".phase2-warning")).toBeNull();
        expect(
            hubNotifications
                .list()
                .flatMap((entry) => entry.messages)
                .join(" "),
        ).toContain("Search offline");
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
        ...result([derivedView]),
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
