// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StructuredOutputJsonSchema } from "@typeagent/aiclient";
import type {
    WikiContent,
    ViewBuildJob,
    ViewRelationshipInput,
} from "../src/viewTypes.js";
import { FakeProcedureCorpusIndex } from "./fakeProcedureCorpusIndex.js";
import { wikiTestAnswer } from "./wikiTestModel.js";
import { evidenceRecord } from "../src/viewSynthesisEvidence.js";
import { authoredRelationships } from "../src/viewRelationships.js";
import { wikiIndex } from "../src/viewContent.js";

const runtimeJest = import.meta.jest;
const jest = runtimeJest as typeof runtimeJest & {
    unstable_mockModule(
        name: string,
        factory: () => Record<string, unknown>,
    ): void;
};
const actual = await import("@typeagent/aiclient");
const stages: string[] = [];
let prose = "Definitions and scope remain conditional.\n\n";
let alter: (name: string, output: unknown) => unknown = (_name, output) =>
    output;
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    ...actual,
    tryCreateEmbeddingModel: () => undefined,
    openai: {
        ...actual.openai,
        createChatModel: () => ({
            complete: async (
                messages: Array<{ role: string; content: string }>,
                _usage: unknown,
                schema: StructuredOutputJsonSchema,
            ) => {
                const message = messages.find(
                    (message) => message.role === "user",
                );
                if (!message) throw new Error("Missing offline source input");
                stages.push(schema.name);
                return {
                    success: true,
                    data: JSON.stringify(
                        alter(
                            schema.name,
                            wikiTestAnswer(
                                schema.name,
                                JSON.parse(message.content),
                                prose,
                            ),
                        ),
                    ),
                };
            },
        }),
    },
}));
const { FileMemoryService } = await import("../src/fileMemoryService.js");
const { waitForMemoryJob } = await import("../src/rpcFacade.js");
const { runMemoryViewsCli } = await import("../src/memoryViewsCli.js");

