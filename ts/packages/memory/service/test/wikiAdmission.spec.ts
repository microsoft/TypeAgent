// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    nominateWikiPages,
    parseWikiAssessment,
    reusableWikiAssessment,
    wikiPurposeRules,
    WikiAssessmentRejection,
    wikiAssessmentKey,
} from "../src/wikiAdmission.js";
import { hydrateInformational } from "../src/informationalWiki.js";
import { ViewBuildRunner } from "../src/viewBuilds.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IndexedFragmentRequest } from "../src/types.js";
import type {
    ViewBuildJob,
    ViewBuildSnapshot,
    ViewVersion,
    WikiSubjectAssessment,
} from "../src/viewTypes.js";
import {
    getRuntimeConfig,
    initRuntimeConfigFromProcessEnv,
    setRuntimeConfig,
    type ChatModel,
} from "@typeagent/aiclient";
import {
    createConfiguredViewSynthesisAdapter,
    prepareWikiContribution,
} from "../src/viewSynthesis.js";

function input(viewId = "candidate"): ViewBuildSnapshot {
    const citation = {
        sourceId: "source",
        revisionId: "revision",
        locator: `indexed:0:${"a".repeat(64)}:0-80`,
        excerpt:
            "Platform readiness does not prove application cache propagation. The review remains open.",
    };
    return {
        corpusId: "corpus",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        inputs: [
            {
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
                content: citation.excerpt,
                title: "Offline source",
                contentHash: "a".repeat(64),
                passages: [citation],
            },
        ],
        definition: {
            viewId,
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: "review remains open",
                aliases: [],
                excludedSourceIds: [],
            },
        },
        pipeline: "informational-wiki-v1",
        model: "offline:wiki-source-contribution-v3",
        fingerprint: "frozen",
    };
}
function page(viewId = "canonical"): ViewVersion {
    const snapshot = input(viewId);
    return {
        viewId,
        corpusId: "corpus",
        revisionId: "page-revision",
        version: 1,
        actor: "test",
        createdAt: "2026-10-11T00:00:00Z",
        state: "draft",
        definition: {
            ...snapshot.definition,
            revisionId: "definition-revision",
        },
        content: hydrateInformational(snapshot, {
            summary: "Grounded reference summary.",
            status: "partial",
            title: "Readiness boundaries",
            prose: "The open review qualifies readiness, not a separate platform overview.",
            limits: "Selected evidence only",
            citationIds: ["f0"],
        }).content,
        relationships: [],
        provenance: "generated",
    };
}
function covered(): WikiSubjectAssessment {
    return {
        disposition: "covered",
        purpose: "Readiness qualification",
        reason: "Same scope and explanatory purpose, existing page covers the open review",
        canonicalViewId: "canonical",
        sharedFragmentIds: ["f0"],
        ambiguousViewIds: [],
        essentialDistinctions: [
            {
                fragmentId: "f0",
                statement: "The open review qualifies readiness",
                canonicalExcerpt:
                    "The open review qualifies readiness, not a separate platform overview.",
            },
        ],
    };
}

test("assessment dependencies ignore unrelated publication but retain all nominated context", () => {
    const frozen = input();
    const canonical = page();
    const contexts = nominateWikiPages(frozen, [canonical], new Map());
    const key = wikiAssessmentKey(frozen, contexts, "policy");
    const unrelated = page("unrelated");
    unrelated.definition.wiki!.query = "unrelated astronomy";
    unrelated.content.title = "Astronomy";
    unrelated.content.citations = unrelated.content.citations.map(
        (citation) => ({
            ...citation,
            sourceId: "unrelated-source",
        }),
    );
    expect(
        wikiAssessmentKey(
            frozen,
            nominateWikiPages(frozen, [canonical, unrelated], new Map()),
            "policy",
        ),
    ).toBe(key);
    expect(wikiAssessmentKey(frozen, contexts, "new-policy")).not.toBe(key);
    const changed = structuredClone(frozen);
    changed.inputs[0].content += " New useful evidence.";
    expect(wikiAssessmentKey(changed, contexts, "policy")).not.toBe(key);
    const updatedPages = structuredClone(contexts);
    updatedPages[0].revisionId = "new-revision";
    expect(wikiAssessmentKey(frozen, updatedPages, "policy")).not.toBe(key);
    expect(wikiAssessmentKey(frozen, [], "policy")).not.toBe(key);
    const restart = JSON.parse(JSON.stringify({ frozen, contexts }));
    expect(wikiAssessmentKey(restart.frozen, restart.contexts, "policy")).toBe(
        key,
    );
});

