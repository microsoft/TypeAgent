// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { check, identity, sha256, unique } from "./quality-contract.mjs";

function evidenceKey(citation) {
    return identity([
        citation.sourceId,
        citation.revisionId,
        citation.locator,
        citation.excerpt,
    ]);
}

function acceptedPassages(view) {
    const passages = view.generation?.input?.inputs?.flatMap(
        (input) => input.passages ?? [],
    );
    check(passages?.length, "Original accepted selection required");
    const keys = new Set(passages.map(evidenceKey));
    check(
        (view.content.citations ?? []).every((citation) =>
            keys.has(evidenceKey(citation)),
        ),
        "Accepted citation absent from original selection",
    );
    return passages;
}

export function validateCitationCapture(capture, saved) {
    const view = JSON.parse(saved);
    check(
        capture.savedHash === identity(saved) &&
            capture.viewId === view.viewId &&
            capture.revisionId === view.revisionId,
        "Unbound citation capture",
    );
    const expected = new Set(acceptedPassages(view).map(evidenceKey));
    check(
        capture.selectedEvidence.length === expected.size &&
            capture.citationResolutions.length === expected.size,
        "Incomplete citation capture",
    );
    const seen = new Set();
    for (const receipt of capture.citationResolutions) {
        const key = evidenceKey(receipt);
        const match = /^indexed:\d+:([a-f0-9]{64}):(\d+)-(\d+)$/.exec(
            receipt.locator,
        );
        check(
            expected.has(key) && !seen.has(key),
            "Unexpected or duplicate citation receipt",
        );
        seen.add(key);
        check(
            capture.selectedEvidence.some(
                (evidence) =>
                    evidenceKey(evidence) === key &&
                    evidence.blockText === receipt.blockText,
            ) &&
                match &&
                sha256(receipt.blockText) === match[1] &&
                receipt.blockText.slice(Number(match[2]), Number(match[3])) ===
                    receipt.excerpt &&
                receipt.sourceRead.response.content.includes(receipt.blockText),
            "Indexed block hash/excerpt mismatch",
        );
        for (const [request, response] of [
            [receipt.request, receipt.response],
            [receipt.sourceRead.request, receipt.sourceRead.response],
        ]) {
            check(
                request.corpusId === view.corpusId &&
                    response.corpusId === view.corpusId &&
                    request.sourceId === receipt.sourceId &&
                    response.sourceId === receipt.sourceId &&
                    request.revisionId === receipt.revisionId &&
                    response.revisionId === receipt.revisionId &&
                    response.truncated === false,
                "Service citation identity/truncation mismatch",
            );
        }
        check(
            receipt.method === "getSourceContent" &&
                receipt.request.indexedLocator === receipt.locator &&
                receipt.response.content === receipt.excerpt &&
                receipt.resolvedText === receipt.excerpt,
            "Service citation excerpt mismatch",
        );
    }
}

export async function captureCitationResolutions(service, saved) {
    const view = JSON.parse(saved);
    check(view.corpusId && view.revisionId, "Accepted view identity required");
    const passages = acceptedPassages(view);
    const selectedEvidence = [];
    const citationResolutions = [];
    const seen = new Set();
    for (const citation of passages) {
        const key = evidenceKey(citation);
        if (seen.has(key)) continue;
        seen.add(key);
        const request = {
            corpusId: view.corpusId,
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            indexedLocator: citation.locator,
        };
        const startedAt = new Date().toISOString();
        const response = await service.getSourceContent(request);
        check(
            response.corpusId === view.corpusId &&
                response.sourceId === citation.sourceId &&
                response.revisionId === citation.revisionId &&
                !response.truncated &&
                response.content === citation.excerpt,
            "Service citation identity/excerpt mismatch",
        );
        const sourceRequest = {
            corpusId: view.corpusId,
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            maxChars: 100_000,
        };
        const original = await service.getSourceContent(sourceRequest);
        check(!original.truncated, "Retained source capture was truncated");
        const match = /^indexed:\d+:([a-f0-9]{64}):(\d+)-(\d+)$/.exec(
            citation.locator,
        );
        check(match, "Indexed citation locator required");
        const blockText = [
            original.content,
            ...original.content.split(/\r?\n\s*\r?\n/),
        ]
            .flatMap((text) => [text, text.trim()])
            .find((text) => sha256(text) === match[1]);
        check(
            blockText !== undefined &&
                blockText.slice(Number(match[2]), Number(match[3])) ===
                    citation.excerpt,
            "Full original indexed block unavailable for citation receipt",
        );
        const evidence = { corpusId: view.corpusId, ...citation, blockText };
        selectedEvidence.push(evidence);
        citationResolutions.push({
            ...evidence,
            resolvedText: response.content,
            method: "getSourceContent",
            request,
            response,
            sourceRead: { request: sourceRequest, response: original },
            startedAt,
            completedAt: new Date().toISOString(),
        });
    }
    const capture = {
        schemaVersion: 1,
        savedHash: identity(saved),
        viewId: view.viewId,
        revisionId: view.revisionId,
        selectedEvidence,
        citationResolutions,
    };
    validateCitationCapture(capture, saved);
    return capture;
}

