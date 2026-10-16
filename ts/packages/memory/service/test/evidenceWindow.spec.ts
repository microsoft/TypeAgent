// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    sourceFollowingHost,
    replaceOriginal,
    changeFamily,
    settleConsolidation,
} from "./sourceFollowingFixtures.js";
import { originalFixtureRoot } from "./wikiConsolidationFixtures.js";
import { parseIndexedLocator } from "../src/indexedFragments.js";
import { createMemoryServiceRpcFacade } from "../src/rpcFacade.js";
import type { ViewVersion } from "../src/viewTypes.js";

test("DEFAULT real KnowPro/P0 capture and ARTICLE include the full current indexed governing qualification across original revisions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "evidence-window-p0-"));
    const previousProvider = process.env.TYPEAGENT_EMBEDDING_PROVIDER;
    process.env.TYPEAGENT_EMBEDDING_PROVIDER = "none";
    const host = sourceFollowingHost(root, ["Governing tail exception"]);
    const service = host.open();
    const receipts = [];
    try {
        const { corpusId } = await service.createCorpus(
            "Actual P0 default evidence windows",
        );
        let prior: ViewVersion | undefined;
        for (const stage of ["initial", "t1", "t2"]) {
            await changeFamily(service, corpusId, "pause");
            const original = await readFile(
                path.join(originalFixtureRoot(), stage, "document-020.md"),
                "utf8",
            );
            const tailStart = original.indexOf("Governing tail exception:");
            expect(tailStart).toBeGreaterThan(8000);
            const tail = original
                .slice(tailStart)
                .split(/\r?\n\r?\n/)[0]
                .replace(/\s*\|\s*$/, "")
                .trim();
            expect(tail.length).toBe(822);
            await replaceOriginal(service, corpusId, original);
            const source = (await service.getSource(corpusId, "handoff"))!;
            const index = host.indexes.get(corpusId)!;
            const occurrences = await index.getTopicOccurrences(
                new Set(["handoff"]),
            );
            expect(
                occurrences.some(
                    (occurrence) =>
                        occurrence.label === "Governing tail exception",
                ),
            ).toBe(true);
            const indexedOriginal = occurrences[0].citations
                .map((citation) => citation.excerpt)
                .join("");
            expect(indexedOriginal).toContain(tail);
            const selected = await index.readFragments({
                terms: ["Governing tail exception"],
                sourceIds: ["handoff"],
            });
            expect(
                selected.fragments.some((fragment) =>
                    fragment.snippet.includes(tail),
                ),
            ).toBe(true);
            expect(selected.readChars).toBeLessThanOrEqual(32000);
            expect(selected.fragments.length).toBeLessThanOrEqual(12);
            expect(selected.limited).toBe(true);
            expect(
                (
                    await index.readFragments({
                        terms: ["Governing tail exception"],
                        sourceIds: ["excluded"],
                    })
                ).fragments,
            ).toEqual([]);
            if (prior) {
                const oldCitation = prior.content.citations[0];
                await expect(
                    index.resolveIndexedLocator(
                        oldCitation.sourceId,
                        oldCitation.revisionId,
                        oldCitation.locator,
                    ),
                ).rejects.toThrow(
                    "Indexed-text anchor is unavailable in the current index",
                );
            }
            await changeFamily(service, corpusId, "resume");
            const views = await settleConsolidation(service, corpusId);
            const current = views.views.find(
                (view) =>
                    view.definition.wiki?.query.toLowerCase() ===
                    "governing tail exception",
            );
            expect(current).toBeDefined();
            const input = current!.generation!.input!;
            expect(
                input.inputs.map((item) => item.content).join("\n"),
            ).toContain(tail);
            expect(
                current!.content.sections
                    .map((section) => section.body)
                    .join("\n"),
            ).toContain(tail);
            if (prior) expect(current!.viewId).toBe(prior.viewId);
            for (const citation of current!.content.citations) {
                expect(citation.revisionId).toBe(source.activeRevisionId);
                expect(
                    await index.resolveIndexedLocator(
                        citation.sourceId,
                        citation.revisionId,
                        citation.locator,
                    ),
                ).toBe(citation.excerpt);
            }
            const protocol: {
                viewVersionSchema: { parse(value: unknown): ViewVersion };
            } = await import(
                new URL("../../../client/dist/viewProtocol.js", import.meta.url)
                    .href
            );
            const parsed = protocol.viewVersionSchema.parse(
                await createMemoryServiceRpcFacade(service).getView({
                    corpusId,
                    viewId: current!.viewId,
                }),
            );
            expect(parsed.content.sections[0].body).toContain(tail);
            receipts.push({
                stage,
                corpusId,
                viewId: current!.viewId,
                revisionId: current!.revisionId,
                sourceRevisionId: source.activeRevisionId,
                indexedChars: indexedOriginal.length,
                tailStart: indexedOriginal.indexOf(tail),
                tailLength: tail.length,
                readChars: selected.readChars,
                fragments: selected.fragments.map((fragment) =>
                    parseIndexedLocator(fragment.locator),
                ),
                capturedTail: true,
                articleTail: true,
                publicTypedArticleTail: true,
            });
            prior = current;
        }
        expect(host.unexpectedModelCalls()).toBe(0);
        if (process.env.TYPEAGENT_EVIDENCE_WINDOW_RECEIPT)
            await writeFile(
                process.env.TYPEAGENT_EVIDENCE_WINDOW_RECEIPT,
                JSON.stringify(receipts, null, 2),
            );
    } finally {
        await service.close();
        await rm(root, { recursive: true, force: true });
        if (previousProvider === undefined)
            delete process.env.TYPEAGENT_EMBEDDING_PROVIDER;
        else process.env.TYPEAGENT_EMBEDDING_PROVIDER = previousProvider;
    }
}, 90000);