test("canonical coverage checks mandatory distinctions without suppressing unrelated retrieval context", () => {
    const frozen = input();
    const citation = frozen.inputs[0].passages![0];
    frozen.inputs[0].passages!.push({
        ...citation,
        locator: `indexed:1:${"b".repeat(64)}:0-40`,
        excerpt: "An unrelated workshop opens at noon.",
    });
    const contexts = nominateWikiPages(frozen, [page()], new Map());
    const assessment = covered();
    expect(() => parseWikiAssessment(assessment, contexts)).toThrow(
        "invalid-distinction-evidence",
    );
    expect(
        parseWikiAssessment(
            assessment,
            contexts,
            assessment.essentialDistinctions,
        ),
    ).toEqual(assessment);
    expect(() =>
        parseWikiAssessment(assessment, contexts, [
            {
                ...assessment.essentialDistinctions[0],
                statement: "A different required distinction",
            },
        ]),
    ).toThrow("required-distinction-omitted");
    expect(() =>
        parseWikiAssessment(
            {
                ...assessment,
                essentialDistinctions: [
                    {
                        ...assessment.essentialDistinctions[0],
                        canonicalExcerpt: "A fabricated prose witness",
                    },
                ],
            },
            contexts,
            assessment.essentialDistinctions,
        ),
    ).toThrow("invalid-distinction-evidence");
});

test.each([
    "covered",
    "repaired",
    "mergeLoss",
    "conflict",
    "stillMissing",
    "transportFailure",
] as const)(
    "configured canonical construction preserves bounded coverage repair (%s)",
    async (mode) => {
        const frozen = input("canonical");
        frozen.expectedVersion = 1;
        frozen.targetRevisionId = "page-revision";
        frozen.definitionRevisionId = "definition-revision";
        frozen.wikiContribution = {
            candidateViewId: "candidate",
            query: "review remains open",
            purpose: "Readiness qualification",
            essentialDistinctions: [
                {
                    fragmentId: "f0",
                    statement:
                        "Application cache propagation remains unproven and review stays open",
                    canonicalExcerpt: "",
                },
            ],
        };
        const evidence = frozen.inputs[0].passages![0].excerpt;
        let constructions = 0;
        let checks = 0;
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages, _options, schema) => {
                if (typeof messages === "string")
                    throw new Error("Expected messages");
                const payload = JSON.parse(String(messages[1].content));
                if (
                    schema &&
                    !Array.isArray(schema) &&
                    schema.name === "wiki_subject_purpose"
                ) {
                    expect(String(messages[0].content)).toContain(
                        "not standalone admission or redundancy screening",
                    );
                    checks++;
                    const prose = payload.pages[0].prose as string;
                    const complete = prose.includes("review remains open");
                    return {
                        success: true,
                        data: JSON.stringify({
                            ...covered(),
                            disposition: complete ? "covered" : "contribute",
                            sharedFragmentIds: [],
                            essentialDistinctions: [
                                {
                                    fragmentId: "f0",
                                    statement:
                                        frozen.wikiContribution!
                                            .essentialDistinctions[0].statement,
                                    canonicalExcerpt: complete
                                        ? "The review remains open."
                                        : "",
                                },
                            ],
                        }),
                    };
                }
                constructions++;
                if (constructions === 2) {
                    expect(payload.fragments[0].text).toBe(evidence);
                    expect(String(messages[0].content)).toContain(
                        "untrusted diagnostics",
                    );
                    expect(payload.coverageAssessment.disposition).toBe(
                        "contribute",
                    );
                    if (mode === "transportFailure")
                        throw new Error("Synthetic repair transport failure");
                }
                return {
                    success: true,
                    data: JSON.stringify({
                        title: "Readiness",
                        summary:
                            "Platform readiness and application cache propagation are separate.",
                        status: "partial",
                        prose:
                            mode === "covered" ||
                            mode === "mergeLoss" ||
                            (mode === "repaired" && constructions > 1)
                                ? evidence
                                : "Platform readiness does not prove application cache propagation.",
                        limits: "Selected source evidence only",
                        citationIds: ["f0"],
                    }),
                };
            },
        };
        const env = process.env;
        const config = getRuntimeConfig();
        try {
            process.env = {
                ...env,
                OPENAI_ENDPOINT_WIKI_REPAIR:
                    "http://127.0.0.1:1/chat/completions",
                OPENAI_API_KEY_WIKI_REPAIR: "synthetic-test-token-not-a-secret",
                OPENAI_MODEL_WIKI_REPAIR: "synthetic-test-model",
                OPENAI_ORGANIZATION_WIKI_REPAIR: "synthetic-test",
                OPENAI_RESPONSE_FORMAT_WIKI_REPAIR: "1",
            };
            initRuntimeConfigFromProcessEnv();
            const adapter = createConfiguredViewSynthesisAdapter(
                "openai:WIKI_REPAIR",
                4000,
                model,
            );
            const signal = new AbortController().signal;
            let merges = 0;
            const result = adapter.generate(frozen, signal).then((candidate) =>
                prepareWikiContribution(
                    adapter,
                    frozen,
                    candidate,
                    (candidate) => {
                        merges++;
                        const output = structuredClone(candidate);
                        if (mode === "mergeLoss" && merges === 1)
                            output.content.sections[0].body =
                                "Platform readiness does not prove application cache propagation.";
                        return {
                            output,
                            conflicts: mode === "conflict" ? ["editorial"] : [],
                        };
                    },
                    signal,
                ),
            );
            if (mode === "transportFailure") {
                await expect(result).rejects.toThrow(
                    "Synthetic repair transport failure",
                );
            } else if (mode === "stillMissing") {
                await expect(result).rejects.toThrow(
                    "did not cover all essential",
                );
            } else if (mode === "conflict") {
                expect((await result).conflicts).toEqual(["editorial"]);
            } else {
                const { output } = await result;
                expect(output.content.kind).toBe("wiki");
                expect(
                    output.content.sections[0].body.includes(
                        "review remains open",
                    ),
                ).toBe(true);
            }
            expect(constructions).toBe(
                mode === "covered" || mode === "conflict" ? 1 : 2,
            );
            expect(checks).toBe(
                mode === "conflict"
                    ? 0
                    : mode === "repaired" ||
                        mode === "mergeLoss" ||
                        mode === "stillMissing"
                      ? 2
                      : 1,
            );
        } finally {
            process.env = env;
            setRuntimeConfig(config);
        }
    },
);

