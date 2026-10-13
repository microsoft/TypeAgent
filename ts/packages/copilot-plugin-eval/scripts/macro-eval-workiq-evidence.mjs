// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
    PrivateResultStore,
    constructResultPath,
    redactTraceValue,
    resolveMacroExpression,
} from "../../copilot-macros/dist/index.js";

const operations = ["retrieve", "fetch", "fetch_blob", "fetch"];
const maxTraceBytes = 1024 * 1024;
const maxResultBytes = 16 * 1024 * 1024;
const retrievalKey = "application/vnd.ms-workiq.retrieval";
const itemPath = [
    "structuredContent",
    retrievalKey,
    "retrievalHits",
    "0",
    "entityUrl",
];
const metadataFields = [
    "id",
    "name",
    "size",
    "eTag",
    "cTag",
    "lastModifiedDateTime",
    "file",
    "parentReference",
    "webUrl",
    "sharepointIds",
];
const referenceFields = [
    "schemaVersion",
    "capability",
    "owner",
    "ownerId",
    "toolCallId",
    "source",
    "id",
    "encoding",
    "sha256",
    "sizeBytes",
    "sensitive",
    "view",
    "omittedPaths",
    "blobs",
];

export class WorkiqEvidenceError extends Error {
    constructor(status, code) {
        const safeCode =
            typeof code === "string" &&
            /^[A-Za-z][A-Za-z0-9]{0,127}$/.test(code)
                ? code
                : "invalidEvidenceError";
        super(safeCode);
        this.name = "WorkiqEvidenceError";
        this.status = ["failed", "blocked", "harness-invalid"].includes(status)
            ? status
            : "harness-invalid";
        this.code = safeCode;
    }
}

function requireEvidence(condition, code, status = "harness-invalid") {
    if (!condition) throw new WorkiqEvidenceError(status, code);
}

function record(value, allowed, code = "invalidEvidenceShape") {
    requireEvidence(
        value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.keys(value).every((key) => allowed.includes(key)),
        code,
    );
}

function equal(left, right) {
    if (left === undefined || right === undefined) return left === right;
    return isDeepStrictEqual(
        JSON.parse(JSON.stringify(left)),
        JSON.parse(JSON.stringify(right)),
    );
}

function bounded(value, maximum, code) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw new WorkiqEvidenceError("harness-invalid", code);
    }
    requireEvidence(
        typeof serialized === "string" &&
            Buffer.byteLength(serialized) <= maximum,
        code,
    );
}

function cloneContext(value, code) {
    try {
        return structuredClone(value);
    } catch {
        throw new WorkiqEvidenceError("harness-invalid", code);
    }
}

function timestamp(value) {
    const time = Date.parse(value);
    requireEvidence(
        typeof value === "string" && Number.isFinite(time),
        "invalidTimestamp",
    );
    return time;
}

function grantFree(value) {
    requireEvidence(typeof value === "string", "invalidCanonicalLocation");
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new WorkiqEvidenceError(
            "harness-invalid",
            "invalidCanonicalLocation",
        );
    }
    requireEvidence(
        url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash,
        "invalidCanonicalLocation",
    );
    return url;
}

function validateTrial(trial) {
    record(trial, ["sessionId", "traceId", "runId", "startedAt", "endedAt"]);
    for (const key of ["sessionId", "traceId"])
        requireEvidence(
            typeof trial[key] === "string" && trial[key].length > 0,
            "invalidTrialIdentity",
        );
    requireEvidence(
        trial.runId === null ||
            (typeof trial.runId === "string" && trial.runId.length > 0),
        "invalidTrialIdentity",
    );
    requireEvidence(
        timestamp(trial.startedAt) <= timestamp(trial.endedAt),
        "invalidTrialWindow",
    );
}

