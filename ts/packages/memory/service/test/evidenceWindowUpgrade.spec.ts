// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    copyFile,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
    sourceFollowingHost,
    replaceOriginal,
    changeFamily,
    settleConsolidation,
} from "./sourceFollowingFixtures.js";
import { originalFixtureRoot } from "./wikiConsolidationFixtures.js";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { KnowProCorpusIndex } from "../src/knowProCorpusIndex.js";
import {
    authoredRelationships,
    derivedDefinitionInput,
} from "../src/viewRelationships.js";

async function prePolicyClasses(directory: string) {
    const compiled = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
    );
    for (const entry of await readdir(compiled, { withFileTypes: true }))
        if (entry.isFile() && entry.name.endsWith(".js"))
            await copyFile(
                path.join(compiled, entry.name),
                path.join(directory, entry.name),
            );
    const oldWindows = await readFile(
        path.resolve(
            compiled,
            "..",
            "test",
            "fixtures",
            "indexedFragments.prePolicy.ts.txt",
        ),
        "utf8",
    );
    expect(
        createHash("sha256")
            .update(oldWindows.replaceAll("\r\n", "\n"))
            .digest("hex"),
    ).toBe("2cfd2923fae05a4aad99aaccbbe689402bbcac5f041784ec7b16740701463487");
    await writeFile(
        path.join(directory, "indexedFragments.js"),
        ts.transpileModule(oldWindows, {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
            },
        }).outputText,
    );
    const recipeFile = path.join(directory, "informationalView.js");
    const recipe = await readFile(recipeFile, "utf8");
    expect(recipe).toContain(":indexed-evidence-v2");
    // Restore the actual prior v4 recipe, not its model role or any source/index data.
    await writeFile(recipeFile, recipe.replaceAll(":indexed-evidence-v2", ""));
    const service: { FileMemoryService: typeof FileMemoryService } =
        await import(
            pathToFileURL(path.join(directory, "fileMemoryService.js")).href
        );
    const index: { KnowProCorpusIndex: typeof KnowProCorpusIndex } =
        await import(
            pathToFileURL(path.join(directory, "knowProCorpusIndex.js")).href
        );
    return {
        Service: service.FileMemoryService,
        Index: index.KnowProCorpusIndex,
    };
}

async function indexedIdentity(root: string, corpusId: string) {
    const corpus = path.join(root, corpusId);
    const manifest: { indexGeneration: string } = JSON.parse(
        await readFile(path.join(corpus, "manifest.json"), "utf8"),
    );
    const indexed = await readFile(
        path.join(
            corpus,
            "index",
            manifest.indexGeneration,
            "corpus_data.json",
        ),
    );
    return {
        indexGeneration: manifest.indexGeneration,
        indexedHash: createHash("sha256").update(indexed).digest("hex"),
    };
}

