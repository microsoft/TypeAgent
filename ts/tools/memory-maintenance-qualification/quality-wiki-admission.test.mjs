// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    mkdtemp,
    mkdir,
    writeFile,
    readFile,
    rm,
    symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    wikiTrialSchedule,
    decisionAgreement,
    pairedWikiResults,
    stablePageOverlap,
    wikiJudgePacket,
    validateWikiJudgment,
    summarizeWikiComparison,
    macroWikiQuality,
    pairedAssessmentLatency,
    latencyDistribution,
} from "./wiki-admission-evaluation.mjs";
import {
    hashStore,
    selectedWikiConstruction,
    wikiAdmissionCases,
    freezeWikiSeeds,
    cloneWikiSeed,
    sourceProbe,
} from "./wiki-admission-seeds.mjs";
import {
    boundedJudge,
    assertIndependentWikiJudge,
    validateLedgerCoverage,
    buildWikiQualityLedger,
    runWikiJudges,
} from "./wiki-admission-judge.mjs";
import { digest } from "./longmemeval-runner.mjs";
import {
    assertPrivateArtifactDirectory,
    validateWikiExperimentSpec,
    replayWikiAssessments,
    runWikiTrial,
    runWikiExperiment,
    experimentCheckpoint,
    warmWikiModels,
} from "./wiki-admission-experiment.mjs";
import { FileMemoryService } from "../../packages/memory/service/dist/index.js";
import { FakeSemanticCorpusIndex } from "../../packages/memory/service/dist/test/fakeSemanticCorpusIndex.js";
import { isGpt6ChatModel } from "../../packages/aiclient/dist/index.js";

const signal = () => new AbortController().signal;
async function temporary(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "wiki-admission-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

function preparedHistories() {
    return {
        manifest: { datasetHash: "synthetic-structural-regression-only" },
        construction: wikiAdmissionCases.map(({ id, sessions }) => ({
            id,
            cutoff: "2026-01-01",
            sessions: Array.from({ length: sessions }, (_, position) => ({
                id: `session-${position}`,
                position,
                date: "2025-01-01T00:00:00Z",
                turns: [
                    {
                        role: "user",
                        content:
                            "Copper alloys retain their stated qualifications.",
                    },
                ],
            })),
        })),
        readerOnly: { questions: ["QUESTION MUST NOT REACH SOURCE SEEDS"] },
        evaluatorOnly: { references: ["GOLD MUST NOT REACH SOURCE SEEDS"] },
    };
}

class ProbeIndex extends FakeSemanticCorpusIndex {
    async resolveIndexedLocator(sourceId, revisionId, locator) {
        const document = this.documents.find(
            (item) =>
                item.source.sourceId === sourceId &&
                item.revision.revisionId === revisionId,
        );
        assert.ok(
            document &&
                locator.startsWith(
                    `indexed:0:${document.revision.contentHash}:`,
                ),
        );
        return document.content;
    }
    async listSubjects() {
        return { total: 0, items: [] };
    }
    async readFragments() {
        return {
            limited: false,
            readChars: this.documents.reduce((n, d) => n + d.content.length, 0),
            fragments: this.documents.slice(0, 10).map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                snippet: document.content,
                score: 1,
                locator: `indexed:0:${document.revision.contentHash}:0-${document.content.length}`,
            })),
        };
    }
}

test("full five-history selection has 238 sessions and cannot substitute partial/gold histories", () => {
    const prepared = preparedHistories();
    const selection = { questionIds: wikiAdmissionCases.map(({ id }) => id) };
    const selected = selectedWikiConstruction(prepared, selection);
    assert.equal(
        selected.reduce((n, row) => n + row.sessions.length, 0),
        238,
    );
    assert.ok(!JSON.stringify(selected).includes("MUST NOT REACH"));
    prepared.construction[0].sessions.pop();
    assert.throws(
        () => selectedWikiConstruction(prepared, selection),
        /Incomplete history/,
    );
    assert.throws(
        () =>
            selectedWikiConstruction(preparedHistories(), {
                questionIds: ["4f54b7c9"],
            }),
        /Historical selection/,
    );
});

test("explicit preparation scope preserves full-input validation and rejects unknown/duplicate cases", () => {
    const prepared = preparedHistories();
    const selection = { questionIds: wikiAdmissionCases.map(({ id }) => id) };
    const cases = ["4f54b7c9", "d24813b1"];
    const selected = selectedWikiConstruction(prepared, selection, cases);
    assert.equal(
        selected.reduce((count, row) => count + row.sessions.length, 0),
        89,
    );
    for (const invalid of [[], ["unknown"], ["d24813b1", "d24813b1"]])
        assert.throws(
            () => selectedWikiConstruction(prepared, selection, invalid),
            /Preparation cases/,
        );
    prepared.construction[4].sessions.pop();
    assert.throws(
        () => selectedWikiConstruction(prepared, selection, cases),
        /Incomplete history/,
    );
});

