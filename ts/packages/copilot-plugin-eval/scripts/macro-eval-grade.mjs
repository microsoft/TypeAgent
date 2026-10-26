// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { documentFamilyId } from "./macro-eval-corpus.mjs";
import { isTrustedNormalHookCallback } from "./macro-eval-native-callback.mjs";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { macroProtocolVersion } from "./macro-eval-plan.mjs";
import {
    gradeProgramEvidence,
    programDisplayAnswer,
} from "./macro-eval-program.mjs";

export const nativeOrdinaryCallbackContract = "native-normal-hook-callback-v1";
export const nativeSelectedSourceContract =
    "native-finalized-selected-source-v1";
export const syntheticDocumentRenderingContract =
    "synthetic-document-rendering-v2";
export const syntheticDocumentFenceRenderingContract =
    "synthetic-document-rendering-v3";
export const syntheticDocumentBlockquoteRenderingContract =
    "synthetic-document-rendering-v4";
export const syntheticDocumentSimilarityContract =
    "synthetic-document-similarity-v5";

const similarityMetricVersion = "ordered-levenshtein-codepoints-v1";
const similarityLimits = Object.freeze({
    answerCodeUnits: 65536,
    documentCodepoints: 1024,
    regionLines: 64,
    candidates: 8,
    workCells: 2000000,
});

const supportedBehaviors = new Set([
    "clarify-without-guessed-title",
    "clarify-without-task-calls",
]);
const effectName = (name) => name.toLowerCase().replaceAll("_", "-");
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isTurnId = (value) =>
    isText(value) || (Number.isInteger(value) && value >= 0);
const isRecord = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isDigest = (value) =>
    typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

function exactKeys(value, required, optional = []) {
    return (
        isRecord(value) &&
        required.every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) =>
            [...required, ...optional].includes(key),
        )
    );
}

export function validateSyntheticRenderingContract(value) {
    if (value?.protocolVersion === syntheticDocumentSimilarityContract)
        return validateSimilarityDeclaration(value);
    if (
        !exactKeys(value, ["protocolVersion", "fixtureShape"]) ||
        ![
            syntheticDocumentRenderingContract,
            syntheticDocumentFenceRenderingContract,
            syntheticDocumentBlockquoteRenderingContract,
        ].includes(value.protocolVersion) ||
        value.fixtureShape !== "synthetic-prose-lines-v1"
    )
        throw new Error(
            "Invalid synthetic rendering contract: expected exact synthetic-document-rendering-v2, synthetic-document-rendering-v3 or synthetic-document-rendering-v4 / synthetic-prose-lines-v1 opt-in",
        );
    return value;
}

function protectedDocumentShape(record) {
    return (
        exactKeys(record, [
            "key",
            "title",
            "expectedId",
            "contentSha256",
            "markers",
        ]) &&
        ["key", "title", "expectedId"].every(
            (key) => isText(record[key]) && record[key].length <= 256,
        ) &&
        isDigest(record.contentSha256) &&
        Array.isArray(record.markers) &&
        record.markers.length === 2 &&
        record.markers.every(
            (marker) =>
                isText(marker) &&
                marker.length <= 256 &&
                !/[\r\n]/u.test(marker),
        ) &&
        record.markers[0] !== record.markers[1] &&
        !record.markers.includes(record.title)
    );
}

function uniqueProtectedRecords(records) {
    return (
        ["key", "title", "expectedId"].every(
            (field) =>
                new Set(records.map((record) => record[field])).size ===
                records.length,
        ) &&
        new Set(records.flatMap((record) => record.markers)).size ===
            records.length * 2
    );
}

function validateSimilarityDeclaration(value) {
    if (
        !exactKeys(value, [
            "protocolVersion",
            "fixtureShape",
            "fixtureId",
            "algorithm",
            "threshold",
            "protectedDocuments",
        ]) ||
        value.protocolVersion !== syntheticDocumentSimilarityContract ||
        value.fixtureShape !== "synthetic-prose-lines-v1" ||
        value.fixtureId !== "macro-eval-synthetic-prose-fixture-v1" ||
        value.algorithm !== similarityMetricVersion ||
        value.threshold !== 0.9 ||
        !Array.isArray(value.protectedDocuments) ||
        value.protectedDocuments.length === 0 ||
        value.protectedDocuments.length > 32 ||
        !value.protectedDocuments.every(protectedDocumentShape) ||
        !uniqueProtectedRecords(value.protectedDocuments)
    )
        throw new Error(
            "Invalid experimental synthetic scoring declaration: exact known fixture/algorithm, threshold 0.9 and unique complete protected-document metadata are required",
        );
    return value;
}

function protectedDocumentMatches(record, document) {
    const lines = document.content.split("\n");
    return (
        supportedSyntheticProse(document) &&
        lines.length >= 4 &&
        lines.length <= similarityLimits.regionLines &&
        document.content.length <= similarityLimits.documentCodepoints &&
        record.title === document.title &&
        record.expectedId === document.expectedId &&
        record.contentSha256 === sha256(document.content) &&
        record.markers[0] === lines[1] &&
        record.markers[1] === lines.at(-1) &&
        [record.title, ...record.markers].every(
            (line) => normalizeDisplayLine(line) === line,
        )
    );
}

export function validateSyntheticDocumentScoringContract(contract, corpus) {
    validateSimilarityDeclaration(contract);
    const documents = corpus?.documents;
    if (
        !validDocuments(documents) ||
        documents.length !== contract.protectedDocuments.length ||
        new Set(documents.map((document) => document.key)).size !==
            documents.length
    )
        throw new Error(
            "Experimental scoring requires protected metadata for ALL current trusted fixture documents",
        );
    for (const record of contract.protectedDocuments) {
        const document = documents.find((entry) => entry.key === record.key);
        if (!document || !protectedDocumentMatches(record, document))
            throw new Error(
                `Unknown or changed protected fixture ${record.key}: title, ID, original content hash and exact first/last marker roles must match the current corpus`,
            );
    }
    return contract;
}

function renderingContractErrors(value) {
    if (value === undefined) return [];
    try {
        validateSyntheticRenderingContract(value);
        return [];
    } catch (error) {
        return [error.message];
    }
}

function supportedSyntheticProse(document) {
    const lines = document.content.split("\n");
    return (
        /^synthetic-doc-[a-z0-9-]+$/u.test(document.expectedId) &&
        lines.length >= 2 &&
        lines[0] === document.title &&
        lines.every(
            (line) =>
                line === line.trim() &&
                /^[A-Za-z0-9][A-Za-z0-9 .,:;!?()'"/-]*$/u.test(line),
        )
    );
}

function renderedProseLine(line, title = false) {
    const unpadded = line.replace(/ {2,}$/u, "");
    return title ? unpadded.replace(/^#{1,6} /u, "") : unpadded;
}

function matchesRenderedRegion(lines, start, expected) {
    if (renderedProseLine(lines[start], true) !== expected[0]) return false;
    let index = start + 1;
    for (const line of expected.slice(1)) {
        while (lines[index] === "") index++;
        if (index >= lines.length || renderedProseLine(lines[index]) !== line)
            return false;
        index++;
    }
    return true;
}

function matchesSyntheticRendering(answer, document) {
    // Only this prose region is interpreted; tool results and trace bytes stay exact.
    if (/<\/?(?:pre|code|table)\b/iu.test(answer)) return false;
    const lines = answer.split("\n");
    const expected = document.content.split("\n");
    let fence;
    for (const [index, line] of lines.entries()) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
        if (marker) {
            if (!fence)
                fence = { character: marker[1][0], length: marker[1].length };
            else if (
                marker[1][0] === fence.character &&
                marker[1].length >= fence.length &&
                /^ *$/u.test(marker[2])
            )
                fence = undefined;
            continue;
        }
        if (!fence && matchesRenderedRegion(lines, index, expected))
            return true;
    }
    return false;
}

function matchesSyntheticFenceRendering(answer, document) {
    const lines = answer.split("\n");
    const markers = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /`{3,}|~{3,}/u.test(line));
    if (markers.length === 0)
        return matchesSyntheticRendering(answer, document);
    if (
        markers.length !== 2 ||
        !["```text", "```"].includes(markers[0].line) ||
        markers[1].line !== "```" ||
        /<\/?(?:pre|code|table)\b/iu.test(answer)
    )
        return false;
    return (
        lines.slice(markers[0].index + 1, markers[1].index).join("\n") ===
        document.content
    );
}

function matchesSyntheticBlockquoteRendering(answer, document) {
    if (matchesSyntheticFenceRendering(answer, document)) return true;
    if (/`{3,}|~{3,}|<\/?(?:pre|code|table)\b/iu.test(answer)) return false;
    const lines = answer.split("\n");
    const expected = document.content.split("\n");
    for (let index = 0; index < lines.length; ) {
        if (!/^[ \t]*>/u.test(lines[index])) {
            index++;
            continue;
        }
        let end = index + 1;
        while (end < lines.length && /^[ \t]*>/u.test(lines[end])) end++;
        const block = lines.slice(index, end);
        if (
            block.length === expected.length &&
            block.every((line, offset) => line === `> ${expected[offset]}`)
        )
            return true;
        index = end;
    }
    return false;
}

function normalizeDisplayLine(raw) {
    let line = raw.replace(/^[ \t]+|[ \t]+$/gu, "");
    for (let depth = 0; depth < 4; depth++) {
        const next = line.replace(
            /^(?:#{1,6} |> |[-*+] |[0-9]{1,3}[.)] )/u,
            "",
        );
        const wrapped = /^(\*\*|__|`)(.*)\1$/u.exec(next);
        const stripped = wrapped ? wrapped[2] : next;
        if (stripped === line) break;
        line = stripped;
    }
    return line.replace(/[ \t]+/gu, " ").replace(/^[ \t]+|[ \t]+$/gu, "");
}

