// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    KnowledgeCoordinator,
    type KnowledgeDocument,
    type KnowledgeHost,
} from "../src/knowledgeCoordinator.js";
import type {
    CorpusQuestionInput,
    CorpusQuestionProposal,
    KnowledgeStatus,
} from "../src/knowledgeTypes.js";

function fixture() {
    let state: KnowledgeStatus = {
        discovery: {
            version: 1,
            policyVersion: 1,
            policy: "sourceObserved",
            receipts: [],
            routes: [],
            callTimes: [],
        },
        checkpoints: [],
    };
    let sources: KnowledgeDocument[] = [
        {
            sourceId: "source",
            revisionId: "r1",
            title: "Harbor",
            content: "Morgan leads Harbor.",
        },
    ];
    let discoveries = 0;
    let maintenance = 0;
    const host: KnowledgeHost = {
        modelIdentity: "offline-v1",
        read: async () => structuredClone(state),
        write: async (_corpus, update) => {
            update(state);
            return structuredClone(state);
        },
        capture: async () => ({
            sources: structuredClone(sources),
            indexVersion: "index-v1",
        }),
        activeImport: () => false,
        questions: async () => [],
        plan: (corpusId, documents) =>
            documents.length
                ? [
                      {
                          corpusId,
                          fingerprint: documents
                              .map(
                                  (source) =>
                                      `${source.sourceId}:${source.revisionId}`,
                              )
                              .join(","),
                          passages: documents.map((source, i) => ({
                              sourceId: source.sourceId,
                              revisionId: source.revisionId,
                              title: source.title,
                              passageId: `p${i}`,
                              locator: `chars:0-${source.content.length}`,
                              excerpt: source.content,
                          })),
                          existingQuestions: [],
                          maxProposals: 6,
                      },
                  ]
                : [],
        discover: async () => {
            discoveries++;
            return [];
        },
        admit: async () => "view",
        route: async () => {},
        maintain: async () => {
            maintenance++;
            return { state: "ready", viewIds: [], jobIds: [], reasons: [] };
        },
        enabledFamilies: () => ["questions"],
    };
    const coordinator = new KnowledgeCoordinator(host);
    return {
        coordinator,
        host,
        state: () => state,
        discoveries: () => discoveries,
        maintenance: () => maintenance,
        sources: (next: KnowledgeDocument[]) => {
            sources = next;
        },
        restore: (next: KnowledgeStatus) => {
            state = next;
        },
    };
}

test.each([0, 11])(
    "grounding repair reserves its own persisted hourly allowance after %s prior calls",
    async (previousCalls) => {
        const f = fixture();
        f.state().discovery.callTimes = Array.from(
            { length: previousCalls },
            () => Date.now(),
        );
        let modelCalls = 0;
        f.host.discover = async (_input, _signal, reserveRepair) => {
            modelCalls++;
            await reserveRepair();
            modelCalls++;
            return [];
        };
        try {
            const checkpoint = await f.coordinator.create({
                corpusId: "corpus",
            });
            const done = await f.coordinator.wait({
                corpusId: "corpus",
                checkpointId: checkpoint.checkpointId,
            });
            expect(done.state).toBe(previousCalls === 0 ? "ready" : "failed");
            expect(modelCalls).toBe(previousCalls === 0 ? 2 : 1);
            expect(f.state().discovery.callTimes).toHaveLength(
                previousCalls === 0 ? 2 : 12,
            );
            if (previousCalls)
                expect(done.reasons.join(" ")).toContain(
                    "hourly budget exhausted before grounding repair",
                );
        } finally {
            await f.coordinator.close();
        }
    },
);

test("discovery persists source identities and adapter identity before dispatch", async () => {
    const f = fixture();
    const plan = f.host.plan;
    let expected!: CorpusQuestionInput;
    f.host.plan = (...args) => {
        const windows = plan(...args);
        windows[0].existingQuestions = ["Who leads Harbor?"];
        expected = structuredClone(windows[0]);
        return windows;
    };
    f.host.discover = async (input) => {
        const receipt = f.state().discovery.receipts[0];
        expect(receipt.state).toBe("running");
        expect(receipt.fingerprint).toBe(expected.fingerprint);
        expect(receipt.sources).toEqual([
            { sourceId: "source", revisionId: "r1" },
        ]);
        expect(receipt.adapterIdentity).toBe(f.host.modelIdentity);
        input.existingQuestions.push("A later contract");
        input.passages[0].title = "Changed after dispatch";
        expect(receipt.sources).toEqual([
            { sourceId: "source", revisionId: "r1" },
        ]);
        return [];
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: checkpoint.checkpointId,
                })
            ).state,
        ).toBe("ready");
        const receipt = f.state().discovery.receipts[0];
        expect(receipt.state).toBe("complete");
        expect(receipt.fingerprint).toBe(expected.fingerprint);
        expect(receipt.adapterIdentity).toBe("offline-v1");
    } finally {
        await f.coordinator.close();
    }
});