test("real host freezes source-only synthetic seeds, cold-reopens exact copies and detects corruption", async (t) => {
    const root = await temporary(t);
    const modes = [];
    const runtime = {
        configuration: {
            synthetic: true,
            writer: [{ endpointHash: digest("https://writer.invalid") }],
            ambiguityResolver: [],
        },
        checkpoint: { fixture: "synthetic" },
        role() {},
        client: {
            isGpt6ChatModel,
            openai: {
                hasChatModelEndpoint: () => true,
                createChatModel: () => ({}),
                getChatModelPool: (endpoint) => ({
                    members: [
                        {
                            settings: {
                                provider: "azure",
                                modelType: "chat",
                                modelName: "gpt-6-luna",
                                endpoint:
                                    endpoint === "synthetic"
                                        ? "https://judge.invalid"
                                        : "https://writer.invalid",
                            },
                        },
                    ],
                }),
            },
        },
        open(directory, options) {
            modes.push(options.maintenanceMode);
            return new FileMemoryService(directory, {
                ...options,
                indexFactory: (_id, folder) => new ProbeIndex(folder),
                eventIndexFactory: (_id, folder) =>
                    new FakeSemanticCorpusIndex(folder),
                viewSynthesisAdapter: {
                    identity: "synthetic-structural-only",
                    generate: async () => {
                        throw new Error("No synthetic subjects are present");
                    },
                    validate: async () => {
                        throw new Error("No synthetic subjects are present");
                    },
                },
            });
        },
    };
    const manifest = await freezeWikiSeeds(
        root,
        preparedHistories(),
        { questionIds: wikiAdmissionCases.map(({ id }) => id) },
        runtime,
        signal(),
    );
    assert.equal(manifest.status, "frozen");
    assert.equal(manifest.cases.length, 5);
    assert.equal(modes.filter((mode) => mode === "manual").length, 5);
    assert.ok(!JSON.stringify(manifest).includes("MUST NOT REACH"));
    const seed = manifest.cases[0];
    const recoveredDirectory = path.join(root, "recovered-preparation");
    await mkdir(recoveredDirectory);
    const recoveredManifest = await freezeWikiSeeds(
        recoveredDirectory,
        preparedHistories(),
        { questionIds: wikiAdmissionCases.map(({ id }) => id) },
        runtime,
        signal(),
        { directory: root, manifest },
        ["d24813b1", "4f54b7c9"],
    );
    assert.equal(recoveredManifest.status, "frozen");
    assert.equal(recoveredManifest.cases.length, 2);
    assert.deepEqual(recoveredManifest.questionIds, ["d24813b1", "4f54b7c9"]);
    assert.equal(recoveredManifest.validatedSelectionQuestionIds.length, 5);
    assert.ok(
        recoveredManifest.cases.every(
            (entry) => entry.recoveredPreparationMs >= 0,
        ),
    );
    await assert.rejects(
        freezeWikiSeeds(
            path.join(root, "bad-product-recovery"),
            preparedHistories(),
            { questionIds: wikiAdmissionCases.map(({ id }) => id) },
            {
                ...runtime,
                checkpoint: { "changed.js": "different-production" },
            },
            signal(),
            { directory: root, manifest },
            ["d24813b1"],
        ),
        /production implementation changed/,
    );
    const existingEmpty = path.join(root, "existing-empty");
    await mkdir(existingEmpty);
    await assert.rejects(
        cloneWikiSeed(root, seed, existingEmpty, runtime),
        /destination already exists/,
    );
    const trialRoot = path.join(root, "trial");
    await mkdir(trialRoot);
    const trial = { id: seed.id, arm: "G0", repetition: 0 };
    await runWikiTrial(
        {
            seeds: root,
            runDirectory: trialRoot,
            judgeEndpoint: "synthetic",
            scope: "wiki",
            readinessMs: 10000,
        },
        runtime,
        seed,
        trial,
        {},
        signal(),
        async () => {},
    );
    assert.equal(trial.status, "complete");
    assert.ok(trial.readinessMs >= 0);
    assert.deepEqual(trial.pages, []);
    let failedCloneClosed = false;
    await assert.rejects(
        cloneWikiSeed(root, seed, path.join(root, "failed-reopen"), {
            open: () => ({
                deferMaintenance: () => () => {},
                initialize: async () => {
                    throw new Error("Controlled reopen failure");
                },
                close: async () => {
                    failedCloneClosed = true;
                },
            }),
        }),
        /Controlled reopen failure/,
    );
    assert.equal(failedCloneClosed, true);
    const opened = await cloneWikiSeed(
        root,
        seed,
        path.join(root, "independent"),
        runtime,
    );
    await opened.service.close();
    await assert.rejects(
        cloneWikiSeed(root, seed, path.join(root, "independent"), runtime),
        /exist|EEXIST/,
    );
    const file = path.join(
        root,
        "cases",
        seed.id,
        "store",
        Object.keys(seed.files)[0],
    );
    await writeFile(file, "corruption");
    await assert.rejects(
        cloneWikiSeed(root, seed, path.join(root, "corrupt-clone"), runtime),
        /Frozen seed store changed/,
    );
});

