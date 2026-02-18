// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Bridge between email agent types and kp (Knowledge Processor) types.
 *
 * Converts EmailMessage objects into kp TextChunks and ChunkGroups
 * for keyword indexing and search.
 */

import { EmailMessage } from "graph-utils";
import { TextChunk, ChunkGroup } from "kp";

/**
 * Convert a batch of EmailMessages into kp TextChunks and ChunkGroups.
 *
 * Each email becomes one TextChunk. Emails with the same conversationId
 * (or subject-based thread key) are grouped into ChunkGroups.
 *
 * @param messages - Email messages from the provider
 * @param startChunkId - Starting chunk ID (for incremental indexing)
 * @returns chunks and groups for kp indexing
 */
export function emailsToChunks(
    messages: EmailMessage[],
    startChunkId: number = 0,
): { chunks: TextChunk[]; groups: ChunkGroup[] } {
    const chunks: TextChunk[] = [];
    const groupMap = new Map<string, ChunkGroup>();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const chunkId = startChunkId + i;

        // Build metadata
        const metadata: Record<string, string[]> = {};

        // Store message ID for deduplication in incremental indexing
        if (msg.id) {
            metadata.messageId = [msg.id];
        }
        if (msg.from?.address) {
            metadata.sender = [msg.from.address];
        }
        if (msg.toRecipients && msg.toRecipients.length > 0) {
            metadata.recipient = msg.toRecipients
                .map((r) => r.address)
                .filter(Boolean);
        }
        if (msg.ccRecipients && msg.ccRecipients.length > 0) {
            metadata.cc = msg.ccRecipients
                .map((r) => r.address)
                .filter(Boolean);
        }
        if (msg.subject) {
            metadata.subject = [msg.subject];
        }
        if (msg.webLink) {
            metadata.webLink = [msg.webLink];
        }

        // Build text content: headers + body
        const textParts: string[] = [];
        if (msg.from) {
            const fromStr = msg.from.name
                ? `${msg.from.name} <${msg.from.address}>`
                : msg.from.address;
            textParts.push(`From: ${fromStr}`);
        }
        if (msg.toRecipients && msg.toRecipients.length > 0) {
            const toStr = msg.toRecipients
                .map((r) => (r.name ? `${r.name} <${r.address}>` : r.address))
                .join(", ");
            textParts.push(`To: ${toStr}`);
        }
        if (msg.subject) {
            textParts.push(`Subject: ${msg.subject}`);
        }
        textParts.push("");
        textParts.push(msg.body || msg.bodyPreview || "");

        // Thread grouping: use subject-based key (strip Re:/Fwd: prefixes)
        const threadKey = getThreadKey(msg);

        const chunk: TextChunk = {
            chunkId,
            text: textParts.join("\n"),
            metadata,
            groupId: threadKey,
        };
        if (msg.receivedDateTime) {
            chunk.timestamp = msg.receivedDateTime;
        }
        chunks.push(chunk);

        // Build or update group
        if (!groupMap.has(threadKey)) {
            groupMap.set(threadKey, {
                groupId: threadKey,
                groupType: "thread",
                label: stripReplyPrefix(msg.subject || ""),
                chunkIds: [],
                metadata: {},
            });
        }
        const group = groupMap.get(threadKey)!;
        group.chunkIds.push(chunkId);

        // Update time range
        if (msg.receivedDateTime) {
            if (!group.timeRange) {
                group.timeRange = {
                    start: msg.receivedDateTime,
                    end: msg.receivedDateTime,
                };
            } else {
                if (
                    group.timeRange.start &&
                    msg.receivedDateTime < group.timeRange.start
                ) {
                    group.timeRange.start = msg.receivedDateTime;
                }
                if (
                    group.timeRange.end &&
                    msg.receivedDateTime > group.timeRange.end
                ) {
                    group.timeRange.end = msg.receivedDateTime;
                }
            }
        }
    }

    return { chunks, groups: Array.from(groupMap.values()) };
}

/**
 * Derive a thread key from an email message.
 * Uses the base subject (stripped of Re:/Fwd: prefixes) as the grouping key.
 */
function getThreadKey(msg: EmailMessage): string {
    const base = stripReplyPrefix(msg.subject || "no-subject");
    return `thread:${base.toLowerCase().replace(/\s+/g, "-").slice(0, 80)}`;
}

/**
 * Strip Re:/Fwd:/FW: prefixes from a subject line.
 */
function stripReplyPrefix(subject: string): string {
    return subject.replace(/^(Re:\s*|Fwd:\s*|FW:\s*)+/i, "").trim();
}
