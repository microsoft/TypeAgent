// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { indexedLocator, type IndexedBlock } from "./indexedFragments.js";
import type { TopicOccurrence } from "./topicTypes.js";

export function indexedTopicOccurrence(
    block: IndexedBlock,
    label: string,
    ordinal: number,
): TopicOccurrence {
    const citations = [];
    for (let start = 0; start < block.text.length; ) {
        let end = Math.min(start + 2000, block.text.length);
        if (
            end < block.text.length &&
            /[\uD800-\uDBFF]/.test(block.text[end - 1])
        )
            end--;
        citations.push({
            sourceId: block.sourceId,
            revisionId: block.revisionId,
            locator: indexedLocator(block, start, end),
            excerpt: block.text.slice(start, end),
        });
        start = end;
    }
    return {
        id: `occurrence:${createHash("sha256")
            .update(
                JSON.stringify([
                    block.sourceId,
                    block.revisionId,
                    block.blockOrdinal,
                    label,
                    ordinal,
                ]),
            )
            .digest("hex")
            .slice(0, 32)}`,
        sourceId: block.sourceId,
        revisionId: block.revisionId,
        label: label.trim(),
        scope: block.sourceId,
        ordinal,
        citations,
    };
}