function displayLines(text) {
    return text
        .split(/\r?\n/u)
        .map((raw, rawIndex) => ({ text: normalizeDisplayLine(raw), rawIndex }))
        .filter(
            (line) =>
                line.text !== "" &&
                !/^(?:`{3}|~{3})(?:[A-Za-z][A-Za-z0-9_-]{0,31})?$/u.test(
                    line.text,
                ),
        );
}

function orderedCodepointDistance(left, right) {
    const a = Array.from(left);
    const b = Array.from(right);
    let previous = Uint16Array.from(
        { length: b.length + 1 },
        (_, index) => index,
    );
    let current = new Uint16Array(b.length + 1);
    for (let row = 1; row <= a.length; row++) {
        current[0] = row;
        for (let column = 1; column <= b.length; column++)
            current[column] = Math.min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
            );
        [previous, current] = [current, previous];
    }
    return previous[b.length];
}

function candidateAnchors(lines, record, otherMarkers) {
    const positions = record.markers.map((marker) =>
        lines.flatMap((line, index) => (line.text === marker ? [index] : [])),
    );
    return {
        title:
            lines[0].text === record.title &&
            lines.filter((line) => line.text === record.title).length === 1,
        markers: record.markers.map((marker, index) => ({
            marker,
            passed: positions[index].length === 1,
        })),
        ordered:
            positions[0].length === 1 &&
            positions[1].length === 1 &&
            positions[0][0] === 1 &&
            positions[0][0] < positions[1][0],
        sameRegion: true,
        noWrongDocumentMarkers: !otherMarkers.some((marker) =>
            lines.some((line) => line.text.includes(marker)),
        ),
    };
}

function collectSimilarityRegions(lines, record, otherMarkers) {
    const starts = lines.flatMap((line, index) =>
        line.text === record.title ? [index] : [],
    );
    if (starts.length > similarityLimits.candidates)
        throw new Error(
            "Experimental scoring exceeds the bounded title-candidate limit",
        );
    const candidates = [];
    for (const start of starts) {
        for (
            let end = start + 1;
            end < Math.min(lines.length, start + similarityLimits.regionLines);
            end++
        ) {
            if (lines[end].text !== record.markers[1]) continue;
            if (candidates.length >= similarityLimits.candidates)
                throw new Error(
                    "Experimental scoring exceeds the bounded region-candidate limit",
                );
            const region = lines.slice(start, end + 1);
            candidates.push({
                region,
                anchors: candidateAnchors(region, record, otherMarkers),
            });
        }
    }
    return candidates;
}

function baseSimilarityReport(contract, lines, record) {
    return {
        scoringContract: structuredClone(contract),
        metricVersion: similarityMetricVersion,
        threshold: contract.threshold,
        similarity: null,
        distance: null,
        denominator: null,
        region: null,
        experimental: true,
        applicable: true,
        interpretation:
            "Displayed-answer similarity only; not complete exact-content or semantic-correctness verification",
        normalization:
            "CRLF-to-LF; trim/collapse ASCII spaces/tabs; omit empty/fence delimiter lines; up to four passes removing leading heading/quote/list/numbered-list prefixes and whole-line bold/inline-code wrappers; case/punctuation/digits/words remain",
        limits: { ...similarityLimits },
        protectedAnchors: {
            title: lines.some((line) => line.text === record.title),
            markers: record.markers.map((marker) => ({
                marker,
                passed: lines.some((line) => line.text === marker),
            })),
            ordered: false,
            sameRegion: false,
            noWrongDocumentMarkers: false,
        },
    };
}

function scoreSimilarityCandidates(candidates, expected, report) {
    let work = 0;
    for (const { region, anchors } of candidates) {
        if (
            !anchors.title ||
            !anchors.ordered ||
            anchors.markers.some((entry) => !entry.passed)
        )
            continue;
        const text = region.map((line) => line.text).join("\n");
        const length = Array.from(text).length;
        if (length > similarityLimits.documentCodepoints)
            throw new Error(
                "Experimental scoring region exceeds its codepoint limit",
            );
        work += Array.from(expected).length * length;
        if (work > similarityLimits.workCells)
            throw new Error(
                "Experimental scoring exceeds its bounded edit-distance work limit",
            );
        const denominator = Math.max(Array.from(expected).length, length);
        const distance = orderedCodepointDistance(expected, text);
        const similarity = 1 - distance / denominator;
        const preferred =
            report.similarity === null ||
            (anchors.noWrongDocumentMarkers &&
                !report.protectedAnchors.noWrongDocumentMarkers) ||
            (anchors.noWrongDocumentMarkers ===
                report.protectedAnchors.noWrongDocumentMarkers &&
                similarity > report.similarity);
        if (preferred)
            Object.assign(report, {
                similarity,
                distance,
                denominator,
                region: {
                    startLine: region[0].rawIndex + 1,
                    endLine: region.at(-1).rawIndex + 1,
                },
                protectedAnchors: anchors,
            });
    }
}

function gradeExperimentalSimilarity(
    document,
    answer,
    contract,
    check,
    result,
) {
    const record = contract.protectedDocuments.find(
        (entry) => entry.key === document.key,
    );
    const lines = displayLines(answer);
    const report = baseSimilarityReport(contract, lines, record);
    result.answerScoring = report;
    const otherMarkers = contract.protectedDocuments
        .filter((entry) => entry.key !== document.key)
        .flatMap((entry) => entry.markers);
    try {
        const regions = collectSimilarityRegions(lines, record, otherMarkers);
        const expected = displayLines(document.content)
            .map((line) => line.text)
            .join("\n");
        scoreSimilarityCandidates(regions, expected, report);
    } catch (error) {
        report.error = error.message;
        check("experimental-scoring-bounds", false, error.message);
    }
    check("experimental-exact-document-title", report.protectedAnchors.title);
    for (const marker of report.protectedAnchors.markers)
        check(`experimental-protected-marker:${marker.marker}`, marker.passed);
    check(
        "experimental-anchors-same-ordered-region",
        report.protectedAnchors.sameRegion && report.protectedAnchors.ordered,
    );
    check(
        "experimental-no-wrong-document-markers",
        report.protectedAnchors.noWrongDocumentMarkers,
    );
    check(
        "experimental-answer-similarity-at-least-90-percent",
        report.similarity !== null &&
            report.similarity >= contract.threshold &&
            !report.error,
        "Experimental displayed-answer Levenshtein similarity must be >=0.90 with all exact protected anchors in the same ordered region; this is not semantic or complete-content verification",
    );
}

function gradeDocumentContent(
    document,
    answer,
    renderingContract,
    check,
    result,
) {
    if (renderingContract === undefined) {
        check("full-exact-document-content", answer.includes(document.content));
        return;
    }
    if (
        renderingContract.protocolVersion ===
        syntheticDocumentSimilarityContract
    ) {
        gradeExperimentalSimilarity(
            document,
            answer,
            renderingContract,
            check,
            result,
        );
        return;
    }
    if (
        renderingContract.protocolVersion ===
        syntheticDocumentBlockquoteRenderingContract
    ) {
        check(
            "full-rendering-preserved-document-content-v4",
            matchesSyntheticBlockquoteRendering(answer, document),
            "synthetic-document-rendering-v4 requires prior narrow prose/exact fence or one complete line-bounded block of original document lines with exactly one '> ' prefix per line; no mixed/nested/extra/decorated/quoted-code content or remainder normalization",
        );
        return;
    }
    if (
        renderingContract.protocolVersion ===
        syntheticDocumentFenceRenderingContract
    ) {
        check(
            "full-rendering-preserved-document-content-v3",
            matchesSyntheticFenceRendering(answer, document),
            "synthetic-document-rendering-v3 requires prior narrow prose or exactly one line-bounded ```text/unlabeled fence containing the untouched entire original document; no other/nested/malformed/executable fences or body normalization",
        );
        return;
    }
    check(
        "full-rendering-preserved-document-content",
        matchesSyntheticRendering(answer, document),
        "synthetic-document-rendering-v2 requires an exact ordered contiguous plain-prose document region; only title heading prefix, empty separator lines and >=2 trailing ASCII hardbreak spaces are allowed",
    );
}

function ordinaryControlShape(control) {
    if (control === null) return true;
    const sourceKeys = [
        "component",
        "pid",
        "parentPid",
        "executable",
        "cwd",
        "owner",
        "instance",
        "server",
        "observedAt",
        "config",
        "mode",
        "routing",
        "expectedConfigPath",
        "expectedMode",
        "readableOwnedConfig",
    ];
    if (
        !exactKeys(control, [
            "effectiveMode",
            "configPath",
            "dataRoot",
            "source",
            "digest",
        ]) ||
        !exactKeys(control.source, sourceKeys, ["request"])
    )
        return false;
    const request = control.source.request;
    return (
        request === undefined ||
        request === null ||
        exactKeys(request, ["sessionId", "timestamp", "cwd"])
    );
}

