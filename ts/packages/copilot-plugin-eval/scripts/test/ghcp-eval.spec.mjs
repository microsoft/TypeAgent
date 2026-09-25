// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { evalModel, validateEvalLedger } from "../ghcp-eval-config.mjs";
import {
    externalOracle,
    intervalUnionMs,
    percentile,
    preliminaryGrade,
    recoverableBackendReadFailure,
    terminalExecutionFailure,
} from "../ghcp-eval-grade.mjs";
import {
    balancedOrder,
    assertFrozenSpecification,
    buildCorpus,
    buildTrialSchedule,
    expectedLists,
    fixtureConfirmationAllowed,
    isClarificationQuestion,
    listFixture,
    normalizeLists,
    protocolVersion,
    runApplicableTrial,
    shuffled,
    sendWithClarification,
    trialApplicability,
} from "../ghcp-eval-corpus.mjs";

const fixtures = path.resolve("fixtures");
test("evaluation pins Luna 5.6 and rejects another model before paid work", () => {
    assert.equal(evalModel, "gpt-5.6-luna");
    assert.doesNotThrow(() => validateEvalLedger({ model: evalModel }));
    for (const model of ["gpt-5.6-sol", undefined, ""]) {
        assert.throws(
            () => validateEvalLedger({ model }),
            /Evaluation requires a ledger for gpt-5.6-luna/,
        );
    }
});
const corpus = buildCorpus(fixtures, "owner/repo", 10, 20, 30);
const readFailureEvents = [
    {
        event: "action.admitted",
        detail: { schemaName: "github-cli", actionName: "prFiles" },
    },
    {
        event: "action.completed",
        detail: {
            schemaName: "github-cli",
            actionName: "prFiles",
            success: false,
            recoverable: true,
        },
    },
];

test("protocol four retains paired N/A slots without launching unsupported native sessions", async () => {
    assert.equal(protocolVersion, 4);
    const schedule = buildTrialSchedule(corpus, [1, 2, 3, 4, 5, 6, 7], 1);
    const { order } = schedule;
    assert.equal(schedule.totalSlots, 140);
    assert.equal(schedule.scheduledTrials, 131);
    assert.deepEqual(schedule.applicableCounts, {
        1: 20,
        2: 20,
        3: 20,
        4: 20,
        5: 20,
        6: 20,
        7: 11,
    });
    let executions = 0;
    const results = [];
    for (const entry of order) {
        results.push(
            await runApplicableTrial(entry, () => {
                executions++;
                return { ...entry, status: "completed_ungraded" };
            }),
        );
    }
    assert.equal(results.length, 140);
    assert.equal(executions, 131);
    assert.deepEqual(
        results
            .filter(({ status }) => status === "not_applicable")
            .map(({ caseId }) => caseId)
            .sort(),
        ["A1", "A4", "M3", "M5", "R1", "R4", "R5", "S1", "S4"],
    );
    for (let candidate = 1; candidate <= 7; candidate++)
        assert.equal(
            corpus.filter(
                ({ id }) => trialApplicability(id, candidate).applicable,
            ).length,
            candidate === 7 ? 11 : 20,
        );
    assert.equal(
        preliminaryGrade(
            results.find(({ status }) => status === "not_applicable"),
            {},
        ).outcome,
        "not_applicable",
    );
});

test("frozen schedules derive pilot/repetition counts and cannot resume older protocols or changed order", async () => {
    const schedule = buildTrialSchedule(corpus, [1, 2, 3, 4, 5, 6, 7], 2);
    assert.equal(schedule.scheduledTrials, 262);
    assert.equal(schedule.applicableCounts[7], 22);
    const pilot = buildTrialSchedule(corpus.slice(0, 2), [1, 7], 1);
    assert.equal(pilot.totalSlots, 4);
    assert.equal(pilot.scheduledTrials, 3);
    const frozen = JSON.stringify({ protocolVersion, ...pilot });
    assert.doesNotThrow(() => assertFrozenSpecification(undefined, frozen));
    assert.doesNotThrow(() => assertFrozenSpecification(frozen, frozen));
    assert.throws(
        () =>
            assertFrozenSpecification(
                JSON.stringify({ protocolVersion: 3, ...pilot }),
                frozen,
            ),
        /Frozen run specification changed/,
    );
    assert.throws(
        () =>
            assertFrozenSpecification(
                JSON.stringify({
                    protocolVersion,
                    ...pilot,
                    order: [...pilot.order].reverse(),
                }),
                frozen,
            ),
        /Frozen run specification changed/,
    );
    await assert.rejects(
        runApplicableTrial({ caseId: "S1", candidate: 7 }, () =>
            assert.fail("must not run"),
        ),
        /frozen applicability/,
    );
});