function validateRecipe(admission) {
    requireEvidence(admission?.schemaVersion === 1, "unsupportedAdmission");
    const recipe = admission.workflow?.recipe;
    requireEvidence(
        Array.isArray(admission.entities) &&
            admission.entities.length > 0 &&
            admission.entities.length <= 2 &&
            Array.isArray(admission.runtime?.advertisedToolSchemas),
        "unsupportedAdmission",
    );
    requireEvidence(
        Array.isArray(recipe) && recipe.length === 4,
        "invalidReadContract",
    );
    requireEvidence(
        recipe.every(
            (step) => typeof step?.step === "string" && step.step.length > 0,
        ) && new Set(recipe.map((step) => step.step)).size === 4,
        "invalidReadContract",
    );
    requireEvidence(
        equal(
            recipe.map((step) => step.advertisedTool),
            operations,
        ),
        "invalidReadContract",
    );
    for (const index of [1, 2, 3]) {
        const expression =
            index === 2
                ? recipe[index].argumentTemplate?.path
                : recipe[index].argumentTemplate?.entityUrls?.[0];
        record(
            expression,
            ["kind", "stepId", "path", "suffix"],
            "invalidBindingContract",
        );
        requireEvidence(
            expression.kind === "resultPath" &&
                expression.stepId === recipe[0].step &&
                equal(expression.path, itemPath),
            "invalidBindingContract",
        );
        const suffix = expression.suffix;
        requireEvidence(
            index === 2
                ? suffix === "/content"
                : suffix === "?$select=" + metadataFields.join(","),
            "invalidBindingContract",
        );
        constructResultPath("/drives/test/items/test", expression.suffix);
    }
    requireEvidence(
        equal(admission.sourceSchemaRequirements?.trace?.capabilities, [
            "private-result-evidence-v1",
        ]) &&
            admission.sourceSchemaRequirements.trace.schemaVersion === 2 &&
            equal(admission.sourceSchemaRequirements?.macro?.capabilities, [
                "result-path-v1",
            ]) &&
            admission.sourceSchemaRequirements.macro.schemaVersion === 2,
        "unsupportedAdmissionCapabilities",
    );
}

function validateExpectedMetadata(entity) {
    requireEvidence(
        [
            "title",
            "itemId",
            "driveId",
            "canonicalPath",
            "actualMetadataWebUrl",
            "metadataMimeType",
            "transportContentType",
            "blobName",
        ].every(
            (key) => typeof entity[key] === "string" && entity[key].length > 0,
        ),
        "invalidExpectedIdentity",
    );
    const guard = entity.oracle?.libraryGuard;
    requireEvidence(
        guard &&
            ["parentPath", "siteId", "listId"].every(
                (key) =>
                    typeof guard[key] === "string" && guard[key].length > 0,
            ) &&
            guard.driveType === "documentLibrary" &&
            guard.parentPath.startsWith(`/drives/${entity.driveId}/root:`),
        "invalidExpectedLibrary",
    );
}

function validateEntity(entity, library) {
    requireEvidence(entity && typeof entity.key === "string", "unknownEntity");
    validateExpectedMetadata(entity);
    const url = grantFree(entity.canonicalWebUrl);
    grantFree(library?.canonicalWebUrl);
    requireEvidence(
        entity.inputs?.documentUrl === entity.canonicalWebUrl &&
            typeof entity.inputs.documentQuery === "string" &&
            entity.inputs.documentQuery.trim() &&
            entity.driveId === library?.driveId &&
            entity.entityPath ===
                `/drives/${entity.driveId}/items/${entity.itemId}`,
        "invalidExpectedIdentity",
    );
    requireEvidence(
        entity.canonicalWebUrl.startsWith(library.canonicalWebUrl + "/"),
        "invalidExpectedLocation",
    );
    constructResultPath(entity.entityPath, "/content");
    requireEvidence(
        decodeURIComponent(url.pathname) === entity.canonicalPath &&
            entity.oracle?.libraryGuard?.canonicalLookupWebUrl ===
                entity.canonicalWebUrl &&
            entity.oracle.libraryGuard.driveId === library.driveId,
        "invalidExpectedLocation",
    );
    requireEvidence(
        /^[a-f0-9]{64}(?![\s\S])/.test(entity.oracle.sha256) &&
            Number.isSafeInteger(entity.oracle.sizeBytes) &&
            entity.oracle.sizeBytes > 0 &&
            entity.oracle.sizeBytes <= maxResultBytes,
        "invalidExpectedOriginal",
    );
    const frozen = entity.oracle.frozenVersion;
    requireEvidence(
        frozen?.size === entity.oracle.sizeBytes &&
            typeof frozen.eTag === "string" &&
            frozen.eTag &&
            typeof frozen.cTag === "string" &&
            frozen.cTag,
        "invalidExpectedVersion",
    );
    timestamp(frozen.lastModifiedDateTime);
}

