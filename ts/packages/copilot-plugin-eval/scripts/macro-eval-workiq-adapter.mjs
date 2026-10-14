// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { mkdir, writeFile, lstat, realpath, open } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import {
    PrivateResultStore,
    resolveMacroExpression,
} from "../../copilot-macros/dist/index.js";
import {
    WorkiqEvidenceError,
    createWorkiqEvidenceVerifier,
    readWorkiqOriginalEnvelope,
    validateWorkiqAdmission,
    validateWorkiqEntity,
    validateWorkiqLookup,
    validateWorkiqMetadata,
    validateWorkiqArtifactReference,
    workiqMacroCorrectnessContract,
    workiqRequestMatches,
    readWorkiqSdkOriginalEnvelope,
    isWorkiqSdkStructuredResult,
} from "./macro-eval-workiq-evidence.mjs";

const operations = ["retrieve", "fetch", "fetch_blob", "fetch"];
const limit = 16 * 1024 * 1024;
const clone = (value) => structuredClone(value);
export const workiqJsonHash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fault = (code, status = "harness-invalid") =>
    new WorkiqEvidenceError(status, code);
const requireFact = (condition, code, status) => {
    if (!condition) throw fault(code, status);
};
const identifier = (value) =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const captureCompletionGuidance =
    "Capture completion policy v1: finish exactly four serial WorkIQ reads: retrieve, metadata fetch, fetch_blob, final metadata fetch for the same freshly bound entity. " +
    "Wait for each result before the next read; after fetch_blob, issue the final metadata fetch directly, then finish. " +
    "Do not start task/subagents, parallel tool calls, terminal commands, local files, byte-count/hash checks or other tools during this capture. " +
    "The host independently verifies the complete original bytes and version; do not delegate or perform that verification yourself. " +
    "This is direct capture guidance, not approval or a restriction on a subsequent source-qualified host-controlled approved macro handoff.";

function metadataBindingGuidance(admission) {
    const suffix =
        admission.workflow.recipe[1].argumentTemplate.entityUrls[0].suffix;
    return (
        "Metadata binding policy v1: both metadata fetches must use the freshly returned retrievalHits[0].entityUrl with the approved suffix JSON: " +
        JSON.stringify(suffix) +
        ". Use exactly one $select with every approved field, including lastModifiedDateTime; order and equivalent query encoding may vary, but no field may be omitted, duplicated or added. " +
        "Do not substitute id, resourceId or display webUrl for entityUrl, and do not add other query parameters. " +
        "Frozen version verification requires all these fields; partial metadata is not an authorized substitute. " +
        "Copy the complete suffix for the first and final metadata reads; this guidance does not change consent, scope, arguments or permissions."
    );
}

export async function assertWorkiqHost(callback, value) {
    requireFact(
        typeof callback === "function",
        "missingTrustedWorkiqAssertion",
        "blocked",
    );
    requireFact(
        (await callback(value)) === undefined,
        "workiqHostAssertionContract",
        "blocked",
    );
}

function entityFor(admission, key) {
    validateWorkiqAdmission(admission);
    const entity = admission.entities.find((entry) => entry.key === key);
    validateWorkiqEntity(entity, admission.library);
    return entity;
}

export function workiqReadArguments(admission, entityKey, index, lookup) {
    const entity = entityFor(admission, entityKey);
    requireFact(
        Number.isInteger(index) && index >= 0 && index < 4,
        "invalidReadIndex",
    );
    if (index === 0)
        return {
            query: entity.inputs.documentQuery,
            strategy: "grounding",
            capabilities: [
                {
                    name: "OneDriveAndSharePoint",
                    items_by_url: [{ url: entity.canonicalWebUrl }],
                },
            ],
        };
    validateWorkiqLookup(lookup, entity, admission);
    const recipe = admission.workflow.recipe[index];
    const expression =
        index === 2
            ? recipe.argumentTemplate.path
            : recipe.argumentTemplate.entityUrls[0];
    const value = resolveMacroExpression(
        expression,
        entity.inputs,
        new Map([[admission.workflow.recipe[0].step, lookup]]),
    );
    return index === 2 ? { path: value } : { entityUrls: [value] };
}