function recordingSnapshotShape(snapshot) {
    return (
        exactKeys(snapshot, ["observedAt", "state"]) &&
        exactKeys(snapshot.state, ["status", "token"]) &&
        exactKeys(
            snapshot.state.token,
            ["id", "sessionId", "status", "expiresAt"],
            ["cwd", "promptHash", "learning"],
        )
    );
}

function ordinaryCallbackShape(callback) {
    const actorKeys = [
        "ProcessId",
        "ParentProcessId",
        "StartedMs",
        "ExecutablePath",
        "Arguments",
    ];
    return (
        exactKeys(callback, [
            "protocol",
            "owner",
            "input",
            "peer",
            "routerPeer",
            "osApi",
            "reader",
            "staged",
            "mode",
            "configDigest",
            "observedAtMs",
            "native",
            "handled",
            "trustedReceipt",
            "nativeSource",
        ]) &&
        exactKeys(callback.input, [
            "sessionId",
            "prompt",
            "cwd",
            "timestamp",
            "inputHash",
            "rawPromptHash",
        ]) &&
        [callback.peer, callback.routerPeer].every((actor) =>
            exactKeys(actor, actorKeys),
        ) &&
        exactKeys(
            callback.reader,
            [...actorKeys.slice(0, -1), "pipe", "sourceHash"],
            ["Arguments"],
        ) &&
        exactKeys(callback.staged, ["wrapper", "router", "node", "policy"]) &&
        (callback.staged.policy === null ||
            exactKeys(callback.staged.policy, ["file", "sha256"])) &&
        [callback.staged.wrapper, callback.staged.router].every((file) =>
            exactKeys(file, ["file", "sha256"]),
        ) &&
        exactKeys(callback.staged.node, ["executable", "sha256"]) &&
        exactKeys(callback.trustedReceipt, ["file", "sha256"]) &&
        exactKeys(callback.native, [
            "hookStartEventId",
            "hookEndEventId",
            "hookInvocationId",
            "rootUserEventId",
            "answerEventId",
            "terminalEventId",
            "turnId",
        ])
    );
}

function ordinaryReceiptErrors(routeEvidence) {
    if (routeEvidence?.route !== "ordinary-copilot") return [];
    if (!exactKeys(routeEvidence, ["route"], ["receipt"]))
        return [
            "Ordinary route evidence permits only route and the typed receipt",
        ];
    if (routeEvidence.receipt === undefined || routeEvidence.receipt === null)
        return [];
    const receipt = routeEvidence.receipt;
    const expectedKeys = [
        "owner",
        "ownedRoot",
        "sessionId",
        "prompt",
        "promptHash",
        "cwd",
        "configPath",
        "dataRoot",
        "digest",
        "effectiveMode",
        "routing",
        "startedAt",
        "endedAt",
    ];
    if (
        !exactKeys(receipt, [
            "schemaVersion",
            "origin",
            "policy",
            "expected",
            "hook",
            "control",
            "callback",
            "capture",
        ]) ||
        receipt.schemaVersion !== 1 ||
        receipt.origin !== "trusted-native-controller" ||
        !["bypass-baseline", "mcp-mixed-source-capture"].includes(
            receipt.policy,
        ) ||
        !exactKeys(receipt.expected, expectedKeys) ||
        !exactKeys(receipt.hook, [
            "hookInvocationId",
            "startEventId",
            "endEventId",
        ]) ||
        !ordinaryControlShape(receipt.control)
    )
        return ["Malformed ordinary-copilot v1 candidate receipt"];
    if (
        receipt.callback !== null &&
        (!isTrustedNormalHookCallback(receipt.callback) ||
            !ordinaryCallbackShape(receipt.callback))
    )
        return [
            "Ordinary callback must be the original branded trusted-reader object; serialized receipts, origin labels and guessed objects cannot authenticate native execution",
        ];
    const capture = receipt.capture;
    if (exactKeys(capture, ["policy"]) && capture.policy === "none") return [];
    if (
        exactKeys(capture, ["policy", "before", "after"]) &&
        capture.policy === "selected-source" &&
        recordingSnapshotShape(capture.before) &&
        recordingSnapshotShape(capture.after)
    )
        return [];
    return [
        "Malformed ordinary capture policy; use none or actual armed/claimed token snapshots",
    ];
}

function validAuditEntry(entry) {
    if (
        !isText(entry?.operation) ||
        !isText(entry.timestamp) ||
        !Number.isFinite(Date.parse(entry.timestamp))
    )
        return false;
    if (entry.operation === "lookup_document")
        return (
            isText(entry.title) &&
            (entry.returnedId === null || isText(entry.returnedId))
        );
    if (entry.operation === "fetch_document") return isText(entry.id);
    return true;
}

function validDocuments(documents) {
    if (!Array.isArray(documents) || documents.length === 0) return false;
    const seen = { key: new Set(), title: new Set(), expectedId: new Set() };
    for (const document of documents) {
        if (
            !["key", "title", "expectedId", "content"].every((field) =>
                isText(document?.[field]),
            )
        )
            return false;
        for (const field of Object.keys(seen)) {
            if (seen[field].has(document[field])) return false;
            seen[field].add(document[field]);
        }
    }
    return true;
}

function scenarioInputErrors(scenario) {
    if (
        !scenario ||
        typeof scenario !== "object" ||
        Array.isArray(scenario) ||
        !isText(scenario.id) ||
        !isText(scenario.familyId)
    )
        return [
            "A normalized scenario with an explicit id and familyId is required",
        ];
    if (
        scenario.forbiddenEffects !== undefined &&
        (!Array.isArray(scenario.forbiddenEffects) ||
            scenario.forbiddenEffects.some((effect) => !isText(effect)))
    )
        return ["Scenario forbiddenEffects must be an array of effect names"];
    if (
        scenario.status !== undefined &&
        ![
            "ready-for-rehearsal-unexecuted",
            "pending",
            "blocked",
            "blocked-not-accepted",
        ].includes(scenario.status)
    )
        return ["Scenario status must not claim acceptance or freezing"];
    return [];
}

function evidenceErrors({
    events,
    backendAudit,
    answer,
    routeEvidence,
    executionEvidence,
    readFinalizedSource,
}) {
    const errors = [];
    if (
        !Array.isArray(events) ||
        events.length === 0 ||
        events.some((entry) => !isText(entry?.type))
    )
        errors.push("Native events with a type field are required");
    if (
        !Array.isArray(backendAudit) ||
        backendAudit.some((entry) => !validAuditEntry(entry))
    )
        errors.push("Explicit timestamped backend audit array is required");
    if (!isText(answer)) errors.push("Actual root answer is required");
    if (
        ![
            "grammar",
            "explicit-mcp",
            "miss",
            "unknown",
            "ordinary-copilot",
        ].includes(routeEvidence?.route)
    )
        errors.push(
            "Explicit routeEvidence.route grammar, explicit-mcp, miss, unknown, or ordinary-copilot is required",
        );
    errors.push(...ordinaryReceiptErrors(routeEvidence));
    if (
        readFinalizedSource !== undefined &&
        readFinalizedSource !== null &&
        typeof readFinalizedSource !== "function"
    )
        errors.push(
            "readFinalizedSource must be an in-process trusted host capability, not serialized evidence",
        );
    if (
        !Number.isInteger(executionEvidence?.wholeMacroInvocations) ||
        executionEvidence.wholeMacroInvocations < 0 ||
        !Array.isArray(executionEvidence.effects) ||
        executionEvidence.effects.some((entry) => !isText(entry))
    )
        errors.push(
            "Explicit execution invocation count and effects array are required",
        );
    return errors;
}

function isRootEvent(entry) {
    return !entry.agentId && !entry.data?.parentToolCallId;
}

function hasNoPendingTools(entry) {
    const requests = entry.data?.toolRequests;
    return (
        requests === undefined ||
        (Array.isArray(requests) && requests.length === 0)
    );
}

function causallyLinked(events, ancestorIndex, descendantIndex) {
    const ancestor = events[ancestorIndex];
    const descendant = events[descendantIndex];
    if (!isText(ancestor?.id) || !isText(descendant?.id)) return false;
    const indexes = new Map(
        events
            .slice(0, descendantIndex)
            .map((entry, index) => [entry.id, index]),
    );
    let index = descendantIndex;
    while (index > ancestorIndex) {
        const previous = indexes.get(events[index].parentId);
        if (previous === undefined || previous >= index) return false;
        index = previous;
    }
    return index === ancestorIndex;
}

function rootTurnCompleted(events, answerIndex, allowSdkIdle = true) {
    const message = events[answerIndex];
    if (!message) return false;
    for (let index = answerIndex + 1; index < events.length; index++) {
        const entry = events[index];
        if (!isRootEvent(entry)) continue;
        if (["assistant.message", "user.message"].includes(entry.type))
            return false;
        if (entry.type === "session.idle" && allowSdkIdle) return true;
        if (
            entry.type === "assistant.turn_end" &&
            isTurnId(message.data?.turnId) &&
            entry.data?.turnId === message.data.turnId &&
            causallyLinked(events, answerIndex, index)
        )
            return true;
    }
    return false;
}

function hasExecutionError(events) {
    return events.some(
        (entry) =>
            ["session.error", "subagent.failed"].includes(entry.type) ||
            (entry.type === "subagent.completed" &&
                entry.data?.cancelled === true) ||
            (entry.type === "tool.execution_complete" &&
                entry.data?.success === false),
    );
}

