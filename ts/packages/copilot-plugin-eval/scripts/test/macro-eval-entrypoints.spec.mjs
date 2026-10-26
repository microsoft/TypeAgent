// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseMacroArguments } from "../macro-eval.mjs";

const entry = fileURLToPath(new URL("../macro-eval.mjs", import.meta.url));
const corpus = {
    protocolVersion: "macro-user-e2e-v1",
    status: "ready-for-rehearsal-unexecuted",
    familyId: "exact-document-lookup-fetch",
    documents: [
        {
            key: "a",
            title: "Alpha",
            expectedId: "doc-a",
            content: "ALPHA\nMARKER",
        },
    ],
    training: [{ id: "source", prompt: "Read Alpha", expectedDocument: "a" }],
    heldOutPositive: [
        { id: "read", prompt: "Show Alpha", expectedDocument: "a" },
    ],
    negativeOrAmbiguous: [],
    contextualConversations: [],
};

function invoke(args, cwd) {
    const result = spawnSync(process.execPath, [entry, ...args], {
        encoding: "utf8",
        cwd,
        timeout: 30000,
    });
    assert.ifError(result.error);
    return result;
}

test("macro entrypoint rejects unknown, duplicate and missing options", () => {
    for (const args of [
        ["run"],
        ["plan", "--output", "x"],
        ["report", "--input", "x"],
        ["report", "--input", "x", "--output", "y", "--output", "z"],
        ["report", "--input", "x", "--output", "y", "--seed", "1"],
        [
            "plan",
            "--corpus",
            "x",
            "--output",
            "y",
            "--runner-model",
            "gpt-6-luna",
        ],
        [
            "native",
            "--corpus",
            "x",
            "--input",
            "y",
            "--output",
            "z",
            "--console-helper-dir",
            "old-launcher",
        ],
    ])
        assert.throws(() => parseMacroArguments(args));
    assert.deepEqual(parseMacroArguments(["--help"]), { help: true });
});

test("offline planning works from a fresh external cwd and refuses output overwrite", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "macro-plan-entry-"));
    try {
        const input = path.join(root, "corpus.json");
        const output = path.join(root, "plan.json");
        fs.writeFileSync(input, JSON.stringify(corpus));
        const args = [
            "plan",
            "--corpus",
            input,
            "--output",
            output,
            "--mode",
            "paired",
            "--cases",
            "read",
            "--repetitions",
            "10",
            "--seed",
            "17",
            "--root-model",
            "gpt-5.6-sol",
            "--max-target-model-turns",
            "100",
            "--max-duration-ms",
            "600000",
        ];
        assert.equal(invoke(args, root).status, 0);
        const plan = JSON.parse(fs.readFileSync(output, "utf8"));
        assert.equal(plan.schedule.length, 20);
        assert.equal(plan.acceptance, "unexecuted");
        assert.match(plan.corpusHash, /^[a-f0-9]{64}$/);
        const second = invoke(args, root);
        assert.equal(second.status, 1);
        assert.match(second.stderr, /must not already exist/);
        assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), plan);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("missing evidence persists an invalid grade and exits unsuccessfully", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "macro-grade-entry-"));
    try {
        const input = path.join(root, "corpus.json");
        const evidence = path.join(root, "evidence.json");
        const output = path.join(root, "grade.json");
        fs.writeFileSync(input, JSON.stringify(corpus));
        fs.writeFileSync(evidence, JSON.stringify({ scenarioId: "read" }));
        const result = invoke(
            [
                "grade",
                "--corpus",
                input,
                "--input",
                evidence,
                "--output",
                output,
            ],
            root,
        );
        assert.equal(result.status, 1);
        const grade = JSON.parse(fs.readFileSync(output, "utf8"));
        assert.equal(grade.grade.status, "harness-invalid");
        assert.equal(grade.grade.taskCorrect, null);
        assert.ok(grade.grade.errors.length > 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
