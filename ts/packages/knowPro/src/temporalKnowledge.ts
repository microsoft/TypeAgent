// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { conversation as kpLib } from "@typeagent/knowledge-processor";
import { error, Result } from "typechat";
import type { IMessageCollection, TextLocation } from "./interfaces.js";
import { extractKnowledgeFromText } from "./knowledge.js";
import { parseTemporalValue, temporalMentions } from "./temporal.js";
import type { MessageTemporalContext } from "./temporalSchema.js";

type DateEvidence = MessageTemporalContext["inheritedDateEvidence"][number];

function uniqueEvidence(evidence: DateEvidence[]): DateEvidence[] {
    const entries = new Map<string, DateEvidence>();
    for (const entry of evidence) {
        const previous = entries.get(entry.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
            throw new Error("Conflicting inherited temporal evidence");
        entries.set(entry.id, entry);
    }
    return [...entries.values()];
}

function discoveredDates(
    text: string,
    knowledge: kpLib.KnowledgeResponse,
    context: MessageTemporalContext,
    location: TextLocation,
): DateEvidence[] {
    return (knowledge.dateAnchors ?? []).map((anchor) => {
        const start = text.indexOf(anchor.quote);
        if (
            !anchor.quote ||
            start < 0 ||
            text.indexOf(anchor.quote, start + 1) >= 0 ||
            !anchor.quote.includes(anchor.date)
        )
            throw new Error(
                "Extracted date anchor lacks a unique exact source quote",
            );
        return {
            id: `${context.ownerId}:${context.partOrdinal ?? 0}:${location.chunkOrdinal ?? 0}:${start}`,
            role: "eventTime",
            locator: `source-part:${context.sourceRevisionId}:${encodeURIComponent(context.ownerId)}:${context.partOrdinal ?? 0}:chunk:${location.chunkOrdinal ?? 0}:${start}:${start + anchor.quote.length}`,
            value: parseTemporalValue(anchor.date),
            quote: anchor.quote,
            chunkOrdinal: location.chunkOrdinal ?? 0,
        };
    });
}

function earlierEvidence(
    messages: IMessageCollection,
    location: TextLocation,
    context: MessageTemporalContext,
): DateEvidence[] {
    const evidence: DateEvidence[] = [];
    for (let previous = 0; previous <= location.messageOrdinal; previous++) {
        const temporal = messages.get(previous).metadata?.temporalContext;
        if (
            temporal?.sourceRevisionId === context.sourceRevisionId &&
            temporal.ownerId === context.ownerId &&
            temporal.sourceContextHash === context.sourceContextHash
        )
            evidence.push(
                ...(temporal.discoveredDateEvidence ?? []).filter(
                    (entry) =>
                        previous < location.messageOrdinal ||
                        (entry.chunkOrdinal !== undefined &&
                            entry.chunkOrdinal < (location.chunkOrdinal ?? 0)),
                ),
            );
    }
    return uniqueEvidence(evidence);
}

export async function extractKnowledgeWithTemporalContext(
    messages: IMessageCollection,
    batch: TextLocation[],
    extractor: kpLib.KnowledgeExtractor,
): Promise<Result<kpLib.KnowledgeResponse>[]> {
    const groups = new Map<string, number[]>();
    for (const [index, location] of batch.entries()) {
        const context = messages.get(location.messageOrdinal).metadata
            ?.temporalContext;
        const key = context
            ? JSON.stringify([context.sourceRevisionId, context.ownerId])
            : `unscoped:${index}`;
        const group = groups.get(key) ?? [];
        group.push(index);
        groups.set(key, group);
    }
    const results: Result<kpLib.KnowledgeResponse>[] = new Array(batch.length);
    const outcomes = await Promise.allSettled(
        [...groups.values()].map(async (group) => {
            let inherited: DateEvidence[] = [];
            let prerequisiteFailed = false;
            for (const index of group) {
                if (prerequisiteFailed) {
                    results[index] = error(
                        "Temporal prerequisite extraction failed",
                    );
                    continue;
                }
                const location = batch[index];
                const message = messages.get(location.messageOrdinal);
                const text = message.textChunks[location.chunkOrdinal ?? 0];
                const context = message.metadata?.temporalContext;
                if (context) {
                    inherited = uniqueEvidence([
                        ...inherited,
                        ...earlierEvidence(messages, location, context),
                    ]);
                    context.inheritedDateEvidence = uniqueEvidence([
                        ...context.inheritedDateEvidence.filter(
                            (entry) => entry.role === "messageTime",
                        ),
                        ...inherited,
                    ]);
                    context.contextHash = createHash("sha256")
                        .update(
                            JSON.stringify({
                                source: context.sourceContextHash,
                                owner: context.ownerId,
                                evidence: context.inheritedDateEvidence,
                            }),
                        )
                        .digest("hex");
                    context.eventMentions = [
                        ...(context.eventMentions ?? []).filter(
                            (mention) =>
                                mention.chunkOrdinal !== undefined &&
                                mention.chunkOrdinal <
                                    (location.chunkOrdinal ?? 0),
                        ),
                        ...temporalMentions(text, context).map((mention) => ({
                            ...mention,
                            chunkOrdinal: location.chunkOrdinal ?? 0,
                        })),
                    ];
                }
                const result = await extractKnowledgeFromText(
                    extractor,
                    text,
                    3,
                    context,
                );
                results[index] = result;
                if (!result.success) {
                    prerequisiteFailed = true;
                    continue;
                }
                if (context) {
                    context.discoveredDateEvidence = uniqueEvidence([
                        ...(context.discoveredDateEvidence ?? []).filter(
                            (entry) =>
                                entry.chunkOrdinal !== undefined &&
                                entry.chunkOrdinal <
                                    (location.chunkOrdinal ?? 0),
                        ),
                        ...discoveredDates(
                            text,
                            result.data,
                            context,
                            location,
                        ),
                    ]);
                    inherited = uniqueEvidence([
                        ...inherited,
                        ...context.discoveredDateEvidence,
                    ]);
                }
            }
        }),
    );
    for (const outcome of outcomes)
        if (outcome.status === "rejected") throw outcome.reason;
    return results;
}
