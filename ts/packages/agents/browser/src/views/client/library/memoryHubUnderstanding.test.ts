// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import type {
    UnderstandingResult,
    UnderstandingModuleResult,
} from "@typeagent/memory-service";
import {
    mountMemoryHubUnderstanding,
    toUnderstandingRequest,
} from "./memoryHubUnderstanding";
import { invokeView, streamUnderstanding } from "./viewClient";

jest.mock("./memoryHubUnderstanding.css", () => ({}));
jest.mock("./viewClient", () => ({
    invokeView: jest.fn(),
    streamUnderstanding: jest.fn(),
}));
const invoke = invokeView as jest.Mock;
const stream = streamUnderstanding as jest.Mock;
function result(snapshotId = "snapshot"): UnderstandingResult {
    return {
        schemaVersion: 1,
        snapshotId,
        turnId: "turn",
        corpusId: "corpus",
        question: "How did the gallery change?",
        expiresAt: "2099-01-01T00:00:00.000Z",
        answer: {
            status: "partial",
            title: "<img src=x onerror=bad()> Gallery",
            summary: {
                text: "The user reported six projects.",
                evidenceIds: ["s0"],
                role: "memory",
            },
            sections: [],
            unknowns: ["Intermediate changes are unknown."],
            followUps: ["Was it verified?"],
        },
        citations: [
            {
                id: "s0",
                kind: "source",
                source: {
                    evidenceId: "source-fragment",
                    corpusId: "corpus",
                    sourceId: "source",
                    revisionId: "r1",
                    title: "Gallery source",
                    snippet: "Six projects.",
                    score: 1,
                    sourceType: "text",
                    indexedAt: "2024-03-15T00:00:00Z",
                },
            },
        ],
        modules: [
            { kind: "sources", status: "ready" },
            { kind: "timeline", status: "planned" },
        ],
        warnings: [],
    };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}
function button(host: HTMLElement, text: string) {
    const value = [...host.querySelectorAll("button")].find(
        (item) => item.textContent === text,
    );
    if (!value) throw new Error(`Missing button: ${text}`);
    return value;
}
let host: HTMLElement;
let mounted: ReturnType<typeof mountMemoryHubUnderstanding>;
let scope: string | undefined;
let onError: jest.Mock;
let onEvidence: jest.Mock;
beforeAll(() => {
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: randomUUID,
    });
});
beforeEach(() => {
    invoke.mockReset();
    stream.mockReset();
    stream.mockImplementation(async (request, onResult, signal) =>
        onResult(await invoke("memoryHubUnderstand", request, { signal })),
    );
    host = document.createElement("div");
    document.body.append(host);
    scope = "corpus";
    onError = jest.fn();
    onEvidence = jest.fn();
    mounted = mountMemoryHubUnderstanding(host, {
        scope: () => scope,
        onError,
        onEvidence,
        onQueryChanged: jest.fn(),
        onResults: jest.fn(),
        onGraph: jest.fn(),
    });
});
afterEach(() => {
    mounted.dispose();
    host.remove();
});

test("explanation-first layout keeps uncertainty in the reading flow and source excerpts disclosed on demand", async () => {
    const value = result();
    value.answer!.summary.text = "**Six projects**, not a verified deployment.";
    invoke.mockResolvedValue(value);
    await mounted.show({ corpusId: "corpus", question: value.question });
    const reading = host.querySelector(".understanding-reading")!;
    expect(reading.querySelector(".understanding-badge")?.textContent).toBe(
        "Partial explanation",
    );
    expect(reading.querySelector("strong")?.textContent).toBe("Six projects");
    expect(
        reading.querySelector(".understanding-unknowns")?.textContent,
    ).toContain("Intermediate changes are unknown.");
    expect(host.querySelector(".understanding-scope")?.textContent).toContain(
        "1 returned source passage",
    );
    const details = host.querySelector<HTMLDetailsElement>(
        ".understanding-source details",
    )!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Exact retained revision · r1");
    expect(details.textContent).toContain("Six projects.");
    button(host, "Gallery source").click();
    expect(onEvidence.mock.calls[0][0]).toMatchObject({
        revisionId: "r1",
        sourceId: "source",
    });
});