test("seed hashing rejects links and reflects actual persisted bytes", async (t) => {
    const root = await temporary(t);
    const target = path.join(root, "target"),
        store = path.join(root, "store");
    await mkdir(target);
    await mkdir(store);
    await writeFile(path.join(store, "source.json"), "{}");
    const before = await hashStore(store);
    await writeFile(path.join(store, "source.json"), '{"changed":true}');
    assert.notDeepEqual(await hashStore(store), before);
    await symlink(
        target,
        path.join(store, "linked"),
        process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(hashStore(store), /links/);
});

test("cold-reopen probes resolve retained indexed anchors, not a second nondeterministic ranked search", async () => {
    let searches = 0;
    let text = "Exact original indexed content";
    const service = {
        search: async () => {
            searches++;
            assert.equal(
                searches,
                1,
                "Do not reinterpret the query for an invariance check",
            );
            return {
                matches: [
                    {
                        sourceId: "source",
                        revisionId: "r1",
                        locator: "indexed:0:hash:0-29",
                        snippet: "UI snippet, not the excerpt field",
                    },
                ],
            };
        },
        getSourceContent: async () => ({ content: text, truncated: false }),
    };
    const original = await sourceProbe(service, "corpus", "query");
    assert.deepEqual(
        await sourceProbe(service, "corpus", "query", original),
        original,
    );
    assert.equal(searches, 1);
    text = "Changed evidence";
    assert.notDeepEqual(
        await sourceProbe(service, "corpus", "query", original),
        original,
    );
});

test("artifact roots exclude any Git checkout, including .git worktree files", async (t) => {
    const root = await temporary(t);
    await assertPrivateArtifactDirectory(path.join(root, "private", "new"));
    await writeFile(path.join(root, ".git"), "gitdir: other");
    await assert.rejects(
        assertPrivateArtifactDirectory(path.join(root, "raw", "new")),
        /outside every Git/,
    );
});

test("balanced trial order uses monotonically increasing ordinals across rotations", () => {
    const plan = wikiTrialSchedule(["a", "b"], 6);
    assert.equal(plan.length, 36);
    assert.deepEqual(
        plan.map((row) => row.ordinal),
        Array.from({ length: 36 }, (_, i) => i),
    );
    for (const id of ["a", "b"])
        for (const arm of ["G0", "G1", "D1"])
            assert.equal(
                plan.filter((row) => row.id === id && row.arm === arm).length,
                6,
            );
    assert.throws(() => wikiTrialSchedule(["a"], 0));
});

test("case-counterbalanced pilots reverse paired arm order without changing the default", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const firstArms = (plan) =>
        ids.map((id) => plan.find((row) => row.id === id).arm);
    const paired = wikiTrialSchedule(ids, 1, true).filter(
        ({ arm }) => arm !== "G1",
    );
    assert.deepEqual(firstArms(paired), ["G0", "D1", "G0", "D1", "G0"]);
    assert.deepEqual(
        firstArms(wikiTrialSchedule(ids, 1)),
        ids.map(() => "G0"),
    );
    const repeated = wikiTrialSchedule(ids, 2, true);
    assert.deepEqual(
        repeated.map(({ ordinal }) => ordinal),
        Array.from({ length: 30 }, (_, ordinal) => ordinal),
    );
    assert.deepEqual(
        firstArms(repeated.filter(({ repetition }) => repetition === 1)),
        ["D1", "G0", "D1", "G0", "D1"],
    );
    assert.throws(() => wikiTrialSchedule(ids, 1, "true"));
});

const receipt = (arm, disposition, extra = {}) => ({
    arm,
    requestHash: "same-input",
    outcome: "returned",
    durationMs: 20,
    assessment: { disposition, canonicalViewId: "" },
    ...extra,
});

test("agreement is not accuracy; failed calls and missing paired readiness are not wins", () => {
    const receipts = [
        receipt("G0", "distinct"),
        receipt("G1", "distinct"),
        receipt("D1", "defer"),
        receipt("D1", "defer", { outcome: "failed" }),
    ];
    const report = decisionAgreement(receipts);
    assert.equal(report.G1.agreement, 1);
    assert.equal(report.D1.agreement, 0);
    assert.equal(report.D1.failed, 1);
    assert.equal(Object.keys(report.D1.matrix).length, 25);
    assert.equal(report.D1.targetMatched, 0);
    assert.equal(report.D1.correctnessBasis, "G0-agreement-only");
    const annotated = decisionAgreement(receipts, {
        adjudicated: true,
        reviewerIds: ["first", "second"],
        items: [
            {
                requestHash: "same-input",
                disposition: "defer",
                deferBasis: "evidence",
                canonicalViewId: "",
            },
        ],
    });
    assert.equal(annotated.D1.agreement, 1);
    assert.equal(annotated.D1.correctnessBasis, "independently-adjudicated");
    assert.equal(annotated.D1.macroF1, 1);
    assert.throws(
        () => decisionAgreement(receipts, { adjudicated: true }),
        /reviewers/,
    );
    const paired = pairedWikiResults([
        {
            arm: "G0",
            id: "a",
            repetition: 0,
            status: "complete",
            readinessMs: 100,
        },
        {
            arm: "D1",
            id: "a",
            repetition: 0,
            status: "failed",
            readinessMs: 20,
        },
    ]);
    assert.equal(paired[1].pairs[0].successfulReadinessDeltaMs, null);
    assert.equal(paired[1].medianSuccessfulReadinessDeltaMs, null);
    assert.equal(
        stablePageOverlap([{ viewId: "a" }], [{ viewId: "b" }]).jaccard,
        0,
    );
    const latency = pairedAssessmentLatency([
        receipt("G0", "distinct", { durationMs: 100 }),
        receipt("D1", "distinct", { durationMs: 60 }),
        receipt("G0", "distinct", { requestHash: "second", durationMs: 200 }),
        receipt("D1", "distinct", { requestHash: "second", durationMs: 100 }),
    ]);
    assert.equal(latency[1].medianDeltaMs, -70);
    assert.equal(latency[1].medianReduction, 0.45);
    assert.deepEqual(
        latencyDistribution(Array.from({ length: 20 }, (_, i) => i + 1)),
        { count: 20, p50Ms: 10.5, p95Ms: 19 },
    );
});

