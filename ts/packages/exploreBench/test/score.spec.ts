// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { isUsableFinalAnswer } from "../src/runner.js";
import { parsePatch, scoreSwebench } from "../src/score.js";

const patch = `diff --git a/astropy/modeling/separable.py b/astropy/modeling/separable.py
--- a/astropy/modeling/separable.py
+++ b/astropy/modeling/separable.py
@@ -242,7 +242,7 @@ def _cstack(left, right):
-        cright[-right.shape[0]:, -right.shape[1]:] = 1
+        cright[-right.shape[0]:, -right.shape[1]:] = right
`;

test("scores exact SWE-bench file and line citations", () => {
    const score = scoreSwebench(
        "<final_answer>\nastropy/modeling/separable.py:242-248 bad stack assignment\n</final_answer>",
        patch,
        "/testbed",
    );
    assert.equal(score.validFinalAnswer, true);
    assert.equal(score.file.precision, 1);
    assert.equal(score.file.recall, 1);
    assert.equal(score.line.precision, 1);
    assert.equal(score.line.recall, 1);
    assert.equal(isUsableFinalAnswer(score), true);
});

test("malformed or empty final answers are retryable failures", () => {
    assert.equal(
        isUsableFinalAnswer(scoreSwebench("plain prose", patch)),
        false,
    );
    assert.equal(
        isUsableFinalAnswer(
            scoreSwebench("<final_answer>\n</final_answer>", patch),
        ),
        false,
    );
});

test("pure-addition hunks keep the file gold without inventing source lines", () => {
    const addition = `diff --git a/pkg/a.py b/pkg/a.py
--- a/pkg/a.py
+++ b/pkg/a.py
@@ -10,0 +11,2 @@
+first
+second
`;
    assert.deepEqual(parsePatch(addition), [
        { path: "pkg/a.py", startLine: 10, endLine: 9 },
    ]);
    const score = scoreSwebench(
        "<final_answer>\npkg/a.py:10 likely insertion site\n</final_answer>",
        addition,
    );
    assert.equal(score.file.recall, 1);
    assert.equal(score.line.nPatch, 0);
});

test("scores huge citation ranges with bounded interval math", () => {
    const score = scoreSwebench(
        "<final_answer>\nastropy/modeling/separable.py:1-1000000000 broad range\n</final_answer>",
        patch,
    );
    assert.equal(score.line.nCitation, 1_000_000_000);
    assert.equal(score.line.nPatch, 7);
    assert.equal(score.line.recall, 1);
    assert.equal(score.line.precision, 7 / 1_000_000_000);
});

test("rejects citation line numbers outside the safe integer range", () => {
    const score = scoreSwebench(
        "<final_answer>\nastropy/modeling/separable.py:1-9007199254740992 unsafe\n</final_answer>",
        patch,
    );
    assert.equal(score.citations.length, 0);
    assert.equal(score.nBrokenLines, 1);
});
