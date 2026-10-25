// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    openai,
    RequestBudget,
    runWithRequestBudget,
    type ChatModel,
} from "@typeagent/aiclient";
import { runWithSearchTiming } from "@typeagent/knowpro";
import { captureTopicBuild } from "../src/topicCapture.js";
import {
    createConfiguredTopicGenerator,
    createTopicSnapshot,
} from "../src/topicGeneration.js";
import { indexedTopicOccurrence } from "../src/topicIncidence.js";
import type { TopicOccurrence, TopicSnapshot } from "../src/topicTypes.js";
import type { CorpusIndex } from "../src/types.js";
import type { ViewBuildSnapshot } from "../src/viewTypes.js";

function occurrence(
    sourceId: string,
    label = sourceId,
    blockOrdinal = 0,
    revisionId = "r1",
) {
    return indexedTopicOccurrence(
        {
            sourceId,
            revisionId,
            blockOrdinal,
            text: `Original notes for ${label}; rollout remains blocked.`,
            score: 1,
        },
        label,
        0,
    );
}

function input(count = 7): ViewBuildSnapshot {
    const occurrences = Array.from({ length: count }, (_, index) =>
        occurrence(`source-${index}`),
    );
    return {
        corpusId: "test",
        actor: "offline",
        definition: {
            viewId: "topics",
            kind: "wiki",
            selector: { kind: "sources", sources: [] },
        },
        expectedVersion: 0,
        bounds: {},
        inputs: [],
        influenceSources: occurrences.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
        })),
        pipeline: "topics-v1",
        model: "offline",
        fingerprint: "test",
        topicInput: { occurrences },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
}

function promptText(
    messages: Parameters<ChatModel["complete"]>[0],
    index: number,
) {
    return typeof messages === "string"
        ? messages
        : String(messages[index].content);
}

test("large raw organization visits every topic without inventing same-label parent links", async () => {
    const value = input(205);
    value.topicInput!.occurrences = value.topicInput!.occurrences.map((entry) =>
        occurrence(entry.sourceId, "Resource"),
    );
    const batches: string[][] = [];
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages) => {
            const instructions = promptText(messages, 0);
            if (instructions.includes("Organize supplied topics")) {
                const payload = JSON.parse(promptText(messages, 1)) as Array<{
                    id: string;
                }>;
                batches.push(payload.map((node) => node.id));
                return {
                    success: true,
                    data: JSON.stringify({ parents: [], related: [] }),
                };
            }
            return {
                success: true,
                data: JSON.stringify(
                    instructions.includes("Check the ACTUAL")
                        ? { safe: true, failures: [] }
                        : {
                              summary: "Rollout remains blocked.",
                              evidenceIds: [0],
                          },
                ),
            };
        },
    };
    const snapshot = await createConfiguredTopicGenerator(undefined, model)(
        value,
        new AbortController().signal,
    );
    expect(batches.map((batch) => batch.length)).toEqual([200, 5]);
    expect(new Set(batches.flat()).size).toBe(205);
    expect(snapshot.nodes).toHaveLength(205);
    expect(snapshot.parents).toEqual([]);
});

function blockedModel() {
    type Response = Awaited<ReturnType<ChatModel["complete"]>>;
    const calls: Array<{
        kind: "summary" | "editorial" | "organization";
        payload: unknown;
        instructions: string;
        signal: AbortSignal | undefined;
        finish: (response?: Response) => void;
    }> = [];
    let active = 0;
    let peak = 0;
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages, _options, _unused, _unused2, signal) => {
            const gate = deferred<Response>();
            const instructions = promptText(messages, 0);
            const payload: unknown = JSON.parse(promptText(messages, 1));
            const kind = instructions.includes("Check the ACTUAL")
                ? "editorial"
                : instructions.includes("Organize supplied topics")
                  ? "organization"
                  : "summary";
            active++;
            peak = Math.max(peak, active);
            calls.push({
                kind,
                payload,
                instructions,
                signal,
                finish: (response) =>
                    gate.resolve(
                        response ?? {
                            success: true,
                            data: JSON.stringify(
                                kind === "summary"
                                    ? {
                                          summary:
                                              `Grounded ${JSON.stringify(payload)}`.slice(
                                                  0,
                                                  1500,
                                              ),
                                          evidenceIds: [0],
                                      }
                                    : kind === "editorial"
                                      ? { safe: true, failures: [] }
                                      : { parents: [], related: [] },
                            ),
                        },
                    ),
            });
            try {
                return await gate.promise;
            } finally {
                active--;
            }
        },
    };
    return { model, calls, peak: () => peak, active: () => active };
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