function page(viewId = "page") {
    return {
        viewId,
        definition: { wiki: { query: "Copper alloys", aliases: [] } },
        content: {
            title: "Copper",
            summary: "Copper alloys retain qualifications.",
            sections: [
                {
                    heading: "Facts",
                    body: "A proposal is not an implemented change.",
                },
            ],
        },
        generation: {
            input: {
                inputs: [
                    {
                        passages: [
                            {
                                sourceId: "original",
                                revisionId: "r1",
                                locator: "indexed:0",
                                excerpt:
                                    "A proposal is not an implemented change.",
                            },
                        ],
                    },
                ],
            },
        },
    };
}
function judgment(left = ["page"], right = ["other"]) {
    const scores = Object.fromEntries(
        [
            "usefulness",
            "support",
            "completeness",
            "scope",
            "qualifications",
            "citations",
        ].map((key) => [key, 4]),
    );
    return {
        winner: "A",
        scores: { A: { ...scores }, B: { ...scores } },
        pageScores: {
            A: left.map((pageId) => ({ pageId, scores: { ...scores } })),
            B: right.map((pageId) => ({ pageId, scores: { ...scores } })),
        },
        matches: [],
        defects: [],
        coverage: [
            {
                factId: "f0",
                A: "covered",
                B: "missing",
                AQuote: "A proposal is not an implemented change.",
                BQuote: "",
            },
        ],
    };
}

test("empty Wikis remain judgeable against original sources and every independent fact", () => {
    const original = [
        { sourceKey: "s0", text: "A proposal is not an implemented change." },
    ];
    const packet = wikiJudgePacket([page()], [], false, original);
    const ledger = { facts: [{ id: "f0", critical: true }] };
    const value = judgment(["page"], []);
    validateWikiJudgment(value, packet);
    validateLedgerCoverage(value, packet, ledger);
    const reversed = judgment([], ["page"]);
    reversed.winner = "B";
    reversed.coverage = [
        {
            factId: "f0",
            A: "missing",
            B: "covered",
            BQuote: "A proposal is not an implemented change.",
            AQuote: "",
        },
    ];
    const summary = summarizeWikiComparison(
        {
            judgments: [
                { reversed: false, judgment: value },
                { reversed: true, judgment: reversed },
            ],
        },
        ledger,
        [page()],
        [],
    );
    assert.equal(summary.orders[0].candidateCoverage.criticalMissing, 1);
    assert.equal(summary.orders[0].semanticPurposeRecall, 0);
    assert.equal(summary.orderWinnerAgreement, true);
    assert.equal(wikiJudgePacket([], [], false, original).evidence.length, 1);
    assert.deepEqual(wikiJudgePacket([page()], [], true, original).sides.A, []);
    assert.equal(
        macroWikiQuality([{ id: "a", arm: "D1", summary }])[1].histories.length,
        1,
    );
});

