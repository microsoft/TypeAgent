// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    CorpusIndex,
    CorpusIndexMatch,
    IndexedDocument,
    MemoryKnowledgeGraph,
} from "../src/types.js";

export class FakeProcedureCorpusIndex implements CorpusIndex {
    private documents: IndexedDocument[] = [];

    public constructor(private readonly directory: string) {}

    public async initialize(): Promise<void> {
        this.documents = JSON.parse(
            await readFile(path.join(this.directory, "documents.json"), "utf8"),
        ) as IndexedDocument[];
    }

    public async rebuild(documents: IndexedDocument[]): Promise<void> {
        this.documents = structuredClone(documents);
        await writeFile(
            path.join(this.directory, "documents.json"),
            JSON.stringify(documents),
        );
    }

    public async search(
        query: string,
        limit: number,
        tags?: string[],
    ): Promise<CorpusIndexMatch[]> {
        return this.documents
            .filter(
                (document) =>
                    (tags === undefined ||
                        document.indexTags?.some((tag) =>
                            tags.includes(tag),
                        )) &&
                    document.content
                        .toLowerCase()
                        .includes(query.toLowerCase()),
            )
            .slice(0, limit)
            .map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                snippet: document.content,
                score: 1,
            }));
    }

    public async getKnowledgeGraph(): Promise<MemoryKnowledgeGraph> {
        return { entities: [], topics: [], relationships: [] };
    }
}