test("three worker slots bound overlapping summary/editorial calls and retain ordered identities and incidence", async () => {
    const captured = input();
    const fake = blockedModel();
    const pending = createConfiguredTopicGenerator(undefined, fake.model)(
        captured,
        new AbortController().signal,
    );
    expect(fake.calls.map((call) => call.kind)).toEqual([
        "summary",
        "summary",
        "summary",
    ]);
    fake.calls[1].finish();
    await flush();
    expect(fake.calls[3].kind).toBe("editorial");
    expect(fake.active()).toBe(3);
    fake.calls[2].finish();
    await flush();
    expect(fake.calls[4].kind).toBe("editorial");
    fake.calls[3].finish();
    await flush();
    expect(fake.calls[5].kind).toBe("summary");
    expect(fake.calls.filter((call) => call.kind === "organization")).toEqual(
        [],
    );
    let cursor = 0;
    while (!fake.calls.some((call) => call.kind === "organization")) {
        for (; cursor < fake.calls.length; cursor++)
            fake.calls[cursor].finish();
        await flush();
    }
    expect(fake.calls.filter((call) => call.kind === "summary")).toHaveLength(
        7,
    );
    expect(fake.calls.filter((call) => call.kind === "editorial")).toHaveLength(
        7,
    );
    const organization = fake.calls.at(-1)!;
    expect(organization.kind).toBe("organization");
    const expected = createTopicSnapshot(captured, "offline");
    expect(organization.payload).toEqual(
        expected.nodes.map(({ id, label, scope }) => ({ id, label, scope })),
    );
    organization.finish();
    const snapshot = await pending;
    expect(snapshot.nodes.map((node) => node.id)).toEqual(
        expected.nodes.map((node) => node.id),
    );
    expect(snapshot.nodes.every((node) => node.summaryState === "ready")).toBe(
        true,
    );
    expect(snapshot.occurrences).toEqual(captured.topicInput!.occurrences);
    expect(snapshot.influenceSources).toEqual(captured.influenceSources);
    expect(fake.peak()).toBe(3);
    expect(fake.active()).toBe(0);
    expect(captured.topicInput!.reusableSummaries).toBeUndefined();
    const summaryPrompt = fake.calls.find((call) => call.kind === "summary")!;
    const editorialPrompt = fake.calls.find(
        (call) => call.kind === "editorial",
    )!;
    expect(summaryPrompt.instructions).toContain("1600 characters");
    expect(editorialPrompt.instructions).toContain("no rationale");
    expect(fake.calls.some((call) => call.instructions.includes("4000"))).toBe(
        false,
    );
});

test.each(["abort", "provider", "evidence", "editorial-provider"] as const)(
    "%s stops admission and drains signal-ignoring active calls before rejecting",
    async (mode) => {
        const controller = new AbortController();
        const fake = blockedModel();
        let settled = false;
        const pending = createConfiguredTopicGenerator(undefined, fake.model)(
            input(),
            controller.signal,
        );
        const outcome = pending.then(
            () => {
                settled = true;
                return undefined;
            },
            (error: unknown) => {
                settled = true;
                return error;
            },
        );
        expect(fake.calls).toHaveLength(3);
        if (mode === "abort") {
            controller.abort(new Error("cancelled"));
            fake.calls[0].finish();
        } else if (mode === "editorial-provider") {
            fake.calls[0].finish();
            await flush();
            expect(fake.calls[3].kind).toBe("editorial");
            fake.calls[3].finish({
                success: false,
                message: "provider unavailable",
            });
        } else {
            fake.calls[0].finish(
                mode === "provider"
                    ? { success: false, message: "provider unavailable" }
                    : {
                          success: true,
                          data: JSON.stringify({
                              summary: "Unsupported citation.",
                              evidenceIds: [99],
                          }),
                      },
            );
        }
        await flush();
        expect(settled).toBe(false);
        expect(fake.active()).toBe(2);
        fake.calls[1].finish();
        await flush();
        expect(settled).toBe(false);
        fake.calls[2].finish();
        const error = await outcome;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
            mode === "abort"
                ? /cancelled/
                : mode === "evidence"
                  ? /unsupplied evidence/
                  : /provider unavailable/,
        );
        expect(fake.calls).toHaveLength(mode === "editorial-provider" ? 4 : 3);
        expect(fake.active()).toBe(0);
        expect(
            fake.calls.every((call) => call.signal === controller.signal),
        ).toBe(true);
    },
);