export function workiqLookupBindingGuidance(admission, entityKey) {
    const { query, strategy } = workiqReadArguments(admission, entityKey, 0);
    requireFact(
        typeof query === "string" &&
            !/(?:https?:\/\/|bearer\s|(?:access[_-]?token|api[_-]?key)\s*[:=]|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/iu.test(
                query,
            ),
        "unsafeWorkiqLookupGuidance",
        "blocked",
    );
    return (
        "Frozen lookup scalar binding JSON: " +
        JSON.stringify({ query, strategy }) +
        "\nCopy these scalar values exactly into retrieve; query is the literal lookup text, not the URL identity selector. " +
        "Do not paraphrase, prepend instructions, append the document URL, or omit strategy. " +
        "In the capabilities array, bind the OneDriveAndSharePoint entry's items_by_url only to the exact document URL already supplied in the user prompt. " +
        "That URL belongs only in capabilities, not in query. No broader search is authorized. " +
        (workiqMacroCorrectnessContract(admission)
            ? "Optional diagnostics contract v2: includeDeveloperCard may be absent, true or false; no other extra argument is authorized."
            : "No extra field is authorized.") +
        (workiqMacroCorrectnessContract(admission) && entityKey === "A"
            ? "\n" +
              captureCompletionGuidance +
              "\n" +
              metadataBindingGuidance(admission)
            : "")
    );
}

export function workiqModelVisibleTools(tools, lookupGuidance) {
    requireFact(
        typeof lookupGuidance === "string" &&
            lookupGuidance.startsWith("Frozen lookup scalar binding JSON: "),
        "invalidWorkiqModelGuidance",
        "blocked",
    );
    const exposed = clone(tools);
    const matches = exposed.filter((tool) => tool.name === "retrieve");
    requireFact(matches.length === 1, "ambiguousWorkiqGuidanceTool", "blocked");
    matches[0].description =
        "WorkIQ frozen request guidance; not an authorization grant. " +
        (lookupGuidance.includes("Optional diagnostics contract v2:")
            ? "Use query, strategy and capabilities; includeDeveloperCard is an optional boolean diagnostic argument, not a document binding. "
            : "Use only query, strategy and capabilities; omit includeDeveloperCard entirely, including false. ") +
        "Do not retry a failed call or delegate a rejected read.\n" +
        lookupGuidance +
        "\nBackend tool description:\n" +
        (matches[0].description ?? "");
    const captureStart = lookupGuidance.indexOf(
        "\nCapture completion policy v1:",
    );
    if (captureStart !== -1)
        for (const tool of exposed) {
            if (tool.name === "retrieve") continue;
            tool.description =
                lookupGuidance.slice(captureStart + 1) +
                "\nBackend tool description:\n" +
                (tool.description ?? "");
        }
    return exposed;
}

// Pure metadata validation, not native readiness or permission authority.
export function verifyWorkiqModelVisibleMetadata(metadata, server, expected) {
    const mapped = Array.isArray(metadata?.tools)
        ? metadata.tools.filter((tool) => tool.mcpServerName === server)
        : undefined;
    requireFact(
        mapped?.length === expected.length,
        "workiqModelGuidanceInventoryMismatch",
        "blocked",
    );
    for (const tool of expected) {
        const matches = mapped.filter((item) => item.mcpToolName === tool.name);
        requireFact(
            matches.length === 1 &&
                isDeepStrictEqual(matches[0].input_schema, tool.inputSchema) &&
                matches[0].description === tool.description,
            "workiqModelGuidanceDescriptionMismatch",
            "blocked",
        );
    }
}

async function safeFile(root, relative, maximum) {
    requireFact(
        path.isAbsolute(root) && !path.isAbsolute(relative),
        "invalidOwnedPath",
    );
    const filename = path.resolve(root, relative);
    const relation = path.relative(root, filename);
    requireFact(
        relation && !relation.startsWith("..") && !path.isAbsolute(relation),
        "invalidOwnedPath",
    );
    await safeAncestors(filename);
    requireFact((await realpath(filename)) === filename, "unsafeOwnedPath");
    const before = await lstat(filename);
    requireFact(
        before.isFile() && before.nlink === 1 && before.size <= maximum,
        "invalidOwnedFile",
    );
    const handle = await open(filename, "r");
    try {
        const current = await handle.stat();
        requireFact(
            current.ino === before.ino &&
                current.dev === before.dev &&
                current.size === before.size,
            "changedOwnedFile",
        );
        const bytes = await handle.readFile();
        const after = await lstat(filename);
        requireFact(
            bytes.length <= maximum &&
                after.ino === before.ino &&
                after.dev === before.dev &&
                after.size === before.size &&
                after.mtimeMs === before.mtimeMs &&
                !after.isSymbolicLink(),
            "changedOwnedFile",
        );
        return bytes;
    } finally {
        await handle.close();
    }
}

async function safeAncestors(filename) {
    let ancestor = filename;
    while (true) {
        const stat = await lstat(ancestor);
        requireFact(!stat.isSymbolicLink(), "unsafeOwnedPath");
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
    }
}

export async function readWorkiqOwnedJson(
    root,
    relative,
    maximum = 1024 * 1024,
) {
    try {
        return JSON.parse(
            (await safeFile(root, relative, maximum)).toString("utf8"),
        );
    } catch (error) {
        if (error instanceof WorkiqEvidenceError) throw error;
        throw fault("missingOrInvalidOwnedJson");
    }
}

async function immutableJson(root, name, value) {
    await safeAncestors(root);
    requireFact((await realpath(root)) === root, "unsafeOwnedPath");
    const bytes = JSON.stringify(value);
    requireFact(Buffer.byteLength(bytes) <= 256 * 1024, "oversizedAuditRecord");
    await writeFile(path.join(root, name), bytes, { flag: "wx", mode: 0o600 });
}

function agencyLaunch(admission) {
    const command = admission.runtime.knownLocalExecutable;
    const args = admission.runtime.knownStdioArguments;
    requireFact(
        typeof command === "string" &&
            path.isAbsolute(command) &&
            path.basename(command).toLowerCase() === "agency.exe" &&
            isDeepStrictEqual(args, ["mcp", "workiq"]),
        "unsupportedAgencyLaunch",
    );
    return { command, args: clone(args) };
}

async function actualAgencyClient(admission, signal) {
    const transport = new StdioClientTransport({
        ...agencyLaunch(admission),
        stderr: "ignore",
    });
    const client = new Client({
        name: "workiq-owned-read-adapter",
        version: "1.0.0",
    });
    try {
        await client.connect(transport, { signal });
    } catch {
        await transport.close();
        throw fault("agencyConnectionUnavailable", "blocked");
    }
    return {
        listTools: () => client.listTools({}, { signal }),
        callTool: (request, currentSignal) =>
            client.callTool(request, undefined, {
                signal: currentSignal ?? signal,
            }),
        close: () => client.close(),
    };
}

function admittedCatalog(result, admission) {
    requireFact(
        Array.isArray(result?.tools) &&
            result.tools.length >= 3 &&
            result.tools.length <= 128 &&
            result.tools.every(
                (tool) =>
                    typeof tool?.name === "string" &&
                    /^[a-zA-Z0-9_.:-]{1,128}$/u.test(tool.name),
            ) &&
            new Set(result.tools.map((tool) => tool.name)).size ===
                result.tools.length &&
            !result.nextCursor,
        "incompleteAgencyCatalog",
        "blocked",
    );
    return [...new Set(operations)].map((name) => {
        const matches = result.tools.filter((tool) => tool.name === name);
        const expected = admission.runtime.advertisedToolSchemas.find(
            (tool) => tool.advertisedName === name,
        );
        requireFact(
            matches.length === 1 && expected,
            "ambiguousAgencyCatalog",
            "blocked",
        );
        const tool = matches[0];
        requireFact(
            !tool.outputSchema &&
                isDeepStrictEqual(tool.inputSchema, expected.inputSchema) &&
                isDeepStrictEqual(tool.annotations, expected.annotations) &&
                tool.annotations?.readOnlyHint === true &&
                tool.annotations?.destructiveHint === false,
            "agencySchemaDrift",
            "blocked",
        );
        return clone(tool);
    });
}

export async function discoverWorkiqAgencyCatalog(admission, signal) {
    const context = clone(admission);
    agencyLaunch(context);
    const client = await actualAgencyClient(context, signal);
    try {
        const result = await client.listTools();
        return {
            tools: admittedCatalog(result, context),
            backendCatalog: workiqBackendCatalogFacts(result),
        };
    } finally {
        await client.close();
    }
}

function workiqBackendCatalogFacts(result) {
    return {
        sha256: workiqJsonHash(result),
        toolCount: result.tools.length,
        advertisedNames: result.tools.map((tool) => tool.name),
        exposedNames: ["retrieve", "fetch", "fetch_blob"],
        excludedNames: result.tools
            .filter(
                (tool) =>
                    !["retrieve", "fetch", "fetch_blob"].includes(tool.name),
            )
            .map((tool) => tool.name),
    };
}

export async function observeWorkiqAgencyCatalog(admission, signal) {
    const context = clone(admission);
    agencyLaunch(context);
    const client = await actualAgencyClient(context, signal);
    try {
        const result = await client.listTools();
        const tools = Array.isArray(result?.tools) ? result.tools : [];
        return {
            resultType: result === null ? "null" : typeof result,
            resultKeys: Object.keys(result ?? {}),
            toolsType: Array.isArray(result?.tools)
                ? "array"
                : typeof result?.tools,
            toolCount: tools.length,
            hasNextCursor: Boolean(result?.nextCursor),
            toolNames: tools
                .slice(0, 64)
                .map((tool) =>
                    typeof tool.name === "string" &&
                    /^[a-zA-Z0-9_.:-]{1,128}$/u.test(tool.name)
                        ? tool.name
                        : "nonstandard-name",
                ),
            selectedTools: context.runtime.advertisedToolSchemas.map(
                (expected) => {
                    const matches = tools.filter(
                        (tool) => tool.name === expected.advertisedName,
                    );
                    const actual = matches.length === 1 ? matches[0] : null;
                    return {
                        name: expected.advertisedName,
                        matches: matches.length,
                        schemaMatchesFrozen:
                            actual !== null &&
                            isDeepStrictEqual(
                                actual.inputSchema,
                                expected.inputSchema,
                            ),
                        annotationsMatchFrozen:
                            actual !== null &&
                            isDeepStrictEqual(
                                actual.annotations,
                                expected.annotations,
                            ),
                        hasOutputSchema: Boolean(actual?.outputSchema),
                        readOnlyHint: actual?.annotations?.readOnlyHint ?? null,
                        destructiveHint:
                            actual?.annotations?.destructiveHint ?? null,
                    };
                },
            ),
        };
    } finally {
        await client.close();
    }
}

async function verifyProviderBlob(
    store,
    ref,
    result,
    entity,
    ownerId,
    callId,
    admission,
) {
    requireFact(ref, "missingAgencyOriginalArtifact", "blocked");
    await store.verify(ref, "run", ownerId, callId, "result");
    const envelope = readWorkiqOriginalEnvelope(result, admission);
    const blob = envelope.structuredContent;
    requireFact(
        workiqMacroCorrectnessContract(admission) ||
            Object.keys(blob).every((key) =>
                [
                    "base64Content",
                    "blobName",
                    "contentType",
                    "sizeBytes",
                    "statusCode",
                ].includes(key),
            ),
        "unsupportedBlobOutput",
    );
    const receipt = ref.blobs.find((item) =>
        isDeepStrictEqual(item.path, ["structuredContent", "base64Content"]),
    );
    requireFact(
        envelope.content.length === 0 &&
            blob.statusCode === 200 &&
            receipt?.encoding === "base64",
        "incompleteAgencyOriginal",
        "blocked",
    );
    requireFact(
        (workiqMacroCorrectnessContract(admission)
            ? typeof blob.blobName === "string" &&
              blob.blobName.length > 0 &&
              typeof blob.contentType === "string" &&
              blob.contentType.length > 0
            : blob.blobName === entity.blobName &&
              blob.contentType === entity.transportContentType) &&
            blob.sizeBytes === entity.oracle.sizeBytes &&
            receipt.sizeBytes === entity.oracle.sizeBytes &&
            receipt.sha256 === entity.oracle.sha256,
        "agencyOriginalMismatch",
        "failed",
    );
}

function checkScope(scope, entityKey) {
    requireFact(
        scope &&
            Object.keys(scope).every((key) =>
                ["ownerId", "sessionId", "runId", "phase"].includes(key),
            ) &&
            identifier(scope.ownerId) &&
            identifier(scope.sessionId) &&
            (scope.runId === null || identifier(scope.runId)),
        "invalidWorkiqScope",
    );
    const selection = { "capture-a": "A", "reuse-b": "B", "restart-b": "B" };
    requireFact(selection[scope.phase] === entityKey, "invalidWorkiqPhase");
}

/**
 * No connection/import side effects. start() requires trusted controller readiness,
 * exclusive scheduling and current normal execution consent, then connects only
 * the known Agency stdio endpoint. The host callbacks are not public MCP inputs.
 * Backend receipts never assert SDK delivery; the independent loader checks that.
 */
export function createWorkiqAgencyAdapter(options) {
    const admission = clone(options.admission);
    const scope = clone(options.scope);
    const entity = entityFor(admission, options.entityKey);
    checkScope(scope, entity.key);
    const lookupOnlyDiagnostic = options.lookupOnlyDiagnostic === true;
    requireFact(
        options.lookupOnlyDiagnostic === undefined || lookupOnlyDiagnostic,
        "invalidLookupDiagnostic",
    );
    requireFact(
        !lookupOnlyDiagnostic ||
            (entity.key === "A" && scope.phase === "capture-a"),
        "foreignLookupDiagnostic",
        "blocked",
    );
    agencyLaunch(admission);
    requireFact(
        path.isAbsolute(options.auditRoot) &&
            typeof options.host?.assertPrerequisites === "function" &&
            typeof options.host?.authorizeRead === "function",
        "missingTrustedWorkiqHost",
    );
    const host = options.host;
    const auditRoot = options.auditRoot;
    const signal = options.signal;
    const connect = options.connect ?? actualAgencyClient;
    let diagnosticRead;
    let upstreamReadsStarted = 0;
    const diagnosticRejections = [];
    let client,
        catalog,
        backendCatalog,
        lookup,
        pendingRead,
        busy = false,
        starting = false,
        stopped = false,
        failed = false,
        index = 0;
    const store = new PrivateResultStore(auditRoot);
    const close = async () => {
        stopped = true;
        const owned = client;
        client = undefined;
        if (owned) {
            try {
                await owned.close();
            } catch {
                throw fault("agencyCloseFailed", "blocked");
            }
        }
    };
    async function start() {
        requireFact(!starting && !client && !stopped, "adapterAlreadyStarted");
        starting = true;
        try {
            await assertWorkiqHost(
                (value) => host.assertPrerequisites(value),
                clone(scope),
            );
            requireFact(!signal?.aborted, "workiqAborted", "blocked");
            await safeAncestors(path.dirname(auditRoot));
            await mkdir(auditRoot, { mode: 0o700 });
            client = await connect(admission, signal);
            const result = await client.listTools();
            catalog = admittedCatalog(result, admission);
            backendCatalog = workiqBackendCatalogFacts(result);
            await immutableJson(auditRoot, "catalog.json", {
                schemaVersion: 1,
                kind: "workiq-agency-current-catalog",
                scope,
                admissionSha256: workiqJsonHash(admission),
                createdAt: new Date().toISOString(),
                tools: catalog,
                backendCatalog,
            });
        } catch (error) {
            await close();
            throw error instanceof WorkiqEvidenceError
                ? error
                : fault("workiqAdapterStartupFailed", "blocked");
        } finally {
            starting = false;
        }
        return clone(catalog);
    }
    function checkCall(name, args) {
        requireFact(
            client && catalog && !stopped && !busy && !signal?.aborted,
            "adapterNotReady",
            "blocked",
        );
        requireFact(
            !lookupOnlyDiagnostic || index === 0,
            "lookupDiagnosticReadLimit",
            "blocked",
        );
        requireFact(
            index < 4 && name === operations[index],
            "unexpectedWorkiqOperation",
            "blocked",
        );
        const expected = workiqReadArguments(
            admission,
            entity.key,
            index,
            lookup,
        );
        requireFact(
            lookupOnlyDiagnostic
                ? isDeepStrictEqual(args, expected)
                : workiqRequestMatches(args, expected, admission, index),
            lookupOnlyDiagnostic
                ? "lookupDiagnosticRequestMismatch"
                : "workiqScopeMismatch",
            "blocked",
        );
    }
    async function call(name, args, requestOptions = {}) {
        const signals = [signal, requestOptions.signal].filter(Boolean);
        const currentSignal = signals.length
            ? AbortSignal.any(signals)
            : undefined;
        try {
            requireFact(!currentSignal?.aborted, "workiqStopped", "blocked");
            checkCall(name, args);
            pendingRead = { name, arguments: clone(args) };
            busy = true;
        } catch (error) {
            failed = true;
            await close();
            if (lookupOnlyDiagnostic && catalog) {
                const rejection = {
                    schemaVersion: 1,
                    kind: "workiq-lookup-diagnostic-rejected-dispatch",
                    scope,
                    advertisedName: name,
                    arguments: clone(args),
                    upstreamReadsStarted,
                    maxUpstreamReads: 1,
                    errorCode:
                        error instanceof WorkiqEvidenceError
                            ? error.code
                            : "invalidLookupDiagnosticDispatch",
                    observedAt: new Date().toISOString(),
                    admission: false,
                };
                const file = `lookup-diagnostic-rejection-${randomUUID()}.json`;
                await immutableJson(auditRoot, file, rejection);
                diagnosticRejections.push({
                    ...rejection,
                    auditPath: path.join(auditRoot, file),
                    auditSha256: workiqJsonHash(rejection),
                });
            }
            throw error;
        }
        const sequence = index++;
        const proxyCallId = randomUUID();
        const call = {
            schemaVersion: 1,
            kind: "workiq-agency-current-call",
            scope,
            sequence,
            proxyCallId,
            advertisedName: name,
            mcpServerName: admission.runtime.mcpServer,
            arguments: clone(args),
            status: "failed",
            startedAt: new Date().toISOString(),
        };
        let result, reference;
        try {
            await assertWorkiqHost((value) => host.authorizeRead(value), {
                ...clone(scope),
                proxyCallId,
                name,
                arguments: clone(args),
            });
            requireFact(
                !stopped && !currentSignal?.aborted,
                "workiqStopped",
                "blocked",
            );
            upstreamReadsStarted++;
            result = await client.callTool(
                { name, arguments: clone(args) },
                currentSignal,
            );
            requireFact(
                Buffer.byteLength(JSON.stringify(result)) <= limit,
                "oversizedAgencyOriginal",
            );
            reference = await store.retain(
                "run",
                scope.ownerId,
                proxyCallId,
                "result",
                result,
            );
            requireFact(
                !stopped && !currentSignal?.aborted,
                "workiqStopped",
                "blocked",
            );
            const envelope = readWorkiqOriginalEnvelope(result, admission);
            if (sequence === 0) {
                validateWorkiqLookup(envelope, entity, admission);
                lookup = envelope;
            }
            if (sequence === 1 || sequence === 3)
                validateWorkiqMetadata(envelope, entity, admission);
            if (sequence === 2)
                await verifyProviderBlob(
                    store,
                    reference,
                    result,
                    entity,
                    scope.ownerId,
                    proxyCallId,
                    admission,
                );
            call.status = "completed";
            return result;
        } catch (error) {
            failed = true;
            call.errorCode =
                error instanceof WorkiqEvidenceError
                    ? error.code
                    : "agencyReadFailed";
            await close();
            throw error instanceof WorkiqEvidenceError
                ? error
                : fault("agencyReadFailed", "blocked");
        } finally {
            call.completedAt = new Date().toISOString();
            if (result !== undefined)
                call.result = reference ? reference.view : result;
            if (reference) call.resultArtifact = reference;
            try {
                await immutableJson(auditRoot, `call-${sequence}.json`, call);
                if (lookupOnlyDiagnostic)
                    diagnosticRead = {
                        call: clone(call),
                        originalProviderResult: clone(result),
                        auditPath: path.join(
                            auditRoot,
                            `call-${sequence}.json`,
                        ),
                        auditSha256: workiqJsonHash(call),
                    };
            } catch (error) {
                failed = true;
                await close();
                throw error;
            } finally {
                busy = false;
                pendingRead = undefined;
            }
        }
    }
    return Object.freeze({
        start,
        call,
        close,
        tools: () => {
            requireFact(catalog && !stopped, "adapterNotReady");
            return clone(catalog);
        },
        complete: () => index === 4 && !busy && !failed,
        lookupDiagnosticEvidence: () => {
            requireFact(lookupOnlyDiagnostic, "notLookupDiagnostic");
            return {
                schemaVersion: 1,
                kind: "workiq-identical-frozen-lookup-diagnostic-evidence-v1",
                scope: clone(scope),
                maxUpstreamReads: 1,
                upstreamReadsStarted,
                firstRead: clone(diagnosticRead),
                rejections: clone(diagnosticRejections),
                admission: false,
                nativeAuthority: false,
                modelInputExposure: "not-certified",
            };
        },
        catalogObservation: () => clone(backendCatalog),
        lookupBindingGuidance: () =>
            workiqLookupBindingGuidance(admission, entity.key),
        nextRead: () => {
            if (!client || stopped || failed) return null;
            if (busy) return clone(pendingRead);
            if (index >= (lookupOnlyDiagnostic ? 1 : 4)) return null;
            return {
                name: operations[index],
                arguments: workiqReadArguments(
                    admission,
                    entity.key,
                    index,
                    lookup,
                ),
            };
        },
    });
}

export function createWorkiqMcpServer(adapter) {
    const guidance = adapter.lookupBindingGuidance?.();
    const server = new Server(
        { name: "workiq", version: "1.0.0" },
        {
            capabilities: { tools: {} },
            instructions:
                "This server enforces the frozen read-only workflow retrieve -> fetch -> fetch_blob -> fetch. " +
                (guidance?.includes("Optional diagnostics contract v2:")
                    ? "For retrieve, bind query, strategy and capabilities from the scoped request; includeDeveloperCard may be absent, true or false. No other extra argument is authorized. "
                    : "For retrieve, supply only query, strategy and capabilities; omit includeDeveloperCard entirely, including false. Do not add optional fields. ") +
                "Do not broaden the lookup or retry a rejected call." +
                (guidance ? "\n" + guidance : ""),
        },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: guidance
            ? workiqModelVisibleTools(adapter.tools(), guidance)
            : adapter.tools(),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        try {
            return await adapter.call(
                request.params.name,
                request.params.arguments,
                { signal: extra.signal },
            );
        } catch (error) {
            throw new McpError(
                ErrorCode.InvalidParams,
                error instanceof WorkiqEvidenceError
                    ? error.code
                    : "workiqAdapterFailed",
            );
        }
    });
    return server;
}

