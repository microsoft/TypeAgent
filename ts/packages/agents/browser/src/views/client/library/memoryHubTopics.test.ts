// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    TopicQueryPage,
    TopicQueryRequest,
} from "@typeagent/memory-service";
import { mountTopicBrowser } from "./memoryHubTopics";
import { invokeView } from "./viewClient";

jest.mock("./viewClient", () => ({ invokeView: jest.fn() }));

function page(): TopicQueryPage {
    return {
        generation: "g1",
        nodes: [
            {
                id: "topic:one",
                identity: "scoped",
                label: "held lease",
                scope: "source",
                aliases: [],
                occurrenceIds: ["occurrence:one"],
                summary: "Command lifetime is not lease lifetime.",
                summaryState: "ready",
                summaryAuthorship: "generated",
                citations: [
                    {
                        sourceId: "original",
                        revisionId: "r2",
                        locator: "indexed:0:hash:0-4",
                        excerpt: "text",
                    },
                ],
                limits: ["Bounded summary evidence"],
                authorship: "generated",
                occurrenceCount: 30,
                citationCount: 12,
                omittedOccurrences: 29,
                omittedCitations: 11,
            },
        ],
        parents: [],
        related: [],
        neighborhoods: [],
        totalNodes: 250,
        matchingNodes: 250,
        omittedNodes: 249,
        omittedParents: 7,
        omittedRelated: 2,
        omittedNeighborhoods: 1,
        nextContinuationToken: "next",
        limits: ["Complete snapshot, bounded display"],
        io: { stateBytes: 50000, snapshotBytes: 25000, elapsedMs: 2 },
    };
}
async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test("concept browsing is lazy, explicit summary opening is scoped, and raw evidence browsing remains available", async () => {
    const raw = page();
    const concept = {
        id: "concept:one",
        label: "Connection lease",
        scope: "Runtime",
        purpose: "Understand resource lifetime",
        summary: "",
        summaryState: "pending" as const,
        memberIds: ["topic:one"],
        memberCount: 1,
        omittedMembers: 0,
        citations: raw.nodes[0]!.citations,
        citationCount: 1,
        omittedCitations: 0,
        salience: 7,
    };
    const query = jest.fn(
        async (request: TopicQueryRequest): Promise<TopicQueryPage> => {
            if (!request.curated) return raw;
            return {
                ...raw,
                nodes: [],
                totalConcepts: 1,
                nextContinuationToken: undefined,
                concepts: [
                    {
                        ...concept,
                        ...(request.summarize
                            ? {
                                  summary:
                                      "Command and lease lifetimes differ.",
                                  summaryState: "ready" as const,
                              }
                            : {}),
                    },
                ],
            };
        },
    );
    const onError = jest.fn();
    const view = mountTopicBrowser(document.body, {
        corpusId: () => "corpus",
        query,
        onError,
        onOpenSource: jest.fn(),
        rebuild: async () => {
            throw new Error("unused");
        },
    });
    const click = (text: string) => {
        const button = [...document.querySelectorAll("button")].find(
            (button) => button.textContent === text,
        );
        if (!button) throw new Error(`Missing button ${text}`);
        button.click();
    };
    try {
        click("Browse topics");
        await settle();
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0]![0].summarize).toBeUndefined();
        expect(document.body.textContent).toContain("Summary not generated");
        expect(document.body.textContent).toContain("revision r2");
        click("Open concept summary");
        await settle();
        expect(query).toHaveBeenLastCalledWith({
            corpusId: "corpus",
            curated: true,
            topicId: "concept:one",
            summarize: true,
            pageSize: 1,
        });
        expect(document.body.textContent).toContain(
            "Command and lease lifetimes differ.",
        );
        click("All topics");
        await settle();
        expect(query).toHaveBeenLastCalledWith({
            corpusId: "corpus",
            curated: false,
            search: "",
            pageSize: 24,
        });
        expect(onError).not.toHaveBeenCalled();
    } finally {
        view.dispose();
    }
});

test("curated concepts preserve raw member drilldown and exact source evidence", async () => {
    const raw = page();
    raw.totalConcepts = 1;
    const concepts: TopicQueryPage = {
        ...raw,
        nodes: [],
        concepts: [
            {
                id: "concept:one",
                label: "Connection lease",
                scope: "Runtime",
                purpose: "Understand resource lifetime",
                summary:
                    "A command and its held lease have different lifetimes.",
                memberIds: ["topic:one"],
                memberCount: 1,
                omittedMembers: 0,
                citations: raw.nodes[0]!.citations,
                citationCount: 1,
                omittedCitations: 0,
                salience: 7,
            },
        ],
        totalConcepts: 1,
    };
    const query = jest.fn(async (request: TopicQueryRequest) =>
        request.curated ? concepts : raw,
    );
    const onOpenSource = jest.fn();
    const view = mountTopicBrowser(document.body, {
        corpusId: () => "corpus",
        query,
        onOpenSource,
        onError: jest.fn(),
        rebuild: async () => {
            throw new Error("unused");
        },
    });
    try {
        [...document.querySelectorAll("button")]
            .find((button) => button.textContent === "Browse topics")!
            .click();
        await settle();
        expect(
            [...document.querySelectorAll("button")].find(
                (button) => button.textContent === "Curated concepts",
            )!.hidden,
        ).toBe(false);
        [...document.querySelectorAll("button")]
            .find((button) => button.textContent === "Curated concepts")!
            .click();
        await settle();
        expect(query).toHaveBeenLastCalledWith({
            corpusId: "corpus",
            curated: true,
            search: "",
            pageSize: 24,
        });
        expect(document.body.textContent).toContain("250 raw topics retained");
        expect(document.body.textContent).toContain("not truth confidence");
        [...document.querySelectorAll("button")]
            .find((button) =>
                button.textContent?.startsWith("Source original"),
            )!
            .click();
        expect(onOpenSource).toHaveBeenCalledWith("corpus", "original");
        [...document.querySelectorAll("button")]
            .find((button) => button.textContent === "Inspect original topic")!
            .click();
        await settle();
        expect(query).toHaveBeenLastCalledWith({
            corpusId: "corpus",
            topicId: "topic:one",
            depth: 0,
            pageSize: 24,
        });
    } finally {
        view.dispose();
    }
});