function gradeCompletion(events, answer, routeEvidence, check) {
    const answerIndex = events.findLastIndex(
        (entry) =>
            entry.type === "assistant.message" &&
            isRootEvent(entry) &&
            entry.data?.content === answer,
    );
    check(
        "recorded-root-answer",
        answerIndex >= 0,
        "Answer must match a native root assistant.message",
    );
    check(
        "root-answer-without-pending-tools",
        answerIndex >= 0 && hasNoPendingTools(events[answerIndex]),
    );
    check(
        "terminal-native-completion",
        rootTurnCompleted(events, answerIndex),
        "Requires actual root terminal completion; execution-planner children and old phase reports cannot certify completion",
    );
    check("no-session-error", !hasExecutionError(events));
}

function nativePaths(value) {
    return /^[a-z]:[\\/]|^\\\\/iu.test(value) ? path.win32 : path.posix;
}

function insideOwnedRoot(root, value) {
    const paths = nativePaths(root);
    if (!paths.isAbsolute(root ?? "") || !paths.isAbsolute(value ?? ""))
        return false;
    const relative = paths.relative(root, value);
    return (
        relative !== ".." &&
        !relative.startsWith(`..${paths.sep}`) &&
        !paths.isAbsolute(relative)
    );
}

function ordinaryExpectedValid(expected, scenario) {
    const strings = [
        "owner",
        "ownedRoot",
        "sessionId",
        "prompt",
        "cwd",
        "configPath",
        "dataRoot",
    ];
    return (
        strings.every((key) => isText(expected[key])) &&
        scenario.prompt === expected.prompt &&
        ["cwd", "configPath", "dataRoot"].every((key) =>
            insideOwnedRoot(expected.ownedRoot, expected[key]),
        ) &&
        isDigest(expected.digest) &&
        isDigest(expected.promptHash) &&
        Number.isFinite(Date.parse(expected.startedAt)) &&
        Date.parse(expected.endedAt) >= Date.parse(expected.startedAt)
    );
}

function ordinaryPromptStartMatches(start, hook, expected) {
    if (start?.type !== "hook.start" || !isRootEvent(start)) return false;
    const data = start.data;
    const input = data?.input;
    return (
        data?.hookType === "userPromptSubmitted" &&
        isText(data.hookInvocationId) &&
        data.hookInvocationId === hook.hookInvocationId &&
        input?.sessionId === expected.sessionId &&
        input?.prompt === expected.prompt &&
        input?.cwd === expected.cwd &&
        Number.isFinite(input?.timestamp)
    );
}

function ordinaryPromptEndMatches(end, hook) {
    return (
        end?.type === "hook.end" &&
        isRootEvent(end) &&
        end.data?.hookType === "userPromptSubmitted" &&
        end.data?.hookInvocationId === hook.hookInvocationId
    );
}

function ordinaryOmissionPolicy(receipt, selectedVerified) {
    return (
        (receipt.policy === "bypass-baseline" &&
            receipt.expected.effectiveMode === "bypass") ||
        (receipt.policy === "mcp-mixed-source-capture" &&
            selectedVerified &&
            receipt.expected.effectiveMode === "mcp" &&
            receipt.expected.routing === "mixed")
    );
}

function ordinaryOmittedOutput(receipt, start, end, selectedVerified) {
    const callback = receipt.callback;
    return (
        isTrustedNormalHookCallback(callback) &&
        callback.protocol === nativeOrdinaryCallbackContract &&
        ordinaryOmissionPolicy(receipt, selectedVerified) &&
        callback.mode === receipt.expected.effectiveMode &&
        callback.configDigest === receipt.expected.digest &&
        callback.native.hookStartEventId === start?.id &&
        callback.native.hookEndEventId === end?.id &&
        callback.native.hookInvocationId === end?.data?.hookInvocationId &&
        callback.handled === null &&
        !/^\s*(?:\/|@typeagent\b)/iu.test(callback.input.prompt) &&
        ordinaryCurrentControlMatches(receipt.control, receipt.expected) &&
        ordinaryPublicDigestMatches(receipt.control, receipt.expected) &&
        ordinaryRequestMatches(receipt.control, start, receipt.expected) &&
        ordinaryCallbackInputMatches(callback, start, receipt.expected) &&
        ordinaryCallbackRouterMatches(callback, receipt.control)
    );
}

function ordinaryUnhandledOutput(end, receipt, start, selectedVerified) {
    if (end?.data?.success !== true) return false;
    if (!Object.hasOwn(end.data, "output"))
        return ordinaryOmittedOutput(receipt, start, end, selectedVerified);
    const output = end?.data?.output;
    return (
        exactKeys(output, [], ["handled"]) &&
        (output.handled === undefined || output.handled === false)
    );
}

function ordinaryRootChainMatches(
    events,
    expected,
    startIndex,
    endIndex,
    users,
    answerIndex,
) {
    if (users.length !== 1) return false;
    const user = users[0].entry;
    return (
        user.data?.content === expected.prompt &&
        isText(user.data?.interactionId) &&
        user.data.interactionId === events[answerIndex]?.data?.interactionId &&
        causallyLinked(events, startIndex, endIndex) &&
        causallyLinked(events, endIndex, users[0].index) &&
        causallyLinked(events, users[0].index, answerIndex)
    );
}

function ordinaryHookEvidence(events, answer, receipt, check) {
    const { expected, hook } = receipt;
    const startIndex = events.findIndex(
        (entry) => entry.id === hook.startEventId,
    );
    const endIndex = events.findIndex((entry) => entry.id === hook.endEventId);
    const start = events[startIndex];
    const end = events[endIndex];
    const users = events
        .map((entry, index) => ({ entry, index }))
        .filter(
            ({ entry, index }) =>
                index > endIndex &&
                entry.type === "user.message" &&
                isRootEvent(entry),
        );
    const answerIndex = events.findLastIndex(
        (entry) =>
            entry.type === "assistant.message" &&
            isRootEvent(entry) &&
            entry.data?.content === answer,
    );
    check(
        "ordinary-native-event-identities",
        events.every((entry) => isText(entry.id)) &&
            new Set(events.map((entry) => entry.id)).size === events.length,
    );
    check(
        "ordinary-user-prompt-hook",
        ordinaryPromptStartMatches(start, hook, expected) &&
            ordinaryPromptEndMatches(end, hook),
    );
    check(
        "ordinary-hook-root-causal-chain",
        ordinaryRootChainMatches(
            events,
            expected,
            startIndex,
            endIndex,
            users,
            answerIndex,
        ),
    );
    check(
        "ordinary-native-root-turn-end",
        rootTurnCompleted(events, answerIndex, false),
        "Ordinary Copilot requires a correlated native root assistant.turn_end, not SDK idle or a model success claim",
    );
    return { start, end, userIndex: users[0]?.index, answerIndex };
}

function ordinarySessionBinding(events, expected, check) {
    const sessions = events.filter(
        (entry) => entry.type === "session.start" && isRootEvent(entry),
    );
    check(
        "ordinary-owned-native-session",
        sessions.length === 1 &&
            sessions[0].data?.sessionId === expected.sessionId &&
            sessions[0].data?.context?.cwd === expected.cwd,
    );
    check(
        "ordinary-current-native-trial-window",
        events
            .filter((entry) => entry.type !== "session.start")
            .every(
                (entry) =>
                    Date.parse(expected.startedAt) <=
                        Date.parse(entry.timestamp) &&
                    Date.parse(entry.timestamp) <= Date.parse(expected.endedAt),
            ),
    );
}

function ordinaryControlSourceValid(source) {
    return (
        Number.isInteger(source?.pid) &&
        source.pid > 0 &&
        Number.isInteger(source.parentPid) &&
        source.parentPid > 0 &&
        isText(source.executable) &&
        nativePaths(source.executable).isAbsolute(source.executable) &&
        ["TYPEAGENT_PLUGIN_DATA", "CLAUDE_PLUGIN_DATA", "default"].includes(
            source.config,
        ) &&
        ["TYPEAGENT_MODE", "config", "default"].includes(source.mode) &&
        (source.instance === null || isText(source.instance)) &&
        (source.server === null || isText(source.server))
    );
}

function ordinaryCurrentControlMatches(control, expected) {
    const source = control?.source;
    return (
        ordinaryControlSourceValid(source) &&
        isText(expected.ownedRoot) &&
        control?.effectiveMode === expected.effectiveMode &&
        control?.configPath === expected.configPath &&
        control?.dataRoot === expected.dataRoot &&
        source?.owner === expected.owner &&
        source?.component === "native-hook" &&
        source?.expectedMode === expected.effectiveMode &&
        source?.expectedConfigPath === expected.configPath &&
        source?.readableOwnedConfig === true &&
        source?.cwd ===
            nativePaths(expected.ownedRoot).join(
                expected.ownedRoot,
                "plugin",
            ) &&
        source?.routing === expected.routing
    );
}

function ordinaryPublicDigestMatches(control, expected) {
    if (control === null) return false;
    return (
        isDigest(control.digest) &&
        control.digest === expected.digest &&
        control.digest ===
            sha256(
                JSON.stringify({
                    configPath: control.configPath,
                    dataRoot: control.dataRoot,
                    effectiveMode: control.effectiveMode,
                    mcpRouting: control.source.routing,
                }),
            )
    );
}

