// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { check, sha256, unique } from "./quality-contract.mjs";

const constructionOperations = new Set([
    "informational_wiki:normal",
    "informational_wiki:contract-repair",
    "informational_project_summary:normal",
    "informational_project_summary:contract-repair",
]);

export function capturedConstructionRequests(capture) {
    const manifest = JSON.parse(capture.manifest);
    const bodies = new Map(
        capture.requests.map((entry) => [entry.file, entry.body]),
    );
    return manifest.calls
        .filter((call) => constructionOperations.has(call.operation))
        .map((call) => bodies.get(call.requestFile));
}

export function capturedRequestContains(request, quote) {
    const body = JSON.parse(request);
    const messages = body.messages ?? body.input;
    check(
        Array.isArray(messages),
        "Captured construction requires chat messages or Responses input",
    );
    return messages
        .filter((message) => message.role === "user")
        .some((message) => {
            const contents =
                typeof message.content === "string"
                    ? [message.content]
                    : message.content?.map((part) => part.text);
            check(
                Array.isArray(contents),
                "Captured construction user content required",
            );
            return contents.some((content) => {
                const payload = JSON.parse(content);
                check(
                    Array.isArray(payload.fragments),
                    "Captured construction original fragments required",
                );
                return payload.fragments.some((fragment) =>
                    [fragment.text, fragment.excerpt].some(
                        (text) =>
                            typeof text === "string" && text.includes(quote),
                    ),
                );
            });
        });
}

function validateCompletionResults(calls, files) {
    const results = unique(files ?? [], "file", "captured completion results");
    const used = new Set();
    for (const call of calls.values()) {
        if (call.result === undefined) continue;
        const result = results.get(call.result.file);
        check(
            result &&
                typeof result.body === "string" &&
                sha256(result.body) === call.result.hash,
            "Missing or tampered completion result",
        );
        check(!used.has(result.file), "Completion result file reused");
        used.add(result.file);
        const parsed = JSON.parse(result.body);
        check(
            parsed &&
                typeof parsed.success === "boolean" &&
                typeof (parsed.success ? parsed.data : parsed.message) ===
                    "string",
            "Invalid captured completion result",
        );
        check(
            !parsed.success || call.outcome?.state === "returned",
            "Successful completion requires a returned dispatch",
        );
    }
    check(used.size === results.size, "Unbound completion result files");
}

export function validateRequestCapture(capture, caseId, options = {}) {
    check(
        capture?.contract === "memory-request-capture-v1",
        "Unknown request capture contract",
    );
    check(
        typeof capture.manifest === "string",
        "Exact capture manifest required",
    );
    const manifest = JSON.parse(capture.manifest);
    check(
        manifest.schemaVersion === 1 &&
            manifest.contract === capture.contract &&
            manifest.caseId === caseId &&
            manifest.requestEvidenceKind === "admitted-dispatch-body",
        "Capture identity or evidence kind mismatch",
    );
    const calls = unique(manifest.calls, "id", "captured calls");
    const requests = unique(
        capture.requests,
        "file",
        "captured request bodies",
    );
    check(
        calls.size === requests.size,
        "Every dispatch requires an exact captured body",
    );
    const files = new Set();
    for (const call of calls.values()) {
        if (options.requireComplete)
            check(
                call.outcome !== null,
                "Successful output cannot contain an unfinished captured dispatch",
            );
        check(
            typeof call.operation === "string" && call.operation.trim(),
            "Captured operation required",
        );
        check(
            Number.isSafeInteger(call.checkpoint) && call.checkpoint >= 0,
            "Invalid captured checkpoint",
        );
        const request = requests.get(call.requestFile);
        check(
            request && typeof request.body === "string",
            "Missing captured request body",
        );
        check(!files.has(call.requestFile), "Captured request file reused");
        files.add(call.requestFile);
        check(
            sha256(request.body) === call.requestHash,
            "Admitted request hash mismatch",
        );
        const body = JSON.parse(request.body);
        check(
            body && typeof body === "object" && !Array.isArray(body),
            "Captured body must be one JSON request",
        );
        check(
            !("headers" in body),
            "Capture must not contain authentication headers",
        );
        if (call.outcome !== null) {
            check(
                ["returned", "failed"].includes(call.outcome?.state),
                "Invalid dispatch outcome",
            );
            check(
                Number.isFinite(call.outcome.elapsedMs) &&
                    call.outcome.elapsedMs >= 0,
                "Invalid dispatch latency",
            );
        }
        validateCompletionResults(calls, capture.results);
        if (call.usage !== null) {
            check(
                call.outcome?.state === "returned",
                "Usage requires a returned dispatch",
            );
            for (const key of [
                "prompt_tokens",
                "completion_tokens",
                "total_tokens",
            ])
                check(
                    Number.isSafeInteger(call.usage?.[key]) &&
                        call.usage[key] >= 0,
                    "Invalid measured usage",
                );
        }
    }
    return capturedConstructionRequests(capture);
}
