// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CorpusQuestionInput,
    CorpusQuestionProposal,
    DiscoveryReceipt,
    KnowledgeDiscoveryState,
} from "../src/knowledgeTypes.js";
import { knowledgeLimits } from "../src/knowledgeTypes.js";
import {
    admitCorpusQuestion,
    cachedCorpusQuestionReceipt,
    corpusQuestionIdentity,
    discoveryRouteMatches,
    deriveDiscoveryRouteTerms,
    planCorpusQuestionWindows,
    planDiscoveryWindowsWithCoverage,
    policyAdmittedSlot,
} from "../src/knowledgeDiscovery.js";
import {
    parseCorpusQuestionDiscovery,
    parseSynthesisJson,
} from "../src/schemaViewSynthesis.js";
import {
    questionBody,
    resolveQuestion,
    validateQuestionSlot,
} from "../src/schemaView.js";
import type { AnswerCandidate, QuestionSlot } from "../src/schemaViewTypes.js";

const slot: QuestionSlot = {
    id: "model-hint",
    question: "Who leads the Harbor rollout?",
    cardinality: "singleton",
    schema: { type: "string" },
    rubric: {
        version: 1,
        selection: "independentSupport",
        requireConfirmation: true,
        authoritySourceIds: [],
    },
    approval: "proposed",
    discoveryCitations: [],
};
const passage = {
    passageId: "host-passage",
    sourceId: "source",
    revisionId: "revision",
    locator: "chars:0-31",
    excerpt: "Morgan leads the Harbor rollout.",
    title: "Harbor",
};
const input: CorpusQuestionInput = {
    corpusId: "corpus",
    fingerprint: "fingerprint",
    passages: [passage],
    existingQuestions: [],
    maxProposals: 6,
};
const state: KnowledgeDiscoveryState = {
    version: 1,
    policy: "sourceObserved",
    policyVersion: 1,
    receipts: [],
    routes: [],
    callTimes: [],
};
function response(
    entries: unknown[] = [
        {
            subject: "Harbor",
            reason: "Persistent rollout ownership",
            slot,
            passageIds: [passage.passageId],
        },
    ],
) {
    return { json: JSON.stringify(entries) };
}
function proposal(): CorpusQuestionProposal {
    return parseCorpusQuestionDiscovery(input, response())[0];
}

test("generic role subjects route through meaningful predicates, not grammar", () => {
    expect(
        deriveDiscoveryRouteTerms("User", "Where was the user born?"),
    ).toEqual(["born"]);
    expect(
        deriveDiscoveryRouteTerms(
            "Harbor rollout",
            "Who leads the Harbor rollout?",
        ),
    ).toEqual(["harbor", "rollout"]);
});

test("question utility dimensions are typed and bounded independently of evidence", () => {
    const entry = {
        subject: "Harbor",
        reason: "Durable ownership",
        slot,
        passageIds: [passage.passageId],
        utility: { consumerValue: 2, substance: 2, novelty: 1, durability: 2 },
    };
    expect(
        parseCorpusQuestionDiscovery(input, response([entry]))[0].utility,
    ).toEqual(entry.utility);
    expect(() =>
        parseCorpusQuestionDiscovery(
            input,
            response([
                { ...entry, utility: { ...entry.utility, consumerValue: 10 } },
            ]),
        ),
    ).toThrow("utility");
});