function ordinaryRequestMatches(control, start, expected) {
    const request = control?.source?.request;
    return (
        isRecord(request) &&
        request.sessionId === expected.sessionId &&
        request.cwd === expected.cwd &&
        request.timestamp === start?.data?.input?.timestamp
    );
}

function ordinaryControlWindowMatches(control, start, end, expected) {
    const observed = Date.parse(control?.source?.observedAt);
    const started = Date.parse(start?.timestamp);
    const ended = Date.parse(end?.timestamp);
    return (
        Number.isFinite(observed) &&
        Date.parse(expected.startedAt) <= started &&
        started <= observed &&
        observed <= ended &&
        ended <= Date.parse(expected.endedAt)
    );
}

function ordinaryControlBinding(receipt, start, end, check) {
    const { control, expected } = receipt;
    check(
        "ordinary-current-control-binding",
        ordinaryCurrentControlMatches(control, expected),
    );
    check(
        "ordinary-public-control-digest",
        ordinaryPublicDigestMatches(control, expected),
    );
    check(
        "ordinary-actual-parsed-hook-request",
        ordinaryRequestMatches(control, start, expected),
        "Startup/status receipts with missing or null source.request do not prove an actual userPromptSubmitted callback",
    );
    check(
        "ordinary-current-hook-observation-window",
        ordinaryControlWindowMatches(control, start, end, expected),
    );
}

function ordinaryCallbackInputMatches(callback, start, expected) {
    const input = callback.input;
    const actual = start?.data?.input;
    return (
        input.sessionId === expected.sessionId &&
        input.prompt === expected.prompt &&
        input.cwd === expected.cwd &&
        input.timestamp === actual?.timestamp &&
        input.inputHash ===
            sha256(
                JSON.stringify({
                    sessionId: actual?.sessionId,
                    prompt: actual?.prompt,
                    cwd: actual?.cwd,
                    timestamp: actual?.timestamp,
                }),
            ) &&
        input.rawPromptHash === sha256(expected.prompt)
    );
}

function ordinaryCallbackNativeMatches(callback, receipt, context, events) {
    const { native } = callback;
    const { start, end, userIndex, answerIndex } = context;
    return (
        native.hookStartEventId === start?.id &&
        native.hookEndEventId === end?.id &&
        ordinaryCallbackHooksUnique(callback, receipt.expected, events) &&
        native.hookInvocationId === receipt.hook.hookInvocationId &&
        native.rootUserEventId === events[userIndex]?.id &&
        native.answerEventId === events[answerIndex]?.id &&
        ordinaryCallbackTerminalMatches(callback, events, answerIndex) &&
        callback.handled === (end?.data?.output?.handled ?? null)
    );
}

function ordinaryCallbackTerminalMatches(callback, events, answerIndex) {
    const { native } = callback;
    const terminalIndex = events.findIndex(
        (entry) => entry.id === native.terminalEventId,
    );
    const terminal = events[terminalIndex];
    return (
        isTurnId(native.turnId) &&
        native.turnId === events[answerIndex]?.data?.turnId &&
        terminal?.type === "assistant.turn_end" &&
        isRootEvent(terminal) &&
        terminal.data?.turnId === native.turnId &&
        causallyLinked(events, answerIndex, terminalIndex)
    );
}

function ordinaryCallbackHooksUnique(callback, expected, events) {
    const hooks = events.filter(
        (entry) =>
            isRootEvent(entry) &&
            entry.data?.hookType === "userPromptSubmitted",
    );
    return (
        hooks.filter(
            (entry) =>
                entry.type === "hook.start" &&
                ordinaryCallbackInputMatches(callback, entry, expected),
        ).length === 1 &&
        hooks.filter(
            (entry) =>
                entry.type === "hook.end" &&
                entry.data.hookInvocationId ===
                    callback.native.hookInvocationId,
        ).length === 1
    );
}

function ordinaryCallbackOwnedPaths(callback, expected) {
    if (!isText(expected.ownedRoot)) return false;
    const paths = nativePaths(expected.ownedRoot);
    const { staged, trustedReceipt, reader } = callback;
    return (
        callback.owner === expected.owner &&
        staged.wrapper.file ===
            paths.join(
                expected.ownedRoot,
                "plugin",
                "macro-eval-native-hook.mjs",
            ) &&
        staged.router.file ===
            paths.join(
                expected.ownedRoot,
                "plugin",
                "dist",
                "hooks",
                "hook-router.js",
            ) &&
        ordinaryCallbackPolicyMatches(staged.policy, expected.ownedRoot) &&
        paths.dirname(trustedReceipt.file) ===
            paths.join(expected.ownedRoot, "normal-hook") &&
        /^receipt-\d{4}\.json$/u.test(paths.basename(trustedReceipt.file)) &&
        [
            staged.wrapper.sha256,
            staged.router.sha256,
            staged.node.sha256,
            trustedReceipt.sha256,
            reader.sourceHash,
        ].every(isDigest) &&
        /^typeagent-native-[a-f0-9-]{36}$/u.test(reader.pipe) &&
        callback.osApi === "GetNamedPipeClientProcessId/SafePipeHandle"
    );
}

function ordinaryCallbackPolicyMatches(policy, root) {
    return (
        policy === null ||
        (policy.file ===
            nativePaths(root).join(
                root,
                "plugin",
                "native-normal-hook-config.json",
            ) &&
            isDigest(policy.sha256))
    );
}

function ordinaryCallbackRouterMatches(callback, control) {
    const source = control?.source;
    const { peer, routerPeer, staged } = callback;
    return (
        source?.pid === routerPeer.ProcessId &&
        source?.parentPid === peer.ProcessId &&
        routerPeer.ParentProcessId === peer.ProcessId &&
        source?.executable === staged.node.executable &&
        routerPeer.ExecutablePath === staged.node.executable &&
        peer.ExecutablePath === staged.node.executable &&
        source?.request?.sessionId === callback.input.sessionId &&
        source?.request?.cwd === callback.input.cwd &&
        source?.request?.timestamp === callback.input.timestamp
    );
}

function ordinaryCallbackWindowMatches(callback, control, context, expected) {
    const { peer, routerPeer, observedAtMs } = callback;
    return (
        Date.parse(expected.startedAt) <= peer.StartedMs &&
        Date.parse(context.start?.timestamp) <= peer.StartedMs &&
        peer.StartedMs <= routerPeer.StartedMs &&
        routerPeer.StartedMs <= observedAtMs &&
        callback.input.timestamp <= observedAtMs &&
        observedAtMs <= Date.parse(control?.source?.observedAt) &&
        Date.parse(control?.source?.observedAt) <=
            Date.parse(context.end?.timestamp) &&
        observedAtMs <= Date.parse(expected.endedAt)
    );
}

function ordinaryCallbackBinding(receipt, context, events, check) {
    const { callback, expected, control } = receipt;
    if (callback === null) return;
    check(
        "ordinary-branded-normal-hook",
        isTrustedNormalHookCallback(callback) &&
            callback.protocol === nativeOrdinaryCallbackContract,
    );
    check(
        "ordinary-callback-input-hashes",
        ordinaryCallbackInputMatches(callback, context.start, expected),
        "Native stdin inputHash and rawPromptHash are independent of the redacted recording-lease prompt hash",
    );
    check(
        "ordinary-callback-current-native-correlation",
        ordinaryCallbackNativeMatches(callback, receipt, context, events),
    );
    check(
        "ordinary-callback-owned-staged-sources",
        ordinaryCallbackOwnedPaths(callback, expected),
    );
    check(
        "ordinary-callback-router-control",
        ordinaryCallbackRouterMatches(callback, control) &&
            callback.mode === expected.effectiveMode &&
            callback.mode === control?.effectiveMode &&
            callback.configDigest === expected.digest &&
            callback.configDigest === control?.digest,
    );
    check(
        "ordinary-callback-current-os-window",
        ordinaryCallbackWindowMatches(callback, control, context, expected),
    );
}

function selectedSourceShape(source) {
    return (
        exactKeys(source, [
            "observedAt",
            "state",
            "trace",
            "storeRoot",
            "file",
        ]) &&
        exactKeys(source.file, ["path", "sha256"]) &&
        exactKeys(source.state, ["status", "trace"], ["learningJob"]) &&
        source.state.status === "completed" &&
        exactKeys(
            source.state.trace,
            ["traceId", "sessionId", "createdAt", "toolCallCount"],
            ["learningJobId"],
        ) &&
        isText(source.state.trace.traceId) &&
        isText(source.state.trace.sessionId) &&
        isText(source.state.trace.createdAt) &&
        Number.isFinite(Date.parse(source.state.trace.createdAt)) &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(
            source.state.trace.traceId,
        ) &&
        Number.isInteger(source.state.trace.toolCallCount) &&
        source.state.trace.toolCallCount >= 0 &&
        isText(source.storeRoot) &&
        isText(source.file.path) &&
        isDigest(source.file.sha256) &&
        isText(source.observedAt) &&
        Number.isFinite(Date.parse(source.observedAt)) &&
        isRecord(source.trace)
    );
}