test("known native read I/O failures allow recovery, never opaque shell errors or denied reads", () => {
    for (const tool of ["view", "glob", "rg", "web_fetch", "functions.view"]) {
        assert.equal(
            terminalExecutionFailure(tool, undefined, false, {
                message: "ENOENT: missing file",
            }),
            false,
        );
        for (const message of [
            "",
            "unknown error",
            "permission denied: ENOENT",
            "ENOENT after cancellation: cancelled",
            "uncertain delivery: ECONNRESET",
        ])
            assert.equal(
                terminalExecutionFailure(tool, undefined, false, { message }),
                true,
            );
    }
    assert.equal(
        terminalExecutionFailure("powershell", undefined, false, {
            message: "ENOENT",
        }),
        true,
    );
    for (const code of [
        "ERR_ACCESS_DENIED",
        "permissionDenied",
        "cancelled",
        "execution_uncertain",
    ]) {
        assert.equal(
            terminalExecutionFailure("view", undefined, false, {
                code,
                message: "ENOENT",
            }),
            true,
        );
    }
});

test("TypeAgent recovery requires a complete read-only trace and affirmative error details", () => {
    assert.equal(recoverableBackendReadFailure(readFailureEvents), true);
    for (const events of [
        [],
        readFailureEvents.slice(0, 1),
        [...readFailureEvents, { event: "action.denied", detail: {} }],
        [...readFailureEvents, { event: "action.failed", detail: {} }],
        readFailureEvents.map((event) => ({
            ...event,
            detail: {
                ...event.detail,
                schemaName: "list",
                actionName: "addItems",
            },
        })),
        readFailureEvents.map((event) => ({
            ...event,
            detail: { ...event.detail, recoverable: undefined },
        })),
    ]) {
        assert.equal(recoverableBackendReadFailure(events), false);
        assert.equal(
            terminalExecutionFailure(
                "typeagent-processCommand",
                { content: "Error: ECONNRESET" },
                true,
                undefined,
                events,
            ),
            true,
        );
    }
    assert.equal(
        terminalExecutionFailure(
            "typeagent-processCommand",
            { content: "Error: ECONNRESET" },
            true,
            undefined,
            readFailureEvents,
        ),
        false,
    );
    for (const status of [
        "failed",
        "cancelled",
        "unavailable",
        "execution_uncertain",
    ]) {
        const result = {
            structuredContent: {
                status,
                error: { code: "execution_failed", message: "ECONNRESET" },
            },
        };
        assert.equal(
            terminalExecutionFailure(
                "typeagent-executeAction",
                result,
                true,
                undefined,
                readFailureEvents,
            ),
            status !== "failed",
        );
    }
    for (const content of [
        "Error: permission denied: ECONNRESET",
        "Error: uncertain delivery",
        "Error:",
    ]) {
        assert.equal(
            terminalExecutionFailure(
                "typeagent-processCommand",
                { content },
                true,
                undefined,
                readFailureEvents,
            ),
            true,
        );
    }
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            undefined,
            false,
            undefined,
            readFailureEvents,
        ),
        true,
    );
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            {
                structuredContent: {
                    status: "failed",
                    error: { code: "invalid_scope", message: "ECONNRESET" },
                },
            },
            true,
            undefined,
            readFailureEvents,
        ),
        true,
    );
});

