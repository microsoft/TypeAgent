// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kpLib from "knowledge-processor";
import * as kp from "knowpro";
import { openai } from "aiclient";
import { IndexingState } from "./memory.js";

export function createEmbeddingModelWithCache(
    cacheSize: number,
    getCache?: () => kpLib.TextEmbeddingCache | undefined,
    embeddingSize = 1536,
): [kpLib.TextEmbeddingModelWithCache, number] {
    const embeddingModel = kpLib.createEmbeddingCache(
        openai.createEmbeddingModel(),
        cacheSize,
        getCache,
    );

    return [embeddingModel, embeddingSize];
}

export function createIndexingState(): IndexingState {
    return {
        lastMessageOrdinal: -1,
        lastSemanticRefOrdinal: -1,
    };
}

export function getIndexingErrors(
    results: kp.IndexingResults,
): string | undefined {
    let error = "";
    error += getIndexingError(results.semanticRefs);
    error += getIndexingError(results.secondaryIndexResults?.message);
    error += getIndexingError(results.secondaryIndexResults?.properties);
    error += getIndexingError(results.secondaryIndexResults?.relatedTerms);
    error += getIndexingError(results.secondaryIndexResults?.timestamps);
    return error.length > 0 ? error : undefined;
}

function getIndexingError(result: kp.TextIndexingResult | undefined) {
    return result?.error ? result.error + "\n" : "";
}

export function addAliasesForName(
    aliases: kp.TermToRelatedTermsMap,
    name: string,
    addLastName: boolean,
) {
    name = name.toLocaleLowerCase();
    const parsedName = kpLib.conversation.splitParticipantName(name);
    if (parsedName && parsedName.firstName && parsedName.lastName) {
        // If participantName is a full name, then associate firstName with the full name
        aliases.addRelatedTerm(parsedName.firstName, { text: name });
        aliases.addRelatedTerm(name, { text: parsedName.firstName });
        if (addLastName) {
            aliases.addRelatedTerm(parsedName.lastName, { text: name });
            aliases.addRelatedTerm(name, { text: parsedName.lastName });
        }
    }
}
