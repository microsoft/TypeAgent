// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
    discoverWorkiqAgencyCatalog,
    createWorkiqAgencyAdapter,
    createWorkiqMcpServer,
    createWorkiqCurrentOracle,
    workiqLookupBindingGuidance,
    workiqModelVisibleTools,
    verifyWorkiqModelVisibleMetadata,
    workiqJsonHash,
} from "./macro-eval-workiq-adapter.mjs";
import {
    WorkiqEvidenceError,
    workiqMacroCorrectnessContract,
    workiqRequestMatches,
} from "./macro-eval-workiq-evidence.mjs";

const controllers = new WeakMap();

export function workiqPendingConsentArguments(events, tool, next, admission) {
    const completed = new Set(
        events
            .filter((event) => event.type === "tool.execution_complete")
            .map((event) => event.data.toolCallId),
    );
    const pending = events.filter(
        (event) =>
            event.type === "tool.execution_start" &&
            !completed.has(event.data.toolCallId) &&
            [tool.name, tool.namespacedName].includes(event.data.toolName) &&
            event.data.mcpServerName === admission.runtime.mcpServer,
    );
    if (!pending.length) return undefined;
    if (
        pending.length !== 1 ||
        !workiqRequestMatches(
            pending[0].data.arguments,
            next.arguments,
            admission,
            next.name === "retrieve" ? 0 : next.name === "fetch_blob" ? 2 : 1,
        )
    )
        throw new WorkiqEvidenceError(
            "blocked",
            "workiqConsentRequestMismatch",
        );
    return structuredClone(pending[0].data.arguments);
}

export function assertWorkiqNativeController(controller, runtime) {
    if (
        !controllers.has(controller) ||
        (runtime !== undefined && controllers.get(controller) !== runtime)
    )
        throw new WorkiqEvidenceError(
            "blocked",
            "unverifiedWorkiqNativeController",
        );
    return controller;
}

/**
 * Closed real transport, not an admission shim. Only the production lifecycle's
 * source-branded runtime may supply physical lease/consent/read-budget checks.
 * Initial tool listing uses authenticated current Agency discovery; data calls
 * stay blocked until a current actual SDK trial is bound.
 */