async function providerCalls(auditRoot, admission, scope) {
    const catalog = await readWorkiqOwnedJson(
        auditRoot,
        "catalog.json",
        256 * 1024,
    );
    requireFact(
        Object.keys(catalog).every((key) =>
            [
                "schemaVersion",
                "kind",
                "scope",
                "admissionSha256",
                "createdAt",
                "tools",
                "backendCatalog",
            ].includes(key),
        ) &&
            catalog.schemaVersion === 1 &&
            catalog.kind === "workiq-agency-current-catalog" &&
            isDeepStrictEqual(catalog.scope, scope) &&
            catalog.admissionSha256 === workiqJsonHash(admission),
        "foreignAgencyCatalog",
    );
    admittedCatalog({ tools: catalog.tools }, admission);
    if (catalog.backendCatalog !== undefined) {
        const facts = catalog.backendCatalog;
        requireFact(
            Object.keys(facts).every((key) =>
                [
                    "sha256",
                    "toolCount",
                    "advertisedNames",
                    "exposedNames",
                    "excludedNames",
                ].includes(key),
            ) &&
                /^[a-f0-9]{64}$/u.test(facts.sha256) &&
                Array.isArray(facts.advertisedNames) &&
                facts.toolCount === facts.advertisedNames.length &&
                new Set(facts.advertisedNames).size === facts.toolCount &&
                isDeepStrictEqual(facts.exposedNames, [
                    "retrieve",
                    "fetch",
                    "fetch_blob",
                ]) &&
                isDeepStrictEqual(
                    facts.excludedNames,
                    facts.advertisedNames.filter(
                        (name) => !facts.exposedNames.includes(name),
                    ),
                ),
            "invalidAgencyCatalogProjection",
        );
    }
    const store = new PrivateResultStore(auditRoot);
    const calls = [];
    const ids = new Set();
    for (let index = 0; index < 4; index++) {
        const call = await readWorkiqOwnedJson(
            auditRoot,
            `call-${index}.json`,
            256 * 1024,
        );
        requireFact(
            Object.keys(call).every((key) =>
                [
                    "schemaVersion",
                    "kind",
                    "scope",
                    "sequence",
                    "proxyCallId",
                    "advertisedName",
                    "mcpServerName",
                    "arguments",
                    "status",
                    "startedAt",
                    "completedAt",
                    "result",
                    "resultArtifact",
                    "errorCode",
                ].includes(key),
            ) &&
                call.schemaVersion === 1 &&
                call.kind === "workiq-agency-current-call" &&
                call.sequence === index &&
                isDeepStrictEqual(call.scope, scope) &&
                identifier(call.proxyCallId) &&
                call.advertisedName === operations[index] &&
                call.mcpServerName === admission.runtime.mcpServer &&
                call.status === "completed",
            "foreignOrIncompleteAgencyCall",
        );
        requireFact(!ids.has(call.proxyCallId), "duplicateAgencyCall");
        ids.add(call.proxyCallId);
        if (call.resultArtifact)
            validateWorkiqArtifactReference(call.resultArtifact);
        const result = call.resultArtifact
            ? await store.verify(
                  call.resultArtifact,
                  "run",
                  scope.ownerId,
                  call.proxyCallId,
                  "result",
              )
            : call.result;
        requireFact(
            !call.resultArtifact ||
                isDeepStrictEqual(call.result, call.resultArtifact.view),
            "forgedAgencyResultView",
        );
        calls.push({ ...call, result });
    }
    return { catalog, calls };
}