function validateDiscovery(discovery, admission, trial) {
    record(discovery, ["origin", "sessionId", "tools"]);
    requireEvidence(
        discovery.origin === "native-tool-discovery" &&
            discovery.sessionId === trial.sessionId &&
            Array.isArray(discovery.tools),
        "unverifiedCatalog",
    );
    const mapped = new Map();
    for (const operation of new Set(operations)) {
        const matches = discovery.tools.filter(
            (tool) => tool.advertisedName === operation,
        );
        requireEvidence(matches.length === 1, "ambiguousCatalog");
        const tool = matches[0];
        record(tool, [
            "advertisedName",
            "callableName",
            "mcpServerName",
            "inputSchema",
            "annotations",
        ]);
        const expected = admission.runtime.advertisedToolSchemas.find(
            (entry) => entry.advertisedName === operation,
        );
        requireEvidence(
            expected &&
                typeof tool.callableName === "string" &&
                tool.callableName &&
                tool.mcpServerName === admission.runtime.mcpServer &&
                equal(tool.inputSchema, expected.inputSchema) &&
                tool.annotations?.readOnlyHint === true &&
                tool.annotations?.destructiveHint === false &&
                equal(tool.annotations, expected.annotations),
            "catalogSchemaDrift",
            "blocked",
        );
        requireEvidence(
            ![...mapped.values()].some(
                (prior) => prior.callableName === tool.callableName,
            ),
            "ambiguousCatalog",
        );
        mapped.set(operation, tool);
    }
    return mapped;
}

function validateCurrentCall(call, recorded, trial, expected, previous) {
    record(
        recorded,
        [
            "toolCallId",
            "name",
            "mcpServerName",
            "arguments",
            "result",
            "modelResult",
            "resultArtifact",
            "modelResultArtifact",
            "status",
            "permission",
        ],
        "invalidTraceToolCallShape",
    );
    record(call, [
        "sessionId",
        "traceId",
        "runId",
        "toolCallId",
        "name",
        "mcpServerName",
        "arguments",
        "status",
        "startedAt",
        "completedAt",
        "result",
    ]);
    requireEvidence(
        typeof call.toolCallId === "string" &&
            call.toolCallId.length > 0 &&
            call.sessionId === trial.sessionId &&
            call.traceId === trial.traceId &&
            call.runId === trial.runId &&
            call.toolCallId === recorded.toolCallId,
        "foreignToolCall",
    );
    requireEvidence(
        call.name === expected.callableName &&
            recorded.name === call.name &&
            call.mcpServerName === expected.mcpServerName &&
            recorded.mcpServerName === call.mcpServerName,
        "unexpectedTool",
        "failed",
    );
    requireEvidence(
        equal(call.arguments, recorded.arguments),
        "sourceArgumentMismatch",
    );
    requireEvidence(
        call.status !== "denied" && call.status !== "cancelled",
        "permissionStopped",
        "blocked",
    );
    requireEvidence(
        call.status === "completed" && recorded.status === "completed",
        "toolFailed",
        "failed",
    );
    const start = timestamp(call.startedAt);
    const end = timestamp(call.completedAt);
    requireEvidence(
        start >= previous && end >= start && end <= timestamp(trial.endedAt),
        "nonserialCalls",
        "failed",
    );
    requireEvidence(call.result !== undefined, "missingActualToolResult");
    bounded(call.result, maxResultBytes, "oversizedActualResult");
    return end;
}

function validateCurrent(current, trial, catalog) {
    record(current, ["origin", "trace", "calls", "discovery"]);
    requireEvidence(
        current.origin === "owned-native-session-events",
        "unverifiedNativeOrigin",
    );
    const { trace, calls } = current;
    requireEvidence(
        trace && Array.isArray(trace.toolCalls) && Array.isArray(calls),
        "missingCurrentEvidence",
    );
    bounded(trace, maxTraceBytes, "oversizedStoredTrace");
    requireEvidence(
        trace.schemaVersion === 2 &&
            equal(trace.capabilities, ["private-result-evidence-v1"]),
        "unsupportedTrace",
    );
    requireEvidence(
        trace.traceId === trial.traceId &&
            trace.sessionId === trial.sessionId &&
            (trace.handoffRunId ?? null) === trial.runId,
        "foreignTrace",
    );
    requireEvidence(
        timestamp(trace.startedAt) >= timestamp(trial.startedAt) &&
            timestamp(trace.completedAt) <= timestamp(trial.endedAt) &&
            timestamp(trace.createdAt) >= timestamp(trace.completedAt) &&
            timestamp(trace.createdAt) <= timestamp(trial.endedAt),
        "foreignTraceWindow",
    );
    requireEvidence(
        calls.length >= 4 && trace.toolCalls.length >= 4,
        "missingCurrentCalls",
    );
    requireEvidence(
        calls.length === 4 && trace.toolCalls.length === 4,
        "extraCalls",
        "failed",
    );
    const ids = new Set();
    let previous = timestamp(trial.startedAt);
    for (const [index, call] of calls.entries()) {
        previous = validateCurrentCall(
            call,
            trace.toolCalls[index],
            trial,
            catalog.get(operations[index]),
            previous,
        );
        requireEvidence(!ids.has(call.toolCallId), "duplicateToolCall");
        ids.add(call.toolCallId);
    }
    requireEvidence(
        timestamp(trace.startedAt) <= timestamp(calls[0].startedAt) &&
            timestamp(trace.completedAt) >= timestamp(calls[3].completedAt),
        "foreignTraceWindow",
    );
}

