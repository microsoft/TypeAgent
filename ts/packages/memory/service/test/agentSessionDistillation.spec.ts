// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    configuredAgentSessionModel,
    distillAgentSessionEpisode,
    distillAgentSessionMemories,
    reconcileAgentMemories,
} from "../src/agentSessionDistillation.js";
import type {
    AgentMemoryArtifact,
    AgentSessionDistillationModel,
    AgentSessionEvent,
    AgentSessionEvidenceInput,
} from "../src/agentSessionTypes.js";

const signal = new AbortController().signal;

function input(
    events: AgentSessionEvent[] = [
        event(
            "failed",
            "tool-result",
            "Build failed: missing Node on PATH.",
            "failure",
        ),
        event(
            "check",
            "verification",
            "All 12 targeted tests passed.",
            "success",
        ),
        event(
            "done",
            "outcome",
            "Completed the requested local fix.",
            "success",
        ),
    ],
): AgentSessionEvidenceInput {
    let text = "Retained episode 🧠\n";
    const spans = events.map((item) => {
        const start = text.length;
        text += item.text;
        const end = text.length;
        text += "\n";
        return { eventId: item.id, start, end };
    });
    return {
        sourceId: "source",
        revisionId: "revision",
        repository: "repo",
        commit: "commit",
        environment: "Windows",
        episode: { episodeId: "episode", events, text, spans },
    };
}

function event(
    id: string,
    kind: AgentSessionEvent["kind"],
    text: string,
    outcome?: AgentSessionEvent["outcome"],
): AgentSessionEvent {
    return {
        schemaVersion: 1,
        id,
        sessionId: "session",
        kind,
        text,
        ...(outcome === undefined ? {} : { outcome }),
    };
}

function memory(overrides: Record<string, unknown> = {}) {
    return {
        kind: "procedure",
        title: "Check local build tools",
        body: "If Node is absent, stop and check PATH before retrying; run targeted tests to verify.",
        state: "diagnostic-only",
        eventIds: ["failed"],
        supersedes: [],
        ...overrides,
    };
}

class OfflineModel implements AgentSessionDistillationModel {
    identity = "controlled-offline-model";
    prompts: string[] = [];
    completions = 0;
    admitted = true;
    constructor(public output: unknown = { memories: [memory()] }) {}
    fits(prompt: string): boolean {
        this.prompts.push(prompt);
        return this.admitted;
    }
    async complete(_prompt: string, received: AbortSignal): Promise<string> {
        expect(received).toBe(signal);
        this.completions++;
        return typeof this.output === "string"
            ? this.output
            : JSON.stringify(this.output);
    }
}

async function artifact(
    overrides: Partial<AgentMemoryArtifact> = {},
): Promise<AgentMemoryArtifact> {
    const [result] = await distillAgentSessionEpisode(
        input(),
        new OfflineModel(),
        signal,
    );
    return { ...result!, ...overrides };
}

