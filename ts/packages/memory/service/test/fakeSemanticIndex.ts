// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IndexedDocument } from "../src/types.js";

export async function writeFakeSemanticIndex(
    directory: string,
    documents: IndexedDocument[],
): Promise<void> {
    const filePath = path.join(directory, "corpus_data.json");
    if (documents.length === 0) {
        await rm(filePath, { force: true });
        return;
    }
    await writeFile(
        filePath,
        JSON.stringify({
            messages: documents.map((document) => ({
                sourceId: document.source.sourceId,
                content: document.content,
            })),
            semanticRefs: [],
        }),
    );
}
