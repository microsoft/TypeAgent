// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
    assertCorpusReadiness,
    corpusVersion,
    fileFixture,
    expectedFiles,
    filePolicy,
    fixtureConfirmationAllowed,
    buildCorpus,
    balancedOrder,
    fileHandlerConfirmation,
    fileConsentContext,
    pendingFileAction,
    consumeFixtureContinuation,
    isClarificationQuestion,
} from "../ghcp-eval-corpus.mjs";
import {
    fileStateMatches,
    gradeFileState,
    restoreFiles,
    snapshotFiles,
} from "../ghcp-eval-files.mjs";
import { preliminaryGrade } from "../ghcp-eval-grade.mjs";

test("all twenty file cases are applicable to all seven candidates", () => {
    const cases = buildCorpus(path.resolve("fixtures"), "owner/repo", 1, 2, 3);
    for (const repetitions of [1, 2]) {
        const schedule = balancedOrder(
            cases,
            [1, 2, 3, 4, 5, 6, 7],
            repetitions,
        );
        assert.equal(schedule.length, 140 * repetitions);
        for (let candidate = 1; candidate <= 7; candidate++)
            assert.equal(
                schedule.filter((entry) => entry.candidate === candidate)
                    .length,
                20 * repetitions,
            );
    }
    assert.equal(balancedOrder(cases.slice(0, 2), [1, 7], 1).length, 4);
});

test("handler consent needs an exact question and unambiguous admitted file action", () => {
    const action = {
        schemaName: "powershell.powershell-files",
        actionName: "copyFile",
        parameters: {
            source: "grocery.txt",
            destination: "grocery-backup.txt",
        },
    };
    const admitted = { event: "action.admitted", detail: action };
    const prompt = {
        type: "question",
        message: "Copy the requested file or directory?",
        choices: ["Run", "Cancel"],
        defaultId: 1,
    };
    assert.equal(pendingFileAction([admitted]), action);
    assert.deepEqual(fileHandlerConfirmation(prompt, action), {
        type: "question",
        selected: 0,
    });
    for (const events of [
        [],
        [admitted, admitted],
        [admitted, { event: "action.completed", detail: action }],
        [admitted, { event: "action.denied", detail: action }],
        [admitted, { event: "action.failed", detail: action }],
        [
            admitted,
            { event: "action.completed", detail: { actionName: "writeFile" } },
        ],
    ])
        assert.equal(pendingFileAction(events), undefined);
    for (const bad of [
        { ...prompt, choices: ["Cancel", "Run"] },
        { ...prompt, message: "Delete the requested file or directory?" },
        { ...prompt, defaultId: 0 },
        { ...prompt, type: "confirmation" },
    ])
        assert.equal(fileHandlerConfirmation(bad, action), undefined);
    assert.equal(fileHandlerConfirmation(prompt, undefined), undefined);
    assert.equal(
        fileHandlerConfirmation(prompt, { ...action, actionName: "writeFile" }),
        undefined,
    );
    for (const id of ["A1", "A4"]) {
        assert.equal(isClarificationQuestion(id, prompt.message), false);
        assert.equal(filePolicy(id).writesEnabled, false);
    }
});

test("handler continuations are single-use and bound to operation, scope and response", () => {
    const args = {
        interactionId: "i",
        operationId: "o",
        scopeId: "s",
        response: { type: "question", selected: 0 },
    };
    const approval = () =>
        new Map([
            ["i", { operationId: "o", scopeId: "s", response: args.response }],
        ]);
    const approvals = approval();
    assert.equal(consumeFixtureContinuation(approvals, args, false), true);
    assert.equal(consumeFixtureContinuation(approvals, args, false), false);
    for (const other of [
        { ...args, interactionId: "old" },
        { ...args, operationId: "other" },
        { ...args, scopeId: "other" },
        { ...args, response: { type: "question", selected: 1 } },
        { ...args, response: { type: "confirmation", approved: true } },
    ])
        assert.equal(
            consumeFixtureContinuation(approval(), other, false),
            false,
        );
    assert.equal(consumeFixtureContinuation(approval(), args, true), false);
    assert.equal(consumeFixtureContinuation(new Map(), args, false), false);
    assert.equal(
        consumeFixtureContinuation(
            approval(),
            {
                ...args,
                response: { selected: 0, type: "question" },
            },
            false,
        ),
        true,
    );
    const confirmation = new Map([
        [
            "i",
            {
                operationId: "o",
                scopeId: "s",
                response: { type: "confirmation", approved: true },
            },
        ],
    ]);
    assert.equal(
        consumeFixtureContinuation(
            confirmation,
            {
                ...args,
                response: { approved: true, type: "confirmation" },
            },
            false,
        ),
        true,
    );
    assert.equal(
        consumeFixtureContinuation(
            approval(),
            {
                ...args,
                response: { ...args.response, extra: true },
            },
            false,
        ),
        false,
    );
});

