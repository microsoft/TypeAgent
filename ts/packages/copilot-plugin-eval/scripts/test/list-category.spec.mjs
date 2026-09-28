// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
    buildCorpus,
    protocolVersion,
    listFixture,
    consumeFixtureContinuation,
    fileConsentContext,
    sendWithClarification,
} from "../ghcp-eval-corpus.mjs";
import {
    evaluationCategory,
    categoryCorpus,
    categorySchedule,
    assertCategoryReadiness,
    assertCategoryResults,
} from "../ghcp-eval-categories.mjs";
import {
    expectedLists,
    readLists,
    resetLists,
    listsUnchanged,
    listPolicy,
    listFilePolicy,
    listClarificationQuestion,
    gradeListTrial,
} from "../ghcp-eval-lists.mjs";
import { restoreFiles, snapshotFiles } from "../ghcp-eval-files.mjs";
import {
    preliminaryGrade,
    terminalExecutionFailure,
} from "../ghcp-eval-grade.mjs";
import { summarizeCategory } from "../ghcp-eval-report.mjs";
import {
    verifyListPreflight,
    preflightListPolicy,
} from "../ghcp-eval-list-preflight.mjs";
import {
    ghcpEvalListActionAllowed,
    ghcpEvalListExternalReadAllowed,
} from "../../../dispatcher/dispatcher/dist/execute/ghcpEvalLists.js";

const category = evaluationCategory("lists");
const corpus = categoryCorpus(
    category,
    "fixtures",
    "microsoft/TypeAgent",
    3058,
    3067,
    2617,
);
const order = categorySchedule(category, corpus, category.candidates, 1).order;
const metadata = {
    protocolVersion,
    category: category.name,
    corpusVersion: category.corpusVersion,
};
const writeLists = (store, lists) =>
    fs.writeFileSync(
        store,
        JSON.stringify(
            Object.entries(lists).map(([name, items]) => ({ name, items })),
        ),
    );

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eval-lists-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = path.join(directory, "lists.json");
    writeLists(store, listFixture);
    const files = path.join(directory, "files");
    fs.mkdirSync(files);
    restoreFiles(files);
    return { directory, store, files };
}

test("common defaults and exact 20x7 / 20x4 categories retain separate IDs", () => {
    const common = evaluationCategory();
    const commonCases = categoryCorpus(
        common,
        "fixtures",
        "microsoft/TypeAgent",
        3058,
        3067,
        2617,
    );
    assert.deepEqual(
        commonCases,
        buildCorpus("fixtures", "microsoft/TypeAgent", 3058, 3067, 2617),
    );
    assert.equal(
        categorySchedule(common, commonCases, common.candidates, 1).order
            .length,
        140,
    );
    assert.equal(order.length, 80);
    assert.equal(new Set(corpus.map((row) => row.id)).size, 20);
    for (const cohort of ["S", "M", "R", "A"])
        assert.equal(corpus.filter((row) => row.cohort === cohort).length, 5);
    assert.deepEqual(
        [...new Set(order.map((row) => row.candidate))].sort(),
        [1, 2, 3, 4],
    );
    for (const ids of [[1, 5], [6], [7], [1, 1]])
        assert.throws(
            () => categorySchedule(category, corpus, ids, 1),
            /another evaluation category/,
        );
    assert.throws(
        () => categorySchedule(category, commonCases, [1], 1),
        /another evaluation category/,
    );
    assert.throws(
        () => categorySchedule(common, corpus, [1], 1),
        /another evaluation category/,
    );
    assert.doesNotMatch(
        category.preparation,
        /milk|eggs|apples|2617|grocery|pantry|adapter/,
    );
});

test("category/version readiness and resume reject frozen, mixed or reordered evidence", () => {
    const readiness = {
        ...metadata,
        status: "passed",
        listOperationsVerified: true,
    };
    assert.doesNotThrow(() => assertCategoryReadiness(readiness, category));
    for (const override of [
        { protocolVersion: 5 },
        { category: "common-files" },
        { listOperationsVerified: false },
        { corpusVersion: "old" },
    ])
        assert.throws(() =>
            assertCategoryReadiness({ ...readiness, ...override }, category),
        );
    const prefix = order.slice(0, 4).map((row) => ({ ...row, ...metadata }));
    assert.doesNotThrow(() => assertCategoryResults(prefix, order, category));
    for (const override of [
        { protocolVersion: 5 },
        { category: "common-files" },
        { caseId: "S1" },
        { candidate: 7 },
        { repetition: 1 },
    ])
        assert.throws(() =>
            assertCategoryResults(
                [{ ...prefix[0], ...override }],
                order,
                category,
            ),
        );
});