test("cold-start discovery completes with zero proposals and unchanged input is cached", async () => {
    const f = fixture();
    try {
        const first = await f.coordinator.create({
            corpusId: "corpus",
            producerComplete: true,
        });

        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: first.checkpointId,
        });
        expect(done.state).toBe("ready");
        expect(done.coverage).toEqual({
            inspectedSources: 1,
            deferredSources: 0,
        });
        expect(f.discoveries()).toBe(1);
        const second = await f.coordinator.create({ corpusId: "corpus" });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: second.checkpointId,
                })
            ).state,
        ).toBe("ready");
        expect(f.discoveries()).toBe(1);
    } finally {
        await f.coordinator.close();
    }
});

test("concurrent checkpoint creation reserves the corpus before capturing sources", async () => {
    const f = fixture();
    const capture = f.host.capture;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.host.capture = async (corpusId) => {
        await gate;
        return capture(corpusId);
    };
    try {
        const first = f.coordinator.create({ corpusId: "corpus" });
        await expect(
            f.coordinator.create({ corpusId: "corpus" }),
        ).rejects.toThrow("already running");
        release();
        const checkpoint = await first;
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: checkpoint.checkpointId,
                })
            ).state,
        ).toBe("ready");
    } finally {
        release();
        await f.coordinator.close();
    }
});

test("admission overflow remains durable and resumes without another model call", async () => {
    const f = fixture();
    const plan = f.host.plan;
    f.host.plan = (...args) => {
        const first = plan(...args)[0];
        return [
            first,
            { ...first, fingerprint: `${first.fingerprint}:second` },
        ];
    };
    let calls = 0;
    let admissions = 0;
    f.host.discover = async (input) => {
        calls++;
        return Array.from(
            { length: 6 },
            (_, index): CorpusQuestionProposal => ({
                subject: "Harbor",
                reason: "Source-observed project details",
                slot: {
                    id: `detail-${index}`,
                    question: `${input.fingerprint} detail ${index}?`,
                    cardinality: "singleton",
                    schema: { type: "string" },
                    rubric: {
                        version: 1,
                        selection: "mostRecent",
                        requireConfirmation: false,
                        authoritySourceIds: [],
                    },
                    approval: "proposed",
                    discoveryCitations: input.passages,
                },
            }),
        );
    };
    f.host.admit = async () => `view-${++admissions}`;
    try {
        const first = await f.coordinator.create({
            corpusId: "corpus",
        });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: first.checkpointId,
                })
            ).state,
        ).toBe("partial");
        expect(admissions).toBe(8);
        expect(f.state().discovery.receipts[1].state).toBe("deferred");
        expect(f.state().discovery.receipts[1].processedProposals).toBe(2);
        const second = await f.coordinator.create({
            corpusId: "corpus",
        });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: second.checkpointId,
                })
            ).state,
        ).toBe("ready");
        expect(admissions).toBe(12);
        expect(calls).toBe(2);
        expect(f.state().discovery.callTimes).toHaveLength(2);
    } finally {
        await f.coordinator.close();
    }
});
test("source indexing is not readiness while required maintenance is running", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.host.maintain = async () => {
        await gate;
        return {
            state: "ready",
            viewIds: ["derived"],
            jobIds: ["job"],
            reasons: [],
        };
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(
            (
                await f.coordinator.get({
                    corpusId: "corpus",
                    checkpointId: checkpoint.checkpointId,
                })
            ).state,
        ).toBe("running");
        release();
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        expect(done.state).toBe("ready");
        expect(done.viewIds).toEqual(["derived"]);
    } finally {
        release();
        await f.coordinator.close();
    }
});

test("a ready checkpoint becomes superseded after a captured source replacement", async () => {
    const f = fixture();
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const request = {
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        };
        expect((await f.coordinator.wait(request)).state).toBe("ready");
        f.sources([
            {
                sourceId: "source",
                revisionId: "r2",
                title: "Harbor",
                content: "A changed leader.",
            },
        ]);
        expect((await f.coordinator.get(request)).state).toBe("superseded");
        expect(f.state().checkpoints[0].state).toBe("superseded");
    } finally {
        await f.coordinator.close();
    }
});