test("ready prose and exact source cards do not wait for timeline; late modules preserve composer, prose and focus", async () => {
    const module = deferred<UnderstandingModuleResult>();
    invoke.mockImplementation((method) =>
        method === "memoryHubUnderstand"
            ? Promise.resolve(result())
            : module.promise,
    );
    await mounted.show({ corpusId: "corpus", question: result().question });
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("The user reported six projects.");
    expect(host.textContent).toContain("Gallery source");
    const prose = host.querySelector("article");
    const draft = host.querySelector("textarea")!;
    expect(
        host.querySelector(".understanding-follow")?.nextElementSibling,
    ).toBe(host.querySelector(".understanding-modules"));
    draft.value = "Was the change verified?";
    draft.focus();
    module.resolve({
        schemaVersion: 1,
        corpusId: "corpus",
        snapshotId: "snapshot",
        kind: "timeline",
        status: "ready",
        citations: [],
        timeline: [
            {
                id: "date",
                evidenceId: "s0",
                date: "2024-03-15",
                kind: "sourceSession",
                precision: "day",
                label: "Session context",
            },
        ],
    });

    await settle();
    expect(host.querySelector("article")).toBe(prose);
    expect(draft.value).toBe("Was the change verified?");
    expect(document.activeElement).toBe(draft);
    expect(host.textContent).toContain("2024-03-15");
    expect(invoke).toHaveBeenCalledTimes(2);
    button(host, "Gallery source").click();
    expect(onEvidence.mock.calls[0][0]).toMatchObject({
        revisionId: "r1",
        sourceId: "source",
    });
    expect(onEvidence.mock.calls[0][0]).not.toHaveProperty("locator");
    expect(onEvidence.mock.calls[0][1]).toBe(button(host, "Gallery source"));
});

test("sources and provisional prose render before stream completion without losing the follow-on draft", async () => {
    const finished = deferred<void>();
    let publish!: (value: UnderstandingResult) => void;
    stream.mockImplementation(async (_request, onResult) => {
        publish = onResult;
        await finished.promise;
    });
    const showing = mounted.show({
        corpusId: "corpus",
        question: result().question,
    });
    const sources = result("sources");
    sources.answer = undefined;
    sources.modules = [{ kind: "sources", status: "ready" }];
    publish(sources);
    expect(host.textContent).toContain("Gallery source");
    expect(host.textContent).toContain("Preparing the explanation");
    const initial = result("initial");
    initial.modules = sources.modules;
    initial.refinementPending = true;
    publish(initial);
    expect(host.textContent).toContain("Checking additional evidence");
    const draft = host.querySelector("textarea")!;
    draft.value = "How was it verified?";
    draft.focus();
    const final = result("final");
    final.modules = sources.modules;
    publish(final);
    expect(draft.value).toBe("How was it verified?");
    expect(document.activeElement).toBe(draft);
    expect(button(host, "Ask more").disabled).toBe(true);
    finished.resolve();
    await showing;
    expect(button(host, "Ask more").disabled).toBe(false);
});
test("same-snapshot stream updates reuse a module slot and refresh aborts only its prior request", async () => {
    const finished = deferred<void>();
    let publish!: (value: UnderstandingResult) => void;
    stream.mockImplementation(async (_request, onResult) => {
        publish = onResult;
        await finished.promise;
    });
    const pending = deferred<UnderstandingModuleResult>();
    invoke.mockReturnValue(pending.promise);
    const showing = mounted.show({ corpusId: "corpus", question: "Explain" });
    publish(result());
    const slot = button(host, "Refresh module").closest("section");
    expect(slot).not.toBeNull();
    const first = invoke.mock.calls[0];
    expect(first[1].requestId).toMatch(/^[a-f0-9-]{36}$/);
    publish(result());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(button(host, "Refresh module").closest("section")).toBe(slot);
    button(host, "Refresh module").click();
    expect(first[2].signal.aborted).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].requestId).not.toBe(first[1].requestId);
    mounted.scopeChanged();
    expect(invoke.mock.calls[1][2].signal.aborted).toBe(true);
    finished.resolve();
    await showing;
});

test("failed refinement clears provisional claims and retries without a stale prepared handle", async () => {
    const initial = result("initial");
    initial.modules = [];
    stream.mockImplementationOnce(async (_request, publish) => {
        publish(initial);
        throw new Error("Prepared evidence changed or was forgotten");
    });
    await mounted.show({
        corpusId: "corpus",
        question: initial.question,
        evidenceSnapshotId: "stale",
    });
    expect(host.querySelector("article")?.textContent).toBe("");
    expect(host.textContent).not.toContain("Gallery source");
    expect(host.textContent).toContain("forgotten");
    stream.mockImplementationOnce(async (_request, publish) =>
        publish(initial),
    );
    button(host, "Retry question").click();
    await settle();
    expect(stream.mock.calls[1][0]).not.toHaveProperty("evidenceSnapshotId");
    expect(host.textContent).toContain("The user reported six projects.");
});

test("year-precision dates never display an invented January 1 event", async () => {
    invoke.mockImplementation((method) =>
        Promise.resolve(
            method === "memoryHubUnderstand"
                ? result()
                : {
                      schemaVersion: 1,
                      corpusId: "corpus",
                      snapshotId: "snapshot",
                      kind: "timeline",
                      status: "ready",
                      citations: [],
                      timeline: [
                          {
                              id: "d0",
                              evidenceId: "s0",
                              date: "2024-01-01T00:00:00Z",
                              precision: "year",
                              kind: "event",
                              label: "Reported during 2024",
                          },
                      ],
                  },
        ),
    );
    await mounted.show({ corpusId: "corpus", question: result().question });
    await settle();
    expect(
        host.querySelector(".understanding-timeline strong")?.textContent,
    ).toBe("2024");
    expect(
        host.querySelector(".understanding-timeline")?.textContent,
    ).not.toContain("2024-01-01");
});