async function originalResult(
    store,
    recorded,
    call,
    trial,
    requireArtifact = false,
) {
    let value;
    if (recorded.resultArtifact) {
        record(
            recorded.resultArtifact,
            referenceFields,
            "invalidArtifactReference",
        );
        requireEvidence(
            recorded.resultArtifact.source === "result",
            "wrongArtifactSource",
        );
        value = await store.verify(
            recorded.resultArtifact,
            "trace",
            trial.traceId,
            call.toolCallId,
            "result",
        );
        requireEvidence(
            equal(recorded.result, recorded.resultArtifact.view),
            "forgedResultView",
        );
        requireEvidence(equal(value, call.result), "artifactEventMismatch");
    } else {
        requireEvidence(
            !requireArtifact,
            recorded.modelResultArtifact
                ? "modelOnlyEvidence"
                : "missingOriginalArtifact",
        );
        requireEvidence(
            equal(recorded.result, redactTraceValue(call.result)),
            "inlineEventMismatch",
        );
        value = call.result;
    }
    if (recorded.modelResultArtifact) {
        record(
            recorded.modelResultArtifact,
            referenceFields,
            "invalidArtifactReference",
        );
        await store.verify(
            recorded.modelResultArtifact,
            "trace",
            trial.traceId,
            call.toolCallId,
            "modelResult",
        );
        requireEvidence(
            equal(recorded.modelResult, recorded.modelResultArtifact.view),
            "forgedModelResultView",
        );
    }
    return readWorkiqOriginalEnvelope(value);
}

export function readWorkiqOriginalEnvelope(result) {
    let value = result;
    if (typeof value?.content === "string") {
        record(
            value,
            ["content", "detailedContent", "contents"],
            "unsupportedSDKResult",
        );
        try {
            value = JSON.parse(value.content);
        } catch {
            throw new WorkiqEvidenceError("blocked", "incompleteSDKResult");
        }
    }
    record(
        value,
        ["content", "isError", "structuredContent"],
        "unsupportedToolEnvelope",
    );
    requireEvidence(value.isError === false, "providerError", "failed");
    requireEvidence(
        Array.isArray(value.content) && value.structuredContent,
        "incompleteOriginalResult",
        "blocked",
    );
    return value;
}

export function validateWorkiqArtifactReference(reference) {
    record(reference, referenceFields, "invalidArtifactReference");
}

function checkLookup(envelope, entity) {
    record(
        envelope.structuredContent,
        [retrievalKey],
        "unsupportedLookupOutput",
    );
    const lookup = envelope.structuredContent[retrievalKey];
    record(
        lookup,
        ["markdown", "resultCount", "retrievalHits", "stoppedReason"],
        "unsupportedLookupOutput",
    );
    requireEvidence(
        typeof lookup.markdown === "string" &&
            Array.isArray(lookup.retrievalHits),
        "incompleteLookup",
    );
    requireEvidence(
        lookup.resultCount === 1 &&
            lookup.retrievalHits.length === 1 &&
            lookup.stoppedReason === "completed",
        "nonuniqueLookup",
        "failed",
    );
    const hit = lookup.retrievalHits[0];
    record(
        hit,
        [
            "driveId",
            "itemId",
            "entityUrl",
            "webUrl",
            "resourceMetadata",
            "entityType",
            "id",
            "resourceId",
        ],
        "unsupportedLookupHit",
    );
    requireEvidence(hit.driveId === entity.driveId, "wrongLibrary", "failed");
    requireEvidence(
        hit.itemId === entity.itemId &&
            hit.entityUrl === entity.entityPath &&
            hit.webUrl === entity.canonicalWebUrl,
        "wrongDocument",
        "failed",
    );
}

