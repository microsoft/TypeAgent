// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";

export async function publicRoundTrip(
    service,
    corpusId,
    ready,
    load,
    nativeFetch,
) {
    const { InProcessMemoryServiceClient, McpMemoryServiceClient } = await load(
        "packages\\memory\\client\\dist\\memoryClient.js",
    );
    const protocol = await load(
        "packages\\memory\\client\\dist\\viewProtocol.js",
    );
    const { createMemoryServiceRpcFacade } = await load(
        "packages\\memory\\service\\dist\\rpcFacade.js",
    );
    const { MemoryServiceHost } = await load(
        "packages\\memory\\mcp-server\\dist\\memoryServiceHost.js",
    );
    const { derivedDefinitionInput, authoredRelationships } = await load(
        "packages\\memory\\service\\dist\\viewRelationships.js",
    );
    const errors = [];
    const host = await MemoryServiceHost.start(service, {
        host: "127.0.0.1",
        port: 0,
        onError: (error) =>
            errors.push({ name: error.name, message: error.message }),
    });
    assert.notEqual(host.port, 61563);
    const endpoint = new URL(host.endpoint);
    const blockedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = new URL(
            typeof input === "string" || input instanceof URL
                ? input
                : input.url,
        );
        assert.equal(
            url.origin,
            endpoint.origin,
            "Only the exact owned loopback host may be contacted",
        );
        assert.equal(url.pathname, endpoint.pathname);
        return nativeFetch(input, { ...init, redirect: "error" });
    };
    let client;
    try {
        client = await McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { Authorization: `Bearer ${host.bearerToken}` },
            timeoutMs: 60000,
        });
        const canonical = await service.getView({
            corpusId,
            viewId: ready.survivorViewId,
        });
        const old = await service.getView({
            corpusId,
            viewId: ready.retiringViewId,
        });
        assert.ok(canonical.content.sections.length >= 2);
        assert.deepEqual(old.content, canonical.content);
        const observations = [];
        for (const [name, transport] of [
            [
                "in-process-public-client",
                new InProcessMemoryServiceClient(service),
            ],
            ["real-RPC-facade", createMemoryServiceRpcFacade(service)],
            ["real-HTTP-MCP-public-client", client],
        ]) {
            for (const viewId of [canonical.viewId, ready.retiringViewId]) {
                const current = protocol.viewVersionSchema.parse(
                    await transport.getView({ corpusId, viewId }),
                );
                assert.deepEqual(current.content, canonical.content);
                const historical = protocol.viewVersionSchema.parse(
                    await transport.getView({
                        corpusId,
                        viewId,
                        revisionId: current.revisionId,
                    }),
                );
                assert.equal(historical.revisionId, current.revisionId);
                const history = (
                    await transport.getViewHistory({ corpusId, viewId })
                ).map((entry) => protocol.viewHistoryEntrySchema.parse(entry));
                assert.ok(history.length);
                observations.push({
                    transport: name,
                    viewId,
                    currentRevisionId: current.revisionId,
                    exactHistoricalRevisionId: historical.revisionId,
                    historyEntries: history.length,
                    sections: current.content.sections.length,
                    redirect: current.redirect,
                });
            }
            const job = protocol.viewBuildJobSchema.parse(
                await transport.getViewBuild({ corpusId, jobId: ready.jobId }),
            );
            assert.ok(
                job.results.some(
                    (result) => result.wikiConsolidation?.stage === "ready",
                ),
            );
            protocol.viewSnapshotSchema.parse(
                await transport.listViews(corpusId),
            );
            for (const entry of await transport.listViewBuilds(corpusId))
                protocol.viewBuildJobSchema.parse(entry);
        }
        const head = (await service.listViews(corpusId)).head;
        const request = protocol.viewSaveRequestSchema.parse({
            corpusId,
            viewId: canonical.viewId,
            expectedHead: head,
            expectedVersion: canonical.version,
            definition: derivedDefinitionInput(canonical),
            content: canonical.content,
            relationships: authoredRelationships(canonical),
        });
        await assert.rejects(
            client.saveViewDraft({
                ...request,
                expectedVersion: canonical.version + 999,
            }),
        );
        const saved = protocol.viewHistoryEntrySchema.parse(
            await client.saveViewDraft(request),
        );
        assert.deepEqual(saved.version.content, canonical.content);
        const readBack = await client.getView({
            corpusId,
            viewId: canonical.viewId,
        });
        assert.deepEqual(readBack.content, saved.version.content);
        const afterEditHead = (await client.listViews(corpusId)).head;
        const afterEditPublication = await client.getViewPublication({
            corpusId,
            viewId: canonical.viewId,
        });
        assert.equal(afterEditPublication.indexState, "ready");
        assert.equal(
            afterEditPublication.indexedRevisionId,
            readBack.revisionId,
        );
        const input = (
            await service.getViewBuild({ corpusId, jobId: ready.jobId })
        ).results.find(
            (result) => result.wikiConsolidation?.stage === "ready",
        ).wikiConsolidation;
        protocol.viewSynthesisSchema.parse(input.output);
        assert.deepEqual(
            errors,
            [],
            "Actual HTTP host errors cannot be swallowed",
        );
        return {
            corpusId,
            canonicalViewId: canonical.viewId,
            oldViewId: ready.retiringViewId,
            observations,
            actualEditRevisionId: saved.version.revisionId,
            actualEditReadRevisionId: readBack.revisionId,
            afterEditHead,
            afterEditPublication,
            hostClosesOwnedService: true,
            guardedStaleWriteDenied: true,
            registeredSections: canonical.content.sections.length,
            endpointOrigin: endpoint.origin,
            scope: "Fresh actual service-produced content through real public in-process/RPC/HTTP-MCP methods; no replay fixture or alternate parser",
        };
    } finally {
        if (client) await client.close();
        await host.close();
        globalThis.fetch = blockedFetch;
    }
}
