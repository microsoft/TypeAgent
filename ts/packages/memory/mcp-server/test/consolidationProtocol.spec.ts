// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    InProcessMemoryServiceClient,
    McpMemoryServiceClient,
    viewVersionSchema,
    viewBuildJobSchema,
    viewSaveRequestSchema,
} from "@typeagent/memory-client";
import {
    FileMemoryService,
    createMemoryServiceRpcFacade,
    type ViewVersion,
    type ViewReadRequest,
    type ViewBuildJob,
    type ViewBuildJobRequest,
    type ViewSaveRequest,
} from "@typeagent/memory-service";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";

const recorded = JSON.parse(
    await readFile(
        new URL("../../test/fixtures/p6Canonical.json", import.meta.url),
        "utf8",
    ),
);
const canonical = viewVersionSchema.parse(recorded.canonical) as ViewVersion;
const alias = viewVersionSchema.parse({
    ...canonical,
    ...recorded.alias,
    state: "archived",
}) as ViewVersion;
const job = viewBuildJobSchema.parse(recorded.job) as ViewBuildJob;
const accepted = job.results.find(
    (result) => result.wikiConsolidation,
)?.wikiConsolidation;
if (!accepted)
    throw new Error("Recorded accepted consolidation receipt is required");
const head: string = recorded.origin.head;
const request: ViewSaveRequest = {
    corpusId: canonical.corpusId,
    viewId: canonical.viewId,
    expectedHead: head,
    expectedVersion: canonical.version,
    definition: {
        viewId: canonical.viewId,
        kind: "wiki",
        selector: canonical.definition.selector,
        wiki: canonical.definition.wiki!,
    },
    content: canonical.content,
    relationships: accepted.output.relationships,
    unlockProtection: ["title"],
};

class RecordedConsolidationFixture extends FileMemoryService {
    saved: ViewSaveRequest[] = [];
    override async getView(input: ViewReadRequest) {
        if (input.corpusId !== canonical.corpusId)
            throw new Error("Wrong recorded corpus");
        const version =
            input.viewId === canonical.viewId
                ? canonical
                : input.viewId === alias.viewId
                  ? alias
                  : undefined;
        if (
            !version ||
            (input.revisionId && input.revisionId !== version.revisionId)
        )
            throw new Error("Wrong recorded exact view revision");
        return structuredClone(version);
    }
    override async getViewHistory(input: ViewReadRequest) {
        return [{ commitId: head, version: await this.getView(input) }];
    }
    override async listViews(corpusId: string) {
        if (corpusId !== canonical.corpusId)
            throw new Error("Wrong recorded corpus");
        return { head, views: [structuredClone(canonical)] };
    }
    override async listViewBuilds(corpusId: string) {
        if (corpusId !== canonical.corpusId)
            throw new Error("Wrong recorded corpus");
        return [structuredClone(job)];
    }
    override async getViewBuild(input: ViewBuildJobRequest) {
        if (input.corpusId !== canonical.corpusId || input.jobId !== job.jobId)
            throw new Error("Wrong recorded consolidation job");
        return structuredClone(job);
    }
    override async saveViewDraft(input: ViewSaveRequest) {
        this.saved.push(structuredClone(input));
        return { commitId: head, version: structuredClone(canonical) };
    }
}

test("actual indexed P0 two-page canonical, old-ID, historical, receipt and editor shapes survive real MCP/in-process/RPC", async () => {
    expect(canonical.content.kind).toBe("wiki");
    expect(canonical.content.sections).toHaveLength(2);
    expect(canonical.content.citations.length).toBeGreaterThan(0);
    expect(
        canonical.content.citations.every((citation) =>
            citation.locator?.startsWith("indexed:"),
        ),
    ).toBe(true);
    const root = await mkdtemp(
        path.join(os.tmpdir(), "recorded-consolidation-protocol-"),
    );
    const service = new RecordedConsolidationFixture(root, {
        viewDrafts: false,
        informationalViews: false,
    });
    const host = await MemoryServiceHost.start(service);
    const client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { Authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        for (const transport of [
            new InProcessMemoryServiceClient(service),
            createMemoryServiceRpcFacade(service),
            client,
        ]) {
            for (const version of [canonical, alias]) {
                for (const revisionId of [undefined, version.revisionId]) {
                    const actual = await transport.getView({
                        corpusId: version.corpusId,
                        viewId: version.viewId,
                        ...(revisionId ? { revisionId } : {}),
                    });
                    expect(viewVersionSchema.parse(actual).content).toEqual(
                        version.content,
                    );
                    expect(actual?.redirect).toEqual(version.redirect);
                }
                const history = await transport.getViewHistory({
                    corpusId: version.corpusId,
                    viewId: version.viewId,
                });
                expect(history[0].version.content).toEqual(version.content);
            }
            expect(
                (await transport.listViews(canonical.corpusId)).views[0]
                    .content,
            ).toEqual(canonical.content);
            const jobs = await transport.listViewBuilds(canonical.corpusId);
            const receipt = jobs[0].results.find(
                (result) => result.wikiConsolidation,
            )?.wikiConsolidation;
            expect(receipt?.stage).toBe("ready");
            expect(receipt?.output.content).toEqual(canonical.content);
            expect(
                viewBuildJobSchema
                    .parse(
                        await transport.getViewBuild({
                            corpusId: canonical.corpusId,
                            jobId: job.jobId,
                        }),
                    )
                    .results.some(
                        (result) => result.wikiConsolidation?.stage === "ready",
                    ),
            ).toBe(true);
            expect(
                (await transport.saveViewDraft(request)).version.content,
            ).toEqual(canonical.content);
        }
        expect(service.saved).toEqual([request, request, request]);
        expect(
            viewSaveRequestSchema.safeParse({
                ...request,
                actor: "memory-view-generator",
            }).success,
        ).toBe(false);
        expect(
            viewSaveRequestSchema.safeParse({
                ...request,
                unlockProtection: [],
            }).success,
        ).toBe(false);
    } finally {
        await client.close();
        await host.close();
        await service.close();
        await rm(root, { recursive: true, force: true });
    }
});