describe("content-only corpus discovery", () => {
    test("resolves host-issued original evidence, not model-authored offsets", () => {
        const parsed = proposal();
        expect(parsed.slot.discoveryCitations).toEqual([
            {
                sourceId: "source",
                revisionId: "revision",
                locator: passage.locator,
                excerpt: passage.excerpt,
            },
        ]);
        expect(parsed.slot.approval).toBe("proposed");
        expect(() =>
            parseCorpusQuestionDiscovery(
                input,
                response([
                    {
                        subject: "Harbor",
                        reason: "Ownership",
                        slot,
                        passageIds: ["invented"],
                    },
                ]),
            ),
        ).toThrow("Unknown retained passage");
    });

    test("zero proposals is valid but malformed output is not", () => {
        expect(parseCorpusQuestionDiscovery(input, response([]))).toEqual([]);
        expect(() =>
            parseCorpusQuestionDiscovery(input, { json: "{}" }),
        ).toThrow();
        expect(() =>
            parseCorpusQuestionDiscovery(input, { json: "broken" }),
        ).toThrow();
        expect(() =>
            parseCorpusQuestionDiscovery(input, {
                ...response([]),
                answer: "Morgan",
            }),
        ).toThrow();
    });

    test("identifies outer and nested JSON failures without accepting trailing content", () => {
        const outer = `${JSON.stringify(response([]))} {}`;
        expect(() =>
            parseSynthesisJson(
                outer,
                "question_proposals outer model response",
            ),
        ).toThrow(
            "question_proposals outer model response: invalid JSON at position",
        );
        expect(() =>
            parseCorpusQuestionDiscovery(input, { json: "[] {}" }),
        ).toThrow(
            "Corpus question discovery nested json: invalid JSON at position",
        );
        expect(() =>
            parseCorpusQuestionDiscovery(input, { json: "```json\n[]\n```" }),
        ).toThrow("Corpus question discovery nested json: invalid JSON");
        expect(() =>
            parseSynthesisJson("private source words", "outer model response"),
        ).toThrow(/^outer model response: invalid JSON$/);
        expect(
            parseSynthesisJson(JSON.stringify(response([])), "outer"),
        ).toEqual(response([]));
    });

    test("uses typed proposal validation without retrying or returning malformed output as zero proposals", () => {
        expect(() =>
            parseCorpusQuestionDiscovery(
                input,
                response([
                    {
                        subject: 7,
                        reason: "Persistent state",
                        slot,
                        passageIds: [passage.passageId],
                    },
                ]),
            ),
        ).toThrow("nested json: typed proposal validation failed");
        expect(() =>
            parseCorpusQuestionDiscovery(
                input,
                response([
                    {
                        subject: "Harbor",
                        reason: "Persistent state",
                        slot: {
                            ...slot,
                            rubric: {
                                ...slot.rubric,
                                requireConfirmation: "false",
                            },
                        },
                        passageIds: [passage.passageId],
                    },
                ]),
            ),
        ).toThrow("typed proposal validation failed");
    });

    test("rejects unsupported schema, answer payloads, ungrounded subjects and model provenance", () => {
        const base = {
            subject: "Harbor",
            reason: "Ownership",
            slot,
            passageIds: [passage.passageId],
        };
        for (const entry of [
            { ...base, slot: { ...slot, schema: { type: "array" } } },
            { ...base, answer: "Morgan" },
            { ...base, subject: "Unmentioned project" },
            { ...base, slot: { ...slot, admission: { version: 1 } } },
            { ...base, passageIds: [] },
            {
                ...base,
                slot: {
                    ...slot,
                    schema: {
                        type: "object",
                        properties: { name: { type: "string" } },
                        required: ["name"],
                    },
                    cardinality: "collection",
                },
            },
        ])
            expect(() =>
                parseCorpusQuestionDiscovery(input, response([entry])),
            ).toThrow();
    });

    test("rejects event evidence and fabricated authority IDs", () => {
        expect(() =>
            parseCorpusQuestionDiscovery(
                {
                    ...input,
                    passages: [
                        {
                            ...passage,
                            evidence: { kind: "event", eventId: "event" },
                        },
                    ],
                },
                response(),
            ),
        ).toThrow("original evidence");
        expect(() =>
            parseCorpusQuestionDiscovery(
                input,
                response([
                    {
                        subject: "Harbor",
                        reason: "Ownership",
                        passageIds: [passage.passageId],
                        slot: {
                            ...slot,
                            rubric: {
                                ...slot.rubric,
                                authoritySourceIds: ["invented"],
                            },
                        },
                    },
                ]),
            ),
        ).toThrow("fabricated authority");
    });

    test("deduplicates normalized contracts independently of model IDs", () => {
        const original = proposal();
        const differentlyNamed = structuredClone(original);
        differentlyNamed.slot.id = "different-hint";
        differentlyNamed.slot.question = "WHO leads the Harbor rollout?!";
        differentlyNamed.slot.rubric.requireConfirmation = false;
        expect(corpusQuestionIdentity(differentlyNamed)).toBe(
            corpusQuestionIdentity(original),
        );
        const historical = structuredClone(original);
        historical.slot.rubric.selection = "mostRecent";
        expect(corpusQuestionIdentity(historical)).not.toBe(
            corpusQuestionIdentity(original),
        );
        const collection = structuredClone(original);
        collection.slot.cardinality = "collection";
        collection.slot.itemKey = "name";
        expect(corpusQuestionIdentity(collection)).not.toBe(
            corpusQuestionIdentity(original),
        );
        expect(() =>
            parseCorpusQuestionDiscovery(
                {
                    ...input,
                    existingQuestions: [corpusQuestionIdentity(original)],
                },
                response(),
            ),
        ).toThrow("Duplicate");
        expect(() =>
            parseCorpusQuestionDiscovery(
                { ...input, existingQuestions: [slot.question] },
                response(),
            ),
        ).toThrow("Duplicate");
        expect(() =>
            parseCorpusQuestionDiscovery(
                input,
                response([
                    {
                        subject: "Harbor",
                        reason: "Ownership",
                        slot,
                        passageIds: [passage.passageId],
                    },
                    {
                        subject: "Harbor",
                        reason: "Ownership again",
                        slot,
                        passageIds: [passage.passageId],
                    },
                ]),
            ),
        ).toThrow("Duplicate");
    });

    test("policy admission is not human confirmation and suggestions do not run", () => {
        const admitted = admitCorpusQuestion(proposal(), {
            policy: "sourceObserved",
            inputFingerprint: input.fingerprint,
            adapterIdentity: "offline",
        });
        expect(admitted.approval).toBe("approved");
        expect(admitted.id).not.toBe(slot.id);
        expect(admitted.admission?.actor).toBe("policy");
        expect(admitted.rubric.requireConfirmation).toBe(false);
        expect(resolveQuestion(admitted, [], []).reviewState).toBe(
            "unreviewed",
        );
        const suggested = admitCorpusQuestion(proposal(), {
            policy: "suggest",
            inputFingerprint: input.fingerprint,
            adapterIdentity: "offline",
        });
        expect(suggested.approval).toBe("proposed");
        expect(suggested.rubric.requireConfirmation).toBe(true);
        expect(() =>
            admitCorpusQuestion(proposal(), {
                policy: "off",
                inputFingerprint: input.fingerprint,
                adapterIdentity: "offline",
            }),
        ).toThrow("disabled");
    });

    test("admission metadata is strict, optional and leaves canonical bodies unchanged", () => {
        const admitted = admitCorpusQuestion(proposal(), {
            policy: "sourceObserved",
            inputFingerprint: input.fingerprint,
            adapterIdentity: "offline",
        });
        const details = resolveQuestion(admitted, [], []);
        expect(questionBody(slot, details)).toBe(
            questionBody(admitted, details),
        );
        expect(() => validateQuestionSlot(slot)).not.toThrow();
        for (const admission of [
            { ...admitted.admission, version: 2 },
            { ...admitted.admission, policyVersion: 2 },
            { ...admitted.admission, actor: "model" },
            { ...admitted.admission, reason: "" },
            { ...admitted.admission, confirmed: true },
            { ...admitted.admission, recipeIdentity: "x".repeat(1001) },
            { ...admitted.admission, modelIdentity: "x".repeat(1001) },
            { ...admitted.admission, inputFingerprint: "x".repeat(1001) },
            { ...admitted.admission, reason: "x".repeat(2001) },
        ])
            expect(() =>
                validateQuestionSlot({ ...admitted, admission }),
            ).toThrow();
    });

    test("admission validates exact frozen citations without trusting adapters", () => {
        const admitted = policyAdmittedSlot(
            proposal(),
            input,
            "sourceObserved",
            "offline",
        );
        expect(admitted.admission?.inputFingerprint).toBe(input.fingerprint);
        const fabricated = proposal();
        fabricated.slot.discoveryCitations[0].excerpt = "An invented answer";
        expect(() =>
            policyAdmittedSlot(fabricated, input, "sourceObserved", "offline"),
        ).toThrow("outside");
        expect(() =>
            policyAdmittedSlot(
                { ...proposal(), subject: "Unmentioned project" },
                input,
                "sourceObserved",
                "offline",
            ),
        ).toThrow("not resolvable");
    });

    test("source-observed candidates answer without confirmation but unresolved ties and manual policy remain honest", () => {
        const admitted = policyAdmittedSlot(
            proposal(),
            input,
            "sourceObserved",
            "offline",
        );
        const candidate: AnswerCandidate = {
            id: "candidate",
            value: "Morgan",
            origin: "source",
            review: "unreviewed",
            citations: admitted.discoveryCitations,
            opposingCitations: [],
            derivedFrom: [],
            support: [
                { citation: admitted.discoveryCitations[0], derivedFrom: [] },
            ],
        };
        expect(resolveQuestion(admitted, [candidate], []).answerState).toBe(
            "answered",
        );
        expect(resolveQuestion(admitted, [candidate], []).reviewState).toBe(
            "unreviewed",
        );
        const other = { ...candidate, id: "other", value: "Taylor" };
        expect(
            resolveQuestion(admitted, [candidate, other], []).answerState,
        ).toBe("conflicted");
        const manual = {
            ...admitted,
            rubric: { ...admitted.rubric, selection: "manual" as const },
        };
        expect(resolveQuestion(manual, [candidate], []).answerState).toBe(
            "pending",
        );
    });
});