test.each(["covered", "contribute"] as const)(
    "configured assessment repairs an invalid %s contract once against unchanged evidence",
    async (disposition) => {
        const contexts = nominateWikiPages(input(), [page()], new Map());
        const invalid = {
            ...covered(),
            disposition,
            ...(disposition === "covered" ? { essentialDistinctions: [] } : {}),
        };
        const requests: unknown[] = [];
        const model: ChatModel = {
            completionSettings: {},
            complete: async (messages) => {
                if (typeof messages === "string")
                    throw new Error("Expected labeled messages");
                requests.push(JSON.parse(String(messages[1].content)));
                return {
                    success: true,
                    data: JSON.stringify(
                        requests.length === 1 ? invalid : covered(),
                    ),
                };
            },
        };
        const adapter = createConfiguredViewSynthesisAdapter(
            undefined,
            4000,
            model,
        );
        const result = await adapter.assessWikiSubject!(
            input(),
            contexts,
            new AbortController().signal,
        );
        expect(result.disposition).toBe("covered");
        expect(requests).toHaveLength(2);
        expect(requests[1]).toMatchObject({
            ...(requests[0] as Record<string, unknown>),
            previousAssessment: invalid,
            validationFailure: {
                code:
                    disposition === "covered"
                        ? "invalid-distinction-evidence"
                        : "incomplete-prose-coverage",
            },
        });
    },
);

test("configured assessment rejects a second invalid response without further retries", async () => {
    let calls = 0;
    const model: ChatModel = {
        completionSettings: {},
        complete: async () => {
            calls++;
            return {
                success: true,
                data: JSON.stringify({
                    ...covered(),
                    essentialDistinctions: [],
                }),
            };
        },
    };
    const adapter = createConfiguredViewSynthesisAdapter(
        undefined,
        4000,
        model,
    );
    await expect(
        adapter.assessWikiSubject!(
            input(),
            nominateWikiPages(input(), [page()], new Map()),
            new AbortController().signal,
        ),
    ).rejects.toThrow("invalid-distinction-evidence");
    expect(calls).toBe(2);
});