async function publishCurrent(
    service: FileMemoryService,
    corpusId: string,
    viewId: string,
) {
    for (let attempt = 0; attempt < 20; attempt++) {
        const view = (await service.getView({ corpusId, viewId }))!;
        try {
            await service.publishView({
                corpusId,
                viewId,
                revisionId: view.revisionId,
                expectedVersion: view.version,
                expectedHead: (await service.listViews(corpusId)).head!,
            });
            return;
        } catch (error) {
            if (
                !(error instanceof Error) ||
                error.message !==
                    "Publication head or target revision conflict" ||
                attempt === 19
            )
                throw error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    throw new Error("Pre-policy publication did not settle");
}

test.each([false, true])(
    "unchanged-index pre-policy ready article enrolls once on recipe upgrade; blocked=%s",
    async (blocked) => {
        const root = await mkdtemp(
            path.join(os.tmpdir(), "evidence-policy-upgrade-"),
        );
        const packageRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        const legacyDirectory = await mkdtemp(
            path.join(packageRoot, ".c1-legacy-policy-"),
        );
        const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
        let service: FileMemoryService | undefined;
        try {
            const legacy = sourceFollowingHost(
                root,
                ["Governing tail exception"],
                await prePolicyClasses(legacyDirectory),
            );
            service = legacy.open();
            const { corpusId } = await service.createCorpus(
                "Actual pre-policy P0 upgrade",
            );
            await changeFamily(service, corpusId, "pause");
            const original = await readFile(
                path.join(originalFixtureRoot(), "initial", "document-020.md"),
                "utf8",
            );
            const tail = original
                .slice(original.indexOf("Governing tail exception:"))
                .split(/\r?\n\r?\n/)[0]
                .replace(/\s*\|\s*$/, "")
                .trim();
            expect(tail.length).toBe(822);
            await replaceOriginal(service, corpusId, original);
            const source = (await service.getSource(corpusId, "handoff"))!;
            const viewId = randomUUID();
            const admitted = await service.buildViews({
                corpusId,
                publication: true,
                expectedHead: (await service.listViews(corpusId)).head,
                targets: [
                    {
                        expectedVersion: 0,
                        definition: {
                            viewId,
                            kind: "wiki",
                            selector: {
                                kind: "sources",
                                sources: [
                                    {
                                        sourceId: source.sourceId,
                                        revisionId: source.activeRevisionId,
                                    },
                                ],
                            },
                            wiki: {
                                construction: "informational-wiki-v1",
                                query: "Governing tail exception",
                                aliases: [],
                                excludedSourceIds: [],
                            },
                        },
                    },
                ],
            });
            for (let attempt = 0; attempt < 1000; attempt++) {
                const job = await service.getViewBuild({
                    corpusId,
                    jobId: admitted.jobId,
                });
                if (job?.state !== "running") {
                    expect(job?.state).toBe("complete");
                    expect(job?.results[0].state).toBe("draft");
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            const old = (await service.getView({ corpusId, viewId }))!;
            expect(old.generation!.input!.model).not.toContain(
                ":indexed-evidence-v2",
            );
            expect(old.content.sections[0].body).not.toContain(tail);
            const content = structuredClone(old.content);
            content.title = "My worksheet navigation";
            await service.saveViewDraft({
                corpusId,
                viewId,
                expectedHead: (await service.listViews(corpusId)).head,
                expectedVersion: old.version,
                definition: derivedDefinitionInput(old),
                content,
                relationships: authoredRelationships(old),
            });
            await publishCurrent(service, corpusId, viewId);
            await changeFamily(service, corpusId, "resume");
            await settleConsolidation(service, corpusId);
            const prior = (await service.getView({ corpusId, viewId }))!;
            expect(
                (await service.getViewPublication({ corpusId, viewId }))
                    .indexState,
            ).toBe("ready");
            const priorHistory = await service.getViewHistory({
                corpusId,
                viewId,
            });
            const priorIndex = await indexedIdentity(root, corpusId);
            await service.close();
            const current = sourceFollowingHost(root, [
                "Governing tail exception",
            ]);
            if (blocked) current.rejectEditorial();
            service = current.open();
            await service.initialize();
            await settleConsolidation(service, corpusId);
            const refreshed = (await service.getView({ corpusId, viewId }))!;
            expect(current.calls.generation).toBe(1);
            expect(refreshed.content.title).toBe("My worksheet navigation");
            expect(
                (await service.getSource(corpusId, "handoff"))!
                    .activeRevisionId,
            ).toBe(source.activeRevisionId);
            expect(await indexedIdentity(root, corpusId)).toEqual(priorIndex);
            expect(refreshed.content.sections[0].body.includes(tail)).toBe(
                !blocked,
            );
            expect(refreshed.version).toBe(prior.version + (blocked ? 0 : 1));
            if (!blocked)
                expect(refreshed.generation!.input!.model).toContain(
                    ":indexed-evidence-v2",
                );
            else
                expect(
                    (await service.listViewBuilds(corpusId)).some((job) =>
                        job.results.some(
                            (result) =>
                                result.viewId === viewId &&
                                result.state === "blocked",
                        ),
                    ),
                ).toBe(true);
            const history = await service.getViewHistory({ corpusId, viewId });
            expect(history.length).toBe(
                priorHistory.length + (blocked ? 0 : 1),
            );
            const calls = { ...current.calls };
            await service.close();
            service = current.open();
            await service.initialize();
            await settleConsolidation(service, corpusId);
            for (let repeat = 0; repeat < 2; repeat++) {
                await changeFamily(service, corpusId, "update");
                await settleConsolidation(service, corpusId);
            }
            expect(current.calls).toEqual(calls);
            expect(
                (await service.getView({ corpusId, viewId }))!.revisionId,
            ).toBe(refreshed.revisionId);
            expect(
                (await service.getViewHistory({ corpusId, viewId })).length,
            ).toBe(history.length);
            expect(await indexedIdentity(root, corpusId)).toEqual(priorIndex);
            expect(current.unexpectedModelCalls()).toBe(0);
            if (process.env.TYPEAGENT_EVIDENCE_UPGRADE_RECEIPT)
                await writeFile(
                    `${process.env.TYPEAGENT_EVIDENCE_UPGRADE_RECEIPT}-${blocked}.json`,
                    JSON.stringify(
                        {
                            corpusId,
                            viewId,
                            blocked,
                            originalRevision: source.activeRevisionId,
                            priorIndex,
                            priorRecipe: prior.generation!.input!.model,
                            currentRecipe: refreshed.generation!.input!.model,
                            priorRevision: prior.revisionId,
                            currentRevision: refreshed.revisionId,
                            priorHistory: priorHistory.length,
                            currentHistory: history.length,
                            callsAfterUpgradeAndRepeat: current.calls,
                            tailInArticle: !blocked,
                            sameOriginalAndIndex: true,
                        },
                        null,
                        2,
                    ),
                );
        } finally {
            await service?.close();
            await rm(root, { recursive: true, force: true });
            await rm(legacyDirectory, { recursive: true, force: true });
            if (previousProvider === undefined)
                delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
            else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
        }
    },
    90000,
);