function nativeCalls(events, trial, discovery) {
    const active = new Map(),
        calls = [],
        ids = new Set();
    for (const event of events) {
        const time = Date.parse(event.timestamp);
        if (
            time < Date.parse(trial.startedAt) ||
            time > Date.parse(trial.endedAt)
        )
            continue;
        requireFact(Number.isFinite(time), "invalidNativeEventTime");
        const data = event.data ?? {};
        requireFact(
            !Object.hasOwn(event, "sessionId") ||
                event.sessionId === trial.sessionId,
            "foreignNativeSession",
        );
        if (event.type === "tool.execution_start") {
            requireFact(
                identifier(data.toolCallId) && !ids.has(data.toolCallId),
                "ambiguousNativeToolCall",
            );
            ids.add(data.toolCallId);
            const tool = discovery.tools.find(
                (item) => item.callableName === data.toolName,
            );
            requireFact(
                tool && data.mcpServerName === tool.mcpServerName,
                "unapprovedNativeTool",
                "blocked",
            );
            active.set(data.toolCallId, {
                sessionId: trial.sessionId,
                traceId: trial.traceId,
                runId: trial.runId,
                toolCallId: data.toolCallId,
                name: data.toolName,
                mcpServerName: data.mcpServerName,
                arguments: clone(data.arguments),
                startedAt: event.timestamp,
                agentId: event.agentId ?? null,
            });
        } else if (event.type === "permission.completed") {
            const permission =
                typeof data.result === "string"
                    ? data.result
                    : data.result?.kind;
            requireFact(
                !permission?.startsWith("denied") && permission !== "cancelled",
                "nativePermissionStopped",
                "blocked",
            );
        } else if (event.type === "tool.execution_complete") {
            const id = data.toolCallId ?? data.id;
            const call = active.get(id);
            requireFact(
                call && call.agentId === (event.agentId ?? null),
                "foreignNativeCompletion",
            );
            requireFact(
                data.success === true && data.result !== undefined,
                "incompleteNativeOriginal",
                "blocked",
            );
            delete call.agentId;
            calls.push({
                ...call,
                completedAt: event.timestamp,
                status: "completed",
                result: clone(data.result),
            });
            active.delete(id);
        }
    }
    requireFact(
        active.size === 0 && calls.length === 4,
        "missingNativeFourReadEvidence",
        "blocked",
    );
    return calls;
}