export async function createWorkiqNativeController(options) {
    const {
        createNativeWorkiqHostAssertions,
        createNativeWorkiqEvidenceBoundary,
    } = await import("./native-workiq-lifecycle.mjs");
    const runtime = options.runtime,
        signal = options.signal;
    const metadataHost = createNativeWorkiqHostAssertions(runtime, null);
    const lookupOnlyDiagnostic = options.lookupOnlyDiagnostic === true;
    if (options.lookupOnlyDiagnostic !== undefined && !lookupOnlyDiagnostic)
        throw new WorkiqEvidenceError(
            "harness-invalid",
            "invalidLookupDiagnostic",
        );
    const admission = structuredClone(options.admission);
    let catalog, backendCatalog, adapter, listener, origin, activeScope;
    let diagnosticAdapter;
    let gatewayEntityKey, lookupGuidance;
    const capability = randomUUID();
    const errors = [];
    const facade = {
        tools: () => {
            if (!catalog)
                throw new WorkiqEvidenceError(
                    "blocked",
                    "workiqGatewayCatalogUnavailable",
                );
            return structuredClone(catalog);
        },
        lookupBindingGuidance: () => lookupGuidance,
        call: async (...args) => {
            if (!adapter)
                throw new WorkiqEvidenceError(
                    "blocked",
                    "workiqNativeTrialUnclaimed",
                );
            return adapter.call(...args);
        },
    };
    async function startGateway(entityKey) {
        if (listener)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayAlreadyStarted",
            );
        if (
            !["A", "B"].includes(entityKey) ||
            !admission.entities.some((entity) => entity.key === entityKey)
        )
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayUnknownEntity",
            );
        if (lookupOnlyDiagnostic && entityKey !== "A")
            throw new WorkiqEvidenceError("blocked", "foreignLookupDiagnostic");
        lookupGuidance = workiqLookupBindingGuidance(admission, entityKey);
        gatewayEntityKey = entityKey;
        // Obtaining a host requires the production runtime's private identity
        // brand; it does not mint a lease or imply initialized native inventory.
        await metadataHost.assertPrerequisites(null);
        const currentCatalog = await discoverWorkiqAgencyCatalog(
            admission,
            signal,
        );
        catalog = currentCatalog.tools;
        backendCatalog = currentCatalog.backendCatalog;
        listener = http.createServer(async (request, response) => {
            if (
                request.headers.authorization !== `Bearer ${capability}` ||
                request.url !== "/mcp" ||
                request.socket.remoteAddress !== "127.0.0.1"
            ) {
                response.writeHead(403).end();
                return;
            }
            if (request.method !== "POST") {
                response.writeHead(405, { Allow: "POST" }).end();
                return;
            }
            const server = createWorkiqMcpServer(facade);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
            });
            response.once("close", () => {
                void transport.close();
                void server.close();
            });
            try {
                const chunks = [];
                let size = 0;
                for await (const chunk of request) {
                    size += chunk.length;
                    if (size > 65536) {
                        response.writeHead(413).end();
                        errors.push("workiqGatewayRequestCap");
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                await server.connect(transport);
                await transport.handleRequest(request, response, body);
            } catch {
                errors.push("workiqGatewayProtocolError");
                if (!response.headersSent) response.writeHead(500).end();
            }
        });
        await new Promise((resolve, reject) => {
            listener.once("error", reject);
            listener.listen(0, "127.0.0.1", resolve);
        });
        origin = `http://127.0.0.1:${listener.address().port}/mcp`;
        return {
            type: "http",
            url: origin,
            headers: { Authorization: `Bearer ${capability}` },
            tools: ["retrieve", "fetch", "fetch_blob"],
        };
    }
    async function bindTrial(scope, entityKey, auditRoot) {
        if (!listener || adapter)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayScopeAlreadyBound",
            );
        if (entityKey !== gatewayEntityKey)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayEntityDrift",
            );
        const actualScope = structuredClone(scope);
        if (
            auditRoot !==
            path.join(runtime.layout.run, `agency-${actualScope.runId}`)
        )
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayForeignAuditRoot",
            );
        const host = createNativeWorkiqHostAssertions(runtime, actualScope);
        const current = createWorkiqAgencyAdapter({
            admission,
            scope: actualScope,
            entityKey,
            auditRoot,
            host,
            signal,
            ...(lookupOnlyDiagnostic ? { lookupOnlyDiagnostic: true } : {}),
        });
        const actualCatalog = await current.start();
        if (
            !isDeepStrictEqual(actualCatalog, catalog) ||
            !isDeepStrictEqual(current.catalogObservation(), backendCatalog)
        ) {
            await current.close();
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayCatalogDrift",
            );
        }
        adapter = current;
        if (lookupOnlyDiagnostic) diagnosticAdapter = current;
        activeScope = { scope: actualScope, entityKey, auditRoot };
        return structuredClone(actualCatalog);
    }
    async function verifyCompletedTrial(trial) {
        if (!adapter?.complete() || !activeScope || errors.length)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayIncompleteTrial",
            );
        const { scope, entityKey, auditRoot } = activeScope;
        if (trial.sessionId !== scope.sessionId || trial.runId !== scope.runId)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqGatewayForeignTrial",
            );
        const boundary = await createNativeWorkiqEvidenceBoundary(
            runtime,
            trial,
        );
        const oracle = createWorkiqCurrentOracle({
            ...boundary,
            admission,
            scope,
            entityKey,
            auditRoot,
            trial: {
                sessionId: trial.sessionId,
                traceId: trial.traceId,
                runId: trial.runId,
                startedAt: trial.startedAt,
                endedAt: trial.endedAt,
                runIdentityKind: boundary.projection.runIdentityKind,
                handoffRunId: boundary.projection.handoffRunId,
            },
        });
        return oracle.verify({ entityKey });
    }
    async function currentConsentTools() {
        const next = adapter?.nextRead();
        if (!next || !activeScope) return [];
        const record = await runtime.sessionSource(true);
        const expected = catalog.find((tool) => tool.name === next.name);
        const matches = record.tools.tools.filter(
            (tool) =>
                tool.mcpServerName === admission.runtime.mcpServer &&
                tool.mcpToolName === next.name &&
                isDeepStrictEqual(tool.input_schema, expected.inputSchema),
        );
        if (
            record.source.sessionId !== activeScope.scope.sessionId ||
            matches.length !== 1
        )
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqConsentInventoryDrift",
            );
        const argumentsForConsent = workiqMacroCorrectnessContract(admission)
            ? workiqPendingConsentArguments(
                  await runtime.events(),
                  matches[0],
                  next,
                  admission,
              )
            : next.arguments;
        if (!argumentsForConsent) return [];
        return [
            {
                name: matches[0].name,
                namespacedName: matches[0].namespacedName,
                mcpServerName: admission.runtime.mcpServer,
                advertisedName: next.name,
                arguments: structuredClone(argumentsForConsent),
            },
        ];
    }
    async function assertModelGuidance() {
        if (!adapter || !activeScope)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqModelGuidanceUnbound",
            );
        const record = await runtime.sessionSource(true);
        if (record.source.sessionId !== activeScope.scope.sessionId)
            throw new WorkiqEvidenceError(
                "blocked",
                "workiqModelGuidanceForeignSid",
            );
        const exposed = workiqModelVisibleTools(catalog, lookupGuidance);
        verifyWorkiqModelVisibleMetadata(
            record.tools,
            admission.runtime.mcpServer,
            exposed,
        );
        const receipt = {
            schemaVersion: 1,
            kind: "workiq-actual-sdk-model-guidance",
            observedAt: new Date().toISOString(),
            scope: activeScope.scope,
            entityKey: gatewayEntityKey,
            sourcePid: record.source.control.source.pid,
            backendCatalogSha256: backendCatalog.sha256,
            sdkMetadataSha256: workiqJsonHash(record.tools),
            hashKind: "canonical-json",
            tools: catalog.map((tool, index) => ({
                name: tool.name,
                inputSchemaSha256: workiqJsonHash(tool.inputSchema),
                backendDescriptionSha256: workiqJsonHash(
                    tool.description ?? null,
                ),
                exposedDescriptionSha256: workiqJsonHash(
                    exposed[index].description ?? null,
                ),
                descriptionChanged:
                    tool.description !== exposed[index].description,
            })),
            admission: false,
            modelInputExposure: "not-certified",
        };
        fs.writeFileSync(
            path.join(
                runtime.layout.run,
                `model-guidance-${activeScope.scope.runId}.json`,
            ),
            JSON.stringify(receipt),
            { flag: "wx", mode: 0o600 },
        );
    }
    async function close() {
        await adapter?.close();
        adapter = undefined;
        if (listener) {
            const current = listener;
            listener = undefined;
            current.closeAllConnections();
            await new Promise((resolve) => current.close(resolve));
        }
    }
    const controller = Object.freeze({
        startGateway,
        bindTrial,
        verifyCompletedTrial,
        currentConsentTools,
        assertModelGuidance,
        lookupDiagnosticEvidence: () => {
            if (!lookupOnlyDiagnostic || !diagnosticAdapter)
                throw new WorkiqEvidenceError(
                    "blocked",
                    "lookupDiagnosticEvidenceUnavailable",
                );
            return diagnosticAdapter.lookupDiagnosticEvidence();
        },
        close,
        catalog: () => structuredClone(catalog),
        errors: () => [...errors],
    });
    controllers.set(controller, runtime);
    return controller;
}