test("file consent cannot reuse stale action traces or overlapping tool contexts", () => {
    const tool = {
        name: "typeagent-processCommand",
        toolCallId: "t",
        backendEventOffset: 0,
    };
    const action = {
        schemaName: "powershell.powershell-files",
        actionName: "copyFile",
        parameters: {},
    };
    const events = [{ event: "action.admitted", detail: action }];
    const request = {
        question: "Copy the requested file or directory?",
        choices: ["Run", "Cancel"],
    };
    assert.equal(
        fileConsentContext([tool], [], events, request).action,
        action,
    );
    for (const tools of [
        [],
        [{ ...tool, endMs: 1 }],
        [{ ...tool, backendEventOffset: 1 }],
        [tool, { ...tool, toolCallId: "other" }],
        [
            { ...tool, endMs: 1 },
            { name: "typeagent-searchActions", toolCallId: "search", endMs: 2 },
        ],
    ])
        assert.equal(
            fileConsentContext(tools, [], events, request).handlerAnswer,
            undefined,
        );
    const pending = {
        status: "requires_interaction",
        prompt: {
            type: "question",
            message: request.question,
            choices: request.choices,
        },
        operationId: "o",
        scopeId: "s",
        interactionId: "i",
    };
    const results = [
        { toolCallId: "t", result: { structuredContent: pending } },
    ];
    const context = fileConsentContext(
        [{ ...tool, endMs: 1 }],
        results,
        events,
        request,
    );
    assert.equal(context.pending, pending);
    assert.deepEqual(context.handlerAnswer, { type: "question", selected: 0 });
    assert.equal(
        fileConsentContext(
            [{ ...tool, endMs: 1 }],
            [{ ...results[0], toolCallId: "old" }],
            events,
            request,
        ).handlerAnswer,
        undefined,
    );
});

test("old or incomplete preflights cannot run the new corpus", () => {
    const readiness = {
        corpusVersion,
        status: "passed",
        externalEvidence: [
            "listFiles",
            "readFile",
            "writeFile",
            "copyFile",
        ].map((actionName) => ({
            actionName,
            outcome: { status: "completed" },
        })),
    };
    assert.doesNotThrow(() => assertCorpusReadiness(readiness));
    for (const value of [
        { ...readiness, corpusVersion: undefined },
        { ...readiness, status: "failed" },
        {
            ...readiness,
            externalEvidence: readiness.externalEvidence.slice(0, 3),
        },
    ])
        assert.throws(() => assertCorpusReadiness(value), /Fresh common-files/);
});

test("oracles detect backup loss, unrelated changes, additions and wrong removal", () => {
    const expected = expectedFiles("M3", 3);
    assert.equal(
        gradeFileState("M3", { files: expected, invalidEntries: [] }, 3),
        true,
    );
    for (const files of [
        { ...expected, "grocery-backup.txt": "bread\noranges\n" },
        { ...expected, "grocery-backup.txt": "milk\r\neggs\r\nrice\r\n" },
        { ...expected, "trip.txt": "changed" },
        { ...expected, "extra.txt": "unrequested" },
        fileFixture,
    ])
        assert.equal(
            gradeFileState("M3", { files, invalidEntries: [] }, 3),
            false,
        );
    assert.equal(
        gradeFileState(
            "A4",
            {
                files: { ...fileFixture, "grocery.txt": "milk\neggs\n" },
                invalidEntries: [],
            },
            3,
        ),
        false,
    );
    assert.equal(
        gradeFileState(
            "S4",
            {
                files: {
                    ...fileFixture,
                    "grocery.txt": "milk\r\neggs\r\nrice\r\napples\r\n",
                },
                invalidEntries: [],
            },
            3,
        ),
        true,
    );
});

test("clarification is necessary even when the eventual file state is correct", () => {
    const result = {
        status: "completed_ungraded",
        caseId: "A4",
        answer: "Removed eggs.",
        routeViolations: [],
        grade: {
            fileStateMatchesOracle: true,
            listStateUnchanged: true,
            clarificationRequested: true,
            noPrematureFileMutation: false,
        },
    };
    assert.equal(
        preliminaryGrade(result, {}).reason,
        "clarification_not_verified_before_effects",
    );
    assert.equal(filePolicy("A4").writesEnabled, false);
    assert.equal(filePolicy("A4", true).writesEnabled, true);
    assert.equal(filePolicy("A2").readsEnabled, false);
});

test("write confirmations reject wrong content, targets and destructive replacements", () => {
    const root = path.resolve("fixtures");
    const write = (name, content, append = false) => ({
        schemaName: "powershell.powershell-files",
        actionName: "writeFile",
        parameters: { path: path.join(root, name), content, append },
    });
    assert.equal(
        fixtureConfirmationAllowed(
            "A4",
            write("grocery.txt", "milk\nrice\n"),
            root,
        ),
        true,
    );
    for (const action of [
        write("grocery.txt", ""),
        write("grocery.txt", "milk\neggs\n"),
        write("pantry.txt", "milk\nrice\n"),
        write("grocery.txt", "milk\nrice\n", true),
    ])
        assert.equal(fixtureConfirmationAllowed("A4", action, root), false);
    assert.equal(
        fixtureConfirmationAllowed(
            "R5",
            write("errands.txt", "Exact title", true),
            root,
            "Exact title",
        ),
        true,
    );
    assert.equal(
        fixtureConfirmationAllowed(
            "R5",
            write("errands.txt", "Guessed title", true),
            root,
            "Exact title",
        ),
        false,
    );
});

test("fixture restoration removes previous backups and snapshots reject link escapes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-corpus-"));
    try {
        restoreFiles(root);
        assert.equal(fileStateMatches(snapshotFiles(root), fileFixture), true);
        fs.writeFileSync(path.join(root, "grocery-backup.txt"), "old");
        restoreFiles(root);
        assert.equal(
            fs.existsSync(path.join(root, "grocery-backup.txt")),
            false,
        );
        fs.linkSync(
            path.join(root, "grocery.txt"),
            path.join(root, "grocery-backup.txt"),
        );
        assert.equal(fileStateMatches(snapshotFiles(root), fileFixture), false);
        assert.throws(() => restoreFiles(root), /Unsafe fixture/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