test("a ready checkpoint becomes superseded after a maintained view changes", async () => {
    const f = fixture();
    let current = true;
    f.host.maintainedCurrent = async () => current;
    f.host.maintain = async () => ({
        state: "ready",
        viewIds: ["view"],
        viewRevisions: [{ viewId: "view", revisionId: "v1" }],
        jobIds: [],
        reasons: [],
    });
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const request = {
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        };
        const ready = await f.coordinator.wait(request);
        expect(ready.state).toBe("ready");
        expect(ready.viewRevisions).toEqual([
            { viewId: "view", revisionId: "v1" },
        ]);
        current = false;
        expect((await f.coordinator.get(request)).state).toBe("superseded");
    } finally {
        await f.coordinator.close();
    }
});

test("waiting on local work reads history only at its boundaries, not on every timer tick", async () => {
    const f = fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.host.maintain = async () => {
        enter();
        await gate;
        return { state: "ready", viewIds: [], jobIds: [], reasons: [] };
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        await entered;
        const read = f.host.read;
        let reads = 0;
        f.host.read = async (corpusId) => {
            reads++;
            return read(corpusId);
        };
        const waiting = f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(reads).toBe(1);
        release();
        expect((await waiting).state).toBe("ready");
        expect(reads).toBe(2);
    } finally {
        release();
        await f.coordinator.close();
    }
});

test("a wait deadline does not cancel the captured work", async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    f.host.maintain = async () => {
        await gate;
        return { state: "ready", viewIds: [], jobIds: [], reasons: [] };
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const request = {
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        };
        await expect(
            f.coordinator.wait({ ...request, timeoutMs: 20 }),
        ).rejects.toThrow("work continues");
        expect((await f.coordinator.get(request)).state).toBe("running");
        release();
        expect((await f.coordinator.wait(request)).state).toBe("ready");
    } finally {
        release();
        await f.coordinator.close();
    }
});

test("unrelated later ingestion does not extend a captured checkpoint", async () => {
    const f = fixture();
    f.host.maintain = async () => {
        f.sources([
            {
                sourceId: "source",
                revisionId: "r1",
                title: "Harbor",
                content: "Morgan leads Harbor.",
            },
            {
                sourceId: "unrelated",
                revisionId: "r2",
                title: "Other",
                content: "Unrelated.",
            },
        ]);
        return { state: "ready", viewIds: [], jobIds: [], reasons: [] };
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        expect(done.state).toBe("ready");
        expect(done.sources.map((source) => source.sourceId)).toEqual([
            "source",
        ]);
    } finally {
        await f.coordinator.close();
    }
});

test("replacement supersedes a checkpoint instead of rebasing indefinitely", async () => {
    const f = fixture();
    f.host.discover = async () => {
        f.sources([
            {
                sourceId: "source",
                revisionId: "r2",
                title: "Harbor",
                content: "Changed.",
            },
        ]);
        return [];
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: checkpoint.checkpointId,
                })
            ).state,
        ).toBe("superseded");
        expect(f.maintenance()).toBe(0);
    } finally {
        await f.coordinator.close();
    }
});

test("required disabled families block qualification explicitly", async () => {
    const f = fixture();
    try {
        const checkpoint = await f.coordinator.create({
            corpusId: "corpus",
            families: ["questions", "wiki"],
        });
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        expect(done.state).toBe("blocked");
        expect(done.reasons.join(" ")).toContain("wiki");
        expect(f.discoveries()).toBe(0);
    } finally {
        await f.coordinator.close();
    }
});

test("provider failures are persisted, not counted as no proposals or automatically retried", async () => {
    const f = fixture();
    let calls = 0;
    f.host.discover = async () => {
        calls++;
        throw new Error("Provider unavailable");
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        expect(done.state).toBe("failed");
        expect(f.state().discovery.receipts[0].state).toBe("failed");
        const next = await f.coordinator.create({ corpusId: "corpus" });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: next.checkpointId,
                })
            ).state,
        ).toBe("failed");
        expect(calls).toBe(1);
        expect(done.reasons).toContain("Provider unavailable");
    } finally {
        await f.coordinator.close();
    }
});

test("a failed discovery window preserves inspected coverage and still maintains admitted views", async () => {
    const f = fixture();
    f.sources([
        {
            sourceId: "first",
            revisionId: "r1",
            title: "Harbor",
            content: "Morgan leads Harbor.",
        },
        {
            sourceId: "second",
            revisionId: "r2",
            title: "Other",
            content: "Other details.",
        },
    ]);
    const plan = f.host.plan;
    f.host.plan = (...args) => {
        const window = plan(...args)[0];
        return window.passages.map((passage) => ({
            ...window,
            fingerprint: passage.sourceId,
            passages: [passage],
        }));
    };
    f.host.discover = async (input) => {
        if (input.fingerprint === "second")
            throw new Error("Malformed provider response");
        return [];
    };
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        expect(done.state).toBe("failed");
        expect(done.coverage).toEqual({
            inspectedSources: 1,
            deferredSources: 1,
        });
        expect(done.discoveryFingerprints).toHaveLength(2);
        expect(f.maintenance()).toBe(1);
        expect(done.reasons).toContain("Malformed provider response");
    } finally {
        await f.coordinator.close();
    }
});