function checkMetadata(envelope, entity) {
    record(
        envelope.structuredContent,
        ["results"],
        "unsupportedMetadataOutput",
    );
    const results = envelope.structuredContent.results;
    requireEvidence(
        Array.isArray(results) && results.length === 1,
        "incompleteMetadata",
    );
    record(results[0], ["data", "statusCode"], "unsupportedMetadataOutput");
    requireEvidence(results[0].statusCode === 200, "metadataError", "failed");
    const data = results[0].data;
    record(
        data,
        [...metadataFields, "@odata.context", "@odata.etag"],
        "unsupportedMetadataFields",
    );
    requireEvidence(
        metadataFields.every((field) => Object.hasOwn(data, field)),
        "incompleteMetadata",
    );
    requireEvidence(
        data.id === entity.itemId && data.name === entity.title,
        "wrongDocument",
        "failed",
    );
    const guard = entity.oracle.libraryGuard;
    const parent = data.parentReference;
    requireEvidence(
        parent &&
            parent.driveId === guard.driveId &&
            parent.driveType === guard.driveType &&
            parent.path === guard.parentPath &&
            data.sharepointIds?.siteId === guard.siteId &&
            data.sharepointIds?.listId === guard.listId,
        "wrongLibrary",
        "failed",
    );
    requireEvidence(
        data.webUrl === entity.actualMetadataWebUrl &&
            data.file?.mimeType === entity.metadataMimeType,
        "wrongDocument",
        "failed",
    );
    const frozen = entity.oracle.frozenVersion;
    for (const key of ["size", "eTag", "cTag", "lastModifiedDateTime"])
        requireEvidence(data[key] === frozen[key], "versionDrift", "blocked");
}

async function checkBlob(store, envelope, recorded, entity, trial) {
    record(
        envelope.structuredContent,
        ["base64Content", "blobName", "contentType", "sizeBytes", "statusCode"],
        "unsupportedBlobOutput",
    );
    const blob = envelope.structuredContent;
    requireEvidence(
        envelope.content.length === 0 &&
            blob.statusCode === 200 &&
            typeof blob.base64Content === "string",
        "incompleteOriginalResult",
        "blocked",
    );
    let ref = recorded.resultArtifact;
    let receipt = ref.blobs.find((entry) =>
        equal(entry.path, ["structuredContent", "base64Content"]),
    );
    if (!receipt) {
        requireEvidence(
            recorded.modelResultArtifact,
            "missingOriginalBlobReceipt",
            "blocked",
        );
        record(
            recorded.modelResultArtifact,
            referenceFields,
            "invalidArtifactReference",
        );
        const parsed = await store.verify(
            recorded.modelResultArtifact,
            "trace",
            trial.traceId,
            recorded.toolCallId,
            "modelResult",
        );
        requireEvidence(equal(parsed, envelope), "modelOriginalMismatch");
        ref = recorded.modelResultArtifact;
        receipt = ref.blobs.find((entry) =>
            equal(entry.path, ["structuredContent", "base64Content"]),
        );
    }
    requireEvidence(
        receipt?.encoding === "base64",
        "missingOriginalBlobReceipt",
        "blocked",
    );
    const bytes = Buffer.from(blob.base64Content, "base64");
    requireEvidence(
        bytes.length === receipt.sizeBytes && bytes.length === blob.sizeBytes,
        "originalSizeMismatch",
        "failed",
    );
    requireEvidence(
        receipt.sha256 === entity.oracle.sha256 &&
            receipt.sizeBytes === entity.oracle.sizeBytes,
        "originalDigestMismatch",
        "failed",
    );
    requireEvidence(
        blob.blobName === entity.blobName &&
            blob.contentType === entity.transportContentType,
        "wrongRepresentation",
        "failed",
    );
    return {
        sha256: receipt.sha256,
        sizeBytes: receipt.sizeBytes,
        artifactId: recorded.resultArtifact.id,
    };
}

/**
 * Host-only factory. readCurrent must read the active owned native event stream
 * and finalized trace, not caller-supplied JSON or frozen document receipts.
 * Public verify input selects an entity only; trusted trial/store/catalog context
 * is closed over here. This is not authentication for an untrusted host callback.
 * The loader returns {origin, trace, calls, discovery}; calls carry current SDK
 * originals, identities, arguments, status and event timestamps. Only v2 trace
 * evidence is accepted: run-step artifacts alone lack SDK tool-call correlation.
 * Factory failures throw WorkiqEvidenceError; verification returns a scoped
 * passed/failed/blocked/harness-invalid verdict, never whole-trial acceptance.
 */