function selectedTraceShape(trace) {
    return (
        exactKeys(
            trace,
            [
                "schemaVersion",
                "traceId",
                "createdAt",
                "sessionId",
                "cwd",
                "prompt",
                "response",
                "startedAt",
                "completedAt",
                "toolCalls",
            ],
            ["capabilities", "handoffRunId"],
        ) &&
        ["traceId", "sessionId", "cwd", "prompt"].every((key) =>
            isText(trace[key]),
        ) &&
        typeof trace.response === "string" &&
        ["createdAt", "startedAt", "completedAt"].every(
            (key) =>
                isText(trace[key]) && Number.isFinite(Date.parse(trace[key])),
        ) &&
        Array.isArray(trace.toolCalls) &&
        trace.toolCalls.every(
            (call) =>
                exactKeys(
                    call,
                    ["toolCallId", "name", "status"],
                    [
                        "arguments",
                        "result",
                        "mcpServerName",
                        "modelResult",
                        "permission",
                        "resultArtifact",
                        "modelResultArtifact",
                    ],
                ) &&
                isText(call.toolCallId) &&
                isText(call.name) &&
                ["completed", "failed", "denied"].includes(call.status),
        )
    );
}

function selectedStoreBinding(source, expected) {
    const paths = nativePaths(expected.dataRoot);
    const scope = {
        workspaceId:
            paths === path.win32
                ? paths.resolve(expected.cwd).toLowerCase()
                : paths.resolve(expected.cwd),
        profileId: expected.profileId ?? "local-default",
    };
    const root = paths.join(
        paths.dirname(expected.configPath),
        "recipes",
        sha256(JSON.stringify(scope)),
    );
    return (
        source.storeRoot === root &&
        source.file.path ===
            paths.join(root, "traces", `${source.state.trace.traceId}.json`) &&
        insideOwnedRoot(expected.ownedRoot, root)
    );
}

function selectedPhysicalPath(file, ownedRoot) {
    let current = file;
    while (current !== ownedRoot) {
        if (
            fs.lstatSync(current).isSymbolicLink() ||
            fs.realpathSync(current) !== current
        )
            throw new Error("Selected trace path is linked or relocated");
        const parent = nativePaths(ownedRoot).dirname(current);
        if (parent === current)
            throw new Error("Selected trace path escaped its owned root");
        current = parent;
    }
    if (
        !fs.lstatSync(ownedRoot).isDirectory() ||
        fs.lstatSync(ownedRoot).isSymbolicLink() ||
        fs.realpathSync(ownedRoot) !== ownedRoot
    )
        throw new Error("Selected trace owned root is linked or relocated");
}

function selectedFileStatValid(stat) {
    return (
        stat.isFile() &&
        stat.nlink === 1n &&
        stat.size > 0n &&
        stat.size <= 1048576n
    );
}

function selectedStatsEqual(left, right) {
    return ["ino", "dev", "size", "mtimeNs", "ctimeNs", "nlink"].every(
        (key) => left[key] === right[key],
    );
}

function selectedBoundedBytes(handle, size) {
    const bytes = Buffer.alloc(Number(size));
    let offset = 0;
    while (offset < bytes.length) {
        const read = fs.readSync(
            handle,
            bytes,
            offset,
            bytes.length - offset,
            offset,
        );
        if (read === 0)
            throw new Error("Selected trace was truncated during read");
        offset += read;
    }
    if (fs.readSync(handle, Buffer.alloc(1), 0, 1, offset) !== 0)
        throw new Error("Selected trace grew beyond its bounded size");
    return bytes;
}

function readSelectedFile(source, expected) {
    const file = source.file.path;
    selectedPhysicalPath(file, expected.ownedRoot);
    const before = fs.lstatSync(file, { bigint: true });
    if (!selectedFileStatValid(before))
        throw new Error(
            "Selected trace must be a regular single-link file within 1 MiB",
        );
    const handle = fs.openSync(
        file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    let bytes;
    try {
        const opened = fs.fstatSync(handle, { bigint: true });
        if (!selectedStatsEqual(before, opened))
            throw new Error(
                `Selected trace identity changed at open (${["ino", "dev", "size", "mtimeNs", "ctimeNs", "nlink"].filter((key) => before[key] !== opened[key]).join(", ")})`,
            );
        bytes = selectedBoundedBytes(handle, opened.size);
        const after = fs.fstatSync(handle, { bigint: true });
        const current = fs.lstatSync(file, { bigint: true });
        if (
            !selectedStatsEqual(opened, after) ||
            !selectedStatsEqual(after, current) ||
            !selectedFileStatValid(current)
        )
            throw new Error("Selected trace identity changed during read");
    } finally {
        fs.closeSync(handle);
    }
    selectedPhysicalPath(file, expected.ownedRoot);
    if (sha256(bytes) !== source.file.sha256)
        throw new Error(
            "Selected trace digest does not match current file bytes",
        );
    const parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes,
        ),
    );
    if (!isDeepStrictEqual(parsed, source.trace))
        throw new Error(
            "Selected trace object does not match its physical file",
        );
}

function selectedSummaryMatches(source, receipt) {
    const { trace, state } = source;
    const summary = state.trace;
    return (
        trace.traceId === summary.traceId &&
        trace.sessionId === summary.sessionId &&
        trace.sessionId === receipt.expected.sessionId &&
        trace.cwd === receipt.expected.cwd &&
        trace.createdAt === summary.createdAt &&
        trace.toolCalls.length === summary.toolCallCount &&
        Date.parse(trace.createdAt) <
            Date.parse(receipt.capture.after.state.token.expiresAt) &&
        sha256(trace.prompt) === receipt.expected.promptHash &&
        receipt.control?.source?.instance ===
            `macro-eval-${receipt.expected.owner.slice(0, 8)}`
    );
}

function selectedCurrentEvents(events, context) {
    const terminal = context.terminalIndex;
    return events.slice(context.userIndex + 1, terminal + 1);
}

function selectedTraceContext(events, receipt) {
    return {
        userIndex: events.findIndex(
            (entry) => entry.id === receipt.callback.native.rootUserEventId,
        ),
        terminalIndex: events.findIndex(
            (entry) => entry.id === receipt.callback.native.terminalEventId,
        ),
    };
}

function selectedProgress(events) {
    const started = new Set();
    return events.filter((entry) => {
        if (!isRootEvent(entry)) return false;
        if (entry.type === "assistant.message") return true;
        if (entry.type === "tool.execution_start") {
            started.add(entry.data?.toolCallId);
            return true;
        }
        return (
            ["tool.execution_complete", "permission.completed"].includes(
                entry.type,
            ) && started.has(entry.data?.toolCallId)
        );
    });
}

function selectedTracePresentation(source, receipt, events, context) {
    const { trace } = source;
    const current = selectedCurrentEvents(events, context);
    const progress = selectedProgress(current);
    const response = current
        .filter(
            (entry) =>
                entry.type === "assistant.message" &&
                isRootEvent(entry) &&
                typeof entry.data?.content === "string",
        )
        .map((entry) => entry.data.content)
        .join("");
    return (
        context.userIndex >= 0 &&
        context.terminalIndex > context.userIndex &&
        trace.startedAt === events[context.userIndex].timestamp &&
        trace.completedAt === progress.at(-1)?.timestamp &&
        trace.response === response &&
        Date.parse(trace.createdAt) >= Date.parse(trace.completedAt) &&
        Date.parse(trace.createdAt) <= Date.parse(source.observedAt) &&
        Date.parse(source.observedAt) <= Date.parse(receipt.expected.endedAt) &&
        Date.parse(source.observedAt) >=
            Date.parse(events[context.terminalIndex].timestamp) &&
        Date.parse(trace.startedAt) >= Date.parse(receipt.expected.startedAt)
    );
}

function selectedModelResult(result) {
    if (typeof result?.content !== "string") return undefined;
    try {
        return JSON.parse(result.content);
    } catch (error) {
        if (error instanceof SyntaxError) return result.content;
        throw error;
    }
}

function selectedTraceCallMatches(call, start, events) {
    const completed = events.filter(
        (entry) =>
            entry.type === "tool.execution_complete" &&
            entry.data?.toolCallId === start.data?.toolCallId &&
            isRootEvent(entry),
    );
    if (completed.length !== 1) return false;
    const permissions = events.filter(
        (entry) =>
            entry.type === "permission.completed" &&
            isRootEvent(entry) &&
            entry.data?.toolCallId === start.data?.toolCallId &&
            events.indexOf(entry) > events.indexOf(start),
    );
    return (
        call.toolCallId === start.data.toolCallId &&
        call.name === start.data.toolName &&
        call.mcpServerName === "eval-docs" &&
        start.data.mcpServerName === "eval-docs" &&
        call.status === "completed" &&
        Object.hasOwn(call, "arguments") &&
        Object.hasOwn(call, "result") &&
        completed[0].data.success === true &&
        Object.hasOwn(completed[0].data, "result") &&
        isDeepStrictEqual(call.arguments, start.data.arguments) &&
        isDeepStrictEqual(call.result, completed[0].data.result) &&
        isDeepStrictEqual(
            call.modelResult,
            selectedModelResult(completed[0].data.result),
        ) &&
        isDeepStrictEqual(call.permission, permissions.at(-1)?.data?.result)
    );
}

function selectedTraceCallsMatch(source, events, context, audit) {
    const current = selectedCurrentEvents(events, context);
    const starts = current.filter(
        (entry) => entry.type === "tool.execution_start" && isRootEvent(entry),
    );
    return (
        source.trace.toolCalls.length === starts.length &&
        starts.length === audit.length &&
        new Set(source.trace.toolCalls.map((call) => call.toolCallId)).size ===
            starts.length &&
        starts.every((start, index) =>
            selectedTraceCallMatches(
                source.trace.toolCalls[index],
                start,
                current,
            ),
        )
    );
}

