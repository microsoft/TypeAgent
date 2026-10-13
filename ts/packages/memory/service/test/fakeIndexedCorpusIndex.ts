// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
const {
    indexedLocator,
    parseIndexedLocator,
    selectIndexedFragments,
}: typeof import("../src/indexedFragments.js") = await import(
    new URL("../../dist/indexedFragments.js", import.meta.url).href
);
import type { IndexedFragmentRequest } from "../src/types.js";

export class FakeIndexedCorpusIndex extends FakeSemanticCorpusIndex {
    public async readFragments(request: IndexedFragmentRequest) {
        return selectIndexedFragments(
            this.documents.map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                blockOrdinal: 0,
                text: document.content,
                score: 1,
            })),
            request,
        );
    }

    public async resolveIndexedLocator(
        sourceId: string,
        revisionId: string,
        locator: string,
    ) {
        const range = parseIndexedLocator(locator);
        const document = this.documents.find(
            (entry) =>
                entry.source.sourceId === sourceId &&
                entry.revision.revisionId === revisionId,
        );
        if (
            !document ||
            locator !==
                indexedLocator(
                    {
                        sourceId,
                        revisionId,
                        blockOrdinal: 0,
                        text: document.content,
                        score: 1,
                    },
                    range.start,
                    range.end,
                )
        )
            throw new Error("Indexed-text anchor unavailable");
        return document.content.slice(range.start, range.end);
    }
}
