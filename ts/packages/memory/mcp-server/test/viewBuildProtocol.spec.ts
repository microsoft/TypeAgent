// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    FileMemoryService,
    type ViewSynthesisOutput,
    type ViewBuildSnapshot,
} from "@typeagent/memory-service";
import {
    McpMemoryServiceClient,
    viewBuildRequestSchema,
    viewResolutionSchema,
} from "@typeagent/memory-client";
import { MemoryServiceHost } from "../src/memoryServiceHost.js";
const {
    FakeProcedureCorpusIndex,
}: typeof import("../../service/dist/test/fakeProcedureCorpusIndex.js") =
    await import(
        new URL(
            "../../../service/dist/test/fakeProcedureCorpusIndex.js",
            import.meta.url,
        ).href
    );

function syntheticOutput(input: ViewBuildSnapshot): ViewSynthesisOutput {
    const source = input.inputs[0];
    const citation = {
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        locator: `chars:0-${source.content.length}`,
        excerpt: source.content,
    };
    const roles = [
        "description",
        "prerequisites",
        "diagnostic",
        "guard",
        "verification",
        "recovery",
        "context",
    ] as const;
    return {
        content: {
            kind: "troubleshootingGuide",
            title: "Synthetic guide",
            citations: [citation],
            sections: roles.map((role) => ({
                id: role,
                role,
                heading: role,
                body: source.content,
            })),
        },
        relationships: roles.map((role) => ({
            id: `support-${role}`,
            predicate: "supportedBy",
            from: {
                kind: "section",
                viewId: input.definition.viewId,
                sectionId: role,
            },
            to: {
                kind: "source",
                sourceId: source.sourceId,
                revisionId: source.revisionId,
            },
            citations: [citation],
        })),
        outcome: "diagnosticOnly",
        missingEvidence: ["No confirmed recovery"],
    };
}

test("real authenticated loopback MCP builds, inspects, edits, rejects publication and crosses restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memory-view-protocol-"));
    const open = () =>
        new FileMemoryService(root, {
            viewDrafts: true,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
            viewSynthesisAdapter: {
                identity: "offline-protocol-test",
                generate: async (input) => syntheticOutput(input),
                validate: async (_input, output) => ({
                    supported: true,
                    missingContext: [],
                    reasons: [],
                    sections: output.content.sections.map((section) => ({
                        sectionId: section.id,
                        supported: true,
                        reason: "Controlled offline assessment",
                    })),
                    relationships: output.relationships.map((edge) => ({
                        edgeId: edge.id,
                        supported: true,
                        reason: "Controlled offline assessment",
                    })),
                }),
            },
        });
    let host = await MemoryServiceHost.start(open());
    let client = await McpMemoryServiceClient.create({
        kind: "http",
        url: host.endpoint,
        headers: { authorization: `Bearer ${host.bearerToken}` },
    });
    try {
        const capabilities = await client.getCapabilities();
        expect(capabilities.derivedViews?.builds).toBe(true);
        const corpus = await client.createCorpus("Transport fixture");
        const source = await client.ingestDocument({
            corpusId: corpus.corpusId,
            source: {
                sourceId: "s",
                sourceType: "text",
                title: "Synthetic evidence",
                text: "Read only. No confirmed recovery. Escalate with fresh approval.",
            },
        });
        await client.waitForJob(source.jobId);
        const definition = {
            viewId: "guide",
            kind: "troubleshootingGuide" as const,
            selector: {
                kind: "sources" as const,
                sources: [
                    {
                        sourceId: source.sourceId,
                        revisionId: source.revisionId,
                    },
                ],
            },
        };
        const request = {
            corpusId: corpus.corpusId,
            expectedHead: (await client.listViews(corpus.corpusId)).head,
            targets: [{ definition, expectedVersion: 0 }],
            publication: false as const,
        };
        let job = await client.buildViews(request);
        while (job.state === "running") {
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            job = (await client.getViewBuild({
                corpusId: corpus.corpusId,
                jobId: job.jobId,
            }))!;
        }
        expect(job.state).toBe("complete");
        expect(job.results[0].state).toBe("draft");
        const snapshot = await client.listViews(corpus.corpusId);
        const view = snapshot.views[0];
        if (view.content.kind !== "troubleshootingGuide")
            throw new Error("Expected a generated troubleshooting guide");
        expect(view.generation?.input?.inputs[0].content).toContain(
            "Read only",
        );
        expect(view.actor).toBe("memory-view-generator");
        const saved = await client.saveViewDraft({
            corpusId: corpus.corpusId,
            viewId: "guide",
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition,
            content: {
                ...view.content,
                title: "Explicit human title",
            },
            relationships: view.relationships.flatMap((edge) =>
                edge.origin === "system"
                    ? []
                    : [
                          {
                              id: edge.id,
                              predicate: edge.predicate,
                              from: edge.from,
                              to: edge.to,
                              citations: edge.citations,
                          },
                      ],
            ),
        });
        expect(saved.version.actor).toBe(os.userInfo().username);
        expect(
            saved.version.edits?.some((edit) => edit.target === "title"),
        ).toBe(true);
        await expect(
            client.publishView({
                corpusId: corpus.corpusId,
                viewId: "guide",
                revisionId: saved.version.revisionId,
                expectedVersion: saved.version.version,
                expectedHead: saved.commitId,
            }),
        ).rejects.toThrow("complete source inventory");
        await client.close();
        await host.close();
        host = await MemoryServiceHost.start(open());
        client = await McpMemoryServiceClient.create({
            kind: "http",
            url: host.endpoint,
            headers: { authorization: `Bearer ${host.bearerToken}` },
        });
        expect(
            (
                await client.getViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: job.jobId,
                })
            )?.results[0].revisionId,
        ).toBe(job.results[0].revisionId);
        expect(
            (
                await client.getViewHistory({
                    corpusId: corpus.corpusId,
                    viewId: "guide",
                })
            )[0].version.content.title,
        ).toBe("Explicit human title");
        expect((await client.buildViews(request)).jobId).toBe(job.jobId);
    } finally {
        await client.close();
        await host.close();
        await rm(root, { recursive: true, force: true });
    }
});

test("wire rejects spoofed actors, unsupported kinds and publication permissions", () => {
    const request = {
        corpusId: "c",
        expectedHead: null,
        targets: [
            {
                expectedVersion: 0,
                definition: {
                    viewId: "g",
                    kind: "troubleshootingGuide",
                    selector: {
                        kind: "sources",
                        sources: [{ sourceId: "s", revisionId: "r" }],
                    },
                },
            },
        ],
    };
    expect(viewBuildRequestSchema.safeParse(request).success).toBe(true);
    expect(
        viewBuildRequestSchema.safeParse({ ...request, actor: "spoofed" })
            .success,
    ).toBe(false);
    expect(
        viewBuildRequestSchema.safeParse({ ...request, publication: true })
            .success,
    ).toBe(true);
    expect(
        viewBuildRequestSchema.safeParse({
            ...request,
            targets: [
                {
                    ...request.targets[0],
                    definition: {
                        ...request.targets[0].definition,
                        kind: "wiki",
                    },
                },
            ],
        }).success,
    ).toBe(false);
    expect(
        viewResolutionSchema.safeParse({ corpusId: "c", actor: "spoofed" })
            .success,
    ).toBe(false);
});