function selectedSourceStatus(status, error) {
    return { status, errors: error ? [error] : [] };
}

function gradeSelectedSource(input, check) {
    const receipt = input.routeEvidence.receipt;
    if (receipt.policy !== "mcp-mixed-source-capture")
        return selectedSourceStatus("blocked");
    if (
        !isTrustedNormalHookCallback(receipt.callback) ||
        receipt.capture.policy !== "selected-source" ||
        typeof input.readFinalizedSource !== "function" ||
        !ordinaryExpectedValid(receipt.expected, input.scenario)
    )
        return selectedSourceStatus("blocked");
    let source;
    try {
        source = input.readFinalizedSource({
            sessionId: receipt.expected.sessionId,
            tokenId: receipt.capture.after?.state?.token?.id,
        });
    } catch (error) {
        return selectedSourceStatus(
            "blocked",
            `Finalized selected trace reader unavailable: ${error.message}`,
        );
    }
    if (source === undefined || source === null)
        return selectedSourceStatus(
            "blocked",
            "Current finalized selected trace is unavailable",
        );
    if (source instanceof Promise) {
        source.catch(() => {});
        return selectedSourceStatus(
            "harness-invalid",
            "Finalized selected trace capability must return synchronously",
        );
    }
    if (!selectedSourceShape(source) || !selectedTraceShape(source.trace))
        return selectedSourceStatus(
            "harness-invalid",
            "Malformed finalized selected-source v1 evidence",
        );
    return gradeSelectedSourceEvidence(source, receipt, input, check);
}

function gradeSelectedSourceEvidence(source, receipt, input, check) {
    const trace = source.trace;
    if (
        trace.schemaVersion === 2 &&
        isDeepStrictEqual(trace.capabilities, ["private-result-evidence-v1"])
    )
        return selectedSourceStatus(
            "blocked",
            "Artifact-backed v2 selected source needs an implemented full private-result verifier; no sidecar proof is inferred",
        );
    if (
        trace.schemaVersion !== 1 ||
        trace.capabilities !== undefined ||
        trace.handoffRunId !== undefined ||
        trace.toolCalls.some(
            (call) =>
                call.resultArtifact !== undefined ||
                call.modelResultArtifact !== undefined,
        )
    )
        return selectedSourceStatus(
            "harness-invalid",
            "Unsupported finalized synthetic trace schema/capabilities or run-owned artifacts",
        );
    const bound = selectedStoreBinding(source, receipt.expected);
    check("ordinary-finalized-source-owned-file", bound);
    if (!bound) return selectedSourceStatus("failed");
    try {
        readSelectedFile(source, receipt.expected);
    } catch (error) {
        check(
            "ordinary-finalized-source-physical-integrity",
            false,
            error.message,
        );
        return selectedSourceStatus("failed");
    }
    check("ordinary-finalized-source-physical-integrity", true);
    const context = selectedTraceContext(input.events, receipt);
    const checks = [
        [
            "ordinary-finalized-source-summary-lease",
            selectedSummaryMatches(source, receipt),
        ],
        [
            "ordinary-finalized-source-current-root-presentation",
            selectedTracePresentation(source, receipt, input.events, context),
        ],
        [
            "ordinary-finalized-source-current-sdk-calls",
            selectedTraceCallsMatch(
                source,
                input.events,
                context,
                input.backendAudit,
            ),
        ],
    ];
    for (const [name, passed] of checks) check(name, passed);
    return selectedSourceStatus(
        checks.every(([, passed]) => passed) ? "passed" : "failed",
    );
}

function ordinaryCaptureBinding(receipt, start, end, check) {
    const { expected, capture, policy } = receipt;
    const bypass = policy === "bypass-baseline";
    check(
        "ordinary-mode-capture-policy",
        bypass
            ? expected.effectiveMode === "bypass" &&
                  ["delegate", "mixed"].includes(expected.routing) &&
                  capture.policy === "none"
            : expected.effectiveMode === "mcp" &&
                  expected.routing === "mixed" &&
                  capture.policy === "selected-source",
    );
    if (capture.policy !== "selected-source") return;
    const before = capture.before.state;
    const after = capture.after.state;
    const tokens = [before.token, after.token];
    check(
        "ordinary-selected-source-lease",
        before.status === "armed" &&
            before.token.status === "armed" &&
            after.status === "claimed" &&
            after.token.status === "claimed" &&
            isText(before.token.id) &&
            before.token.id === after.token.id &&
            tokens.every(
                (token) =>
                    token.sessionId === expected.sessionId &&
                    token.cwd === expected.cwd &&
                    token.learning === true,
            ) &&
            before.token.expiresAt === after.token.expiresAt &&
            Date.parse(after.token.expiresAt) >
                Date.parse(capture.after.observedAt) &&
            before.token.promptHash === undefined &&
            after.token.promptHash === expected.promptHash,
    );
    check(
        "ordinary-selected-source-snapshot-window",
        Date.parse(expected.startedAt) <=
            Date.parse(capture.before.observedAt) &&
            Date.parse(capture.before.observedAt) <=
                Date.parse(start?.timestamp) &&
            Date.parse(receipt.control?.source?.observedAt) <=
                Date.parse(capture.after.observedAt) &&
            Date.parse(capture.after.observedAt) <=
                Date.parse(expected.endedAt),
    );
}

function ordinaryToolOperation(entry) {
    if (entry.data?.mcpServerName !== "eval-docs") return undefined;
    const name = entry.data?.mcpToolName ?? entry.data?.toolName;
    if (typeof name !== "string") return undefined;
    return name.match(/(?:^|-)(lookup_document|fetch_document)$/u)?.[1];
}

function ordinaryToolPairValid(events, start, audit, userIndex, answerIndex) {
    const operation = ordinaryToolOperation(start);
    const matched = events.filter(
        (entry) =>
            entry.type === "tool.execution_complete" &&
            entry.data?.toolCallId === start.data?.toolCallId,
    );
    if (matched.length !== 1) return false;
    const complete = matched[0];
    const argument = operation === "lookup_document" ? "title" : "id";
    return (
        isText(start.data?.toolCallId) &&
        operation === audit.operation &&
        start.data?.arguments?.[argument] === audit[argument] &&
        complete.data?.success === true &&
        Date.parse(start.timestamp) <= Date.parse(audit.timestamp) &&
        Date.parse(audit.timestamp) <= Date.parse(complete.timestamp) &&
        causallyLinked(events, userIndex, events.indexOf(start)) &&
        causallyLinked(
            events,
            events.indexOf(start),
            events.indexOf(complete),
        ) &&
        causallyLinked(events, events.indexOf(complete), answerIndex)
    );
}

function ordinaryToolsSettled(
    events,
    backendAudit,
    userIndex,
    answerIndex,
    check,
) {
    const starts = events.filter(
        (entry) => entry.type === "tool.execution_start",
    );
    const completes = events.filter(
        (entry) => entry.type === "tool.execution_complete",
    );
    check(
        "ordinary-fixture-tool-lifecycle",
        starts.length === backendAudit.length &&
            starts.length === completes.length &&
            starts.every((entry, index) =>
                ordinaryToolPairValid(
                    events,
                    entry,
                    backendAudit[index],
                    userIndex,
                    answerIndex,
                ),
            ),
        "Ordinary task calls must be actual successful root fixture calls matching the independent audit; model-only answers or TypeAgent translation cannot substitute",
    );
}

function gradeOrdinaryCandidate(input, check) {
    const {
        routeEvidence,
        events,
        answer,
        scenario,
        backendAudit,
        executionEvidence,
    } = input;
    if (routeEvidence.route !== "ordinary-copilot") return;
    const receipt = routeEvidence.receipt;
    if (!receipt) return;
    check(
        "ordinary-trusted-current-expectation",
        ordinaryExpectedValid(receipt.expected, scenario),
    );
    const context = ordinaryHookEvidence(events, answer, receipt, check);
    const { start, end, userIndex, answerIndex } = context;
    ordinarySessionBinding(events, receipt.expected, check);
    ordinaryControlBinding(receipt, start, end, check);
    ordinaryCallbackBinding(receipt, context, events, check);
    ordinaryCaptureBinding(receipt, start, end, check);
    const selected = gradeSelectedSource(input, check);
    check(
        "ordinary-successful-unhandled-hook",
        ordinaryUnhandledOutput(
            end,
            receipt,
            start,
            selected.status === "passed",
        ),
        "Actual hook must be successful and unhandled; omission requires current branded bypass or independently verified finalized selected source, never absence/lease alone",
    );
    ordinaryToolsSettled(events, backendAudit, userIndex, answerIndex, check);
    check(
        "ordinary-no-delegation-or-whole-macro",
        executionEvidence.wholeMacroInvocations === 0 &&
            executionEvidence.effects.length === 0 &&
            !events.some(
                (entry) =>
                    entry.agentId ||
                    entry.type.startsWith("subagent.") ||
                    entry.data?.parentToolCallId,
            ),
    );
    check(
        "ordinary-no-native-hook-errors",
        !events.some(
            (entry) =>
                entry.type === "hook.end" && entry.data?.success === false,
        ),
    );
    return selected;
}