test("failed snapshots require explicit per-arm diagnostic judging and retain readiness failures", async (t) => {
    const root = await temporary(t);
    const text = "A proposal is not an implemented change.";
    const seeds = {
        cases: [
            {
                id: "selected",
                construction: {
                    id: "selected",
                    sessions: [
                        {
                            id: "source",
                            position: 0,
                            date: "2026-01-01",
                            turns: [{ role: "user", content: text }],
                        },
                    ],
                },
            },
            {
                id: "blocked",
                construction: {
                    id: "blocked",
                    sessions: [
                        {
                            id: "blocked-source",
                            position: 0,
                            date: "2026-01-01",
                            turns: [{ role: "user", content: "FILTER_CASE" }],
                        },
                    ],
                },
            },
            { id: "excluded", construction: null },
        ],
    };
    const campaign = {
        seedsHash: digest(JSON.stringify(seeds)),
        configuration: { writer: [{ endpointHash: "writer-only" }] },
        trials: [
            {
                id: "selected",
                arm: "G0",
                repetition: 0,
                status: "complete",
                directory: "baseline",
            },
            {
                id: "selected",
                arm: "D1",
                repetition: 0,
                status: "failed",
                directory: "candidate",
            },
            {
                id: "excluded",
                arm: "G0",
                repetition: 0,
                status: "complete",
                directory: "does-not-exist",
            },
            {
                id: "excluded",
                arm: "D1",
                repetition: 0,
                status: "failed",
                directory: "does-not-exist",
            },
        ],
    };
    await writeFile(path.join(root, "seeds.json"), JSON.stringify(seeds));
    const campaignFile = path.join(root, "campaign.json");
    await writeFile(campaignFile, JSON.stringify(campaign));
    for (const directory of ["baseline", "candidate"]) {
        await mkdir(path.join(root, directory));
        await writeFile(
            path.join(root, directory, "snapshot.json"),
            '{"views":[]}',
        );
    }
    let judgmentCalls = 0;
    const runtime = {
        role() {},
        currentRole: () => "synthetic-quality",
        client: {
            isGpt6ChatModel,
            openai: {
                hasChatModelEndpoint: () => true,
                getChatModelPool: () => ({
                    members: [
                        {
                            settings: {
                                provider: "azure",
                                modelType: "chat",
                                modelName: "gpt-6-luna",
                                endpoint: "synthetic-judge",
                            },
                        },
                    ],
                }),
                createChatModel: () => ({
                    inspectRequest: () => ({
                        constraints: {
                            metadata: "configured",
                            declaredLimits: { inputTokens: 100000 },
                        },
                    }),
                    async complete(messages) {
                        const packet = JSON.parse(messages[1].content);
                        if (packet.source?.text.includes("FILTER_CASE"))
                            return {
                                success: false,
                                message:
                                    "Model response blocked by content filter",
                            };
                        if (packet.source)
                            return {
                                success: true,
                                data: JSON.stringify({
                                    facts: [
                                        {
                                            statement: text,
                                            witnessId: "p1",
                                            critical: true,
                                        },
                                    ],
                                }),
                            };
                        judgmentCalls++;
                        const value = judgment([], []);
                        value.winner = "tie";
                        value.coverage = [
                            {
                                factId: "fact0",
                                A: "missing",
                                B: "missing",
                                AQuote: "",
                                BQuote: "",
                            },
                        ];
                        return { success: true, data: JSON.stringify(value) };
                    },
                }),
            },
        },
    };
    const spec = {
        campaign: campaignFile,
        seeds: root,
        runDirectory: root,
        judgeEndpoint: "synthetic",
        caseIds: ["selected"],
    };
    const excluded = await runWikiJudges(spec, runtime, signal());
    assert.equal(excluded.status, "no-complete-pairs");
    assert.equal(judgmentCalls, 0);
    const diagnostic = await runWikiJudges(
        { ...spec, includeFailedCandidates: true },
        runtime,
        signal(),
    );
    assert.equal(judgmentCalls, 2);
    assert.equal(diagnostic.ledgers.length, 1);
    assert.equal(diagnostic.comparisons[0].candidateStatus, "failed");
    assert.equal(diagnostic.comparisons[0].readinessComparable, false);
    assert.equal(diagnostic.qualityQualified, false);
    const partial = await runWikiJudges(
        {
            ...spec,
            caseIds: ["blocked", "selected"],
            includeFailedCandidates: true,
        },
        runtime,
        signal(),
    );
    assert.equal(partial.status, "completed-with-failures");
    assert.equal(partial.failures[0].id, "blocked");
    assert.match(partial.failures[0].message, /content filter/);
    assert.equal(partial.comparisons.length, 1);
    assert.equal(partial.ledgers.length, 1);
    campaign.trials[0].status = "failed";
    await writeFile(campaignFile, JSON.stringify(campaign));
    const failedBaselineExcluded = await runWikiJudges(
        { ...spec, includeFailedCandidates: true },
        runtime,
        signal(),
    );
    assert.equal(failedBaselineExcluded.status, "no-complete-pairs");
    const bothFailed = await runWikiJudges(
        {
            ...spec,
            includeFailedCandidates: true,
            includeFailedBaselines: true,
        },
        runtime,
        signal(),
    );
    assert.equal(bothFailed.comparisons[0].baselineStatus, "failed");
    assert.equal(bothFailed.comparisons[0].candidateStatus, "failed");
    assert.equal(bothFailed.comparisons[0].readinessComparable, false);
    campaign.trials[1].status = "complete";
    await writeFile(campaignFile, JSON.stringify(campaign));
    const failedControl = await runWikiJudges(
        { ...spec, includeFailedBaselines: true },
        runtime,
        signal(),
    );
    assert.equal(failedControl.comparisons[0].candidateStatus, "complete");
    assert.equal(failedControl.comparisons[0].readinessComparable, false);
    assert.equal(failedControl.qualityQualified, false);
    campaign.configuration.ambiguityResolver = [
        { endpointHash: digest("synthetic-judge") },
    ];
    await writeFile(campaignFile, JSON.stringify(campaign));
    const callsBefore = judgmentCalls;
    await assert.rejects(
        runWikiJudges(
            { ...spec, includeFailedBaselines: true },
            runtime,
            signal(),
        ),
        /disjoint from the Wiki writer and ambiguity resolver pools/,
    );
    assert.equal(judgmentCalls, callsBefore);
});

test("blind judgments reject invented citations, unknown pages, false coverage and missing audits", () => {
    const packet = wikiJudgePacket([page()], [page("other")]);
    const value = judgment();
    value.defects.push({
        side: "A",
        pageId: "page",
        evidenceId: "e0",
        critical: true,
        sourceQuote: "Invented",
        proseQuote: "A proposal",
        reason: "Changed status",
    });
    assert.throws(
        () => validateWikiJudgment(value, packet),
        /original-source quote/,
    );
    value.defects[0].sourceQuote = "A proposal";
    validateWikiJudgment(value, packet);
    value.matches.push({ A: "unknown", B: "other" });
    assert.throws(
        () => validateWikiJudgment(value, packet),
        /Unknown semantic/,
    );
    const ledger = { facts: [{ id: "f0", critical: true }] };
    value.coverage[0].AQuote = "Invented coverage";
    assert.throws(
        () => validateLedgerCoverage(value, packet, ledger),
        /actual page prose/,
    );
    value.coverage = [];
    assert.throws(
        () => validateLedgerCoverage(value, packet, ledger),
        /Every independent fact/,
    );
});