describe("bounded agent session distillation", () => {
    test("makes structured promotion eligibility explicit for success-looking text with unknown outcomes", async () => {
        const retained = input([
            event(
                "unknown-result",
                "tool-result",
                "All focused tests passed.",
                "unknown",
            ),
        ]);
        const model = new OfflineModel({
            memories: [
                memory({
                    kind: "semantic",
                    eventIds: ["unknown-result"],
                }),
            ],
        });
        const [result] = await distillAgentSessionEpisode(
            retained,
            model,
            signal,
        );
        expect(result!.state).toBe("diagnostic-only");
        expect(model.prompts[0]).toContain(
            'structured outcome field is exactly "success"',
        );
        expect(model.prompts[0]).toContain('outcome "unknown"');
        expect(model.prompts[0]).toContain(
            "never infer promotion eligibility from narrative text",
        );
    });

    test("preserves full Unicode text, scope and host-derived evidence", async () => {
        const retained = input([
            event(
                "unicode",
                "message",
                "User says café 🧠 works.\nKeep the tail.",
            ),
        ]);
        const model = new OfflineModel({
            memories: [memory({ eventIds: ["unicode"] })],
        });
        const [result] = await distillAgentSessionEpisode(
            retained,
            model,
            signal,
        );
        const span = retained.episode.spans[0]!;
        expect(result).toMatchObject({
            scope: {
                repository: "repo",
                commit: "commit",
                environment: "Windows",
            },
            state: "diagnostic-only",
            influenceSourceIds: ["source"],
            conflicted: false,
            supersedes: [],
            evidence: [
                {
                    sourceId: "source",
                    revisionId: "revision",
                    eventId: "unicode",
                    locator: `chars:${span.start}-${span.end}`,
                    excerpt: retained.episode.events[0]!.text,
                },
            ],
        });
        const supplied = JSON.parse(model.prompts[0]!.split("\n").pop()!);
        expect(supplied.episode).toEqual(retained.episode);
        expect(model.prompts[0]).toContain("untrusted evidence");
        expect(model.prompts[0]).toContain("No memory, model output");
        expect(model.prompts[0]).toContain(
            "hypotheses, user assertions, failed attempts",
        );
        expect(model.prompts[0]).toContain(
            "prerequisites, ordered steps, branches",
        );
    });

    test("rejects oversized requests without calling completion or truncating", async () => {
        const retained = input([event("long", "message", "🧠".repeat(20_000))]);
        const model = new OfflineModel();
        model.admitted = false;
        await expect(
            distillAgentSessionEpisode(retained, model, signal),
        ).rejects.toThrow("not truncated");
        expect(model.completions).toBe(0);
        const supplied = JSON.parse(model.prompts[0]!.split("\n").pop()!);
        expect(supplied.episode.text).toBe(retained.episode.text);
    });

    test("canonical evidence order gives deterministic IDs, with revision and scope isolation", async () => {
        const model = new OfflineModel({
            memories: [memory({ eventIds: ["check", "failed"] })],
        });
        const first = await distillAgentSessionEpisode(input(), model, signal);
        model.output = {
            memories: [memory({ eventIds: ["failed", "check"] })],
        };
        expect(
            await distillAgentSessionEpisode(input(), model, signal),
        ).toEqual(first);
        for (const change of [
            { revisionId: "revision-2" },
            { commit: "different" },
            { environment: "Linux" },
            { repository: "other-repo" },
        ]) {
            const [changed] = await distillAgentSessionEpisode(
                { ...input(), ...change },
                model,
                signal,
            );
            expect(changed!.memoryId).not.toBe(first[0]!.memoryId);
        }
    });

    test.each([
        { eventIds: ["invented"] },
        { eventIds: [] },
        { eventIds: ["failed", "failed"] },
        { eventIds: [1] },
        { eventIds: Array.from({ length: 65 }, (_, n) => `event-${n}`) },
        { supersedes: ["invented-memory"] },
        { kind: "skill" },
        { state: "validated" },
        { title: "" },
        { title: "x".repeat(201) },
        { body: " " },
        { body: "x".repeat(6001) },
        { evidence: [{ locator: "chars:0-10", excerpt: "fabricated" }] },
        { sourceId: "invented-source" },
        { permission: "execute" },
    ])("rejects invalid fields/citations: %j", async (invalid) => {
        await expect(
            distillAgentSessionEpisode(
                input(),
                new OfflineModel({ memories: [memory(invalid)] }),
                signal,
            ),
        ).rejects.toThrow();
    });

    test.each([
        '```json\n{"memories":[]}\n```',
        "{",
        "[]",
        { memories: [], unexpected: true },
        { memories: Array.from({ length: 17 }, () => memory()) },
        { memories: null },
        { memories: [{ ...memory(), supersedes: undefined }] },
        " ".repeat(256_001),
    ])("rejects invalid JSON shape/count/response bounds", async (output) => {
        await expect(
            distillAgentSessionEpisode(
                input(),
                new OfflineModel(output),
                signal,
            ),
        ).rejects.toThrow();
    });

    test("allows empty results and deduplicates identical artifacts", async () => {
        expect(
            await distillAgentSessionEpisode(
                input(),
                new OfflineModel({ memories: [] }),
                signal,
            ),
        ).toEqual([]);
        expect(
            await distillAgentSessionEpisode(
                input(),
                new OfflineModel({ memories: [memory(), memory()] }),
                signal,
            ),
        ).toHaveLength(1);
    });

    test("bounds host-expanded artifact output without truncating cited excerpts", async () => {
        const retained = input([
            event(
                "large",
                "tool-result",
                "Retained observation. ".repeat(7000),
            ),
        ]);
        const model = new OfflineModel({
            memories: Array.from({ length: 16 }, (_, index) =>
                memory({ title: `Memory ${index}`, eventIds: ["large"] }),
            ),
        });
        await expect(
            distillAgentSessionEpisode(retained, model, signal),
        ).rejects.toThrow("bounded stage output");
        const supplied = JSON.parse(model.prompts[0]!.split("\n").pop()!);
        expect(supplied.episode.text).toBe(retained.episode.text);
    });

    test("preserves absent optional scope rather than inventing scope", async () => {
        const retained = input();
        delete retained.repository;
        delete retained.commit;
        delete retained.environment;
        const [result] = await distillAgentSessionEpisode(
            retained,
            new OfflineModel(),
            signal,
        );
        expect(result!.scope).toEqual({});
    });

    test.each(["semantic", "procedure"])(
        "rejects failure-only promotion for %s",
        async (kind) => {
            await expect(
                distillAgentSessionEpisode(
                    input(),
                    new OfflineModel({
                        memories: [memory({ kind, state: "observed" })],
                    }),
                    signal,
                ),
            ).rejects.toThrow("Invalid observed promotion");
        },
    );

    test.each([["check"], ["done"]])(
        "requires BOTH verification and outcome for procedure: %j",
        async (id) => {
            await expect(
                distillAgentSessionEpisode(
                    input(),
                    new OfflineModel({
                        memories: [
                            memory({ state: "observed", eventIds: [id] }),
                        ],
                    }),
                    signal,
                ),
            ).rejects.toThrow("Invalid observed promotion");
        },
    );

    test("allows observed procedures with cited successful checks and outcome", async () => {
        const [result] = await distillAgentSessionEpisode(
            input(),
            new OfflineModel({
                memories: [
                    memory({ state: "observed", eventIds: ["check", "done"] }),
                ],
            }),
            signal,
        );
        expect(result!.state).toBe("observed");
    });

    test("allows an observed fact from explicit successful tool observation", async () => {
        const retained = input([
            event(
                "tool",
                "tool-result",
                "Node reports version 22.3.0.",
                "success",
            ),
        ]);
        const [result] = await distillAgentSessionEpisode(
            retained,
            new OfflineModel({
                memories: [
                    memory({
                        kind: "semantic",
                        state: "observed",
                        eventIds: ["tool"],
                    }),
                ],
            }),
            signal,
        );
        expect(result!.state).toBe("observed");
    });

    test.each([
        event("check", "verification", "success", "success"),
        {
            ...event(
                "check",
                "verification",
                "Tests passed locally.",
                "success",
            ),
            role: "user" as const,
        },
        event("check", "verification", "Targeted tests failed.", "failure"),
    ])(
        "rejects meaningless, asserted or failed verification",
        async (check) => {
            await expect(
                distillAgentSessionEpisode(
                    input([
                        check,
                        event(
                            "done",
                            "outcome",
                            "Requested fix completed.",
                            "success",
                        ),
                    ]),
                    new OfflineModel({
                        memories: [
                            memory({
                                state: "observed",
                                eventIds: ["check", "done"],
                            }),
                        ],
                    }),
                    signal,
                ),
            ).rejects.toThrow("Invalid observed promotion");
        },
    );

    test.each(["offset", "text", "missing", "duplicate", "overlap"])(
        "rejects invalid original evidence spans: %s",
        async (fault) => {
            const retained = input();
            switch (fault) {
                case "offset":
                    retained.episode.spans[0]!.start++;
                    break;
                case "text":
                    retained.episode.events[0]!.text += " altered";
                    break;
                case "missing":
                    retained.episode.spans.pop();
                    break;
                case "duplicate":
                    retained.episode.spans.push(retained.episode.spans[0]!);
                    break;
                case "overlap":
                    retained.episode.spans[1]!.start = 0;
                    break;
            }
            const model = new OfflineModel();
            await expect(
                distillAgentSessionEpisode(retained, model, signal),
            ).rejects.toThrow();
            expect(model.completions).toBe(0);
        },
    );

    test("propagates model errors and cancellation without returning partial results", async () => {
        const model = new OfflineModel();
        model.complete = async () => {
            throw new Error("offline failure");
        };
        await expect(
            distillAgentSessionEpisode(input(), model, signal),
        ).rejects.toThrow("offline failure");
        const controller = new AbortController();
        controller.abort();
        await expect(
            distillAgentSessionEpisode(input(), model, controller.signal),
        ).rejects.toThrow();
        expect(model.prompts).toHaveLength(1);
    });

    test("configured factory does not load configuration until first use", () => {
        const model = configuredAgentSessionModel("unused-offline-endpoint");
        expect(
            typeof Object.getOwnPropertyDescriptor(model, "identity")!.get,
        ).toBe("function");
        expect(model.complete).toBeInstanceOf(Function);
    });

    test("aborts promptly when the model ignores cancellation, consuming late rejection", async () => {
        const controller = new AbortController();
        let started!: () => void;
        const completionStarted = new Promise<void>((resolve) => {
            started = resolve;
        });
        let rejectLate!: (reason: Error) => void;
        const model = new OfflineModel();
        model.complete = () =>
            new Promise<string>((_resolve, reject) => {
                rejectLate = reject;
                started();
            });
        const pending = distillAgentSessionEpisode(
            input(),
            model,
            controller.signal,
        );
        await completionStarted;
        controller.abort(new Error("cancelled while provider ignored signal"));
        await expect(pending).rejects.toThrow("cancelled while provider");
        rejectLate(new Error("late provider rejection"));
        await new Promise<void>((resolve) => setImmediate(resolve));
    });
});