function correlateProvider(calls, agency, nativeStart, discovery, admission) {
    requireFact(
        Date.parse(agency.catalog.createdAt) <=
            Date.parse(calls[0].startedAt) &&
            Date.parse(agency.catalog.createdAt) >= Date.parse(nativeStart),
        "foreignAgencyWindow",
    );
    for (const [index, call] of calls.entries()) {
        const provider = agency.calls[index];
        const alias = discovery.tools.find(
            (tool) => tool.advertisedName === operations[index],
        );
        requireFact(
            alias &&
                call.name === alias.callableName &&
                isDeepStrictEqual(call.arguments, provider.arguments) &&
                Date.parse(provider.startedAt) >= Date.parse(call.startedAt) &&
                Date.parse(provider.completedAt) <=
                    Date.parse(call.completedAt),
            "unboundAgencyNativeCall",
        );
        const original = readWorkiqSdkOriginalEnvelope(
            call.result,
            admission,
            call.status === "completed",
        );
        requireFact(
            isWorkiqSdkStructuredResult(call.result, admission)
                ? provider.result.isError === false &&
                      isDeepStrictEqual(
                          original.structuredContent,
                          provider.result.structuredContent,
                      )
                : isDeepStrictEqual(original, provider.result),
            "nativeAgencyOriginalMismatch",
            "blocked",
        );
    }
}