async function capture(
    occurrences: TopicOccurrence[],
    current?: TopicSnapshot,
    overrides: { model?: string; corpusId?: string; suppressed?: string } = {},
) {
    return captureTopicBuild({
        corpusId: overrides.corpusId ?? "test",
        actor: "offline",
        index: {
            getTopicOccurrences: async () => structuredClone(occurrences),
        } as unknown as CorpusIndex,
        sources: [
            ...new Map(
                occurrences.map(({ sourceId, revisionId }) => [
                    sourceId,
                    { sourceId, revisionId },
                ]),
            ).values(),
        ],
        suppressions: overrides.suppressed
            ? [
                  {
                      kind: "topic",
                      sourceId: "source",
                      name: overrides.suppressed,
                  },
              ]
            : [],
        model: overrides.model ?? "offline",
        ...(current ? { current } : {}),
    });
}

test("reuse requires exact owned evidence AND complete same-source revision context", async () => {
    const occurrences = [
        occurrence("source", "primary", 0),
        occurrence("source", "qualification", 1),
        occurrence("unrelated"),
    ];
    let summaryCalls = 0;
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages) => {
            const prompt = promptText(messages, 0);
            const response = prompt.includes("Check the ACTUAL")
                ? { safe: true, failures: [] }
                : prompt.includes("Organize supplied topics")
                  ? { parents: [], related: [] }
                  : (summaryCalls++,
                    {
                        summary: "Original evidence remains qualified.",
                        evidenceIds: [0],
                    });
            return { success: true, data: JSON.stringify(response) };
        },
    };
    const generate = createConfiguredTopicGenerator(undefined, model);
    const current = await generate(
        await capture(occurrences),
        new AbortController().signal,
    );
    expect(summaryCalls).toBe(3);
    const unchanged = await capture(occurrences, current);
    expect(unchanged.topicInput!.reusableSummaries).toHaveLength(3);
    const reused = await generate(unchanged, new AbortController().signal);
    expect(summaryCalls).toBe(3);
    expect(reused.nodes).toEqual(current.nodes);
    const changed = structuredClone(occurrences);
    changed[1] = occurrence("source", "qualification", 1);
    const citation = changed[1].citations[0];
    // Keep valid original coordinates while changing evidence without a revision bump.
    citation.excerpt = citation.excerpt.replace("blocked", "pending");
    const captured = await capture(changed, current);
    expect(
        captured.topicInput!.reusableSummaries!.map((node) => node.id),
    ).toEqual([current.nodes[2].id]);
    await generate(captured, new AbortController().signal);
    expect(summaryCalls).toBe(5);
    const suppressed = await capture(occurrences, current, {
        suppressed: "qualification",
    });
    expect(
        suppressed.topicInput!.reusableSummaries!.map((node) => node.id),
    ).toEqual([current.nodes[2].id]);
    for (const overrides of [{ model: "other" }, { corpusId: "other" }])
        expect(
            (await capture(occurrences, current, overrides)).topicInput!
                .reusableSummaries,
        ).toEqual([]);
    const revised = occurrences.map((entry) =>
        occurrence(
            entry.sourceId,
            entry.label,
            entry.label === "qualification" ? 1 : 0,
            entry.sourceId === "source" ? "r2" : "r1",
        ),
    );
    const revisedInput = await capture(revised, current);
    expect(
        revisedInput.topicInput!.reusableSummaries!.map((node) => node.id),
    ).toEqual([current.nodes[2].id]);
    await generate(revisedInput, new AbortController().signal);
    expect(summaryCalls).toBe(7);
});