test("configured Wiki repair identifies omitted fragments and nonverbatim witnesses", async () => {
    const frozen = input();
    const source = frozen.inputs[0];
    source.passages = Array.from({ length: 6 }, (_, index) => ({
        ...source.passages![0],
        locator: `chars:${index}-${index + 1}`,
        excerpt: `Qualification ${index} remains open.`,
    }));
    const contexts = nominateWikiPages(frozen, [page()], new Map());
    contexts[0].prose = source.passages.map((p) => p.excerpt).join("\n");
    const invalid = {
        ...covered(),
        sharedFragmentIds: [],
        essentialDistinctions: [
            {
                fragmentId: "f0",
                statement: "Qualification zero remains open",
                canonicalExcerpt: "Qualification zero remains open.",
            },
            {
                fragmentId: "f0",
                statement: "The qualification is unresolved",
                canonicalExcerpt: "Qualification 0 ... remains open.",
            },
        ],
    };
    let calls = 0;
    const model: ChatModel = {
        completionSettings: {},
        complete: async (messages, _options, schema) => {
            calls++;
            if (typeof messages === "string")
                throw new Error("Expected labeled messages");
            const payload = JSON.parse(String(messages[1].content));
            if (calls === 1) {
                expect(JSON.stringify(schema)).toContain('"f5"');
                return { success: true, data: JSON.stringify(invalid) };
            }
            expect(payload.validationFailure.details).toMatchObject({
                missingFragmentCount: 5,
                invalidFragmentCount: 0,
                invalidWitnessCount: 2,
                missingFragmentOrdinals: [1, 2, 3, 4, 5],
                invalidWitnessOrdinals: [0, 1],
            });
            expect(String(messages[0].content)).toContain(
                "zero-based essentialDistinctions",
            );
            return {
                success: true,
                data: JSON.stringify({
                    ...covered(),
                    sharedFragmentIds: [],
                    essentialDistinctions: payload.fragments.map(
                        (fragment: { id: string; text: string }) => ({
                            fragmentId: fragment.id,
                            statement: fragment.text,
                            canonicalExcerpt: fragment.text,
                        }),
                    ),
                }),
            };
        },
    };
    const adapter = createConfiguredViewSynthesisAdapter(
        undefined,
        4000,
        model,
    );
    const assessment = await adapter.assessWikiSubject!(
        frozen,
        contexts,
        new AbortController().signal,
    );
    expect(assessment.essentialDistinctions).toHaveLength(6);
    expect(calls).toBe(2);
});

test("referential rejection diagnostics reproduce separate failures without retaining model content", () => {
    const contexts = nominateWikiPages(input(), [page()], new Map());
    const cases = [
        {
            value: { ...covered(), canonicalViewId: "private invented text" },
            pages: contexts,
            code: "canonical-not-supplied",
        },
        {
            value: { ...covered(), sharedFragmentIds: ["private fragment"] },
            pages: contexts,
            code: "unsupported-shared-fragments",
        },
        {
            value: { ...covered(), disposition: "distinct" },
            pages: contexts,
            code: "distinct-has-canonical-fields",
        },
    ];
    for (const entry of cases) {
        try {
            parseWikiAssessment(entry.value, entry.pages);
            throw new Error("Expected rejection");
        } catch (error) {
            expect(error).toBeInstanceOf(WikiAssessmentRejection);
            expect((error as WikiAssessmentRejection).code).toBe(entry.code);
            expect((error as Error).message).not.toContain("private");
            expect((error as Error).message.length).toBeLessThan(400);
        }
    }
});

test("ordinary contribution ignores irrelevant context while suppression and critical coverage remain strict", () => {
    const contexts = nominateWikiPages(input(), [page()], new Map());
    contexts[0].candidateFragmentIds.push("f1");
    const contribution = {
        ...covered(),
        disposition: "contribute",
        essentialDistinctions: [
            {
                fragmentId: "f0",
                statement: "Preserve the open review qualification",
                canonicalExcerpt: "",
            },
        ],
    };
    expect(parseWikiAssessment(contribution, contexts).disposition).toBe(
        "contribute",
    );
    expect(() => parseWikiAssessment(covered(), contexts)).toThrow(
        "invalid-distinction-evidence",
    );
    expect(() =>
        parseWikiAssessment(
            {
                ...contribution,
                essentialDistinctions: [
                    {
                        ...contribution.essentialDistinctions[0],
                        fragmentId: "f9",
                    },
                ],
            },
            contexts,
        ),
    ).toThrow("invalid-distinction-evidence");
    expect(() =>
        parseWikiAssessment(
            covered(),
            contexts.slice().map((context) => ({
                ...context,
                candidateFragmentIds: ["f0"],
            })),
            [
                {
                    fragmentId: "f0",
                    statement: "A required number/state qualification",
                    canonicalExcerpt: "",
                },
            ],
        ),
    ).toThrow("required-distinction-omitted");
});