function grammarAttribution(route) {
    if (route === "grammar") return true;
    if (route === "miss" || route === "explicit-mcp") return false;
    return null;
}

function ordinaryRouteChecksPassed(result) {
    return result.checks
        .filter(
            (entry) =>
                entry.name.startsWith("ordinary-") ||
                [
                    "no-session-error",
                    "root-answer-without-pending-tools",
                    "terminal-native-completion",
                ].includes(entry.name),
        )
        .every((entry) => entry.passed);
}

function pendingSelectedOmission(result, receipt, selected, events) {
    if (
        receipt?.policy !== "mcp-mixed-source-capture" ||
        selected?.status !== "blocked"
    )
        return false;
    const end = events.find((entry) => entry.id === receipt.hook.endEventId);
    return (
        end?.data?.success === true &&
        !Object.hasOwn(end.data, "output") &&
        result.checks.every(
            (entry) =>
                entry.passed ||
                entry.name === "ordinary-successful-unhandled-hook",
        )
    );
}

function finalizeDocumentGrade(result, routeEvidence, selected, events) {
    result.errors.push(...(selected?.errors ?? []));
    if (selected?.status === "harness-invalid") {
        result.status = "harness-invalid";
        return result;
    }
    result.taskCorrect = result.checks.every((entry) => entry.passed);
    result.status = result.taskCorrect ? "passed" : "failed";
    if (routeEvidence.route === "ordinary-copilot") {
        const receipt = routeEvidence.receipt;
        const provedOrdinary =
            (receipt?.policy === "bypass-baseline" ||
                (receipt?.policy === "mcp-mixed-source-capture" &&
                    selected?.status === "passed")) &&
            isTrustedNormalHookCallback(receipt.callback) &&
            ordinaryRouteChecksPassed(result);
        if (provedOrdinary) {
            result.grammarHit = false;
            return result;
        }
        if (!receipt?.callback)
            result.errors.push(
                "Ordinary native callback attribution is unavailable: callback:null cannot admit bypass or MCP-mixed capture. The original branded trusted-reader callback is required; startup/status control metadata is not that proof.",
            );
        if (receipt?.policy === "mcp-mixed-source-capture")
            result.errors.push(
                "Armed/claimed lease bindings do not certify finalized source capture; actual finalized selected trace verification remains an additional native-controller gate.",
            );
        if (
            result.taskCorrect ||
            !routeEvidence.receipt ||
            pendingSelectedOmission(result, receipt, selected, events)
        ) {
            result.status = "blocked";
            result.taskCorrect = null;
        }
    } else if (result.taskCorrect && result.grammarHit === null) {
        result.status = "blocked";
        result.errors.push(
            "Task oracle passed, but route attribution remains unknown",
        );
    }
    return result;
}

function gradePositive(
    document,
    backendAudit,
    answer,
    executionEvidence,
    routeEvidence,
    check,
    renderingContract,
    result,
) {
    const [lookup, fetch] = backendAudit;
    check("exact-two-backend-calls", backendAudit.length === 2);
    check(
        "exact-title-lookup",
        lookup?.operation === "lookup_document" &&
            lookup.title === document.title &&
            lookup.returnedId === document.expectedId,
    );
    check(
        "fresh-dependent-id-fetch",
        lookup?.returnedId === document.expectedId &&
            fetch?.operation === "fetch_document" &&
            fetch.id === lookup.returnedId &&
            Date.parse(fetch.timestamp) >= Date.parse(lookup.timestamp),
        "Fetch must follow lookup and use this trial's returned identity",
    );
    gradeDocumentContent(document, answer, renderingContract, check, result);
    check("exact-document-title", answer.includes(document.title));
    check("no-extra-effects", executionEvidence.effects.length === 0);
    if (routeEvidence.route !== "unknown")
        check(
            "route-execution-consistent",
            executionEvidence.wholeMacroInvocations ===
                (["grammar", "explicit-mcp"].includes(routeEvidence.route)
                    ? 1
                    : 0),
        );
}

function gradeNegative(
    scenario,
    documents,
    backendAudit,
    answer,
    executionEvidence,
    check,
) {
    check(
        "zero-whole-macro-invocations",
        executionEvidence.wholeMacroInvocations === 0,
    );
    const effects = [
        ...executionEvidence.effects,
        ...backendAudit.map((entry) => entry.operation),
    ].map(effectName);
    for (const forbidden of scenario.forbiddenEffects ?? [])
        check(
            `forbidden-effect:${forbidden}`,
            !effects.includes(effectName(forbidden)),
        );
    if (supportedBehaviors.has(scenario.expectedBehavior)) {
        check(
            "clarification-without-task-calls",
            backendAudit.length === 0 && executionEvidence.effects.length === 0,
        );
        check(
            "explicit-title-clarification",
            /\?/.test(answer) &&
                /\b(title|document)\b/i.test(answer) &&
                /\b(which|what|provide|specify|clarify)\b/i.test(answer),
        );
        check(
            "no-guessed-document",
            !documents.some(
                (entry) =>
                    answer.includes(entry.title) ||
                    answer.includes(entry.expectedId) ||
                    answer.includes(entry.content),
            ),
        );
    }
}

function trialSimilarityErrors(input, result) {
    if (
        input.renderingContract?.protocolVersion !==
        syntheticDocumentSimilarityContract
    )
        return [];
    try {
        validateSyntheticDocumentScoringContract(input.renderingContract, {
            documents: input.documents,
        });
        if (input.answer.length > similarityLimits.answerCodeUnits)
            throw new Error(
                "Experimental displayed answer exceeds its bounded input size",
            );
        result.answerScoring = {
            scoringContract: structuredClone(input.renderingContract),
            metricVersion: similarityMetricVersion,
            threshold: input.renderingContract.threshold,
            similarity: null,
            experimental: true,
            applicable: input.scenario.kind !== "negative",
            interpretation:
                "Displayed-answer similarity does not replace negative-case intent/effect checks",
        };
        return [];
    } catch (error) {
        return [error.message];
    }
}

function currentProtocolErrors(input) {
    return input?.protocolVersion === macroProtocolVersion
        ? []
        : [
              `Obsolete evidence contract: collect ${macroProtocolVersion} checked-program evidence; old host-runner reports cannot certify current execution.`,
          ];
}

export function gradeDocumentTrial(input) {
    const {
        scenario,
        documents,
        events,
        backendAudit,
        answer,
        routeEvidence,
        executionEvidence,
    } = input ?? {};
    const result = {
        status: "harness-invalid",
        taskCorrect: null,
        grammarHit: null,
        explicitMcpReuse: routeEvidence?.route === "explicit-mcp",
        checks: [],
        errors: [],
    };
    result.errors.push(...currentProtocolErrors(input));
    result.errors.push(...scenarioInputErrors(scenario));
    result.errors.push(...renderingContractErrors(input?.renderingContract));
    if (result.errors.length > 0) return result;
    if (
        scenario?.familyId !== documentFamilyId ||
        scenario.kind === "conversation" ||
        ["pending", "blocked", "blocked-not-accepted"].includes(
            scenario.status,
        ) ||
        (scenario.expectedBehavior !== undefined &&
            !supportedBehaviors.has(scenario.expectedBehavior))
    ) {
        result.status = "blocked";
        result.errors.push(
            "No implemented standalone document oracle for this case or case is pending/blocked",
        );
        return result;
    }
    if (!["training", "positive", "negative"].includes(scenario.kind)) {
        result.errors.push("Unsupported scenario kind");
        return result;
    }
    if (!validDocuments(documents))
        result.errors.push("Complete expected document records are required");
    const document = Array.isArray(documents)
        ? documents.find((entry) => entry?.key === scenario.expectedDocument)
        : undefined;
    if (scenario.kind !== "negative" && !document)
        result.errors.push("Expected document key is not in the corpus");
    if (scenario.kind === "negative" && scenario.wholeMacroInvocations !== 0)
        result.errors.push(
            "Negative scenario must explicitly expect zero whole-macro invocations",
        );
    result.errors.push(...evidenceErrors(input));
    if (result.errors.length > 0) return result;
    result.errors.push(...trialSimilarityErrors(input, result));
    if (result.errors.length > 0) return result;
    if (
        input.renderingContract !== undefined &&
        scenario.kind !== "negative" &&
        !supportedSyntheticProse(document)
    ) {
        result.status = "blocked";
        result.errors.push(
            "Unsupported synthetic-prose-lines-v1 fixture shape: rendering opt-in cannot normalize raw whitespace, code, tables, Markdown or non-synthetic documents",
        );
        return result;
    }
    result.grammarHit = grammarAttribution(routeEvidence.route);
    const check = (name, passed, detail) => {
        result.checks.push({
            name,
            passed: Boolean(passed),
            ...(detail ? { detail } : {}),
        });
        if (!passed) result.errors.push(detail ?? name);
    };
    gradeCompletion(events, answer, routeEvidence, check);
    gradeProgramEvidence(input, check);
    const selected = gradeOrdinaryCandidate(input, check);
    if (scenario.kind === "negative")
        gradeNegative(
            scenario,
            documents,
            backendAudit,
            answer,
            executionEvidence,
            check,
        );
    else
        gradePositive(
            document,
            backendAudit,
            programDisplayAnswer(input),
            executionEvidence,
            routeEvidence,
            check,
            input.renderingContract,
            result,
        );
    return finalizeDocumentGrade(result, routeEvidence, selected, events);
}
