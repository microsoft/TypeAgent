// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
    externalOracle,
    intervalUnionMs,
    percentile,
    terminalExecutionFailure,
} from "../ghcp-eval-grade.mjs";
import {
    balancedOrder,
    buildCorpus,
    expectedLists,
    fixtureConfirmationAllowed,
    isClarificationQuestion,
    listFixture,
    normalizeLists,
    shuffled,
    sendWithClarification,
} from "../ghcp-eval-corpus.mjs";

const fixtures = path.resolve("fixtures");
const corpus = buildCorpus(fixtures, "owner/repo", 10, 20, 30);
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
            "How should I clean up your grocery list?",
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
    assert.deepEqual(expectedLists("A4", 30).grocery, []);
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