test("index-evidence nomination is bounded, preserves scope/symbol distinctions, and requires exact revision/locator/excerpt", () => {
    const candidate = input();
    const canonical = page();
    const identities = new Map([
        ["candidate", { types: ["concept"], scopes: ["project:one"] }],
        ["canonical", { types: ["platform"], scopes: ["project:one"] }],
    ]);
    expect(
        nominateWikiPages(candidate, [canonical], identities)[0]
            .sharedFragmentIds,
    ).toEqual(["f0"]);
    identities.set("canonical", {
        types: ["platform"],
        scopes: ["project:two"],
    });
    expect(nominateWikiPages(candidate, [canonical], identities)).toEqual([]);
    identities.set("canonical", { types: ["field"], scopes: ["project:one"] });
    expect(nominateWikiPages(candidate, [canonical], identities)).toEqual([]);
    identities.clear();
    const changed = structuredClone(canonical);
    changed.content.citations[0].revisionId = "changed";
    const disjoint = nominateWikiPages(candidate, [changed], identities);
    expect(disjoint).toHaveLength(1);
    expect(disjoint[0].sourceOverlap.shared).toBe(0);
    expect(disjoint[0].sharedFragmentIds).toEqual([]);
    expect(
        nominateWikiPages(
            candidate,
            Array.from({ length: 20 }, (_, i) => page(`page-${i}`)),
            identities,
        ),
    ).toHaveLength(8);
});

test("typed assessment rejects invented canonical identity/evidence, empty purpose, unknown status and extra fields", () => {
    const contexts = nominateWikiPages(input(), [page()], new Map());
    expect(parseWikiAssessment(covered(), contexts)).toEqual(covered());
    for (const invalid of [
        { ...covered(), canonicalViewId: "invented" },
        { ...covered(), sharedFragmentIds: ["f9"] },
        { ...covered(), essentialDistinctions: [] },
        { ...covered(), purpose: "" },
        { ...covered(), disposition: "success" },
        { ...covered(), merge: true },
        { ...covered(), disposition: "distinct" },
    ])
        expect(() => parseWikiAssessment(invalid, contexts)).toThrow();
    expect(wikiPurposeRules).toContain("independently useful");
    expect(wikiPurposeRules).toContain("units/statistics, cohorts");
});

test("first-page utility can defer without inventing a canonical page", () => {
    expect(wikiPurposeRules).toContain(
        "The retrieval query and aliases define the candidate subject",
    );
    expect(wikiPurposeRules).toContain("do not admit an unrelated");
    expect(wikiPurposeRules).toContain(
        "defer the redundant candidate with a concrete reason",
    );
    const value = {
        disposition: "defer",
        purpose: "Passing reference to readiness",
        reason: "No explanatory substance beyond a passing mention",
        canonicalViewId: "",
        sharedFragmentIds: [],
        essentialDistinctions: [],
        ambiguousViewIds: [],
    };
    expect(parseWikiAssessment(value, [])).toEqual(value);
    expect(() =>
        parseWikiAssessment({ ...value, canonicalViewId: "invented" }, []),
    ).toThrow();
});

test("disjoint-source comparisons retain exact incoming evidence and canonical prose checks", () => {
    const canonical = page();
    canonical.content.citations[0].sourceId = "independent-source";
    const contexts = nominateWikiPages(input(), [canonical], new Map());
    expect(contexts).toHaveLength(1);
    expect(contexts[0].sourceOverlap.shared).toBe(0);
    const value = { ...covered(), sharedFragmentIds: [] };
    expect(parseWikiAssessment(value, contexts)).toEqual(value);
    expect(() =>
        parseWikiAssessment(
            {
                ...value,
                essentialDistinctions: [
                    {
                        fragmentId: "f999",
                        statement: "Invented statement",
                        canonicalExcerpt: "",
                    },
                ],
            },
            contexts,
        ),
    ).toThrow();
});