test("concurrent timing retains input ordinals and enabled/disabled equivalence", async () => {
    const captured = input(4);
    const { id, citations, limits } = createTopicSnapshot(captured, "offline")
        .nodes[0];
    captured.topicInput!.reusableSummaries = [
        { id, citations, limits, summary: "Rollout remains blocked." },
    ];
    const originalFlag = process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
    const logs: string[] = [];
    const spy = import.meta.jest
        .spyOn(console, "warn")
        .mockImplementation((line: unknown) => logs.push(String(line)));
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages) => ({
            success: true,
            data: JSON.stringify(
                promptText(messages, 0).includes("Check the ACTUAL")
                    ? { safe: true, failures: [] }
                    : promptText(messages, 0).includes(
                            "Organize supplied topics",
                        )
                      ? { parents: [], related: [] }
                      : {
                            summary: "Rollout remains blocked.",
                            evidenceIds: [0],
                        },
            ),
        }),
    };
    const generate = createConfiguredTopicGenerator(undefined, model);
    try {
        delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        const disabled = await generate(captured, new AbortController().signal);
        expect(logs).toEqual([]);
        process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = "1";
        const enabled = await runWithSearchTiming(
            "topic-concurrent",
            "memory.build.topics-v1",
            () => generate(captured, new AbortController().signal),
            { corpusId: captured.corpusId },
        );
        expect(enabled.nodes).toEqual(disabled.nodes);
        const entries = logs.map((line) =>
            JSON.parse(line.replace("[memory-search-timing] ", "")),
        );
        for (const stage of ["topic.summary.model", "topic.editorial.model"])
            expect(
                entries
                    .filter((entry) => entry.stage === stage)
                    .map((entry) => entry.metadata.ordinal)
                    .sort(),
            ).toEqual([2, 3, 4]);
        expect(logs.join("\n")).not.toContain("Original notes");
        expect(logs.join("\n")).not.toContain("source-0");
    } finally {
        spy.mockRestore();
        if (originalFlag === undefined)
            delete process.env.TYPEAGENT_MEMORY_SEARCH_TRACE;
        else process.env.TYPEAGENT_MEMORY_SEARCH_TRACE = originalFlag;
    }
});

test("production model retries quota 429s in worker slots with one inherited aggregate budget and no wire output caps", async () => {
    const jest = import.meta.jest;
    jest.useFakeTimers({
        doNotFake: ["nextTick", "setImmediate", "performance"],
    });
    const requests: Array<{ messages: Array<{ content: string }> }> = [];
    const attempts = new Map<string, number>();
    const fetch = jest
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_url, options) => {
            const body = JSON.parse(String(options?.body));
            requests.push(body);
            expect(body).not.toHaveProperty("max_tokens");
            expect(body).not.toHaveProperty("max_completion_tokens");
            const instructions: string = body.messages[0].content;
            const payload = JSON.parse(body.messages[1].content);
            const summary = instructions.includes("Write a short grounded");
            if (summary) {
                const count = (attempts.get(payload.label) ?? 0) + 1;
                attempts.set(payload.label, count);
                if (count === 1)
                    return new Response("quota", {
                        status: 429,
                        headers: { "Retry-After": "2" },
                    });
            }
            const content = JSON.stringify(
                summary
                    ? { summary: "Rollout remains blocked.", evidenceIds: [0] }
                    : instructions.includes("Check the ACTUAL")
                      ? { safe: true, failures: [] }
                      : { parents: [], related: [] },
            );
            return new Response(
                JSON.stringify({
                    choices: [{ message: { role: "assistant", content } }],
                    usage: {
                        prompt_tokens: 1,
                        completion_tokens: 1,
                        total_tokens: 2,
                    },
                }),
                { status: 200 },
            );
        });
    const model = openai.createChatModel(
        {
            provider: "openai",
            modelType: openai.ModelType.Chat,
            apiKey: "offline-test-key",
            endpoint: "https://topic-retry.invalid/chat/completions",
            modelName: "gpt-4o",
            requestConstraints: { outputTokens: 1000 },
            maxRetryAttempts: 2,
            retryPauseMs: 1,
            timeout: 0,
        },
        { temperature: 0, response_format: { type: "json_object" } },
    );
    const budget = new RequestBudget({
        inputTokens: 100000,
        outputTokens: 1000,
        safetyTokens: 1,
        chatAttempts: 100,
        reservedTokens: 1000000,
        embeddingAttempts: 1,
        elapsedMs: 60000,
        tokenizer: "offline-test",
        countTokens: () => 100,
    });
    try {
        const pending = runWithRequestBudget(budget, () =>
            createConfiguredTopicGenerator(undefined, model)(
                input(),
                new AbortController().signal,
            ),
        );
        await flush();
        expect(requests).toHaveLength(3);
        await jest.advanceTimersByTimeAsync(2000);
        // Retry-After plus provider jitter is still inside the same three slots.
        expect(requests).toHaveLength(3);
        await jest.advanceTimersByTimeAsync(30000);
        const snapshot = await pending;
        expect(snapshot.nodes).toHaveLength(7);
        expect([...attempts.values()]).toEqual(Array(7).fill(2));
        expect(budget.receipts).toHaveLength(22);
        expect(budget.receipts.map((receipt) => receipt.attempt)).toEqual(
            Array.from({ length: 22 }, (_, index) => index + 1),
        );
        expect(requests).toHaveLength(22);
    } finally {
        fetch.mockRestore();
        jest.useRealTimers();
    }
});