test("persisted hourly allowance survives a coordinator restart", async () => {
    const f = fixture();
    const state = f.state();
    state.discovery.callTimes = Array.from({ length: 12 }, () => Date.now());
    f.restore(structuredClone(state));
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
        });
        expect(done.state).toBe("partial");
        expect(done.coverage.deferredSources).toBe(1);
        expect(f.discoveries()).toBe(0);
        expect(done.reasons.join(" ")).toContain("budget");
    } finally {
        await f.coordinator.close();
    }
});

test.each([false, true])(
    "producerComplete=%s preserves hourly discovery limits",
    async (producerComplete) => {
        const f = fixture();
        f.state().discovery.callTimes = Array.from({ length: 12 }, () =>
            Date.now(),
        );
        try {
            const checkpoint = await f.coordinator.create({
                corpusId: "corpus",
                producerComplete,
            });
            const done = await f.coordinator.wait({
                corpusId: "corpus",
                checkpointId: checkpoint.checkpointId,
            });
            expect(done.state).toBe("partial");
            expect(done.coverage.deferredSources).toBe(1);
            expect(f.discoveries()).toBe(0);
        } finally {
            await f.coordinator.close();
        }
    },
);

test.each([false, true])(
    "producerComplete=%s controls continuation across bounded discovery windows",
    async (producerComplete) => {
        const f = fixture();
        f.sources(
            Array.from({ length: 7 }, (_, index) => ({
                sourceId: `source-${index}`,
                revisionId: "r1",
                title: "Harbor",
                content: "Original source.",
            })),
        );
        const plan = f.host.plan;
        f.host.plan = (...args) => {
            const window = plan(...args)[0];
            return window.passages
                .map((passage) => ({
                    ...window,
                    fingerprint: passage.sourceId,
                    passages: [passage],
                }))
                .filter(
                    (entry) =>
                        !f
                            .state()
                            .discovery.receipts.some(
                                (receipt) =>
                                    receipt.fingerprint === entry.fingerprint &&
                                    receipt.state === "complete",
                            ),
                )
                .slice(0, 3);
        };
        try {
            const checkpoint = await f.coordinator.create({
                corpusId: "corpus",
                producerComplete,
            });
            const done = await f.coordinator.wait({
                corpusId: "corpus",
                checkpointId: checkpoint.checkpointId,
            });
            expect(done.state).toBe(producerComplete ? "ready" : "partial");
            expect(f.discoveries()).toBe(producerComplete ? 7 : 3);
            expect(done.coverage.inspectedSources).toBe(
                producerComplete ? 7 : 3,
            );
        } finally {
            await f.coordinator.close();
        }
    },
);

test("complete receipts with historical deferral reasons do not remain partial forever", async () => {
    const f = fixture();
    f.state().discovery.receipts.push({
        fingerprint: "source:r1",
        sources: [{ sourceId: "source", revisionId: "r1" }],
        state: "complete",
        attempts: 1,
        startedAt: new Date().toISOString(),
        viewIds: [],
        reason: "Checkpoint admission limit reached",
    });
    try {
        const checkpoint = await f.coordinator.create({
            corpusId: "corpus",
            producerComplete: true,
        });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: checkpoint.checkpointId,
                })
            ).state,
        ).toBe("ready");
        expect(f.discoveries()).toBe(0);
    } finally {
        await f.coordinator.close();
    }
});

test("checkpoint deadline aborts discovery and reports failure", async () => {
    const f = fixture();
    f.host.discover = async (
        _input: CorpusQuestionInput,
        signal: AbortSignal,
    ) =>
        new Promise((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else
                signal.addEventListener("abort", () => reject(signal.reason), {
                    once: true,
                });
        });
    try {
        const checkpoint = await f.coordinator.create({
            corpusId: "corpus",
            timeoutMs: 30,
        });
        const done = await f.coordinator.wait({
            corpusId: "corpus",
            checkpointId: checkpoint.checkpointId,
            timeoutMs: 1000,
        });
        expect(done.state).toBe("failed");
        expect(done.reasons.join(" ")).toContain("deadline");
    } finally {
        await f.coordinator.close();
    }
});

test("empty ready scope succeeds without inventing any questions", async () => {
    const f = fixture();
    f.sources([]);
    try {
        const checkpoint = await f.coordinator.create({ corpusId: "corpus" });
        expect(
            (
                await f.coordinator.wait({
                    corpusId: "corpus",
                    checkpointId: checkpoint.checkpointId,
                })
            ).state,
        ).toBe("ready");
        expect(f.discoveries()).toBe(0);
    } finally {
        await f.coordinator.close();
    }
});