test("judge complete-request preflight fails before provider invocation; ledger validates exact original quotes", async () => {
    let completed = 0;
    await assert.rejects(
        boundedJudge(
            {
                inspectRequest() {
                    throw new Error("context exceeds configured limit");
                },
                async complete() {
                    completed++;
                },
            },
            "instructions",
            {},
            {},
            signal(),
        ),
        /context exceeds/,
    );
    assert.equal(completed, 0);
    const model = {
        inspectRequest: () => ({
            constraints: {
                metadata: "configured",
                declaredLimits: { contextTokens: 200000 },
            },
        }),
        complete: async () => ({
            success: true,
            data: JSON.stringify({
                facts: [
                    {
                        statement: "Preserve qualifications",
                        witnessId: "p1",
                        critical: true,
                    },
                ],
            }),
        }),
    };
    const construction = {
        ...preparedHistories().construction[0],
        sessions: preparedHistories().construction[0].sessions.slice(0, 1),
    };
    const ledger = await buildWikiQualityLedger(construction, model, signal());
    assert.equal(ledger.facts.length, 1);
    assert.equal(
        ledger.facts[0].quote,
        "## Turn 1: user\nCopper alloys retain their stated qualifications.",
    );
    model.complete = async () => ({
        success: true,
        data: '{"facts":[{"statement":"invented","witnessId":"absent","critical":false}]}',
    });
    await assert.rejects(
        buildWikiQualityLedger(construction, model, signal()),
        /Unknown source witness/,
    );
    const captured = [];
    model.complete = async () => ({ success: true, data: "{rejected-json" });
    await assert.rejects(
        boundedJudge(
            model,
            "quality instructions",
            {},
            {},
            signal(),
            (trace) => {
                captured.push(trace);
            },
        ),
    );
    assert.equal(captured[0].response.data, "{rejected-json");
    assert.ok(captured[0].error);
});

test("source-bound repair preserves a compound fact with an exact contiguous multi-turn witness", async () => {
    const construction = structuredClone(preparedHistories().construction[0]);
    construction.sessions = construction.sessions.slice(0, 1);
    construction.sessions[0].turns = [
        { role: "user", content: "The alloy review remains provisional." },
        { role: "assistant", content: "Record every stated qualification." },
        { role: "user", content: "The review must retain unresolved scope." },
    ];
    let firstWitnessId = "p1";
    let lastWitnessId = "p3";
    let repairable = true;
    const model = {
        inspectRequest: () => ({
            constraints: {
                metadata: "configured",
                declaredLimits: { contextTokens: 200000 },
            },
        }),
        complete: async (messages) => {
            const packet = JSON.parse(messages[1].content);
            return {
                success: true,
                data: JSON.stringify(
                    packet.fact
                        ? {
                              repairable,
                              statement:
                                  "The provisional alloy review must retain unresolved scope.",
                              firstWitnessId,
                              lastWitnessId,
                          }
                        : {
                              facts: [
                                  {
                                      statement:
                                          "The provisional alloy review must retain unresolved scope.",
                                      witnessId: "p1",
                                  },
                              ],
                          },
                ),
            };
        },
    };
    const requests = [];
    const decisionModel = {
        async decide(request) {
            requests.push(request);
            const repaired = Object.keys(request.questions).some((key) =>
                key.endsWith("_repair_fidelity"),
            );
            return {
                success: true,
                data: {
                    answers: Object.fromEntries(
                        Object.keys(request.questions).map((id) => [
                            id,
                            {
                                type: "choice",
                                choice: id.endsWith("_support")
                                    ? repaired
                                        ? "supported"
                                        : "unsupported"
                                    : "yes",
                            },
                        ]),
                    ),
                },
            };
        },
    };
    const traces = [];
    const ledger = await buildWikiQualityLedger(
        construction,
        model,
        signal(),
        (trace) => traces.push(trace),
        decisionModel,
    );
    assert.equal(ledger.facts.length, 1);
    assert.equal(
        ledger.facts[0].quote,
        "## Turn 1: user\nThe alloy review remains provisional.\n\n" +
            "## Turn 2: assistant\nRecord every stated qualification.\n\n" +
            "## Turn 3: user\nThe review must retain unresolved scope.",
    );
    const state = JSON.parse(requests[1].state);
    assert.equal(state.facts[0].quote, ledger.facts[0].quote);
    assert.ok(
        state.originalSources[0].source.text.includes(ledger.facts[0].quote),
    );
    assert.equal(
        traces.filter((trace) => trace.artifactKind === "ledger-fact-repair")
            .length,
        1,
    );
    for (const scenario of [
        ["p3", "p1", true, /Reversed repaired source span/],
        ["missing", "p3", true, /Unknown repaired source witness/],
        ["p1", "p3", false, /requires independent review/],
    ]) {
        [firstWitnessId, lastWitnessId, repairable] = scenario;
        await assert.rejects(
            buildWikiQualityLedger(
                construction,
                model,
                signal(),
                undefined,
                decisionModel,
            ),
            scenario[3],
        );
    }
});

test("judge and writer endpoint pools must be fully disjoint, not just differently named", () => {
    const client = {
        isGpt6ChatModel,
        openai: {
            hasChatModelEndpoint: () => true,
            getChatModelPool: () => ({
                members: [
                    {
                        settings: {
                            provider: "azure",
                            modelType: "chat",
                            modelName: "gpt-6-luna",
                            endpoint: "https://shared.invalid",
                        },
                    },
                ],
            }),
        },
    };
    assert.throws(
        () => assertIndependentWikiJudge(client, "other-name"),
        /disjoint/,
    );
});