/**
 * Reads only closed-over owned source paths; public verify cannot supply events,
 * results, catalog or sourceArtifact substitutions. Native event bytes must be
 * the actual current SDK file. The host owns discovery/session/root-child proof.
 */
export function createWorkiqCurrentEvidenceLoader(options) {
    const { artifactRoot, nativeSessionRoot, auditRoot, readNativeDiscovery } =
        options;
    const admission = clone(options.admission),
        scope = clone(options.scope);
    const sdkCaptureDataRoot = options.sdkCaptureDataRoot;
    const projection = options.projection;
    checkScope(scope, options.entityKey);
    requireFact(
        [artifactRoot, nativeSessionRoot, auditRoot].every(
            (value) => typeof value === "string" && path.isAbsolute(value),
        ) && typeof readNativeDiscovery === "function",
        "missingOwnedEvidenceLoader",
    );
    return async (trial) => {
        requireFact(
            trial.sessionId === scope.sessionId &&
                trial.runId === scope.runId &&
                identifier(trial.traceId),
            "foreignNativeTrial",
        );
        const discovery = await readNativeDiscovery(clone(trial));
        const trace = await readWorkiqOwnedJson(
            artifactRoot,
            path.join("traces", `${trial.traceId}.json`),
        );
        const raw = await safeFile(
            nativeSessionRoot,
            path.join(trial.sessionId, "events.jsonl"),
            64 * 1024 * 1024,
        );
        requireFact(
            raw.length > 0 && raw[raw.length - 1] === 10,
            "unfinishedNativeEventSource",
            "blocked",
        );
        let events;
        try {
            events = raw
                .toString("utf8")
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));
        } catch {
            throw fault("invalidNativeEventSource");
        }
        if (sdkCaptureDataRoot !== undefined) {
            requireFact(
                path.isAbsolute(sdkCaptureDataRoot),
                "invalidSdkCaptureRoot",
            );
            const { restoreWorkiqSdkOriginals } = await import(
                "./macro-eval-workiq-native.mjs"
            );
            events = await restoreWorkiqSdkOriginals(
                { artifactRoot, sdkCaptureDataRoot, scope },
                trial,
                events,
            );
        }
        if (projection !== undefined) {
            const { verifyWorkiqNativeProjection } = await import(
                "./macro-eval-workiq-native.mjs"
            );
            events = (
                await verifyWorkiqNativeProjection(
                    projection,
                    artifactRoot,
                    trace,
                    trial,
                    events,
                )
            ).events;
        }
        const calls = nativeCalls(events, trial, discovery);
        const agency = await providerCalls(auditRoot, admission, scope);
        const sessionStart = events.find(
            (event) => event.type === "session.start",
        );
        requireFact(
            sessionStart && Number.isFinite(Date.parse(sessionStart.timestamp)),
            "missingNativeSessionStart",
        );
        requireFact(
            !Object.hasOwn(sessionStart.data ?? {}, "sessionId") ||
                sessionStart.data.sessionId === trial.sessionId,
            "foreignNativeSession",
        );
        correlateProvider(
            calls,
            agency,
            sessionStart.timestamp,
            discovery,
            admission,
        );
        return {
            origin: "owned-native-session-events",
            trace,
            calls,
            discovery,
            ...(projection === undefined
                ? {}
                : { nativeProjection: projection }),
        };
    };
}

export function createWorkiqCurrentOracle(options) {
    return createWorkiqEvidenceVerifier({
        artifactRoot: options.artifactRoot,
        admission: options.admission,
        trial: options.trial,
        readCurrent: createWorkiqCurrentEvidenceLoader(options),
    });
}
