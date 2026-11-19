// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "./quality-contract.mjs";
import {
    capturedRequestContains,
    validateRequestCapture,
} from "./quality-request-capture.mjs";

function fixture() {
    const requests = ["normal", "validation", "contract-repair"].map(
        (kind, index) => ({
            file: `calls/${index}/request.json`,
            body: JSON.stringify({
                messages: [
                    {
                        role: "user",
                        content: JSON.stringify({
                            fragments: [{ text: `${kind} evidence` }],
                        }),
                    },
                ],
            }),
        }),
    );
    const manifest = {
        schemaVersion: 1,
        contract: "memory-request-capture-v1",
        caseId: "case",
        requestEvidenceKind: "admitted-dispatch-body",
        calls: requests.map((request, index) => ({
            id: String(index),
            checkpoint: 1,
            operation:
                index === 1
                    ? "memory_informational_support:validation"
                    : `informational_wiki:${index === 0 ? "normal" : "contract-repair"}`,
            requestFile: request.file,
            requestHash: sha256(request.body),
            outcome: { state: "returned", elapsedMs: 1 },
            usage: null,
        })),
    };
    return {
        contract: manifest.contract,
        manifest: JSON.stringify(manifest),
        requests,
    };
}

test("capture selection uses construction and repair evidence, never auditor-only evidence", () => {
    const capture = fixture();
    assert.deepEqual(validateRequestCapture(capture, "case"), [
        capture.requests[0].body,
        capture.requests[2].body,
    ]);
});

test("selection decodes actual provider JSON escaping but never credits rejected-output-only claims", () => {
    const quote = 'First line\nA "quoted" claim.';
    const payload = {
        fragments: [{ text: quote }],
        rejected: { summary: "Rejected-only assertion" },
    };
    for (const body of [
        { messages: [{ role: "user", content: JSON.stringify(payload) }] },
        {
            input: [
                {
                    role: "user",
                    content: [
                        { type: "input_text", text: JSON.stringify(payload) },
                    ],
                },
            ],
        },
    ]) {
        const request = JSON.stringify(body);
        assert.equal(capturedRequestContains(request, quote), true);
        assert.equal(
            capturedRequestContains(request, "Rejected-only assertion"),
            false,
        );
    }
});

test("completion results are separately hash-bound and missing or tampered candidates cannot qualify", () => {
    const capture = fixture();
    const manifest = JSON.parse(capture.manifest);
    const result = {
        file: "calls/0/result.json",
        body: JSON.stringify({ success: true, data: "untrusted candidate" }),
    };
    manifest.calls[0].result = { file: result.file, hash: sha256(result.body) };
    capture.manifest = JSON.stringify(manifest);
    assert.throws(
        () => validateRequestCapture(capture, "case"),
        /completion result/i,
    );
    capture.results = [result];
    assert.doesNotThrow(() => validateRequestCapture(capture, "case"));
    capture.results[0].body += "\n";
    assert.throws(
        () => validateRequestCapture(capture, "case"),
        /completion result/i,
    );
});

for (const mode of [
    "missing-body",
    "tampered-body",
    "duplicate",
    "snapshot",
    "wrong-case",
    "concatenation",
]) {
    test(`capture rejects ${mode}`, () => {
        const capture = fixture();
        const manifest = JSON.parse(capture.manifest);
        if (mode === "missing-body") capture.requests.pop();
        if (mode === "tampered-body") capture.requests[0].body += " ";
        if (mode === "duplicate") manifest.calls.push(manifest.calls[0]);
        if (mode === "snapshot")
            manifest.requestEvidenceKind = "indexed-build-snapshot";
        if (mode === "wrong-case") manifest.caseId = "other";
        if (mode === "concatenation") {
            capture.requests[0].body = "[]";
            manifest.calls[0].requestHash = sha256("[]");
        }
        capture.manifest = JSON.stringify(manifest);
        assert.throws(() => validateRequestCapture(capture, "case"));
    });
}