test("Wiki judging accepts GPT-6/6.1 on every member, not just a GPT-6-looking selector", () => {
    const luna = {
        provider: "azure",
        modelType: "chat",
        modelName: "gpt-6-luna",
        endpoint: "https://judge.invalid",
    };
    const client = {
        isGpt6ChatModel,
        openai: {
            hasChatModelEndpoint: () => true,
            getChatModelPool: () => ({ members: [{ settings: luna }] }),
        },
    };
    const writers = [digest("https://writer.invalid")];
    assert.doesNotThrow(() =>
        assertIndependentWikiJudge(client, "independent-luna", writers),
    );
    for (const settings of [
        { ...luna, modelName: "gpt-6-sol" },
        { ...luna, modelName: "gpt-6.1-terra" },
        { ...luna, modelName: "gpt-6.1-sol" },
        {
            ...luna,
            modelName: undefined,
            endpoint:
                "https://judge.invalid/openai/deployments/gpt-6.1-terra/chat/completions",
        },
    ]) {
        client.openai.getChatModelPool = () => ({
            members: [{ settings: luna }, { settings }],
        });

        assert.doesNotThrow(() =>
            assertIndependentWikiJudge(client, "gpt_6_1_terra", writers),
        );
    }
    for (const modelName of [
        "gpt-5.4-mini",
        "gpt-5.2",
        "gpt-4.1",
        "gpt-60-sol",
        "gpt-6.10-sol",
        "gpt-6.2-sol",
        undefined,
    ]) {
        client.openai.getChatModelPool = () => ({
            members: [{ settings: luna }, { settings: { ...luna, modelName } }],
        });
        assert.throws(
            () => assertIndependentWikiJudge(client, "gpt_6_luna", writers),
            /GPT-6 or GPT-6.1 on every endpoint/,
        );
    }
});

test("independent judging excludes ambiguity resolver deployments as well as writers", () => {
    const client = {
        isGpt6ChatModel,
        openai: {
            hasChatModelEndpoint: () => true,
            getChatModelPool: () => ({
                members: [
                    {
                        settings: {
                            provider: "azure",
                            modelType: "chat",
                            modelName: "gpt-6.1-terra",
                            endpoint: "https://resolver.invalid",
                        },
                    },
                ],
            }),
        },
    };
    assert.throws(
        () =>
            assertIndependentWikiJudge(client, "judge", [
                digest("https://writer.invalid"),
                digest("https://resolver.invalid"),
            ]),
        /disjoint/,
    );
});

test("spec requires explicit live authorization, real deadlines and mode inputs", () => {
    const spec = {
        command: "run",
        authorizedLiveBenchmark: true,
        scope: "full",
        repetitions: 3,
        readinessMs: 60000,
        workAllowanceMs: 180000,
        seeds: "seeds",
        judgeEndpoint: "judge",
    };
    validateWikiExperimentSpec(spec);
    validateWikiExperimentSpec({ ...spec, arms: ["G0", "D1"] });
    validateWikiExperimentSpec({ ...spec, caseIds: ["d24813b1"] });
    validateWikiExperimentSpec({
        ...spec,
        writerContract: "shared-prose-v1",
        d1Revision: "decision-first-v2",
    });
    assert.throws(
        () =>
            validateWikiExperimentSpec({
                ...spec,
                writerContract: "shared-prose-v1",
            }),
        /Shared prose/,
    );
    assert.throws(
        () =>
            validateWikiExperimentSpec({ ...spec, writerContract: "unknown" }),
        /Shared prose/,
    );
    for (const caseIds of [[], ["unknown"], ["d24813b1", "d24813b1"]])
        assert.throws(
            () => validateWikiExperimentSpec({ ...spec, caseIds }),
            /Cases/,
        );
    assert.throws(
        () => validateWikiExperimentSpec({ ...spec, readinessMs: 3600001 }),
        /60 minutes/,
    );
    assert.throws(
        () => validateWikiExperimentSpec({ ...spec, arms: ["D1", "D1"] }),
        /Arms/,
    );
    assert.throws(
        () => validateWikiExperimentSpec({ ...spec, arms: [] }),
        /Arms/,
    );
    assert.throws(
        () => validateWikiExperimentSpec({ ...spec, arms: ["D2"] }),
        /Arms/,
    );
    assert.throws(() =>
        validateWikiExperimentSpec({ ...spec, authorizedLiveBenchmark: false }),
    );
    assert.throws(
        () => validateWikiExperimentSpec({ ...spec, workAllowanceMs: 60000 }),
        /cleanup/,
    );
    assert.throws(
        () => validateWikiExperimentSpec({ ...spec, repetitions: Number.NaN }),
        /repetitions/,
    );
});

test("warm-ups use synthetic evidence, separate receipts and excluded provider roles", async (t) => {
    const root = await temporary(t),
        roles = [],
        packets = [];
    const runtime = {
        role: (role) => roles.push(role),
        memory: {
            createConfiguredViewSynthesisAdapter(
                _endpoint,
                _output,
                _model,
                _scheduler,
                options,
            ) {
                return {
                    async assessWikiSubject(input, pages) {
                        packets.push({ input, pages });
                        await options.onAssessment({
                            arm: options.arm,
                            outcome: "returned",
                        });
                    },
                };
            },
        },
    };
    await warmWikiModels({ runDirectory: root }, runtime, signal());
    assert.deepEqual(roles, [
        "excluded-warmup:G0",
        "excluded-warmup:G1",
        "excluded-warmup:D1",
    ]);
    assert.equal(packets.length, 3);
    assert.ok(
        packets.every(
            (packet) =>
                packet.input.corpusId === "warmup" && packet.pages.length === 0,
        ),
    );
    assert.equal(
        (await readFile(path.join(root, "warmups.jsonl"), "utf8"))
            .trim()
            .split("\n").length,
        3,
    );
});

