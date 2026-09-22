// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import path from "node:path";
import { asRecord, readString } from "./context.js";

const TAIL_BYTES = 2 * 1024 * 1024;

export type KnowledgePayload = {
    entities: { name: string; type: string | string[] }[];
    actions: unknown[];
    inverseActions: unknown[];
    topics: string[];
};

type AssistantTurn = {
    text: string;
    knowledge?: KnowledgePayload;
};

function parseKnowledge(value: unknown): KnowledgePayload | undefined {
    const record = asRecord(value);
    if (!record || !Array.isArray(record.entities)) {
        return undefined;
    }
    const entities = record.entities.flatMap((entity) => {
        const item = asRecord(entity);
        if (!item || typeof item.name !== "string") {
            return [];
        }
        const type = item.type;
        if (typeof type !== "string" && !Array.isArray(type)) {
            return [];
        }
        return [{ name: item.name, type }];
    });
    return {
        entities,
        actions: Array.isArray(record.actions) ? record.actions : [],
        inverseActions: Array.isArray(record.inverseActions)
            ? record.inverseActions
            : [],
        topics: Array.isArray(record.topics)
            ? record.topics.filter((topic) => typeof topic === "string")
            : [],
    };
}

function textFromAssistantEvent(value: unknown): string | undefined {
    const record = asRecord(value);
    if (!record) {
        return undefined;
    }
    const type = record.type;
    const data = asRecord(record.data) ?? record;
    if (type !== undefined && type !== "assistant.message") {
        return undefined;
    }
    if (type === undefined && data === record) {
        const role = readString(record, "role", "sender");
        if (role && role !== "assistant") {
            return undefined;
        }
    }
    return readString(
        data,
        "content",
        "text",
        "response",
        "lastAssistantMessage",
        "last_assistant_message",
    );
}

/**
 * Latest assistant text in a Copilot `events.jsonl` transcript, a JSON
 * message list, or a plain-text file. Optional knowledge rides along when
 * the stop payload or the event includes it.
 */
export function extractAssistantTurn(raw: string): AssistantTurn | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }
    let latest: AssistantTurn | undefined;
    for (const line of trimmed.split(/\r?\n/)) {
        const text = line.trim();
        if (!text.startsWith("{") && !text.startsWith("[")) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            continue;
        }
        const fromLine = textFromAssistantEvent(parsed);
        if (fromLine) {
            const knowledge = parseKnowledge(asRecord(parsed)?.knowledge);
            latest = knowledge
                ? { text: fromLine, knowledge }
                : { text: fromLine };
        }
    }
    if (latest) {
        return latest;
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
            for (const item of parsed) {
                const text = textFromAssistantEvent(item);
                if (text) {
                    latest = { text };
                }
            }
            return latest;
        }
        const text = textFromAssistantEvent(parsed);
        if (text) {
            const knowledge = parseKnowledge(asRecord(parsed)?.knowledge);
            return knowledge ? { text, knowledge } : { text };
        }
    } catch {
        // Plain text transcript.
    }
    return { text: trimmed };
}

export function parseStopKnowledge(
    value: unknown,
): KnowledgePayload | undefined {
    return parseKnowledge(value);
}

async function readTail(filePath: string): Promise<string> {
    const stat = await fs.stat(filePath);
    const handle = await fs.open(filePath, "r");
    try {
        const length = Math.min(stat.size, TAIL_BYTES);
        const start = stat.size - length;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        const text = buffer.toString("utf8");
        if (start === 0) {
            return text;
        }
        const newline = text.indexOf("\n");
        return newline === -1 ? text : text.slice(newline + 1);
    } finally {
        await handle.close();
    }
}

export async function readTranscriptTurn(
    transcriptPath: string,
): Promise<AssistantTurn | undefined> {
    let filePath = transcriptPath;
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
        filePath = path.join(filePath, "events.jsonl");
    }
    return extractAssistantTurn(await readTail(filePath));
}
