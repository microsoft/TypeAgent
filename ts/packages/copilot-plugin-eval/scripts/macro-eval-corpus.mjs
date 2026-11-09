// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";

export const documentFamilyId = "exact-document-lookup-fetch";
const statuses = new Set([
    "ready-for-rehearsal-unexecuted",
    "pending",
    "blocked",
    "blocked-not-accepted",
]);
const groups = [
    ["training", "training"],
    ["heldOutPositive", "positive"],
    ["negativeOrAmbiguous", "negative"],
    ["contextualConversations", "conversation"],
];

function requireCondition(condition, message) {
    if (!condition) throw new Error(`Invalid scenario corpus: ${message}`);
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, name) {
    requireCondition(
        typeof value === "string" && value.trim().length > 0,
        `${name} must be a nonempty string`,
    );
}

function validateExpectation(value, documentKeys, name) {
    if (value.expectedDocument !== undefined)
        requireCondition(
            documentKeys.has(value.expectedDocument),
            `${name}.expectedDocument must reference a document key`,
        );
    if (value.wholeMacroInvocations !== undefined)
        requireCondition(
            Number.isInteger(value.wholeMacroInvocations) &&
                value.wholeMacroInvocations >= 0,
            `${name}.wholeMacroInvocations must be a nonnegative integer`,
        );
    if (value.forbiddenEffects !== undefined) {
        requireCondition(
            Array.isArray(value.forbiddenEffects),
            `${name}.forbiddenEffects must be an array`,
        );
        value.forbiddenEffects.forEach((effect) =>
            requireText(effect, `${name}.forbiddenEffects entry`),
        );
    }
    for (const field of ["expectedBehavior", "stratum"])
        if (value[field] !== undefined)
            requireText(value[field], `${name}.${field}`);
    if (value.status !== undefined)
        requireCondition(
            statuses.has(value.status),
            `${name}.status must explicitly be unexecuted, pending, or blocked`,
        );
}

function validateCase(value, kind, documentKeys, ids, defaultFamilyId) {
    requireCondition(isRecord(value), "case must be an object");
    requireText(value.id, "case.id");
    requireCondition(!ids.has(value.id), `duplicate case ID ${value.id}`);
    ids.add(value.id);
    const familyId = value.familyId ?? defaultFamilyId;
    requireText(familyId, `${value.id}.familyId`);
    validateExpectation(value, documentKeys, value.id);
    if (kind === "conversation") {
        requireCondition(
            Array.isArray(value.messages) && value.messages.length > 0,
            `${value.id}.messages must be a nonempty array`,
        );
        value.messages.forEach((message, index) => {
            requireCondition(isRecord(message), "message must be an object");
            requireText(message.role, "message.role");
            requireText(message.prompt, "message.prompt");
            validateExpectation(message, documentKeys, `${value.id}[${index}]`);
        });
    } else {
        requireText(value.prompt, `${value.id}.prompt`);
        requireCondition(
            value.messages === undefined,
            `${value.id} is not a conversation`,
        );
    }
    if (familyId !== documentFamilyId) {
        requireCondition(
            ["pending", "blocked", "blocked-not-accepted"].includes(
                value.status,
            ),
            `${value.id}: unsupported family must remain pending or blocked`,
        );
        requireText(value.blockedReason, `${value.id}.blockedReason`);
        return;
    }
    if (["training", "positive"].includes(kind))
        requireCondition(
            documentKeys.has(value.expectedDocument),
            `${value.id} requires expectedDocument`,
        );
    if (kind === "negative")
        requireCondition(
            value.wholeMacroInvocations === 0,
            `${value.id} requires explicit zero wholeMacroInvocations`,
        );
}

export function validateScenarioCorpus(corpus) {
    requireCondition(isRecord(corpus), "root must be an object");
    requireCondition(
        corpus.protocolVersion === "macro-user-e2e-v1",
        "unsupported protocolVersion",
    );
    requireText(corpus.familyId, "familyId");
    requireCondition(
        ["proposed-not-executed", "ready-for-rehearsal-unexecuted"].includes(
            corpus.status,
        ),
        "status must not claim scored acceptance",
    );
    requireCondition(
        Array.isArray(corpus.documents) && corpus.documents.length > 0,
        "documents must be a nonempty array",
    );
    const documentKeys = new Set();
    const titles = new Set();
    const documentIds = new Set();
    for (const document of corpus.documents) {
        requireCondition(isRecord(document), "document must be an object");
        for (const field of ["key", "title", "expectedId", "content"])
            requireText(document[field], `document.${field}`);
        for (const [field, seen] of [
            ["key", documentKeys],
            ["title", titles],
            ["expectedId", documentIds],
        ]) {
            requireCondition(
                !seen.has(document[field]),
                `duplicate document ${field}: ${document[field]}`,
            );
            seen.add(document[field]);
        }
    }
    const ids = new Set();
    for (const [group, kind] of groups) {
        requireCondition(
            Array.isArray(corpus[group]),
            `${group} must be an array`,
        );
        corpus[group].forEach((value) =>
            validateCase(value, kind, documentKeys, ids, corpus.familyId),
        );
    }
    if (corpus.reviewedCases !== undefined) {
        requireCondition(
            Array.isArray(corpus.reviewedCases),
            "reviewedCases must be an array",
        );
        for (const value of corpus.reviewedCases) {
            requireCondition(
                groups.some(([, kind]) => kind === value?.kind),
                "reviewedCases kind is unsupported",
            );
            validateCase(value, value.kind, documentKeys, ids, corpus.familyId);
        }
    }
    return corpus;
}

export function loadScenarioCorpus(filePath) {
    return validateScenarioCorpus(
        JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
}

export function getScenarioCases(corpus) {
    validateScenarioCorpus(corpus);
    const normalize = (value, kind) => ({
        ...value,
        kind,
        familyId: value.familyId ?? corpus.familyId,
        status: value.status ?? "ready-for-rehearsal-unexecuted",
    });
    return [
        ...groups.flatMap(([group, kind]) =>
            corpus[group].map((value) => normalize(value, kind)),
        ),
        ...(corpus.reviewedCases ?? []).map((value) =>
            normalize(value, value.kind),
        ),
    ];
}