test("common-input replay persists provider failures and explicit unattempted counts", async (t) => {
    const root = await temporary(t),
        tape = path.join(root, "input.jsonl");
    await writeFile(
        tape,
        [
            receipt("G0", "distinct"),
            receipt("G0", "distinct", { requestHash: "second-input" }),
        ]
            .map((row) =>
                JSON.stringify({
                    ...row,
                    input: { hash: row.requestHash },
                    pages: [],
                }),
            )
            .join("\n"),
    );
    const runtime = {
        memory: {
            createConfiguredViewSynthesisAdapter(
                _endpoint,
                _retry,
                _n,
                _scheduler,
                options,
            ) {
                return {
                    async assessWikiSubject(input) {
                        const failed = options.arm === "D1";
                        await options.onAssessment(
                            receipt(options.arm, "distinct", {
                                requestHash: input.hash,
                                outcome: failed ? "failed" : "returned",
                            }),
                        );
                        if (failed)
                            throw new Error("Native provider timed out");
                    },
                };
            },
        },
    };
    const result = await replayWikiAssessments(
        { tape, runDirectory: root },
        runtime,
        signal(),
    );
    assert.equal(result.status, "completed-with-failures");
    assert.equal(result.failures.length, 2);
    assert.equal(result.unattempted, 0);
    assert.equal(
        JSON.parse(await readFile(path.join(root, "agreement.json"), "utf8"))
            .agreement.D1.failed,
        2,
    );
    const selected = path.join(root, "selected");
    await mkdir(selected);
    const selectedResult = await replayWikiAssessments(
        { tape, runDirectory: selected, arms: ["D1"] },
        runtime,
        signal(),
    );
    assert.equal(selectedResult.failures.length, 2);
    assert.equal(selectedResult.unattempted, 0);
    assert.equal(selectedResult.agreement.G1.matched, 0);
    assert.equal(selectedResult.agreement.G1.failed, 0);
});

test("acceptance failure preserves its result and continues the next selected case", async (t) => {
    const root = await temporary(t);
    const checkpoint = await experimentCheckpoint(
        path.resolve(import.meta.dirname, "..", ".."),
    );
    const ids = ["4f54b7c9", "d24813b1"];
    const seeds = {
        status: "frozen",
        checkpoint: {
            ...checkpoint,
            [path.join(
                "tools",
                "memory-maintenance-qualification",
                "old-harness.mjs",
            )]: "previous-version",
        },
        configuration: {},
        questionIds: ids,
        cases: ids.map((id) => ({ id })),
    };
    await writeFile(path.join(root, "seeds.json"), JSON.stringify(seeds));
    await writeFile(path.join(root, "evaluation.json"), "{}");
    const attempted = [];
    const result = await runWikiExperiment(
        {
            seeds: root,
            runDirectory: root,
            scope: "wiki",
            arms: ["D1"],
            caseIds: ids,
            repetitions: 1,
            productRoot: path.resolve(import.meta.dirname, "..", ".."),
        },
        { checkpoint, configuration: {} },
        signal(),
        async (_spec, _runtime, _seed, trial) => {
            attempted.push(trial.id);
            if (attempted.length === 1) throw new Error("Acceptance rejected");
            trial.status = "complete";
        },
    );
    assert.deepEqual(attempted, ids);
    assert.deepEqual(
        result.trials.map((trial) => trial.status),
        ["failed", "complete"],
    );
    assert.equal(result.status, "completed-with-failures-or-unattempted");
    assert.deepEqual(result.seedCheckpoint, seeds.checkpoint);
    await assert.rejects(
        runWikiExperiment(
            {
                seeds: root,
                runDirectory: root,
                scope: "wiki",
                arms: ["D1"],
                caseIds: ids,
                repetitions: 1,
            },
            {
                checkpoint: { ...checkpoint, "changed.js": "different" },
                configuration: {},
            },
            signal(),
        ),
        /Compiled implementation changed/,
    );
    const controller = new AbortController();
    const cancelled = await runWikiExperiment(
        {
            seeds: root,
            runDirectory: root,
            scope: "wiki",
            arms: ["D1"],
            caseIds: ids,
            repetitions: 1,
            productRoot: path.resolve(import.meta.dirname, "..", ".."),
        },
        { checkpoint, configuration: {} },
        controller.signal,
        async () => {
            controller.abort(new Error("Campaign cancelled"));
            throw controller.signal.reason;
        },
    );
    assert.deepEqual(
        cancelled.trials.map((trial) => trial.status),
        ["censored", "not-attempted"],
    );
    await assert.rejects(
        runWikiExperiment(
            {
                seeds: root,
                runDirectory: root,
                scope: "wiki",
                arms: ["D1"],
                caseIds: ids,
                repetitions: 1,
                productRoot: path.resolve(import.meta.dirname, "..", ".."),
            },
            { checkpoint, configuration: {} },
            signal(),
            async (_spec, _runtime, _seed, trial) => {
                trial.cleanupFailures = [{ message: "Export failed" }];
                throw new Error("Export failed");
            },
        ),
        /Cannot continue after trial export or close failed/,
    );
});
