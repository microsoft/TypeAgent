// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
    getScenarioCases,
    loadScenarioCorpus,
    validateScenarioCorpus,
} from "../macro-eval-corpus.mjs";

function corpus() {
    return {
        protocolVersion: "macro-user-e2e-v1",
        status: "ready-for-rehearsal-unexecuted",
        familyId: "exact-document-lookup-fetch",
        documents: [
            {
                key: "a",
                title: "A title",
                expectedId: "synthetic-doc-a",
                content: "A title\nFULL-A",
            },
        ],
        training: [
            { id: "source", prompt: "Read A title.", expectedDocument: "a" },
        ],
        heldOutPositive: [
            {
                id: "positive",
                prompt: "Open A title.",
                stratum: "changed-wording",
                expectedDocument: "a",
            },
        ],
        negativeOrAmbiguous: [
            {
                id: "negative",
                prompt: "Do not open A title.",
                wholeMacroInvocations: 0,
                forbiddenEffects: ["fetch-document"],
            },
        ],
        contextualConversations: [
            {
                id: "conversation",
                status: "pending",
                messages: [
                    {
                        role: "user",
                        prompt: "Which document?",
                        expectedBehavior: "clarify-without-task-calls",
                    },
                ],
            },
        ],
    };
}

test("synchronous load preserves documents, held-out prompts, strata and messages", () => {
    const directory = fs.mkdtempSync(
        path.join(import.meta.dirname, ".macro-corpus-"),
    );
    try {
        const file = path.join(directory, "corpus.json");
        fs.writeFileSync(file, JSON.stringify(corpus()));
        const loaded = loadScenarioCorpus(file);
        assert.deepEqual(loaded, corpus());
        const cases = getScenarioCases(loaded);
        assert.deepEqual(
            cases.map((value) => value.kind),
            ["training", "positive", "negative", "conversation"],
        );
        assert.equal(cases[1].stratum, "changed-wording");
        assert.equal(cases[1].status, "ready-for-rehearsal-unexecuted");
        assert.equal(cases[3].status, "pending");
        assert.deepEqual(
            cases[3].messages,
            loaded.contextualConversations[0].messages,
        );
        assert.deepEqual(loaded.documents[0], corpus().documents[0]);
        fs.writeFileSync(file, "{");
        assert.throws(() => loadScenarioCorpus(file), SyntaxError);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("strict corpus validation rejects wrong references, duplicates and unsupported inputs", () => {
    const changes = [
        (value) => {
            value.protocolVersion = "unsupported";
        },
        (value) => {
            value.status = "accepted";
        },
        (value) => {
            value.documents[0].content = "";
        },
        (value) => {
            value.documents.push({ ...value.documents[0], key: "b" });
        },
        (value) => {
            value.heldOutPositive[0].expectedDocument = "missing";
        },
        (value) => {
            value.heldOutPositive[0].stratum = 42;
        },
        (value) => {
            value.heldOutPositive[0].id = "source";
        },
        (value) => {
            value.negativeOrAmbiguous[0].wholeMacroInvocations = undefined;
        },
        (value) => {
            value.negativeOrAmbiguous[0].forbiddenEffects = "fetch-document";
        },
        (value) => {
            value.contextualConversations[0].messages = [];
        },
        (value) => {
            value.training[0].status = "frozen";
        },
        (value) => {
            value.reviewedCases = [{ id: "bad", kind: "unknown" }];
        },
    ];
    for (const change of changes) {
        const value = corpus();
        change(value);
        assert.throws(
            () => validateScenarioCorpus(value),
            /Invalid scenario corpus/,
        );
    }
    for (const value of [null, [], "corpus"])
        assert.throws(
            () => validateScenarioCorpus(value),
            /root must be an object/,
        );
});

test("reviewed unsupported families must be explicitly pending or blocked with a reason", () => {
    const value = corpus();
    value.reviewedCases = [
        {
            id: "file",
            kind: "positive",
            familyId: "file-read-copy",
            prompt: "Copy file.",
            status: "blocked",
            blockedReason: "No adapter or oracle.",
        },
    ];
    assert.equal(getScenarioCases(value).at(-1).status, "blocked");
    value.reviewedCases[0].status = "ready-for-rehearsal-unexecuted";
    assert.throws(() => getScenarioCases(value), /unsupported family/);
    value.reviewedCases[0].status = "pending";
    delete value.reviewedCases[0].blockedReason;
    assert.throws(() => getScenarioCases(value), /blockedReason/);
});