class SynthesisModel extends OfflineModel {
    capacity = Infinity;
    state: AgentMemoryArtifact["state"] = "diagnostic-only";
    kind: AgentMemoryArtifact["kind"] = "procedure";
    references?: string[];
    fits(prompt: string): boolean {
        this.prompts.push(prompt);
        return prompt.length <= this.capacity;
    }
    async complete(prompt: string): Promise<string> {
        this.completions++;
        const supplied = JSON.parse(prompt.split("\n").pop()!) as {
            memories: AgentMemoryArtifact[];
        };
        return JSON.stringify({
            memories: [
                {
                    kind: this.kind,
                    title: "Combined workflow",
                    body: supplied.memories.map((item) => item.body).join("\n"),
                    state: this.state,
                    memoryIds:
                        this.references ??
                        supplied.memories.map((item) => item.memoryId),
                    supersedes: [],
                },
            ],
        });
    }
}

async function steps(count: number): Promise<AgentMemoryArtifact[]> {
    const base = await artifact();
    return Array.from({ length: count }, (_, index) => ({
        ...base,
        memoryId: `step-${index}`,
        title: `Step ${index}`,
        body: `When prerequisite ${index} holds, perform step ${index}; check result and stop on failure.`,
        evidence: [
            {
                ...base.evidence[0]!,
                eventId: `event-${index}`,
                sourceId: `source-${index}`,
                revisionId: `revision-${index}`,
            },
        ],
        influenceSourceIds: [`source-${index}`, `context-${index}`],
    }));
}