export function createWorkiqEvidenceVerifier(options) {
    record(
        options,
        ["artifactRoot", "admission", "trial", "readCurrent"],
        "invalidVerifierOptions",
    );
    requireEvidence(
        typeof options.artifactRoot === "string" &&
            path.isAbsolute(options.artifactRoot) &&
            typeof options.readCurrent === "function",
        "invalidHostBoundary",
    );
    bounded(options.admission, 256 * 1024, "oversizedAdmission");
    const admission = cloneContext(options.admission, "invalidAdmission");
    const trial = cloneContext(options.trial, "invalidTrial");
    validateTrial(trial);
    validateRecipe(admission);
    const readCurrent = options.readCurrent;
    const store = new PrivateResultStore(options.artifactRoot);
    return Object.freeze({
        async verify(request) {
            const verdict = {
                schemaVersion: 1,
                scope: "workiq-tool-artifact-content-only",
                status: "harness-invalid",
                code: "invalidEvidence",
                originalBytesVerified: false,
                fullTrialAccepted: false,
                nativeTerminalVerified: false,
                modelConsumptionVerified: false,
            };
            try {
                record(request, ["entityKey"], "invalidVerifierRequest");
                const entity = admission.entities.find(
                    (entry) => entry.key === request.entityKey,
                );
                validateEntity(entity, admission.library);
                const current = await readCurrent(structuredClone(trial));
                const catalog = validateDiscovery(
                    current?.discovery,
                    admission,
                    trial,
                );
                validateCurrent(current, trial, catalog);
                const envelopes = [];
                for (let index = 0; index < 4; index++) {
                    const call = current.calls[index];
                    let expected;
                    if (index === 0) {
                        expected = {
                            query: entity.inputs.documentQuery,
                            strategy: "grounding",
                            capabilities: [
                                {
                                    name: "OneDriveAndSharePoint",
                                    items_by_url: [
                                        { url: entity.canonicalWebUrl },
                                    ],
                                },
                            ],
                        };
                    } else {
                        const recipe = admission.workflow.recipe[index];
                        const expression =
                            index === 2
                                ? recipe.argumentTemplate.path
                                : recipe.argumentTemplate.entityUrls[0];
                        const result = resolveMacroExpression(
                            expression,
                            entity.inputs,
                            new Map([
                                [
                                    admission.workflow.recipe[0].step,
                                    envelopes[0],
                                ],
                            ]),
                        );
                        expected =
                            index === 2
                                ? { path: result }
                                : { entityUrls: [result] };
                    }

                    requireEvidence(
                        equal(call.arguments, expected),
                        "bindingMismatch",
                        "failed",
                    );
                    const envelope = await originalResult(
                        store,
                        current.trace.toolCalls[index],
                        call,
                        trial,
                        index === 2,
                    );
                    envelopes.push(envelope);
                    if (index === 0) checkLookup(envelope, entity);
                    if (index === 1 || index === 3)
                        checkMetadata(envelope, entity);
                }
                const receipt = await checkBlob(
                    store,
                    envelopes[2],
                    current.trace.toolCalls[2],
                    entity,
                    trial,
                );
                return {
                    ...verdict,
                    status: "passed",
                    code: "verifiedCurrentOriginal",
                    originalBytesVerified: true,
                    entityKey: entity.key,
                    sessionId: trial.sessionId,
                    traceId: trial.traceId,
                    runId: trial.runId,
                    operations: [...operations],
                    receipt,
                    modelResultExposure:
                        "Not certified by this oracle; captured modelResult fields do not prove model visibility or semantic consumption.",
                };
            } catch (error) {
                if (error instanceof WorkiqEvidenceError)
                    return {
                        ...verdict,
                        status: error.status,
                        code: error.code,
                    };
                const known = new Set([
                    "invalidReference",
                    "missingEvidence",
                    "unsafeEvidencePath",
                    "evidenceIntegrity",
                    "invalidEncoding",
                    "evidenceTooLarge",
                    "evidenceViewTooLarge",
                ]);
                return {
                    ...verdict,
                    code: "invalidArtifactOrHostEvidence",
                    ...(known.has(error?.code)
                        ? { artifactError: error.code }
                        : {}),
                };
            }
        },
    });
}

export {
    validateRecipe as validateWorkiqAdmission,
    validateEntity as validateWorkiqEntity,
    checkLookup as validateWorkiqLookup,
    checkMetadata as validateWorkiqMetadata,
};
