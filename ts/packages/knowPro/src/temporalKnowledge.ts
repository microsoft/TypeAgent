// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { conversation as kpLib } from "@typeagent/knowledge-processor";
import { error, Result } from "typechat";
import type { IMessageCollection, TextLocation } from "./interfaces.js";
import { extractKnowledgeFromText } from "./knowledge.js";
import {
    parseTemporalValue,
    temporalMentions,
    TemporalValueError,
} from "./temporal.js";
import type { MessageTemporalContext } from "./temporalSchema.js";

type DateEvidence = MessageTemporalContext["inheritedDateEvidence"][number];
type RejectedDateAnchor = NonNullable<
    MessageTemporalContext["rejectedDateAnchors"]
>[number];

function quoteRejection(
    text: string,
    quote: string,
    date: string,
): RejectedDateAnchor["reason"] | undefined {
    const start = text.indexOf(quote);
    if (!quote || start < 0) return "quote-not-found";
    if (text.indexOf(quote, start + 1) >= 0) return "ambiguous-quote";
    if (!quote.includes(date)) return "date-not-in-quote";
    return undefined;
}

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
): { dates: DateEvidence[]; rejected: RejectedDateAnchor[] } {
    const dates: DateEvidence[] = [];
    const rejected: RejectedDateAnchor[] = [];
    for (const [anchorOrdinal, anchor] of (
        knowledge.dateAnchors ?? []
    ).entries()) {
        const rejection = {
            chunkOrdinal: location.chunkOrdinal ?? 0,
            anchorOrdinal,
        };
        const reason = quoteRejection(text, anchor.quote, anchor.date);
        if (reason) {
            rejected.push({ ...rejection, reason });
            continue;
        }
        let value: DateEvidence["value"];
        try {
            value = parseTemporalValue(anchor.date);
        } catch (error) {
            if (!(error instanceof TemporalValueError)) throw error;
            rejected.push({ ...rejection, reason: "invalid-date" });
            continue;
        }
        const start = text.indexOf(anchor.quote);
        dates.push({
            id: `${context.ownerId}:${context.partOrdinal ?? 0}:${location.chunkOrdinal ?? 0}:${start}:${start + anchor.quote.length}:${anchor.date}`,
            role: "eventTime",
            locator: `source-part:${context.sourceRevisionId}:${encodeURIComponent(context.ownerId)}:${context.partOrdinal ?? 0}:chunk:${location.chunkOrdinal ?? 0}:${start}:${start + anchor.quote.length}`,
            value,
            quote: anchor.quote,
            chunkOrdinal: location.chunkOrdinal ?? 0,
        });
    }
    return { dates, rejected };
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

function prepareTemporalContext(
    messages: IMessageCollection,
    location: TextLocation,
    context: MessageTemporalContext,
    text: string,
    inherited: DateEvidence[],
): DateEvidence[] {
    const chunkOrdinal = location.chunkOrdinal ?? 0;
    context.discoveredDateEvidence = (
        context.discoveredDateEvidence ?? []
    ).filter(
        (entry) =>
            entry.chunkOrdinal !== undefined &&
            entry.chunkOrdinal < chunkOrdinal,
    );
    context.rejectedDateAnchors = (context.rejectedDateAnchors ?? []).filter(
        (entry) => entry.chunkOrdinal < chunkOrdinal,
    );
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
    context.eventMentions = [
        ...(context.eventMentions ?? []).filter(
            (mention) =>
                mention.chunkOrdinal !== undefined &&
                mention.chunkOrdinal < chunkOrdinal,
        ),
        ...temporalMentions(text, context).map((mention) => ({
            ...mention,
            chunkOrdinal,
        })),
    ];
    const { contextHash: _previousHash, ...inputContext } = context;
    context.contextHash = createHash("sha256")
        .update(JSON.stringify({ ...inputContext, chunkOrdinal }))
        .digest("hex");
    return inherited;
}

function recordDiscoveredDates(
    text: string,
    knowledge: kpLib.KnowledgeResponse,
    context: MessageTemporalContext,
    location: TextLocation,
): DateEvidence[] {
    const discovered = discoveredDates(text, knowledge, context, location);
    context.rejectedDateAnchors = [
        ...(context.rejectedDateAnchors ?? []),
        ...discovered.rejected,
    ];
    if (discovered.rejected.length)
        console.warn(
            `knowPro: rejected ${discovered.rejected.length} optional date anchor(s) for revision ${context.sourceRevisionId}, part ${context.partOrdinal ?? 0}, chunk ${location.chunkOrdinal ?? 0}: ${discovered.rejected.map((entry) => entry.reason).join(", ")}. Unvalidated anchors will not be inherited or indexed as event dates.`,
        );
    context.discoveredDateEvidence = uniqueEvidence([
        ...(context.discoveredDateEvidence ?? []),
        ...discovered.dates,
    ]);
    return context.discoveredDateEvidence;
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
                if (context)
                    inherited = prepareTemporalContext(
                        messages,
                        location,
                        context,
                        text,
                        inherited,
                    );
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
                    inherited = uniqueEvidence([
                        ...inherited,
                        ...recordDiscoveredDates(
                            text,
                            result.data,
                            context,
                            location,
                        ),
                    ]);
                }
            }
        }),
    );
    for (const outcome of outcomes)
        if (outcome.status === "rejected") throw outcome.reason;
    return results;
}