describe("bounded hierarchical memory synthesis", () => {
    test("combines different episodes while retaining exact original evidence and all influences", async () => {
        const originals = await steps(2);
        const model = new SynthesisModel();
        const [result] = await distillAgentSessionMemories(
            originals,
            model,
            signal,
        );
        expect(result!.body).toContain("perform step 0");
        expect(result!.body).toContain("perform step 1");
        expect(result!.evidence).toEqual(
            originals.flatMap((item) => item.evidence),
        );
        expect(result!.influenceSourceIds).toEqual([
            "context-0",
            "context-1",
            "source-0",
            "source-1",
        ]);
        expect(result!.supersedes).toEqual([]);
        expect(result!.state).toBe("diagnostic-only");
        expect(model.completions).toBe(1);
        expect(model.prompts[0]).toContain(
            "Summaries are NEVER original evidence",
        );
        const rerun = await distillAgentSessionMemories(
            [...originals].reverse(),
            new SynthesisModel(),
            signal,
        );
        expect(rerun[0]!.evidence).toEqual(result!.evidence);
        const same = await distillAgentSessionMemories(
            originals,
            new SynthesisModel(),
            signal,
        );
        expect(same).toEqual([result]);
    });

    test("recursively reduces more than one bounded group to <=16 roots per scope", async () => {
        const originals = await steps(33);
        const model = new SynthesisModel();
        const result = await distillAgentSessionMemories(
            originals,
            model,
            signal,
        );
        expect(result).toHaveLength(1);
        expect(model.completions).toBe(4);
        expect(
            new Set(result[0]!.evidence.map((item) => item.sourceId)).size,
        ).toBe(33);
        expect(result[0]!.body).toContain("perform step 32");
        for (const prompt of model.prompts) {
            const supplied = JSON.parse(prompt.split("\n").pop()!);
            expect(supplied.memories.length).toBeLessThanOrEqual(16);
        }
    });

    test("advertises and enforces a reducing output limit while retaining all original evidence", async () => {
        const originals = await steps(33);
        const model = new SynthesisModel();
        model.complete = async (prompt) => {
            model.completions++;
            const supplied = JSON.parse(prompt.split("\n").pop()!) as {
                outputMemoryLimit: number;
                memories: AgentMemoryArtifact[];
            };
            expect(supplied.outputMemoryLimit).toBe(
                Math.max(1, Math.floor(supplied.memories.length / 2)),
            );
            const groups: AgentMemoryArtifact[][] = Array.from(
                { length: supplied.outputMemoryLimit },
                () => [],
            );
            supplied.memories.forEach((item, index) =>
                groups[index % groups.length]!.push(item),
            );
            return JSON.stringify({
                memories: groups.map((items) => ({
                    kind: "procedure",
                    title: "Combined steps",
                    body: items.map((item) => item.body).join("\n"),
                    state: "diagnostic-only",
                    memoryIds: items.map((item) => item.memoryId),
                    supersedes: [],
                })),
            });
        };
        const result = await distillAgentSessionMemories(
            originals,
            model,
            signal,
        );
        expect(result.length).toBeLessThanOrEqual(16);
        expect(model.completions).toBe(6);
        expect(
            new Set(
                result.flatMap((item) =>
                    item.evidence.map((entry) => entry.sourceId),
                ),
            ).size,
        ).toBe(33);
    });

    test("returns no synthesis for empty, singleton or per-scope singleton inputs", async () => {
        const originals = await steps(2);
        originals[1]!.scope = { repository: "other" };
        for (const values of [[], originals.slice(0, 1), originals]) {
            const model = new SynthesisModel();
            expect(
                await distillAgentSessionMemories(values, model, signal),
            ).toEqual([]);
            expect(model.prompts).toHaveLength(0);
            expect(model.completions).toBe(0);
        }
    });

    test("never mixes exact repository, commit or environment scope partitions", async () => {
        const originals = await steps(4);
        originals[2]!.scope = {
            ...originals[0]!.scope,
            commit: "second",
        };
        originals[3]!.scope = { ...originals[2]!.scope };
        const model = new SynthesisModel();
        const result = await distillAgentSessionMemories(
            originals,
            model,
            signal,
        );
        expect(result).toHaveLength(2);
        expect(model.completions).toBe(2);
        expect(result.map((item) => item.evidence.length)).toEqual([2, 2]);
        for (const prompt of model.prompts) {
            const supplied = JSON.parse(prompt.split("\n").pop()!);
            expect(
                supplied.memories.every(
                    (item: AgentMemoryArtifact) =>
                        JSON.stringify(item.scope) ===
                        JSON.stringify(supplied.scope),
                ),
            ).toBe(true);
        }
    });

    test("many singleton scopes remain a zero-call no-op", async () => {
        const originals = (await steps(65)).map((item, index) => ({
            ...item,
            scope: { repository: `scope-${index}` },
        }));
        const model = new SynthesisModel();
        expect(
            await distillAgentSessionMemories(originals, model, signal),
        ).toEqual([]);
        expect(model.completions).toBe(0);
        expect(model.prompts).toHaveLength(0);
    });

    test.each(["unknown-field", "supersedes", "missing-reference"])(
        "rejects model invented synthesis metadata: %s",
        async (fault) => {
            const originals = await steps(2);
            const model = new SynthesisModel();
            model.complete = async () => {
                const entry: Record<string, unknown> = {
                    kind: "procedure",
                    title: "Combined",
                    body: "Conditional checks.",
                    state: "diagnostic-only",
                    memoryIds: [originals[0]!.memoryId],
                    supersedes: [],
                };
                if (fault === "unknown-field")
                    entry.evidence = [{ excerpt: "fabricated" }];
                if (fault === "supersedes")
                    entry.supersedes = [originals[0]!.memoryId];
                if (fault === "missing-reference") entry.memoryIds = [];
                return JSON.stringify({ memories: [entry] });
            };
            await expect(
                distillAgentSessionMemories(originals, model, signal),
            ).rejects.toThrow();
        },
    );

    test("rejects failure-only promotion and fabricated original-memory references", async () => {
        const originals = await steps(2);
        const observed = new SynthesisModel();
        observed.state = "observed";
        await expect(
            distillAgentSessionMemories(originals, observed, signal),
        ).rejects.toThrow("Invalid observed promotion");
        const invented = new SynthesisModel();
        invented.references = ["fabricated-memory"];
        await expect(
            distillAgentSessionMemories(originals, invented, signal),
        ).rejects.toThrow("fabricated");
    });

    test("preserves conflict status and cannot turn observed semantic facts into observed procedures", async () => {
        const originals = (await steps(2)).map((item) => ({
            ...item,
            state: "observed" as const,
            kind: "semantic" as const,
        }));
        const model = new SynthesisModel();
        model.state = "observed";
        await expect(
            distillAgentSessionMemories(originals, model, signal),
        ).rejects.toThrow("Invalid observed promotion");
        originals[0]!.conflicted = true;
        const [diagnostic] = await distillAgentSessionMemories(
            originals,
            new SynthesisModel(),
            signal,
        );
        expect(diagnostic!.conflicted).toBe(true);
        expect(diagnostic!.state).toBe("diagnostic-only");
    });

    test("rejects over-budget original artifacts without truncating or completing", async () => {
        const originals = await steps(2);
        const model = new SynthesisModel();
        model.capacity = 10;
        await expect(
            distillAgentSessionMemories(originals, model, signal),
        ).rejects.toThrow("not truncated");
        expect(model.completions).toBe(0);
        expect(model.prompts[0]).toContain(originals[0]!.evidence[0]!.excerpt);
    });

    test("caps total inputs and groups explicitly with zero model calls", async () => {
        const tooMany = await steps(513);
        const model = new SynthesisModel();
        await expect(
            distillAgentSessionMemories(tooMany, model, signal),
        ).rejects.toThrow("bounded input");
        const scopes = (await steps(130)).map((item, index) => ({
            ...item,
            scope: { repository: `scope-${Math.floor(index / 2)}` },
        }));
        await expect(
            distillAgentSessionMemories(scopes, model, signal),
        ).rejects.toThrow("bounded group");
        expect(model.completions).toBe(0);
    });

    test("fails explicit non-reduction rather than dropping a prefix or looping", async () => {
        const originals = await steps(17);
        const model = new SynthesisModel();
        model.complete = async (prompt) => {
            const supplied = JSON.parse(prompt.split("\n").pop()!) as {
                memories: AgentMemoryArtifact[];
            };
            return JSON.stringify({
                memories: supplied.memories.map((item) => ({
                    kind: item.kind,
                    title: item.title,
                    body: item.body,
                    state: item.state,
                    memoryIds: [item.memoryId],
                    supersedes: [],
                })),
            });
        };
        await expect(
            distillAgentSessionMemories(originals, model, signal),
        ).rejects.toThrow(/did not reduce|bounded group/);
    });

    test("does not validate a new combined procedure even from individually observed steps", async () => {
        const originals = (await steps(2)).map((item) => ({
            ...item,
            state: "observed" as const,
        }));
        const model = new SynthesisModel();
        model.state = "observed";
        await expect(
            distillAgentSessionMemories(originals, model, signal),
        ).rejects.toThrow("Invalid observed promotion");
    });

    test("synthesis aborts promptly even if the injected model ignores the signal", async () => {
        const originals = await steps(2);
        const model = new SynthesisModel();
        const controller = new AbortController();
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
            started = resolve;
        });
        model.complete = () =>
            new Promise<string>(() => {
                started();
            });
        const pending = distillAgentSessionMemories(
            originals,
            model,
            controller.signal,
        );
        await ready;
        controller.abort(new Error("stop synthesis"));
        await expect(pending).rejects.toThrow("stop synthesis");
    });
});
describe("conservative agent memory reconciliation", () => {
    test("keeps corrections as conflicts, deduplicates IDs and does not mutate inputs", async () => {
        const old = await artifact({
            memoryId: "old",
            title: "  Local   Tools ",
        });
        const correction = await artifact({
            memoryId: "new",
            title: "local tools",
            body: "The earlier PATH advice is incorrect.",
        });
        const before = JSON.stringify([old, correction]);
        const reconciled = reconcileAgentMemories(
            [old],
            [correction, correction],
        );
        expect(
            reconciled.map((item) => [item.memoryId, item.conflicted]),
        ).toEqual([
            ["old", true],
            ["new", true],
        ]);
        expect(JSON.stringify([old, correction])).toBe(before);
    });

    test("honors explicit verified prior supersession but preserves history", async () => {
        const old = await artifact({ memoryId: "old" });
        const correction = await artifact({
            memoryId: "new",
            body: "Corrected conditional guidance.",
            supersedes: ["old"],
        });
        const result = reconcileAgentMemories([old], [correction]);
        expect(result).toHaveLength(2);
        expect(result.map((item) => item.conflicted)).toEqual([false, false]);
        expect(result[1]!.supersedes).toEqual(["old"]);
        expect(reconcileAgentMemories(result, [])).toEqual(result);
    });

    test("does not honor fabricated, cross-scope, cross-kind or self supersession", async () => {
        const old = await artifact({ memoryId: "old" });
        const unrelated = await artifact({
            memoryId: "other-scope",
            scope: { ...old.scope, commit: "other" },
        });
        const otherKind = await artifact({
            memoryId: "other-kind",
            kind: "semantic",
        });
        const correction = await artifact({
            memoryId: "new",
            body: "Contradicting guidance.",
            supersedes: ["invented", "other-scope", "other-kind", "new"],
        });
        const result = reconcileAgentMemories(
            [old, unrelated, otherKind],
            [correction],
        );
        expect(result[3]!.supersedes).toEqual([]);
        expect(result.map((item) => item.conflicted)).toEqual([
            true,
            false,
            false,
            true,
        ]);
    });

    test("does not conflate scopes, kinds, unrelated titles or provenance-only revisions", async () => {
        const old = await artifact({ memoryId: "old" });
        const incoming = [
            await artifact({
                memoryId: "revision-only",
                evidence: [{ ...old.evidence[0]!, revisionId: "next" }],
            }),
            await artifact({
                memoryId: "repo",
                scope: { ...old.scope, repository: "elsewhere" },
                body: "different",
            }),
            await artifact({
                memoryId: "commit",
                scope: { ...old.scope, commit: "next" },
                body: "different",
            }),
            await artifact({
                memoryId: "environment",
                scope: { ...old.scope, environment: "Linux" },
                body: "different",
            }),
            await artifact({
                memoryId: "kind",
                kind: "semantic",
                body: "different",
            }),
            await artifact({
                memoryId: "title",
                title: "Other guidance",
                body: "different",
            }),
        ];
        expect(
            reconcileAgentMemories([old], incoming).every(
                (item) => !item.conflicted,
            ),
        ).toBe(true);
    });
});