test("all list oracles require exact lists and unchanged independent files", (t) => {
    const { store, files } = fixture(t);
    for (const row of corpus) {
        resetLists(store);
        const before = readLists(store);
        writeLists(store, expectedLists(row.id, 2617, "Independent title"));
        const result = {
            caseId: row.id,
            noPrematureListMutation: true,
            listsAtClarification: before,
        };
        const grade = gradeListTrial(
            result,
            store,
            snapshotFiles(files),
            "Independent title",
        );
        assert.deepEqual(
            grade,
            {
                listStateMatchesOracle: true,
                fileStateMatchesOracle: true,
                noPrematureListMutation: true,
            },
            row.id,
        );
        const corrupted = readLists(store);
        corrupted.unrelated = ["unexpected"];
        writeLists(store, corrupted);
        assert.equal(
            gradeListTrial(
                result,
                store,
                snapshotFiles(files),
                "Independent title",
            ).listStateMatchesOracle,
            false,
        );
    }
    resetLists(store);
    assert.equal(listsUnchanged(store), true);
    fs.writeFileSync(path.join(files, "trip.txt"), "changed");
    assert.equal(
        gradeListTrial(
            { caseId: "list-S1", noPrematureListMutation: true },
            store,
            snapshotFiles(files),
        ).fileStateMatchesOracle,
        false,
    );
    fs.writeFileSync(
        store,
        '[{"name":"x","items":[]},{"name":"x","items":[]}]',
    );
    assert.throws(() => readLists(store), /Invalid evaluation list snapshot/);
});

test("list policy enforces exact targets/items, ordering, category file scope and independent issue oracle", (t) => {
    const { store } = fixture(t);
    const allowed = (id, action, args, clarified = true) =>
        ghcpEvalListActionAllowed(
            action,
            args,
            listPolicy(id, store, clarified, "Independent title"),
        );
    assert.equal(
        allowed("list-S4", "addItems", {
            listName: "grocery",
            items: ["apples"],
        }),
        true,
    );
    for (const args of [
        { listName: "pantry", items: ["apples"] },
        { listName: "grocery", items: ["bananas"] },
        { listName: "grocery", items: [] },
        { listName: "grocery", items: ["apples"], extra: true },
    ])
        assert.equal(allowed("list-S4", "addItems", args), false);
    assert.equal(
        allowed("list-M3", "addItems", {
            listName: "grocery",
            items: ["bread", "oranges"],
        }),
        false,
    );
    assert.equal(
        allowed("list-M3", "clearList", { listName: "grocery" }),
        true,
    );
    writeLists(store, { ...listFixture, grocery: [] });
    assert.equal(
        allowed("list-M3", "addItems", {
            listName: "grocery",
            items: ["bread", "oranges"],
        }),
        true,
    );
    assert.equal(
        allowed("list-M3", "clearList", { listName: "grocery" }),
        false,
    );
    assert.equal(
        allowed("list-M4", "addItems", {
            listName: "picnic",
            items: ["water"],
        }),
        false,
    );
    assert.equal(
        allowed("list-M4", "createList", { listName: "picnic" }),
        true,
    );
    assert.equal(
        allowed("list-M2", "removeItems", {
            listName: "office",
            items: ["notebook"],
        }),
        false,
    );
    writeLists(store, {
        ...listFixture,
        office: [...listFixture.office, "tea", "coffee"],
        picnic: [],
    });
    assert.equal(
        allowed("list-M2", "removeItems", {
            listName: "office",
            items: ["notebook"],
        }),
        true,
    );
    assert.equal(
        allowed("list-M4", "addItems", {
            listName: "picnic",
            items: ["water"],
        }),
        true,
    );
    assert.throws(
        () => listPolicy("list-R5", store),
        /independent issue title/,
    );
    for (const row of corpus) {
        const policy = listFilePolicy(row.id);
        assert.deepEqual(policy.writeFiles, []);
        assert.deepEqual(
            policy.readFiles,
            row.id === "list-R4" ? ["trip.txt"] : [],
        );
        assert.equal(policy.allowInventory, false);
        const permit = ghcpEvalListExternalReadAllowed(
            "github-cli",
            "issueView",
            { repo: "microsoft/TypeAgent", number: 2617 },
            listPolicy(row.id, store, true, "title"),
        );
        assert.equal(permit, ["list-M5", "list-R5"].includes(row.id));
    }
});