test("safe recovery can reach clarification within the same deadline but is not itself success", async () => {
    let calls = 0;
    let stopped = false;
    const answer = await sendWithClarification({
        session: {
            sendAndWait: async () => {
                calls++;
                stopped ||= terminalExecutionFailure("view", undefined, false, {
                    message: "ENOENT",
                });
                return {
                    data: {
                        content: calls === 1 ? "Which file?" : "trip contents",
                    },
                };
            },
        },
        prompt: corpus.find(({ id }) => id === "A5").prompt,
        testCase: corpus.find(({ id }) => id === "A5"),
        timeoutMs: 1000,
        canClarify: () => !stopped,
        clarify: () => "trip.txt.",
    });
    assert.equal(calls, 2);
    assert.equal(answer.data.content, "trip contents");
    assert.equal(
        preliminaryGrade(
            {
                status: "completed_ungraded",
                caseId: "S2",
                routeViolations: [],
                grade: { filesUnchanged: true },
                answer: "not the file contents",
            },
            {},
        ).outcome,
        "pending_review",
    );
});

test("A4 requires unresolved-item clarification and preserves every other item and list", () => {
    const testCase = corpus.find(({ id }) => id === "A4");
    assert.equal(testCase.prompt, "Remove the item from my grocery list.");
    assert.equal(testCase.clarification, "Remove milk; keep everything else.");
    assert.equal(
        isClarificationQuestion("A4", "Which item should I remove?"),
        true,
    );
    assert.equal(
        isClarificationQuestion("A4", "Confirm removing milk?"),
        false,
    );
    assert.equal(
        isClarificationQuestion("A4", "Which list should I clear?"),
        false,
    );
    const expected = expectedLists("A4", 30);
    assert.deepEqual(expected.grocery, ["eggs", "rice"]);
    assert.deepEqual(
        { ...expected, grocery: listFixture.grocery },
        listFixture,
    );
    const action = {
        schemaName: "list",
        actionName: "removeItems",
        parameters: { listName: "grocery", items: ["milk"] },
    };
    assert.equal(
        fixtureConfirmationAllowed("A4", action, "C:\\fixtures"),
        true,
    );
    for (const other of [
        { ...action, actionName: "clearList" },
        { ...action, parameters: { listName: "grocery", items: ["eggs"] } },
        {
            ...action,
            parameters: { listName: "grocery", items: ["milk", "eggs"] },
        },
        { ...action, parameters: { listName: "pantry", items: ["milk"] } },
    ])
        assert.equal(
            fixtureConfirmationAllowed("A4", other, "C:\\fixtures"),
            false,
        );
    const result = {
        status: "completed_ungraded",
        caseId: "A4",
        routeViolations: [],
        answer: "Removed milk.",
        grade: {
            filesUnchanged: true,
            listStateMatchesOracle: true,
            clarificationRequested: true,
            noPrematureListMutation: false,
        },
    };
    assert.equal(
        preliminaryGrade(result, {}).reason,
        "clarification_not_verified_before_effects",
    );
    result.grade.noPrematureListMutation = true;
    assert.equal(preliminaryGrade(result, {}).outcome, "pending_review");
});
test("intermediate edit confirmation is limited to the case's disposable list", () => {
    const action = {
        schemaName: "list",
        actionName: "startEditList",
        parameters: { listName: "errand" },
    };
    assert.equal(fixtureConfirmationAllowed("R5", action, fixtures), true);
    assert.equal(fixtureConfirmationAllowed("S1", action, fixtures), false);
    assert.equal(fixtureConfirmationAllowed("A1", action, fixtures), false);
});
test("final-text clarification gets exactly one answer within the same deadline", async () => {
    const calls = [];
    const session = {
        sendAndWait: async (input, timeout) => {
            calls.push({ input, timeout });
            return {
                data: {
                    content:
                        calls.length === 1
                            ? "Which list should receive apples?"
                            : "Done",
                },
            };
        },
    };
    const testCase = corpus.find((entry) => entry.id === "A1");
    const result = await sendWithClarification({
        session,
        prompt: testCase.prompt,
        timeoutMs: 1000,
        testCase,
        canClarify: () => true,
        clarify: () => testCase.clarification,
    });
    assert.equal(result.data.content, "Done");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].input.prompt, "The grocery list.");
    assert.ok(calls[1].timeout <= calls[0].timeout);
});
test("text continuation never replays stopped work or confirms a guessed target", async () => {
    for (const [text, allowed] of [
        ["Which list?", false],
        ["Confirm adding apples to grocery?", true],
    ]) {
        let calls = 0;
        await sendWithClarification({
            session: {
                sendAndWait: async () => {
                    calls++;
                    return { data: { content: text } };
                },
            },
            prompt: "Add apples to my list.",
            timeoutMs: 1000,
            testCase: corpus.find((entry) => entry.id === "A1"),
            canClarify: () => allowed,
            clarify: () => assert.fail("must not answer"),
        });
        assert.equal(calls, 1);
    }
});
test("failure detection preserves structured status and NL errors, not check-result words", () => {
    assert.equal(
        terminalExecutionFailure(
            "typeagent-processCommand",
            { content: "Error: denied" },
            true,
        ),
        true,
    );
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            { structuredContent: { status: "execution_uncertain" } },
            true,
        ),
        true,
    );
    assert.equal(
        terminalExecutionFailure(
            "typeagent-executeAction",
            { structuredContent: { status: "requires_interaction" } },
            true,
        ),
        false,
    );
    assert.equal(
        terminalExecutionFailure(
            "typeagent-processCommand",
            { content: "No failed checks." },
            true,
        ),
        false,
    );
    assert.equal(
        terminalExecutionFailure("typeagent-searchActions", {}, false),
        false,
    );
});
test("nested/parallel tool durations are not double-counted and empty tails are unknown", () => {
    assert.equal(
        intervalUnionMs([
            [0, 10],
            [2, 8],
            [8, 15],
            [20, 25],
        ]),
        20,
    );
    assert.equal(percentile([], 0.95), null);
    assert.equal(percentile([9, 1, 3], 0.5), 3);
    assert.equal(percentile([9, 1, 3], 0.95), 9);
});
test("native domain failures stop execution even without an SDK error payload", () => {
    for (const tool of [
        "powershell",
        "view",
        "glob",
        "rg",
        "web_fetch",
        "functions.powershell",
        "functions-web_fetch",
    ]) {
        assert.equal(terminalExecutionFailure(tool, undefined, false), true);
        assert.equal(terminalExecutionFailure(tool, {}, true), false);
    }
    assert.equal(terminalExecutionFailure("ask_user", undefined, false), false);
});
test("failed native execution cannot trigger a scripted continuation", async () => {
    let stopped = false;
    let calls = 0;
    await sendWithClarification({
        session: {
            sendAndWait: async () => {
                calls++;
                stopped = terminalExecutionFailure(
                    "powershell",
                    undefined,
                    false,
                );
                return { data: { content: "Which file?" } };
            },
        },
        prompt: "Read that file.",
        timeoutMs: 1000,
        testCase: corpus.find((entry) => entry.id === "A5"),
        canClarify: () => !stopped,
        clarify: () => assert.fail("cannot continue after native failure"),
    });
    assert.equal(calls, 1);
});
test("explicit cancellation and uncertain shell follow-ups remain terminal", () => {
    assert.equal(
        terminalExecutionFailure(
            "typeagent-cancelAction",
            {
                structuredContent: { status: "cancelled" },
            },
            true,
        ),
        true,
    );
    assert.equal(terminalExecutionFailure("stop_powershell", {}, true), true);
    assert.equal(
        terminalExecutionFailure("functions.stop_powershell", undefined, false),
        true,
    );
    assert.equal(
        terminalExecutionFailure("read_powershell", undefined, false, {
            message: "ENOENT",
        }),
        true,
    );
});
test("independent PR file evidence must be complete", () => {
    const snapshot = {
        status: "passed",
        externalEvidence: [
            {
                actionName: "prFiles",
                number: 1,
                outcome: { output: ["1 of 1 files\nsrc/a.ts  modified  1  0"] },
            },
        ],
    };
    assert.deepEqual(externalOracle(snapshot)[1].files, ["src/a.ts"]);
    snapshot.externalEvidence[0].outcome.output[0] =
        "1 of 2 files\nsrc/a.ts modified 1 0";
    assert.throws(() => externalOracle(snapshot), /incomplete/);
});
test("confirmation of a guessed referent is not clarification", () => {
    assert.equal(
        isClarificationQuestion("A1", "Which list should receive apples?"),
        true,
    );
    assert.equal(
        isClarificationQuestion("A1", "Add apples to your grocery list?"),
        false,
    );
    assert.equal(
        isClarificationQuestion("A2", "Which report should I read?"),
        true,
    );
    assert.equal(
        isClarificationQuestion("A2", "Which service contains your data?"),
        false,
    );
    assert.equal(
        isClarificationQuestion(
            "A4",
            "Which item should I remove from your grocery list?",
        ),
        true,
    );
});
test("the full workload has exactly four five-case cohorts", () => {
    assert.equal(corpus.length, 20);
    assert.equal(new Set(corpus.map(({ id }) => id)).size, 20);
    for (const cohort of ["S", "M", "R", "A"]) {
        assert.equal(
            corpus.filter(({ id }) => id.startsWith(cohort)).length,
            5,
        );
    }
    assert.equal(corpus.filter(({ clarification }) => clarification).length, 5);
});
test("scripted confirmations are limited to exact disposable fixture actions", () => {
    const add = {
        schemaName: "list",
        actionName: "addItems",
        parameters: { listName: "grocery", items: ["apples"] },
    };
    assert.equal(fixtureConfirmationAllowed("S4", add, fixtures), true);
    assert.equal(fixtureConfirmationAllowed("S1", add, fixtures), false);
    assert.equal(
        fixtureConfirmationAllowed(
            "S4",
            { ...add, schemaName: "github-cli" },
            fixtures,
        ),
        false,
    );
    assert.equal(
        fixtureConfirmationAllowed(
            "R5",
            {
                ...add,
                parameters: { listName: "errand", items: ["guessed title"] },
            },
            fixtures,
        ),
        false,
    );
    const read = {
        schemaName: "powershell.powershell-files",
        actionName: "readFile",
        parameters: { path: path.join(fixtures, "report-a.txt") },
    };
    assert.equal(fixtureConfirmationAllowed("S2", read, fixtures), true);
    assert.equal(fixtureConfirmationAllowed("A2", read, fixtures), false);
    assert.equal(
        fixtureConfirmationAllowed(
            "S2",
            {
                ...read,
                parameters: {
                    path: path.resolve(fixtures, "..", "report-a.txt"),
                },
            },
            fixtures,
        ),
        false,
    );
});
test("seeded ordering is reproducible without dropping examples", () => {
    assert.deepEqual(shuffled(corpus, 42), shuffled(corpus, 42));
    assert.notDeepEqual(shuffled(corpus, 42), shuffled(corpus, 43));
    assert.equal(new Set(shuffled(corpus, 42).map(({ id }) => id)).size, 20);
});
test("answers are separate from prompts and fixed inputs are substituted", () => {
    assert.equal(
        corpus.find(({ id }) => id === "A1").prompt,
        "Add apples to my list.",
    );
    assert.equal(
        corpus.find(({ id }) => id === "A3").clarification,
        "Pull request 10.",
    );
    assert.match(
        corpus.find(({ id }) => id === "M5").prompt,
        /review issue 30/,
    );
});
test("balanced rotations retain every candidate/case/repetition", () => {
    const order = balancedOrder(corpus, [1, 2, 3, 4, 5, 6, 7], 2);
    assert.equal(order.length, 280);
    assert.equal(
        new Set(order.map((entry) => JSON.stringify(entry))).size,
        280,
    );
    assert.deepEqual(
        order.slice(7, 14).map(({ candidate }) => candidate),
        [2, 3, 4, 5, 6, 7, 1],
    );
    assert.throws(() => balancedOrder(corpus, [1], 0), /positive integer/);
});
test("independent list oracles preserve all unrelated state", () => {
    assert.deepEqual(expectedLists("M3", 30).grocery, ["bread", "oranges"]);
    assert.deepEqual(expectedLists("A4", 30).grocery, ["eggs", "rice"]);
    assert.deepEqual(expectedLists("S4", 30).pantry, listFixture.pantry);
    assert.deepEqual(expectedLists("S1", 30), listFixture);
    assert.equal(expectedLists("R5", 30), undefined);
    assert.equal(
        expectedLists("R5", 30, "Exact title").errand.at(-1),
        "Exact title",
    );
    assert.equal(listFixture.grocery.includes("apples"), false);
    assert.deepEqual(normalizeLists([{ name: "a", items: ["b", "a"] }]), {
        a: ["a", "b"],
    });
});