describe("bounded deterministic original-source planning", () => {
    test("is deterministic and bounded by serialized evidence", () => {
        const passages = Array.from({ length: 100 }, (_, index) => ({
            ...passage,
            sourceId: `source-${String(index).padStart(3, "0")}`,
            passageId: `host-${index}`,
        }));
        const request = {
            corpusId: "corpus",
            passages,
            adapterIdentity: "offline",
        };
        const plan = planCorpusQuestionWindows(request);
        expect(plan).toEqual(
            planCorpusQuestionWindows({
                ...request,
                passages: [...passages].reverse(),
            }),
        );
        expect(plan.windows).toHaveLength(3);
        expect(plan.windows[0].passages[0].sourceId).toBe("source-000");
        expect(plan.inspectedSources).toHaveLength(72);
        expect(plan.deferredSources).toHaveLength(28);
        for (const window of plan.windows) {
            expect(window.passages.length).toBeLessThanOrEqual(
                knowledgeLimits.windowPassages,
            );
            expect(JSON.stringify(window.passages).length).toBeLessThanOrEqual(
                knowledgeLimits.windowChars,
            );
        }
    });

    test("advances beyond three completed windows and exhausts unchanged content", () => {
        const sourceRecords = Array.from({ length: 100 }, (_, index) => ({
            sourceId: `source-${String(index).padStart(3, "0")}`,
            revisionId: "revision",
            title: "Harbor",
            content: passage.excerpt,
        }));
        const plan = (receipts: DiscoveryReceipt[], questions: string[] = []) =>
            planDiscoveryWindowsWithCoverage(
                "corpus",
                sourceRecords,
                questions,
                { ...state, receipts },
                "offline",
            );
        const receipt = (window: CorpusQuestionInput): DiscoveryReceipt => ({
            fingerprint: window.fingerprint,
            sources: window.passages.map(({ sourceId, revisionId }) => ({
                sourceId,
                revisionId,
            })),
            state: "complete",
            attempts: 1,
            startedAt: "2026-10-23T00:00:00.000Z",
            proposals: [],
            viewIds: [],
        });
        const first = plan([]);
        expect(first.windows).toHaveLength(3);
        const receipts = first.windows.map(receipt);
        const later = plan(receipts, ["Newly admitted question"]);
        expect(later.windows).toHaveLength(2);
        expect(later.windows[0].passages[0].sourceId).toBe("source-072");
        expect(later.deferredSources).toEqual([]);
        expect(
            later.windows.every(
                (window) =>
                    !receipts.some(
                        (entry) => entry.fingerprint === window.fingerprint,
                    ),
            ),
        ).toBe(true);
        const exhausted = plan(
            [...receipts, ...later.windows.map(receipt)],
            ["Another contract"],
        );
        expect(exhausted.windows).toEqual([]);
        expect(exhausted.deferredSources).toEqual([]);
    });

    test("preserves deferred fingerprints across inventory changes and returns failed and running work", () => {
        const passages = Array.from({ length: 100 }, (_, index) => ({
            ...passage,
            sourceId: `source-${String(index).padStart(3, "0")}`,
            passageId: `host-${index}`,
        }));
        const request = {
            corpusId: "corpus",
            passages,
            adapterIdentity: "offline",
        };
        const first = planCorpusQuestionWindows(request).windows;
        const completed = first.map(
            (window): DiscoveryReceipt => ({
                fingerprint: window.fingerprint,
                sources: [],
                state: "complete",
                attempts: 1,
                startedAt: "2026-10-23T00:00:00.000Z",
                viewIds: [],
            }),
        );
        const later = planCorpusQuestionWindows({
            ...request,
            receipts: completed,
        }).windows;
        const deferred: DiscoveryReceipt = {
            ...completed[0],
            fingerprint: later[1].fingerprint,
            state: "deferred",
            proposals: [],
            processedProposals: 0,
        };
        const failed: DiscoveryReceipt = { ...completed[0], state: "failed" };
        const running: DiscoveryReceipt = { ...completed[1], state: "running" };
        const resumed = planCorpusQuestionWindows({
            ...request,
            existingQuestions: ["Inventory mutation"],
            receipts: [failed, running, completed[2], deferred],
        }).windows;
        expect(resumed.map((window) => window.fingerprint)).toEqual([
            deferred.fingerprint,
            failed.fingerprint,
            running.fingerprint,
        ]);
        expect(resumed[0].passages).toEqual(later[1].passages);
        expect(resumed[0].existingQuestions).toEqual(["Inventory mutation"]);
        expect(
            planCorpusQuestionWindows({
                ...request,
                existingQuestions: ["Changed"],
            }).windows[0].fingerprint,
        ).toBe(first[0].fingerprint);
    });

    test("does not silently truncate oversized passages", () => {
        const huge = {
            ...passage,
            excerpt: "x".repeat(25000),
            passageId: "huge",
        };
        const plan = planCorpusQuestionWindows({
            corpusId: "corpus",
            passages: [huge],
            adapterIdentity: "offline",
        });
        expect(plan.windows).toEqual([]);
        expect(plan.deferredSources).toEqual([
            { sourceId: passage.sourceId, revisionId: passage.revisionId },
        ]);
    });

    test("uses adapter-aware stable fingerprints and caches completed empty outputs", () => {
        const request = {
            corpusId: "corpus",
            passages: [passage],
            adapterIdentity: "offline",
        };
        const window = planCorpusQuestionWindows(request).windows[0];
        expect(window.fingerprint).not.toBe(
            planCorpusQuestionWindows({ ...request, adapterIdentity: "other" })
                .windows[0].fingerprint,
        );
        const receipt = {
            fingerprint: window.fingerprint,
            sources: [],
            state: "complete" as const,
            attempts: 1,
            startedAt: "2026-10-23T00:00:00.000Z",
            proposals: [],
            viewIds: [],
        };
        expect(cachedCorpusQuestionReceipt([receipt], window.fingerprint)).toBe(
            receipt,
        );
        expect(
            cachedCorpusQuestionReceipt(
                [{ ...receipt, state: "failed" }],
                window.fingerprint,
            ),
        ).toBeUndefined();
    });

    test("never forwards arbitrary source properties as future-query hints", () => {
        const contaminated = {
            ...passage,
            goldAnswer: "Morgan",
            futureQuestion: "Who leads?",
        };
        const plan = planCorpusQuestionWindows({
            corpusId: "corpus",
            passages: [contaminated],
            adapterIdentity: "offline",
        });
        expect(JSON.stringify(plan.windows)).not.toContain("goldAnswer");
        expect(JSON.stringify(plan.windows)).not.toContain("futureQuestion");
    });

    test("samples long sessions beyond the header with exact retained UTF-16 locators", () => {
        const content = Array.from(
            { length: 200 },
            (_, i) =>
                `Turn ${i}: 🚢 Harbor project update. ${"words ".repeat(80)}`,
        ).join("\r\n\r\n");
        const plan = planDiscoveryWindowsWithCoverage(
            "corpus",
            [
                {
                    sourceId: "source",
                    revisionId: "revision",
                    title: "Harbor",
                    content,
                },
            ],
            [],
            state,
            "offline",
        );
        const selected = plan.windows.flatMap((window) => window.passages);
        expect(
            selected.some(
                (p) => Number(p.locator.split("-")[1]) > content.length / 2,
            ),
        ).toBe(true);
        for (const p of selected) {
            const [, start, end] = /^chars:(\d+)-(\d+)$/.exec(p.locator)!;
            expect(p.excerpt).toBe(content.slice(Number(start), Number(end)));
        }
        expect(plan.deferredSources).toHaveLength(1);
    });

    test("routes exact normalized subjects without substring identity collisions or detached overwrite", () => {
        const route = {
            viewId: "view",
            subject: "Harbor",
            terms: ["rollout"],
            sourceIds: ["source"],
        };
        expect(
            discoveryRouteMatches(route, { title: "Harbor rollout notes" }),
        ).toBe(true);
        expect(discoveryRouteMatches(route, { title: "Harborview" })).toBe(
            false,
        );
        expect(discoveryRouteMatches(route, { terms: ["HARBOR"] })).toBe(true);
        expect(
            discoveryRouteMatches(
                { ...route, detached: true },
                { sourceId: "source" },
            ),
        ).toBe(false);
    });
});