test("all ambiguity cases deny list effects until genuine referent clarification", async (t) => {
    const { store, files } = fixture(t);
    for (const row of corpus.filter((row) => row.clarification)) {
        const policy = listPolicy(row.id, store);
        for (const rule of policy.rules)
            assert.equal(
                ghcpEvalListActionAllowed(
                    rule.actionName,
                    {
                        listName: rule.listName,
                        ...(rule.items ? { items: rule.items } : {}),
                    },
                    policy,
                ),
                false,
            );
        assert.equal(
            listClarificationQuestion(row.id, "Run or Cancel?"),
            false,
        );
        assert.equal(
            listClarificationQuestion(row.id, "Confirm which list to clear?"),
            false,
        );
    }
    const result = {
        caseId: "list-A4",
        noPrematureListMutation: false,
        listsAtClarification: expectedLists("list-S1"),
    };
    writeLists(store, expectedLists("list-A4"));
    assert.equal(
        gradeListTrial(result, store, snapshotFiles(files))
            .noPrematureListMutation,
        false,
    );
    let turns = 0;
    let clarified = false;
    const answer = await sendWithClarification({
        session: {
            sendAndWait: async () => ({
                data: {
                    content:
                        ++turns === 1
                            ? "Which item should I remove?"
                            : "Removed milk.",
                },
            }),
        },
        prompt: "Remove the item.",
        timeoutMs: 1000,
        testCase: corpus.find((row) => row.id === "list-A4"),
        canClarify: () => !clarified,
        clarify: () => {
            clarified = true;
            return "milk";
        },
        isClarification: listClarificationQuestion,
    });
    assert.equal(answer.data.content, "Removed milk.");
    assert.equal(turns, 2);
});

test("structured list consent uses current backend context and single-use scoped continuation", () => {
    const action = {
        schemaName: "list",
        actionName: "clearList",
        parameters: { listName: "office" },
    };
    const pending = {
        status: "requires_interaction",
        scopeId: "s",
        operationId: "o",
        interactionId: "i",
        prompt: { type: "confirmation", action },
    };
    const tools = [
        {
            name: "typeagent-executeAction",
            toolCallId: "t",
            endMs: 1,
            backendEventOffset: 0,
        },
    ];
    const results = [
        { toolCallId: "t", result: { structuredContent: pending } },
    ];
    assert.deepEqual(fileConsentContext(tools, results, [], {}).action, action);
    assert.deepEqual(fileConsentContext([], results, [], {}), {});
    const args = {
        scopeId: "s",
        operationId: "o",
        interactionId: "i",
        response: { type: "confirmation", approved: true },
    };
    const make = () =>
        new Map([
            ["i", { scopeId: "s", operationId: "o", response: args.response }],
        ]);
    const approvals = make();
    assert.equal(consumeFixtureContinuation(approvals, args, false), true);
    assert.equal(consumeFixtureContinuation(approvals, args, false), false);
    assert.equal(consumeFixtureContinuation(make(), args, true), false);
    for (const change of [
        { scopeId: "other" },
        { operationId: "stale" },
        { interactionId: "missing" },
        { response: { type: "question", selected: 0 } },
    ])
        assert.equal(
            consumeFixtureContinuation(make(), { ...args, ...change }, false),
            false,
        );
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            { structuredContent: { status: "execution_uncertain" } },
            true,
        ),
        true,
    );
    const events = [
        {
            event: "action.admitted",
            detail: { schemaName: "list", actionName: "getList" },
        },
        {
            event: "action.completed",
            detail: {
                schemaName: "list",
                actionName: "getList",
                success: false,
                recoverable: true,
            },
        },
    ];
    const failure = {
        structuredContent: {
            status: "failed",
            error: {
                code: "execution_failed",
                message: "ENOENT: list missing",
            },
        },
    };
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            failure,
            true,
            undefined,
            events,
        ),
        false,
    );
    failure.structuredContent.error.message = "permission denied: ENOENT";
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            failure,
            true,
            undefined,
            events,
        ),
        true,
    );
});