test("topic browser shows scoped identity, original evidence, generation and omission/IO honesty", async () => {
    const query = jest.fn(async () => page());
    const onOpenSource = jest.fn();
    const onError = jest.fn();
    const view = mountTopicBrowser(document.body, {
        corpusId: () => "corpus",
        query,
        onOpenSource,
        onError,
        rebuild: async () => {
            throw new Error("unused");
        },
    });
    try {
        const root = document.querySelector(
            'section[aria-label="Maintained topics"]',
        )!;
        root.querySelector<HTMLButtonElement>("button")!.click();
        await settle();
        expect(query).toHaveBeenCalledWith({
            corpusId: "corpus",
            curated: true,
            search: "",
            pageSize: 24,
        });
        expect(root.textContent).toContain("250 maintained topics");
        expect(root.textContent).toContain("249 omitted");
        expect(root.textContent).toContain("Generation g1");
        expect(root.textContent).toContain("50000 bytes");
        expect(root.textContent).toContain("30 occurrences");
        expect(root.textContent).toContain("revision r2");
        const source = [...root.querySelectorAll("button")].find((button) =>
            button.textContent?.startsWith("Source original"),
        )!;
        source.click();
        expect(onOpenSource).toHaveBeenCalledWith("corpus", "original");
        const next = [...root.querySelectorAll("button")].find(
            (button) => button.textContent === "Next topic page",
        )!;
        next.click();
        await settle();
        expect(query).toHaveBeenLastCalledWith({
            corpusId: "corpus",
            search: "",
            pageSize: 24,
            continuationToken: "next",
            curated: true,
        });
        expect(onError).not.toHaveBeenCalled();
    } finally {
        view.dispose();
    }
});

test("event-backed topic citations open original events without document-source navigation", async () => {
    const data = page();
    data.nodes[0]!.citations[0] = {
        sourceId: "event-1",
        revisionId: "event-1",
        locator: "indexed:0:hash:0-4",
        excerpt: "text",
        evidence: { kind: "event", eventId: "event-1" },
    };
    (invokeView as jest.Mock).mockResolvedValue({
        title: "Original turn",
        content: '{"authority":"evidence-only"}',
        offset: 0,
        totalChars: 29,
    });
    const onOpenSource = jest.fn();
    const onError = jest.fn();
    const view = mountTopicBrowser(document.body, {
        corpusId: () => "corpus",
        query: async () => data,
        rebuild: async () => {
            throw new Error("unused");
        },
        onOpenSource,
        onError,
    });
    try {
        const root = document.querySelector(
            'section[aria-label="Maintained topics"]',
        )!;
        root.querySelector<HTMLButtonElement>("button")!.click();
        await settle();
        [...root.querySelectorAll("button")]
            .find(
                (button) =>
                    button.textContent === "Event event-1 · original evidence",
            )!
            .click();
        await settle();
        expect(invokeView).toHaveBeenCalledWith("memoryHubGraphEvent", {
            corpusId: "corpus",
            eventId: "event-1",
            offset: 0,
        });
        expect(document.body.textContent).toContain("evidence-only");
        expect(onOpenSource).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        view.hide();
        expect(document.querySelector<HTMLElement>(".hub-flyout")!.hidden).toBe(
            true,
        );
    } finally {
        view.dispose();
    }
});

test("topic browser surfaces stale continuation errors and discards old results after scope refresh", async () => {
    const onError = jest.fn();
    const query = jest.fn(async () => {
        throw new Error("Topic continuation is stale");
    });
    const view = mountTopicBrowser(document.body, {
        corpusId: () => "corpus",
        query,
        onError,
        onOpenSource: jest.fn(),
        rebuild: async () => {
            throw new Error("unused");
        },
    });
    try {
        const root = document.querySelector(
            'section[aria-label="Maintained topics"]',
        )!;
        root.querySelector<HTMLButtonElement>("button")!.click();
        await settle();
        expect(root.textContent).toContain("Topic continuation is stale");
        expect(onError).toHaveBeenCalled();
        view.refresh();
        expect(root.textContent).not.toContain("Topic continuation is stale");
    } finally {
        view.dispose();
    }
});