test("one informational target timeout does not cancel independent peers", async () => {
    const snapshot = input();
    const job: ViewBuildJob = {
        jobId: "timeout-job",
        corpusId: "corpus",
        fingerprint: "job",
        actor: "test",
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
        request: { corpusId: "corpus", expectedHead: null, targets: [] },
        state: "running",
        publication: false,
        results: ["slow", "independent"].map((viewId) => ({
            viewId,
            state: "pending",
            reason: "Admitted",
            snapshot: {
                ...snapshot,
                definition: { ...snapshot.definition, viewId },
            },
        })),
    };
    const runner = new ViewBuildRunner(
        {
            identity: "offline",
            generate: async (input) => {
                if (input.definition.viewId === "slow")
                    return new Promise<never>(() => {});
                return hydrateInformational(input, {
                    summary: "Grounded reference summary.",
                    status: "partial",
                    title: "Independent",
                    prose: input.inputs[0].content,
                    limits: "Selected evidence",
                    citationIds: ["f0"],
                });
            },
            validate: async () => {
                throw new Error("No universal informational check");
            },
        },
        {
            current: async () => undefined,
            update: async (_corpusId, _jobId, update) => {
                update(job);
                return job;
            },
            materialize: async (_job, result) => {
                result.state = "draft";
            },
        },
        {
            elapsedMs: 15,
            inputTokens: 10000,
            outputTokens: 4000,
            safetyTokens: 1,
            chatAttempts: 10,
            reservedTokens: 100000,
            embeddingAttempts: 10,
            tokenizer: "offline",
            countTokens: (text) => text.length,
        },
    );
    runner.start(job);
    for (let attempt = 0; attempt < 100 && job.state === "running"; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10));
    expect(job.state).toBe("partial");
    expect(job.results.map((result) => result.state)).toEqual([
        "failed",
        "draft",
    ]);
    expect(job.results[0].reason).toContain("exceeded");
    await runner.close();
});

test("forgetting read-but-not-cited nominated evidence cancels a late distinct result", async () => {
    const snapshot = input();
    const job: ViewBuildJob = {
        jobId: "influence-job",
        corpusId: "corpus",
        fingerprint: "job",
        actor: "test",
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
        request: { corpusId: "corpus", expectedHead: null, targets: [] },
        state: "running",
        publication: false,
        results: [
            {
                viewId: "candidate",
                state: "pending",
                reason: "Admitted",
                snapshot,
            },
        ],
        maintenancePlan: {
            corpusId: "corpus",
            expectedHead: null,
            targets: [],
        },
    };
    const contexts = nominateWikiPages(snapshot, [page()], new Map());
    contexts[0].contributingSources.push({
        sourceId: "read-only-context",
        revisionId: "read-revision",
    });
    let release!: (value: WikiSubjectAssessment) => void;
    let entered!: () => void;
    const assessed = new Promise<void>((resolve) => {
        entered = resolve;
    });
    const response = new Promise<WikiSubjectAssessment>((resolve) => {
        release = resolve;
    });
    const materialize = import.meta.jest.fn(async () => {});
    const generate = import.meta.jest.fn(async () =>
        hydrateInformational(snapshot, {
            summary: "Grounded reference summary.",
            status: "partial",
            title: "Late result",
            prose: snapshot.inputs[0].content,
            limits: "Selected",
            citationIds: ["f0"],
        }),
    );
    const runner = new ViewBuildRunner(
        {
            identity: "offline",
            assessWikiSubject: async () => {
                entered();
                return response;
            },
            generate,
            validate: async () => {
                throw new Error("No universal informational check");
            },
        },
        {
            current: async () => undefined,
            wikiPages: async () => contexts,
            recordWikiAssessment: async () => {},
            update: async (_corpusId, _jobId, update) => {
                update(job);
                return job;
            },
            materialize,
        },
    );
    runner.start(job);
    await assessed;
    runner.forget("corpus", "read-only-context");
    release({
        ...covered(),
        disposition: "distinct",
        canonicalViewId: "",
        sharedFragmentIds: [],
        essentialDistinctions: [],
    });
    await runner.close();
    expect(generate).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
});