test("category reports preserve denominators, unknowns, latency and preparation populations", () => {
    const spec = { ...metadata, repetitions: 1, order };
    const results = order.map((row, i) => ({
        ...row,
        ...metadata,
        status: "completed_ungraded",
        routeViolations: [],
        answer: "Reviewed",
        grade: {
            fileStateMatchesOracle: true,
            listStateMatchesOracle: true,
            clarificationRequested: true,
            noPrematureFileMutation: true,
            noPrematureListMutation: true,
        },
        e2eMs: i + 1,
        preparationMs: row.candidate === 4 ? 100 : null,
    }));
    const reviews = results.map((row) => ({
        ...row,
        outcome: "success",
        reason: "Independent fixture and final-answer review",
        evidence: ["fixture", "answer"],
    }));
    const report = summarizeCategory(spec, results, reviews);
    assert.equal(report.denominator, 80);
    assert.equal(report.commonSuccessPairs.length, 20);
    assert.equal(report.pairwiseCommonSuccess.length, 6);
    assert.equal(report.pairwiseCommonSuccess[0].pairs.length, 20);
    const c1Times = results
        .filter((row) => row.candidate === 1)
        .map((row) => row.e2eMs)
        .sort((a, b) => a - b);
    assert.equal(report.candidates[0].e2e.p50Ms, c1Times[9]);
    assert.equal(report.candidates[0].e2e.p90Ms, c1Times[17]);
    assert.equal(report.candidates[0].e2e.p95Ms, c1Times[18]);
    for (const row of report.candidates) {
        assert.equal(row.denominator, 20);
        assert.equal(row.successfulE2e.population, 20);
        assert.equal(row.commonSuccessE2e.population, 20);
        assert.equal(row.cohorts.A.denominator, 5);
        assert.equal(row.preparation.totalMs, row.candidate === 4 ? 2000 : 0);
    }
    const unknown = summarizeCategory(spec, results, []);
    assert.equal(unknown.candidates[0].unknown, 20);
    assert.equal(unknown.commonSuccessPairs.length, 0);
    assert.equal(unknown.candidates[0].successfulE2e.p50Ms, null);
    const missing = structuredClone(results);
    missing.find((row) => row.candidate === 4).preparationMs = null;
    missing.find((row) => row.candidate === 1).e2eMs = null;
    const missingReport = summarizeCategory(spec, missing, reviews);
    assert.equal(missingReport.candidates[3].preparation.missing, 1);
    assert.equal(missingReport.candidates[3].preparation.totalMs, null);
    assert.equal(missingReport.candidates[0].e2e.missing, 1);
    const denied = structuredClone(results);
    denied[0].terminalExecutionFailure = true;
    assert.throws(
        () => summarizeCategory(spec, denied, reviews),
        /Success contradicts/,
    );
    assert.throws(
        () =>
            summarizeCategory(
                { ...spec, protocolVersion: 5 },
                results,
                reviews,
            ),
        /historical/,
    );
    assert.throws(
        () => summarizeCategory(spec, results.slice(1), reviews),
        /schedule/,
    );
    const malformed = structuredClone(results);
    malformed[0].category = "common-files";
    assert.throws(
        () => summarizeCategory(spec, malformed, reviews),
        /schedule/,
    );
    assert.equal(
        preliminaryGrade({ ...results[0], status: "timed_out" }, {}).outcome,
        "incomplete",
    );
});

test("offline list preflight validates six actual operation outcomes and denies unexpected confirmation context", async (t) => {
    const { directory } = fixture(t);
    const data = path.join(directory, "data");
    fs.mkdirSync(data);
    const store = path.join(data, "lists.json");
    const policyFile = path.join(directory, "policy.json");
    fs.writeFileSync(policyFile, JSON.stringify(preflightListPolicy("")));
    writeLists(store, {});
    const invoke = async ({ name, arguments: args }) => {
        assert.equal(name, "typeagent-executeAction");
        const lists = readLists(store);
        const p = args.parameters;
        if (args.actionName === "createList") lists[p.listName] = [];
        if (args.actionName === "addItems") lists[p.listName].push(...p.items);
        if (args.actionName === "removeItems")
            lists[p.listName] = lists[p.listName].filter(
                (item) => !p.items.includes(item),
            );
        if (args.actionName === "clearList") lists[p.listName] = [];
        writeLists(store, lists);
        return { structuredContent: { status: "completed" } };
    };
    const env = {
        TYPEAGENT_USER_DATA_DIR: data,
        TYPEAGENT_GHCP_EVAL_LIST_POLICY: policyFile,
    };
    const result = { externalEvidence: [] };
    assert.equal(
        await verifyListPreflight({ callTool: invoke }, "scope", env, result),
        store,
    );
    assert.equal(result.externalEvidence.length, 6);
    resetLists(store);
    assert.equal(listsUnchanged(store), true);
    await assert.rejects(() =>
        verifyListPreflight(
            {
                callTool: async () => ({
                    structuredContent: {
                        status: "requires_interaction",
                        scopeId: "wrong",
                        prompt: { type: "confirmation" },
                    },
                }),
            },
            "scope",
            env,
            { externalEvidence: [] },
        ),
    );
});