test("supported entity context is rendered in the side rail, not as invented prose", async () => {
    const value = result();
    value.modules = [
        { kind: "sources", status: "ready" },
        { kind: "concepts", status: "planned" },
    ];
    invoke.mockImplementation((method) =>
        Promise.resolve(
            method === "memoryHubUnderstand"
                ? value
                : {
                      schemaVersion: 1,
                      corpusId: "corpus",
                      snapshotId: value.snapshotId,
                      kind: "concepts",
                      status: "ready",
                      citations: [],
                      concepts: [
                          {
                              id: "e0",
                              nodeId: "Bootstrap",
                              label: "Bootstrap",
                              generation: "g1",
                          },
                      ],
                  },
        ),
    );
    await mounted.show({ corpusId: "corpus", question: value.question });
    await settle();
    expect(host.querySelector("aside")?.textContent).toContain("Bootstrap");
    expect(host.querySelector("aside")?.textContent).toContain(
        "Existing graph entity",
    );
    expect(host.querySelector("article")?.textContent).not.toContain(
        "Bootstrap",
    );
});

test("module failure is local and retry does not regenerate prose", async () => {
    invoke
        .mockResolvedValueOnce(result())
        .mockRejectedValueOnce(new Error("timeline failed"))
        .mockResolvedValueOnce({
            schemaVersion: 1,
            corpusId: "corpus",
            snapshotId: "snapshot",
            kind: "timeline",
            status: "unavailable",
            reason: "No supported dates",
            citations: [],
        });
    await mounted.show({ corpusId: "corpus", question: result().question });
    await settle();
    expect(host.textContent).toContain("timeline failed");
    expect(host.textContent).toContain("Gallery source");
    button(host, "Retry module").click();
    await settle();
    expect(
        invoke.mock.calls.filter(
            ([method]) => method === "memoryHubUnderstand",
        ),
    ).toHaveLength(1);
    expect(host.textContent).toContain("No supported dates");
});
test("follow-on uses exact scoped parent and preserves a newly typed draft while awaiting it", async () => {
    const follow = deferred<UnderstandingResult>();
    const first = result();
    first.modules = [];
    invoke
        .mockResolvedValueOnce(first)
        .mockImplementationOnce(() => follow.promise);
    await mounted.show({ corpusId: "corpus", question: first.question });
    const draft = host.querySelector("textarea")!;
    draft.value = "Was it fixed?";
    draft
        .closest("form")!
        .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
        );
    expect(invoke.mock.calls[1][0]).toBe("memoryHubUnderstand");
    expect(invoke.mock.calls[1][1]).toMatchObject({
        parentSnapshotId: "snapshot",
        parentTurnId: "turn",
        corpusId: "corpus",
        question: "Was it fixed?",
    });
    draft.value = "A new draft";
    follow.resolve({
        ...first,
        snapshotId: "next",
        turnId: "next-turn",
        question: "Was it fixed?",
    });
    await settle();
    expect(draft.value).toBe("A new draft");
});
test("scope change aborts transport and rejects stale arrivals", async () => {
    const pending = deferred<UnderstandingResult>();
    invoke.mockImplementationOnce(() => pending.promise);
    const show = mounted.show({
        corpusId: "corpus",
        question: result().question,
    });
    const signal = invoke.mock.calls[0][2].signal as AbortSignal;
    scope = "another";
    mounted.scopeChanged();
    expect(signal.aborted).toBe(true);
    pending.resolve(result());
    await show;
    expect(host.textContent).not.toContain("The user reported six projects.");
    expect(onError).not.toHaveBeenCalled();
});
test.each([
    { query: "question" },
    { query: "question", corpusId: "corpus", tags: ["tag"] },
    {
        query: "question",
        corpusId: "corpus",
        conversationScope: "all" as const,
    },
    { query: "question", corpusId: "corpus", dateFrom: "2024-01-01" },
    { query: "question", corpusId: "corpus", sourceTypes: ["text" as const] },
])("never silently drops unsupported scope/filter %j", (request) => {
    expect(() => toUnderstandingRequest(request)).toThrow(
        "filters have not been removed",
    );
});
test("preserves checkpoint and retrieval policy on supported requests", () => {
    expect(
        toUnderstandingRequest({
            query: "question",
            corpusId: "corpus",
            conversationScope: "none",
            knowledgeCheckpointId: "checkpoint",
            retrievalPolicy: "sourcesOnly",
        }),
    ).toEqual({
        question: "question",
        corpusId: "corpus",
        knowledgeCheckpointId: "checkpoint",
        retrievalPolicy: "sourcesOnly",
    });
});
