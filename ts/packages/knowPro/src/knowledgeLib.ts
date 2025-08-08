// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * INTERNAL LIBRARY
 * Knowledge functions
 */

import { dateTime, getTopK } from "typeagent";
import { Scored } from "./common.js";
import {
    SemanticRef,
    ScoredSemanticRefOrdinal,
    ScoredKnowledge,
    KnowledgeType,
    Knowledge,
    ISemanticRefCollection,
    IConversation,
    MessageOrdinal,
    IMessageCollection,
} from "./interfaces.js";
import { conversation as kpLib } from "knowledge-processor";
import { getSemanticRefsFromScoredOrdinals } from "./searchLib.js";

export function facetValueToString(facet: kpLib.Facet): string {
    const value = facet.value;
    if (typeof value === "object") {
        return `${value.amount} ${value.units}`;
    }
    return value.toString();
}

export function getTopKnowledge<T>(
    values: IterableIterator<Scored<T>>,
    type: KnowledgeType,
    toKnowledge: (item: T) => Knowledge,
    topK?: number,
) {
    let topKValues =
        topK !== undefined && topK > 0 ? getTopK(values, topK) : values;

    const mergedKnowledge: ScoredKnowledge[] = [];
    for (const scoredValue of topKValues) {
        mergedKnowledge.push({
            knowledgeType: type,
            knowledge: toKnowledge(scoredValue.item),
            score: scoredValue.score,
        });
    }
    return mergedKnowledge;
}

export function* getScoredSemanticRefsFromOrdinals(
    semanticRefs: ISemanticRefCollection,
    semanticRefMatches: ScoredSemanticRefOrdinal[],
    knowledgeType: KnowledgeType,
): IterableIterator<Scored<SemanticRef>> {
    for (let semanticRefMatch of semanticRefMatches) {
        const semanticRef = semanticRefs.get(
            semanticRefMatch.semanticRefOrdinal,
        );
        if (semanticRef.knowledgeType === knowledgeType) {
            yield {
                score: semanticRefMatch.score,
                item: semanticRef,
            };
        }
    }
}

export function* messageOrdinalsFromSemanticRefs(semanticRefs: SemanticRef[]) {
    for (const sr of semanticRefs) {
        yield sr.range.start.messageOrdinal;
    }
}

export function getTimestampsForSemanticRefs(
    messages: IMessageCollection,
    semanticRefs: SemanticRef[],
): Map<MessageOrdinal, Date> {
    const tsMap = new Map<MessageOrdinal, Date>();
    for (const messageOrdinal of messageOrdinalsFromSemanticRefs(
        semanticRefs,
    )) {
        let ts = tsMap.get(messageOrdinal);
        if (ts === undefined) {
            const timestamp = messages.get(messageOrdinal).timestamp;
            if (timestamp) {
                ts = new Date(timestamp);
                tsMap.set(messageOrdinal, ts);
            }
        }
    }
    return tsMap;
}

export function getTimestampedScoredSemanticRefOrdinals(
    conversation: IConversation,
    scoredOrdinals: ScoredSemanticRefOrdinal[],
): dateTime.Timestamped<ScoredSemanticRefOrdinal>[] {
    const messages = conversation.messages;
    const semanticRefs = conversation.semanticRefs;
    const timestamped: dateTime.Timestamped<ScoredSemanticRefOrdinal>[] = [];
    if (messages && semanticRefs) {
        const sRefs = getSemanticRefsFromScoredOrdinals(
            semanticRefs,
            scoredOrdinals,
        );
        const timestamps = getTimestampsForSemanticRefs(messages, sRefs);
        for (let i = 0; i < sRefs.length; ++i) {
            const timestamp = timestamps.get(
                sRefs[i].range.start.messageOrdinal,
            );
            if (timestamp !== undefined) {
                timestamped.push({ value: scoredOrdinals[i], timestamp });
            }
        }
    }
    return timestamped;
}