test("sequential admission skips covered or low-value first pages and blocks invalid output without losing dependencies", async () => {
    for (const scenario of ["covered", "invalid", "first-defer"]) {
        const invalid = scenario === "invalid";
        const deferred = scenario === "first-defer";
        const snapshot = input();
        const originalInfluence = {
            sourceId: "original-context",
            revisionId: "original-revision",
        };
        snapshot.influenceSources = [originalInfluence];
        const canonical = page();
        const contexts = deferred
            ? []
            : nominateWikiPages(snapshot, [canonical], new Map());
        let generated = 0;
        const job: ViewBuildJob = {
            jobId: "job",
            corpusId: "corpus",
            fingerprint: "job",
            actor: "test",
            createdAt: "2026-10-11T00:00:00Z",
            updatedAt: "2026-10-11T00:00:00Z",
            request: {
                corpusId: "corpus",
                expectedHead: null,
                targets: [
                    { definition: snapshot.definition, expectedVersion: 0 },
                ],
            },
            state: "running",
            publication: false,
            results: [
                {
                    viewId: "candidate",
                    snapshot,
                    state: "pending",
                    reason: "Admitted",
                },
            ],
            maintenancePlan: {
                corpusId: "corpus",
                expectedHead: null,
                targets: [],
            },
        };
        const runner = new ViewBuildRunner(
            {
                identity: "offline",
                assessWikiSubject: async (current, pages) => {
                    expect(current.influenceSources).toContainEqual(
                        originalInfluence,
                    );
                    expect(pages).toEqual(contexts);
                    if (deferred)
                        return {
                            ...covered(),
                            disposition: "defer",
                            canonicalViewId: "",
                            sharedFragmentIds: [],
                            essentialDistinctions: [],
                        };
                    return invalid
                        ? { ...covered(), canonicalViewId: "invented" }
                        : covered();
                },
                generate: async () => {
                    generated++;
                    throw new Error("Redundant synthesis must not run");
                },
                validate: async () => {
                    throw new Error("Legacy validation must not run");
                },
            },
            {
                current: async () => undefined,
                wikiPages: async () => contexts,
                recordWikiAssessment: async (_job, result, assessment) => {
                    result.state = "skipped";
                    result.reason = assessment.reason;
                    result.wikiAssessment = {
                        ...assessment,
                        ...(!deferred && {
                            canonicalRevisionId: canonical.revisionId,
                        }),
                    };
                },
                update: async (_corpusId, _jobId, update) => {
                    update(job);
                    return job;
                },
                materialize: async () => {
                    throw new Error("No record may be materialized");
                },
            },
        );
        runner.start(job);
        for (
            let attempt = 0;
            job.state === "running" && attempt < 100;
            attempt++
        )
            await new Promise((resolve) => setImmediate(resolve));
        await runner.close();
        expect(generated).toBe(0);
        expect(job.results[0].state).toBe(invalid ? "blocked" : "skipped");
        expect(job.state).toBe(invalid ? "failed" : "complete");
        if (!invalid && !deferred) {
            expect(
                reusableWikiAssessment(job.results[0], snapshot, canonical),
            ).toBe(true);
            expect(
                reusableWikiAssessment(
                    job.results[0],
                    { ...snapshot, expectedVersion: 1 },
                    canonical,
                ),
            ).toBe(false);
            expect(
                reusableWikiAssessment(job.results[0], snapshot, {
                    ...canonical,
                    revisionId: "changed",
                }),
            ).toBe(false);
            expect(
                reusableWikiAssessment(
                    job.results[0],
                    { ...snapshot, model: "new-prompt" },
                    canonical,
                ),
            ).toBe(false);
        }
    }
});