describe("bounded wiki evidence, edits, publication and managed lifecycle", () => {
    let root: string;
    let corpusId: string;
    let service: InstanceType<typeof FileMemoryService>;
    const open = (viewDrafts = true) =>
        new FileMemoryService(root, {
            viewDrafts,
            indexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
            procedureIndexFactory: (_id, directory) =>
                new FakeProcedureCorpusIndex(directory),
        });
    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), "wiki-offline-"));
        service = open();
        corpusId = (await service.createCorpus("Payments wiki")).corpusId;
        stages.length = 0;
        prose = "Definitions and scope remain conditional.\n\n";
        alter = (_name, output) => output;
        await ingest(
            "s",
            "Reporting-query explanation rejected. Pool-pressure explanation retained.\n\nCapacity BLOCKED pending owner review; headroom and workload-memory contradiction remain unresolved.",
        );
    });
    afterEach(async () => {
        await service.close();
        await rm(root, { recursive: true, force: true });
    });
    async function ingest(sourceId: string, text: string) {
        const job = await service.ingestDocument({
            corpusId,
            source: { sourceId, sourceType: "text", title: sourceId, text },
        });
        expect((await waitForMemoryJob(service, job.jobId)).state).toBe(
            "complete",
        );
        return job;
    }
    async function build(
        publication = false,
        viewId = "payments-wiki",
        sourceId = "s",
    ) {
        const snapshot = await service.listViews(corpusId);
        const source = (await service.getSource(corpusId, sourceId))!;
        let job: ViewBuildJob = await service.buildViews({
            corpusId,
            expectedHead: snapshot.head,
            publication,
            targets: [
                {
                    expectedVersion:
                        snapshot.views.find((view) => view.viewId === viewId)
                            ?.version ?? 0,
                    definition: {
                        viewId,
                        kind: "wiki",
                        selector: {
                            kind: "sources",
                            sources: [
                                {
                                    sourceId,
                                    revisionId: source.activeRevisionId!,
                                },
                            ],
                        },
                    },
                },
            ],
        });
        for (let tries = 0; job.state === "running" && tries < 500; tries++) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            job = (await service.getViewBuild({ corpusId, jobId: job.jobId }))!;
        }
        return job;
    }
    async function current() {
        const snapshot = await service.listViews(corpusId);
        const view = snapshot.views.find(
            (view) => view.viewId === "payments-wiki",
        );
        if (!view || view.content.kind !== "wiki")
            throw new Error("Missing bounded wiki");
        return { snapshot, view, content: view.content };
    }
    async function save(
        content: WikiContent,
        relationships?: ViewRelationshipInput[],
    ) {
        const { snapshot, view } = await current();
        content.index = wikiIndex(content.sections);
        return service.saveViewDraft({
            corpusId,
            viewId: view.viewId,
            expectedHead: snapshot.head,
            expectedVersion: view.version,
            definition: {
                viewId: view.viewId,
                kind: "wiki",
                selector: view.definition.selector,
            },
            content,
            relationships: relationships ?? authoredRelationships(view),
        });
    }
    const search = () =>
        service.searchViews({
            corpusId,
            query: "Capacity",
            freshness: "current",
            kinds: ["wiki"],
        });

    test("configured source-first pipeline emits typed index/pages, exact proof and honest unresolved context", async () => {
        const job = await build(true);
        expect({
            state: job.results[0].state,
            reason: job.results[0].reason,
        }).toEqual({ state: "searchable", reason: expect.any(String) });
        expect(stages).toEqual([
            "memory_source_fact_inventory",
            "memory_source_inventory_check",
            "memory_wiki_construction",
            "memory_inventory_artifact_support",
            "memory_inventory_artifact_support",
        ]);
        const { view, content } = await current();
        expect(content.index).toEqual(wikiIndex(content.sections));
        expect(content.sections.map((page) => page.details.taxonomy)).toEqual([
            "concept",
            "system",
            "project",
        ]);
        expect(content.sections[0].body).toContain(
            "Reporting-query explanation rejected",
        );
        expect(content.sections[0].body).toContain("unresolved");
        expect(
            view.relationships.filter((edge) => edge.family === "knowledge"),
        ).toHaveLength(2);
        expect((await search())[0]).toMatchObject({
            view: { revisionId: view.revisionId },
            review: "unreviewed",
            corroboration: "derived",
        });
        for (const citation of content.citations) {
            const source = await service.getSourceContent({
                corpusId,
                sourceId: citation.sourceId,
                revisionId: citation.revisionId,
            });
            const [, start, end] = /^chars:(\d+)-(\d+)$/.exec(
                citation.locator,
            )!;
            expect(source.content.slice(Number(start), Number(end))).toBe(
                citation.excerpt,
            );
        }
    });

    test("rename retains identity, clean rebuild preserves explicit human attribution and exact published search revision", async () => {
        await build();
        const original = await current();
        original.content.sections[0].heading = "Pressure explanations";
        original.content.sections[0].body =
            original.content.sections[0].body.replace(
                "Definitions",
                "Human definitions",
            );
        await save(original.content);
        alter = (name, output) => {
            if (name !== "memory_wiki_construction") return output;
            const raw = evidenceRecord(output);
            const pages = evidenceRecord(raw.content).pages as Array<
                Record<string, unknown>
            >;
            pages[1].prose = "New non-overlapping system context.";
            return raw;
        };
        const job = await build(true);
        if (job.results[0].state !== "searchable")
            throw new Error(`Wiki merge failed: ${job.results[0].reason}`);
        expect({
            state: job.results[0].state,
            reason: job.results[0].reason,
        }).toEqual({ state: "searchable", reason: expect.any(String) });
        const { view, content } = await current();
        expect(content.sections[0].id).toBe("pool-pressure");
        expect(content.sections[0].heading).toBe("Pressure explanations");
        expect(content.sections[0].body).toContain("Human definitions");
        expect(content.sections[1].body).toContain(
            "New non-overlapping system context",
        );
        expect(view.provenance).toBe("merged");
        expect(
            view
                .edits!.filter((edit) => edit.status !== "cleared")
                .every((edit) => edit.actor === original.view.actor),
        ).toBe(true);
        expect((await search())[0].view.revisionId).toBe(view.revisionId);
    });

    test("typed page merge and edge tombstones survive unchanged generation; changed deleted pages conflict", async () => {
        await build();
        const { content, view } = await current();
        const sourcePage = content.sections[1];
        const target = content.sections[0];
        target.body += `\n\n${sourcePage.body}`;
        target.details.mergedPageIds = [sourcePage.id];
        content.sections = content.sections.filter(
            (page) => page.id !== sourcePage.id,
        );
        const edges = authoredRelationships(view).filter(
            (edge) =>
                edge.from.sectionId !== sourcePage.id &&
                (edge.to.kind !== "section" ||
                    edge.to.sectionId !== sourcePage.id),
        );
        await save(content, edges);
        expect((await build(true)).results[0].state).toBe("searchable");
        const merged = await current();
        expect(merged.content.sections).toHaveLength(2);
        expect(merged.content.sections[0].details.mergedPageIds).toEqual([
            "payments-system",
        ]);
        expect(
            merged.view.relationships.some(
                (edge) =>
                    edge.from.kind === "section" &&
                    edge.from.sectionId === sourcePage.id,
            ),
        ).toBe(false);
        prose = "Incompatible regenerated explanation.\n\n";
        const conflict = await build(true);
        expect(conflict.results[0].state).toBe("conflicted");
        expect((await current()).view.revisionId).toBe(merged.view.revisionId);
        expect(await search()).toEqual([]);
    });

    test("invalid endpoints, taxonomy, unsupported final edits and absent checked facts cannot publish", async () => {
        alter = (name, output) => {
            if (name !== "memory_wiki_construction") return output;
            const raw = evidenceRecord(output);
            raw.relationships = [
                {
                    from: "pool-pressure",
                    to: "missing",
                    predicate: "contradicts",
                },
            ];
            return raw;
        };
        const failed = (await build(true)).results[0];
        expect(failed.state).toBe("failed");
        expect(failed.reason).toContain("distinct current page endpoints");
        expect(
            (await search()).map((match) => match.view.viewId),
        ).not.toContain("payments-wiki");
        alter = (_name, output) => output;
        await build();
        const { content } = await current();
        content.sections[0].body =
            "Unsupported claim without checked source facts";
        await expect(save(content)).rejects.toThrow("rendered checked");
        expect(
            (await search()).map((match) => match.view.viewId),
        ).not.toContain("payments-wiki");
    });

    test("replace, archive, forget, clear and disabled reopen clean managed copies while preserving unrelated records", async () => {
        await build(true);
        await ingest("unrelated", "Unrelated retained privacy sentinel.");
        await build(true, "unrelated-wiki", "unrelated");
        const original = await current();
        await service.close();
        service = open(false);
        expect((await service.getCapabilities()).derivedViews).toBeUndefined();
        await expect(service.listViews(corpusId)).rejects.toThrow(
            "not supported",
        );
        await service.close();
        service = open();
        expect((await current()).view.revisionId).toBe(
            original.view.revisionId,
        );
        await ingest(
            "s",
            "Changed capacity remains blocked; original query explanation still rejected.",
        );
        expect(
            (await search()).map((match) => match.view.viewId),
        ).not.toContain("payments-wiki");
        expect((await build(true)).results[0].state).toBe("searchable");
        const active = await current();
        await service.archiveView({
            corpusId,
            viewId: active.view.viewId,
            expectedVersion: active.view.version,
            expectedHead: active.snapshot.head!,
        });
        expect(
            (await search()).map((match) => match.view.viewId),
        ).not.toContain("payments-wiki");
        const preview = await service.previewForgetSource(corpusId, "s");
        await service.forgetSource({
            corpusId,
            sourceId: "s",
            confirmationToken: preview.confirmationToken,
        });
        expect(
            await service.getViewHistory({ corpusId, viewId: "payments-wiki" }),
        ).toEqual([]);
        expect(await service.listViewBuilds(corpusId)).toHaveLength(1);
        expect(
            (await service.listViews(corpusId)).views.map(
                (view) => view.viewId,
            ),
        ).toEqual(["unrelated-wiki"]);
        await service.close();
        service = open();
        expect(
            (await service.listViews(corpusId)).views.map(
                (view) => view.viewId,
            ),
        ).toEqual(["unrelated-wiki"]);
        await service.clearCorpus(corpusId);
        expect((await service.listViews(corpusId)).views).toEqual([]);
        expect(await service.listViewBuilds(corpusId)).toEqual([]);
        expect(await managedText(path.join(root, corpusId))).not.toContain(
            "Reporting-query",
        );
    });

    test("CLI advertises wiki without provider calls or execution authority", async () => {
        await service.close();
        expect(
            await runMemoryViewsCli([
                "--store",
                root,
                "--enable-view-drafts",
                "capabilities",
            ]),
        ).toMatchObject({
            derivedViews: { kinds: expect.arrayContaining(["wiki"]) },
        });
        expect(stages).toEqual([]);
    });
});

async function managedText(directory: string): Promise<string> {
    const output: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) output.push(await managedText(file));
        else if (entry.name.endsWith(".json"))
            output.push(await readFile(file, "utf8"));
    }
    return output.join("\n");
}