export function captureProviderEvents(events, jobs) {
    check(Array.isArray(events), "Provider event array required");
    check(
        events.every(
            (event) => Number.isSafeInteger(event.ordinal) && event.ordinal > 0,
        ) &&
            new Set(events.map((event) => event.ordinal)).size ===
                events.length,
        "Unique positive provider event ordinals required",
    );
    return events.map((event) => {
        check(
            ["complete", "failed", "error", "started"].includes(event.status),
            "Unknown provider event status",
        );
        const request = event.actualSerializedRequest ?? null;
        check(
            request === null || typeof request === "string",
            "Actual serialized request must be retained text, not an inspection",
        );
        const parsed = request === null ? null : JSON.parse(request);
        const startedAt = Date.parse(event.startedAt);
        check(Number.isFinite(startedAt), "Provider event timestamp required");
        const matches = jobs.filter(
            (job) =>
                Date.parse(job.createdAt) <= startedAt &&
                startedAt <= Date.parse(job.updatedAt),
        );
        check(matches.length <= 1, "Ambiguous checkpoint job windows");
        const usage = event.usage;
        const tokens = usage?.total_tokens ?? null;
        check(
            tokens === null || (Number.isSafeInteger(tokens) && tokens >= 0),
            "Invalid measured provider tokens",
        );
        const latencyMs = event.latencyMs ?? null;
        check(
            latencyMs === null ||
                (Number.isFinite(latencyMs) && latencyMs >= 0),
            "Invalid provider latency",
        );
        return {
            ordinal: event.ordinal,
            checkpoint: matches[0]?.checkpoint ?? null,
            association: matches.length
                ? "retained-job-time-window"
                : "unassigned-case-call",
            status: event.status,
            schema: event.schema ?? null,
            startedAt: event.startedAt,
            actualSerializedRequest: request,
            requestHash: request === null ? null : identity(request),
            requestBytesHash: request === null ? null : sha256(request),
            promptHash: parsed?.messages ? identity(parsed.messages) : null,
            schemaHash: parsed?.response_format
                ? identity(parsed.response_format)
                : null,
            settingsHash:
                parsed === null
                    ? null
                    : identity(
                          Object.fromEntries(
                              Object.entries(parsed).filter(
                                  ([key]) =>
                                      !["messages", "response_format"].includes(
                                          key,
                                      ),
                              ),
                          ),
                      ),
            providerModel: event.providerModel ?? null,
            usage: usage ?? null,
            telemetry: {
                calls: 1,
                tokens,
                reservations: null,
                latencyMs,
                cost: null,
            },
            selectedEvidenceKind: "not-inferred-from-request-inspection",
        };
    });
}

export function scheduledCheckpoints(frozen, results) {
    const observed = unique(results, "caseId", "observed cases");
    const scheduled = unique(frozen.schedule, "id", "frozen schedule");
    for (const id of observed.keys())
        check(scheduled.has(id), "Unscheduled observed case");
    const slots = [];
    for (const entry of scheduled.values()) {
        check(
            Number.isSafeInteger(entry.checkpoints) && entry.checkpoints > 0,
            "Positive checkpoint count required",
        );
        const rows = observed.get(entry.id)?.checkpoints ?? [];
        const checkpoints = new Map();
        for (const row of rows) {
            check(
                Number.isSafeInteger(row.checkpoint) &&
                    row.checkpoint >= 0 &&
                    row.checkpoint < entry.checkpoints &&
                    !checkpoints.has(row.checkpoint),
                "Unknown/duplicate observed checkpoint",
            );
            checkpoints.set(row.checkpoint, row);
        }
        for (let checkpoint = 0; checkpoint < entry.checkpoints; checkpoint++) {
            const result = checkpoints.get(checkpoint);
            slots.push({
                caseId: entry.id,
                scenario: entry.scenario,
                kind: entry.kind,
                topics: entry.topics === true,
                checkpoint,
                status: result?.status ?? "missing",
                stage:
                    result?.stage ??
                    (result?.status === "saved" ? "saved" : "unknown"),
                reason:
                    result?.reason ??
                    result?.error ??
                    (result
                        ? "Retained runner outcome"
                        : "No outcome retained"),
                result: result ?? null,
            });
        }
    }
    return slots;
}