test("automatic family compares earlier same-job page, persists skip and replays zero-model on unchanged cold restart", async () => {
    class PurposeIndex extends FakeSemanticCorpusIndex {
        async listSubjects(offset: number) {
            return {
                total: 2,
                items: offset
                    ? []
                    : ["cache propagation", "review remains open"].map(
                          (term) => ({
                              term,
                              postingCount: 1,
                              sourceIds: ["source"],
                          }),
                      ),
            };
        }
        override async getKnowledgeGraph() {
            return {
                entities: [],
                relationships: [],
                topics: [
                    {
                        name: "cache propagation",
                        sourceIds: ["source"],
                        mentionCount: 1,
                    },
                    {
                        name: "review remains open",
                        sourceIds: ["source"],
                        mentionCount: 1,
                    },
                ],
            };
        }
        async readFragments(_request: IndexedFragmentRequest) {
            const document = this.documents[0];
            if (!document) throw new Error("Offline indexed document missing");
            return {
                fragments: [
                    {
                        sourceId: document.source.sourceId,
                        revisionId: document.revision.revisionId,
                        snippet: document.content,
                        locator: `indexed:0:${document.revision.contentHash}:0-${document.content.length}`,
                        score: 1,
                    },
                ],
                readChars: document.content.length,
                limited: false,
            };
        }
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-purpose-family-"));
    let generated = 0;
    let assessed = 0;
    const adapter = {
        identity: "offline-family-purpose",
        assessWikiSubject: async (
            _input: ViewBuildSnapshot,
            pages: ReturnType<typeof nominateWikiPages>,
        ): Promise<WikiSubjectAssessment> => {
            if (!pages.length)
                return {
                    disposition: "distinct",
                    purpose: "Cache propagation reference",
                    reason: "Substantive scoped explanation",
                    canonicalViewId: "",
                    sharedFragmentIds: [],
                    essentialDistinctions: [],
                    ambiguousViewIds: [],
                };
            assessed++;
            expect(pages).toHaveLength(1);
            expect(pages[0].query).toBe("cache propagation");
            expect(pages[0].prose).toContain("review remains open");
            return {
                ...covered(),
                canonicalViewId: pages[0].viewId,
                sharedFragmentIds: pages[0].sharedFragmentIds,
                essentialDistinctions: [
                    {
                        fragmentId: "f0",
                        statement: "Cache propagation and open review",
                        canonicalExcerpt: pages[0].prose,
                    },
                ],
            };
        },
        generate: async (snapshot: ViewBuildSnapshot) => {
            generated++;
            return hydrateInformational(snapshot, {
                summary: "Grounded reference summary.",
                status: "partial",
                title: "Cache propagation",
                prose: snapshot.inputs[0].content,
                limits: "Selected evidence, unknown rollout",
                citationIds: ["f0"],
            });
        },
        validate: async () => {
            throw new Error("Legacy validation must not run");
        },
    };
    const open = () =>
        new FileMemoryService(root, {
            indexFactory: (_id, directory) => new PurposeIndex(directory),
            eventIndexFactory: (_id, directory) =>
                new FakeSemanticCorpusIndex(directory),
            viewSynthesisAdapter: adapter,
        });
    let service = open();
    try {
        const { corpusId } = await service.createCorpus(
            "Offline purpose comparison",
        );
        for (const family of ["wiki", "projects"] as const) {
            await service.maintainViews({
                corpusId,
                expectedHead: (await service.listViews(corpusId)).head,
                family,
                operation: "pause",
            });
        }
        const ingestion = await service.ingestDocument({
            corpusId,
            source: {
                sourceId: "source",
                sourceType: "text",
                title: "Local cache",
                text: "Cache propagation describes verifier metadata refresh across replicas. The review remains open because the stale-cache counterexample limits rollout; it is a qualification of cache propagation.",
            },
        });
        expect((await waitForMemoryJob(service, ingestion.jobId)).state).toBe(
            "complete",
        );
        const resumed = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "resume",
        });
        expect(resumed.job?.results).toHaveLength(2);
        let current = resumed.job!;
        for (let i = 0; current.state === "running" && i < 300; i++) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            current = (await service.getViewBuild({
                corpusId,
                jobId: current.jobId,
            }))!;
        }
        expect(
            current.results.map((result) => [result.state, result.reason]),
        ).toEqual([
            [
                "draft",
                "Validated draft saved; no publication, review or execution authority",
            ],
            [
                "skipped",
                expect.stringContaining(
                    "Standalone purpose already covered by",
                ),
            ],
        ]);
        expect(current.state).toBe("complete");
        expect((await service.listViews(corpusId)).views).toHaveLength(1);
        expect(generated).toBe(1);
        expect(assessed).toBe(1);
        await service.close();
        service = open();
        const update = await service.maintainViews({
            corpusId,
            expectedHead: (await service.listViews(corpusId)).head,
            family: "wiki",
            operation: "update",
        });
        expect(update.job).toBeUndefined();
        expect(generated).toBe(1);
        expect(assessed).toBe(1);
        expect((await service.listViews(corpusId)).wikiFamily?.pending).toBe(
            false,
        );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
